import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowLeft, ArrowRight, CalendarDays, Clock3, MapPin, Ticket } from 'lucide-react';
import { getFundraisingEventBySlug, fundraisingEvents, fundraisingSponsors } from '../lib/fundraisingContent';
import { apiFetch } from '../lib/api';

type LiveFundraisingSponsor = {
  id: string;
  name: string;
  tier: 'Balcony' | 'Mezzanine' | 'Orchestra' | 'Center Stage';
  logoUrl: string;
  imageUrl: string;
  spotlight: string;
  websiteUrl: string;
};

type LiveFundraisingEvent = {
  id: string;
  title: string;
  description: string;
  posterUrl: string;
  startsAt: string;
  salesCutoffAt: string | null;
  salesOpen: boolean;
  venue: string;
  notes: string;
  seatSelectionEnabled: boolean;
  minPrice: number;
  maxPrice: number;
  availableTickets: number;
};

type DetailEvent = {
  id: string;
  title: string;
  dateLabel: string;
  timeLabel: string;
  location: string;
  heroImageUrl: string;
  summary: string;
  longDescription: string;
  priceLabel: string;
  details: string[];
  bookingHref?: string;
  salesOpen?: boolean;
  linkHref: string;
  source: 'static' | 'live';
};

type RelatedEvent = {
  id: string;
  title: string;
  imageUrl: string;
  dateLabel: string;
  linkHref: string;
};

function formatEventDate(iso: string): { dateLabel: string; timeLabel: string } {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { dateLabel: 'TBD', timeLabel: 'TBD' };
  return {
    dateLabel: date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }),
    timeLabel: date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
  };
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatPriceLabel(minPrice: number, maxPrice: number): string {
  if (minPrice <= 0 && maxPrice <= 0) return 'Free';
  if (maxPrice > minPrice) return `${formatUsd(minPrice)} – ${formatUsd(maxPrice)}`;
  return formatUsd(Math.max(minPrice, maxPrice));
}

function sponsorTierBadgeClass(tier: LiveFundraisingSponsor['tier']): string {
  if (tier === 'Center Stage') return 'bg-red-700 text-white';
  if (tier === 'Orchestra') return 'bg-amber-100 text-amber-900';
  if (tier === 'Mezzanine') return 'bg-stone-200 text-stone-700';
  return 'bg-orange-100 text-orange-900';
}

