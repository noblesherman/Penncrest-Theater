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
  Users
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
  if (Number.isNaN(date.getTime())) {
    return { dateLabel: 'TBD', timeLabel: 'TBD' };
  }
  return {
    dateLabel: date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }),
    timeLabel: date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  };
}

function DonationPaymentForm({
  amountCents,
  onSuccess,
  onError
}: {
  amountCents: number;
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
      redirect: 'if_required'
    });
    setSubmitting(false);

    if (result.error) {
      onError(result.error.message || 'Payment could not be completed.');
      return;
    }

    const status = result.paymentIntent?.status;
    if (status === 'succeeded' || status === 'processing' || status === 'requires_capture') {
      onSuccess();
      return;
    }

    onError(`Payment did not complete. Current status: ${status || 'unknown'}.`);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="rounded-xl border border-stone-200 bg-white p-3 sm:p-4">
        <PaymentElement />
      </div>
      <button
        type="submit"
        disabled={submitting || !stripe || !elements}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-red-700 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60"
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
  const [customDonationAmount, setCustomDonationAmount] = useState('');
  const [activeDonationIntent, setActiveDonationIntent] = useState<ActiveDonationIntent | null>(null);
  const [donationIntentLoading, setDonationIntentLoading] = useState(false);
  const [donationError, setDonationError] = useState<string | null>(null);
  const [donationSuccessMessage, setDonationSuccessMessage] = useState<string | null>(null);
  const customAmountInputRef = useRef<HTMLInputElement | null>(null);

  const activeTabContent = useMemo(() => {
    if (activeTab === 'donation') {
      return {
        icon: HandCoins,
        title: 'Leave a Donation',
        description:
          'Every gift  helps students create outstanding productions, learn theater craft, and grow in confidence.'
      };
    }

    return {
      icon: HeartHandshake,
      title: 'Become a Sponsor',
      description:
        'Partner with Penncrest Theater and place your organization in front of students, families, and our community.',
      buttonLabel: 'Request Sponsor Packet',
      buttonHref: 'mailto:jsmith3@rtmsd.org?subject=Penncrest%20Theater%20Sponsorship'
    };
  }, [activeTab]);

  useEffect(() => {
    apiFetch<LiveFundraisingEvent[]>('/api/fundraising/events')
      .then((items) => {
        if (Array.isArray(items)) {
          setLiveEvents(items);
          setLiveLoadFailed(false);
        }
      })
      .catch(() => {
        setLiveEvents([]);
        setLiveLoadFailed(true);
      });
  }, []);

  useEffect(() => {
    apiFetch<LiveFundraisingSponsor[]>('/api/fundraising/sponsors')
      .then((items) => {
        if (Array.isArray(items)) {
          setLiveSponsors(items);
          setSponsorLoadFailed(false);
        }
      })
      .catch(() => {
        setLiveSponsors([]);
        setSponsorLoadFailed(true);
      });
  }, []);

  const liveDisplayEvents = useMemo<DisplayEvent[]>(
    () =>
      liveEvents.map((event) => {
        const { dateLabel, timeLabel } = formatEventDate(event.startsAt);
        return {
          id: event.id,
          title: event.title,
          dateLabel,
          timeLabel,
          summary:
            event.description ||
            (event.minPrice > 0 ? `Starting at $${(event.minPrice / 100).toFixed(2)}` : 'General Admission'),
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
    () =>
      fundraisingEvents.map((event) => ({
        id: event.id,
        title: event.title,
        dateLabel: event.dateLabel,
        timeLabel: event.timeLabel,
        summary: event.summary,
        imageUrl: event.heroImageUrl,
        linkHref: `/fundraising/events/${event.slug}`,
        ctaLabel: 'View Event Details',
        location: event.location
      })),
    []
  );

  const displayedEvents = liveDisplayEvents.length > 0 ? liveDisplayEvents : liveLoadFailed ? fallbackDisplayEvents : [];
  const displayedSponsors = liveSponsors.length > 0 ? liveSponsors : sponsorLoadFailed ? fundraisingSponsors : [];
  const ActiveTabIcon = activeTabContent.icon;
  const featuredEvent = displayedEvents[0];
  const secondaryEvents = displayedEvents.slice(1);
  const isOtherDonationSelected =
    selectedDonationAmountCents === null || !DONATION_PRESET_AMOUNTS_CENTS.includes(selectedDonationAmountCents);

  const donationStripePromise = useMemo(() => {
    if (!activeDonationIntent?.publishableKey) return null;
    return loadStripe(activeDonationIntent.publishableKey);
  }, [activeDonationIntent?.publishableKey]);

  const donationStripeOptions = useMemo<StripeElementsOptions | null>(() => {
    if (!activeDonationIntent?.clientSecret) return null;
    return {
      clientSecret: activeDonationIntent.clientSecret,
      appearance: {
        theme: 'stripe'
      }
    };
  }, [activeDonationIntent?.clientSecret]);

  const requestDonationIntent = async (amountCents: number) => {
    setDonationSuccessMessage(null);
    setDonationError(null);
    setSelectedDonationAmountCents(amountCents);
    setDonationIntentLoading(true);

    try {
      const response = await apiFetch<DonationIntentResponse>('/api/fundraising/donations/intent', {
        method: 'POST',
        body: JSON.stringify({ amountCents })
      });

      const publishableKey = (response.publishableKey || FALLBACK_STRIPE_PUBLISHABLE_KEY || '').trim();
      if (!publishableKey) {
        throw new Error('Stripe publishable key is missing.');
      }

      setActiveDonationIntent({
        paymentIntentId: response.paymentIntentId,
        clientSecret: response.clientSecret,
        publishableKey,
        amountCents: response.amountCents
      });
    } catch (err) {
      setActiveDonationIntent(null);
      setDonationError(err instanceof Error ? err.message : 'Unable to start donation checkout.');
    } finally {
      setDonationIntentLoading(false);
    }
  };

  const handleOtherDonationSelect = () => {
    setSelectedDonationAmountCents(null);
    setActiveDonationIntent(null);
    setDonationError(null);
    setDonationSuccessMessage(null);
    requestAnimationFrame(() => customAmountInputRef.current?.focus());
  };

  const applyCustomDonationAmount = () => {
    const amountCents = parseDonationInputToCents(customDonationAmount);
    if (!amountCents) {
      setDonationError('Enter a valid donation amount of at least $1.00.');
      return;
    }

    void requestDonationIntent(amountCents);
  };

  return (
    <div className="bg-stone-50 text-stone-900">
      <section className="relative overflow-hidden border-b border-stone-200 bg-white pb-10 pt-14 sm:pb-14 sm:pt-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-7 flex items-center gap-2">
            <Megaphone className="h-4 w-4 text-red-700" />
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-red-700">Fundraising Events</p>
          </div>
          <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <h1 className="text-4xl font-bold tracking-tight text-stone-900 sm:text-5xl" style={{ fontFamily: 'Georgia, serif' }}>
              Support the Stage
            </h1>
            <p className="max-w-xl text-sm leading-relaxed text-stone-600 sm:text-base">
              Discover upcoming events, then contribute through donations or sponsorship to directly power student theater.
            </p>
          </div>

          {featuredEvent ? (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">
              <Link
                to={featuredEvent.linkHref}
                className="group relative overflow-hidden rounded-3xl border border-stone-200 lg:col-span-3"
              >
                <img
                  src={featuredEvent.imageUrl}
                  alt={featuredEvent.title}
                  className="h-full min-h-[360px] w-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/35 to-black/10" />
                <div className="absolute bottom-0 p-6 sm:p-7">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-200">
                    {featuredEvent.dateLabel} · {featuredEvent.timeLabel}
                  </p>
                  <h2 className="mt-2 text-3xl font-bold text-white" style={{ fontFamily: 'Georgia, serif' }}>
                    {featuredEvent.title}
                  </h2>
                  <p className="mt-2 max-w-xl text-sm text-stone-200">{featuredEvent.summary}</p>
                  {featuredEvent.location ? <p className="mt-1 text-xs text-stone-300">{featuredEvent.location}</p> : null}
                  {featuredEvent.seatModeLabel ? <p className="mt-1 text-xs text-stone-300">{featuredEvent.seatModeLabel}</p> : null}
                  <span className="mt-5 inline-flex rounded-full bg-white/90 px-4 py-2 text-sm font-semibold text-stone-900">
                    {featuredEvent.ctaLabel}
                  </span>
                </div>
              </Link>

              <div className="grid grid-cols-1 gap-5 lg:col-span-2">
                {secondaryEvents.map((event) => (
                  <motion.div
                    key={event.id}
                    initial={{ opacity: 0, y: 14 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true, margin: '-50px' }}
                    transition={{ duration: 0.4 }}
                  >
                    <Link to={event.linkHref} className="group block overflow-hidden rounded-3xl border border-stone-200">
                      <div className="relative">
                        <img
                          src={event.imageUrl}
                          alt={event.title}
                          className="h-56 w-full object-cover transition-transform duration-500 group-hover:scale-105"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                        <div className="absolute bottom-0 p-5">
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-200">{event.dateLabel}</p>
                          <h3 className="mt-1 text-2xl font-bold text-white" style={{ fontFamily: 'Georgia, serif' }}>
                            {event.title}
                          </h3>
                          {event.seatModeLabel ? <p className="mt-1 text-xs text-stone-300">{event.seatModeLabel}</p> : null}
                        </div>
                      </div>
                    </Link>
                  </motion.div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="border-y border-red-800 bg-gradient-to-r from-red-800 via-red-700 to-amber-500 py-4">
        <div className="mx-auto flex max-w-7xl items-center gap-4 overflow-x-auto px-4 sm:px-6 lg:px-8 no-scrollbar">
          <Users className="h-4 w-4 flex-none text-amber-200" />
          <span className="flex-none text-sm font-semibold uppercase tracking-[0.13em] text-white">
            Thank You to Our Sponsors
          </span>
          {displayedSponsors.map((sponsor) => (
            <a
              key={sponsor.id}
              href={sponsor.websiteUrl}
              target="_blank"
              rel="noreferrer"
              className="flex-none rounded-xl bg-white/90 px-3 py-1.5 transition hover:bg-white"
            >
              <img src={sponsor.logoUrl} alt={sponsor.name} className="h-6 w-auto min-w-20 object-contain" />
            </a>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm sm:p-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-2xl font-bold text-stone-900" style={{ fontFamily: 'Georgia, serif' }}>
                Get Involved
              </h2>
              <p className="mt-2 text-sm text-stone-600">
                Choose how you want to support student theater this season.
              </p>
            </div>

            <div className="inline-flex rounded-full border border-stone-200 bg-stone-100 p-1">
              <button
                type="button"
                onClick={() => setActiveTab('donation')}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                  activeTab === 'donation' ? 'bg-red-700 text-white shadow-sm' : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                Leave a Donation
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('sponsor')}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                  activeTab === 'sponsor' ? 'bg-red-700 text-white shadow-sm' : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                Become a Sponsor
              </button>
            </div>
          </div>

          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22 }}
            className="mt-8 rounded-2xl border border-stone-200 bg-stone-50 p-5 sm:p-6"
          >
            <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="inline-flex items-center gap-2 rounded-full bg-red-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.13em] text-red-800">
                  <ActiveTabIcon className="h-3.5 w-3.5" />
                  {activeTabContent.title}
                </p>
                <p className="mt-3 max-w-2xl text-sm leading-relaxed text-stone-600">{activeTabContent.description}</p>
              </div>

              {activeTab === 'sponsor' ? (
                <a
                  href={
                    'buttonHref' in activeTabContent
                      ? activeTabContent.buttonHref
                      : 'mailto:jsmith3@rtmsd.org?subject=Penncrest%20Theater%20Sponsorship'
                  }
                  className="inline-flex items-center gap-2 rounded-full bg-red-700 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-800"
                >
                  <Mail className="h-4 w-4" />
                  {'buttonLabel' in activeTabContent ? activeTabContent.buttonLabel : 'Request Sponsor Packet'}
                </a>
              ) : (
                <div className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-red-700">
                  <CreditCard className="h-3.5 w-3.5" />
                  Secure Card Payment
                </div>
              )}
            </div>

            {activeTab === 'donation' ? (
              <div className="space-y-5">
                <div className="rounded-2xl border border-red-100 bg-white p-4 sm:p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.13em] text-red-700">Choose Donation Amount</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {DONATION_PRESET_AMOUNTS_CENTS.map((amountCents) => {
                      const isSelected = selectedDonationAmountCents === amountCents;
                      return (
                        <button
                          key={amountCents}
                          type="button"
                          onClick={() => void requestDonationIntent(amountCents)}
                          className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                            isSelected
                              ? 'border-red-700 bg-red-700 text-white'
                              : 'border-stone-300 bg-white text-stone-700 hover:border-red-500 hover:text-red-700'
                          }`}
                        >
                          {formatUsd(amountCents)}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={handleOtherDonationSelect}
                      className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                        isOtherDonationSelected
                          ? 'border-red-700 bg-red-700 text-white'
                          : 'border-stone-300 bg-white text-stone-700 hover:border-red-500 hover:text-red-700'
                      }`}
                    >
                      Other
                    </button>
                  </div>

                  <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                    <div className="relative flex-1">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-stone-500">$</span>
                      <input
                        ref={customAmountInputRef}
                        type="text"
                        inputMode="decimal"
                        placeholder="Enter custom amount"
                        value={customDonationAmount}
                        onChange={(event) => setCustomDonationAmount(event.target.value)}
                        className="w-full rounded-xl border border-stone-300 bg-white py-2.5 pl-8 pr-3 text-sm font-medium text-stone-900 outline-none focus:border-red-500"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={applyCustomDonationAmount}
                      className="rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 transition hover:border-red-500 hover:text-red-700"
                    >
                      Use Amount
                    </button>
                  </div>

                  {donationIntentLoading && (
                    <div className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-stone-600">
                      <Loader2 className="h-4 w-4 animate-spin text-red-700" />
                      Loading secure payment form...
                    </div>
                  )}

                  {donationSuccessMessage && (
                    <div className="mt-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
                      <p className="inline-flex items-center gap-2 font-semibold">
                        <CheckCircle2 className="h-4 w-4" />
                        {donationSuccessMessage}
                      </p>
                    </div>
                  )}

                  {donationError && (
                    <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                      {donationError}
                    </div>
                  )}

                  {activeDonationIntent && donationStripePromise && donationStripeOptions && !donationIntentLoading && (
                    <div className="mt-5 rounded-2xl border border-stone-200 bg-stone-50 p-3 sm:p-4">
                      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.13em] text-stone-500">
                        Pay {formatUsd(activeDonationIntent.amountCents)}
                      </p>
                      <Elements
                        stripe={donationStripePromise}
                        options={donationStripeOptions}
                        key={activeDonationIntent.paymentIntentId}
                      >
                        <DonationPaymentForm
                          amountCents={activeDonationIntent.amountCents}
                          onSuccess={() => {
                            setDonationSuccessMessage(`Thank you. Your ${formatUsd(activeDonationIntent.amountCents)} donation was received.`);
                            setActiveDonationIntent(null);
                            setDonationError(null);
                          }}
                          onError={setDonationError}
                        />
                      </Elements>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  {donationLevels.map((card) => (
                    <article key={card.label} className="rounded-xl border border-stone-200 bg-white p-4">
                      <p className="text-sm font-semibold uppercase tracking-[0.12em] text-red-700">{card.amount}</p>
                      <h3 className="mt-1 text-lg font-bold text-stone-900" style={{ fontFamily: 'Georgia, serif' }}>
                        {card.label}
                      </h3>
                      <p className="mt-2 text-sm leading-relaxed text-stone-600">{card.detail}</p>
                    </article>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  {sponsorshipTiers.map((card) => (
                    <article key={card.level} className="rounded-xl border border-stone-200 bg-white p-4">
                      <p className="text-sm font-semibold uppercase tracking-[0.12em] text-red-700">{card.amount}</p>
                      <h3 className="mt-1 text-lg font-bold text-stone-900" style={{ fontFamily: 'Georgia, serif' }}>
                        {card.level}
                      </h3>
                      <p className="mt-2 text-sm leading-relaxed text-stone-600">{card.benefit}</p>
                    </article>
                  ))}
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {displayedSponsors.map((sponsor) => (
                    <article key={sponsor.id} className="overflow-hidden rounded-2xl border border-stone-200 bg-white">
                      <div className="relative">
                        <img src={sponsor.imageUrl} alt={`${sponsor.name} spotlight`} className="h-40 w-full object-cover" />
                        <div className="absolute left-3 top-3 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-stone-800">
                          {sponsor.tier} Sponsor
                        </div>
                      </div>
                      <div className="p-4">
                        <img src={sponsor.logoUrl} alt={sponsor.name} className="h-10 w-auto object-contain" />
                        <p className="mt-3 text-sm leading-relaxed text-stone-600">{sponsor.spotlight}</p>
                        <a
                          href={sponsor.websiteUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-red-700 hover:text-red-800"
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                          Visit Sponsor
                        </a>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6 lg:px-8">
        <div className="rounded-3xl border border-stone-200 bg-white p-6 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4 text-red-700" />
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-red-700">
                {liveDisplayEvents.length > 0 ? 'Live Fundraising Checkouts' : 'All Event Pages'}
              </p>
            </div>
            {featuredEvent ? (
              <Link
                to={featuredEvent.linkHref}
                className="inline-flex rounded-full border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700 transition-colors hover:border-red-700 hover:text-red-700"
              >
                {featuredEvent.ctaLabel}
              </Link>
            ) : null}
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {displayedEvents.map((event) => (
              <Link
                key={event.id}
                to={event.linkHref}
                className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm font-medium text-stone-700 transition-colors hover:border-stone-300 hover:bg-white"
              >
                {event.title}
              </Link>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
