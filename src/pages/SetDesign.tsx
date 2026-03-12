import { motion, useScroll, useTransform } from 'motion/react';
import { Hammer, Paintbrush, Ruler, Box, ArrowRight } from 'lucide-react';
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

const steps = [
  { title: 'Design', icon: <Ruler      className="w-8 h-8" />, desc: 'Visualize the environment. Create blueprints and scale models that define the world of the show.' },
  { title: 'Build',  icon: <Hammer     className="w-8 h-8" />, desc: 'Carpentry and construction. Learn to use power tools safely to build full-scale structures.' },
  { title: 'Paint',  icon: <Paintbrush className="w-8 h-8" />, desc: 'Scenic painting techniques — textures, faux finishes, and artistic details that bring sets to life.' },
];

export default function SetDesign() {
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
            Stagecraft
          </motion.p>

          <h1 className="font-black uppercase tracking-tight leading-[1.0] mb-5">
            <div style={{ overflow: 'hidden' }}>
              <AnimatedWord word="Set" delay={0.1} className="block text-5xl sm:text-6xl md:text-7xl" />
            </div>
            <div style={{ overflow: 'hidden' }}>
              <AnimatedWord word="Design" delay={0.25} className="block text-5xl sm:text-6xl md:text-7xl text-red-700" />
            </div>
          </h1>

          <motion.p
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.75 }}
            className="mx-auto max-w-xl text-base leading-relaxed text-stone-400 sm:text-lg"
          >
            We build worlds. From concept sketches to final construction, the Set Design club transforms the stage into new realities.
          </motion.p>
        </motion.div>
      </section>

      {/* ── PROCESS ── */}
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
              How We Work
            </motion.p>
            <motion.h2
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.07 }}
              className="text-3xl font-black uppercase"
            >
              The Process
            </motion.h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {steps.map((step, i) => (
              <motion.div
                key={step.title}
                initial={{ opacity: 0, y: 36 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-50px' }}
                transition={{ duration: 0.65, delay: i * 0.1, ease: [0.22, 1, 0.36, 1] }}
                whileHover={{ y: -8, transition: { duration: 0.25 } }}
                className="bg-white p-8 rounded-2xl shadow-sm border border-stone-100 hover:shadow-lg transition-shadow text-center"
              >
                <motion.div
                  whileHover={{ scale: 1.15, rotate: 6 }}
                  transition={{ type: 'spring', stiffness: 280, damping: 15 }}
                  className="w-16 h-16 mx-auto bg-red-50 text-red-700 border border-red-100 rounded-2xl flex items-center justify-center mb-6"
                >
                  {step.icon}
                </motion.div>
                <h3 className="mb-3 text-xl font-black uppercase">{step.title}</h3>
                <p className="text-stone-400 leading-relaxed text-sm">{step.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── WORKSHOP ── */}
      <section className="bg-white py-14 sm:py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-14 items-center">

            {/* Images */}
            <motion.div
              initial={{ opacity: 0, x: -30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1] }}
              className="grid grid-cols-2 gap-4"
            >
              <motion.img
                whileHover={{ scale: 1.03 }}
                transition={{ duration: 0.35 }}
                src="https://picsum.photos/seed/set1/400/500"
                className="rounded-2xl shadow-md mt-8 w-full object-cover"
                alt="Set construction"
              />
              <motion.img
                whileHover={{ scale: 1.03 }}
                transition={{ duration: 0.35 }}
                src="https://picsum.photos/seed/set2/400/500"
                className="rounded-2xl shadow-md w-full object-cover"
                alt="Painting scenery"
              />
            </motion.div>

            {/* Text */}
            <motion.div
              initial={{ opacity: 0, x: 30 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1], delay: 0.1 }}
              className="space-y-6"
            >
              <p className="text-xs font-semibold uppercase tracking-widest text-red-600">The Workshop</p>
              <h2 className="text-3xl font-black uppercase text-stone-900 sm:text-4xl leading-tight">Build Something Real</h2>
              <p className="text-base leading-relaxed text-stone-500 sm:text-lg">
                Our scene shop is a hive of activity. Students learn practical skills that go beyond the theater: project management, structural engineering, and collaborative problem-solving.
              </p>

              <motion.div
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: 0.25 }}
                className="bg-stone-50 p-5 rounded-2xl border border-stone-100 flex items-start gap-4"
              >
                <div className="w-10 h-10 bg-amber-50 text-amber-600 border border-amber-100 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Box className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-bold text-base mb-1">Props Department</h4>
                  <p className="text-stone-400 text-sm leading-relaxed">
                    Also part of Set Design is our Props team — sourcing, building, or modifying every object actors touch on stage.
                  </p>
                </div>
              </motion.div>
            </motion.div>

          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="bg-stone-900 py-14 text-white sm:py-20 relative overflow-hidden">
        <motion.div
          animate={{ x: [0, 28, 0], y: [0, -18, 0] }}
          transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute top-0 left-1/3 w-96 h-96 bg-red-900/30 rounded-full blur-3xl pointer-events-none"
        />
        <div className="max-w-3xl mx-auto text-center px-4 relative z-10">
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-xs font-semibold uppercase tracking-widest text-amber-400 mb-3"
          >
            Get Involved
          </motion.p>
          <motion.h2
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.08 }}
            className="mb-4 text-3xl font-black uppercase sm:text-4xl"
          >
            Grab a Hammer
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.15 }}
            className="mb-8 text-base text-stone-400 sm:text-lg"
          >
            Set Design meets every Tuesday and Thursday. Come build something amazing.
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
              Get Involved
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
          </motion.div>
        </div>
      </section>

    </div>
  );
}