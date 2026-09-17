'use client';

import { useMemo, useState } from 'react';
import { authApi } from '@/lib/api';
import { ensureIdentityPublished } from '@/lib/keyx';
import { useAuthStore } from '@/store/auth';
import TextType from './TextType';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* palette: base grey #E0E5EC · ink #2F343D · muted #8A8F98 · accent burnt-orange #CC5500 */

function strength(pw: string): { label: string; pct: number; level: number } {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  if (s <= 2) return { label: 'Weak', pct: 28, level: 1 };
  if (s === 3) return { label: 'Fair', pct: 52, level: 2 };
  if (s === 4) return { label: 'Strong', pct: 78, level: 4 };
  return { label: 'Excellent', pct: 100, level: 5 };
}

function friendly(err: any, fallback: string): string {
  const raw: string = err?.response?.data?.message || err?.message || fallback;
  if (/not verified|UserNotConfirmed/i.test(raw)) return 'Email not verified yet — enter the code we sent you.';
  if (/UserNotFound/i.test(raw)) return 'No account for this email. Try creating one.';
  if (/NotAuthorized|Incorrect username/i.test(raw)) return 'Incorrect email or password.';
  if (/UsernameExists/i.test(raw)) return 'Account exists already — sign in instead.';
  if (/InvalidPassword|policy/i.test(raw)) return 'Password needs 8+ chars, upper/lowercase, number and symbol.';
  if (/CodeMismatch/i.test(raw)) return 'Wrong code — check your email and retry.';
  if (/ExpiredCode/i.test(raw)) return 'Code expired — tap Resend for a fresh one.';
  return raw;
}

function NexusMark() {
  return (
    <span className="inline-flex items-center gap-2.5 select-none">
      <span className="grid place-items-center w-9 h-9 rounded-xl bg-[#E0E5EC] shadow-[5px_5px_10px_#b8bcc9,-5px_-5px_10px_#ffffff] overflow-hidden">
        <span className="grid place-items-center w-7 h-7 rounded-lg bg-white shadow-[inset_2px_2px_5px_#d1d5db,inset_-2px_-2px_5px_#ffffff] overflow-hidden">
          <img src="/nexus-alien.png" alt="Nexus" className="w-5 h-5 object-contain" />
        </span>
      </span>
      <span className="leading-none">
        <span className="block text-[18px] font-extrabold tracking-tight text-[#2F343D]">Nexus</span>
        <span className="mt-0.5 inline-block font-mono text-[9px] font-bold tracking-[0.18em] text-[#CC5500]">
          ENCRYPTED CHAT
        </span>
      </span>
    </span>
  );
}

