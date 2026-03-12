import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowRight, Ticket } from 'lucide-react';

interface Show {
  id: string;
  title: string;
  description: string;
  posterUrl: string;
  type: string;
  year: number;
  accentColor: string;
}

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-60px' },
  transition: { duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] },
});

export default function Shows() {
  const [shows, setShows] = useState<Show[]>([]);

  useEffect(() => {
    fetch('/api/shows')
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok || !Array.isArray(data)) {
          console.error('Failed to fetch shows', data);
          setShows([]);
          return;
        }
        setShows(data);
      })
      .catch((err) => {
        console.error('Failed to fetch shows', err);
        setShows([]);
      });
  }, []);

  return (
    <div className="bg-white text-stone-900 overflow-hidden">
      <section className="border-b border-stone-100 bg-white relative">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-red-700 via-red-600 to-amber-400" />
        <div className="max-w-7xl mx-auto px-6 sm:px-10 pt-14 pb-10 sm:pt-16 sm:pb-12">
          <motion.p
            {...fadeUp(0)}
            className="text-xs font-semibold uppercase tracking-[0.2em] text-red-600 mb-3"
            style={{ fontFamily: 'system-ui, sans-serif' }}
          >
            Penncrest High School Theater
          </motion.p>
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
            <motion.h1
              {...fadeUp(0.07)}
              className="font-bold leading-none"
              style={{ fontFamily: 'Georgia, serif', fontSize: 'clamp(2.8rem, 7vw, 5.2rem)' }}
            >
              Our <em className="text-red-700 not-italic">Season</em>
            </motion.h1>
            <motion.p
              {...fadeUp(0.15)}
              className="text-stone-400 max-w-md leading-relaxed text-base lg:text-right"
              style={{ fontFamily: 'system-ui, sans-serif' }}
            >
              From fall opener to spring finale, explore the productions lighting up the Penncrest stage.
            </motion.p>
          </div>
        </div>
      </section>

      <section className="bg-stone-50 py-16 sm:py-20">
        <div className="max-w-7xl mx-auto px-6 sm:px-10">
          <div className="mb-10">
            <motion.p
              {...fadeUp(0)}
              className="text-xs font-semibold uppercase tracking-[0.2em] text-red-600 mb-2"
              style={{ fontFamily: 'system-ui, sans-serif' }}
            >
              On Stage
            </motion.p>
            <motion.h2
              {...fadeUp(0.07)}
              className="font-bold"
              style={{ fontFamily: 'Georgia, serif', fontSize: 'clamp(1.8rem, 4vw, 2.8rem)' }}
            >
              Upcoming Productions
            </motion.h2>
          </div>

          {shows.length === 0 ? (
            <motion.div
              {...fadeUp(0.12)}
              className="rounded-2xl border border-stone-200 bg-white p-8 sm:p-10 text-center"
            >
              <h3
                className="font-bold text-stone-900 mb-2"
                style={{ fontFamily: 'Georgia, serif', fontSize: '1.5rem' }}
              >
                No shows posted yet
              </h3>
              <p className="text-stone-500" style={{ fontFamily: 'system-ui, sans-serif' }}>
                Check back soon for new season announcements.
              </p>
            </motion.div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {shows.map((show, index) => (
                <motion.div key={show.id} {...fadeUp(index * 0.08)}>
                  <Link to={`/shows/${show.id}`} className="group block h-full">
                    <article className="h-full rounded-2xl overflow-hidden border border-stone-100 bg-white shadow-sm hover:shadow-xl transition-all duration-300">
                      <div className="aspect-[4/3] overflow-hidden relative">
                        <motion.img
                          whileHover={{ scale: 1.05 }}
                          transition={{ duration: 0.45 }}
                          src={show.posterUrl}
                          alt={show.title}
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute top-4 left-4 bg-white/90 backdrop-blur-sm px-3 py-1.5 rounded-full text-xs font-semibold text-stone-700 shadow-sm">
                          {show.year}
                        </div>
                      </div>

                      <div className="p-6 flex flex-col h-[calc(100%-0px)]">
                        <div className="flex items-center gap-2 mb-3">
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: show.accentColor || '#b91c1c' }}
                          />
                          <span
                            className="text-xs uppercase tracking-[0.15em] font-semibold text-red-600"
                            style={{ fontFamily: 'system-ui, sans-serif' }}
                          >
                            {show.type}
                          </span>
                        </div>

                        <h3
                          className="font-bold text-stone-900 mb-2 group-hover:text-red-700 transition-colors"
                          style={{ fontFamily: 'Georgia, serif', fontSize: '1.4rem', lineHeight: 1.3 }}
                        >
                          {show.title}
                        </h3>

                        <p
                          className="text-stone-500 text-sm leading-relaxed flex-1"
                          style={{ fontFamily: 'system-ui, sans-serif' }}
                        >
                          {show.description}
                        </p>

                        <span
                          className="mt-5 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.15em] text-red-600"
                          style={{ fontFamily: 'system-ui, sans-serif' }}
                        >
                          <Ticket className="w-3.5 h-3.5" />
                          View Details
                          <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                        </span>
                      </div>
                    </article>
                  </Link>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="bg-white py-14 sm:py-16 border-t border-stone-100">
        <div className="max-w-7xl mx-auto px-6 sm:px-10">
          <motion.div
            {...fadeUp(0)}
            className="rounded-2xl border border-red-100 bg-red-50 px-6 py-7 sm:px-8 sm:py-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
          >
            <div>
              <p
                className="text-xs uppercase tracking-[0.2em] font-semibold text-red-600 mb-2"
                style={{ fontFamily: 'system-ui, sans-serif' }}
              >
                Join Us
              </p>
              <h3
                className="font-bold text-stone-900"
                style={{ fontFamily: 'Georgia, serif', fontSize: 'clamp(1.3rem, 3vw, 2rem)' }}
              >
                Support the next standing ovation.
              </h3>
            </div>
            <Link
              to="/about"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-red-700 text-white px-6 py-3 font-semibold hover:bg-red-800 transition-colors"
              style={{ fontFamily: 'system-ui, sans-serif' }}
            >
              Learn About the Program
              <ArrowRight className="w-4 h-4" />
            </Link>
          </motion.div>
        </div>
      </section>
    </div>
  );
}
