import axios from 'axios';

const baseURL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export const api = axios.create({ baseURL, timeout: 15000 });

let token: string | null = null;
let refreshToken: string | null = null;

export function setTokens(t: string | null, r?: string | null) {
  token = t;
  if (r !== undefined) refreshToken = r;
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
        refreshing =
          refreshing ||
          axios
            .post(`${baseURL}/api/auth/refresh`, { refreshToken })
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
  me: () => api.get('/api/auth/me').then((r) => r.data),
  profile: (patch: { language?: string; name?: string; x25519PublicKey?: string }) =>
    api.patch('/api/auth/profile', patch).then((r) => r.data),
  publicUser: (id: string) => api.get(`/api/auth/users/${id}`).then((r) => r.data.user),
  language: (language: string) => api.patch('/api/auth/language', { language }),
};

export const chatApi = {
  conversations: () => api.get('/api/chat/conversations').then((r) => r.data.conversations),
  createConversation: (participantIds: string[], title?: string, type: 'direct' | 'group' = 'direct') =>
    api.post('/api/chat/conversations', { participantIds, title, type }).then((r) => r.data.conversation),
  messages: (id: string, limit = 50, cursor?: string | null) =>
    api
      .get(`/api/chat/messages/${id}?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
      .then((r) => r.data as { messages: unknown[]; nextCursor: string | null }),
  getKey: (id: string) => api.get(`/api/chat/conversations/${id}/key`).then((r) => r.data.envelope),
  putKey: (id: string, body: { recipientId: string; encryptedKey: string; nonce: string; senderPub: string; keyVersion?: number }) =>
    api.post(`/api/chat/conversations/${id}/key`, body).then((r) => r.data),
};

export const ghostApi = {
  createInvite: () => api.post('/api/ghost/invite').then((r) => r.data),
  joinInvite: (token: string) => api.get(`/api/ghost/join/${token}`).then((r) => r.data),
};

export const mediaApi = {
  presigned: (fileType: string, fileExtension: string) =>
    api.post('/api/media/presigned-url', { fileType, fileExtension }).then((r) => r.data),
  async upload(file: File): Promise<string> {
    const ext = file.name.includes('.') ? file.name.split('.').pop()! : 'bin';
    const { uploadUrl, mediaUrl } = await this.presigned(file.type, ext);
    await axios.put(uploadUrl, file, { headers: { 'Content-Type': file.type } });
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
};

export const notifyApi = {
  register: (platform: 'web', subscription: unknown) =>
    api.post('/api/notifications/register-token', { platform, subscription }).then((r) => r.data),
};
