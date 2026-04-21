import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe, type StripeElementsOptions } from '@stripe/stripe-js';
import { AnimatePresence, motion } from 'motion/react';
import {
  CheckCircle2,
  CreditCard,
  Heart,
  Loader2,
  ArrowRight,
  ArrowUpRight,
  Sparkles,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  fundraisingDonationOptions,
  fundraisingSponsors,
  type FundraisingDonationOption,
  type FundraisingDonationOptionLevel,
} from '../lib/fundraisingContent';
import { apiFetch } from '../lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

type LiveFundraisingSponsor = {
  id: string;
  name: string;
  tier: 'Balcony' | 'Mezzanine' | 'Orchestra' | 'Center Stage';
  logoUrl: string;
  imageUrl: string;
  spotlight: string;
  websiteUrl: string;
};

type DonationIntentResponse = {
  paymentIntentId: string;
  clientSecret: string;
  publishableKey?: string;
  amountCents: number;
  currency: string;
};

type ActiveDonationIntent = {
  paymentIntentId: string;
  clientSecret: string;
  publishableKey: string;
  amountCents: number;
};

type DonationOptionsResponse = {
  options: FundraisingDonationOption[];
};

// ─── Constants ────────────────────────────────────────────────────────────────

const FALLBACK_STRIPE_PUBLISHABLE_KEY = (import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '').trim();

const HEART_PARTICLES = [
  { left: '8%',  size: 1.2, delay: '0s',    dur: '4.9s' },
  { left: '16%', size: 1.8, delay: '0.35s', dur: '5.8s' },
  { left: '24%', size: 1.4, delay: '0.8s',  dur: '5.2s' },
  { left: '34%', size: 2.2, delay: '1.1s',  dur: '6.1s' },
  { left: '45%', size: 1.3, delay: '0.2s',  dur: '5.3s' },
  { left: '55%', size: 1.9, delay: '1.4s',  dur: '5.9s' },
  { left: '64%', size: 1.5, delay: '0.6s',  dur: '5.1s' },
  { left: '73%', size: 2.1, delay: '1.2s',  dur: '6.2s' },
  { left: '83%', size: 1.4, delay: '0.9s',  dur: '5.5s' },
  { left: '92%', size: 1.7, delay: '0.45s', dur: '5.7s' },
] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function parseDonationInputToCents(value: string): number | null {
  const normalized = value.replace(/[^\d.]/g, '').trim();
  if (!normalized) return null;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const cents = Math.round(amount * 100);
  if (cents < 100) return null;
  return cents;
}

function tierAccent(tier: LiveFundraisingSponsor['tier']): string {
  if (tier === 'Center Stage') return 'bg-red-800 text-white';
  if (tier === 'Orchestra')    return 'bg-amber-100 text-amber-800';
  if (tier === 'Mezzanine')    return 'bg-stone-200 text-stone-700';
  return 'bg-orange-100 text-orange-800';
}

// ─── Stripe payment form sub-component ───────────────────────────────────────

