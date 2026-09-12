'use client';

import { useEffect, useState } from 'react';
import { Button, Card, CardBody, Avatar, Select, SelectItem, Spinner } from '@heroui/react';
import { authApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import type { User } from '@/lib/types';

const LANGS = ['en', 'es', 'fr', 'de', 'hi', 'ar', 'pt'];

export function ProfilePanel() {
  const sessionUser = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [profile, setProfile] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [lang, setLang] = useState(sessionUser?.preferredLanguage || 'en');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authApi
      .me()
      .then((r) => {
        setProfile(r.profile);
        if (r.profile?.preferredLanguage) setLang(r.profile.preferredLanguage);
      })
      .catch(() => setError('Could not load profile from server.'))
      .finally(() => setLoading(false));
  }, []);

  const saveLang = async (v: string) => {
    setLang(v);
    setSaving(true);
    try {
      await authApi.language(v);
    } catch {
      setError('Language save failed — you may be offline.');
    } finally {
      setSaving(false);
    }
  };

  const shown: User | null = profile || sessionUser;

  return (
    <div className="flex-1 overflow-y-auto p-4 min-w-0">
      <Card className="max-w-md mx-auto bg-whatsapp-panel">
        <CardBody className="p-6 space-y-4">
          <div className="flex items-center gap-4">
            <Avatar name={shown?.name || shown?.username} size="lg" />
            <div className="min-w-0">
              <b className="block truncate">{shown?.name || shown?.username || '—'}</b>
              <span className="block truncate text-xs text-whatsapp-checkGray">{shown?.email}</span>
              <span className="block truncate text-[11px] text-whatsapp-checkGray">id: {shown?.userId}</span>
            </div>
          </div>

          {loading && <Spinner size="sm" />}
          {error && <p className="text-xs text-danger">{error}</p>}

          <div>
            <p className="text-xs text-whatsapp-checkGray mb-1">Translation language</p>
            <Select
              aria-label="Language"
              selectedKeys={[lang]}
              isDisabled={saving}
              onSelectionChange={(k) => saveLang(Array.from(k)[0] as string)}
            >
              {LANGS.map((l) => (
                <SelectItem key={l}>{l}</SelectItem>
              ))}
            </Select>
          </div>

          <div className="text-[11px] text-whatsapp-checkGray bg-whatsapp-composer rounded-xl p-3 leading-5">
            🔒 Your per-chat encryption keys never leave this browser. Share a chat key from the
            🔑 button inside any conversation so your other devices can decrypt history.
          </div>

          <Button color="danger" variant="flat" className="w-full" onPress={logout}>
            Logout
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}
