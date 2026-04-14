import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { apiFetch, apiUrl } from '../../lib/api';
import { setAdminToken } from '../../lib/adminAuth';
import { queueAdminPostLoginGreeting } from '../../lib/adminPostLoginGreeting';
import { toQrCodeDataUrl } from '../../lib/qrCode';

type LoginAdmin = {
  name: string;
};

type LoginResponse =
  | { token: string; admin?: LoginAdmin }
  | { twoFactorRequired: true; error?: string }
  | { twoFactorSetupRequired: true; setupToken: string; manualEntryKey: string; otpAuthUrl: string; admin?: LoginAdmin };

// ── curtain ───────────────────────────────────────────────────────────────────

function Curtain({ onDone }: { onDone: () => void }) {
  return (
    <motion.div
      className="fixed inset-0 z-50 flex pointer-events-none"
      initial="closed"
      animate="open"
      onAnimationComplete={onDone}
    >
      {/* left panel */}
      <motion.div
        className="relative h-full w-1/2 flex-shrink-0"
        style={{
          background: 'linear-gradient(105deg, #7f1d1d 0%, #991b1b 40%, #b91c1c 100%)',
          transformOrigin: 'left center',
          boxShadow: 'inset -12px 0 32px rgba(0,0,0,0.25)',
        }}
        variants={{ closed: { scaleX: 1 }, open: { scaleX: 0 } }}
        transition={{ duration: 1.0, delay: 0.5, ease: [0.76, 0, 0.24, 1] }}
      >
        {/* fabric fold lines */}
        {[20, 40, 60, 80].map(pct => (
          <div key={pct} className="absolute top-0 bottom-0 w-px bg-red-900/30" style={{ left: `${pct}%` }} />
        ))}
        {/* gold trim edge */}
        <div className="absolute top-0 right-0 bottom-0 w-1.5 bg-gradient-to-b from-amber-400 via-amber-500 to-amber-400 opacity-70" />
      </motion.div>

      {/* right panel */}
      <motion.div
        className="relative h-full w-1/2 flex-shrink-0"
        style={{
          background: 'linear-gradient(255deg, #7f1d1d 0%, #991b1b 40%, #b91c1c 100%)',
          transformOrigin: 'right center',
          boxShadow: 'inset 12px 0 32px rgba(0,0,0,0.25)',
        }}
        variants={{ closed: { scaleX: 1 }, open: { scaleX: 0 } }}
        transition={{ duration: 1.0, delay: 0.5, ease: [0.76, 0, 0.24, 1] }}
      >
        {[20, 40, 60, 80].map(pct => (
          <div key={pct} className="absolute top-0 bottom-0 w-px bg-red-900/30" style={{ left: `${pct}%` }} />
        ))}
        <div className="absolute top-0 left-0 bottom-0 w-1.5 bg-gradient-to-b from-amber-400 via-amber-500 to-amber-400 opacity-70" />
      </motion.div>

      {/* valance bar across top */}
      <motion.div
        className="absolute top-0 left-0 right-0 z-10 flex items-end justify-center"
        style={{ height: 48, background: 'linear-gradient(to bottom, #6b1111, #991b1b)' }}
        variants={{ closed: { opacity: 1 }, open: { opacity: 0 } }}
        transition={{ duration: 0.3, delay: 1.4 }}
      >
        {/* gold tassel trim */}
        <div className="w-full h-1.5" style={{ background: 'linear-gradient(to right, #92400e, #d97706, #fbbf24, #fcd34d, #fbbf24, #d97706, #92400e)' }} />
        {/* tassels */}
        <div className="absolute bottom-0 left-0 right-0 flex justify-around translate-y-full">
          {Array.from({ length: 24 }).map((_, i) => (
            <motion.div key={i} className="w-0.5 bg-amber-400 rounded-b-full opacity-80"
              style={{ height: 12 + Math.sin(i) * 4 }}
              animate={{ scaleY: [1, 0.85, 1] }}
              transition={{ duration: 1.2, delay: i * 0.04, repeat: 1, ease: 'easeInOut' }}
            />
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── primitives ────────────────────────────────────────────────────────────────

const inp = [
  'w-full rounded-xl border border-stone-200 bg-white px-4 py-3',
  'text-sm text-stone-900 placeholder:text-stone-300',
  'focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-100 transition-all',
].join(' ');

// ── main ──────────────────────────────────────────────────────────────────────

export default function AdminLoginPage() {
  const navigate = useNavigate();
  const getPostLoginRoute = () => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      return '/admin/mobile-hub';
    }
    return '/admin/dashboard';
  };
  const [curtainDone, setCurtainDone] = useState(false);
  const [username,    setUsername]    = useState('');
  const [password,    setPassword]    = useState('');
  const [otpCode,     setOtpCode]     = useState('');
  const [setupToken,  setSetupToken]  = useState<string | null>(null);
  const [manualKey,   setManualKey]   = useState<string | null>(null);
  const [otpAuthUrl,  setOtpAuthUrl]  = useState<string | null>(null);
  const [qrImageUrl,  setQrImageUrl]  = useState<string | null>(null);
  const [error,       setError]       = useState<string | null>(null);
  const [loading,     setLoading]     = useState(false);
  const [phase,       setPhase]       = useState<'credentials' | '2fa' | 'setup'>('credentials');

  useEffect(() => {
    let cancelled = false;

    if (!otpAuthUrl) {
      setQrImageUrl(null);
      return () => {
        cancelled = true;
      };
    }

    void toQrCodeDataUrl(otpAuthUrl, 240)
      .then((nextUrl) => {
        if (!cancelled) {
          setQrImageUrl(nextUrl);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setQrImageUrl(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [otpAuthUrl]);

  const submitLogin = async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(apiUrl('/api/admin/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, otpCode: otpCode.trim() || undefined }),
      });
      const result = (await res.json()) as LoginResponse & { error?: string };

      if (!res.ok) {
        if ('twoFactorRequired' in result && result.twoFactorRequired) {
          setPhase('2fa'); setError(result.error || 'Enter the 6-digit code from your authenticator app.'); return;
        }
        throw new Error(result.error || 'Login failed');
      }
      if ('token' in result) {
        if (result.admin?.name) {
          queueAdminPostLoginGreeting(result.admin.name);
        }
        setAdminToken(result.token);
        navigate(getPostLoginRoute(), { replace: true });
        return;
      }
      if ('twoFactorRequired' in result) { setPhase('2fa'); setError('Enter the 6-digit code from your authenticator app.'); return; }
      if ('twoFactorSetupRequired' in result) {
        setSetupToken(result.setupToken);
        setManualKey(result.manualEntryKey);
        setOtpAuthUrl(result.otpAuthUrl);
        setOtpCode('');
        setPhase('setup');
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'Login failed'); }
    finally { setLoading(false); }
  };

  const completeSetup = async () => {
    if (!setupToken) return;
    setLoading(true); setError(null);
    try {
      const result = await apiFetch<{ token: string; admin?: LoginAdmin }>('/api/admin/2fa/setup/complete', {
        method: 'POST', body: JSON.stringify({ setupToken, otpCode: otpCode.trim() }),
      });
      if (result.admin?.name) {
        queueAdminPostLoginGreeting(result.admin.name);
      }
      setAdminToken(result.token);
      navigate(getPostLoginRoute(), { replace: true });
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to finish two-factor setup'); }
    finally { setLoading(false); }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (phase === 'setup') {
      await completeSetup();
      return;
    }

    await submitLogin();
  };

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div
      className="relative min-h-screen bg-stone-50 flex items-center justify-center px-4 overflow-hidden"
      style={{ fontFamily: 'var(--font-sans)' }}
    >
      {/* site top bar */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-red-700 via-red-600 to-amber-400 z-40" />

      {/* curtain */}
      <AnimatePresence>
        {!curtainDone && <Curtain onDone={() => setCurtainDone(true)} />}
      </AnimatePresence>

      {/* bg blobs — same as homepage */}
      <div className="pointer-events-none absolute top-0 right-0 w-[36rem] h-[36rem] bg-red-100 rounded-full mix-blend-multiply blur-3xl opacity-40" />
      <div className="pointer-events-none absolute -bottom-32 left-0 w-96 h-96 bg-amber-100 rounded-full mix-blend-multiply blur-3xl opacity-50" />

      {/* content */}
      <motion.div
        className="relative z-10 w-full max-w-sm"
        initial={{ opacity: 0, y: 20 }}
        animate={curtainDone ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      >
        {/* header */}
        <div className="text-center mb-8">
          <motion.div
            initial={{ scaleX: 0 }}
            animate={curtainDone ? { scaleX: 1 } : { scaleX: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="mx-auto mb-4 h-px w-12 bg-gradient-to-r from-transparent via-red-600 to-transparent"
          />
          <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-red-600 mb-2" style={{ fontFamily: 'var(--font-sans)' }}>
            Penncrest Theater
          </p>
          <h1 className="font-bold text-stone-900 leading-none" style={{ fontFamily: 'var(--font-sans)', fontSize: 'clamp(2rem, 6vw, 2.8rem)' }}>
            Admin Portal
          </h1>
          <AnimatePresence mode="wait">
            <motion.p key={phase}
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
              className="text-sm text-stone-400 mt-2"
            >
              {phase === 'credentials' && 'Sign in with your staff credentials'}
              {phase === '2fa'         && 'Two-factor verification required'}
              {phase === 'setup'       && 'Set up your authenticator app'}
            </motion.p>
          </AnimatePresence>
        </div>

        {/* card */}
        <motion.div
          className="bg-white rounded-3xl border border-stone-100 shadow-xl shadow-stone-200/60 p-7"
          initial={{ opacity: 0, y: 24, scale: 0.97 }}
          animate={curtainDone ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 24, scale: 0.97 }}
          transition={{ duration: 0.55, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
        >
          <form onSubmit={(event) => { void submit(event); }} className="space-y-4">

            <AnimatePresence mode="wait" initial={false}>

              {/* credentials */}
              {phase === 'credentials' && (
                <motion.div key="creds" className="space-y-4"
                  initial={{ opacity: 0, x: -18 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -18 }}
                  transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                >
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-stone-400 mb-1.5">Username</label>
                    <input value={username} onChange={e => setUsername(e.target.value)}
                      placeholder="your username" required autoComplete="username" className={inp} />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-stone-400 mb-1.5">Password</label>
                    <input value={password} onChange={e => setPassword(e.target.value)}
                      type="password" placeholder="••••••••" required autoComplete="current-password" className={inp} />
                  </div>
                </motion.div>
              )}

              {/* 2fa */}
              {phase === '2fa' && (
                <motion.div key="2fa" className="space-y-4"
                  initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -18 }}
                  transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                >
                  <div className="rounded-2xl border border-stone-100 bg-stone-50 px-4 py-4 text-center">
                    <p className="font-bold text-stone-900 mb-1 text-sm" style={{ fontFamily: 'var(--font-sans)' }}>Authenticator Required</p>
                    <p className="text-xs text-stone-400 leading-relaxed">Open your app and enter the 6-digit code for Penncrest Theater.</p>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-stone-400 mb-1.5">6-Digit Code</label>
                    <input value={otpCode} onChange={e => setOtpCode(e.target.value)}
                      inputMode="numeric" pattern="[0-9]*" placeholder="000 000" required autoFocus
                      className={inp + ' text-center text-2xl tracking-[0.5em] font-sans'} />
                  </div>
                  <button type="button" onClick={() => { setOtpCode(''); setPhase('credentials'); setError(null); }}
                    className="w-full text-center text-xs text-stone-400 hover:text-red-700 transition">
                    ← Back to credentials
                  </button>
                </motion.div>
              )}

              {/* setup */}
              {phase === 'setup' && (
                <motion.div key="setup" className="space-y-4"
                  initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -18 }}
                  transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                >
                  <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-amber-600 mb-1">Setup Required</p>
                    <p className="text-sm text-stone-600 leading-relaxed">Scan this QR code with Google Authenticator, Authy, or 1Password.</p>
                  </div>
                  {qrImageUrl && (
                    <motion.div initial={{ opacity: 0, scale: 0.93 }} animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.35, delay: 0.1 }} className="flex justify-center">
                      <div className="rounded-2xl border border-stone-100 bg-white p-3 shadow-md shadow-stone-100">
                        <img src={qrImageUrl} alt="QR code" className="w-44 h-44 rounded-xl" />
                      </div>
                    </motion.div>
                  )}
                  {manualKey && (
                    <div className="rounded-xl border border-stone-100 bg-stone-50 p-3">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-stone-400 mb-1.5">Manual entry key</p>
                      <p className="font-sans text-xs text-stone-700 break-all leading-relaxed">{manualKey}</p>
                    </div>
                  )}
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-stone-400 mb-1.5">Verification Code</label>
                    <input value={otpCode} onChange={e => setOtpCode(e.target.value)}
                      inputMode="numeric" pattern="[0-9]*" placeholder="000 000" required autoFocus
                      className={inp + ' text-center text-2xl tracking-[0.5em] font-sans'} />
                  </div>
                </motion.div>
              )}

            </AnimatePresence>

            {/* error */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.22 }} className="overflow-hidden"
                >
                  <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* button */}
            <motion.button
              type="submit"
              disabled={loading}
              whileHover={{ scale: 1.015 }}
              whileTap={{ scale: 0.985 }}
              className="relative w-full overflow-hidden rounded-full bg-red-700 py-3.5 text-sm font-semibold text-white hover:bg-red-800 transition-colors disabled:opacity-50 shadow-md shadow-red-100"
            >
              {/* shimmer sweep */}
              <motion.div
                className="absolute inset-0 -skew-x-12 pointer-events-none"
                style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent)' }}
                animate={{ x: ['-120%', '220%'] }}
                transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut', repeatDelay: 1.8 }}
              />
              <AnimatePresence mode="wait" initial={false}>
                <motion.span key={`${phase}-${loading}`}
                  initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.18 }}
                  className="relative inline-flex items-center justify-center gap-2"
                >
                  {loading && (
                    <motion.span animate={{ rotate: 360 }} transition={{ duration: 0.75, repeat: Infinity, ease: 'linear' }}
                      className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full" />
                  )}
                  {loading
                    ? (phase === 'setup' ? 'Finishing setup…' : 'Signing in…')
                    : (phase === 'setup' ? 'Finish 2FA Setup' : phase === '2fa' ? 'Verify Code' : 'Sign In')
                  }
                </motion.span>
              </AnimatePresence>
            </motion.button>

          </form>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }} animate={curtainDone ? { opacity: 1 } : { opacity: 0 }}
          transition={{ delay: 0.5, duration: 0.4 }}
          className="mt-6 text-center text-xs text-stone-400"
        >
          Penncrest High School Theater · Staff access only
        </motion.p>
      </motion.div>
    </div>
  );
}
