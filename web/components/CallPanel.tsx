'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import { getSocket } from '@/lib/socket';
import { MeshCall } from '@/lib/webrtc';
import { useCallStore } from '@/store/call';

export function CallPanel() {
  const activeCallId = useCallStore((s) => s.activeCallId);
  const callType = useCallStore((s) => s.callType);
  const end = useCallStore((s) => s.end);
  const [remotes, setRemotes] = useState<Record<string, MediaStream>>({});
  const [muted, setMuted] = useState(false);
  const [sharing, setSharing] = useState(false);
  const localRef = useRef<HTMLVideoElement>(null);
  const cameraRef = useRef<MediaStreamTrack | null>(null);
  const meshRef = useRef<MeshCall | null>(null);

  useEffect(() => {
    if (!activeCallId) return;
    const socket = getSocket();
    const mesh = new MeshCall();
    meshRef.current = mesh;
    const video = callType !== 'audio';

    mesh.onRemoteStream = (id, stream) => setRemotes((r) => ({ ...r, [id]: stream }));
    mesh.onIce = (targetSocketId, candidate) =>
      socket?.emit('ice_candidate', { callId: activeCallId, targetSocketId, candidate });

    mesh.startLocal(video).then((local) => {
      cameraRef.current = local.getVideoTracks()[0] || null;
      if (localRef.current) localRef.current.srcObject = local;
    }).catch(() => {});

    const onStarted = async (d: { peerId: string }) => {
      const offer = await mesh.offer(d.peerId);
      socket?.emit('webrtc_offer', { callId: activeCallId, targetSocketId: d.peerId, sdp: offer });
    };
    const onOffer = async (d: { callerSocketId: string; sdp: RTCSessionDescriptionInit }) => {
      const answer = await mesh.answer(d.callerSocketId, d.sdp);
      socket?.emit('webrtc_answer', { callId: activeCallId, targetSocketId: d.callerSocketId, sdp: answer });
    };
    const onAnswer = (d: { responderSocketId: string; sdp: RTCSessionDescriptionInit }) => {
      mesh.accept(d.responderSocketId, d.sdp);
    };
    const onIce = (d: { senderSocketId: string; candidate: RTCIceCandidateInit }) => {
      mesh.candidate(d.senderSocketId, d.candidate);
    };
    const onEnded = () => hangup();
    const onRejected = () => hangup();

    socket?.on('call_started', onStarted);
    socket?.on('webrtc_offer', onOffer);
    socket?.on('webrtc_answer', onAnswer);
    socket?.on('ice_candidate', onIce);
    socket?.on('call_ended', onEnded);
    socket?.on('call_rejected', onRejected);
    return () => {
      socket?.off('call_started', onStarted);
      socket?.off('webrtc_offer', onOffer);
      socket?.off('webrtc_answer', onAnswer);
      socket?.off('ice_candidate', onIce);
      socket?.off('call_ended', onEnded);
      socket?.off('call_rejected', onRejected);
      mesh.close();
      meshRef.current = null;
      setRemotes({});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCallId]);

  const hangup = () => {
    const socket = getSocket();
    if (activeCallId) socket?.emit('call_hangup', { callId: activeCallId });
    meshRef.current?.close();
    meshRef.current = null;
    setRemotes({});
    end();
  };

  const toggleMute = () => {
    const tracks = meshRef.current?.localStream?.getAudioTracks() || [];
    tracks.forEach((t) => { t.enabled = muted; });
    setMuted(!muted);
  };

  const toggleShare = async () => {
    const mesh = meshRef.current;
    if (!mesh) return;
    if (sharing) {
      await mesh.replaceVideoTrack(null, cameraRef.current);
      if (localRef.current && mesh.localStream) localRef.current.srcObject = mesh.localStream;
      setSharing(false);
      return;
    }
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const track = screen.getVideoTracks()[0];
      if (!track) return;
      track.onended = () => {
        mesh.replaceVideoTrack(null, cameraRef.current).catch(() => {});
        if (localRef.current && mesh.localStream) localRef.current.srcObject = mesh.localStream;
        setSharing(false);
      };
      await mesh.replaceVideoTrack(track);
      if (localRef.current) localRef.current.srcObject = screen;
      setSharing(true);
    } catch {
      /* user cancelled the picker */
    }
  };

  if (!activeCallId) return null;
  const ids = Object.keys(remotes);

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col p-4">
      <b className="text-center text-sm mb-3">{callType === 'audio' ? '🔊 Audio call' : '📹 Video call'}</b>
      <div className={`flex-1 grid gap-2 ${ids.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
        <video ref={localRef} autoPlay muted playsInline className="w-full h-full object-cover rounded-xl bg-whatsapp-composer" />
        {ids.map((id) => (
          <RemoteVideo key={id} stream={remotes[id]} />
        ))}
      </div>
      <div className="flex justify-center gap-3 mt-4">
        <Button variant="flat" onPress={toggleMute}>{muted ? 'Unmute' : 'Mute'}</Button>
        {callType !== 'audio' && (
          <Button variant="flat" color={sharing ? 'warning' : 'default'} onPress={toggleShare}>
            {sharing ? 'Stop sharing' : '🖥️ Share screen'}
          </Button>
        )}
        <Button color="danger" onPress={hangup}>End call</Button>
      </div>
    </div>
  );
}

function RemoteVideo({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return <video ref={ref} autoPlay playsInline className="w-full h-full object-cover rounded-xl bg-whatsapp-composer" />;
}
