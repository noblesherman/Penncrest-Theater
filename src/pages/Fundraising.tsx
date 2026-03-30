import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe, type StripeElementsOptions } from '@stripe/stripe-js';
import { motion } from 'motion/react';
import {
  CalendarDays,
  CheckCircle2,
  CreditCard,
  HandCoins,
  HeartHandshake,
  Loader2,
  Mail,
  Megaphone,
  Sparkles,
  Users,
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
  tier: 'Gold' | 'Silver' | 'Bronze';
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
      <div className="rounded-2xl border border-zinc-200 bg-white p-4">
        <PaymentElement />
      </div>
      <button
        type="submit"
        disabled={submitting || !stripe || !elements}
        className="donate-btn inline-flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3.5 text-sm font-bold text-white transition-all disabled:cursor-not-allowed disabled:opacity-60"
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
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400;1,700&family=DM+Sans:wght@300;400;500;600&display=swap');

        .fund-root { font-family: 'DM Sans', sans-serif; }
        .serif { font-family: 'Playfair Display', Georgia, serif; }

        .hero-accent {
          background: linear-gradient(135deg, #fef2f2 0%, #fff7ed 40%, #fafafa 100%);
        }

        .donate-btn {
          background: linear-gradient(135deg, #b91c1c 0%, #991b1b 100%);
          box-shadow: 0 4px 14px rgba(185, 28, 28, 0.3);
        }
        .donate-btn:hover {
          background: linear-gradient(135deg, #991b1b 0%, #7f1d1d 100%);
          box-shadow: 0 6px 20px rgba(185, 28, 28, 0.4);
          transform: translateY(-1px);
        }

        .pill-tab-active {
          background: #991b1b;
          color: white;
          box-shadow: 0 2px 8px rgba(153, 27, 27, 0.25);
        }

        .event-card-hover:hover img { transform: scale(1.04); }

        .sponsor-ticker {
          mask-image: linear-gradient(to right, transparent 0%, black 8%, black 92%, transparent 100%);
        }

        .tier-badge-gold { background: linear-gradient(135deg, #fbbf24, #f59e0b); color: #78350f; }
        .tier-badge-silver { background: linear-gradient(135deg, #e5e7eb, #d1d5db); color: #374151; }
        .tier-badge-bronze { background: linear-gradient(135deg, #fb923c, #ea580c); color: #fff7ed; }

        .input-field {
          width: 100%;
          border-radius: 12px;
          border: 1.5px solid #e5e7eb;
          background: white;
          padding: 11px 14px;
          font-size: 0.875rem;
          font-weight: 500;
          color: #111;
          outline: none;
          transition: border-color 0.15s;
          font-family: 'DM Sans', sans-serif;
        }
        .input-field:focus { border-color: #b91c1c; box-shadow: 0 0 0 3px rgba(185,28,28,0.08); }
        .input-field::placeholder { color: #9ca3af; font-weight: 400; }

        .amount-chip {
          border-radius: 999px;
          border: 1.5px solid #e5e7eb;
          padding: 8px 18px;
          font-size: 0.875rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s;
          background: white;
          color: #374151;
        }
        .amount-chip:hover { border-color: #b91c1c; color: #b91c1c; background: #fef2f2; }
        .amount-chip.selected { background: #991b1b; border-color: #991b1b; color: white; box-shadow: 0 2px 8px rgba(153,27,27,0.25); }

        .section-divider {
          height: 1px;
          background: linear-gradient(to right, transparent, #e5e7eb 20%, #e5e7eb 80%, transparent);
        }

        .donation-level-card {
          position: relative;
          overflow: hidden;
        }
        .donation-level-card::before {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 3px;
          background: linear-gradient(90deg, #b91c1c, #f59e0b);
          opacity: 0;
          transition: opacity 0.2s;
        }
        .donation-level-card:hover::before { opacity: 1; }
      `}</style>

      <div className="fund-root bg-white text-zinc-900">

        {/* ── HERO ── */}
        <section className="hero-accent border-b border-zinc-100 pb-16 pt-14 sm:pt-20">
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
                className="serif text-5xl font-bold tracking-tight text-zinc-900 sm:text-6xl lg:text-7xl"
              >
                Support<br />
                <em className="text-red-800 not-italic">the Stage</em>
              </motion.h1>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.45, delay: 0.15 }}
                className="max-w-sm text-sm leading-relaxed text-zinc-500 sm:text-right sm:text-base"
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
                  className="event-card-hover group relative overflow-hidden rounded-3xl lg:col-span-7"
                  style={{ minHeight: 420 }}
                >
                  <img
                    src={featuredEvent.imageUrl}
                    alt={featuredEvent.title}
                    className="absolute inset-0 h-full w-full object-cover transition-transform duration-700"
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
                    <p className="mt-2 max-w-lg text-sm text-zinc-300">{featuredEvent.summary}</p>
                    {featuredEvent.location && <p className="mt-1 text-xs text-zinc-400">{featuredEvent.location}</p>}
                    <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-zinc-900 transition group-hover:bg-zinc-100">
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
                      <Link to={event.linkHref} className="event-card-hover group relative flex h-full min-h-[190px] overflow-hidden rounded-3xl">
                        <img src={event.imageUrl} alt={event.title} className="absolute inset-0 h-full w-full object-cover transition-transform duration-700" />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
                        <div className="absolute bottom-0 p-5">
                          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-300">{event.dateLabel}</p>
                          <h3 className="serif mt-1 text-xl font-bold text-white">{event.title}</h3>
                          {event.seatModeLabel && <p className="mt-0.5 text-xs text-zinc-400">{event.seatModeLabel}</p>}
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
          <div className="border-y border-zinc-100 bg-white py-4">
            <div className="mx-auto flex max-w-7xl items-center gap-5 overflow-x-auto px-4 sponsor-ticker sm:px-6 lg:px-8 no-scrollbar">
              <div className="flex flex-none items-center gap-2">
                <Star className="h-3.5 w-3.5 text-amber-500" />
                <span className="text-xs font-semibold uppercase tracking-[0.15em] text-zinc-500 whitespace-nowrap">
                  Our Sponsors
                </span>
              </div>
              <div className="mx-3 h-4 w-px bg-zinc-200 flex-none" />
              {displayedSponsors.map((sponsor) => (
                <a
                  key={sponsor.id}
                  href={sponsor.websiteUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-none rounded-xl border border-zinc-100 bg-zinc-50 px-4 py-2 transition hover:border-zinc-200 hover:bg-white hover:shadow-sm"
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
              <h2 className="serif mt-1.5 text-3xl font-bold text-zinc-900 sm:text-4xl">Make an Impact</h2>
            </div>
            {/* Tab switcher */}
            <div className="inline-flex self-start rounded-2xl border border-zinc-200 bg-zinc-50 p-1 sm:self-auto">
              <button
                type="button"
                onClick={() => setActiveTab('donation')}
                className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-all ${activeTab === 'donation' ? 'pill-tab-active' : 'text-zinc-500 hover:text-zinc-800'}`}
              >
                <HandCoins className="h-4 w-4" />
                Donate
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('sponsor')}
                className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-all ${activeTab === 'sponsor' ? 'pill-tab-active' : 'text-zinc-500 hover:text-zinc-800'}`}
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
                  <div className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
                    <div className="mb-6 flex items-center justify-between">
                      <div>
                        <h3 className="serif text-xl font-bold text-zinc-900">Leave a Donation</h3>
                        <p className="mt-1 text-sm text-zinc-500">Every gift helps students grow in confidence on stage.</p>
                      </div>
                      <div className="flex items-center gap-1.5 rounded-full border border-zinc-100 bg-zinc-50 px-3 py-1.5 text-xs font-semibold text-zinc-500">
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
                        className="input-field"
                      />
                      <input
                        type="email"
                        value={donorEmail}
                        onChange={(e) => setDonorEmail(e.target.value)}
                        placeholder="Email for receipt"
                        className="input-field"
                      />
                    </div>
                    <p className="mt-2 text-xs text-zinc-400">We'll send your thank-you note and Stripe receipt here.</p>

                    <div className="section-divider my-5" />

                    {/* Preset amounts */}
                    <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Choose Amount</p>
                    <div className="flex flex-wrap gap-2">
                      {DONATION_PRESET_AMOUNTS_CENTS.map((amountCents) => (
                        <button
                          key={amountCents}
                          type="button"
                          onClick={() => void requestDonationIntent(amountCents)}
                          className={`amount-chip ${selectedDonationAmountCents === amountCents ? 'selected' : ''}`}
                        >
                          {formatUsd(amountCents)}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={handleOtherDonationSelect}
                        className={`amount-chip ${isOtherDonationSelected ? 'selected' : ''}`}
                      >
                        Custom
                      </button>
                    </div>

                    {/* Custom amount */}
                    <div className="mt-3 flex gap-2">
                      <div className="relative flex-1">
                        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold text-zinc-400">$</span>
                        <input
                          ref={customAmountInputRef}
                          type="text"
                          inputMode="decimal"
                          placeholder="Other amount"
                          value={customDonationAmount}
                          onChange={(e) => setCustomDonationAmount(e.target.value)}
                          className="input-field pl-8"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={applyCustomDonationAmount}
                        className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm font-semibold text-zinc-700 transition hover:border-red-700 hover:bg-red-50 hover:text-red-700"
                      >
                        Apply
                      </button>
                    </div>

                    {/* Loading */}
                    {donationIntentLoading && (
                      <div className="mt-5 inline-flex items-center gap-2 text-sm text-zinc-500">
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
                        className="mt-6 rounded-2xl border border-zinc-100 bg-zinc-50 p-4 sm:p-5"
                      >
                        <p className="mb-4 text-xs font-semibold uppercase tracking-[0.13em] text-zinc-500">
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
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400 lg:mt-0 mt-2">Donation Levels</p>
                  {donationLevels.map((card, i) => (
                    <motion.article
                      key={card.label}
                      initial={{ opacity: 0, x: 12 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.35, delay: i * 0.08 }}
                      className="donation-level-card rounded-2xl border border-zinc-200 bg-white p-5 transition hover:border-zinc-300 hover:shadow-sm"
                    >
                      <p className="text-xs font-bold uppercase tracking-[0.14em] text-red-700">{card.amount}</p>
                      <h3 className="serif mt-1 text-lg font-bold text-zinc-900">{card.label}</h3>
                      <p className="mt-2 text-sm leading-relaxed text-zinc-500">{card.detail}</p>
                    </motion.article>
                  ))}
                </div>
              </div>

            ) : (
              /* ── SPONSOR TAB ── */
              <div className="space-y-8">
                {/* Header */}
                <div className="flex flex-wrap items-start justify-between gap-4 rounded-3xl border border-zinc-200 bg-white p-6 sm:p-8">
                  <div className="max-w-lg">
                    <h3 className="serif text-xl font-bold text-zinc-900">Become a Sponsor</h3>
                    <p className="mt-2 text-sm leading-relaxed text-zinc-500">
                      Partner with Penncrest Theater and place your organization in front of students, families, and the broader community this season.
                    </p>
                  </div>
                  <a
                    href="mailto:jsmith3@rtmsd.org?subject=Penncrest%20Theater%20Sponsorship"
                    className="donate-btn inline-flex items-center gap-2 rounded-2xl px-6 py-3 text-sm font-bold text-white transition-all"
                  >
                    <Mail className="h-4 w-4" />
                    Request Sponsor Packet
                  </a>
                </div>

                {/* Tiers */}
                <div>
                  <p className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400">Sponsorship Levels</p>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    {sponsorshipTiers.map((card, i) => (
                      <motion.article
                        key={card.level}
                        initial={{ opacity: 0, y: 10 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ duration: 0.35, delay: i * 0.08 }}
                        className="donation-level-card rounded-2xl border border-zinc-200 bg-white p-5 transition hover:border-zinc-300 hover:shadow-sm"
                      >
                        <p className="text-xs font-bold uppercase tracking-[0.14em] text-red-700">{card.amount}</p>
                        <h3 className="serif mt-1 text-lg font-bold text-zinc-900">{card.level}</h3>
                        <p className="mt-2 text-sm leading-relaxed text-zinc-500">{card.benefit}</p>
                      </motion.article>
                    ))}
                  </div>
                  <p className="mt-4 text-sm text-zinc-500">
                    All donations of $250 and above are tax-deductible, and documentation is provided.
                  </p>
                </div>

                {/* Current Sponsors */}
                {displayedSponsors.length > 0 && (
                  <div>
                    <p className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400">Current Sponsors</p>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {displayedSponsors.map((sponsor) => (
                        <article key={sponsor.id} className="overflow-hidden rounded-2xl border border-zinc-200 bg-white transition hover:shadow-md">
                          <div className="relative">
                            <img src={sponsor.imageUrl} alt={`${sponsor.name} spotlight`} className="h-44 w-full object-cover" />
                            <div className={`absolute left-3 top-3 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.1em] ${
                              sponsor.tier === 'Gold' ? 'tier-badge-gold'
                              : sponsor.tier === 'Silver' ? 'tier-badge-silver'
                              : 'tier-badge-bronze'
                            }`}>
                              {sponsor.tier}
                            </div>
                          </div>
                          <div className="p-5">
                            <img src={sponsor.logoUrl} alt={sponsor.name} className="h-9 w-auto object-contain" />
                            <p className="mt-3 text-sm leading-relaxed text-zinc-500">{sponsor.spotlight}</p>
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
          <section className="border-t border-zinc-100 bg-zinc-50/60 py-12">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
              <div className="mb-5 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-400">
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
                    className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3.5 text-sm font-medium text-zinc-700 transition hover:border-zinc-300 hover:shadow-sm"
                  >
                    {event.title}
                    <ArrowRight className="h-3.5 w-3.5 text-zinc-400 flex-none" />
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
