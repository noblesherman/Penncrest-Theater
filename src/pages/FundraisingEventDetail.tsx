import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowLeft, ArrowRight, CalendarDays, Clock3, MapPin, Target, Ticket } from 'lucide-react';
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
  goalLabel: string;
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
    timeLabel: date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
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
        id: staticEvent.id, title: staticEvent.title, dateLabel: staticEvent.dateLabel,
        timeLabel: staticEvent.timeLabel, location: staticEvent.location,
        heroImageUrl: staticEvent.heroImageUrl, summary: staticEvent.summary,
        longDescription: staticEvent.longDescription, goalLabel: staticEvent.goalLabel,
        details: staticEvent.details, linkHref: `/fundraising/events/${staticEvent.slug}`, source: 'static'
      };
    }
    if (liveEvent) {
      const { dateLabel, timeLabel } = formatEventDate(liveEvent.startsAt);
      const priceLabel = formatPriceLabel(liveEvent.minPrice, liveEvent.maxPrice);
      const salesCutoffLine = liveEvent.salesCutoffAt
        ? `Online sales close: ${formatEventDate(liveEvent.salesCutoffAt).dateLabel} at ${formatEventDate(liveEvent.salesCutoffAt).timeLabel}`
        : null;
      return {
        id: liveEvent.id, title: liveEvent.title, dateLabel, timeLabel,
        location: liveEvent.venue,
        heroImageUrl: liveEvent.posterUrl || 'https://picsum.photos/id/1043/1600/900',
        summary: liveEvent.description || liveEvent.notes || 'This fundraiser supports Penncrest Theater students and production programs.',
        longDescription: liveEvent.notes || liveEvent.description || 'Join this fundraising event to support student performers, technicians, and theater programs all season long.',
        goalLabel: liveEvent.salesOpen ? `Tickets ${priceLabel}` : 'Sales Closed',
        details: [
          `Ticketing: ${liveEvent.seatSelectionEnabled ? 'Reserved Seating' : 'General Admission'}`,
          `Available tickets: ${liveEvent.availableTickets}`,
          `Price: ${priceLabel}`,
          salesCutoffLine
        ].filter((line): line is string => Boolean(line)),
        bookingHref: `/booking/${liveEvent.id}`,
        salesOpen: liveEvent.salesOpen,
        linkHref: `/fundraising/events/${liveEvent.id}`,
        source: 'live'
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
        id: item.id, title: item.title,
        imageUrl: item.posterUrl || 'https://picsum.photos/id/1074/1200/800',
        dateLabel: formatEventDate(item.startsAt).dateLabel,
        linkHref: `/fundraising/events/${item.id}`
      }));
    }
    return fundraisingEvents.filter((item) => item.id !== event.id).slice(0, 4).map((item) => ({
      id: item.id, title: item.title, imageUrl: item.heroImageUrl,
      dateLabel: item.dateLabel, linkHref: `/fundraising/events/${item.slug}`
    }));
  }, [event, liveEvents]);

  const styles = `
    @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;0,900;1,400;1,700&family=DM+Sans:wght@300;400;500;600&display=swap');
    .fund-detail { font-family: 'DM Sans', sans-serif; }
    .serif { font-family: 'Playfair Display', Georgia, serif; }
    .primary-btn {
      background: linear-gradient(135deg, #b91c1c 0%, #991b1b 100%);
      box-shadow: 0 4px 14px rgba(185,28,28,0.28);
      transition: all 0.15s;
    }
    .primary-btn:hover {
      background: linear-gradient(135deg, #991b1b 0%, #7f1d1d 100%);
      box-shadow: 0 6px 20px rgba(185,28,28,0.38);
      transform: translateY(-1px);
    }
    .detail-pill {
      display: flex; align-items: flex-start; gap: 12px;
      border-radius: 14px; border: 1.5px solid #f3f4f6;
      background: white; padding: 14px 16px;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .detail-pill:hover { border-color: #e5e7eb; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
    .tier-balcony { background: linear-gradient(135deg,#fdba74,#fb923c); color: #7c2d12; }
    .tier-mezzanine { background: linear-gradient(135deg,#e5e7eb,#d1d5db); color: #374151; }
    .tier-orchestra { background: linear-gradient(135deg,#fbbf24,#f59e0b); color: #78350f; }
    .tier-center-stage { background: linear-gradient(135deg,#dc2626,#991b1b); color: #fee2e2; }
    .related-card img { transition: transform 0.5s ease; }
    .related-card:hover img { transform: scale(1.04); }
  `;

  // ── Loading state ──
  if (!staticEvent && liveEventsLoading && !liveEventsLoadFailed) {
    return (
      <>
        <style>{styles}</style>
        <div className="fund-detail flex min-h-[60vh] items-center justify-center bg-white">
          <div className="text-center">
            <div className="mx-auto mb-5 h-10 w-10 animate-spin rounded-full border-2 border-zinc-200 border-t-red-700" />
            <p className="serif text-2xl font-bold text-zinc-900">Loading Event</p>
            <p className="mt-2 text-sm text-zinc-500">Retrieving the latest details…</p>
          </div>
        </div>
      </>
    );
  }

  // ── Not found state ──
  if (!event) {
    return (
      <>
        <style>{styles}</style>
        <div className="fund-detail flex min-h-[60vh] items-center justify-center bg-white px-4">
          <div className="max-w-md text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-red-800">Fundraising</p>
            <h1 className="serif mt-3 text-4xl font-bold text-zinc-900">Event Not Found</h1>
            <p className="mx-auto mt-4 text-sm leading-relaxed text-zinc-500">
              This fundraising event isn't available yet. Return to fundraising to view other active events.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                to="/fundraising"
                className="primary-btn inline-flex items-center gap-2 rounded-2xl px-5 py-2.5 text-sm font-semibold text-white"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Fundraising
              </Link>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <style>{styles}</style>
      <div className="fund-detail bg-white text-zinc-900">

        {/* ── HERO ── */}
        <section className="relative overflow-hidden">
          <div className="relative h-[58vh] min-h-[400px]">
            <img
              src={event.heroImageUrl}
              alt={event.title}
              className="h-full w-full object-cover"
            />
            {/* Multi-layer gradient for legibility */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-black/10" />
            <div className="absolute inset-0 bg-gradient-to-r from-black/30 to-transparent" />
          </div>

          {/* Hero content */}
          <div className="absolute inset-x-0 bottom-0 mx-auto max-w-7xl px-4 pb-10 sm:px-6 lg:px-8">
            {/* Nav pills */}
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="mb-6 flex flex-wrap gap-2"
            >
              <Link
                to="/fundraising"
                className="inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-black/25 px-4 py-2 text-xs font-semibold text-white backdrop-blur-sm transition hover:bg-black/40"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Fundraising
              </Link>
              {event.bookingHref && event.salesOpen !== false && (
                <Link
                  to={event.bookingHref}
                  className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-semibold text-zinc-900 transition hover:bg-zinc-100"
                >
                  <Ticket className="h-3.5 w-3.5 text-red-700" />
                  Buy Tickets
                </Link>
              )}
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.1 }}
            >
              <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 backdrop-blur-sm">
                <CalendarDays className="h-3 w-3 text-amber-300" />
                <span className="text-xs font-semibold text-amber-200">{event.goalLabel}</span>
              </div>
              <h1 className="serif max-w-3xl text-4xl font-bold text-white sm:text-5xl lg:text-6xl">
                {event.title}
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-zinc-300 sm:text-base">
                {event.longDescription}
              </p>
            </motion.div>
          </div>
        </section>

        {/* ── META STRIP ── */}
        <div className="border-b border-zinc-100 bg-zinc-50/70">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: 0.2 }}
              className="grid grid-cols-2 divide-x divide-zinc-100 md:grid-cols-4"
            >
              <MetaCell icon={<CalendarDays className="h-4 w-4 text-red-700" />} label="Date" value={event.dateLabel} />
              <MetaCell icon={<Clock3 className="h-4 w-4 text-red-700" />} label="Time" value={event.timeLabel} />
              <MetaCell icon={<MapPin className="h-4 w-4 text-red-700" />} label="Location" value={event.location} />
              <MetaCell icon={<Target className="h-4 w-4 text-red-700" />} label="Focus" value={event.goalLabel} />
            </motion.div>
          </div>
        </div>

        {/* ── BODY ── */}
        <section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-5">

            {/* Main content */}
            <motion.article
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.25 }}
              className="lg:col-span-3 space-y-6"
            >
              {/* Overview */}
              <div className="rounded-3xl border border-zinc-200 bg-white p-7">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-red-800">Event Overview</p>
                <h2 className="serif mt-2 text-2xl font-bold text-zinc-900">About This Event</h2>
                <p className="mt-3 text-sm leading-relaxed text-zinc-600">{event.summary}</p>

                {event.details.length > 0 && (
                  <div className="mt-6 space-y-2">
                    {event.details.map((detail) => (
                      <div key={detail} className="detail-pill">
                        <div className="mt-0.5 h-1.5 w-1.5 flex-none rounded-full bg-red-700" />
                        <span className="text-sm text-zinc-700">{detail}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* CTA for mobile — shown before sidebar on small screens */}
              {event.bookingHref && (
                <div className="rounded-3xl border border-zinc-200 bg-white p-6 lg:hidden">
                  <TicketCta event={event} />
                </div>
              )}
            </motion.article>

            {/* Sidebar */}
            <motion.aside
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.4, delay: 0.3 }}
              className="lg:col-span-2 space-y-5"
            >
              {/* Ticket CTA — desktop */}
              {event.bookingHref && (
                <div className="hidden rounded-3xl border border-zinc-200 bg-white p-6 lg:block">
                  <TicketCta event={event} />
                </div>
              )}

              {/* Sponsors */}
              {featuredSponsors.length > 0 && (
                <div className="rounded-3xl border border-zinc-200 bg-white p-6">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">Sponsor Spotlight</p>
                  <h3 className="serif mt-1.5 text-lg font-bold text-zinc-900">Our Partners</h3>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-500">
                    Local partners help fund the student experience behind every production.
                  </p>
                  <div className="mt-5 space-y-3">
                    {featuredSponsors.map((sponsor) => (
                      <a
                        key={sponsor.id}
                        href={sponsor.websiteUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-3 rounded-2xl border border-zinc-100 p-3 transition hover:border-zinc-200 hover:shadow-sm"
                      >
                        <img src={sponsor.logoUrl} alt={sponsor.name} className="h-8 w-auto object-contain opacity-80" />
                        <span className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-bold ${
                          sponsor.tier === 'Center Stage' ? 'tier-center-stage'
                          : sponsor.tier === 'Orchestra' ? 'tier-orchestra'
                          : sponsor.tier === 'Mezzanine' ? 'tier-mezzanine'
                          : 'tier-balcony'
                        }`}>
                          {sponsor.tier}
                        </span>
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </motion.aside>
          </div>
        </section>

        {/* ── RELATED EVENTS ── */}
        {relatedEvents.length > 0 && (
          <section className="border-t border-zinc-100 bg-zinc-50/60 py-14">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
              <div className="mb-7 flex items-end justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-red-800">Keep Exploring</p>
                  <h2 className="serif mt-1.5 text-2xl font-bold text-zinc-900 sm:text-3xl">More Events</h2>
                </div>
                <Link
                  to="/fundraising"
                  className="hidden items-center gap-1.5 text-sm font-semibold text-red-700 transition hover:text-red-900 sm:inline-flex"
                >
                  All Events
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {relatedEvents.map((related, i) => (
                  <motion.div
                    key={related.id}
                    initial={{ opacity: 0, y: 10 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.35, delay: i * 0.07 }}
                  >
                    <Link
                      to={related.linkHref}
                      className="related-card group block overflow-hidden rounded-2xl border border-zinc-200 bg-white transition hover:shadow-md"
                    >
                      <div className="overflow-hidden">
                        <img src={related.imageUrl} alt={related.title} className="h-44 w-full object-cover" />
                      </div>
                      <div className="p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.13em] text-red-700">{related.dateLabel}</p>
                        <h3 className="serif mt-1 text-lg font-bold text-zinc-900">{related.title}</h3>
                        <div className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-zinc-400 transition group-hover:text-red-700">
                          View Event
                          <ArrowRight className="h-3 w-3" />
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
          <p className="mx-auto max-w-7xl px-4 pb-8 text-xs text-zinc-400 sm:px-6 lg:px-8">
            Live event details could not be refreshed right now.
          </p>
        )}
      </div>
    </>
  );
}

/* ── Sub-components ── */

function MetaCell({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1.5 px-5 py-5 first:pl-0 last:pr-0">
      <div className="flex items-center gap-1.5">
        {icon}
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-400">{label}</span>
      </div>
      <p className="text-sm font-semibold text-zinc-800">{value}</p>
    </div>
  );
}

function TicketCta({ event }: { event: DetailEvent }) {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">Tickets</p>
        <p className="serif mt-1 text-lg font-bold text-zinc-900">{event.goalLabel}</p>
      </div>
      {event.salesOpen !== false ? (
        <Link
          to={event.bookingHref!}
          className="primary-btn inline-flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3.5 text-sm font-bold text-white"
        >
          <Ticket className="h-4 w-4" />
          Continue to Tickets
        </Link>
      ) : (
        <div className="rounded-2xl bg-zinc-100 px-4 py-3.5 text-center text-sm font-semibold text-zinc-500">
          Online sales are closed
        </div>
      )}
    </div>
  );
}
