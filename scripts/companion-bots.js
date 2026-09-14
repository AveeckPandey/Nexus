/**
 * scripts/companion-bots.js
 * Live AI-powered companion bots for Alice Chen, Bob Miller, and Charlie Davis.
 * Listens for messages from Aveeck, displays typing indicators, and responds in character.
 * Supports both end-to-end encrypted (Zero-Knowledge NaCl) and plaintext messaging.
 */
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.resolve(__dirname, '../server/.env') });

const { io } = require('../web/node_modules/socket.io-client');
const Groq = require('../server/node_modules/groq-sdk');
const nacl = require('../web/node_modules/tweetnacl');
const { encodeBase64, decodeBase64, encodeUTF8, decodeUTF8 } = require('../web/node_modules/tweetnacl-util');

const SERVER_URL = process.env.API_URL || 'http://localhost:8080';
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const BOTS = [
  {
    name: 'Alice Chen',
    email: 'alice@nexus.app',
    avatarUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80',
    persona: 'You are Alice Chen, Senior Infrastructure Architect at Nexus. You are friendly, enthusiastic about distributed systems, Redis, and high concurrency. Keep responses concise (1-2 sentences). Never include @ai or @nexus in your response.',
  },
  {
    name: 'Bob Miller',
    email: 'bob@nexus.app',
    avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    persona: 'You are Bob Miller, Lead WebRTC & Real-Time Media Engineer at Nexus. You are energetic, knowledgeable about P2P mesh, STUN/TURN, audio/video codecs. Keep responses concise (1-2 sentences). Never include @ai or @nexus in your response.',
  },
  {
    name: 'Charlie Davis',
    email: 'charlie@nexus.app',
    avatarUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80',
    persona: 'You are Charlie Davis, Lead Security & Cryptography Engineer at Nexus. You care deeply about Zero-Knowledge E2EE, TweetNaCl, and privacy. Keep responses concise (1-2 sentences). Never include @ai or @nexus in your response.',
  },
];

const BOT_NAMES = new Set(BOTS.map((b) => b.name));

