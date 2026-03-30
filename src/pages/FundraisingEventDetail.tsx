import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CalendarDays, Clock3, MapPin, Target } from 'lucide-react';
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

export default function FundraisingEventDetail() {
  const { slug } = useParams<{ slug: string }>();
  const event = slug ? getFundraisingEventBySlug(slug) : undefined;
  const [liveSponsors, setLiveSponsors] = useState<LiveFundraisingSponsor[]>([]);
  const [sponsorLoadFailed, setSponsorLoadFailed] = useState(false);

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

  if (!event) {
    return (
      <section className="mx-auto max-w-4xl px-4 py-20 text-center sm:px-6 lg:px-8">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-red-700">Fundraising Event</p>
        <h1 className="mt-2 text-4xl font-bold text-stone-900" style={{ fontFamily: 'Georgia, serif' }}>
          Event Not Found
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-sm leading-relaxed text-stone-600">
          This fundraising event page is not available yet. Use the link below to return to the full fundraising schedule.
        </p>
        <Link
          to="/fundraising"
          className="mt-7 inline-flex items-center gap-2 rounded-full bg-red-700 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-800"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Fundraising
        </Link>
      </section>
    );
  }

  const relatedEvents = fundraisingEvents.filter((item) => item.slug !== event.slug);
  const featuredSponsors = useMemo(
    () => (liveSponsors.length > 0 ? liveSponsors : sponsorLoadFailed ? fundraisingSponsors : []).slice(0, 3),
    [liveSponsors, sponsorLoadFailed]
  );

  return (
    <div className="bg-white text-stone-900">
      <section className="relative overflow-hidden border-b border-stone-200">
        <img src={event.heroImageUrl} alt={event.title} className="h-[52vh] min-h-[360px] w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/35 to-black/10" />
        <div className="absolute inset-x-0 bottom-0 mx-auto max-w-7xl px-4 pb-9 sm:px-6 lg:px-8">
          <Link
            to="/fundraising"
            className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/35 bg-black/20 px-4 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:bg-black/35"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Fundraising
          </Link>
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
          <InfoCard icon={<Target className="h-4 w-4 text-red-700" />} label="Fundraising Goal" value={event.goalLabel} />
        </div>

        <div className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-5">
          <article className="lg:col-span-3 rounded-2xl border border-stone-200 bg-stone-50 p-6">
            <h2 className="text-2xl font-bold text-stone-900" style={{ fontFamily: 'Georgia, serif' }}>
              Event Highlights
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
                  to={`/fundraising/events/${related.slug}`}
                  className="overflow-hidden rounded-2xl border border-stone-200 bg-white transition-shadow hover:shadow-md"
                >
                  <img src={related.heroImageUrl} alt={related.title} className="h-44 w-full object-cover" />
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
