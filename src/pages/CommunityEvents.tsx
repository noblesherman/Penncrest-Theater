/*
Handoff note for Mr. Smith:
- File: `src/pages/CommunityEvents.tsx`
- What this is: Public web route page.
- What it does: Renders a full user-facing page for the theater site.
- Connections: Registered in `src/App.tsx` and backed by shared components/helpers in `src/components` + `src/lib`.
- Main content type: Page layout + visible text + route-level logic.
- Safe edits here: Wording, headings, section order, and styling tweaks.
- Be careful with: Form payloads, URL param handling, and API response assumptions.
- Useful context: This folder is one of the most common edit points for visible site content.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowRight, CalendarDays, Megaphone, Star } from 'lucide-react';
import { fundraisingEvents, fundraisingSponsors } from '../lib/fundraisingContent';
import { apiFetch } from '../lib/api';

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

function formatEventDate(iso: string): { dateLabel: string; timeLabel: string } {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { dateLabel: 'TBD', timeLabel: 'TBD' };
  return {
    dateLabel: date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }),
    timeLabel: date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  };
}

export default function CommunityEvents() {
  const [liveEvents, setLiveEvents] = useState<LiveFundraisingEvent[]>([]);
  const [liveLoadFailed, setLiveLoadFailed] = useState(false);
  const [liveSponsors, setLiveSponsors] = useState<LiveFundraisingSponsor[]>([]);
  const [sponsorLoadFailed, setSponsorLoadFailed] = useState(false);

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
        id: event.id,
        title: event.title,
        dateLabel,
        timeLabel,
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
  const featuredEvent = displayedEvents[0];
  const secondaryEvents = displayedEvents.slice(1);

  return (
    <div className="bg-white font-sans text-stone-900">
      <style>{`.serif { font-family: Georgia, serif; }`}</style>
      <section className="border-b border-stone-100 bg-stone-50 pb-16 pt-14 sm:pt-20 max-sm:pb-12 max-sm:pt-10">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
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
              Community Events
            </span>
          </motion.div>

          <div className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <motion.h1
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, delay: 0.05 }}
              className="serif text-5xl font-bold tracking-tight text-stone-900 sm:text-6xl lg:text-7xl max-sm:text-4xl max-sm:leading-tight"
            >
              Current<br />
              <em className="text-red-800 not-italic">Community Events</em>
            </motion.h1>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.45, delay: 0.15 }}
              className="max-w-sm text-sm leading-relaxed text-stone-500 sm:text-right sm:text-base max-sm:max-w-none"
            >
              Explore the fundraising events and community nights supporting Penncrest Theater students all season long.
            </motion.p>
          </div>

          {featuredEvent ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="grid grid-cols-1 gap-4 lg:grid-cols-12"
            >
              <Link
                to={featuredEvent.linkHref}
                className="group relative min-h-[320px] overflow-hidden rounded-3xl sm:min-h-[420px] lg:col-span-7"
              >
                <img
                  src={featuredEvent.imageUrl}
                  alt={featuredEvent.title}
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/88 via-black/35 to-transparent" />
                <div className="absolute bottom-0 p-7 sm:p-8 max-sm:p-5">
                  <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 backdrop-blur-sm max-sm:hidden">
                    <CalendarDays className="h-3 w-3 text-amber-300" />
                    <span className="text-xs font-semibold text-amber-200">
                      {featuredEvent.dateLabel} · {featuredEvent.timeLabel}
                    </span>
                  </div>
                  <h2 className="serif text-3xl font-bold text-white sm:text-4xl max-sm:text-2xl">{featuredEvent.title}</h2>
                  {featuredEvent.location && <p className="mt-1 text-xs text-stone-400 max-sm:hidden">{featuredEvent.location}</p>}
                  <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-stone-900 transition group-hover:bg-stone-100 max-sm:hidden">
                    {featuredEvent.ctaLabel}
                    <ArrowRight className="h-3.5 w-3.5" />
                  </div>
                </div>
              </Link>

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
                    <Link to={event.linkHref} className="group relative flex h-full min-h-[190px] overflow-hidden rounded-3xl max-sm:min-h-[170px]">
                      <img src={event.imageUrl} alt={event.title} className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
                      <div className="absolute bottom-0 p-5">
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-300 max-sm:hidden">{event.dateLabel}</p>
                        <h3 className="serif mt-1 text-xl font-bold text-white">{event.title}</h3>
                        {event.seatModeLabel && <p className="mt-0.5 text-xs text-stone-400 max-sm:hidden">{event.seatModeLabel}</p>}
                      </div>
                    </Link>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          ) : null}
        </div>
      </section>

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

      {displayedEvents.length > 0 && (
        <section className="border-t border-stone-100 bg-stone-50/60 py-12">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mb-5 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-400">
                All Community Events
              </p>
              {featuredEvent && (
                <Link
                  to={featuredEvent.linkHref}
                  className="hidden items-center gap-1.5 text-sm font-semibold text-red-700 transition hover:text-red-900 sm:inline-flex"
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

      <section className="border-t border-stone-100 bg-white py-14 sm:py-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="rounded-2xl border border-red-100 bg-red-50 px-6 py-7 sm:px-8 sm:py-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] font-semibold text-red-600 mb-2">Support</p>
              <h3 className="serif font-bold text-stone-900 text-2xl sm:text-3xl">
                Want to donate or sponsor this season?
              </h3>
            </div>
            <Link
              to="/fundraising"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-red-700 text-white px-6 py-3 font-semibold hover:bg-red-800 transition-colors"
            >
              Go to Fundraising
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