function DonationPaymentForm({
  amountCents, donorName, donorEmail, onSuccess, onError,
}: {
  amountCents: number;
  donorName: string;
  donorEmail: string;
  onSuccess: () => void;
  onError: (message: string | null) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onError(null);
    if (!stripe || !elements) {
      onError('Payment form is still loading. Please try again.');
      return;
    }
    setSubmitting(true);
    const result = await stripe.confirmPayment({
      elements,
      confirmParams: { payment_method_data: { billing_details: { name: donorName, email: donorEmail } } },
      redirect: 'if_required',
    });
    setSubmitting(false);
    if (result.error) { onError(result.error.message || 'Payment could not be completed.'); return; }
    const status = result.paymentIntent?.status;
    if (status === 'succeeded' || status === 'processing' || status === 'requires_capture') {
      onSuccess();
      return;
    }
    onError(`Payment did not complete. Status: ${status || 'unknown'}.`);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="rounded-xl border border-stone-200 bg-white p-4">
        <PaymentElement />
      </div>
      <button
        type="submit"
        disabled={submitting || !stripe || !elements}
        className="donate-btn w-full"
      >
        {submitting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <CreditCard className="h-4 w-4" />
        )}
        Donate {formatUsd(amountCents)}
      </button>
    </form>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Fundraising() {
  const [liveSponsors, setLiveSponsors] = useState<LiveFundraisingSponsor[]>([]);
  const [sponsorLoadFailed, setSponsorLoadFailed] = useState(false);
  const [donationOptions, setDonationOptions] = useState<FundraisingDonationOption[]>(fundraisingDonationOptions);
  const [selectedDonationOptionId, setSelectedDonationOptionId] = useState<string>(fundraisingDonationOptions[0]?.id || '');
  const [selectedDonationLevelId, setSelectedDonationLevelId] = useState<string | null>(null);
  const [selectedDonationAmountCents, setSelectedDonationAmountCents] = useState<number | null>(null);
  const [donorName, setDonorName] = useState('');
  const [donorEmail, setDonorEmail] = useState('');
  const [donorRecognitionPreference, setDonorRecognitionPreference] = useState<'known' | 'anonymous'>('known');
  const [customDonationAmount, setCustomDonationAmount] = useState('');
  const [activeDonationIntent, setActiveDonationIntent] = useState<ActiveDonationIntent | null>(null);
  const [donationIntentLoading, setDonationIntentLoading] = useState(false);
  const [donationError, setDonationError] = useState<string | null>(null);
  const [donationSuccessMessage, setDonationSuccessMessage] = useState<string | null>(null);
  const [showDonationCelebration, setShowDonationCelebration] = useState(false);
  const [lastDonationAmountCents, setLastDonationAmountCents] = useState<number | null>(null);
  const customAmountInputRef = useRef<HTMLInputElement | null>(null);

  // Load sponsors
  useEffect(() => {
    apiFetch<LiveFundraisingSponsor[]>('/api/fundraising/sponsors')
      .then((items) => {
        if (Array.isArray(items)) { setLiveSponsors(items); setSponsorLoadFailed(false); }
      })
      .catch(() => { setLiveSponsors([]); setSponsorLoadFailed(true); });
  }, []);

  // Load donation options
  useEffect(() => {
    apiFetch<DonationOptionsResponse>('/api/fundraising/donation-options')
      .then((payload) => {
        const options = Array.isArray(payload?.options) ? payload.options : [];
        if (options.length === 0) return;
        setDonationOptions(options);
        setSelectedDonationOptionId((current) =>
          options.some((o) => o.id === current) ? current : options[0].id
        );
      })
      .catch(() => {
        setDonationOptions(fundraisingDonationOptions);
        setSelectedDonationOptionId((current) =>
          fundraisingDonationOptions.some((o) => o.id === current)
            ? current
            : fundraisingDonationOptions[0]?.id || ''
        );
      });
  }, []);

  // Auto-dismiss celebration
  useEffect(() => {
    if (!showDonationCelebration) return;
    const t = window.setTimeout(() => setShowDonationCelebration(false), 6200);
    return () => window.clearTimeout(t);
  }, [showDonationCelebration]);

  const displayedSponsors = liveSponsors.length > 0
    ? liveSponsors
    : sponsorLoadFailed ? fundraisingSponsors : [];

  const selectedDonationOption = useMemo(
    () => donationOptions.find((o) => o.id === selectedDonationOptionId) ?? donationOptions[0] ?? null,
    [donationOptions, selectedDonationOptionId]
  );
  const selectedDonationLevels = selectedDonationOption?.levels || [];
  const selectedDonationLevel = useMemo(
    () => selectedDonationLevels.find((l) => l.id === selectedDonationLevelId) || null,
    [selectedDonationLevels, selectedDonationLevelId]
  );
  const isOtherDonationSelected = selectedDonationLevelId === null;

  // Reset level if option changes and level no longer exists
  useEffect(() => {
    if (!selectedDonationOption) return;
    if (selectedDonationLevelId && !selectedDonationOption.levels.some((l) => l.id === selectedDonationLevelId)) {
      setSelectedDonationLevelId(null);
      setSelectedDonationAmountCents(null);
      setActiveDonationIntent(null);
    }
  }, [selectedDonationLevelId, selectedDonationOption]);

  const donationStripePromise = useMemo(() => {
    if (!activeDonationIntent?.publishableKey) return null;
    return loadStripe(activeDonationIntent.publishableKey);
  }, [activeDonationIntent?.publishableKey]);

  const donationStripeOptions = useMemo<StripeElementsOptions | null>(() => {
    if (!activeDonationIntent?.clientSecret) return null;
    return { clientSecret: activeDonationIntent.clientSecret, appearance: { theme: 'stripe' } };
  }, [activeDonationIntent?.clientSecret]);

  const requestDonationIntent = async (amountCents: number, level: FundraisingDonationOptionLevel | null) => {
    const name = donorName.trim();
    const email = donorEmail.trim().toLowerCase();
    if (!name) { setDonationError('Please enter your name before donating.'); return; }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setDonationError('Please enter a valid email address for your receipt.'); return;
    }
    const activeOption = selectedDonationOption;
    if (!activeOption) { setDonationError('Donation options are still loading. Please try again.'); return; }
    setDonationSuccessMessage(null);
    setDonationError(null);
    setSelectedDonationAmountCents(amountCents);
    setSelectedDonationLevelId(level?.id || null);
    setDonationIntentLoading(true);
    try {
      const response = await apiFetch<DonationIntentResponse>('/api/fundraising/donations/intent', {
        method: 'POST',
        body: JSON.stringify({
          amountCents, donorName: name, donorEmail: email, donorRecognitionPreference,
          donationOptionId: activeOption.id, donationOptionName: activeOption.name,
          donationLevelId: level?.id, donationLevelTitle: level?.title,
          donationLevelAmountLabel: level?.amountLabel,
        }),
      });
      const publishableKey = (response.publishableKey || FALLBACK_STRIPE_PUBLISHABLE_KEY || '').trim();
      if (!publishableKey) throw new Error('Stripe publishable key is missing.');
      setActiveDonationIntent({
        paymentIntentId: response.paymentIntentId,
        clientSecret: response.clientSecret,
        publishableKey,
        amountCents: response.amountCents,
      });
    } catch (err) {
      setActiveDonationIntent(null);
      setDonationError(err instanceof Error ? err.message : 'We could not start donation checkout.');
    } finally {
      setDonationIntentLoading(false);
    }
  };

  const handleOtherDonationSelect = () => {
    setSelectedDonationAmountCents(null);
    setActiveDonationIntent(null);
    setSelectedDonationLevelId(null);
    setDonationError(null);
    setDonationSuccessMessage(null);
    requestAnimationFrame(() => customAmountInputRef.current?.focus());
  };

  const applyCustomDonationAmount = () => {
    const amountCents = parseDonationInputToCents(customDonationAmount);
    if (!amountCents) { setDonationError('Enter a valid donation amount of at least $1.00.'); return; }
    void requestDonationIntent(amountCents, null);
  };

  return (
    <>
      <style>{`
        .fund-root { font-family: var(--font-sans); background: #fafaf9; color: #1c1917; }
        .fund-serif { font-family: ui-serif, Georgia, Cambria, "Times New Roman", Times, serif; }

        /* Buttons */
        .donate-btn {
          display: inline-flex; align-items: center; justify-content: center;
          gap: 0.5rem; padding: 0.75rem 1.5rem; border-radius: 9999px;
          background: #b91c1c; color: #fff; font-weight: 700; font-size: 0.875rem;
          letter-spacing: 0.02em; transition: background 0.2s, transform 0.15s, box-shadow 0.2s;
          border: none; cursor: pointer;
        }
        .donate-btn:hover:not(:disabled) { background: #991b1b; box-shadow: 0 4px 20px rgba(185, 28, 28, 0.3); transform: translateY(-1px); }
        .donate-btn:disabled { opacity: 0.55; cursor: not-allowed; }

        .pill-btn {
          display: inline-flex; align-items: center; gap: 0.4rem;
          padding: 0.5rem 1.125rem; border-radius: 9999px;
          border: 1.5px solid #d6d3d1; background: #fff; color: #57534e;
          font-size: 0.8125rem; font-weight: 700; letter-spacing: 0.01em;
          transition: all 0.18s; cursor: pointer;
        }
        .pill-btn:hover { border-color: #b91c1c; color: #b91c1c; background: #fef2f2; }
        .pill-btn.active { border-color: #b91c1c; background: #b91c1c; color: #fff; }

        .fund-input {
          width: 100%; border-radius: 0.75rem; border: 1.5px solid #e7e5e4;
          background: #fff; padding: 0.65rem 1rem; font-size: 0.875rem; font-weight: 400;
          font-family: var(--font-sans); color: #1c1917; transition: border 0.18s, box-shadow 0.18s;
          outline: none;
        }
        .fund-input::placeholder { color: #a8a29e; }
        .fund-input:focus { border-color: #b91c1c; box-shadow: 0 0 0 3px rgba(185, 28, 28, 0.12); }

        /* Hero */
        .hero-bg {
          background: linear-gradient(160deg, #292524 0%, #7f1d1d 45%, #1c1917 100%);
          position: relative; overflow: hidden;
        }
        .hero-bg::before {
          content: ''; position: absolute; inset: 0;
          background-image: radial-gradient(circle at 70% 40%, rgba(220,38,38,0.12) 0%, transparent 55%),
                            radial-gradient(circle at 20% 80%, rgba(120,53,15,0.15) 0%, transparent 50%);
          pointer-events: none;
        }
        .hero-rule { width: 3rem; height: 2px; background: #dc2626; margin-bottom: 1.5rem; }

        /* Curtain divider */
        .curtain-divider {
          position: relative; height: 3px;
          background: linear-gradient(90deg, transparent, #b91c1c 30%, #ef4444 50%, #b91c1c 70%, transparent);
        }

        /* Sponsor ticker */
        .ticker-track { display: flex; gap: 1.5rem; align-items: center; }

        /* Level card */
        .level-card {
          border-radius: 1rem; border: 1.5px solid #e7e5e4; background: #fff;
          padding: 1.25rem 1.5rem; cursor: pointer;
          transition: border-color 0.2s, box-shadow 0.2s, transform 0.15s;
        }
        .level-card:hover { border-color: #fca5a5; box-shadow: 0 4px 16px rgba(185, 28, 28, 0.1); transform: translateY(-1px); }
        .level-card.selected { border-color: #b91c1c; box-shadow: 0 0 0 3px rgba(185, 28, 28, 0.14), 0 4px 16px rgba(185, 28, 28, 0.12); }

        /* Celebration overlay */
        .celebration-bg {
          background: radial-gradient(circle at 20% 25%, rgba(185,28,28,0.28) 0%, rgba(127,29,29,0.18) 35%, rgba(12,10,9,0.85) 100%);
          backdrop-filter: blur(6px);
        }
        .heart-particle {
          position: absolute; bottom: -56px; color: rgba(254,226,226,0.92);
          animation: heart-rise linear infinite; user-select: none; pointer-events: none;
        }
        .heart-particle.alt {
          color: rgba(252,165,165,0.88);
          animation-name: heart-rise-alt;
        }
        .heart-beat { animation: heart-beat 1.2s ease-in-out infinite; }
        @keyframes heart-rise {
          0%   { transform: translate3d(0,0,0) scale(0.6) rotate(0deg); opacity: 0; }
          12%  { opacity: 0.95; }
          100% { transform: translate3d(0,-88vh,0) scale(1.2) rotate(12deg); opacity: 0; }
        }
        @keyframes heart-rise-alt {
          0%   { transform: translate3d(0,0,0) scale(0.65) rotate(-8deg); opacity: 0; }
          15%  { opacity: 0.95; }
          100% { transform: translate3d(0,-84vh,0) scale(1.25) rotate(-18deg); opacity: 0; }
        }
        @keyframes heart-beat {
          0%, 100% { transform: scale(1); }
          35%  { transform: scale(1.14); }
          65%  { transform: scale(0.96); }
        }

        /* No scrollbar utility */
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>

      <div className="fund-root">

        {/* ── CELEBRATION OVERLAY ─────────────────────────────────────────── */}
        <AnimatePresence>
          {showDonationCelebration && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[130] flex items-center justify-center p-4"
              role="dialog"
              aria-modal="true"
              aria-label="Donation thank you"
            >
              <div className="celebration-bg absolute inset-0" />
              <div className="pointer-events-none absolute inset-0 overflow-hidden">
                {HEART_PARTICLES.map((h, i) => (
                  <span
                    key={`${h.left}-${h.delay}`}
                    className={`heart-particle ${i % 2 === 0 ? 'alt' : ''}`}
                    style={{ left: h.left, fontSize: `${h.size}rem`, animationDelay: h.delay, animationDuration: h.dur }}
                    aria-hidden="true"
                  >♥</span>
                ))}
              </div>
              <motion.div
                initial={{ opacity: 0, y: 24, scale: 0.94 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12, scale: 0.97 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                className="relative w-full max-w-sm rounded-3xl border border-red-100 bg-white p-8 text-center shadow-2xl"
              >
                <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 text-red-700">
                  <Heart className="heart-beat h-8 w-8 fill-current" />
                </div>
                <p style={{ fontFamily: 'var(--font-sans)', letterSpacing: '0.18em' }} className="text-xs font-bold uppercase text-red-700">Donation Received</p>
                <h3 className="fund-serif mt-2 text-3xl font-bold text-stone-900">Thank You!</h3>
                <p className="mt-3 text-sm leading-relaxed text-stone-500">
                  {lastDonationAmountCents
                    ? `Your ${formatUsd(lastDonationAmountCents)} gift helps Penncrest Theater students shine on stage.`
                    : 'Your gift helps Penncrest Theater students shine on stage.'}
                </p>
                <button type="button" onClick={() => setShowDonationCelebration(false)} className="donate-btn mt-6">
                  Continue
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── HERO ─────────────────────────────────────────────────────────── */}
        <section className="hero-bg px-4 pb-20 pt-16 sm:px-6 lg:px-8 sm:pb-28 sm:pt-24">
          <div className="mx-auto max-w-7xl">
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55 }}>
              <div className="hero-rule" />
              <p style={{ letterSpacing: '0.22em', color: '#fca5a5' }} className="mb-4 text-xs font-bold uppercase">
                Penncrest Theater · Fundraising
              </p>
              <h1 className="fund-serif text-5xl font-black leading-none text-white sm:text-7xl lg:text-8xl">
                Support<br />
                <em style={{ color: '#f87171' }} className="not-italic">the Stage.</em>
              </h1>
              <p className="mt-6 max-w-md text-sm leading-relaxed" style={{ color: '#d6d3d1' }}>
                Your generosity puts students in the spotlight. From costumes to set design, every gift makes
                Penncrest Theater possible.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <a href="#donate" className="donate-btn">
                  Donate Now <ArrowRight className="h-4 w-4" />
                </a>
                <Link
                  to="/shows/community-events"
                  style={{ color: '#fca5a5', borderColor: 'rgba(252,165,165,0.35)', background: 'rgba(255,255,255,0.06)' }}
                  className="inline-flex items-center gap-2 rounded-full border px-5 py-3 text-sm font-bold transition hover:bg-white/10"
                >
                  Community Events <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </motion.div>
          </div>
        </section>

        <div className="curtain-divider" />

        {/* ── SPONSOR STRIP ─────────────────────────────────────────────────── */}
        {displayedSponsors.length > 0 && (
          <div style={{ background: '#fff', borderBottom: '1px solid #f5f5f4' }} className="py-4">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
              <div className="no-scrollbar flex items-center gap-4 overflow-x-auto">
                <span style={{ letterSpacing: '0.16em', color: '#a8a29e', whiteSpace: 'nowrap' }}
                  className="flex-none text-xs font-bold uppercase">
                  Our Sponsors
                </span>
                <div style={{ width: 1, height: '1.25rem', background: '#e7e5e4' }} className="flex-none" />
                {displayedSponsors.map((sponsor) => (
                  <a
                    key={sponsor.id}
                    href={sponsor.websiteUrl}
                    target="_blank"
                    rel="noreferrer"
                    style={{ border: '1px solid #f5f5f4' }}
                    className="flex-none rounded-xl bg-stone-50 px-4 py-2 transition hover:bg-white hover:shadow-sm"
                  >
                    <img
                      src={sponsor.logoUrl}
                      alt={sponsor.name}
                      className="h-6 w-auto min-w-[72px] object-contain opacity-60 transition hover:opacity-100"
                    />
                  </a>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── DONATE SECTION ─────────────────────────────────────────────────── */}
        <section id="donate" className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8 max-sm:py-12">

          {/* Heading */}
          <div className="mb-12">
            <p style={{ letterSpacing: '0.2em', color: '#dc2626' }} className="mb-2 text-xs font-bold uppercase">
              Make a Donation
            </p>
            <h2 className="fund-serif text-4xl font-black text-stone-900 sm:text-5xl leading-tight">
              Choose how you'd<br className="hidden sm:block" /> like to give.
            </h2>
          </div>

          {/* Donation path selector */}
          {donationOptions.length > 1 && (
            <div className="mb-8 flex flex-wrap gap-2">
              {donationOptions.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => {
                    setSelectedDonationOptionId(option.id);
                    setSelectedDonationLevelId(null);
                    setSelectedDonationAmountCents(null);
                    setActiveDonationIntent(null);
                    setDonationError(null);
                    setDonationSuccessMessage(null);
                  }}
                  className={`pill-btn ${selectedDonationOption?.id === option.id ? 'active' : ''}`}
                >
                  {option.name}
                </button>
              ))}
            </div>
          )}
          {selectedDonationOption?.description && (
            <p className="mb-10 -mt-2 text-sm text-stone-500 max-w-lg">{selectedDonationOption.description}</p>
          )}

          <motion.div
            key={selectedDonationOption?.id || 'donation'}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22 }}
          >
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">

              {/* ── FORM COLUMN ── */}
              <div className="lg:col-span-7 space-y-5">

                {/* Step 1 – Your info */}
                <div style={{ border: '1.5px solid #e7e5e4', borderRadius: '1.25rem', background: '#fff' }} className="p-6 sm:p-7">
                  <div className="mb-5 flex items-start gap-3">
                    <div style={{ background: '#b91c1c', borderRadius: '50%', width: 28, height: 28, flexShrink: 0 }}
                      className="flex items-center justify-center text-white text-xs font-black mt-0.5">1</div>
                    <div>
                      <h3 className="fund-serif text-lg font-bold text-stone-900">Your Information</h3>
                      <p className="text-xs text-stone-400 mt-0.5">We'll send your receipt and thank-you note here.</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <input
                      type="text"
                      value={donorName}
                      onChange={(e) => setDonorName(e.target.value)}
                      placeholder="Full name"
                      className="fund-input"
                    />
                    <input
                      type="email"
                      value={donorEmail}
                      onChange={(e) => setDonorEmail(e.target.value)}
                      placeholder="Email for receipt"
                      className="fund-input"
                    />
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wide text-stone-400">Recognition:</span>
                    <div style={{ background: '#f5f5f4', borderRadius: '9999px', padding: '3px', display: 'inline-flex', gap: 2 }}>
                      {(['known', 'anonymous'] as const).map((pref) => (
                        <button
                          key={pref}
                          type="button"
                          onClick={() => setDonorRecognitionPreference(pref)}
                          style={{
                            borderRadius: '9999px', padding: '0.3rem 0.875rem',
                            fontSize: '0.75rem', fontWeight: 700, border: 'none', cursor: 'pointer',
                            transition: 'all 0.18s',
                            background: donorRecognitionPreference === pref ? '#b91c1c' : 'transparent',
                            color: donorRecognitionPreference === pref ? '#fff' : '#78716c',
                          }}
                        >
                          {pref === 'known' ? 'List my name' : 'Stay anonymous'}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-stone-400">
                      {donorRecognitionPreference === 'known'
                        ? 'You may appear in playbills & donor acknowledgments.'
                        : 'Your name will be kept private.'}
                    </p>
                  </div>
                </div>

                {/* Step 2 – Choose amount */}
                <div style={{ border: '1.5px solid #e7e5e4', borderRadius: '1.25rem', background: '#fff' }} className="p-6 sm:p-7">
                  <div className="mb-5 flex items-start gap-3">
                    <div style={{ background: '#b91c1c', borderRadius: '50%', width: 28, height: 28, flexShrink: 0 }}
                      className="flex items-center justify-center text-white text-xs font-black mt-0.5">2</div>
                    <div>
                      <h3 className="fund-serif text-lg font-bold text-stone-900">Choose an Amount</h3>
                      <p className="text-xs text-stone-400 mt-0.5">Select a suggested level or enter a custom amount.</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 mb-4">
                    {selectedDonationLevels.map((level) => (
                      <button
                        key={level.id}
                        type="button"
                        onClick={() => void requestDonationIntent(level.suggestedAmountCents, level)}
                        className={`pill-btn ${selectedDonationLevelId === level.id && selectedDonationAmountCents === level.suggestedAmountCents ? 'active' : ''}`}
                      >
                        {level.amountLabel}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={handleOtherDonationSelect}
                      className={`pill-btn ${isOtherDonationSelected ? 'active' : ''}`}
                    >
                      Custom
                    </button>
                  </div>

                  <div className="flex gap-2 max-sm:flex-col">
                    <div className="relative flex-1">
                      <span style={{ position: 'absolute', left: '0.875rem', top: '50%', transform: 'translateY(-50%)', fontSize: '0.875rem', fontWeight: 700, color: '#a8a29e', pointerEvents: 'none' }}>$</span>
                      <input
                        ref={customAmountInputRef}
                        type="text"
                        inputMode="decimal"
                        placeholder="Other amount"
                        value={customDonationAmount}
                        onChange={(e) => { setCustomDonationAmount(e.target.value); setSelectedDonationLevelId(null); }}
                        style={{ paddingLeft: '2rem' }}
                        className="fund-input"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={applyCustomDonationAmount}
                      style={{ borderRadius: '0.75rem', border: '1.5px solid #e7e5e4', background: '#faf9f7', padding: '0.65rem 1.25rem', fontSize: '0.875rem', fontWeight: 700, color: '#57534e', cursor: 'pointer', transition: 'all 0.18s', whiteSpace: 'nowrap' }}
                      className="max-sm:w-full hover:border-red-300 hover:text-red-700 hover:bg-red-50"
                    >
                      Apply
                    </button>
                  </div>

                  {/* Error */}
                  {donationError && (
                    <div style={{ marginTop: '1rem', borderRadius: '0.75rem', border: '1px solid #fecaca', background: '#fef2f2', padding: '0.75rem 1rem', fontSize: '0.875rem', color: '#b91c1c' }}>
                      {donationError}
                    </div>
                  )}

                  {/* Success */}
                  {donationSuccessMessage && !showDonationCelebration && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.97 }}
                      animate={{ opacity: 1, scale: 1 }}
                      style={{ marginTop: '1rem', borderRadius: '0.75rem', border: '1px solid #bbf7d0', background: '#f0fdf4', padding: '0.75rem 1rem', display: 'flex', gap: '0.625rem', alignItems: 'flex-start' }}
                    >
                      <CheckCircle2 style={{ marginTop: 2, flexShrink: 0, color: '#16a34a', width: 16, height: 16 }} />
                      <p style={{ fontSize: '0.875rem', fontWeight: 700, color: '#15803d' }}>{donationSuccessMessage}</p>
                    </motion.div>
                  )}

                  {/* Loading */}
                  {donationIntentLoading && (
                    <div style={{ marginTop: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', color: '#78716c' }}>
                      <Loader2 style={{ width: 16, height: 16, color: '#b91c1c', animation: 'spin 1s linear infinite' }} />
                      Loading secure payment form…
                    </div>
                  )}
                </div>

                {/* Step 3 – Payment */}
                {activeDonationIntent && donationStripePromise && donationStripeOptions && !donationIntentLoading && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    style={{ border: '1.5px solid #fecaca', borderRadius: '1.25rem', background: '#fff' }}
                    className="p-6 sm:p-7"
                  >
                    <div className="mb-5 flex items-start gap-3">
                      <div style={{ background: '#b91c1c', borderRadius: '50%', width: 28, height: 28, flexShrink: 0 }}
                        className="flex items-center justify-center text-white text-xs font-black mt-0.5">3</div>
                      <div className="flex-1 flex items-start justify-between gap-2">
                        <div>
                          <h3 className="fund-serif text-lg font-bold text-stone-900">Complete Payment</h3>
                          <p className="text-xs text-stone-400 mt-0.5">
                            Donating {formatUsd(activeDonationIntent.amountCents)}
                            {selectedDonationLevel ? ` · ${selectedDonationLevel.title}` : ''}
                          </p>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.7rem', fontWeight: 700, color: '#a8a29e', letterSpacing: '0.1em', textTransform: 'uppercase', whiteSpace: 'nowrap', marginTop: 4 }}>
                          <CreditCard style={{ width: 12, height: 12 }} /> Secure
                        </div>
                      </div>
                    </div>
                    <Elements
                      stripe={donationStripePromise}
                      options={donationStripeOptions}
                      key={activeDonationIntent.paymentIntentId}
                    >
                      <DonationPaymentForm
                        amountCents={activeDonationIntent.amountCents}
                        donorName={donorName.trim()}
                        donorEmail={donorEmail.trim().toLowerCase()}
                        onSuccess={() => {
                          setLastDonationAmountCents(activeDonationIntent.amountCents);
                          setShowDonationCelebration(true);
                          setDonationSuccessMessage(`Thank you! Your ${formatUsd(activeDonationIntent.amountCents)} donation was received.`);
                          setActiveDonationIntent(null);
                          setDonationError(null);
                        }}
                        onError={setDonationError}
                      />
                    </Elements>
                  </motion.div>
                )}
              </div>

              {/* ── LEVELS SIDEBAR ── */}
              <div className="lg:col-span-5 space-y-3">
                <p style={{ letterSpacing: '0.16em', color: '#a8a29e' }} className="text-xs font-bold uppercase mb-1">
                  {selectedDonationOption?.name || 'Donation'} Levels
                </p>
                {selectedDonationLevels.length === 0 ? (
                  <div style={{ borderRadius: '1rem', border: '1.5px dashed #e7e5e4', background: '#faf9f7', padding: '1.25rem', fontSize: '0.875rem', color: '#a8a29e' }}>
                    No levels configured for this option yet.
                  </div>
                ) : (
                  selectedDonationLevels.map((card, i) => (
                    <motion.article
                      key={card.id}
                      initial={{ opacity: 0, x: 12 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.3, delay: i * 0.07 }}
                      onClick={() => void requestDonationIntent(card.suggestedAmountCents, card)}
                      className={`level-card ${selectedDonationLevelId === card.id ? 'selected' : ''}`}
                    >
                      <p style={{ fontSize: '0.7rem', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#dc2626', marginBottom: '0.25rem' }}>
                        {card.amountLabel}
                      </p>
                      <h3 className="fund-serif" style={{ fontSize: '1rem', fontWeight: 700, color: '#1c1917', marginBottom: '0.375rem' }}>
                        {card.title}
                      </h3>
                      <p style={{ fontSize: '0.8125rem', lineHeight: 1.65, color: '#78716c' }}>{card.detail}</p>
                    </motion.article>
                  ))
                )}

                {/* Impact note */}
                <div style={{ borderRadius: '1rem', background: 'linear-gradient(135deg, #fef2f2, #fff5f5)', border: '1.5px solid #fecaca', padding: '1.25rem 1.5rem', marginTop: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                    <Sparkles style={{ width: 14, height: 14, color: '#dc2626' }} />
                    <span style={{ fontSize: '0.7rem', fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#dc2626' }}>Your Impact</span>
                  </div>
                  <p style={{ fontSize: '0.8125rem', lineHeight: 1.7, color: '#78716c' }}>
                    Every gift — large or small — directly funds costumes, set construction, lighting, sound,
                    and the unforgettable experiences that shape Penncrest students for life.
                  </p>
                </div>
              </div>

            </div>
          </motion.div>
        </section>

        {/* ── SPONSORS GRID ──────────────────────────────────────────────────── */}
        {displayedSponsors.length > 0 && (
          <section style={{ background: '#faf9f7', borderTop: '1.5px solid #f5f5f4' }} className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
            <div className="mb-8">
              <p style={{ letterSpacing: '0.2em', color: '#a8a29e' }} className="mb-2 text-xs font-bold uppercase">
                Community Partners
              </p>
              <h2 className="fund-serif text-3xl font-black text-stone-900">Our Sponsors</h2>
            </div>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
              {displayedSponsors.map((sponsor) => (
                <article
                  key={sponsor.id}
                  style={{ borderRadius: '1.25rem', border: '1.5px solid #e7e5e4', background: '#fff', overflow: 'hidden', transition: 'box-shadow 0.2s' }}
                  className="hover:shadow-lg"
                >
                  <div className="relative">
                    <img
                      src={sponsor.imageUrl}
                      alt={`${sponsor.name} spotlight`}
                      style={{ width: '100%', height: '11rem', objectFit: 'cover', display: 'block' }}
                    />
                    <div
                      className={`absolute left-3 top-3 rounded-full px-3 py-1 text-xs font-black uppercase tracking-wide ${tierAccent(sponsor.tier)}`}
                      style={{ letterSpacing: '0.1em' }}
                    >
                      {sponsor.tier}
                    </div>
                  </div>
                  <div style={{ padding: '1.25rem 1.5rem' }}>
                    <img
                      src={sponsor.logoUrl}
                      alt={sponsor.name}
                      style={{ height: '2.25rem', width: 'auto', objectFit: 'contain', marginBottom: '0.75rem' }}
                    />
                    <p style={{ fontSize: '0.8125rem', lineHeight: 1.7, color: '#78716c' }}>{sponsor.spotlight}</p>
                    <a
                      href={sponsor.websiteUrl}
                      target="_blank"
                      rel="noreferrer"
                      style={{ marginTop: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.8125rem', fontWeight: 700, color: '#b91c1c', transition: 'color 0.15s' }}
                      className="hover:text-red-900"
                    >
                      Visit Website <ArrowUpRight style={{ width: 13, height: 13 }} />
                    </a>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

      </div>
    </>
  );
}