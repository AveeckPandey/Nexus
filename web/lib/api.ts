import axios from 'axios';

const baseURL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export const api = axios.create({ baseURL, timeout: 15000 });

let token: string | null = null;
let refreshToken: string | null = null;

export function setTokens(t: string | null, r?: string | null) {
  token = t;
  if (r !== undefined) refreshToken = r;
}

/** Current bearer token (for raw fetch/axios calls that bypass the interceptor). */
export function getToken(): string | null {
  return token;
}

api.interceptors.request.use((config) => {
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshing: Promise<string | null> | null = null;

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && refreshToken && !original._retried) {
      original._retried = true;
      try {
        let email: string | null = null;
        try {
          email = localStorage.getItem('nexus_email');
        } catch {
          /* storage unavailable */
        }
        refreshing =
          refreshing ||
          axios
            .post(`${baseURL}/api/auth/refresh`, { refreshToken, email })
            .then((r) => {
              setTokens(r.data.idToken, refreshToken);
              try {
                localStorage.setItem('nexus_token', r.data.idToken);
              } catch {
                /* storage unavailable */
              }
              return r.data.idToken as string;
            })
            .finally(() => {
              refreshing = null;
            });
        const fresh = await refreshing;
        if (fresh) {
          original.headers.Authorization = `Bearer ${fresh}`;
          return api(original);
        }
      } catch {
        /* refresh failed — fall through to logout */
      }
    }
    return Promise.reject(error);
  },
);

export interface PublicUser {
  userId: string;
  username: string;
  name?: string;
  avatarUrl?: string;
  about?: string;
  x25519PublicKey?: string | null;
  /** Client-only: true when resolved from the server directory (spoof-proof).
   * Message-derived placeholders are unverified and never overwrite these. */
  verified?: boolean;
}

export const authApi = {
  config: () => api.get('/api/auth/config').then((r) => r.data),
  signup: (email: string, password: string, name?: string) =>
    api.post('/api/auth/signup', { email, password, name }).then((r) => r.data),
  confirm: (email: string, code: string) =>
    api.post('/api/auth/confirm', { email, code }).then((r) => r.data),
  resend: (email: string) => api.post('/api/auth/resend-code', { email }).then((r) => r.data),
  login: (email: string, password: string) =>
    api.post('/api/auth/login', { email, password }).then((r) => r.data),
  google: (credential: string) => api.post('/api/auth/google', { credential }).then((r) => r.data),
  github: (code: string) => api.post('/api/auth/github', { code }).then((r) => r.data),
  forgotPassword: (email: string) =>
    api.post('/api/auth/forgot-password', { email }).then((r) => r.data),
  resetPassword: (email: string, code: string, newPassword: string) =>
    api.post('/api/auth/reset-password', { email, code, newPassword }).then((r) => r.data),
  me: () => api.get('/api/auth/me').then((r) => r.data),
  profile: (patch: { language?: string; name?: string; username?: string; x25519PublicKey?: string; avatarUrl?: string; about?: string }) =>
    api.patch('/api/auth/profile', patch).then((r) => r.data),
  publicUser: (id: string) => api.get(`/api/auth/users/${id}`).then((r) => r.data.user),
  language: (language: string) => api.patch('/api/auth/language', { language }),
  search: (q: string) =>
    api.get(`/api/auth/search?q=${encodeURIComponent(q)}`).then((r) => r.data.users as PublicUser[]),
  resolveInvite: (code: string) =>
    api.get(`/api/auth/resolve/${encodeURIComponent(code)}`).then((r) => r.data.user as PublicUser),
  inviteMe: () =>
    api
      .get('/api/auth/invite/me')
      .then((r) => r.data.invite as { userId: string; username: string; name?: string }),
  claimUsername: (username: string) =>
    api.patch('/api/auth/profile', { username }).then((r) => r.data),
};

