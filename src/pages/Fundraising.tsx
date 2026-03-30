import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe, type StripeElementsOptions } from '@stripe/stripe-js';
import { AnimatePresence, motion } from 'motion/react';
import {
  CalendarDays,
  CheckCircle2,
  CreditCard,
  HandCoins,
  Heart,
  HeartHandshake,
  Loader2,
  Mail,
  Megaphone,
  ArrowRight,
  Star
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  donationLevels,
  fundraisingEvents,
  fundraisingSponsors,
  sponsorshipTiers
} from '../lib/fundraisingContent';
import { apiFetch } from '../lib/api';

type FundraisingTab = 'donation' | 'sponsor';

type LiveFundraisingEvent = {
  id: string;
  title: string;
  description: string;
  posterUrl: string;
  startsAt: string;
  salesOpen: boolean;
  venue: string;
  seatSelectionEnabled: boolean;
  minPrice: number;
};

type LiveFundraisingSponsor = {
  id: string;
  name: string;
  tier: 'Balcony' | 'Mezzanine' | 'Orchestra' | 'Center Stage';
  logoUrl: string;
  imageUrl: string;
  spotlight: string;
  websiteUrl: string;
};

type DisplayEvent = {
  id: string;
  title: string;
  dateLabel: string;
  timeLabel: string;
  summary: string;
  imageUrl: string;
  linkHref: string;
  ctaLabel: string;
  location?: string;
  seatModeLabel?: string;
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

function formatEventDate(iso: string): { dateLabel: string; timeLabel: string } {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { dateLabel: 'TBD', timeLabel: 'TBD' };
  return {
    dateLabel: date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }),
    timeLabel: date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  };
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
  const [liveEvents, setLiveEvents] = useState<LiveFundraisingEvent[]>([]);
  const [liveLoadFailed, setLiveLoadFailed] = useState(false);
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
    apiFetch<LiveFundraisingEvent[]>('/api/fundraising/events')
      .then((items) => { if (Array.isArray(items)) { setLiveEvents(items); setLiveLoadFailed(false); } })
      .catch(() => { setLiveEvents([]); setLiveLoadFailed(true); });
  }, []);

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

  const liveDisplayEvents = useMemo<DisplayEvent[]>(
    () => liveEvents.map((event) => {
      const { dateLabel, timeLabel } = formatEventDate(event.startsAt);
      return {
        id: event.id, title: event.title, dateLabel, timeLabel,
        summary: event.description || (event.minPrice > 0 ? `Starting at $${(event.minPrice / 100).toFixed(2)}` : 'General Admission'),
        imageUrl: event.posterUrl || 'https://picsum.photos/id/1015/1600/900',
        linkHref: `/fundraising/events/${event.id}`,
        ctaLabel: event.salesOpen ? 'View Details' : 'View Event',
        location: event.venue,
        seatModeLabel: event.seatSelectionEnabled ? 'Seat Selection' : 'General Admission'
      };
    }),
    [liveEvents]
  );

  const fallbackDisplayEvents = useMemo<DisplayEvent[]>(
    () => fundraisingEvents.map((event) => ({
      id: event.id, title: event.title, dateLabel: event.dateLabel, timeLabel: event.timeLabel,
      summary: event.summary, imageUrl: event.heroImageUrl,
      linkHref: `/fundraising/events/${event.slug}`, ctaLabel: 'View Event Details', location: event.location
    })),
    []
  );

  const displayedEvents = liveDisplayEvents.length > 0 ? liveDisplayEvents : liveLoadFailed ? fallbackDisplayEvents : [];
  const displayedSponsors = liveSponsors.length > 0 ? liveSponsors : sponsorLoadFailed ? fundraisingSponsors : [];
  const featuredEvent = displayedEvents[0];
  const secondaryEvents = displayedEvents.slice(1);
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
      setDonationError(err instanceof Error ? err.message : 'Unable to start donation checkout.');
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
                className="relative w-full max-w-md rounded-3xl border border-red-100 bg-white/95 p-7 text-center shadow-2xl"
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
        <section className="border-b border-stone-100 bg-stone-50 pb-16 pt-14 sm:pt-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">

            {/* Eyebrow */}
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="mb-6 flex items-center gap-2.5"
            >
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-red-800">
                <Megaphone className="h-3 w-3 text-white" />
              </div>
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-red-800">
                Fundraising Events
              </span>
            </motion.div>

            <div className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <motion.h1
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: 0.05 }}
                className="serif text-5xl font-bold tracking-tight text-stone-900 sm:text-6xl lg:text-7xl"
              >
                Support<br />
                <em className="text-red-800 not-italic">the Stage</em>
              </motion.h1>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.45, delay: 0.15 }}
                className="max-w-sm text-sm leading-relaxed text-stone-500 sm:text-right sm:text-base"
              >
                Discover upcoming events, then contribute through donations or sponsorships to directly power student theater at Penncrest.
              </motion.p>
            </div>

            {/* Events Grid */}
            {featuredEvent ? (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.2 }}
                className="grid grid-cols-1 gap-4 lg:grid-cols-12"
              >
                {/* Featured */}
                <Link
                  to={featuredEvent.linkHref}
                  className="group relative overflow-hidden rounded-3xl lg:col-span-7"
                  style={{ minHeight: 420 }}
                >
                  <img
                    src={featuredEvent.imageUrl}
                    alt={featuredEvent.title}
                    className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
                  <div className="absolute bottom-0 p-7 sm:p-8">
                    <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 backdrop-blur-sm">
                      <CalendarDays className="h-3 w-3 text-amber-300" />
                      <span className="text-xs font-semibold text-amber-200">
                        {featuredEvent.dateLabel} · {featuredEvent.timeLabel}
                      </span>
                    </div>
                    <h2 className="serif text-3xl font-bold text-white sm:text-4xl">{featuredEvent.title}</h2>
                    <p className="mt-2 max-w-lg text-sm text-stone-300">{featuredEvent.summary}</p>
                    {featuredEvent.location && <p className="mt-1 text-xs text-stone-400">{featuredEvent.location}</p>}
                    <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-stone-900 transition group-hover:bg-stone-100">
                      {featuredEvent.ctaLabel}
                      <ArrowRight className="h-3.5 w-3.5" />
                    </div>
                  </div>
                </Link>

                {/* Secondary */}
                <div className="flex flex-col gap-4 lg:col-span-5">
                  {secondaryEvents.map((event, i) => (
                    <motion.div
                      key={event.id}
                      initial={{ opacity: 0, x: 16 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.4, delay: i * 0.1 }}
                      className="flex-1"
                    >
                      <Link to={event.linkHref} className="group relative flex h-full min-h-[190px] overflow-hidden rounded-3xl">
                        <img src={event.imageUrl} alt={event.title} className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
                        <div className="absolute bottom-0 p-5">
                          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-300">{event.dateLabel}</p>
                          <h3 className="serif mt-1 text-xl font-bold text-white">{event.title}</h3>
                          {event.seatModeLabel && <p className="mt-0.5 text-xs text-stone-400">{event.seatModeLabel}</p>}
                        </div>
                      </Link>
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            ) : null}
          </div>
        </section>

        {/* ── SPONSOR TICKER ── */}
        {displayedSponsors.length > 0 && (
          <div className="border-y border-stone-100 bg-white py-4">
            <div className="mx-auto flex max-w-7xl items-center gap-5 overflow-x-auto px-4 sm:px-6 lg:px-8 no-scrollbar">
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
        <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">

          {/* Section heading */}
          <div className="mb-10 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-red-800">Get Involved</p>
              <h2 className="serif mt-1.5 text-3xl font-bold text-stone-900 sm:text-4xl">Make an Impact</h2>
            </div>
            {/* Tab switcher */}
            <div className="inline-flex self-start rounded-2xl border border-stone-200 bg-stone-50 p-1 sm:self-auto">
              <button
                type="button"
                onClick={() => setActiveTab('donation')}
                className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition ${
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
                className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition ${
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
                  <div className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm sm:p-8">
                    <div className="mb-6 flex items-center justify-between">
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
                    <p className="mt-2 text-xs text-stone-400">We'll send your thank-you note and Stripe receipt here.</p>

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
                    <div className="mt-3 flex gap-2">
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
                        className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-2.5 text-sm font-semibold text-stone-700 transition hover:border-red-700 hover:bg-red-50 hover:text-red-700"
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
                    className={PRIMARY_BUTTON_CLASS}
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

        {/* ── ALL EVENTS FOOTER ── */}
        {displayedEvents.length > 0 && (
          <section className="border-t border-stone-100 bg-stone-50/60 py-12">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
              <div className="mb-5 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-400">
                  All Fundraising Events
                </p>
                {featuredEvent && (
                  <Link
                    to={featuredEvent.linkHref}
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-red-700 transition hover:text-red-900"
                  >
                    {featuredEvent.ctaLabel}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                )}
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {displayedEvents.map((event) => (
                  <Link
                    key={event.id}
                    to={event.linkHref}
                    className="flex items-center justify-between rounded-xl border border-stone-200 bg-white px-4 py-3.5 text-sm font-medium text-stone-700 transition hover:border-stone-300 hover:shadow-sm"
                  >
                    {event.title}
                    <ArrowRight className="h-3.5 w-3.5 text-stone-400 flex-none" />
                  </Link>
                ))}
              </div>
            </div>
          </section>
        )}

      </div>
    </>
  );
}
