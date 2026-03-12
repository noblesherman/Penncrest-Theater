import { motion, useScroll, useTransform } from 'motion/react';
import { Music, Mic2, Users, Star, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useRef } from 'react';

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
          {char === ' ' ? '\u00A0' : char}
        </motion.span>
      ))}
    </span>
  );
}

const pillars = [
  { title: 'Voice',  icon: <Mic2  className="w-7 h-7" />, desc: 'Vocal training and ensemble singing to find and strengthen your sound.' },
  { title: 'Acting', icon: <Users className="w-7 h-7" />, desc: 'Character development and scene work that brings the story to life.' },
  { title: 'Dance',  icon: <Music className="w-7 h-7" />, desc: 'Choreography for all skill levels — no experience required.' },
];

export default function MusicalTheater() {
  const heroRef = useRef(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ['start start', 'end start'] });
  const textY = useTransform(scrollYProgress, [0, 1], [0, 50]);

  return (
    <div className="bg-stone-50 min-h-screen text-stone-900">

      {/* ── HERO ── */}
      <section ref={heroRef} className="relative overflow-hidden bg-white border-b border-stone-100 py-16 sm:py-20">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-red-700 via-red-600 to-amber-400" />

        <motion.div style={{ y: textY }} className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-xs font-semibold uppercase tracking-widest text-red-600 mb-5"
          >
            Center Stage
          </motion.p>

          <h1 className="font-black uppercase tracking-tight leading-[1.0] mb-5">
            <div style={{ overflow: 'hidden' }}>
              <AnimatedWord word="Musical" delay={0.1} className="block text-5xl sm:text-6xl md:text-7xl" />
            </div>
            <div style={{ overflow: 'hidden' }}>
              <AnimatedWord word="Theater" delay={0.4} className="block text-5xl sm:text-6xl md:text-7xl text-red-700" />
            </div>
          </h1>

          <motion.p
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.85 }}
            className="mx-auto max-w-xl text-base leading-relaxed text-stone-400 sm:text-lg"
          >
            Sing. Dance. Act. Tell stories that move audiences and create memories that last a lifetime.
          </motion.p>
        </motion.div>
      </section>

      {/* ── ABOUT ── */}
      <section className="py-14 sm:py-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 36 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1] }}
            className="relative rounded-3xl border border-stone-100 bg-white p-8 sm:p-12 md:p-16 shadow-lg overflow-hidden text-center"
          >
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-red-700 via-red-600 to-amber-400 rounded-t-3xl" />

            <motion.h2
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.55, delay: 0.1 }}
              className="mb-5 text-3xl font-black uppercase text-stone-900 sm:text-4xl"
            >
              More Than Just a Club
            </motion.h2>
            <motion.p
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.55, delay: 0.18 }}
              className="mb-12 text-base leading-relaxed text-stone-500 sm:text-lg max-w-2xl mx-auto"
            >
              The Musical Theater program is the heart of our performing arts department. We produce two major productions a year: a fall play and a spring musical. Whether you're a seasoned performer or stepping onto the stage for the first time, there is a role for you.
            </motion.p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {pillars.map((p, i) => (
                <motion.div
                  key={p.title}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.55, delay: 0.1 + i * 0.1, ease: [0.22, 1, 0.36, 1] }}
                  whileHover={{ y: -6, transition: { duration: 0.25 } }}
                  className="flex flex-col items-center"
                >
                  <motion.div
                    whileHover={{ scale: 1.15, rotate: 6 }}
                    transition={{ type: 'spring', stiffness: 280, damping: 15 }}
                    className="w-14 h-14 bg-red-50 text-red-700 border border-red-100 rounded-2xl flex items-center justify-center mb-4"
                  >
                    {p.icon}
                  </motion.div>
                  <h3 className="font-bold text-xl mb-2">{p.title}</h3>
                  <p className="text-sm text-stone-400 leading-relaxed">{p.desc}</p>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── SPOTLIGHT ── */}
      <section className="overflow-hidden bg-stone-900 py-14 text-white sm:py-20 relative">
        <motion.div
          animate={{ x: [0, 28, 0], y: [0, -18, 0] }}
          transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute top-0 left-1/3 w-96 h-96 bg-red-900/30 rounded-full blur-3xl pointer-events-none"
        />
        <motion.div
          animate={{ x: [0, -22, 0], y: [0, 22, 0] }}
          transition={{ duration: 11, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
          className="absolute bottom-0 right-1/3 w-80 h-80 bg-amber-900/20 rounded-full blur-3xl pointer-events-none"
        />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="flex flex-col md:flex-row items-center gap-12 lg:gap-20">
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1] }}
              className="flex-1 space-y-6"
            >
              <div className="flex items-center gap-2 text-amber-400 font-semibold uppercase tracking-widest text-xs">
                <Star className="w-3.5 h-3.5 fill-amber-400" /> Student Spotlight
              </div>
              <h2 className="text-3xl font-black uppercase leading-tight sm:text-4xl">
                "It changed my high school experience."
              </h2>
              <p className="text-base leading-relaxed text-stone-400 sm:text-lg">
                "I was terrified to audition my freshman year. Four years later, I've found my best friends and my voice. The theater department is a family where everyone is accepted for who they are."
              </p>
              <div className="font-semibold text-stone-300 text-sm">— Sarah M., Class of '24</div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 30, rotate: 3 }}
              whileInView={{ opacity: 1, x: 0, rotate: 3 }}
              viewport={{ once: true }}
              transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
              whileHover={{ rotate: 0, scale: 1.02, transition: { duration: 0.35 } }}
              className="flex-1 relative max-w-sm w-full"
            >
              <div className="aspect-[3/4] bg-stone-800 rounded-2xl overflow-hidden border border-stone-700 shadow-2xl">
                <img src="https://picsum.photos/seed/performer/600/800" alt="Performer on stage" className="w-full h-full object-cover" />
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="border-t border-stone-100 bg-white py-16 sm:py-20">
        <div className="max-w-3xl mx-auto text-center px-4">
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="text-xs font-semibold uppercase tracking-widest text-red-600 mb-3"
          >
            Auditions
          </motion.p>
          <motion.h2
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.55, delay: 0.08 }}
            className="mb-4 text-3xl font-black uppercase text-stone-900 sm:text-4xl"
          >
            Take the Stage
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.55, delay: 0.15 }}
            className="mb-8 text-base text-stone-500 sm:text-lg"
          >
            Auditions for the Spring Musical are coming up soon. Don't miss your chance to shine.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.55, delay: 0.22 }}
          >
            <Link
              to="/about"
              className="group inline-flex items-center gap-2 bg-red-700 text-white px-8 py-3.5 rounded-full font-semibold hover:bg-red-800 transition-colors shadow-md shadow-red-200"
            >
              Audition Info
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
          </motion.div>
        </div>
      </section>

    </div>
  );
}