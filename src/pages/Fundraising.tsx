import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe, type StripeElementsOptions } from '@stripe/stripe-js';
import { AnimatePresence, motion } from 'motion/react';
import {
  CheckCircle2,
  CreditCard,
  HandCoins,
  Heart,
  HeartHandshake,
  Loader2,
  Mail,
  ArrowRight,
  Star
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  donationLevels,
  fundraisingSponsors,
  sponsorshipTiers
} from '../lib/fundraisingContent';
import { apiFetch } from '../lib/api';
 
type FundraisingTab = 'donation' | 'sponsor';

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

const DONATION_PRESET_AMOUNTS_CENTS = [500, 1000, 2000, 3000];
const FALLBACK_STRIPE_PUBLISHABLE_KEY = (import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '').trim();
const DONATION_HEART_PARTICLES = [
  { left: '8%', sizeRem: 1.2, delay: '0s', duration: '4.9s' },
  { left: '16%', sizeRem: 1.8, delay: '0.35s', duration: '5.8s' },
  { left: '24%', sizeRem: 1.4, delay: '0.8s', duration: '5.2s' },
  { left: '34%', sizeRem: 2.2, delay: '1.1s', duration: '6.1s' },
  { left: '45%', sizeRem: 1.3, delay: '0.2s', duration: '5.3s' },
  { left: '55%', sizeRem: 1.9, delay: '1.4s', duration: '5.9s' },
  { left: '64%', sizeRem: 1.5, delay: '0.6s', duration: '5.1s' },
  { left: '73%', sizeRem: 2.1, delay: '1.2s', duration: '6.2s' },
  { left: '83%', sizeRem: 1.4, delay: '0.9s', duration: '5.5s' },
  { left: '92%', sizeRem: 1.7, delay: '0.45s', duration: '5.7s' }
] as const;

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

const PRIMARY_BUTTON_CLASS =
  'inline-flex items-center justify-center gap-2 rounded-full bg-red-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60';
const INPUT_FIELD_CLASS =
  'w-full rounded-xl border border-stone-300 bg-white px-3.5 py-2.5 text-sm font-medium text-stone-900 placeholder:text-stone-400 focus:border-red-700 focus:outline-none focus:ring-2 focus:ring-red-100';

function sponsorTierBadgeClass(tier: LiveFundraisingSponsor['tier']): string {
  if (tier === 'Center Stage') return 'bg-red-700 text-white';
  if (tier === 'Orchestra') return 'bg-amber-100 text-amber-900';
  if (tier === 'Mezzanine') return 'bg-stone-200 text-stone-700';
  return 'bg-orange-100 text-orange-900';
}

function DonationPaymentForm({
  amountCents, donorName, donorEmail, onSuccess, onError
}: {
  amountCents: number; donorName: string; donorEmail: string;
  onSuccess: () => void; onError: (message: string | null) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onError(null);
    if (!stripe || !elements) { onError('Payment form is still loading. Please try again.'); return; }
    setSubmitting(true);
    const result = await stripe.confirmPayment({
      elements,
      confirmParams: { payment_method_data: { billing_details: { name: donorName, email: donorEmail } } },
      redirect: 'if_required'
    });
    setSubmitting(false);
    if (result.error) { onError(result.error.message || 'Payment could not be completed.'); return; }
    const status = result.paymentIntent?.status;
    if (status === 'succeeded' || status === 'processing' || status === 'requires_capture') { onSuccess(); return; }
    onError(`Payment did not complete. Current status: ${status || 'unknown'}.`);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="rounded-2xl border border-stone-200 bg-white p-4">
        <PaymentElement />
      </div>
      <button
        type="submit"
        disabled={submitting || !stripe || !elements}
        className={`${PRIMARY_BUTTON_CLASS} w-full`}
      >
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
        Donate {formatUsd(amountCents)}
      </button>
    </form>
  );
}

