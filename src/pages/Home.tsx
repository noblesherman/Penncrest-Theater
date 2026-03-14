import { motion, useScroll, useTransform, useSpring } from 'motion/react';
import { Link } from 'react-router-dom';
import { ArrowRight, Star, Ticket } from 'lucide-react';
import { useEffect, useState, useRef } from 'react';
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

function AnimatedWord({ word, className, delay = 0 }: { word: string; className?: string; delay?: number }) {
  return (
    <span className={className} style={{ display: 'inline-block', overflow: 'hidden' }}>
      {word.split('').map((char, i) => (
        <motion.span
          key={i}
          initial={{ y: '110%', opacity: 0 }}
          animate={{ y: '0%', opacity: 1 }}
          transition={{ duration: 0.6, delay: delay + i * 0.04, ease: [0.22, 1, 0.36, 1] }}
          style={{ display: 'inline-block' }}
        >
          {char}
        </motion.span>
      ))}
    </span>
  );
}

function ShowCard({ show, index }: { show: Show; index: number }) {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const y = useTransform(scrollYProgress, [0, 1], [50, -50]);

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.65, delay: index * 0.1, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -8, transition: { duration: 0.28 } }}
    >
      <Link to={`/shows/${show.id}`} className="group block">
        <div className="bg-white rounded-2xl overflow-hidden border border-stone-100 shadow-sm hover:shadow-xl transition-shadow duration-500">
          <div className="aspect-[4/3] overflow-hidden relative">
            <motion.img
              style={{ y }}
              src={show.posterUrl}
              alt={show.title}
              className="object-cover w-full h-[115%] -mt-[7.5%]"
            />
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
            <p className="text-stone-400 line-clamp-2 text-sm leading-relaxed">{show.description}</p>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