export default function FundraisingEventDetail() {
  const { slug } = useParams<{ slug: string }>();
  const staticEvent = slug ? getFundraisingEventBySlug(slug) : undefined;
  const [liveSponsors, setLiveSponsors] = useState<LiveFundraisingSponsor[]>([]);
  const [sponsorLoadFailed, setSponsorLoadFailed] = useState(false);
  const [liveEvents, setLiveEvents] = useState<LiveFundraisingEvent[]>([]);
  const [liveEventsLoadFailed, setLiveEventsLoadFailed] = useState(false);
  const [liveEventsLoading, setLiveEventsLoading] = useState(true);

  useEffect(() => {
    apiFetch<LiveFundraisingSponsor[]>('/api/fundraising/sponsors')
      .then((items) => { if (Array.isArray(items)) { setLiveSponsors(items); setSponsorLoadFailed(false); } })
      .catch(() => { setLiveSponsors([]); setSponsorLoadFailed(true); });
  }, []);

  useEffect(() => {
    setLiveEventsLoading(true);
    apiFetch<LiveFundraisingEvent[]>('/api/fundraising/events')
      .then((items) => { if (Array.isArray(items)) { setLiveEvents(items); setLiveEventsLoadFailed(false); } })
      .catch(() => { setLiveEvents([]); setLiveEventsLoadFailed(true); })
      .finally(() => setLiveEventsLoading(false));
  }, []);

  const liveEvent = useMemo(
    () => (slug ? liveEvents.find((e) => e.id === slug) : undefined),
    [liveEvents, slug]
  );

  const event = useMemo<DetailEvent | null>(() => {
    if (staticEvent) {
      return {
        id: staticEvent.id,
        title: staticEvent.title,
        dateLabel: staticEvent.dateLabel,
        timeLabel: staticEvent.timeLabel,
        location: staticEvent.location,
        heroImageUrl: staticEvent.heroImageUrl,
        summary: staticEvent.summary,
        longDescription: staticEvent.longDescription,
        priceLabel: staticEvent.goalLabel,
        details: staticEvent.details,
        linkHref: `/fundraising/events/${staticEvent.slug}`,
        source: 'static',
      };
    }
    if (liveEvent) {
      const { dateLabel, timeLabel } = formatEventDate(liveEvent.startsAt);
      const priceLabel = formatPriceLabel(liveEvent.minPrice, liveEvent.maxPrice);
      const salesCutoffLine = liveEvent.salesCutoffAt
        ? `Online sales close: ${formatEventDate(liveEvent.salesCutoffAt).dateLabel} at ${formatEventDate(liveEvent.salesCutoffAt).timeLabel}`
        : null;
      return {
        id: liveEvent.id,
        title: liveEvent.title,
        dateLabel,
        timeLabel,
        location: liveEvent.venue,
        heroImageUrl: liveEvent.posterUrl || 'https://picsum.photos/id/1043/1600/900',
        summary: liveEvent.description || liveEvent.notes || 'This fundraiser supports Penncrest Theater students and production programs.',
        longDescription: liveEvent.notes || liveEvent.description || 'Join this fundraising event to support student performers, technicians, and theater programs all season long.',
        priceLabel,
        details: [
          `Ticketing: ${liveEvent.seatSelectionEnabled ? 'Reserved Seating' : 'General Admission'}`,
          `Available tickets: ${liveEvent.availableTickets}`,
          salesCutoffLine,
        ].filter((line): line is string => Boolean(line)),
        bookingHref: `/booking/${liveEvent.id}`,
        salesOpen: liveEvent.salesOpen,
        linkHref: `/fundraising/events/${liveEvent.id}`,
        source: 'live',
      };
    }
    return null;
  }, [liveEvent, staticEvent]);

  const featuredSponsors = useMemo(
    () => (liveSponsors.length > 0 ? liveSponsors : sponsorLoadFailed ? fundraisingSponsors : []).slice(0, 3),
    [liveSponsors, sponsorLoadFailed]
  );

  const relatedEvents = useMemo<RelatedEvent[]>(() => {
    if (!event) return [];
    if (event.source === 'live') {
      return liveEvents.filter((item) => item.id !== event.id).slice(0, 4).map((item) => ({
        id: item.id,
        title: item.title,
        imageUrl: item.posterUrl || 'https://picsum.photos/id/1074/1200/800',
        dateLabel: formatEventDate(item.startsAt).dateLabel,
        linkHref: `/fundraising/events/${item.id}`,
      }));
    }
    return fundraisingEvents.filter((item) => item.id !== event.id).slice(0, 4).map((item) => ({
      id: item.id,
      title: item.title,
      imageUrl: item.heroImageUrl,
      dateLabel: item.dateLabel,
      linkHref: `/fundraising/events/${item.slug}`,
    }));
  }, [event, liveEvents]);

  // ── Loading ──
  if (!staticEvent && liveEventsLoading && !liveEventsLoadFailed) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-white">
        <div className="text-center">
          <div className="mx-auto mb-5 h-9 w-9 animate-spin rounded-full border-2 border-stone-200 border-t-red-700" />
          <p className="font-serif text-xl font-bold text-stone-900">Loading Event</p>
          <p className="mt-1.5 text-sm text-stone-400">Retrieving the latest details…</p>
        </div>
      </div>
    );
  }

  // ── Not found ──
  if (!event) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-white px-6">
        <div className="max-w-sm text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-red-700">Fundraising</p>
          <h1 className="mt-3 font-serif text-4xl font-bold text-stone-900">Event Not Found</h1>
          <p className="mt-4 text-sm leading-relaxed text-stone-500">
            This fundraising event isn't available yet. Return to fundraising to view other active events.
          </p>
          <Link
            to="/fundraising"
            className="mt-8 inline-flex items-center gap-2 rounded-full bg-red-700 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-red-800"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Fundraising
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white text-stone-900">

      {/* ── HERO ── */}
      <section className="relative">
        <div className="relative h-[60vh] min-h-[420px]">
          <img src={event.heroImageUrl} alt={event.title} className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/35 to-black/10" />
        </div>

        <div className="absolute inset-x-0 bottom-0 mx-auto max-w-6xl px-6 pb-10 lg:px-10">
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
            className="mb-5">
            <Link
              to="/fundraising"
              className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-black/20 px-4 py-1.5 text-xs font-semibold text-white backdrop-blur-sm transition hover:bg-black/35"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Fundraising
            </Link>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.1 }}>
            <h1 className="max-w-3xl font-serif text-4xl font-bold text-white sm:text-5xl lg:text-6xl">
              {event.title}
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-stone-300 sm:text-base">
              {event.longDescription}
            </p>
          </motion.div>
        </div>
      </section>

      {/* ── BODY ── */}
      <section className="mx-auto max-w-6xl px-6 py-14 lg:px-10">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-5">

          {/* ── Left: details ── */}
          <motion.div
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.2 }}
            className="lg:col-span-3 space-y-10"
          >
            {/* About */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-red-700">About This Event</p>
              <p className="mt-4 text-base leading-relaxed text-stone-600">{event.summary}</p>
            </div>

            {/* Key info row */}
            <div className="grid grid-cols-1 gap-px border border-stone-100 rounded-2xl overflow-hidden sm:grid-cols-3">
              <InfoCell icon={<CalendarDays className="h-4 w-4 text-red-700" />} label="Date" value={event.dateLabel} />
              <InfoCell icon={<Clock3 className="h-4 w-4 text-red-700" />} label="Time" value={event.timeLabel} />
              <InfoCell icon={<MapPin className="h-4 w-4 text-red-700" />} label="Location" value={event.location} />
            </div>

            {/* Extra details */}
            {event.details.length > 0 && (
              <div className="space-y-2">
                {event.details.map((detail) => (
                  <div key={detail} className="flex items-start gap-3 text-sm text-stone-600">
                    <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-red-700" />
                    {detail}
                  </div>
                ))}
              </div>
            )}
          </motion.div>

          {/* ── Right: ticket CTA + sponsors ── */}
          <motion.div
            initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.4, delay: 0.28 }}
            className="lg:col-span-2 space-y-6"
          >
            {/* Ticket card */}
            {event.bookingHref && (
              <div className="rounded-2xl border border-stone-100 bg-stone-50 p-6">
                <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Tickets</p>
                <p className="mt-1 font-serif text-2xl font-bold text-stone-900">{event.priceLabel}</p>

                {event.salesOpen !== false ? (
                  <Link
                    to={event.bookingHref}
                    className="mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-red-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-red-800"
                  >
                    <Ticket className="h-4 w-4" />
                    Continue to Tickets
                  </Link>
                ) : (
                  <div className="mt-5 rounded-full bg-stone-200 px-4 py-3 text-center text-sm font-semibold text-stone-500">
                    Online sales are closed
                  </div>
                )}
              </div>
            )}

            {/* Sponsors */}
            {featuredSponsors.length > 0 && (
              <div className="rounded-2xl border border-stone-100 p-6">
                <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Our Partners</p>
                <div className="mt-4 space-y-2">
                  {featuredSponsors.map((sponsor) => (
                    <a
                      key={sponsor.id}
                      href={sponsor.websiteUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-3 rounded-xl border border-stone-100 p-3 transition hover:border-stone-200 hover:bg-stone-50"
                    >
                      <img src={sponsor.logoUrl} alt={sponsor.name} className="h-7 w-auto object-contain opacity-75" />
                      <span className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-semibold ${sponsorTierBadgeClass(sponsor.tier)}`}>
                        {sponsor.tier}
                      </span>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        </div>
      </section>

      {/* ── RELATED ── */}
      {relatedEvents.length > 0 && (
        <section className="border-t border-stone-100 py-14">
          <div className="mx-auto max-w-6xl px-6 lg:px-10">
            <div className="mb-8 flex items-end justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-red-700">Keep Exploring</p>
                <h2 className="mt-1.5 font-serif text-2xl font-bold text-stone-900 sm:text-3xl">More Events</h2>
              </div>
              <Link
                to="/fundraising"
                className="hidden items-center gap-1 text-sm font-semibold text-red-700 transition hover:text-red-900 sm:inline-flex"
              >
                All Events <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {relatedEvents.map((related, i) => (
                <motion.div
                  key={related.id}
                  initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }} transition={{ duration: 0.3, delay: i * 0.06 }}
                >
                  <Link
                    to={related.linkHref}
                    className="group block overflow-hidden rounded-2xl border border-stone-100 bg-white transition hover:shadow-md"
                  >
                    <div className="overflow-hidden">
                      <img src={related.imageUrl} alt={related.title} className="h-44 w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                    </div>
                    <div className="p-4">
                      <p className="text-xs font-semibold uppercase tracking-widest text-red-700">{related.dateLabel}</p>
                      <h3 className="mt-1 font-serif text-lg font-bold text-stone-900">{related.title}</h3>
                      <div className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-stone-400 transition group-hover:text-red-700">
                        View Event <ArrowRight className="h-3 w-3" />
                      </div>
                    </div>
                  </Link>
                </motion.div>
              ))}
            </div>
          </div>
        </section>
      )}

      {event.source === 'live' && liveEventsLoadFailed && (
        <p className="mx-auto max-w-6xl px-6 pb-8 text-xs text-stone-400 lg:px-10">
          Live event details could not be refreshed right now.
        </p>
      )}
    </div>
  );
}

/* ── Sub-components ── */

function InfoCell({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="bg-stone-50 px-5 py-5">
      <div className="flex items-center gap-1.5 mb-1.5">
        {icon}
        <span className="text-xs font-semibold uppercase tracking-widest text-stone-400">{label}</span>
      </div>
      <p className="text-sm font-semibold text-stone-800">{value}</p>
    </div>
  );
}