export default function Fundraising() {
  const [activeTab, setActiveTab] = useState<FundraisingTab>('donation');
  const [liveSponsors, setLiveSponsors] = useState<LiveFundraisingSponsor[]>([]);
  const [sponsorLoadFailed, setSponsorLoadFailed] = useState(false);
  const [selectedDonationAmountCents, setSelectedDonationAmountCents] = useState<number | null>(null);
  const [donorName, setDonorName] = useState('');
  const [donorEmail, setDonorEmail] = useState('');
  const [customDonationAmount, setCustomDonationAmount] = useState('');
  const [activeDonationIntent, setActiveDonationIntent] = useState<ActiveDonationIntent | null>(null);
  const [donationIntentLoading, setDonationIntentLoading] = useState(false);
  const [donationError, setDonationError] = useState<string | null>(null);
  const [donationSuccessMessage, setDonationSuccessMessage] = useState<string | null>(null);
  const [showDonationCelebration, setShowDonationCelebration] = useState(false);
  const [lastDonationAmountCents, setLastDonationAmountCents] = useState<number | null>(null);
  const customAmountInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    apiFetch<LiveFundraisingSponsor[]>('/api/fundraising/sponsors')
      .then((items) => { if (Array.isArray(items)) { setLiveSponsors(items); setSponsorLoadFailed(false); } })
      .catch(() => { setLiveSponsors([]); setSponsorLoadFailed(true); });
  }, []);

  useEffect(() => {
    if (!showDonationCelebration) return;
    const timeout = window.setTimeout(() => setShowDonationCelebration(false), 6200);
    return () => window.clearTimeout(timeout);
  }, [showDonationCelebration]);

  const displayedSponsors = liveSponsors.length > 0 ? liveSponsors : sponsorLoadFailed ? fundraisingSponsors : [];
  const isOtherDonationSelected = selectedDonationAmountCents === null || !DONATION_PRESET_AMOUNTS_CENTS.includes(selectedDonationAmountCents);

  const donationStripePromise = useMemo(() => {
    if (!activeDonationIntent?.publishableKey) return null;
    return loadStripe(activeDonationIntent.publishableKey);
  }, [activeDonationIntent?.publishableKey]);

  const donationStripeOptions = useMemo<StripeElementsOptions | null>(() => {
    if (!activeDonationIntent?.clientSecret) return null;
    return { clientSecret: activeDonationIntent.clientSecret, appearance: { theme: 'stripe' } };
  }, [activeDonationIntent?.clientSecret]);

  const requestDonationIntent = async (amountCents: number) => {
    const normalizedDonorName = donorName.trim();
    const normalizedDonorEmail = donorEmail.trim().toLowerCase();
    if (!normalizedDonorName) { setDonationError('Please enter your name before donating.'); return; }
    if (!normalizedDonorEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedDonorEmail)) {
      setDonationError('Please enter a valid email address for your receipt.'); return;
    }
    setDonationSuccessMessage(null); setDonationError(null);
    setSelectedDonationAmountCents(amountCents); setDonationIntentLoading(true);
    try {
      const response = await apiFetch<DonationIntentResponse>('/api/fundraising/donations/intent', {
        method: 'POST',
        body: JSON.stringify({ amountCents, donorName: normalizedDonorName, donorEmail: normalizedDonorEmail })
      });
      const publishableKey = (response.publishableKey || FALLBACK_STRIPE_PUBLISHABLE_KEY || '').trim();
      if (!publishableKey) throw new Error('Stripe publishable key is missing.');
      setActiveDonationIntent({ paymentIntentId: response.paymentIntentId, clientSecret: response.clientSecret, publishableKey, amountCents: response.amountCents });
    } catch (err) {
      setActiveDonationIntent(null);
      setDonationError(err instanceof Error ? err.message : 'We could not start donation checkout.');
    } finally {
      setDonationIntentLoading(false);
    }
  };

  const handleOtherDonationSelect = () => {
    setSelectedDonationAmountCents(null); setActiveDonationIntent(null);
    setDonationError(null); setDonationSuccessMessage(null);
    requestAnimationFrame(() => customAmountInputRef.current?.focus());
  };

  const applyCustomDonationAmount = () => {
    const amountCents = parseDonationInputToCents(customDonationAmount);
    if (!amountCents) { setDonationError('Enter a valid donation amount of at least $1.00.'); return; }
    void requestDonationIntent(amountCents);
  };

  return (
    <>
      <style>{`
        .serif { font-family: Georgia, serif; }

        .donation-celebration-backdrop {
          background: radial-gradient(circle at 20% 20%, rgba(185, 28, 28, 0.3) 0%, rgba(127, 29, 29, 0.22) 30%, rgba(12, 10, 9, 0.82) 100%);
          backdrop-filter: blur(4px);
        }
        .donation-celebration-heart {
          position: absolute;
          bottom: -56px;
          color: rgba(254, 226, 226, 0.94);
          text-shadow: 0 10px 24px rgba(153, 27, 27, 0.45);
          animation: donation-heart-rise linear infinite;
          user-select: none;
        }
        .donation-celebration-heart.alt {
          color: rgba(254, 202, 202, 0.9);
          animation-name: donation-heart-rise-alt;
        }
        .donation-heart-icon {
          animation: donation-heart-beat 1.2s ease-in-out infinite;
        }
        @keyframes donation-heart-rise {
          0% { transform: translate3d(0, 0, 0) scale(0.65) rotate(0deg); opacity: 0; }
          12% { opacity: 0.95; }
          100% { transform: translate3d(0, -86vh, 0) scale(1.2) rotate(10deg); opacity: 0; }
        }
        @keyframes donation-heart-rise-alt {
          0% { transform: translate3d(0, 0, 0) scale(0.7) rotate(-8deg); opacity: 0; }
          15% { opacity: 0.95; }
          100% { transform: translate3d(0, -82vh, 0) scale(1.25) rotate(-18deg); opacity: 0; }
        }
        @keyframes donation-heart-beat {
          0%, 100% { transform: scale(1); }
          35% { transform: scale(1.12); }
          65% { transform: scale(0.96); }
        }
      `}</style>

      <div className="bg-white font-sans text-stone-900">
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
              <div className="donation-celebration-backdrop absolute inset-0" />

              <div className="pointer-events-none absolute inset-0 overflow-hidden">
                {DONATION_HEART_PARTICLES.map((heart, index) => (
                  <span
                    key={`${heart.left}-${heart.delay}`}
                    className={`donation-celebration-heart ${index % 2 === 0 ? 'alt' : ''}`}
                    style={{
                      left: heart.left,
                      fontSize: `${heart.sizeRem}rem`,
                      animationDelay: heart.delay,
                      animationDuration: heart.duration
                    }}
                    aria-hidden="true"
                  >
                    ♥
                  </span>
                ))}
              </div>

              <motion.div
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12, scale: 0.97 }}
                transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                className="relative w-full max-w-md rounded-3xl border border-red-100 bg-white/95 p-7 text-center shadow-2xl max-sm:rounded-2xl max-sm:p-5"
              >
                <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-red-100 text-red-700">
                  <Heart className="donation-heart-icon h-7 w-7 fill-current" />
                </div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-red-700">Donation Received</p>
                <h3 className="serif mt-1 text-3xl font-bold text-stone-900">Thank You!</h3>
                <p className="mt-3 text-sm leading-relaxed text-stone-600">
                  {lastDonationAmountCents
                    ? `Your ${formatUsd(lastDonationAmountCents)} gift helps Penncrest Theater students shine on stage.`
                    : 'Your gift helps Penncrest Theater students shine on stage.'}
                </p>
                <button
                  type="button"
                  onClick={() => setShowDonationCelebration(false)}
                  className={`${PRIMARY_BUTTON_CLASS} mt-5`}
                >
                  Continue
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── HERO ── */}
        <section className="border-b border-stone-100 bg-stone-50 pb-16 pt-14 sm:pt-20 max-sm:pb-12 max-sm:pt-10">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">

            {/* Eyebrow */}
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="mb-6 flex items-center gap-2.5"
            >
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-red-800">
                <HandCoins className="h-3 w-3 text-white" />
              </div>
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-red-800">
                Fundraising
              </span>
            </motion.div>

            <div className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <motion.h1
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: 0.05 }}
                className="serif text-5xl font-bold tracking-tight text-stone-900 sm:text-6xl lg:text-7xl max-sm:text-4xl max-sm:leading-tight"
              >
                Support<br />
                <em className="text-red-800 not-italic">the Stage</em>
              </motion.h1>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.45, delay: 0.15 }}
                className="max-w-sm text-sm leading-relaxed text-stone-500 sm:text-right sm:text-base max-sm:max-w-none"
              >
                Give directly through donations or sponsorships. For event listings, see Community Events below.
              </motion.p>
            </div>
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.2 }}
              className="rounded-2xl border border-red-100 bg-red-50 px-6 py-7 sm:px-8 sm:py-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
            >
              <div>
                <p className="text-xs uppercase tracking-[0.2em] font-semibold text-red-600 mb-2">Community Events</p>
                <h2 className="serif text-2xl font-bold text-stone-900 sm:text-3xl">
                  See current community events
                </h2>
              </div>
              <Link
                to="/shows/community-events"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-red-700 text-white px-6 py-3 font-semibold hover:bg-red-800 transition-colors"
              >
                View Community Events
                <ArrowRight className="w-4 h-4" />
              </Link>
            </motion.div>
          </div>
        </section>

        {/* ── SPONSOR TICKER ── */}
        {displayedSponsors.length > 0 && (
          <div className="border-y border-stone-100 bg-white py-4">
            <div className="mx-auto flex max-w-7xl items-center gap-5 overflow-x-auto px-4 sm:px-6 lg:px-8 no-scrollbar max-sm:gap-3 max-sm:px-3">
              <div className="flex flex-none items-center gap-2">
                <Star className="h-3.5 w-3.5 text-amber-500" />
                <span className="text-xs font-semibold uppercase tracking-[0.15em] text-stone-500 whitespace-nowrap">
                  Our Sponsors
                </span>
              </div>
              <div className="mx-3 h-4 w-px bg-stone-200 flex-none" />
              {displayedSponsors.map((sponsor) => (
                <a
                  key={sponsor.id}
                  href={sponsor.websiteUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-none rounded-xl border border-stone-100 bg-stone-50 px-4 py-2 transition hover:border-stone-200 hover:bg-white hover:shadow-sm"
                >
                  <img src={sponsor.logoUrl} alt={sponsor.name} className="h-6 w-auto min-w-[80px] object-contain opacity-70 hover:opacity-100 transition-opacity" />
                </a>
              ))}
            </div>
          </div>
        )}

        {/* ── GET INVOLVED ── */}
        <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 max-sm:py-12">

          {/* Section heading */}
          <div className="mb-10 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-red-800">Get Involved</p>
              <h2 className="serif mt-1.5 text-3xl font-bold text-stone-900 sm:text-4xl">Make an Impact</h2>
            </div>
            {/* Tab switcher */}
            <div className="inline-flex self-start rounded-2xl border border-stone-200 bg-stone-50 p-1 sm:self-auto max-sm:w-full">
              <button
                type="button"
                onClick={() => setActiveTab('donation')}
                className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition max-sm:flex-1 max-sm:justify-center max-sm:px-3 ${
                  activeTab === 'donation'
                    ? 'bg-red-700 text-white shadow-sm'
                    : 'text-stone-500 hover:text-stone-800'
                }`}
              >
                <HandCoins className="h-4 w-4" />
                Donate
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('sponsor')}
                className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition max-sm:flex-1 max-sm:justify-center max-sm:px-3 ${
                  activeTab === 'sponsor'
                    ? 'bg-red-700 text-white shadow-sm'
                    : 'text-stone-500 hover:text-stone-800'
                }`}
              >
                <HeartHandshake className="h-4 w-4" />
                Sponsor
              </button>
            </div>
          </div>

          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
          >
            {activeTab === 'donation' ? (
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">

                {/* Donation form — left col */}
                <div className="lg:col-span-3">
                  <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm sm:p-8 max-sm:p-5">
                    <div className="mb-6 flex items-center justify-between max-sm:flex-col max-sm:items-start max-sm:gap-3">
                      <div>
                        <h3 className="serif text-xl font-bold text-stone-900">Leave a Donation</h3>
                        <p className="mt-1 text-sm text-stone-500">Every gift helps students grow in confidence on stage.</p>
                      </div>
                      <div className="flex items-center gap-1.5 rounded-full border border-stone-100 bg-stone-50 px-3 py-1.5 text-xs font-semibold text-stone-500">
                        <CreditCard className="h-3 w-3" />
                        Secure
                      </div>
                    </div>

                    {/* Donor details */}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <input
                        type="text"
                        value={donorName}
                        onChange={(e) => setDonorName(e.target.value)}
                        placeholder="Your full name"
                        className={INPUT_FIELD_CLASS}
                      />
                      <input
                        type="email"
                        value={donorEmail}
                        onChange={(e) => setDonorEmail(e.target.value)}
                        placeholder="Email for receipt"
                        className={INPUT_FIELD_CLASS}
                      />
                    </div>
                    <p className="mt-2 text-xs text-stone-400">We'll send your thank-you note and receipt here.</p>

                    <div className="my-5 h-px bg-stone-200" />

                    {/* Preset amounts */}
                    <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">Choose Amount</p>
                    <div className="flex flex-wrap gap-2">
                      {DONATION_PRESET_AMOUNTS_CENTS.map((amountCents) => (
                        <button
                          key={amountCents}
                          type="button"
                          onClick={() => void requestDonationIntent(amountCents)}
                          className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                            selectedDonationAmountCents === amountCents
                              ? 'border-red-700 bg-red-700 text-white'
                              : 'border-stone-300 bg-white text-stone-700 hover:border-red-700 hover:bg-red-50 hover:text-red-700'
                          }`}
                        >
                          {formatUsd(amountCents)}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={handleOtherDonationSelect}
                        className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                          isOtherDonationSelected
                            ? 'border-red-700 bg-red-700 text-white'
                            : 'border-stone-300 bg-white text-stone-700 hover:border-red-700 hover:bg-red-50 hover:text-red-700'
                        }`}
                      >
                        Custom
                      </button>
                    </div>

                    {/* Custom amount */}
                    <div className="mt-3 flex gap-2 max-sm:flex-col">
                      <div className="relative flex-1">
                        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-stone-400">$</span>
                        <input
                          ref={customAmountInputRef}
                          type="text"
                          inputMode="decimal"
                          placeholder="Other amount"
                          value={customDonationAmount}
                          onChange={(e) => setCustomDonationAmount(e.target.value)}
                          className={`${INPUT_FIELD_CLASS} pl-8`}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={applyCustomDonationAmount}
                        className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-2.5 text-sm font-semibold text-stone-700 transition hover:border-red-700 hover:bg-red-50 hover:text-red-700 max-sm:w-full"
                      >
                        Apply
                      </button>
                    </div>

                    {/* Loading */}
                    {donationIntentLoading && (
                      <div className="mt-5 inline-flex items-center gap-2 text-sm text-stone-500">
                        <Loader2 className="h-4 w-4 animate-spin text-red-700" />
                        Loading secure payment form…
                      </div>
                    )}

                    {/* Success */}
                    {donationSuccessMessage && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.97 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="mt-5 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4"
                      >
                        <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-emerald-600" />
                        <p className="text-sm font-semibold text-emerald-800">{donationSuccessMessage}</p>
                      </motion.div>
                    )}

                    {/* Error */}
                    {donationError && (
                      <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                        {donationError}
                      </div>
                    )}

                    {/* Stripe form */}
                    {activeDonationIntent && donationStripePromise && donationStripeOptions && !donationIntentLoading && (
                      <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="mt-6 rounded-2xl border border-stone-100 bg-stone-50 p-4 sm:p-5"
                      >
                        <p className="mb-4 text-xs font-semibold uppercase tracking-[0.13em] text-stone-500">
                          Paying {formatUsd(activeDonationIntent.amountCents)}
                        </p>
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
                </div>

                {/* Donation levels — right col */}
                <div className="lg:col-span-2 space-y-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-400 lg:mt-0 mt-2">Donation Levels</p>
                  {donationLevels.map((card, i) => (
                    <motion.article
                      key={card.label}
                      initial={{ opacity: 0, x: 12 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.35, delay: i * 0.08 }}
                      className="rounded-2xl border border-stone-200 bg-white p-5 transition hover:border-stone-300 hover:shadow-sm"
                    >
                      <p className="text-xs font-bold uppercase tracking-[0.14em] text-red-700">{card.amount}</p>
                      <h3 className="serif mt-1 text-lg font-bold text-stone-900">{card.label}</h3>
                      <p className="mt-2 text-sm leading-relaxed text-stone-500">{card.detail}</p>
                    </motion.article>
                  ))}
                </div>
              </div>

            ) : (
              /* ── SPONSOR TAB ── */
              <div className="space-y-8">
                {/* Header */}
                <div className="flex flex-wrap items-start justify-between gap-4 rounded-3xl border border-stone-200 bg-white p-6 sm:p-8">
                  <div className="max-w-lg">
                    <h3 className="serif text-xl font-bold text-stone-900">Become a Sponsor</h3>
                    <p className="mt-2 text-sm leading-relaxed text-stone-500">
                      Partner with Penncrest Theater and place your organization in front of students, families, and the broader community this season.
                    </p>
                  </div>
                  <a
                    href="mailto:jsmith3@rtmsd.org?subject=Penncrest%20Theater%20Sponsorship"
                    className={`${PRIMARY_BUTTON_CLASS} max-sm:w-full`}
                  >
                    <Mail className="h-4 w-4" />
                    Request Sponsor Packet
                  </a>
                </div>

                {/* Tiers */}
                <div>
                  <p className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-stone-400">Sponsorship Levels</p>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    {sponsorshipTiers.map((card, i) => (
                      <motion.article
                        key={card.level}
                        initial={{ opacity: 0, y: 10 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.35, delay: i * 0.08 }}
                        className="rounded-2xl border border-stone-200 bg-white p-5 transition hover:border-stone-300 hover:shadow-sm"
                      >
                        <p className="text-xs font-bold uppercase tracking-[0.14em] text-red-700">{card.amount}</p>
                        <h3 className="serif mt-1 text-lg font-bold text-stone-900">{card.level}</h3>
                        <p className="mt-2 text-sm leading-relaxed text-stone-500">{card.benefit}</p>
                      </motion.article>
                    ))}
                  </div>
                  <p className="mt-4 text-sm text-stone-500">
                    All donations of $250 and above are tax-deductible, and documentation is provided.
                  </p>
                </div>

                {/* Current Sponsors */}
                {displayedSponsors.length > 0 && (
                  <div>
                    <p className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-stone-400">Current Sponsors</p>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {displayedSponsors.map((sponsor) => (
                        <article key={sponsor.id} className="overflow-hidden rounded-2xl border border-stone-200 bg-white transition hover:shadow-md">
                          <div className="relative">
                            <img src={sponsor.imageUrl} alt={`${sponsor.name} spotlight`} className="h-44 w-full object-cover" />
                            <div className={`absolute left-3 top-3 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.1em] ${
                              sponsorTierBadgeClass(sponsor.tier)
                            }`}>
                              {sponsor.tier}
                            </div>
                          </div>
                          <div className="p-5">
                            <img src={sponsor.logoUrl} alt={sponsor.name} className="h-9 w-auto object-contain" />
                            <p className="mt-3 text-sm leading-relaxed text-stone-500">{sponsor.spotlight}</p>
                            <a
                              href={sponsor.websiteUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-red-700 transition hover:text-red-900"
                            >
                              Visit Website
                              <ArrowRight className="h-3.5 w-3.5" />
                            </a>
                          </div>
                        </article>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </motion.div>
        </section>
      </div>
    </>
  );
}
