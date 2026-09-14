import { WebRtcGateway } from '../../server/src/modules/webrtc/webrtc.gateway';
import { WebRtcService } from '../../server/src/modules/webrtc/webrtc.service';
import { AiService } from '../../server/src/modules/ai/ai.service';
import { GhostService } from '../../server/src/modules/ghost/ghost.service';
import { DynamoDbService } from '../../server/src/modules/dynamodb/dynamodb.service';

// Bulletproof offline Groq: jest.mock is hoisted above all imports, so even if
// server/.env contains a live GROQ_API_KEY (loaded via dotenv at import time),
// AiService always sees apiKey '' and takes the deterministic offline fallback.
// Any accidental live-client access throws loudly instead of hitting network.
jest.mock('../../server/src/config/groq.config', () => {
  const actual = jest.requireActual('../../server/src/config/groq.config');
  return {
    ...actual,
    GROQ_CONFIG: {
      get apiKey() {
        return '';
      },
      get model() {
        return 'test-offline';
      },
    },
    getGroqClient: () => {
      throw new Error('Groq disabled in tests');
    },
    groqClient: new Proxy(
      {},
      {
        get: () => () => {
          throw new Error('Groq disabled in tests');
        },
      },
    ),
  };
});

describe('features-cap: WebRTC 5-peer limit, AI Bot, Transcribe & Ghost Chat', () => {
  describe('WebRTC 5-Peer Capacity Limit', () => {
    test('enforces maximum 5 participants for P2P mesh and rejects the 6th participant', async () => {
      const calls = new WebRtcService();
      const mockTokens = { verify: jest.fn() } as any;
      const gateway = new WebRtcGateway(calls, mockTokens);

      const serverToEmit = jest.fn();
      gateway.server = { to: jest.fn().mockReturnValue({ emit: serverToEmit }) } as any;

      // Initiate call
      const initSocket: any = { id: 'socket_peer_0', data: { userId: 'u0' }, join: jest.fn() };
      const res = gateway.initiate(initSocket, {
        conversationId: 'c1',
        initiatorName: 'Peer 0',
        callType: 'video',
        recipientIds: ['u1', 'u2', 'u3', 'u4', 'u5'],
      });

      const callId = res.callId;

      // Peers 1 to 4 accept (total participants reaches 5, including initiator)
      for (let i = 1; i <= 4; i++) {
        const peerSocket: any = {
          id: `socket_peer_${i}`,
          data: { userId: `u${i}` },
          join: jest.fn(),
          emit: jest.fn(),
        };
        const acceptRes = await gateway.accept(peerSocket, { callId, conversationId: 'c1' });
        expect(acceptRes.status).toBe('accepted');
      }

      const activeCall = await calls.getCall(callId);
      expect(activeCall?.participants.size).toBe(5);

      // Peer 5 (6th participant) attempts to join
      const peer6Socket: any = {
        id: 'socket_peer_5',
        data: { userId: 'u5' },
        join: jest.fn(),
        emit: jest.fn(),
      };
      const rejectRes = await gateway.accept(peer6Socket, { callId, conversationId: 'c1' });

      expect(rejectRes.status).toBe('full');
      expect(peer6Socket.emit).toHaveBeenCalledWith('call_rejected', {
        callId,
        reason: 'Call is full (maximum 5 participants for P2P mesh)',
      });
      // Participant count remains capped at 5
      expect(activeCall?.participants.size).toBe(5);
    });
  });

  describe('Nexus AI Assistant & Transcription Groundwork', () => {
    const ai = new AiService();
    const SAVED_GROQ_KEY = process.env.GROQ_API_KEY;

    beforeAll(() => {
      // Belt-and-braces with the jest.mock above: also clear the env var so
      // any code reading process.env.GROQ_API_KEY directly sees offline mode.
      // (dotenv at import time never overrides the '' set in tests/setup.ts,
      // but this guards direct `node` runs that skip setup files.)
      process.env.GROQ_API_KEY = '';
      process.env.MONGODB_URI = '';
    });

    afterAll(() => {
      process.env.GROQ_API_KEY = SAVED_GROQ_KEY as string;
    });

    test('chatReply responds to greetings and identifies as Nexus AI', async () => {
      const reply = await ai.chatReply('@nexus Hello there!', 'Alice');
      expect(reply).toContain('Nexus AI');
      expect(reply).toContain('Alice');
    });

    test('chatReply responds to help and lists features (WebRTC 5 people, ghost chats)', async () => {
      const reply = await ai.chatReply('@ai What features are available?', 'Bob');
      expect(reply).toContain('5 people');
      expect(reply).toContain('Ghost chat');
    });

    test('chatReply responds to status query', async () => {
      const reply = await ai.chatReply('@nexus system status', 'Charlie');
      expect(reply).toContain('operational');
    });

    test('transcribe returns transcription result', async () => {
      const transcript = await ai.transcribe('data:audio/webm;base64,GkXfo59ChoEBQveBAULygQ8=');
      expect(transcript).toContain('transcription');
    });
  });

  describe('Anonymous Ghost Chat Joining', () => {
    test('guest user can claim invite and join room without registration', async () => {
      const db = new DynamoDbService();
      const ghost = new GhostService(db);

      // Host creates invite
      const invite = await ghost.createInvite('host_user_123');
      expect(invite.token).toBeDefined();
      expect(invite.roomId).toBeDefined();

      // Anonymous unregistered guest claims invite with ephemeral guest ID
      const guestId = 'guest_anon_789';
      const claim = await ghost.claimInvite(invite.token, guestId);
      expect(claim.roomId).toBe(invite.roomId);

      // Verify guest is now an authorized participant of the room
      const isPart = await ghost.isParticipant(invite.roomId, guestId);
      expect(isPart).toBe(true);

      // Guest can send an encrypted message with a custom burn window (≤5min)
      const msg = await ghost.saveMessage(
        invite.roomId,
        guestId,
        'Anon Guest',
        'aGVsbG8tY2lwaGVydGV4dA==',
        { isEncrypted: true, nonce: 'dGVzdG5vbmNlMTIzNDU2Nzg=', encVersion: 1 },
        60,
      );
      expect(msg.roomId).toBe(invite.roomId);
      expect(msg.senderId).toBe(guestId);
      expect(msg.isEncrypted).toBe(true);
      expect(msg.burnDuration).toBe(60);

      // Plaintext ghost messages are rejected (ciphertext-only rooms)
      await expect(
        ghost.saveMessage(invite.roomId, guestId, 'Anon Guest', 'Hello from secret guest!'),
      ).rejects.toThrow('end-to-end encrypted');

      // Oversized burn windows are clamped to the 5-minute maximum
      const longMsg = await ghost.saveMessage(
        invite.roomId,
        guestId,
        'Anon Guest',
        'bG9uZy1jaXBoZXJ0ZXh0',
        { isEncrypted: true, nonce: 'b3RoZXJub25jZTEyMzQ1Njc=', encVersion: 1 },
        9999,
      );
      expect(longMsg.burnDuration).toBe(300);

      // Room wipe removes every message + membership row (untrackable)
      const { deleted } = await ghost.destroyRoom(invite.roomId);
      expect(deleted).toBeGreaterThan(0);
      await expect(ghost.isParticipant(invite.roomId, guestId)).resolves.toBe(false);

      // Creator re-opening the link can still access their room
      const reClaim = await ghost.claimInvite(invite.token, 'host_user_123');
      expect(reClaim.roomId).toBe(invite.roomId);
    });
  });

  describe('Network Latency & Slow Connection Warning System', () => {
    test('ChatGateway responds to network_ping with timestamp for RTT measurement', () => {
      const { ChatGateway } = require('../../server/src/modules/chat/chat.gateway');
      const mockChat = {} as any;
      const mockTokens = {} as any;
      const mockAi = {} as any;
      const gateway = new ChatGateway(mockChat, mockTokens, mockAi);
      const res = gateway.networkPing();
      expect(res.timestamp).toBeDefined();
      expect(typeof res.timestamp).toBe('number');
      expect(res.timestamp).toBeLessThanOrEqual(Date.now());
    });
  });
});
