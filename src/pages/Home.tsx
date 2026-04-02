import { Link } from 'react-router-dom';
import { ArrowRight, Star, Ticket } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiUrl } from '../lib/api';

interface Show {
  id: string;
  title: string;
  description: string;
  posterUrl: string;
  type: string;
  year: number;
  accentColor: string;
}

function getEnrollmentSeasonLabel(date = new Date()) {
  const month = date.getMonth();
  const year = date.getFullYear();

  let season = 'Winter';

  if (month >= 2 && month <= 4) season = 'Spring';
  else if (month >= 5 && month <= 7) season = 'Fall';
  else if (month >= 8 && month <= 10) season = 'Fall';

  return `${season} ${year}`;
}

function ShowCard({ show, index }: { show: Show; index: number }) {
  return (
    <div
      className="transition-transform duration-300 hover:-translate-y-1.5"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <Link to={`/shows/${show.id}`} className="group block">
        <div className="bg-white rounded-2xl overflow-hidden border border-stone-100 shadow-sm hover:shadow-xl transition-shadow duration-500">
          <div className="aspect-[4/3] overflow-hidden relative">
            <img src={show.posterUrl} alt={show.title} className="object-cover w-full h-full transition-transform duration-500 group-hover:scale-[1.03]" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end p-5">
              <span className="text-white font-semibold bg-red-700 px-4 py-1.5 rounded-full text-sm">
                Get Tickets
              </span>
            </div>
          </div>
          <div className="p-6">
            <div className="flex items-center gap-2.5 mb-3">
              <span className="bg-red-50 text-red-700 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider border border-red-100">
                {show.type}
              </span>
              <span className="text-stone-300 text-xs font-semibold">{show.year}</span>
            </div>
            {/* Serif title to match About */}
            <h3
              className="mb-1.5 group-hover:text-red-700 transition-colors duration-200 font-bold text-stone-900"
              style={{ fontFamily: 'Georgia, serif', fontSize: '1.2rem', lineHeight: 1.3 }}
            >
              {show.title}
            </h3>
            <p className="line-clamp-2 text-sm leading-relaxed text-stone-600">{show.description}</p>
          </div>
        </div>
      </Link>
    </div>
  );
}

