'use client';

import { notifyApi } from './api';
import { logger } from './logger';

function urlSafeBase64(s: string): Uint8Array {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const b64 = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Register Web Push subscription (VAPID) for background notifications. */
export async function registerWebPush(): Promise<void> {
  try {
    const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapid || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
    const reg = await navigator.serviceWorker.register('/sw.js');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlSafeBase64(vapid) as BufferSource,
    });
    await notifyApi.register('web', sub.toJSON());
  } catch (err) {
    logger.warn('WebPush registration skipped:', err);
  }
}
