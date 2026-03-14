import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { Calendar, Clock, MapPin, ArrowLeft } from 'lucide-react';
import { format } from 'date-fns';
import Seo from '../components/Seo';
import { buildBreadcrumbSchema, cleanText, trimDescription } from '../lib/seo';
import { apiUrl } from '../lib/api';
import { SITE_ADDRESS, SITE_NAME } from '../lib/siteMeta';

interface Performance {
  id: string;
  date: string;
  salesCutoffAt?: string | null;
  salesOpen?: boolean;
}

interface CastMember {
  id: string;
  name: string;
  role: string;
  photoUrl?: string | null;
}

interface Show {
  id: string;
  title: string;
  description: string;
  posterUrl: string;
  type: string;
  year: number;
  accentColor: string;
  castMembers: CastMember[];
  performances: Performance[];
}

export default function ShowDetails() {
  const { id } = useParams();
  const [show, setShow] = useState<Show | null>(null);

  useEffect(() => {
    fetch(apiUrl(`/api/shows/${id}`))
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error || 'Failed to fetch show');
        }
        setShow({
          ...data,
          castMembers: Array.isArray(data.castMembers) ? data.castMembers : []
        });
      })
      .catch((err) => {
        console.error('Failed to fetch show', err);
        setShow(null);
      });
  }, [id]);

  if (!show) {
    return (
      <>
        <Seo
          title="Show Details | Penncrest Theater"
          description="Discover Penncrest Theater show details, performance dates, cast information, and ticket availability."
        />
        <div className="min-h-screen flex items-center justify-center">Loading...</div>
      </>
    );
  }

  const sortedPerformances = [...show.performances].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );
  const nextPerformance = sortedPerformances[0];
  const seoTitle = `${show.title} | Penncrest Theater Showtimes and Tickets`;
  const seoDescription = trimDescription(
    `${cleanText(show.description)} View cast details, performance times, and ticket information for ${show.title} at Penncrest High School Theater in Media, Pennsylvania.`
  );
  const structuredData = [
    {
      '@context': 'https://schema.org',
      '@type': 'Event',
      name: `${show.title} | ${SITE_NAME}`,
      description: seoDescription,
      image: [show.posterUrl],
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      location: {
        '@type': 'Place',
        name: 'Penncrest High School Auditorium',
        address: {
          '@type': 'PostalAddress',
          ...SITE_ADDRESS
        }
      },
      organizer: {
        '@type': 'PerformingGroup',
        name: SITE_NAME
      },
      performer: show.castMembers.slice(0, 12).map((member) => ({
        '@type': 'Person',
        name: member.name,
        roleName: member.role
      })),
      startDate: nextPerformance?.date,
      subEvent: sortedPerformances.map((performance) => ({
        '@type': 'Event',
        name: `${show.title} performance`,
        startDate: performance.date,
        eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
        location: {
          '@type': 'Place',
          name: 'Penncrest High School Auditorium',
          address: {
            '@type': 'PostalAddress',
            ...SITE_ADDRESS
          }
        }
      }))
    },
    buildBreadcrumbSchema([
      { name: 'Home', path: '/' },
      { name: 'Our Season', path: '/shows' },
      { name: show.title, path: `/shows/${show.id}` }
    ])
  ];

  return (
    <>
      <Seo
        title={seoTitle}
        description={seoDescription}
        structuredData={structuredData}
      />
      <div className="min-h-screen bg-white pb-14 sm:pb-20">
        {/* Banner */}
        <div className="relative h-[52vh] min-h-[420px] overflow-hidden bg-stone-900 sm:h-[60vh] sm:min-h-[500px]">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-red-700 via-red-600 to-amber-400 z-10" />
          <div className="absolute inset-0 opacity-40">
            <img src={show.posterUrl} alt={show.title} className="w-full h-full object-cover blur-sm" />
          </div>
          <div className="absolute inset-0 bg-gradient-to-t from-stone-900 via-stone-900/50 to-transparent"></div>

          <div className="absolute inset-0 flex items-end">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-20 w-full">
              <Link
                to="/shows"
                className="inline-flex items-center gap-2 text-white/70 hover:text-white mb-8 transition-colors"
                style={{ fontFamily: 'system-ui, sans-serif' }}
              >
                <ArrowLeft className="w-5 h-5 mr-2" /> Back to Our Season
              </Link>
              <motion.div
                initial={{ opacity: 0, y: 40 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8 }}
              >
                <div className="mb-6 flex flex-wrap items-center gap-3 sm:gap-4">
                  <span
                    className="bg-red-700 text-white px-4 py-1.5 rounded-full text-xs font-semibold uppercase tracking-[0.15em] shadow-lg"
                    style={{ fontFamily: 'system-ui, sans-serif' }}
                  >
                    {show.type}
                  </span>
                  <span
                    className="text-white/80 text-xs border border-white/25 px-4 py-1.5 rounded-full uppercase tracking-[0.15em] font-semibold"
                    style={{ fontFamily: 'system-ui, sans-serif' }}
                  >
                    {show.year} Season
                  </span>
                </div>
                <h1
                  className="mb-4 font-bold leading-none tracking-tight text-white shadow-sm sm:mb-6"
                  style={{ fontFamily: 'Georgia, serif', fontSize: 'clamp(2.6rem, 7vw, 5.6rem)' }}
                >
                  {show.title}
                </h1>
              </motion.div>
            </div>
          </div>
        </div>

        <div className="relative z-10 mx-auto -mt-8 max-w-7xl px-4 sm:-mt-10 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-3 lg:gap-12">
            {/* Main Content */}
            <div className="lg:col-span-2 space-y-12">
              <div className="rounded-3xl border border-stone-100 bg-white p-6 shadow-xl sm:p-8 md:p-12">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-red-600 mb-2" style={{ fontFamily: 'system-ui, sans-serif' }}>
                  Synopsis
                </p>
                <h2 className="mb-6 font-bold text-stone-900" style={{ fontFamily: 'Georgia, serif', fontSize: 'clamp(1.7rem, 4vw, 2.2rem)' }}>
                  About the Show
                </h2>
                <p className="whitespace-pre-line text-base leading-relaxed text-stone-600 sm:text-lg" style={{ fontFamily: 'system-ui, sans-serif' }}>
                  {show.description}
                </p>
              </div>

              {/* Cast Grid */}
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-red-600 mb-2" style={{ fontFamily: 'system-ui, sans-serif' }}>
                  Students
                </p>
                <h2 className="mb-6 font-bold text-stone-900 sm:mb-8" style={{ fontFamily: 'Georgia, serif', fontSize: 'clamp(1.7rem, 4vw, 2.2rem)' }}>
                  Meet the Cast
                </h2>
                {show.castMembers.length === 0 ? (
                  <div className="rounded-2xl border border-stone-200 bg-stone-50 p-5 text-sm text-stone-500">
                    Cast members will be listed here once published by the theater team.
                  </div>
                ) : (
                  <div className="flex overflow-x-auto gap-6 pb-8 -mx-4 px-4 md:mx-0 md:px-0 no-scrollbar snap-x snap-mandatory">
                    {show.castMembers.map((member) => (
                      <div key={member.id} className="flex-none w-40 md:w-48 snap-start group">
                        <div className="relative aspect-[3/4] bg-stone-200 rounded-xl overflow-hidden mb-3 shadow-md group-hover:shadow-xl transition-all duration-300 group-hover:-translate-y-1">
                          {member.photoUrl ? (
                            <img
                              src={member.photoUrl}
                              alt={member.name}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center bg-gradient-to-b from-stone-200 to-stone-300 text-stone-500 text-xs uppercase tracking-[0.14em] font-semibold">
                              No Photo
                            </div>
                          )}
                        </div>
                        <div className="text-center">
                          <div className="font-bold text-stone-900 text-lg leading-tight" style={{ fontFamily: 'Georgia, serif' }}>
                            {member.name}
                          </div>
                          <div className="text-stone-500 text-xs font-semibold uppercase tracking-[0.12em]" style={{ fontFamily: 'system-ui, sans-serif' }}>
                            {member.role}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Sidebar / Tickets */}
            <div className="lg:col-span-1">
              <div className="rounded-3xl border border-stone-100 bg-white p-6 shadow-lg sm:p-8 lg:sticky lg:top-24">
                <h3 className="text-2xl font-bold mb-6 flex items-center gap-2 text-stone-900" style={{ fontFamily: 'Georgia, serif' }}>
                  <Calendar className="w-6 h-6 text-red-600" />
                  Performances
                </h3>
                <div className="space-y-4">
                  {show.performances.map((perf) => (
                    <div key={perf.id} className="rounded-2xl border border-stone-100 bg-white p-4 shadow-sm transition-shadow hover:shadow-md sm:p-6">
                      <div className="flex justify-between items-start mb-4">
                        <div>
                          <div className="font-bold text-lg text-stone-900">
                            {format(new Date(perf.date), 'EEEE, MMMM d')}
                          </div>
                          <div className="text-stone-500 flex items-center gap-2 mt-1">
                            <Clock className="w-4 h-4" />
                            {format(new Date(perf.date), 'h:mm a')}
                          </div>
                        </div>
                      </div>
                      {perf.salesOpen !== false ? (
                        <Link
                          to={`/booking/${perf.id}`}
                          className="block w-full bg-red-700 text-white text-center py-3 rounded-xl font-semibold hover:bg-red-800 transition-colors"
                          style={{ fontFamily: 'system-ui, sans-serif' }}
                        >
                          Select Seats
                        </Link>
                      ) : (
                        <div className="block w-full bg-stone-200 text-stone-600 text-center py-3 rounded-xl font-semibold" style={{ fontFamily: 'system-ui, sans-serif' }}>
                          Online Sales Closed
                        </div>
                      )}
                      {perf.salesCutoffAt && (
                        <div className="mt-2 text-xs text-stone-500">
                          Online cutoff: {format(new Date(perf.salesCutoffAt), 'MMM d, h:mm a')}
                        </div>
                      )}
                    </div>
                  ))}
                  {show.performances.length === 0 && (
                    <div className="text-stone-500 italic">No upcoming performances scheduled.</div>
                  )}
                </div>

                <div className="mt-8 pt-8 border-t border-stone-200">
                  <div className="flex items-start gap-3 text-stone-600 text-sm">
                    <MapPin className="w-5 h-5 flex-shrink-0 mt-0.5 text-red-600" />
                    <div>
                      <span className="font-bold block text-stone-900" style={{ fontFamily: 'Georgia, serif' }}>Penncrest High School Auditorium</span>
                      134 Barren Rd, Media, PA 19063
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
