import { motion, useScroll, useTransform } from 'motion/react';
import { Mic, Zap, Settings, Headphones, ArrowRight } from 'lucide-react';
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

const roles = [
  { title: 'Lighting',         icon: <Zap        className="w-7 h-7" />, desc: 'Design and operate the lighting rig to set the mood and atmosphere for every scene.' },
  { title: 'Sound',            icon: <Headphones className="w-7 h-7" />, desc: 'Manage microphones, sound effects, and the overall audio mix for the audience.' },
  { title: 'Stage Management', icon: <Settings   className="w-7 h-7" />, desc: 'Call the cues and run the show. The captain of the ship during every performance.' },
  { title: 'Run Crew',         icon: <Mic        className="w-7 h-7" />, desc: 'Handle scene changes, props, and backstage logistics in real-time.' },
];

const equipment = ['ETC Lighting Console', 'Digital Audio Workstations', 'Wireless Mic Systems'];

export default function TechCrew() {
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
            Behind the Scenes
          </motion.p>

          <h1 className="font-black uppercase tracking-tight leading-[1.0] mb-5">
            <div style={{ overflow: 'hidden' }}>
              <AnimatedWord word="Tech" delay={0.1} className="block text-5xl sm:text-6xl md:text-7xl" />
            </div>
            <div style={{ overflow: 'hidden' }}>
              <AnimatedWord word="Crew" delay={0.28} className="block text-5xl sm:text-6xl md:text-7xl text-red-700" />
            </div>
          </h1>

          <motion.p
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.7 }}
            className="mx-auto max-w-xl text-base leading-relaxed text-stone-400 sm:text-lg"
          >
            The magic doesn't just happen on stage. It happens in the booth, on the catwalks, and in the wings.
          </motion.p>
        </motion.div>
      </section>

      {/* ── ROLES ── */}
      <section className="py-14 sm:py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5 }}
              className="text-xs font-semibold uppercase tracking-widest text-red-600 mb-2"
            >
              Find Your Role
            </motion.p>
            <motion.h2
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.07 }}
              className="text-3xl font-black uppercase"
            >
              What We Do
            </motion.h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {roles.map((role, i) => (
              <motion.div
                key={role.title}
                initial={{ opacity: 0, y: 36 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-50px' }}
                transition={{ duration: 0.65, delay: i * 0.09, ease: [0.22, 1, 0.36, 1] }}
                whileHover={{ y: -7, transition: { duration: 0.25 } }}
                className="bg-white p-7 rounded-2xl border border-stone-100 shadow-sm hover:shadow-md transition-shadow"
              >
                <motion.div
                  whileHover={{ scale: 1.15, rotate: 6 }}
                  transition={{ type: 'spring', stiffness: 280, damping: 15 }}
                  className="w-13 h-13 w-12 h-12 bg-red-50 text-red-700 border border-red-100 rounded-xl flex items-center justify-center mb-5"
                >
                  {role.icon}
                </motion.div>
                <h3 className="mb-2 text-base font-bold">{role.title}</h3>
                <p className="text-stone-400 leading-relaxed text-sm">{role.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── EQUIPMENT ── */}
      <section className="bg-white py-14 sm:py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-14 items-center">

            <motion.div
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1] }}
              className="space-y-6"
            >
              <p className="text-xs font-semibold uppercase tracking-widest text-red-600">Professional Equipment</p>
              <h2 className="text-3xl font-black uppercase text-stone-900 sm:text-4xl leading-tight">Master the Machine</h2>
              <p className="text-base leading-relaxed text-stone-500 sm:text-lg">
                Our theater is equipped with professional-grade technology. As a member of Tech Crew, you'll get hands-on training with industry-standard equipment. No prior experience is necessary — just a willingness to learn.
              </p>
              <ul className="space-y-3">
                {equipment.map((item, i) => (
                  <motion.li
                    key={item}
                    initial={{ opacity: 0, x: -16 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.5, delay: 0.15 + i * 0.08 }}
                    className="flex items-center gap-3 text-stone-600 font-medium"
                  >
                    <div className="w-2 h-2 bg-red-600 rounded-full flex-shrink-0" />
                    {item}
                  </motion.li>
                ))}
              </ul>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
              whileHover={{ scale: 1.02, transition: { duration: 0.35 } }}
            >
              <div className="aspect-video bg-stone-100 rounded-2xl overflow-hidden border border-stone-100 shadow-lg">
                <img
                  src="https://picsum.photos/seed/techbooth/800/600"
                  alt="Tech Booth"
                  className="w-full h-full object-cover hover:scale-105 transition-transform duration-500"
                />
              </div>
            </motion.div>

          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="bg-stone-900 py-14 text-white sm:py-20 relative overflow-hidden">
        <motion.div
          animate={{ x: [0, 28, 0], y: [0, -18, 0] }}
          transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute top-0 right-1/3 w-96 h-96 bg-red-900/30 rounded-full blur-3xl pointer-events-none"
        />
        <motion.div
          animate={{ x: [0, -22, 0], y: [0, 22, 0] }}
          transition={{ duration: 11, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
          className="absolute bottom-0 left-1/3 w-80 h-80 bg-amber-900/20 rounded-full blur-3xl pointer-events-none"
        />
        <div className="max-w-3xl mx-auto text-center px-4 relative z-10">
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-xs font-semibold uppercase tracking-widest text-amber-400 mb-3"
          >
            Join Us
          </motion.p>
          <motion.h2
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.08 }}
            className="mb-4 text-3xl font-black uppercase sm:text-4xl"
          >
            Join the Crew
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.15 }}
            className="mb-8 text-base text-stone-400 sm:text-lg"
          >
            Ready to run the show? We're always looking for new technicians.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.22 }}
          >
            <Link
              to="/about"
              className="group inline-flex items-center gap-2 bg-red-700 text-white px-8 py-3.5 rounded-full font-semibold hover:bg-red-800 transition-colors shadow-md shadow-red-900/30"
            >
              Contact Us
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
          </motion.div>
        </div>
      </section>

    </div>
  );
}