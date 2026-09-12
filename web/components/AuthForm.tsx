'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { authApi } from '@/lib/api';
import { ensureIdentityPublished } from '@/lib/keyx';
import { useAuthStore } from '@/store/auth';

const Dither = dynamic(() => import('@/components/Dither'), { ssr: false });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function strength(pw: string): { label: string; pct: number } {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  if (s <= 2) return { label: 'Weak', pct: 28 };
  if (s === 3) return { label: 'Fair', pct: 52 };
  if (s === 4) return { label: 'Strong', pct: 78 };
  return { label: 'Excellent', pct: 100 };
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
    <span className="flex items-center gap-2.5 select-none">
      <span className="grid place-items-center w-9 h-9 rounded-xl bg-gradient-to-br from-[#8B5CF6] to-[#5B21B6] shadow-[0_0_24px_rgba(139,92,246,0.55)]">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M6 4.5v11.2c0 1.6 1.76 2.58 3.12 1.73l7.9-4.95c1.34-.84 3.02.12 3.02 1.73v.29c0 .83-.67 1.5-1.5 1.5H6.5A2 2 0 0 1 4.5 14V6c0-.83.67-1.5 1.5-1.5Z" fill="white" opacity=".95" />
          <path d="M18 4.5v11c0 .83-.67 1.5-1.5 1.5h-.4L7 11.6V6c0-.83.67-1.5 1.5-1.5H18Z" fill="white" opacity=".55" />
        </svg>
      </span>
      <span className="text-[22px] font-extrabold tracking-tight text-white">Nexus</span>
    </span>
  );
}