export default function Home() {
  const [shows, setShows] = useState<Show[]>([]);
  const heroRef = useRef(null);
  const { scrollYProgress: heroScroll } = useScroll({ target: heroRef, offset: ['start start', 'end start'] });

  const blobY1     = useTransform(heroScroll, [0, 1], [0, -100]);
  const blobY2     = useTransform(heroScroll, [0, 1], [0, -60]);
  const textY      = useTransform(heroScroll, [0, 1], [0, 55]);
  const cardY      = useTransform(heroScroll, [0, 1], [0, -35]);
  const rawRot     = useTransform(heroScroll, [0, 1], [-4, 4]);
  const cardRotate = useSpring(rawRot, { stiffness: 60, damping: 20 });

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
      <section ref={heroRef} className="relative overflow-hidden bg-stone-50 pb-20 pt-14 sm:pt-20 sm:pb-32">
        <motion.div style={{ y: blobY1 }}
          className="absolute top-0 right-0 w-[36rem] h-[36rem] bg-red-100 rounded-full mix-blend-multiply filter blur-3xl opacity-50 pointer-events-none" />
        <motion.div style={{ y: blobY2 }}
          className="absolute -bottom-40 left-0 w-96 h-96 bg-amber-100 rounded-full mix-blend-multiply filter blur-3xl opacity-60 pointer-events-none" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">

            {/* Left */}
            <motion.div style={{ y: textY }}>
              <motion.div
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6 }}
                className="inline-flex items-center gap-2 bg-red-700 text-white text-xs font-semibold px-4 py-1.5 rounded-full uppercase tracking-widest mb-7"
                style={{ fontFamily: 'system-ui, sans-serif' }}
              >
                <Star className="w-3 h-3 fill-amber-300 text-amber-300" />
                Now Enrolling for Fall 2024
              </motion.div>

              {/* Serif headline matching About's style */}
              <h1 className="mb-6 leading-none tracking-tight text-stone-900" style={{ fontFamily: 'Georgia, serif' }}>
                <div style={{ overflow: 'hidden' }}>
                  <AnimatedWord word="Penncrest" delay={0.1}
                    className="block font-bold text-5xl sm:text-6xl md:text-7xl" />
                </div>
                <div style={{ overflow: 'hidden' }}>
                  <AnimatedWord word="Theater" delay={0.48}
                    className="block font-bold italic text-5xl sm:text-6xl md:text-7xl text-red-700" />
                </div>
              </h1>

              <motion.p
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, delay: 0.95 }}
                className="mb-8 max-w-lg text-base leading-relaxed text-stone-500 sm:text-lg md:mb-10"
                style={{ fontFamily: 'system-ui, sans-serif' }}
              >
                Bringing stories to life in Media, PA. Join us for a season of creativity, community, and unforgettable performances.
              </motion.p>

              <motion.div
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.7, delay: 1.1 }}
                className="flex flex-wrap gap-3"
              >
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
              </motion.div>
            </motion.div>

            {/* Right: poster card — unchanged */}
            <div className="relative h-[580px] hidden lg:block">
              {featuredShow && (
                <motion.div
                  style={{ y: cardY, rotate: cardRotate }}
                  initial={{ y: 100, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ duration: 0.9, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  whileHover={{ rotate: 0, scale: 1.03, transition: { duration: 0.35 } }}
                  className="absolute top-10 right-20 w-72 bg-white p-3.5 rounded-2xl shadow-2xl z-20 cursor-pointer"
                >
                  <div className="aspect-[2/3] bg-stone-200 rounded-xl overflow-hidden mb-3 relative">
                    <img src={featuredShow.posterUrl} alt={featuredShow.title} className="object-cover w-full h-full" />
                    <div className="absolute top-3 right-3 bg-amber-400 text-stone-900 font-semibold px-3 py-1 rounded-full text-xs uppercase tracking-wide shadow">
                      Upcoming
                    </div>
                  </div>
                  <h3 className="font-bold text-lg mb-0.5 text-stone-900" style={{ fontFamily: 'Georgia, serif' }}>{featuredShow.title}</h3>
                  <p className="text-stone-400 text-sm" style={{ fontFamily: 'system-ui, sans-serif' }}>{featuredShow.type} · {featuredShow.year}</p>
                </motion.div>
              )}

              <motion.div
                initial={{ rotate: 5, x: 50, opacity: 0 }}
                animate={{ rotate: 5, x: 0, opacity: 1 }}
                transition={{ duration: 0.8, delay: 0.5 }}
                className="absolute top-32 right-0 w-64 bg-red-700/20 p-4 rounded-2xl z-10"
              >
                <div className="aspect-[2/3] bg-red-700/20 rounded-xl" />
              </motion.div>

            </div>

          </div>
        </div>
      </section>

      {/* ── ON STAGE ── */}
      <section className="bg-white py-16 sm:py-24">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-12 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <motion.p
                initial={{ opacity: 0, x: -14 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5 }}
                className="text-xs font-semibold uppercase tracking-widest text-red-600 mb-1.5"
                style={{ fontFamily: 'system-ui, sans-serif' }}
              >
                This Season
              </motion.p>
              <motion.h2
                initial={{ opacity: 0, x: -14 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: 0.07 }}
                className="font-bold text-stone-900"
                style={{ fontFamily: 'Georgia, serif', fontSize: 'clamp(1.8rem, 4vw, 2.8rem)' }}
              >
                On Stage
              </motion.h2>
            </div>
            <motion.div
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.15 }}
            >
              <Link to="/shows" className="hidden md:flex items-center gap-2 font-semibold text-stone-400 hover:text-red-700 transition-colors text-sm group" style={{ fontFamily: 'system-ui, sans-serif' }}>
                View Our Season
                <motion.span animate={{ x: [0, 4, 0] }} transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}>
                  <ArrowRight className="w-4 h-4" />
                </motion.span>
              </Link>
            </motion.div>
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
        <div className="absolute inset-0 opacity-[0.03] bg-[url('https://www.transparenttextures.com/patterns/stardust.png')]" />
        <motion.div
          animate={{ x: [0, 28, 0], y: [0, -18, 0] }}
          transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute top-0 left-1/3 w-96 h-96 bg-red-900/40 rounded-full blur-3xl pointer-events-none"
        />
        <motion.div
          animate={{ x: [0, -22, 0], y: [0, 22, 0] }}
          transition={{ duration: 11, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
          className="absolute bottom-0 right-1/3 w-80 h-80 bg-amber-900/30 rounded-full blur-3xl pointer-events-none"
        />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center">
          <motion.div
            initial={{ scale: 0, rotate: -180 }}
            whileInView={{ scale: 1, rotate: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          >
            <Star className="w-10 h-10 text-amber-400 mx-auto mb-6 fill-amber-400/30" />
          </motion.div>

          <motion.h2
            initial={{ opacity: 0, y: 26 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.65, delay: 0.1 }}
            className="mb-5 font-bold tracking-tight sm:mb-6"
            style={{ fontFamily: 'Georgia, serif', fontSize: 'clamp(1.8rem, 5vw, 3.2rem)' }}
          >
            More Than Just a Stage
          </motion.h2>

          <motion.p
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="mx-auto mb-10 max-w-xl text-base leading-relaxed text-stone-400 sm:mb-12 sm:text-lg"
            style={{ fontFamily: 'system-ui, sans-serif' }}
          >
            We are a community of actors, designers, technicians, and dreamers.
            Every ticket you buy supports arts education at Penncrest High School.
          </motion.p>

          <div className="mx-auto grid max-w-3xl grid-cols-1 gap-4 justify-items-center sm:grid-cols-3 sm:gap-5">
            {[
              { label: 'Productions', value: '100+' },
              { label: 'Students',    value: '50+'  },
              { label: 'Years',       value: '25+'  },
            ].map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 28, scale: 0.92 }}
                whileInView={{ opacity: 1, y: 0, scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.55, delay: 0.3 + i * 0.11, ease: [0.22, 1, 0.36, 1] }}
                whileHover={{ scale: 1.04, transition: { duration: 0.2 } }}
                className="p-6 border border-stone-700/50 rounded-2xl bg-stone-800/40 text-center w-full cursor-default"
              >
                <motion.div
                  initial={{ opacity: 0, scale: 0.5 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: 0.5 + i * 0.11, type: 'spring', bounce: 0.45 }}
                  className="text-4xl font-black text-amber-400 mb-1"
                  style={{ fontFamily: 'Georgia, serif' }}
                >
                  {stat.value}
                </motion.div>
                <div className="text-stone-400 text-xs uppercase tracking-widest font-semibold" style={{ fontFamily: 'system-ui, sans-serif' }}>{stat.label}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

    </div>
  );
}
