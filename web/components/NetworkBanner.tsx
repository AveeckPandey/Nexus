'use client';

import { useEffect, useState } from 'react';
import { useNetworkStore } from '@/store/network';
import { getSocket } from '@/lib/socket';
import { CloseIcon } from './MenuIcons';

export function NetworkBanner() {
  const isOnline = useNetworkStore((s) => s.isOnline);
  const isSlow = useNetworkStore((s) => s.isSlow);
  const latency = useNetworkStore((s) => s.latency);
  const reason = useNetworkStore((s) => s.reason);
  const updateStatus = useNetworkStore((s) => s.updateStatus);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // 1. Browser online / offline events
    const handleOnline = () => {
      updateStatus({ isOnline: true, isSlow: false, reason: null });
      setDismissed(false);
    };

    const handleOffline = () => {
      updateStatus({ isOnline: false, isSlow: true, reason: 'No internet connection' });
      setDismissed(false);
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
      if (!navigator.onLine) {
        handleOffline();
      }
    }

    // 2. Navigator NetworkInformation API (Cellular / 2G / 3G)
    const nav = typeof navigator !== 'undefined' ? (navigator as any) : null;
    const conn = nav?.connection || nav?.mozConnection || nav?.webkitConnection;

    const checkConnectionApi = () => {
      if (!conn) return;
      const type = conn.effectiveType; // 'slow-2g', '2g', '3g', '4g'
      const rtt = conn.rtt; // Round-trip time in ms
      const isSlowNet = type === 'slow-2g' || type === '2g' || (rtt && rtt > 600);
      if (isSlowNet) {
        updateStatus({
          effectiveType: type,
          isSlow: true,
          reason: type === '2g' || type === 'slow-2g' ? 'Slow 2G/3G network' : `High latency (${rtt}ms)`,
        });
      } else if (conn.effectiveType === '4g' && (!rtt || rtt < 400)) {
        updateStatus({ effectiveType: type, isSlow: false, reason: null });
      }
    };

    if (conn) {
      checkConnectionApi();
      conn.addEventListener?.('change', checkConnectionApi);
    }

    // 3. Periodic WebSocket Ping-Pong Heartbeat RTT
    const interval = setInterval(() => {
      const socket = getSocket();
      if (!socket?.connected) {
        if (navigator.onLine) {
          updateStatus({ isSlow: true, reason: 'Reconnecting to chat server…' });
        }
        return;
      }

      const t0 = Date.now();
      socket.timeout(5000).emit('network_ping', (err: any) => {
        if (err) {
          updateStatus({ isSlow: true, reason: 'High packet loss / Server slow' });
          return;
        }
        const rtt = Date.now() - t0;
        const isLagging = rtt > 600;
        updateStatus({
          latency: rtt,
          isSlow: isLagging,
          reason: isLagging ? `High server latency (${rtt}ms)` : null,
        });
      });
    }, 12000);

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      }
      conn?.removeEventListener?.('change', checkConnectionApi);
      clearInterval(interval);
    };
  }, [updateStatus]);

  // Reset dismissed state when error state clears
  useEffect(() => {
    if (!isSlow && isOnline) {
      setDismissed(false);
    }
  }, [isSlow, isOnline]);

  if (dismissed || (isOnline && !isSlow)) return null;

  return (
    <div
      role="alert"
      className={`w-full px-4 py-2 text-xs font-medium flex items-center justify-between transition-colors z-50 shadow-[6px_6px_12px_#b8bcc9,-6px_-6px_12px_#ffffff] ${
        !isOnline
          ? 'bg-[#F5D6C2] text-[#7A3A00] border-b border-[#CC5500]/40'
          : 'bg-[#E9EDF3] text-[#2F343D] border-b border-[#b8bcc9]/60'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 bg-[#CC5500] animate-pulse`} aria-hidden />
        <span>
          {!isOnline ? (
            <b>You are offline. Reconnecting to Nexus…</b>
          ) : (
            <>
              <b>Slow network connection:</b> {reason || `High latency (~${latency}ms)`}. Messages and calls may be delayed.
            </>
          )}
        </span>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="ml-2 flex items-center justify-center w-6 h-6 rounded-full bg-[#E0E5EC] text-[#2F343D] shadow-[6px_6px_12px_#b8bcc9,-6px_-6px_12px_#ffffff] hover:bg-white/60 transition shrink-0"
        aria-label="Dismiss network warning"
      >
        <CloseIcon size={12} />
      </button>
    </div>
  );
}