export const chatApi = {
  conversations: () => api.get('/api/chat/conversations').then((r) => r.data.conversations),
  createConversation: (participantIds: string[], title?: string, type: 'direct' | 'group' = 'direct') =>
    api.post('/api/chat/conversations', { participantIds, title, type }).then((r) => r.data.conversation),
  /** Idempotent 1:1 open for invite links + username search (no duplicates). */
  directConversation: (otherUserId: string) =>
    api
      .post('/api/chat/conversations/direct', { otherUserId })
      .then((r) => r.data.conversation),
  messages: (id: string, limit = 50, cursor?: string | null) =>
    api
      .get(`/api/chat/messages/${id}?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
      .then((r) => r.data as { messages: unknown[]; nextCursor: string | null }),
  getKey: (id: string) => api.get(`/api/chat/conversations/${id}/key`).then((r) => r.data.envelope),
  /** Read-receipt cursors (userId → lastReadMessageId) for ✓✓ after reloads. */
  readCursors: (id: string) =>
    api.get(`/api/chat/conversations/${id}/read`).then((r) => r.data.cursors as Record<string, string>),
  putKey: (id: string, body: { recipientId: string; encryptedKey: string; nonce: string; senderPub: string; keyVersion?: number }) =>
    api.post(`/api/chat/conversations/${id}/key`, body).then((r) => r.data),
  presence: (userId: string) =>
    api.get(`/api/chat/presence/${encodeURIComponent(userId)}`).then((r) => r.data.status as 'online' | 'offline'),
  batchPresence: (userIds: string[]) =>
    api.post('/api/chat/presence/batch', { userIds }).then((r) => r.data.presence as Record<string, 'online' | 'offline'>),
};

export const ghostApi = {
  createInvite: (guestId?: string) =>
    api.post(`/api/ghost/invite${guestId ? `?guestId=${encodeURIComponent(guestId)}` : ''}`).then((r) => r.data),
  joinInvite: (token: string, guestId?: string) =>
    api.get(`/api/ghost/join/${encodeURIComponent(token)}${guestId ? `?guestId=${encodeURIComponent(guestId)}` : ''}`).then((r) => r.data),
  /** Wipe a whole ghost room (messages + members). Participant-only. */
  destroyRoom: (roomId: string, guestId?: string) =>
    api.delete(`/api/ghost/room/${encodeURIComponent(roomId)}${guestId ? `?guestId=${encodeURIComponent(guestId)}` : ''}`).then((r) => r.data),
};

export interface StoryItem {
  PK: string;
  SK: string;
  userId: string;
  mediaUrl: string;
  mediaType: string;
  createdAt: string;
  expire_at: number;
  views: { viewerId: string; viewedAt: string }[];
}

export const storiesApi = {
  post: (mediaUrl: string, mediaType = 'image') =>
    api.post('/api/stories', { mediaUrl, mediaType }).then((r) => r.data.story as StoryItem),
  mine: () => api.get('/api/stories').then((r) => r.data.stories as StoryItem[]),
  byUser: (userId: string) =>
    api.get(`/api/stories/${encodeURIComponent(userId)}`).then((r) => r.data.stories as StoryItem[]),
  recordView: (ownerId: string, itemSk: string) =>
    api.post(`/api/stories/${encodeURIComponent(ownerId)}/views`, { itemSk }).then((r) => r.data.receipt),
};

export const mediaApi = {
  presigned: (fileType: string, fileExtension: string) =>
    api.post('/api/media/presigned-url', { fileType, fileExtension }).then((r) => r.data),
  async upload(file: File): Promise<string> {
    const ext = file.name.includes('.') ? file.name.split('.').pop()! : 'bin';
    const { uploadUrl, mediaUrl } = await this.presigned(file.type, ext);
    // The local-upload fallback route is authenticated: attach the bearer
    // token (S3 presigned PUTs ignore unknown headers).
    const headers: Record<string, string> = { 'Content-Type': file.type };
    if (token) headers.Authorization = `Bearer ${token}`;
    await axios.put(uploadUrl, file, { headers });
    return mediaUrl as string;
  },
};

export const aiApi = {
  summarize: (messages: { sender: string; content: string }[]) =>
    api.post('/api/ai/summarize', { messages }).then((r) => r.data.summary as string),
  translate: (text: string, targetLang: string, sourceLang?: string) =>
    api
      .post('/api/ai/translate', { text, targetLang, sourceLang })
      .then((r) => r.data.translatedText as string),
  chat: (query: string, senderName?: string) =>
    api.post('/api/ai/chat', { query, senderName }).then((r) => r.data.reply as string),
  transcribe: (audio: string) =>
    api.post('/api/ai/transcribe', { audio }).then((r) => r.data.transcript as string),
};

export const notifyApi = {
  register: (platform: 'web', subscription: unknown) =>
    api.post('/api/notifications/register-token', { platform, subscription }).then((r) => r.data),
};
