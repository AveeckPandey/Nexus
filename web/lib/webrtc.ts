function getIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  ];
  const turnUrl = process.env.NEXT_PUBLIC_TURN_URL;
  if (turnUrl) {
    servers.push({
      urls: turnUrl,
      username: process.env.NEXT_PUBLIC_TURN_USERNAME,
      credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
    });
  }
  return servers;
}

/** Minimal mesh helper: one RTCPeerConnection per remote socket id. */
export class MeshCall {
  readonly pcs = new Map<string, RTCPeerConnection>();
  /** ICE candidates that arrived before setRemoteDescription — flushed after. */
  private pendingIce = new Map<string, RTCIceCandidateInit[]>();
  localStream: MediaStream | null = null;
  onRemoteStream: (socketId: string, stream: MediaStream) => void = () => {};
  onIce: (targetSocketId: string, candidate: RTCIceCandidate) => void = () => {};

  async startLocal(video: boolean): Promise<MediaStream> {
    this.localStream = await navigator.mediaDevices.getUserMedia({
      video: video ? { width: 640 } : false,
      audio: true,
    });
    return this.localStream;
  }

  peer(socketId: string): RTCPeerConnection {
    let pc = this.pcs.get(socketId);
    if (pc) return pc;
    pc = new RTCPeerConnection({ iceServers: getIceServers() });
    this.localStream?.getTracks().forEach((t) => pc!.addTrack(t, this.localStream!));
    pc.onicecandidate = (e) => {
      if (e.candidate) this.onIce(socketId, e.candidate);
    };
    pc.ontrack = (e) => {
      if (e.streams[0]) this.onRemoteStream(socketId, e.streams[0]);
    };
    this.pcs.set(socketId, pc);
    return pc;
  }

  async offer(socketId: string) {
    const pc = this.peer(socketId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    return offer;
  }

  async answer(socketId: string, sdp: RTCSessionDescriptionInit) {
    const pc = this.peer(socketId);
    await pc.setRemoteDescription(sdp);
    this.flushIce(socketId);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    return answer;
  }

  async accept(socketId: string, sdp: RTCSessionDescriptionInit) {
    await this.peer(socketId).setRemoteDescription(sdp);
    this.flushIce(socketId);
  }

  async candidate(socketId: string, candidate: RTCIceCandidateInit) {
    const pc = this.pcs.get(socketId);
    // Buffer until the remote description exists — kills InvalidStateError races.
    if (!pc || !pc.remoteDescription) {
      const q = this.pendingIce.get(socketId) || [];
      q.push(candidate);
      this.pendingIce.set(socketId, q);
      return;
    }
    try {
      await pc.addIceCandidate(candidate);
    } catch {
      /* closing peer */
    }
  }

  private flushIce(socketId: string) {
    const pc = this.pcs.get(socketId);
    const q = this.pendingIce.get(socketId) || [];
    this.pendingIce.delete(socketId);
    if (!pc) return;
    q.forEach((c) => {
      pc.addIceCandidate(c).catch(() => {});
    });
  }

  /**
   * Screen sharing without renegotiation: swap the outgoing video track on
   * every established peer connection. Pass null to restore the camera track.
   */
  async replaceVideoTrack(track: MediaStreamTrack | null, cameraTrack?: MediaStreamTrack | null) {
    const next = track || cameraTrack || null;
    if (next && this.localStream) {
      const old = this.localStream.getVideoTracks()[0];
      if (old && old !== next) {
        this.localStream.removeTrack(old);
        old.stop();
      }
      if (!this.localStream.getVideoTracks().includes(next)) {
        this.localStream.addTrack(next);
      }
    }
    await Promise.all(
      Array.from(this.pcs.values()).map(async (pc) => {
        const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
        if (sender && next) {
          try {
            await sender.replaceTrack(next);
          } catch {
            /* peer already closed */
          }
        }
      }),
    );
  }

  close() {
    this.pcs.forEach((pc) => pc.close());
    this.pcs.clear();
    this.pendingIce.clear();
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
  }
}