export default function Home() {
  const [shows, setShows] = useState<Show[]>([]);
  const enrollmentSeasonLabel = getEnrollmentSeasonLabel();

  useEffect(() => {
    fetch(apiUrl('/api/shows'))
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok || !Array.isArray(data)) { setShows([]); return; }
        setShows(data);
      })
      .catch(() => setShows([]));
  }, []);

  const featuredShow = shows[0];

  return (
    <div className="overflow-hidden">

      {/* ── HERO ── */}
      <section className="relative overflow-hidden bg-stone-50 pb-20 pt-14 sm:pb-32 sm:pt-20">
        <div className="pointer-events-none absolute right-[-6rem] top-[-3rem] h-[22rem] w-[22rem] rounded-full bg-red-100 opacity-50 blur-3xl sm:right-0 sm:top-0 sm:h-[36rem] sm:w-[36rem]" />
        <div className="pointer-events-none absolute bottom-[-10rem] left-[-4rem] h-72 w-72 rounded-full bg-amber-100 opacity-60 blur-3xl sm:-bottom-40 sm:left-0 sm:h-96 sm:w-96" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">

            {/* Left */}
            <div>
              <div
                className="inline-flex items-center gap-2 bg-red-700 text-white text-xs font-semibold px-4 py-1.5 rounded-full uppercase tracking-widest mb-7"
                style={{ fontFamily: 'system-ui, sans-serif' }}
              >
                <Star className="w-3 h-3 fill-amber-300 text-amber-300" />
                Now Enrolling for {enrollmentSeasonLabel}
              </div>

              <h1 className="mb-6 leading-none tracking-tight text-stone-900" style={{ fontFamily: 'Georgia, serif' }}>
                <span className="block text-5xl font-bold sm:text-6xl md:text-7xl">Penncrest</span>
                <span className="block text-5xl font-bold italic text-red-700 sm:text-6xl md:text-7xl">Theater</span>
              </h1>

              <p
                className="mb-8 max-w-lg text-base leading-relaxed text-stone-700 sm:text-lg md:mb-10"
                style={{ fontFamily: 'system-ui, sans-serif' }}
              >
                Bringing stories to life in Media, PA. Join us for a season of creativity, community, and unforgettable performances.
              </p>

              <div className="flex flex-wrap gap-3">
                <Link to="/shows"
                  className="group flex w-full items-center justify-center gap-2 rounded-full bg-red-700 px-8 py-3.5 text-base font-semibold text-white shadow-md shadow-red-200 transition-all hover:scale-105 hover:bg-red-800 sm:w-auto"
                  style={{ fontFamily: 'system-ui, sans-serif' }}
                >
                  <Ticket className="w-4 h-4" />
                  Get Tickets
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </Link>
                <Link to="/about"
                  className="w-full rounded-full border border-stone-200 bg-white px-8 py-3.5 text-center text-base font-semibold text-stone-700 transition-all hover:border-stone-300 hover:bg-stone-50 sm:w-auto"
                  style={{ fontFamily: 'system-ui, sans-serif' }}
                >
                  Join the Cast
                </Link>
              </div>

              {featuredShow && (
                <div className="mt-8 lg:hidden">
                  <Link to={`/shows/${featuredShow.id}`} className="block rounded-2xl border border-stone-200 bg-white p-3 shadow-lg shadow-stone-200/70">
                    <div className="flex items-center gap-3">
                      <div className="h-24 w-18 shrink-0 overflow-hidden rounded-xl bg-stone-200">
                        <img src={featuredShow.posterUrl} alt={featuredShow.title} className="h-full w-full object-cover" />
                      </div>
                      <div className="min-w-0">
                        <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-red-600">
                          Featured Production
                        </p>
                        <p className="line-clamp-2 text-lg font-bold text-stone-900" style={{ fontFamily: 'Georgia, serif' }}>
                          {featuredShow.title}
                        </p>
                        <p className="mt-1 text-sm text-stone-600">
                          {featuredShow.type} · {featuredShow.year}
                        </p>
                      </div>
                    </div>
                  </Link>
                </div>
              )}
            </div>

            <div className="relative h-[580px] hidden lg:block">
              {featuredShow && (
                <div className="absolute top-10 right-20 z-20 w-72 cursor-pointer rounded-2xl bg-white p-3.5 shadow-2xl transition-transform duration-300 hover:scale-[1.02]">
                  <div className="aspect-[2/3] bg-stone-200 rounded-xl overflow-hidden mb-3 relative">
                    <img src={featuredShow.posterUrl} alt={featuredShow.title} className="object-cover w-full h-full" />
                    <div className="absolute top-3 right-3 bg-amber-400 text-stone-900 font-semibold px-3 py-1 rounded-full text-xs uppercase tracking-wide shadow">
                      Upcoming
                    </div>
                  </div>
                  <h3 className="font-bold text-lg mb-0.5 text-stone-900" style={{ fontFamily: 'Georgia, serif' }}>{featuredShow.title}</h3>
                  <p className="text-sm text-stone-600" style={{ fontFamily: 'system-ui, sans-serif' }}>{featuredShow.type} · {featuredShow.year}</p>
                </div>
              )}

              <div className="absolute right-0 top-32 z-10 w-64 rounded-2xl bg-red-700/20 p-4 rotate-[5deg]">
                <div className="aspect-[2/3] bg-red-700/20 rounded-xl" />
              </div>

            </div>

          </div>
        </div>
      </section>

      {/* ── ON STAGE ── */}
      <section className="bg-white py-16 sm:py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-12 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-widest text-red-600" style={{ fontFamily: 'system-ui, sans-serif' }}>
                This Season
              </p>
              <h2 className="font-bold text-stone-900" style={{ fontFamily: 'Georgia, serif', fontSize: 'clamp(1.8rem, 4vw, 2.8rem)' }}>
                On Stage
              </h2>
            </div>
            <div>
              <Link to="/shows" className="group hidden items-center gap-2 text-sm font-semibold text-stone-500 transition-colors hover:text-red-700 md:flex" style={{ fontFamily: 'system-ui, sans-serif' }}>
                View Our Season
                <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {shows.map((show, i) => (
              <div key={show.id}>
                <ShowCard show={show} index={i} />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── COMMUNITY ── */}
      <section className="relative overflow-hidden bg-stone-900 py-16 text-white sm:py-24">
        <div
          className="absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.2) 1px, transparent 0)',
            backgroundSize: '24px 24px'
          }}
        />
        <div className="pointer-events-none absolute left-1/3 top-0 h-96 w-96 rounded-full bg-red-900/40 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 right-1/3 h-80 w-80 rounded-full bg-amber-900/30 blur-3xl" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center">
          <div>
            <Star className="w-10 h-10 text-amber-400 mx-auto mb-6 fill-amber-400/30" />
          </div>

          <h2 className="mb-5 font-bold tracking-tight sm:mb-6" style={{ fontFamily: 'Georgia, serif', fontSize: 'clamp(1.8rem, 5vw, 3.2rem)' }}>
            More Than Just a Stage
          </h2>

          <p className="mx-auto mb-10 max-w-xl text-base leading-relaxed text-stone-300 sm:mb-12 sm:text-lg" style={{ fontFamily: 'system-ui, sans-serif' }}>
            We are a community of actors, designers, technicians, and dreamers.
            Every ticket you buy supports arts education at Penncrest High School.
          </p>

          <div className="mx-auto grid max-w-3xl grid-cols-1 gap-4 justify-items-center sm:grid-cols-3 sm:gap-5">
            {[
              { label: 'Productions', value: '100+' },
              { label: 'Students',    value: '50+'  },
              { label: 'Years',       value: '25+'  },
            ].map((stat, i) => (
              <div
                key={stat.label}
                className="w-full cursor-default rounded-2xl border border-stone-700/50 bg-stone-800/40 p-6 text-center transition-transform duration-200 hover:scale-[1.02]"
              >
                <div className="mb-1 text-4xl font-black text-amber-400" style={{ fontFamily: 'Georgia, serif' }}>
                  {stat.value}
                </div>
                <div className="text-xs font-semibold uppercase tracking-widest text-stone-300" style={{ fontFamily: 'system-ui, sans-serif' }}>{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

    </div>
  );
}
