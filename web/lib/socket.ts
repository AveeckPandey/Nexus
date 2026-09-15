import { io, Socket } from 'socket.io-client';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:8080';

let socket: Socket | null = null;

interface QueuedMessage {
  event: string;
  data: any;
  ack?: (res: any) => void;
  timestamp: number;
}

const offlineQueue: QueuedMessage[] = [];
let isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    isOnline = true;
    if (socket && !socket.connected) {
      socket.connect();
    } else if (socket?.connected) {
      flushQueue();
    }
  });

  window.addEventListener('offline', () => {
    isOnline = false;
  });
}

function flushQueue() {
  if (!socket?.connected || offlineQueue.length === 0) return;
  // Sequential flush: preserves exact chat order
  const pending = [...offlineQueue];
  offlineQueue.length = 0;
  for (const item of pending) {
    if (item.ack) {
      socket.emit(item.event, item.data, item.ack);
    } else {
      socket.emit(item.event, item.data);
    }
  }
}

export function connectSocket(token: string): Socket {
  if (socket?.connected) return socket;
  if (socket) {
    socket.auth = { token };
    socket.connect();
    return socket;
  }

  socket = io(WS_URL, {
    transports: ['websocket'],
    auth: { token },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    randomizationFactor: 0.5,
    timeout: 10000,
  });

  socket.on('connect', () => {
    flushQueue();
  });

  socket.on('reconnect', () => {
    flushQueue();
  });

  return socket;
}

export function getSocket(): Socket | null {
  return socket;
}

export function emitWithOfflineQueue(event: string, data: any, ack?: (res: any) => void): boolean {
  if (socket?.connected && isOnline) {
    if (ack) {
      socket.emit(event, data, ack);
    } else {
      socket.emit(event, data);
    }
    return true;
  }

  // Queue message for automatic dispatch when socket reconnects
  offlineQueue.push({ event, data, ack, timestamp: Date.now() });
  return false;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
  offlineQueue.length = 0;
}