export function AuthForm() {
  const login = useAuthStore((s) => s.login);
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [verify, setVerify] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [code, setCode] = useState('');
  const [googleCred, setGoogleCred] = useState('');
  const [showGoogleToken, setShowGoogleToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const pw = useMemo(() => strength(password), [password]);
  const isLogin = mode === 'login' && !verify;

  const switchMode = (m: 'login' | 'signup') => {
    setError(null);
    setStatus(null);
    setVerify(false);
    setMode(m);
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

  const google = async () => {
    if (!googleCred.trim()) {
      setError('Paste a Google ID token, or sign in via your Cognito Hosted UI.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const r = await authApi.google(googleCred.trim());
      login(r.user, r.idToken);
      ensureIdentityPublished().catch(() => {});
    } catch (e: any) {
      setError(friendly(e, 'Google sign-in failed'));
    } finally {
      setBusy(false);
    }
  };

  const forgot = async () => {
    if (!EMAIL_RE.test(email.trim())) {
      setError('Enter your email above first, then use Forgot password to resend a code.');
      return;
    }
    try {
      await authApi.resend(email.trim().toLowerCase());
      setVerify(true);
      setStatus('Reset / verification code sent. Enter it below to verify, then sign in.');
    } catch (e: any) {
      setError(friendly(e, 'Could not send code'));
    }
  };

  return (
    <div className="min-h-screen w-full relative overflow-y-auto overflow-x-hidden bg-[#0A0618] text-white flex flex-col items-center justify-center px-4 py-8">
      {/* backdrop — Dither wave field (pixel background) */}
      <div aria-hidden className="fixed inset-0 z-0 overflow-hidden bg-black pointer-events-auto">
        <div className="absolute inset-0 w-full h-full">
          <Dither
            waveColor={[0.48627450980392156, 0.22745098039215686, 0.9294117647058824]}
            disableAnimation={false}
            enableMouseInteraction
            mouseRadius={0.3}
            colorNum={4}
            waveAmplitude={0.3}
            waveFrequency={3}
            waveSpeed={0.05}
            backgroundColor={[0, 0, 0]}
          />
        </div>
        <div className="absolute inset-0 bg-[#0A0618]/45 pointer-events-none" />
      </div>

      {/* card — liquid glass shell */}
      <div className="relative z-10 w-full max-w-[1080px] grid lg:grid-cols-[1.08fr_0.92fr] rounded-[22px] overflow-hidden glass-edge glass-shell glass-refract">
        {/* LEFT */}
        <div className="relative overflow-hidden p-7 sm:p-9 lg:p-10 min-h-[480px] flex flex-col">

          <div className="relative z-10 flex flex-col h-full">
            <NexusMark />

            <div className="mt-7 inline-flex w-fit items-center gap-2 rounded-full border border-[#8B5CF6]/40 glass-chip px-3.5 py-1.5 text-[13px] font-medium text-[#D6CCFF]">
              <span className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.9)]" />
              Web-Only Encrypted Rebuild
            </div>

            <h1 className="mt-5 text-[42px] sm:text-[48px] leading-[1.02] font-extrabold tracking-[-0.02em]">
              Private
              <br />
              <span className="bg-gradient-to-r from-[#A78BFA] via-[#8B5CF6] to-[#7C6CF6] bg-clip-text text-transparent">conversations</span>
              <br />
              for a better you
            </h1>

            <p className="mt-4 max-w-[380px] text-[15px] leading-6 text-[#B9B0D6]">
              End-to-end encrypted messaging, self-destructing ghost chats, and HD video calls — all in your browser.
            </p>

            <div className="mt-7 space-y-3.5">
              {[
                { t: 'XSalas20-Poly1305', s: 'End-to-end encryption', icon: (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="5" y="10" width="14" height="10" rx="2.5" fill="#B7A6FF"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10" stroke="#B7A6FF" strokeWidth="2"/><circle cx="12" cy="15" r="1.5" fill="#2A1B52"/><path d="M12 15.7v1.3" stroke="#2A1B52" strokeWidth="1.5" strokeLinecap="round"/></svg>
                )},
                { t: 'Zero-trace', s: '30s ghost chats', icon: (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 3C7.5 3 4 6.6 4 11v8.2c0 .7.8 1.2 1.45.85L7.4 18.8c.35-.2.8-.1 1 .2l.7 1c.3.45.95.45 1.25 0l.65-.95c.2-.3.65-.4 1-.2l.6.35c.35.2.8.1 1-.25l.55-.8c.2-.3.65-.4.95-.2l1.7 1c.65.35 1.45-.1 1.45-.85V11c0-4.4-3.5-8-8.25-8Z" fill="#B7A6FF"/><circle cx="9.5" cy="11" r="1.1" fill="#2A1B52"/><circle cx="14.5" cy="11" r="1.1" fill="#2A1B52"/></svg>
                )},
                { t: 'P2P WebRTC', s: 'HD video calling', icon: (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="2.5" y="7" width="12" height="10" rx="2.5" fill="#B7A6FF"/><path d="M15.5 10.5 21 7.8c.6-.25 1.2.2 1.2.85v6.7c0 .65-.6 1.1-1.2.85l-5.5-2.7v-3Z" fill="#B7A6FF"/></svg>
                )},
              ].map((f) => (
                <div key={f.t} className="flex items-center gap-3.5">
                  <span className="grid place-items-center w-11 h-11 rounded-xl border border-white/10 glass-tile">{f.icon}</span>
                  <span>
                    <span className="block text-[15px] font-bold text-white leading-tight">{f.t}</span>
                    <span className="block text-[13px] text-[#9C92C0]">{f.s}</span>
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-auto pt-8">
              <p className="text-[13px] italic text-[#8E86AD] -rotate-3 origin-left">
                More privacy. More you.
                <svg className="mt-1 w-28 h-3" viewBox="0 0 112 12" fill="none"><path d="M2 9C30 2 70 2 110 7" stroke="#8B5CF6" strokeWidth="1.6" strokeLinecap="round" opacity=".8"/></svg>
              </p>
            </div>
          </div>
        </div>

        {/* RIGHT */}
        <div className="relative z-10 border-t lg:border-t-0 lg:border-l border-white/[0.08] bg-[#150D31]/40 backdrop-blur-2xl p-6 sm:p-8 flex flex-col">
          <div className="flex items-center justify-end text-[14px]">
            <button
              onClick={() => switchMode(isLogin ? 'signup' : 'login')}
              className="rounded-full border border-[#8B5CF6]/50 bg-[#8B5CF6]/10 backdrop-blur-md px-4 py-1.5 font-semibold text-white hover:bg-[#8B5CF6]/20 transition-colors shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]"
            >
              {verify ? 'Back to login' : isLogin ? 'Create account' : 'Sign in'}
            </button>
          </div>

          <div className="mt-5 flex-1 rounded-[18px] glass-edge-soft glass-inner glass-refract overflow-hidden p-6 sm:p-7">
            {verify ? (
              <>
                <h2 className="text-[30px] font-extrabold tracking-tight">Check your email</h2>
                <p className="mt-1.5 text-[14px] text-[#9C92C0]">Enter the 6-digit code sent to <span className="text-white font-semibold">{email || 'your inbox'}</span></p>

                {error && <div className="mt-4 text-[13px] leading-5 text-[#FF9AA8] bg-[#FF5C7A]/10 border border-[#FF5C7A]/25 rounded-xl px-3.5 py-3">{error}</div>}
                {status && <div className="mt-4 text-[13px] leading-5 text-[#C4B5FD] bg-[#8B5CF6]/10 border border-[#8B5CF6]/30 rounded-xl px-3.5 py-3">{status}</div>}

                <label className="mt-5 block text-[13px] font-medium text-[#9C92C0]">Verification code</label>
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="0 0 0 0 0 0"
                  className="mt-2 w-full rounded-xl border border-white/10 glass-input px-4 py-3.5 text-center text-[20px] font-bold tracking-[0.5em] placeholder:text-[#5B5478] placeholder:tracking-[0.5em] outline-none focus:border-[#8B5CF6]/70 focus:ring-2 focus:ring-[#8B5CF6]/25 transition"
                />
                <button
                  onClick={confirmCode}
                  disabled={busy || code.length !== 6}
                  className="mt-4 w-full rounded-xl bg-gradient-to-r from-[#8B5CF6] to-[#6D28D9] px-4 py-3.5 font-bold text-[15px] shadow-[0_10px_30px_-8px_rgba(139,92,246,0.7)] hover:brightness-110 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  {busy ? 'Verifying…' : 'Confirm & verify →'}
                </button>
                <div className="mt-4 flex items-center justify-between text-[13px]">
                  <button
                    className="text-[#A78BFA] hover:text-white transition-colors"
                    onClick={() => authApi.resend(email.trim().toLowerCase()).then(() => setStatus('Fresh code sent.')).catch((e) => setError(friendly(e, 'Resend failed')))}
                  >
                    Resend code
                  </button>
                  <button className="text-[#8E86AD] hover:text-white transition-colors" onClick={() => setVerify(false)}>Back</button>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-[30px] font-extrabold tracking-tight">{isLogin ? 'Welcome back' : 'Create account'}</h2>
                <p className="mt-1.5 text-[14px] text-[#9C92C0]">{isLogin ? 'Log in to your Nexus account' : 'Join Nexus in seconds — encrypted by default'}</p>

                {error && <div className="mt-4 text-[13px] leading-5 text-[#FF9AA8] bg-[#FF5C7A]/10 border border-[#FF5C7A]/25 rounded-xl px-3.5 py-3">{error}</div>}
                {status && <div className="mt-4 text-[13px] leading-5 text-[#C4B5FD] bg-[#8B5CF6]/10 border border-[#8B5CF6]/30 rounded-xl px-3.5 py-3">{status}</div>}

                <div className="mt-5 space-y-3.5">
                  {!isLogin && (
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#8E86AD]">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="3.6" stroke="currentColor" strokeWidth="1.7"/><path d="M4.5 19.5c1.4-3.2 4.2-4.8 7.5-4.8s6.1 1.6 7.5 4.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>
                      </span>
                      <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Full name (optional)"
                        autoComplete="name"
                        className="w-full rounded-xl border border-white/10 glass-input pl-11 pr-4 py-3.5 text-[14px] placeholder:text-[#6F668F] outline-none focus:border-[#8B5CF6]/70 focus:ring-2 focus:ring-[#8B5CF6]/20 transition"
                      />
                    </div>
                  )}

                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#EDE9FE]">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.7"/><path d="m4 7 8 6 8-6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </span>
                    <input
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Email address"
                      type="email"
                      autoComplete="email"
                      onKeyDown={(e) => { if (e.key === 'Enter' && !busy) submit(); }}
                      className="w-full rounded-xl border border-white/10 glass-input pl-11 pr-4 py-3.5 text-[14px] placeholder:text-[#6F668F] outline-none focus:border-[#8B5CF6]/70 focus:ring-2 focus:ring-[#8B5CF6]/20 transition"
                    />
                  </div>

                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#EDE9FE]">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="5" y="10" width="14" height="10" rx="2.5" stroke="currentColor" strokeWidth="1.7"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10" stroke="currentColor" strokeWidth="1.7"/></svg>
                    </span>
                    <input
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Password"
                      type={show ? 'text' : 'password'}
                      autoComplete={isLogin ? 'current-password' : 'new-password'}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !busy) submit(); }}
                      className="w-full rounded-xl border border-white/10 glass-input pl-11 pr-11 py-3.5 text-[14px] placeholder:text-[#6F668F] outline-none focus:border-[#8B5CF6]/70 focus:ring-2 focus:ring-[#8B5CF6]/20 transition"
                    />
                    <button onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'} className="absolute right-4 top-1/2 -translate-y-1/2 text-[#B9B0D6] hover:text-white transition-colors">
                      {show ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M3 3l18 18" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/><path d="M10.6 5.1A9.8 9.8 0 0 1 12 5c5 0 9 4.5 10 7-.4 1-1.3 2.4-2.7 3.7M6.6 6.6C4 8.2 2.6 10.6 2 12c1 2.5 5 7 10 7 1.5 0 2.9-.4 4.1-1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" stroke="currentColor" strokeWidth="1.7"/><circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7"/></svg>
                      )}
                    </button>
                  </div>

                  {!isLogin && (
                    <>
                      <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#8E86AD]">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="5" y="10" width="14" height="10" rx="2.5" stroke="currentColor" strokeWidth="1.7"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10" stroke="currentColor" strokeWidth="1.7"/></svg>
                        </span>
                        <input
                          value={confirm}
                          onChange={(e) => setConfirm(e.target.value)}
                          placeholder="Confirm password"
                          type={show ? 'text' : 'password'}
                          autoComplete="new-password"
                          onKeyDown={(e) => { if (e.key === 'Enter' && !busy) submit(); }}
                          className="w-full rounded-xl border border-white/10 glass-input pl-11 pr-4 py-3.5 text-[14px] placeholder:text-[#6F668F] outline-none focus:border-[#8B5CF6]/70 focus:ring-2 focus:ring-[#8B5CF6]/20 transition"
                        />
                      </div>
                      {password.length > 0 && (
                        <div className="flex items-center gap-2.5 px-0.5">
                          <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                            <div className="h-full rounded-full bg-gradient-to-r from-[#8B5CF6] to-[#A78BFA] transition-all" style={{ width: `${pw.pct}%` }} />
                          </div>
                          <span className="text-[12px] text-[#9C92C0]">Strength: <b className="text-white">{pw.label}</b></span>
                        </div>
                      )}
                      {confirm.length > 0 && confirm !== password && (
                        <p className="text-[12px] text-[#FF9AA8] px-0.5">Passwords do not match</p>
                      )}
                    </>
                  )}

                  {isLogin ? (
                    <div className="flex items-center justify-between pt-0.5 text-[13.5px]">
                      <label className="flex items-center gap-2 cursor-pointer text-[#CFC8EA]">
                        <button
                          role="checkbox"
                          aria-checked={remember}
                          onClick={(e) => { e.preventDefault(); setRemember((v) => !v); }}
                          className={`grid place-items-center w-[18px] h-[18px] rounded-[5px] border transition ${remember ? 'bg-[#8B5CF6] border-[#8B5CF6]' : 'bg-transparent border-white/25'}`}
                        >
                          {remember && (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="m5 13 4 4L19 7" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          )}
                        </button>
                        Remember me
                      </label>
                      <button onClick={forgot} className="text-[#A78BFA] hover:text-white font-medium transition-colors">Forgot password?</button>
                    </div>
                  ) : (
                    <p className="text-[12px] leading-5 text-[#8E86AD] px-0.5">
                      By continuing you agree to our <span className="text-[#C4B5FD]">Terms</span> & <span className="text-[#C4B5FD]">Privacy Policy</span>. 8+ chars with upper, lower, number & symbol.
                    </p>
                  )}

                  <button
                    onClick={submit}
                    disabled={busy}
                    className="group w-full rounded-xl bg-gradient-to-r from-[#9B7BFF] via-[#7C3AED] to-[#6D28D9] px-4 py-[15px] font-bold text-[15px] shadow-[0_12px_36px_-8px_rgba(139,92,246,0.8),inset_0_1px_0_rgba(255,255,255,0.25)] hover:brightness-110 hover:shadow-[0_16px_44px_-8px_rgba(139,92,246,0.9)] active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    {busy ? 'Please wait…' : (
                      <span className="inline-flex items-center gap-2">
                        {isLogin ? 'Log in securely' : 'Create secure account'}
                        <span className="transition-transform group-hover:translate-x-0.5">→</span>
                      </span>
                    )}
                  </button>

                  <div className="text-center pt-1 text-[13px] text-[#A78BFA]">
                    {isLogin ? (
                      <span>
                        Don&apos;t have an account?{' '}
                        <button
                          type="button"
                          onClick={() => switchMode('signup')}
                          className="font-bold text-white hover:underline transition-all underline-offset-2"
                        >
                          Create an account
                        </button>
                      </span>
                    ) : (
                      <span>
                        Already have an account?{' '}
                        <button
                          type="button"
                          onClick={() => switchMode('login')}
                          className="font-bold text-white hover:underline transition-all underline-offset-2"
                        >
                          Sign in
                        </button>
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3 pt-1 text-[11px] font-medium tracking-[0.08em] text-[#7E76A0]">
                    <span className="flex-1 h-px bg-white/10" /> OR CONTINUE WITH <span className="flex-1 h-px bg-white/10" />
                  </div>

                  <button
                    onClick={() => {
                      if (showGoogleToken && googleCred.trim()) { google(); }
                      else setShowGoogleToken((v) => !v);
                    }}
                    disabled={busy}
                    className="w-full rounded-xl border border-white/[0.12] bg-white/[0.03] backdrop-blur-md px-4 py-3.5 font-semibold text-[14.5px] text-[#E8E4FA] hover:bg-white/[0.06] active:scale-[0.99] transition flex items-center justify-center gap-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]"
                  >
                    <svg width="19" height="19" viewBox="0 0 24 24"><path fill="#FFC107" d="M21.35 11.1H12v2.9h5.35c-.5 2.4-2.55 3.5-5.35 3.5a5.9 5.9 0 0 1 0-11.8c1.5 0 2.85.55 3.9 1.45l2.1-2.1A8.9 8.9 0 0 0 12 2a9 9 0 0 0 0 18c5.4 0 9-3.8 9-9.2 0-.25-.05-.5-.1-.75l-.55-.95Z"/><path fill="#FF3D00" d="M3.15 7.05 5.9 9.05c.8-2 2.7-3.25 4.7-3.5l-2-2.05C6.45 4.1 4.3 5.4 3.15 7.05Z" opacity=".9"/><path fill="#4CAF50" d="M12 20c1.65 0 3.1-.6 4.2-1.55l-2.6-2.1c-.7.5-1.6.75-2.6.65l-.85 2.9c.3.05.55.1.85.1Z"/><path fill="#1976D2" d="M3 12c0-1 .2-2 .55-2.95L1.5 7C.55 8.85 0 10.35 0 12s.55 3.15 1.5 5.05l2.05-2C3.2 14 3 13 3 12Z"/></svg>
                    Continue with Google
                  </button>

                  {showGoogleToken && (
                    <div className="rounded-xl border border-white/10 bg-black/20 backdrop-blur-md p-3 space-y-2.5">
                      <input
                        value={googleCred}
                        onChange={(e) => setGoogleCred(e.target.value)}
                        placeholder="Paste Google ID token (eyJhbGciOi...)"
                        spellCheck={false}
                        className="w-full rounded-lg border border-white/10 glass-input px-3 py-2.5 text-[12.5px] font-mono placeholder:font-sans placeholder:text-[#6F668F] outline-none focus:border-[#8B5CF6]/60 transition"
                      />
                      <button onClick={google} disabled={busy || !googleCred.trim()} className="w-full rounded-lg bg-white/10 hover:bg-white/15 disabled:opacity-40 px-3 py-2.5 text-[13px] font-semibold transition">
                        Verify Google token
                      </button>
                      <p className="text-[11px] text-[#7E76A0] text-center">Or sign in via your Cognito Hosted UI, then paste the ID token here.</p>
                    </div>
                  )}

                  <p className="flex items-center justify-center gap-1.5 pt-1 text-[12px] text-[#8E86AD]">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 2 4 5.5V11c0 5 3.4 8.7 8 10 4.6-1.3 8-5 8-10V5.5L12 2Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="m9 11.5 2.2 2.2L15.5 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    Passwords via Cognito · Chats E2EE on this device
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* footer */}
      <div className="relative mt-6 w-full max-w-[1080px] flex flex-col sm:flex-row items-center justify-between gap-2 text-[12.5px] text-[#6E658F] px-1">
        <p className="sm:mx-auto">© 2025 Nexus. Private. Encrypted. Browser-first.</p>
        <div className="flex items-center gap-5 sm:absolute sm:right-1">
          <a className="hover:text-white transition-colors cursor-pointer">Privacy</a>
          <a className="hover:text-white transition-colors cursor-pointer">Terms</a>
          <a className="hover:text-white transition-colors cursor-pointer">Contact</a>
        </div>
      </div>
    </div>
  );
}