function FeatureRow({
  title,
  sub,
  icon,
}: {
  title: string;
  sub: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 bg-[#E0E5EC] rounded-xl p-2.5 shadow-[5px_5px_10px_#b8bcc9,-5px_-5px_10px_#ffffff]">
      <span className="grid place-items-center w-9 h-9 shrink-0 rounded-full bg-[#E0E5EC] shadow-[inset_3px_3px_6px_#b8bcc9,inset_-3px_-3px_6px_#ffffff] text-[#CC5500]">
        {icon}
      </span>
      <span>
        <span className="block text-[12.5px] font-extrabold tracking-tight text-[#2F343D] leading-tight">{title}</span>
        <span className="block text-[11px] font-medium text-[#8A8F98]">{sub}</span>
      </span>
    </div>
  );
}

const labelCls = 'block text-[10px] font-bold uppercase tracking-[0.14em] text-[#8A8F98]';
const inputCls =
  'w-full bg-[#E0E5EC] rounded-xl px-4 py-2.5 text-[13.5px] font-semibold text-[#2F343D] placeholder:text-[#9AA0AE] placeholder:font-medium shadow-[inset_4px_4px_8px_#b8bcc9,inset_-4px_-4px_8px_#ffffff] outline-none focus:ring-2 focus:ring-[#CC5500]/50 transition';
const primaryBtn =
  'w-full bg-[#CC5500] rounded-xl px-4 py-2.5 font-bold text-[14px] text-white tracking-tight shadow-[6px_6px_12px_#b8bcc9,-6px_-6px_12px_#ffffff] hover:bg-[#B34A00] active:shadow-[inset_5px_5px_10px_rgba(0,0,0,0.35),inset_-3px_-3px_8px_rgba(255,255,255,0.25)] active:translate-y-[1px] disabled:opacity-50 disabled:pointer-events-none transition-all';
const ghostBtn =
  'w-full bg-[#E0E5EC] rounded-xl px-4 py-2.5 font-bold text-[13px] text-[#2F343D] shadow-[5px_5px_10px_#b8bcc9,-5px_-5px_10px_#ffffff] hover:shadow-[3px_3px_8px_#b8bcc9,-3px_-3px_8px_#ffffff] active:shadow-[inset_5px_5px_10px_#b8bcc9,inset_-5px_-5px_10px_#ffffff] disabled:opacity-50 disabled:pointer-events-none transition-all flex items-center justify-center gap-2.5';

export function AuthForm() {
  const login = useAuthStore((s) => s.login);
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [verify, setVerify] = useState(false);
  const [stage, setStage] = useState<'auth' | 'forgot' | 'reset'>('auth');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNew, setConfirmNew] = useState('');
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const pw = useMemo(() => strength(password), [password]);
  const newPw = useMemo(() => strength(newPassword), [newPassword]);
  const isLogin = mode === 'login' && !verify;

  const switchMode = (m: 'login' | 'signup') => {
    setError(null);
    setStatus(null);
    setVerify(false);
    setStage('auth');
    setNewPassword('');
    setConfirmNew('');
    setMode(m);
  };

  const backToLogin = () => {
    setError(null);
    setStatus(null);
    setVerify(false);
    setStage('auth');
    setCode('');
    setNewPassword('');
    setConfirmNew('');
    setMode('login');
  };

  const submit = async () => {
    setError(null);
    setStatus(null);
    const clean = email.trim().toLowerCase();
    if (!clean) {
      setError('Please enter your email address.');
      return;
    }
    if (!EMAIL_RE.test(clean)) {
      setError('Please enter a valid email address.');
      return;
    }
    if (!password) {
      setError('Please enter a password.');
      return;
    }
    if (mode === 'signup') {
      if (password.length < 8) {
        setError('Password must be at least 8 characters long.');
        return;
      }
      if (password !== confirm) {
        setError('Passwords do not match. Please re-enter.');
        return;
      }
    }
    setBusy(true);
    try {
      if (mode === 'login') {
        const r = await authApi.login(clean, password);
        login(r.user, r.idToken, r.refreshToken);
        if (!remember) {
          try {
            sessionStorage.setItem('nexus_session_only', '1');
          } catch { /* ignore */ }
        }
        ensureIdentityPublished().catch(() => {});
      } else {
        const r = await authApi.signup(clean, password, name.trim() || undefined);
        if (r.isConfirmed) {
          const l = await authApi.login(clean, password);
          login(l.user, l.idToken, l.refreshToken);
          ensureIdentityPublished().catch(() => {});
        } else {
          setStatus(r.message || 'Verification code sent to your email.');
          setVerify(true);
        }
      }
    } catch (e: any) {
      const msg = friendly(e, 'Authentication failed');
      if (/not verified/i.test(msg)) setVerify(true);
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const confirmCode = async () => {
    setError(null);
    setBusy(true);
    try {
      const r = await authApi.confirm(email.trim().toLowerCase(), code.trim());
      setStatus(r.message || 'Verified! Please sign in.');
      setVerify(false);
      setMode('login');
      setCode('');
    } catch (e: any) {
      setError(friendly(e, 'Invalid code'));
    } finally {
      setBusy(false);
    }
  };

  const googleCredential = async (credential: string) => {
    setError(null);
    setBusy(true);
    try {
      const r = await authApi.google(credential);
      login(r.user, r.idToken);
      ensureIdentityPublished().catch(() => {});
    } catch (e: any) {
      setError(friendly(e, 'Google sign-in failed'));
    } finally {
      setBusy(false);
    }
  };
  void googleCredential;

  const sendResetCode = async () => {
    const clean = email.trim().toLowerCase();
    if (!EMAIL_RE.test(clean)) {
      setError('Enter the email address of your account first.');
      return;
    }
    setError(null);
    setStatus(null);
    setBusy(true);
    try {
      const r = await authApi.forgotPassword(clean);
      setStatus(r.message || 'If an account exists for this email, a reset code was sent.');
      setStage('reset');
    } catch (e: any) {
      setError(friendly(e, 'Could not send reset code'));
    } finally {
      setBusy(false);
    }
  };

  const confirmReset = async () => {
    const clean = email.trim().toLowerCase();
    if (!EMAIL_RE.test(clean)) {
      setError('Enter the email address of your account first.');
      return;
    }
    if (!code.trim()) {
      setError('Enter the reset code from your email.');
      return;
    }
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters long.');
      return;
    }
    if (newPassword !== confirmNew) {
      setError('New passwords do not match. Please re-enter.');
      return;
    }
    setError(null);
    setStatus(null);
    setBusy(true);
    try {
      const r = await authApi.resetPassword(clean, code.trim(), newPassword);
      setStatus(r.message || 'Password updated. Please sign in.');
      setCode('');
      setNewPassword('');
      setConfirmNew('');
      setPassword('');
      setStage('auth');
      setMode('login');
    } catch (e: any) {
      setError(friendly(e, 'Password reset failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="auth-form"
      className="h-[100dvh] w-full relative bg-[#E0E5EC] text-[#2F343D] flex flex-col items-center justify-center px-4 py-3 overflow-hidden"
    >
      {/* top bar */}
      <header className="relative z-10 w-full max-w-[1024px] shrink-0 flex items-center justify-between gap-3">
        <NexusMark />
        <div className="flex items-center gap-2">
          <span className="hidden sm:inline-flex items-center text-[10px] font-bold tracking-wide bg-[#E0E5EC] text-[#2F343D] rounded-full px-3 py-1.5 shadow-[4px_4px_8px_#b8bcc9,-4px_-4px_8px_#ffffff]">
            E2EE LIVE
          </span>
          <span className="text-[10px] font-bold tracking-wide bg-[#E0E5EC] text-[#8A8F98] rounded-full px-3 py-1.5 shadow-[4px_4px_8px_#b8bcc9,-4px_-4px_8px_#ffffff]">
            NO TRACKING
          </span>
        </div>
      </header>

      {/* card — fixed to viewport, no page scroll */}
      <div className="relative z-10 w-full max-w-[1024px] mt-3 flex-1 min-h-0 grid lg:grid-cols-[1.02fr_0.98fr] bg-[#E0E5EC] rounded-[24px] shadow-[16px_16px_40px_#babecc,-16px_-16px_40px_#ffffff] overflow-hidden">
        {/* LEFT */}
        <div className="hidden md:flex p-5 sm:p-6 flex-col min-h-0 overflow-hidden">
          <span className="inline-flex w-fit items-center text-[10px] font-bold tracking-[0.16em] text-[#CC5500] bg-[#E0E5EC] rounded-full px-3 py-1.5 shadow-[inset_3px_3px_6px_#b8bcc9,inset_-3px_-3px_6px_#ffffff]">
            100% ENCRYPTED
          </span>

          <h1 className="mt-3 text-[30px] xl:text-[36px] leading-[1.02] font-extrabold tracking-tight text-[#2F343D]">
            Private
            <br />
            <span className="text-[#CC5500]">conversations</span>
            <br />
            for a better you
          </h1>

          <p className="mt-2.5 max-w-[360px] text-[13px] leading-5 font-medium text-[#6B7280]">
            End-to-end encrypted messaging, self-destructing ghost chats, and HD video calls all in your
            browser.
          </p>

          <div className="mt-4 space-y-2.5">
            <FeatureRow
              title="XSALSA20-POLY1305"
              sub="End-to-end encryption"
              icon={
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <rect x="5" y="10" width="14" height="10" rx="2.5" stroke="currentColor" strokeWidth="2" />
                  <path d="M8 10V7.5a4 4 0 0 1 8 0V10" stroke="currentColor" strokeWidth="2" />
                  <circle cx="12" cy="15" r="1.6" fill="currentColor" />
                </svg>
              }
            />
            <FeatureRow
              title="ZERO-TRACE"
              sub="30s ghost chats"
              icon={
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M12 3C7.5 3 4 6.6 4 11v8.2c0 .7.8 1.2 1.45.85L7.4 18.8c.35-.2.8-.1 1 .2l.7 1c.3.45.95.45 1.25 0l.65-.95c.2-.3.65-.4 1-.2l.6.35c.35.2.8.1 1-.25l.55-.8c.2-.3.65-.4.95-.2l1.7 1c.65.35 1.45-.1 1.45-.85V11c0-4.4-3.5-8-8.25-8Z"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinejoin="round"
                  />
                  <circle cx="9.5" cy="11" r="1.1" fill="currentColor" />
                  <circle cx="14.5" cy="11" r="1.1" fill="currentColor" />
                </svg>
              }
            />
            <FeatureRow
              title="P2P WEBRTC"
              sub="HD video calling"
              icon={
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <rect x="2.5" y="7" width="12" height="10" rx="2.5" stroke="currentColor" strokeWidth="2" />
                  <path d="M15.5 10.5 21 7.8c.6-.25 1.2.2 1.2.85v6.7c0 .65-.6 1.1-1.2.85l-5.5-2.7v-3Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                </svg>
              }
            />
          </div>

          <div className="mt-4 rounded-xl bg-[#E0E5EC] p-3 shadow-[inset_4px_4px_8px_#b8bcc9,inset_-4px_-4px_8px_#ffffff]">
            <p className="font-mono text-[11px] font-bold text-[#6B7280]">
              <span className="text-[#CC5500]">$</span>{' '}
              <TextType
                as="span"
                text={['more_privacy --more_you', 'zero_trace --ghost_mode', 'e2ee --always_on']}
                typingSpeed={75}
                pauseDuration={1500}
                deletingSpeed={30}
                showCursor
                cursorCharacter="▌"
                cursorClassName="text-[#CC5500]"
              />
            </p>
          </div>
        </div>

        {/* RIGHT */}
        <div className="p-2.5 sm:p-3 lg:pl-0 min-h-0 flex">
          <div className="flex-1 min-h-0 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden bg-[#E0E5EC] lg:bg-[#E9EDF3] rounded-[18px] p-5 sm:p-5 flex flex-col shadow-none lg:shadow-[inset_8px_8px_16px_#c3c7d4,inset_-8px_-8px_16px_#ffffff]">
            <div className="flex items-center justify-between gap-3">
              {verify || stage !== 'auth' ? (
                <span className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-[#2F343D] bg-[#E0E5EC] px-4 py-2 rounded-full shadow-[4px_4px_8px_#b8bcc9,-4px_-4px_8px_#ffffff]">
                  {verify ? '// verify' : stage === 'forgot' ? '// forgot' : '// reset'}
                </span>
              ) : (
                <div className="flex bg-[#E0E5EC] rounded-full p-1.5 shadow-[inset_4px_4px_8px_#b8bcc9,inset_-4px_-4px_8px_#ffffff]">
                  {(['login', 'signup'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => switchMode(m)}
                      className={`px-5 py-2 rounded-full text-[12px] font-bold uppercase tracking-wide transition-all ${
                        mode === m && !verify
                          ? 'bg-[#CC5500] text-white shadow-[4px_4px_8px_#b8bcc9]'
                          : 'text-[#8A8F98] hover:text-[#2F343D]'
                      }`}
                    >
                      {m === 'login' ? 'Log in' : 'Sign up'}
                    </button>
                  ))}
                </div>
              )}
              <button
                onClick={() => ((verify || stage !== 'auth') ? backToLogin() : switchMode(isLogin ? 'signup' : 'login'))}
                className="shrink-0 rounded-full bg-[#E0E5EC] px-4 py-2 font-bold text-[13px] text-[#2F343D] shadow-[4px_4px_8px_#b8bcc9,-4px_-4px_8px_#ffffff] hover:text-[#CC5500] active:shadow-[inset_4px_4px_8px_#b8bcc9,inset_-4px_-4px_8px_#ffffff] transition-all"
              >
                {(verify || stage !== 'auth') ? '← Back' : isLogin ? 'Create account' : 'Sign in'}
              </button>
            </div>

            <div className="mt-3 flex-1">
              {verify ? (
                <>
                  <h2 className="text-[22px] font-extrabold tracking-tight text-[#2F343D]">Check your email</h2>
                  <p className="mt-1 text-[12.5px] font-medium text-[#8A8F98]">
                    6-digit code sent to <span className="font-bold text-[#CC5500]">{email || 'your inbox'}</span>
                  </p>

                  {error && <div className="mt-2.5 text-[12.5px] font-semibold leading-5 text-[#8A2E00] bg-white/70 rounded-xl px-3 py-2.5 shadow-[5px_5px_10px_#b8bcc9,-5px_-5px_10px_#ffffff] border-l-4 border-[#CC5500]">{error}</div>}
                  {status && <div className="mt-2.5 text-[12.5px] font-semibold leading-5 text-[#2F343D] bg-white/70 rounded-xl px-3 py-2.5 shadow-[5px_5px_10px_#b8bcc9,-5px_-5px_10px_#ffffff] border-l-4 border-[#CC5500]">{status}</div>}

                  <label className={`${labelCls} mt-3`}>Verification code</label>
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="0 0 0 0 0 0"
                    className={`${inputCls} mt-1.5 text-center !text-[18px] !font-extrabold !tracking-[0.5em]`}
                  />
                  <button onClick={confirmCode} disabled={busy || code.length !== 6} className={`${primaryBtn} mt-3`}>
                    {busy ? 'Verifying…' : 'Confirm & verify →'}
                  </button>
                  <div className="mt-3 flex items-center justify-between text-[12.5px] font-bold">
                    <button
                      className="text-[#CC5500] hover:text-[#A34400] transition-colors"
                      onClick={() => authApi.resend(email.trim().toLowerCase()).then(() => setStatus('Fresh code sent.')).catch((e) => setError(friendly(e, 'Resend failed')))}
                    >
                      Resend code
                    </button>
                    <button className="text-[#8A8F98] hover:text-[#2F343D] transition-colors" onClick={() => setVerify(false)}>Back</button>
                  </div>
                </>
              ) : stage === 'forgot' ? (
                <>
                  <h2 className="text-[22px] font-extrabold tracking-tight text-[#2F343D]">Reset password</h2>
                  <p className="mt-1 text-[12.5px] font-medium text-[#8A8F98]">Enter your account email — we&apos;ll send a reset code.</p>

                  {error && <div className="mt-2.5 text-[12.5px] font-semibold leading-5 text-[#8A2E00] bg-white/70 rounded-xl px-3 py-2.5 shadow-[5px_5px_10px_#b8bcc9,-5px_-5px_10px_#ffffff] border-l-4 border-[#CC5500]">{error}</div>}
                  {status && <div className="mt-2.5 text-[12.5px] font-semibold leading-5 text-[#2F343D] bg-white/70 rounded-xl px-3 py-2.5 shadow-[5px_5px_10px_#b8bcc9,-5px_-5px_10px_#ffffff] border-l-4 border-[#CC5500]">{status}</div>}

                  <label className={`${labelCls} mt-3`}>Email address</label>
                  <div className="relative mt-1.5">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9AA0AE]">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.8"/><path d="m4 7 8 6 8-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </span>
                    <input
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@domain.com"
                      type="email"
                      autoComplete="email"
                      onKeyDown={(e) => { if (e.key === 'Enter' && !busy) sendResetCode(); }}
                      className={`${inputCls} !pl-11`}
                    />
                  </div>
                  <button onClick={sendResetCode} disabled={busy} className={`${primaryBtn} mt-3`}>
                    {busy ? 'Sending…' : 'Send reset code →'}
                  </button>
                  <div className="mt-4 text-center text-[13px] font-bold">
                    <button className="text-[#8A8F98] hover:text-[#CC5500] transition-colors" onClick={backToLogin}>Back to sign in</button>
                  </div>
                </>
              ) : stage === 'reset' ? (
                <>
                  <h2 className="text-[22px] font-extrabold tracking-tight text-[#2F343D]">New password</h2>
                  <p className="mt-1 text-[12.5px] font-medium text-[#8A8F98]">
                    Code sent to <span className="font-bold text-[#CC5500]">{email || 'your inbox'}</span>
                  </p>

                  {error && <div className="mt-2.5 text-[12.5px] font-semibold leading-5 text-[#8A2E00] bg-white/70 rounded-xl px-3 py-2.5 shadow-[5px_5px_10px_#b8bcc9,-5px_-5px_10px_#ffffff] border-l-4 border-[#CC5500]">{error}</div>}
                  {status && <div className="mt-2.5 text-[12.5px] font-semibold leading-5 text-[#2F343D] bg-white/70 rounded-xl px-3 py-2.5 shadow-[5px_5px_10px_#b8bcc9,-5px_-5px_10px_#ffffff] border-l-4 border-[#CC5500]">{status}</div>}

                  <label className={`${labelCls} mt-3`}>Reset code</label>
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="0 0 0 0 0 0"
                    className={`${inputCls} mt-1.5 text-center !text-[18px] !font-extrabold !tracking-[0.5em]`}
                  />
                  <div className="mt-2.5">
                    <input
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="New password (8+ characters)"
                      type={show ? 'text' : 'password'}
                      autoComplete="new-password"
                      className={inputCls}
                    />
                  </div>
                  {newPassword.length > 0 && (
                    <div className="mt-3 flex items-center gap-1.5 rounded-2xl bg-[#E0E5EC] p-3 shadow-[inset_4px_4px_8px_#b8bcc9,inset_-4px_-4px_8px_#ffffff]">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <span key={i} className={`h-2 flex-1 rounded-full ${i < newPw.level ? 'bg-[#CC5500]' : 'bg-[#c9cdd8]'}`} />
                      ))}
                      <span className="ml-1 text-[11px] font-bold text-[#6B7280]">{newPw.label.toUpperCase()}</span>
                    </div>
                  )}
                  <div className="mt-2.5">
                    <input
                      value={confirmNew}
                      onChange={(e) => setConfirmNew(e.target.value)}
                      placeholder="Confirm new password"
                      type={show ? 'text' : 'password'}
                      autoComplete="new-password"
                      onKeyDown={(e) => { if (e.key === 'Enter' && !busy) confirmReset(); }}
                      className={inputCls}
                    />
                  </div>
                  {confirmNew.length > 0 && confirmNew !== newPassword && (
                    <p className="mt-2 text-[12px] font-bold text-[#8A2E00]">Passwords do not match</p>
                  )}
                  <button onClick={confirmReset} disabled={busy} className={`${primaryBtn} mt-3`}>
                    {busy ? 'Updating…' : 'Set new password →'}
                  </button>
                  <div className="mt-3 flex items-center justify-between text-[12.5px] font-bold">
                    <button className="text-[#CC5500] hover:text-[#A34400]" onClick={sendResetCode}>
                      Resend code
                    </button>
                    <button className="text-[#8A8F98] hover:text-[#2F343D]" onClick={backToLogin}>Back to sign in</button>
                  </div>
                </>
              ) : (
                <>
                  <h2 className="text-[22px] font-extrabold tracking-tight text-[#2F343D]">{isLogin ? 'Welcome back' : 'Create account'}</h2>
                  <p className="mt-1 text-[12.5px] font-medium text-[#8A8F98]">{isLogin ? 'Log in to your Nexus account' : 'Join Nexus in seconds'}</p>

                  {error && <div className="mt-2.5 text-[12.5px] font-semibold leading-5 text-[#8A2E00] bg-white/70 rounded-xl px-3 py-2.5 shadow-[5px_5px_10px_#b8bcc9,-5px_-5px_10px_#ffffff] border-l-4 border-[#CC5500]">{error}</div>}
                  {status && <div className="mt-2.5 text-[12.5px] font-semibold leading-5 text-[#2F343D] bg-white/70 rounded-xl px-3 py-2.5 shadow-[5px_5px_10px_#b8bcc9,-5px_-5px_10px_#ffffff] border-l-4 border-[#CC5500]">{status}</div>}

                  <div className="mt-3 space-y-3">
                    {!isLogin && (
                      <div>
                        <label className={labelCls}>Full name</label>
                        <div className="relative mt-1.5">
                          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9AA0AE]">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="3.6" stroke="currentColor" strokeWidth="1.8"/><path d="M4.5 19.5c1.4-3.2 4.2-4.8 7.5-4.8s6.1 1.6 7.5 4.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
                          </span>
                          <input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Ada Lovelace (optional)"
                            autoComplete="name"
                            className={`${inputCls} !pl-11`}
                          />
                        </div>
                      </div>
                    )}

                    <div>
                      <label className={labelCls}>Email address</label>
                      <div className="relative mt-1.5">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9AA0AE]">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.8"/><path d="m4 7 8 6 8-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        </span>
                        <input
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="you@domain.com"
                          type="email"
                          autoComplete="email"
                          onKeyDown={(e) => { if (e.key === 'Enter' && !busy) submit(); }}
                          className={`${inputCls} !pl-11`}
                        />
                      </div>
                    </div>

                    <div>
                      <label className={labelCls}>Password</label>
                      <div className="relative mt-1.5">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#9AA0AE]">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="5" y="10" width="14" height="10" rx="2.5" stroke="currentColor" strokeWidth="1.8"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10" stroke="currentColor" strokeWidth="1.8"/></svg>
                        </span>
                        <input
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="••••••••"
                          type={show ? 'text' : 'password'}
                          autoComplete={isLogin ? 'current-password' : 'new-password'}
                          onKeyDown={(e) => { if (e.key === 'Enter' && !busy) submit(); }}
                          className={`${inputCls} !pl-11 !pr-12`}
                        />
                        <button
                          onClick={() => setShow((v) => !v)}
                          aria-label={show ? 'Hide password' : 'Show password'}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 grid place-items-center w-9 h-9 rounded-xl bg-[#E0E5EC] text-[#6B7280] hover:text-[#CC5500] shadow-[3px_3px_6px_#b8bcc9,-3px_-3px_6px_#ffffff] active:shadow-[inset_3px_3px_6px_#b8bcc9,inset_-3px_-3px_6px_#ffffff] transition-all"
                        >
                          {show ? (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M3 3l18 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><path d="M10.6 5.1A9.8 9.8 0 0 1 12 5c5 0 9 4.5 10 7-.4 1-1.3 2.4-2.7 3.7M6.6 6.6C4 8.2 2.6 10.6 2 12c1 2.5 5 7 10 7 1.5 0 2.9-.4 4.1-1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
                          ) : (
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" stroke="currentColor" strokeWidth="1.8"/><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8"/></svg>
                          )}
                        </button>
                      </div>
                    </div>

                    {!isLogin && (
                      <>
                        <div>
                          <label className={labelCls}>Confirm password</label>
                          <input
                            value={confirm}
                            onChange={(e) => setConfirm(e.target.value)}
                            placeholder="Repeat it"
                            type={show ? 'text' : 'password'}
                            autoComplete="new-password"
                            onKeyDown={(e) => { if (e.key === 'Enter' && !busy) submit(); }}
                            className={`${inputCls} mt-2`}
                          />
                        </div>
                        {password.length > 0 && (
                          <div className="flex items-center gap-1.5 rounded-2xl bg-[#E0E5EC] p-3 shadow-[inset_4px_4px_8px_#b8bcc9,inset_-4px_-4px_8px_#ffffff]">
                            {Array.from({ length: 5 }).map((_, i) => (
                              <span key={i} className={`h-2 flex-1 rounded-full ${i < pw.level ? 'bg-[#CC5500]' : 'bg-[#c9cdd8]'}`} />
                            ))}
                            <span className="ml-1 text-[11px] font-bold text-[#6B7280]">{pw.label.toUpperCase()}</span>
                          </div>
                        )}
                        {confirm.length > 0 && confirm !== password && (
                          <p className="text-[12px] font-bold text-[#8A2E00]">Passwords do not match</p>
                        )}
                      </>
                    )}

                    {isLogin ? (
                      <div className="flex items-center justify-between pt-0.5 text-[13px] font-bold text-[#2F343D]">
                        <label className="flex items-center gap-2.5 cursor-pointer">
                          <button
                            role="checkbox"
                            aria-checked={remember}
                            onClick={(e) => { e.preventDefault(); setRemember((v) => !v); }}
                            className={`grid place-items-center w-[24px] h-[24px] rounded-[9px] transition-all ${
                              remember
                                ? 'bg-[#CC5500] shadow-[3px_3px_6px_#b8bcc9,-3px_-3px_6px_#ffffff]'
                                : 'bg-[#E0E5EC] shadow-[inset_3px_3px_6px_#b8bcc9,inset_-3px_-3px_6px_#ffffff]'
                            }`}
                          >
                            {remember && (
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="m5 13 4 4L19 7" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                            )}
                          </button>
                          <span className="text-[#4B5563]">Remember me</span>
                        </label>
                        <button onClick={() => { setError(null); setStatus(null); setStage('forgot'); }} className="text-[#CC5500] hover:text-[#A34400] transition-colors">Forgot password?</button>
                      </div>
                    ) : (
                      <p className="text-[11px] leading-5 font-medium text-[#8A8F98] rounded-2xl bg-[#E0E5EC] p-3.5 shadow-[inset_4px_4px_8px_#b8bcc9,inset_-4px_-4px_8px_#ffffff]">
                        By continuing you agree to our <span className="font-bold text-[#2F343D]">Terms</span> &{' '}
                        <span className="font-bold text-[#2F343D]">Privacy Policy</span>. 8+ chars with upper, lower,
                        number & symbol.
                      </p>
                    )}

                    <button onClick={submit} disabled={busy} className={primaryBtn}>
                      {busy ? 'Please wait…' : (
                        <span className="inline-flex items-center gap-2">
                          {isLogin ? 'Log in securely' : 'Create secure account'}
                          <span>→</span>
                        </span>
                      )}
                    </button>

                    <div className="text-center pt-1 text-[13px] font-semibold text-[#6B7280]">
                      {isLogin ? (
                        <span>
                          Don&apos;t have an account?{' '}
                          <button type="button" onClick={() => switchMode('signup')} className="font-bold text-[#CC5500] hover:text-[#A34400] transition-colors">
                            Create one
                          </button>
                        </span>
                      ) : (
                        <span>
                          Already have an account?{' '}
                          <button type="button" onClick={() => switchMode('login')} className="font-bold text-[#CC5500] hover:text-[#A34400] transition-colors">
                            Sign in
                          </button>
                        </span>
                      )}
                    </div>

                    {isLogin && (
                      <>
                        <div className="flex items-center gap-3 pt-1 text-[10px] font-bold tracking-[0.16em] text-[#9AA0AE]">
                          <span className="flex-1 h-[2px] rounded-full bg-[#c9cdd8] shadow-[inset_1px_1px_2px_#b8bcc9]" /> OR CONTINUE WITH <span className="flex-1 h-[2px] rounded-full bg-[#c9cdd8] shadow-[inset_1px_1px_2px_#b8bcc9]" />
                        </div>

                        <button
                          onClick={() => {
                            const cid = process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID || '';
                            if (!cid) { setError('GitHub login is not configured in this build.'); return; }
                            const redirect = `${window.location.origin}/auth/github/callback`;
                            window.location.href =
                              `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(cid)}` +
                              `&redirect_uri=${encodeURIComponent(redirect)}&scope=user:email`;
                          }}
                          disabled={busy}
                          className={ghostBtn}
                        >
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.27-.01-1.17-.02-2.12-3.2.7-3.88-1.36-3.88-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.72-1.54-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.25 5.67.41.35.77 1.05.77 2.12 0 1.53-.01 2.76-.01 3.14 0 .31.21.68.8.56A10.52 10.52 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z"/></svg>
                          Continue with GitHub
                        </button>
                      </>
                    )}

                    <p className="flex items-center justify-center gap-1.5 pt-1 text-[11px] font-semibold text-[#9AA0AE] text-center">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-[#CC5500]"><path d="M12 2 4 5.5V11c0 5 3.4 8.7 8 10 4.6-1.3 8-5 8-10V5.5L12 2Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="m9 11.5 2.2 2.2L15.5 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      COGNITO AUTH · CHATS E2EE ON DEVICE
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* footer */}
      <div className="relative z-10 mt-2.5 w-full max-w-[1024px] shrink-0 flex flex-row items-center justify-between gap-3 text-[10px] font-semibold text-[#8A8F98] px-1">
        <p className="bg-[#E0E5EC] rounded-full px-3 py-1.5 shadow-[3px_3px_6px_#b8bcc9,-3px_-3px_6px_#ffffff]">
          © 2025 NEXUS — PRIVATE. ENCRYPTED. BROWSER-FIRST.
        </p>
        <div className="flex items-center gap-4">
          <span className="hover:text-[#CC5500] transition-colors cursor-pointer" title="Coming soon">Privacy</span>
          <span className="hover:text-[#CC5500] transition-colors cursor-pointer" title="Coming soon">Terms</span>
          <a href="mailto:hello@buildwith.com" className="hover:text-[#CC5500] transition-colors cursor-pointer">Contact</a>
        </div>
      </div>
    </div>
  );
}