async function loginBot(email) {
  const res = await fetch(`${SERVER_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'Password123!' }),
  }).then((r) => r.json());
  return res;
}

async function start() {
  console.log('🤖 Starting Nexus Companion Bots (Alice, Bob, Charlie)...');

  for (const bot of BOTS) {
    try {
      const auth = await loginBot(bot.email);
      if (!auth?.idToken) {
        console.warn(`Failed to login ${bot.name}`);
        continue;
      }

      // Deterministic X25519 keypair for E2EE decryption & encryption
      const seed = crypto.createHash('sha256').update(`${bot.email}:nexus:e2ee:seed`).digest();
      const botKeyPair = nacl.box.keyPair.fromSecretKey(seed);
      const botPublicKeyB64 = encodeBase64(botKeyPair.publicKey);
      const convKeys = new Map(); // convId -> Uint8Array (32-byte secretbox key)

      // Ensure bot's avatar, name, and X25519 public key are saved in its profile
      try {
        await fetch(`${SERVER_URL}/api/auth/profile`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${auth.idToken}`,
          },
          body: JSON.stringify({
            avatarUrl: bot.avatarUrl,
            name: bot.name,
            x25519PublicKey: botPublicKeyB64,
            about: bot.persona.slice(0, 120),
          }),
        });
      } catch (err) {
        /* best-effort */
      }

      const socket = io(SERVER_URL, {
        transports: ['websocket'],
        auth: { token: auth.idToken },
      });

      const joinedRooms = new Set();

      const joinConversations = async () => {
        try {
          const convList = await fetch(`${SERVER_URL}/api/chat/conversations`, {
            headers: { Authorization: `Bearer ${auth.idToken}` },
          }).then((r) => r.json());

          if (convList?.conversations) {
            for (const c of convList.conversations) {
              if (!joinedRooms.has(c.id)) {
                joinedRooms.add(c.id);
                socket.emit('join_room', { conversationId: c.id });
                console.log(`[${bot.name}] joined conversation ${c.id} (${c.title})`);
              }
            }
          }
        } catch (err) {
          // ignore transient errors
        }
      };

      socket.on('connect', async () => {
        console.log(`✓ ${bot.name} connected online to ${SERVER_URL}`);
        await joinConversations();
      });

      // Poll periodically to dynamically join any new conversations created while running
      setInterval(joinConversations, 3000);

      // Helper to fetch and unseal conversation key envelope
      const getOrFetchConvKey = async (convId) => {
        if (convKeys.has(convId)) return convKeys.get(convId);
        try {
          const res = await fetch(`${SERVER_URL}/api/chat/conversations/${convId}/key`, {
            headers: { Authorization: `Bearer ${auth.idToken}` },
          }).then((r) => r.json());

          if (res?.envelope?.encryptedKey && res?.envelope?.nonce && res?.envelope?.senderPub) {
            const opened = nacl.box.open(
              decodeBase64(res.envelope.encryptedKey),
              decodeBase64(res.envelope.nonce),
              decodeBase64(res.envelope.senderPub),
              botKeyPair.secretKey,
            );
            if (opened && opened.length === nacl.secretbox.keyLength) {
              convKeys.set(convId, opened);
              return opened;
            }
          }
        } catch (err) {
          console.warn(`[${bot.name}] failed to fetch/unseal key for ${convId}:`, err.message);
        }
        return null;
      };

      socket.on('new_message', async (msg) => {
        // Only reply if message is from a real human, not self, not another bot, not Nexus AI
        if (
          !msg ||
          msg.senderId === auth.user.userId ||
          msg.senderName === bot.name ||
          BOT_NAMES.has(msg.senderName) ||
          msg.senderId === 'nexus-ai' ||
          msg.senderName === 'Nexus AI'
        ) {
          return;
        }

        // Auto-join room if message arrives for a conversation not yet in joinedRooms
        if (msg.conversationId && !joinedRooms.has(msg.conversationId)) {
          joinedRooms.add(msg.conversationId);
          socket.emit('join_room', { conversationId: msg.conversationId });
        }

        let messageText = msg.content || '';
        let isEncryptedChat = false;

        // Decrypt message if end-to-end encrypted
        if (msg.isEncrypted && msg.nonce) {
          isEncryptedChat = true;
          const convKey = await getOrFetchConvKey(msg.conversationId);
          if (convKey) {
            try {
              const decrypted = nacl.secretbox.open(
                decodeBase64(msg.content),
                decodeBase64(msg.nonce),
                convKey,
              );
              if (decrypted) {
                messageText = encodeUTF8(decrypted);
              } else {
                console.warn(`[${bot.name}] decryption failed for message in ${msg.conversationId}`);
              }
            } catch (err) {
              console.warn(`[${bot.name}] error decrypting message:`, err.message);
            }
          }
        }

        // If message is directed to Nexus AI (@nexus or @ai), do NOT reply — Nexus AI handles it!
        if (/@nexus|@ai/i.test(messageText)) {
          return;
        }

        console.log(`[${bot.name}] received message from ${msg.senderName}: "${messageText}"`);

        // Show typing indicator
        socket.emit('user_typing_start', {
          conversationId: msg.conversationId,
          userId: auth.user.userId,
          username: bot.name,
        });

        // Generate response with Groq LLM
        let replyContent = `Hey ${msg.senderName}! Glad to connect.`;
        try {
          const comp = await groq.chat.completions.create({
            model: process.env.GROQ_MODEL || 'openai/gpt-oss-20b',
            messages: [
              { role: 'system', content: bot.persona },
              { role: 'user', content: `${msg.senderName} says: "${messageText}"` },
            ],
            max_tokens: 500,
            temperature: 0.7,
          });
          const ans = comp?.choices?.[0]?.message?.content?.trim();
          if (ans) {
            replyContent = ans;
          }
        } catch (err) {
          console.error(`AI generation error for ${bot.name}:`, err.message);
        }

        // Never emit @ai or @nexus trigger words from bots
        replyContent = replyContent.replace(/@nexus/gi, 'Nexus').replace(/@ai/gi, 'AI');

        // Wait 1.2 seconds to simulate human typing
        setTimeout(async () => {
          socket.emit('user_typing_stop', {
            conversationId: msg.conversationId,
            userId: auth.user.userId,
          });

          // If conversation has an active E2EE key, encrypt the response
          const convKey = convKeys.get(msg.conversationId);
          if (isEncryptedChat && convKey) {
            const replyNonce = nacl.randomBytes(nacl.secretbox.nonceLength);
            const boxed = nacl.secretbox(decodeUTF8(replyContent), replyNonce, convKey);
            socket.emit('send_message', {
              conversationId: msg.conversationId,
              senderName: bot.name,
              senderAvatar: bot.avatarUrl,
              content: encodeBase64(boxed),
              isEncrypted: true,
              nonce: encodeBase64(replyNonce),
              encVersion: 1,
            });
            console.log(`[${bot.name}] replied (E2EE encrypted): "${replyContent}"`);
          } else {
            socket.emit('send_message', {
              conversationId: msg.conversationId,
              senderName: bot.name,
              senderAvatar: bot.avatarUrl,
              content: replyContent,
              isEncrypted: false,
            });
            console.log(`[${bot.name}] replied (plaintext): "${replyContent}"`);
          }
        }, 1200);
      });
    } catch (e) {
      console.error(`Error initializing bot ${bot.name}:`, e.message);
    }
  }
}

start();
