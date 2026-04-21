'use client';
import { useMemo, useState, useEffect } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

const getLoginMessages = (username: string) => [
  { top: `Welcome Back 👋`, bottom: `Good to see you again, ${username}.` },
  { top: "Your Universe Awaits", bottom: "Step back into Nexus and pick up where you left off." },
  { top: "Ready to Connect?", bottom: "AI-powered conversations, just a login away." },
  { top: "Your Space ✦", bottom: "Private. Secure. Intelligent. Always." },
  { top: `Hey, ${username}!`, bottom: "Nexus has been thinking about you." },
];

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msgIndex, setMsgIndex] = useState(0);
  const [visible, setVisible] = useState(true);
  const setAuth = useAuthStore((state) => state.setAuth);
  const user = useAuthStore((state) => state.user);
  const router = useRouter();
  const loggedInUsername = useMemo(() => user?.username || 'Explorer', [user?.username]);

  useEffect(() => {
    const interval = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setMsgIndex((i) => (i + 1) % getLoginMessages(loggedInUsername).length);
        setVisible(true);
      }, 600);
    }, 3200);
    return () => clearInterval(interval);
  }, [loggedInUsername]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await res.json();
    if (res.ok) {
      setAuth(data.user);
      router.push('/chat');
    } else {
      alert(data.error);
    }
  };

  const messages = getLoginMessages(loggedInUsername);
  const msg = messages[msgIndex];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Exo+2:wght@300;400;600&display=swap');
        .nexus-fade { transition: opacity 0.6s ease, transform 0.6s ease; }
        .nexus-fade.hidden { opacity: 0; transform: translateY(12px); }
        .nexus-fade.shown  { opacity: 1; transform: translateY(0); }
        .dot-active   { background: rgba(147,210,255,0.9); }
        .dot-inactive { background: rgba(255,255,255,0.25); }
        @keyframes pulse-ring {
          0%,100% { transform: scale(0.95); opacity: 0.6; }
          50%      { transform: scale(1.05); opacity: 1; }
        }
        .nexus-logo { animation: pulse-ring 3s ease-in-out infinite; }
        @keyframes marquee { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
        input::placeholder { color: rgba(255,255,255,0.35); }
        input:focus { outline: none; border-color: rgba(147,210,255,0.5) !important; }
        button:hover { filter: brightness(1.15); }
      `}</style>

      <div style={{
        position: 'relative', display: 'flex', height: '100vh',
        alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden', fontFamily: "'Exo 2', sans-serif", gap: '28px',
      }}>

        {/* Video background */}
        <video autoPlay loop muted playsInline style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
        }}>
          <source src="/assets/skills.mp4" type="video/mp4" />
        </video>

        {/* Dark overlay */}
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.48)' }} />

        {/* Ticker */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20,
          overflow: 'hidden', padding: '8px 0',
          background: 'rgba(255,255,255,0.06)',
          borderBottom: '1px solid rgba(255,255,255,0.12)',
          backdropFilter: 'blur(10px)',
        }}>
          <div style={{
            display: 'flex', whiteSpace: 'nowrap',
            animation: 'marquee 38s linear infinite',
            color: 'rgba(180,220,255,0.8)', fontSize: '12px',
            letterSpacing: '0.06em', fontFamily: "'Orbitron', sans-serif",
          }}>
            {(() => {
              const t = `✦ NEXUS AI &nbsp;&nbsp;&nbsp; Welcome Back, ${loggedInUsername} &nbsp;&nbsp;&nbsp; Your Universe Awaits &nbsp;&nbsp;&nbsp; AI-Powered Conversations &nbsp;&nbsp;&nbsp; Private &amp; Secure &nbsp;&nbsp;&nbsp; Real-Time Intelligence &nbsp;&nbsp;&nbsp; `;
              return <span dangerouslySetInnerHTML={{ __html: t + t }} />;
            })()}
          </div>
        </div>

        {/* ── LEFT: Looping welcome card ── */}
        <div style={{
          position: 'relative', zIndex: 10,
          width: '300px', height: '380px', borderRadius: '24px',
          background: 'rgba(255,255,255,0.08)',
          backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)',
          border: '1px solid rgba(255,255,255,0.2)',
          boxShadow: '0 8px 40px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.15)',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: '36px 28px', textAlign: 'center', overflow: 'hidden',
        }}>
          {/* Corner accents */}
          {[
            { top: 12, left: 12, borderTop: '2px solid rgba(147,210,255,0.5)', borderLeft: '2px solid rgba(147,210,255,0.5)' },
            { top: 12, right: 12, borderTop: '2px solid rgba(147,210,255,0.5)', borderRight: '2px solid rgba(147,210,255,0.5)' },
            { bottom: 12, left: 12, borderBottom: '2px solid rgba(147,210,255,0.5)', borderLeft: '2px solid rgba(147,210,255,0.5)' },
            { bottom: 12, right: 12, borderBottom: '2px solid rgba(147,210,255,0.5)', borderRight: '2px solid rgba(147,210,255,0.5)' },
          ].map((s, i) => (
            <div key={i} style={{ position: 'absolute', width: 18, height: 18, ...s }} />
          ))}

          {/* Avatar circle with initial */}
          <div className="nexus-logo" style={{ marginBottom: '20px' }}>
            <div style={{
              width: 60, height: 60, borderRadius: '50%',
              border: '1.5px solid rgba(147,210,255,0.5)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(147,210,255,0.12)',
            }}>
              <span style={{
                fontFamily: "'Orbitron', sans-serif",
                fontSize: '22px', fontWeight: 900,
                color: 'rgba(180,225,255,0.95)',
              }}>
                {loggedInUsername.charAt(0).toUpperCase()}
              </span>
            </div>
          </div>

          {/* Static username line */}
          <p style={{
            fontFamily: "'Exo 2', sans-serif",
            fontSize: '13px', fontWeight: 600,
            color: 'rgba(255,255,255,0.5)',
            letterSpacing: '0.08em',
            margin: '0 0 16px',
          }}>
            {loggedInUsername.toUpperCase()}
          </p>

          {/* Animated message */}
          <div className={`nexus-fade ${visible ? 'shown' : 'hidden'}`}
            style={{ minHeight: '110px', display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'center', justifyContent: 'center' }}>
            <p style={{
              fontFamily: "'Orbitron', sans-serif",
              fontSize: '12px', fontWeight: 700,
              color: 'rgba(147,210,255,0.95)',
              letterSpacing: '0.12em', textTransform: 'uppercase', margin: 0,
            }}>{msg.top}</p>
            <p style={{
              fontFamily: "'Exo 2', sans-serif",
              fontSize: '13px', fontWeight: 300,
              color: 'rgba(220,240,255,0.85)', lineHeight: 1.6, margin: 0,
            }}>{msg.bottom}</p>
          </div>

          {/* Dot indicators */}
          <div style={{ display: 'flex', gap: '7px', marginTop: '20px' }}>
            {messages.map((_, i) => (
              <div key={i} className={i === msgIndex ? 'dot-active' : 'dot-inactive'}
                style={{ width: 6, height: 6, borderRadius: '50%', transition: 'background 0.4s' }} />
            ))}
          </div>
        </div>

        {/* ── RIGHT: Glass login form ── */}
        <form onSubmit={handleLogin} style={{
          position: 'relative', zIndex: 10,
          width: '380px', borderRadius: '24px', padding: '36px 32px',
          background: 'rgba(255,255,255,0.12)',
          backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)',
          border: '1px solid rgba(255,255,255,0.28)',
          boxShadow: '0 8px 40px rgba(0,0,0,0.3)',
        }}>
          <p style={{
            fontFamily: "'Orbitron', sans-serif", fontSize: '10px',
            letterSpacing: '0.2em', color: 'rgba(255,255,255,0.45)',
            textAlign: 'center', margin: '0 0 4px',
          }}>RETURN TO</p>
          <h1 style={{
            fontFamily: "'Orbitron', sans-serif", fontSize: '26px', fontWeight: 900,
            color: '#fff', textAlign: 'center', margin: '0 0 6px', letterSpacing: '0.1em',
          }}>✦ NEXUS</h1>
          <p style={{
            fontFamily: "'Exo 2', sans-serif", fontSize: '12px',
            color: 'rgba(180,215,255,0.7)', textAlign: 'center',
            margin: '0 0 28px', lineHeight: 1.5,
          }}>
            Your intelligent chat universe —<br />sign in to continue.
          </p>

          <p style={{
            fontFamily: "'Orbitron', sans-serif", fontSize: '11px', fontWeight: 700,
            color: 'rgba(255,255,255,0.7)', textAlign: 'center',
            letterSpacing: '0.1em', margin: '0 0 20px',
          }}>LOGIN TO YOUR ACCOUNT</p>

          {[
            { type: 'email',    placeholder: 'Email',    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setEmail(e.target.value) },
            { type: 'password', placeholder: 'Password', onChange: (e: React.ChangeEvent<HTMLInputElement>) => setPassword(e.target.value) },
          ].map(({ type, placeholder, onChange }, i) => (
            <input
              key={i} type={type} placeholder={placeholder} onChange={onChange}
              style={{
                display: 'block', width: '100%', marginBottom: '14px',
                padding: '11px 14px', borderRadius: '12px',
                background: 'rgba(255,255,255,0.10)',
                border: '1px solid rgba(255,255,255,0.22)',
                color: '#fff', fontSize: '14px',
                fontFamily: "'Exo 2', sans-serif",
                boxSizing: 'border-box',
              }}
            />
          ))}

          <button type="submit" style={{
            width: '100%', padding: '12px', borderRadius: '12px',
            marginTop: '4px', marginBottom: '16px',
            background: 'rgba(99,179,237,0.5)',
            border: '1px solid rgba(147,210,255,0.45)',
            color: '#fff', fontWeight: 700, fontSize: '14px',
            fontFamily: "'Orbitron', sans-serif",
            letterSpacing: '0.1em', cursor: 'pointer',
            backdropFilter: 'blur(8px)',
          }}>
            ENTER NEXUS
          </button>

          <p style={{
            textAlign: 'center', fontSize: '13px',
            color: 'rgba(255,255,255,0.6)',
            fontFamily: "'Exo 2', sans-serif", margin: 0,
          }}>
            Need an account?{' '}
            <Link href="/signup" style={{
              color: 'rgba(147,210,255,0.95)',
              textDecoration: 'underline', textUnderlineOffset: '3px',
            }}>Create one</Link>
          </p>
        </form>

        {/* Bottom pills */}
        <div style={{
          position: 'absolute', bottom: 20, zIndex: 10,
          display: 'flex', gap: '10px', flexWrap: 'wrap',
          justifyContent: 'center', padding: '0 1rem',
        }}>
          {['⚡ AI-Powered', '🌐 Always Connected', '🔒 Private & Secure', '✦ Real-Time'].map((pill) => (
            <span key={pill} style={{
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.18)',
              backdropFilter: 'blur(8px)', borderRadius: '999px',
              padding: '5px 14px', fontSize: '11px',
              color: 'rgba(200,230,255,0.8)', letterSpacing: '0.05em',
              fontFamily: "'Exo 2', sans-serif",
            }}>{pill}</span>
          ))}
        </div>
      </div>
    </>
  );
}
