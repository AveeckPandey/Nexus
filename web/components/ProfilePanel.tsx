'use client';

import { useEffect, useState, useRef } from 'react';
import QRCode from 'react-qr-code';
import { Button, Avatar, Select, SelectItem, Spinner } from '@heroui/react';
import { authApi, mediaApi } from '@/lib/api';
import { buildPersonalInviteLink, copyText, sharePersonalInvite } from '@/lib/invite';
import { useAuthStore } from '@/store/auth';
import { BackIcon, CameraIcon, PencilIcon, CopyIcon, LockIcon, SmileIcon } from './MenuIcons';
import type { User } from '@/lib/types';

const LANGS = ['en', 'es', 'fr', 'de', 'hi', 'ar', 'pt'];
const DEFAULT_ABOUT = "What's happening?";

/** WhatsApp-style Edit profile: photo, About, Name, Username (no phone number). */
export function ProfilePanel({ onBack }: { onBack?: () => void }) {
  const sessionUser = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [profile, setProfile] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [lang, setLang] = useState(sessionUser?.preferredLanguage || 'en');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Avatar upload state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarMsg, setAvatarMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Inline editors (About / Name / Username)
  const [about, setAbout] = useState(sessionUser?.about || '');
  const [aboutEdit, setAboutEdit] = useState(false);
  const [aboutSaving, setAboutSaving] = useState(false);
  const [name, setName] = useState(sessionUser?.name || '');
  const [nameEdit, setNameEdit] = useState(false);
  const [nameSaving, setNameSaving] = useState(false);
  const [username, setUsername] = useState(sessionUser?.username || '');
  const [unameEdit, setUnameEdit] = useState(false);
  const [unameSaving, setUnameSaving] = useState(false);
  const [unameMsg, setUnameMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [shareMsg, setShareMsg] = useState<string | null>(null);

  useEffect(() => {
    authApi
      .me()
      .then((r) => {
        setProfile(r.profile);
        if (r.profile?.preferredLanguage) setLang(r.profile.preferredLanguage);
        if (r.profile?.username) setUsername(r.profile.username);
        if (r.profile?.name) setName(r.profile.name);
        if (r.profile?.about !== undefined) setAbout(r.profile.about);
      })
      .catch(() => setError('Could not load profile from server.'))
      .finally(() => setLoading(false));
  }, []);

  const patchSession = (patch: Partial<User>) => {
    if (profile) setProfile({ ...profile, ...patch });
    const current = useAuthStore.getState().user;
    if (current) {
      const updated = { ...current, ...patch };
      useAuthStore.setState({ user: updated });
      try {
        localStorage.setItem('nexus_user', JSON.stringify(updated));
      } catch {
        /* private mode */
      }
    }
  };

  const handleAvatarFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAvatarMsg(null);
    if (!file.type.startsWith('image/')) {
      setAvatarMsg({ type: 'error', text: 'Please select a valid image file (PNG, JPG, WEBP, GIF).' });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setAvatarMsg({ type: 'error', text: 'Image size must be under 5MB.' });
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    setAvatarPreview(previewUrl);
    setAvatarUploading(true);

    try {
      const uploadedUrl = await mediaApi.upload(file);
      await authApi.profile({ avatarUrl: uploadedUrl });
      patchSession({ avatarUrl: uploadedUrl });
      setAvatarMsg({ type: 'success', text: 'Profile picture updated!' });
      setTimeout(() => setAvatarMsg(null), 4000);
    } catch (err: any) {
      setAvatarPreview(null);
      setAvatarMsg({
        type: 'error',
        text: err?.response?.data?.message || 'Failed to upload profile picture. Please try again.',
      });
    } finally {
      setAvatarUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

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

  const saveAbout = async () => {
    const clean = about.trim().slice(0, 140);
    setAboutSaving(true);
    try {
      await authApi.profile({ about: clean });
      setAbout(clean);
      patchSession({ about: clean });
      setAboutEdit(false);
    } catch {
      setAvatarMsg({ type: 'error', text: 'Could not save About.' });
    } finally {
      setAboutSaving(false);
    }
  };

  const saveName = async () => {
    const clean = name.trim().slice(0, 80);
    if (!clean) return;
    setNameSaving(true);
    try {
      await authApi.profile({ name: clean });
      setName(clean);
      patchSession({ name: clean });
      setNameEdit(false);
    } catch {
      setAvatarMsg({ type: 'error', text: 'Could not save name.' });
    } finally {
      setNameSaving(false);
    }
  };

  const saveUsername = async () => {
    const clean = username.trim().toLowerCase().replace(/^@+/, '');
    setUnameMsg(null);
    if (!/^[a-z0-9_]{3,20}$/.test(clean)) {
      setUnameMsg('3–20 chars: lowercase letters, numbers, underscore.');
      return;
    }
    setUnameSaving(true);
    try {
      await authApi.claimUsername(clean);
      setUsername(clean);
      patchSession({ username: clean });
      setUnameEdit(false);
      setUnameMsg(`Saved — friends can find you as @${clean}.`);
    } catch (e: any) {
      setUnameMsg(e?.response?.data?.message || 'Could not save username.');
    } finally {
      setUnameSaving(false);
    }
  };

  const copyField = async (label: string, value: string) => {
    setCopied((await copyText(value)) ? label : null);
    setTimeout(() => setCopied(null), 2000);
  };

  const shown: User | null = profile || sessionUser;
  const currentAvatar = avatarPreview || shown?.avatarUrl;
  const handle = (shown?.username || '').replace(/^@+/, '');
  const inviteLink = handle ? buildPersonalInviteLink(handle) : '';

  const share = async () => {
    if (!inviteLink) return;
    const outcome = await sharePersonalInvite({ url: inviteLink, username: handle, name: shown?.name });
    setShareMsg(
      outcome === 'shared'
        ? 'Share sheet opened.'
        : outcome === 'copied'
          ? 'Invite link copied.'
          : 'Sharing failed — copy the link manually.',
    );
  };

  const copy = async () => {
    if (!inviteLink) return;
    setShareMsg((await copyText(inviteLink)) ? 'Invite link copied.' : 'Copy failed.');
  };

  const rowLabel = 'text-[13px] text-[#8A8F98] px-6 pt-5 pb-1';

  return (
    <div className="flex-1 overflow-y-auto min-w-0 bg-[#E0E5EC] text-[#2F343D]">
      <div className="max-w-md mx-auto pb-8">
        {/* Header */}
        <div className="flex items-center gap-4 px-4 py-3 sticky top-0 bg-[#E0E5EC]/95 backdrop-blur z-10 border-b border-[#b8bcc9]/50">
          {onBack && (
            <button
              onClick={onBack}
              aria-label="Back to chats"
              className="p-1.5 -ml-1.5 rounded-full text-[#2F343D] hover:text-[#CC5500] bg-[#E9EDF3] shadow-[6px_6px_12px_#b8bcc9,-6px_-6px_12px_#ffffff] border border-white/60 transition"
            >
              <BackIcon />
            </button>
          )}
          <h1 className="text-[15px] font-semibold text-[#2F343D]">Edit profile</h1>
        </div>

        {/* Photo */}
        <div className="flex justify-center py-6">
          <div className="relative">
            <button
              onClick={() => fileInputRef.current?.click()}
              title="Change profile picture"
              className="block w-44 h-44 rounded-full overflow-hidden bg-[#E9EDF3] shadow-[6px_6px_12px_#b8bcc9,-6px_-6px_12px_#ffffff] border-4 border-[#E9EDF3] hover:brightness-105 transition"
            >
              {currentAvatar ? (
                <img src={currentAvatar} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <span className="w-full h-full flex items-center justify-center text-[#8A8F98]">
                  <CameraIcon />
                </span>
              )}
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              aria-label="Change profile picture"
              title="Change profile picture"
              className="absolute bottom-1 right-1 w-11 h-11 rounded-full bg-[#CC5500] hover:bg-[#B34A00] text-white flex items-center justify-center shadow-[6px_6px_12px_#b8bcc9,-6px_-6px_12px_#ffffff] border border-white/40 transition"
            >
              {avatarUploading ? <Spinner size="sm" color="default" /> : <CameraIcon />}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={handleAvatarFile}
            />
          </div>
        </div>
        {avatarMsg && (
          <p className={`text-xs text-center px-6 pb-2 ${avatarMsg.type === 'success' ? 'text-[#CC5500]' : 'text-danger'}`}>
            {avatarMsg.text}
          </p>
        )}

        {/* About */}
        <p className={rowLabel}>About</p>
        <div className="mx-4 rounded-xl bg-[#E0E5EC] shadow-[inset_4px_4px_8px_#b8bcc9,inset_-4px_-4px_8px_#ffffff] border border-white/50 px-6 py-3.5 flex items-center gap-3">
          {aboutEdit ? (
            <span className="flex-1 flex items-center gap-2">
              <input
                autoFocus
                value={about}
                maxLength={140}
                onChange={(e) => setAbout(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveAbout();
                  if (e.key === 'Escape') {
                    setAbout(shown?.about || '');
                    setAboutEdit(false);
                  }
                }}
                placeholder={DEFAULT_ABOUT}
                className="flex-1 bg-transparent outline-none text-[15px] text-[#2F343D] placeholder:text-[#8A8F98] border-b border-[#CC5500]/50 pb-1"
              />
              <button
                onClick={saveAbout}
                disabled={aboutSaving}
                className="text-[#CC5500] hover:text-[#B34A00] text-sm font-medium disabled:opacity-50"
              >
                Save
              </button>
            </span>
          ) : (
            <>
              <span className="text-[#8A8F98] flex items-center"><SmileIcon size={18} /></span>
              <span className="flex-1 text-[15px] text-[#2F343D]">{shown?.about || DEFAULT_ABOUT}</span>
              <button
                onClick={() => {
                  setAbout(shown?.about || '');
                  setAboutEdit(true);
                }}
                aria-label="Edit about"
                className="p-1.5 rounded-full text-[#8A8F98] hover:text-[#CC5500] hover:bg-[#E9EDF3] transition"
              >
                <PencilIcon />
              </button>
            </>
          )}
        </div>

        {/* Name */}
        <p className={rowLabel}>Name</p>
        <div className="mx-4 rounded-xl bg-[#E0E5EC] shadow-[inset_4px_4px_8px_#b8bcc9,inset_-4px_-4px_8px_#ffffff] border border-white/50 px-6 py-3.5 flex items-center gap-3">
          {nameEdit ? (
            <span className="flex-1 flex items-center gap-2">
              <input
                autoFocus
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveName();
                  if (e.key === 'Escape') {
                    setName(shown?.name || '');
                    setNameEdit(false);
                  }
                }}
                placeholder="Your name"
                className="flex-1 bg-transparent outline-none text-[15px] text-[#2F343D] placeholder:text-[#8A8F98] border-b border-[#CC5500]/50 pb-1"
              />
              <button
                onClick={saveName}
                disabled={nameSaving || !name.trim()}
                className="text-[#CC5500] hover:text-[#B34A00] text-sm font-medium disabled:opacity-50"
              >
                Save
              </button>
            </span>
          ) : (
            <>
              <span className="flex-1 text-[15px] text-[#2F343D]">{shown?.name || shown?.username || '—'}</span>
              <button
                onClick={() => {
                  setName(shown?.name || '');
                  setNameEdit(true);
                }}
                aria-label="Edit name"
                className="p-1.5 rounded-full text-[#8A8F98] hover:text-[#CC5500] hover:bg-[#E9EDF3] transition"
              >
                <PencilIcon />
              </button>
            </>
          )}
        </div>

        {/* Username — our identity instead of a phone number */}
        <p className={rowLabel}>Username</p>
        <div className="mx-4 rounded-xl bg-[#E0E5EC] shadow-[inset_4px_4px_8px_#b8bcc9,inset_-4px_-4px_8px_#ffffff] border border-white/50 px-6 py-3.5 flex items-center gap-3">
          {unameEdit ? (
            <span className="flex-1 flex items-center gap-2">
              <span className="text-[#8A8F98]">@</span>
              <input
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveUsername();
                  if (e.key === 'Escape') {
                    setUsername(shown?.username || '');
                    setUnameEdit(false);
                  }
                }}
                placeholder="aveeck"
                className="flex-1 bg-transparent outline-none text-[15px] text-[#2F343D] placeholder:text-[#8A8F98] border-b border-[#CC5500]/50 pb-1"
              />
              <button
                onClick={saveUsername}
                disabled={unameSaving}
                className="text-[#CC5500] hover:text-[#B34A00] text-sm font-medium disabled:opacity-50"
              >
                Save
              </button>
            </span>
          ) : (
            <>
              <span className="flex-1 text-[15px] text-[#2F343D]">@{handle || '—'}</span>
              <button
                onClick={() => handle && copyField('username', `@${handle}`)}
                aria-label="Copy username"
                title={copied === 'username' ? 'Copied!' : 'Copy username'}
                className="p-1.5 rounded-full text-[#8A8F98] hover:text-[#CC5500] hover:bg-[#E9EDF3] transition"
              >
                <CopyIcon />
              </button>
              <button
                onClick={() => {
                  setUsername(shown?.username || '');
                  setUnameMsg(null);
                  setUnameEdit(true);
                }}
                aria-label="Edit username"
                className="p-1.5 rounded-full text-[#8A8F98] hover:text-[#CC5500] hover:bg-[#E9EDF3] transition"
              >
                <PencilIcon />
              </button>
            </>
          )}
        </div>
        {unameMsg && <p className="text-[11px] text-[#8A8F98] px-6 pt-1">{unameMsg}</p>}

        {/* Email */}
        <p className={rowLabel}>Email</p>
        <div className="mx-4 rounded-xl bg-[#E0E5EC] shadow-[inset_4px_4px_8px_#b8bcc9,inset_-4px_-4px_8px_#ffffff] border border-white/50 px-6 py-3.5 flex items-center gap-3">
          <span className="flex-1 truncate text-[15px] text-[#2F343D]">{shown?.email || '—'}</span>
          {shown?.email && (
            <button
              onClick={() => copyField('email', shown.email)}
              aria-label="Copy email"
              title={copied === 'email' ? 'Copied!' : 'Copy email'}
              className="p-1.5 rounded-full text-[#8A8F98] hover:text-[#CC5500] hover:bg-[#E9EDF3] transition"
            >
              <CopyIcon />
            </button>
          )}
        </div>

        {loading && (
          <div className="flex justify-center py-4">
            <Spinner size="sm" />
          </div>
        )}
        {error && <p className="text-xs text-danger px-6 pt-2">{error}</p>}

        {/* Invite card */}
        {inviteLink && (
          <div className="mx-4 mt-6 space-y-2 rounded-xl border border-white/60 p-3 bg-[#E9EDF3] shadow-[6px_6px_12px_#b8bcc9,-6px_-6px_12px_#ffffff]">
            <p className="text-xs text-[#8A8F98]">Personal invite link — no phone number needed</p>
            <p className="text-xs break-all text-[#CC5500] font-mono bg-[#E0E5EC] shadow-[inset_4px_4px_8px_#b8bcc9,inset_-4px_-4px_8px_#ffffff] border border-white/50 rounded-lg p-2">{inviteLink}</p>
            <div className="flex gap-2">
              <Button size="sm" className="flex-1 bg-[#CC5500] text-white hover:bg-[#B34A00] font-semibold shadow-[6px_6px_12px_#b8bcc9,-6px_-6px_12px_#ffffff]" onPress={share}>
                Share…
              </Button>
              <Button size="sm" variant="flat" className="flex-1 bg-[#E9EDF3] text-[#2F343D] shadow-[6px_6px_12px_#b8bcc9,-6px_-6px_12px_#ffffff] border border-white/60" onPress={copy}>
                Copy
              </Button>
            </div>
            <div className="flex items-center gap-3 pt-1">
              <span className="bg-white p-2 rounded-xl shrink-0 shadow-[6px_6px_12px_#b8bcc9,-6px_-6px_12px_#ffffff] border border-white/60">
                <QRCode value={inviteLink} size={96} />
              </span>
              <p className="text-[11px] leading-5 text-[#8A8F98]">
                In-person invites: your friend scans this QR with any phone camera and
                lands in an encrypted chat with you — no download, no phonebook.
              </p>
            </div>
            {shareMsg && <p className="text-[11px] text-[#CC5500]">{shareMsg}</p>}
          </div>
        )}

        {/* Language */}
        <div className="mx-4 mt-4">
          <p className="text-xs text-[#8A8F98] mb-1 px-1">Translation language</p>
          <Select
            aria-label="Language"
            selectedKeys={[lang]}
            isDisabled={saving}
            onSelectionChange={(k) => saveLang(Array.from(k)[0] as string)}
            classNames={{ trigger: "bg-[#E9EDF3] shadow-[6px_6px_12px_#b8bcc9,-6px_-6px_12px_#ffffff] border border-white/60 text-[#2F343D]", value: "text-[#2F343D]" }}
          >
            {LANGS.map((l) => (
              <SelectItem key={l}>{l}</SelectItem>
            ))}
          </Select>
        </div>

        <div className="mx-4 mt-4 text-[11px] text-[#8A8F98] bg-[#E9EDF3] shadow-[6px_6px_12px_#b8bcc9,-6px_-6px_12px_#ffffff] border border-white/60 rounded-xl p-3 leading-5 flex gap-1.5">
          <span className="shrink-0 mt-0.5 flex items-center text-[#CC5500]"><LockIcon size={11} /></span>
          <span>
            Your per-chat encryption keys never leave this browser. Share a chat key from the
            key button inside any conversation so your other devices can decrypt history.
          </span>
        </div>

        <div className="mx-4 mt-4">
          <Button variant="flat" className="w-full bg-[#E9EDF3] text-[#2F343D] shadow-[6px_6px_12px_#b8bcc9,-6px_-6px_12px_#ffffff] border border-white/60 font-semibold" onPress={logout}>
            Logout
          </Button>
        </div>
      </div>
    </div>
  );
}

