import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CalendarDays, Clock3, MapPin, Settings, Target, Ticket } from 'lucide-react';
import { getFundraisingEventBySlug, fundraisingEvents, fundraisingSponsors } from '../lib/fundraisingContent';
import { apiFetch } from '../lib/api';

type LiveFundraisingSponsor = {
  id: string;
  name: string;
  tier: 'Gold' | 'Silver' | 'Bronze';
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
  if (Number.isNaN(date.getTime())) {
    return { dateLabel: 'TBD', timeLabel: 'TBD' };
  }

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
  if (maxPrice > minPrice) return `${formatUsd(minPrice)} - ${formatUsd(maxPrice)}`;
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

  useEffect(() => {
    setLiveEventsLoading(true);
    apiFetch<LiveFundraisingEvent[]>('/api/fundraising/events')
      .then((items) => {
        if (Array.isArray(items)) {
          setLiveEvents(items);
          setLiveEventsLoadFailed(false);
        }
      })
      .catch(() => {
        setLiveEvents([]);
        setLiveEventsLoadFailed(true);
      })
      .finally(() => {
        setLiveEventsLoading(false);
      });
  }, []);

  const liveEvent = useMemo(() => {
    if (!slug) return undefined;
    return liveEvents.find((event) => event.id === slug);
  }, [liveEvents, slug]);

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
        goalLabel: staticEvent.goalLabel,
        details: staticEvent.details,
        linkHref: `/fundraising/events/${staticEvent.slug}`,
        source: 'static'
      };
    }

    if (liveEvent) {
      const { dateLabel, timeLabel } = formatEventDate(liveEvent.startsAt);
      const seatModeLabel = liveEvent.seatSelectionEnabled ? 'Reserved Seating' : 'General Admission';
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
        longDescription:
          liveEvent.notes ||
          liveEvent.description ||
          'Join this fundraising event to support student performers, technicians, and theater programs all season long.',
        goalLabel: liveEvent.salesOpen ? `Tickets ${priceLabel}` : 'Sales Closed',
        details: [
          `Ticketing: ${seatModeLabel}`,
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
      return liveEvents
        .filter((item) => item.id !== event.id)
        .slice(0, 4)
        .map((item) => ({
          id: item.id,
          title: item.title,
          imageUrl: item.posterUrl || 'https://picsum.photos/id/1074/1200/800',
          dateLabel: formatEventDate(item.startsAt).dateLabel,
          linkHref: `/fundraising/events/${item.id}`
        }));
    }

    return fundraisingEvents
      .filter((item) => item.id !== event.id)
      .slice(0, 4)
      .map((item) => ({
        id: item.id,
        title: item.title,
        imageUrl: item.heroImageUrl,
        dateLabel: item.dateLabel,
        linkHref: `/fundraising/events/${item.slug}`
      }));
  }, [event, liveEvents]);

  if (!staticEvent && liveEventsLoading && !liveEventsLoadFailed) {
    return (
      <section className="mx-auto max-w-4xl px-4 py-20 text-center sm:px-6 lg:px-8">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-red-700">Fundraising Event</p>
        <h1 className="mt-2 text-4xl font-bold text-stone-900" style={{ fontFamily: 'Georgia, serif' }}>
          Loading Event Details
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-stone-600">
          Retrieving the latest fundraiser information...
        </p>
      </section>
    );
  }

  if (!event) {
    return (
      <section className="mx-auto max-w-4xl px-4 py-20 text-center sm:px-6 lg:px-8">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-red-700">Fundraising Event</p>
        <h1 className="mt-2 text-4xl font-bold text-stone-900" style={{ fontFamily: 'Georgia, serif' }}>
          Event Not Found
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-stone-600">
          This fundraising event page is not available yet. You can return to fundraising or manage events from the admin portal.
        </p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <Link
            to="/fundraising"
            className="inline-flex items-center gap-2 rounded-full bg-red-700 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-800"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Fundraising
          </Link>
          <Link
            to="/admin/fundraise"
            className="inline-flex items-center gap-2 rounded-full border border-stone-300 bg-white px-5 py-2.5 text-sm font-semibold text-stone-700 transition-colors hover:border-stone-400"
          >
            <Settings className="h-4 w-4" />
            Admin Portal
          </Link>
        </div>
      </section>
    );
  }

  return (
    <div className="bg-white text-stone-900">
      <section className="relative overflow-hidden border-b border-stone-200">
        <img src={event.heroImageUrl} alt={event.title} className="h-[52vh] min-h-[360px] w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/35 to-black/10" />
        <div className="absolute inset-x-0 bottom-0 mx-auto max-w-7xl px-4 pb-9 sm:px-6 lg:px-8">
          <div className="mb-4 flex flex-wrap gap-2">
            <Link
              to="/fundraising"
              className="inline-flex items-center gap-2 rounded-full border border-white/35 bg-black/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-black/35"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Fundraising
            </Link>
            <Link
              to="/admin/fundraise"
              className="inline-flex items-center gap-2 rounded-full border border-white/35 bg-black/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-black/35"
            >
              <Settings className="h-3.5 w-3.5" />
              Admin Portal
            </Link>
            {event.bookingHref && event.salesOpen !== false ? (
              <Link
                to={event.bookingHref}
                className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-stone-900 transition-colors hover:bg-stone-100"
              >
                <Ticket className="h-3.5 w-3.5" />
                Buy Tickets
              </Link>
            ) : null}
          </div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-200">{event.goalLabel}</p>
          <h1 className="mt-2 text-4xl font-bold text-white sm:text-5xl" style={{ fontFamily: 'Georgia, serif' }}>
            {event.title}
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-stone-200 sm:text-base">{event.longDescription}</p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <InfoCard icon={<CalendarDays className="h-4 w-4 text-red-700" />} label="Date" value={event.dateLabel} />
          <InfoCard icon={<Clock3 className="h-4 w-4 text-red-700" />} label="Time" value={event.timeLabel} />
          <InfoCard icon={<MapPin className="h-4 w-4 text-red-700" />} label="Location" value={event.location} />
          <InfoCard icon={<Target className="h-4 w-4 text-red-700" />} label="Event Focus" value={event.goalLabel} />
        </div>

        <div className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-5">
          <article className="lg:col-span-3 rounded-2xl border border-stone-200 bg-stone-50 p-6">
            <h2 className="text-2xl font-bold text-stone-900" style={{ fontFamily: 'Georgia, serif' }}>
              Event Overview
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-stone-600">{event.summary}</p>
            <ul className="mt-5 space-y-2">
              {event.details.map((detail) => (
                <li key={detail} className="rounded-lg bg-white px-4 py-3 text-sm text-stone-700">
                  {detail}
                </li>
              ))}
            </ul>
          </article>

          <aside className="lg:col-span-2 rounded-2xl border border-stone-200 bg-white p-6">
            <h2 className="text-xl font-bold text-stone-900" style={{ fontFamily: 'Georgia, serif' }}>
              Sponsor Spotlight
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-stone-600">
              Local partners help fund the student experience behind every production.
            </p>
            <div className="mt-4 space-y-3">
              {featuredSponsors.map((sponsor) => (
                <a
                  key={sponsor.id}
                  href={sponsor.websiteUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-xl border border-stone-200 p-3 transition-colors hover:border-stone-300"
                >
                  <img src={sponsor.logoUrl} alt={sponsor.name} className="h-9 w-auto object-contain" />
                  <p className="mt-2 text-xs uppercase tracking-[0.13em] text-red-700">{sponsor.tier} Sponsor</p>
                </a>
              ))}
            </div>

            {event.bookingHref ? (
              <div className="mt-6 rounded-xl border border-stone-200 bg-stone-50 p-4">
                {event.salesOpen !== false ? (
                  <Link
                    to={event.bookingHref}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-red-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-800"
                  >
                    <Ticket className="h-4 w-4" />
                    Continue to Tickets
                  </Link>
                ) : (
                  <div className="rounded-xl bg-stone-200 px-4 py-2.5 text-center text-sm font-semibold text-stone-600">
                    Online sales are closed for this event
                  </div>
                )}
                <Link
                  to="/admin/fundraise"
                  className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 transition-colors hover:border-stone-400"
                >
                  <Settings className="h-4 w-4" />
                  Open In Admin Portal
                </Link>
              </div>
            ) : null}
          </aside>
        </div>
      </section>

      {relatedEvents.length > 0 ? (
        <section className="border-t border-stone-200 bg-stone-50 py-12">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <h2 className="text-2xl font-bold text-stone-900" style={{ fontFamily: 'Georgia, serif' }}>
              More Fundraising Events
            </h2>
            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
              {relatedEvents.map((related) => (
                <Link
                  key={related.id}
                  to={related.linkHref}
                  className="overflow-hidden rounded-2xl border border-stone-200 bg-white transition-shadow hover:shadow-md"
                >
                  <img src={related.imageUrl} alt={related.title} className="h-44 w-full object-cover" />
                  <div className="p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-red-700">{related.dateLabel}</p>
                    <h3 className="mt-1 text-xl font-bold text-stone-900" style={{ fontFamily: 'Georgia, serif' }}>
                      {related.title}
                    </h3>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {event.source === 'live' && liveEventsLoadFailed ? (
        <div className="mx-auto max-w-7xl px-4 pb-10 text-xs text-stone-500 sm:px-6 lg:px-8">
          Live event details could not be refreshed right now.
        </div>
      ) : null}
    </div>
  );
}

function InfoCard({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <article className="rounded-xl border border-stone-200 bg-white p-4">
      <p className="mb-2 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">
        {icon}
        {label}
      </p>
      <p className="text-sm font-semibold text-stone-900">{value}</p>
    </article>
  );
}
