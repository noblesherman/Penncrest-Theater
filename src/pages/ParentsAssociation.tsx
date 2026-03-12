import { motion, useScroll, useTransform } from 'motion/react';
import { Users, Heart, Coffee, Gift, Calendar, ArrowRight, Mail } from 'lucide-react';
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

const initiatives = [
  { title: 'Fundraising',  icon: <Gift    className="w-7 h-7" />, desc: 'We organize events and sales to fund scholarships, equipment upgrades, and production costs.' },
  { title: 'Hospitality',  icon: <Coffee  className="w-7 h-7" />, desc: 'Tech week dinners, cast parties, and concession stands. We keep cast and crew fueled.' },
  { title: 'Volunteering', icon: <Users   className="w-7 h-7" />, desc: 'Ushers, ticket sales, costume help, and set construction. Many hands make light work.' },
];

const meetings = ['September 5th', 'October 3rd', 'November 7th', 'December 5th'];

export default function ParentsAssociation() {
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
            Supporting Our Stars
          </motion.p>

          <h1 className="font-black uppercase tracking-tight leading-[1.0] mb-5">
            <div style={{ overflow: 'hidden' }}>
              <AnimatedWord word="Parents" delay={0.1} className="block text-5xl sm:text-6xl md:text-7xl" />
            </div>
            <div style={{ overflow: 'hidden' }}>
              <AnimatedWord word="Association" delay={0.35} className="block text-4xl sm:text-5xl md:text-6xl text-red-700" />
            </div>
          </h1>

          <motion.p
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.9 }}
            className="mx-auto max-w-xl text-base leading-relaxed text-stone-400 sm:text-lg"
          >
            We are the team behind the team. From fundraising to feeding the cast, we ensure the show goes on.
          </motion.p>
        </motion.div>
      </section>

      {/* ── MISSION ── */}
      <section className="py-14 sm:py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="text-xs font-semibold uppercase tracking-widest text-red-600 mb-3"
          >
            Our Purpose
          </motion.p>
          <motion.h2
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.55, delay: 0.08 }}
            className="mb-6 text-3xl font-black uppercase"
          >
            Our Mission
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.55, delay: 0.15 }}
            className="text-base leading-relaxed text-stone-500 sm:text-lg"
          >
            The Penncrest Theater Parents Association (PTPA) is dedicated to supporting the students and staff of the theater department. We provide volunteer support, financial assistance, and community engagement to ensure every production is a success.
          </motion.p>
        </div>
      </section>

      {/* ── WHAT WE DO ── */}
      <section className="bg-white py-14 sm:py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="text-xs font-semibold uppercase tracking-widest text-red-600 mb-2"
            >
              How We Help
            </motion.p>
            <motion.h2
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.07 }}
              className="text-3xl font-black uppercase"
            >
              What We Do
            </motion.h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {initiatives.map((item, i) => (
              <motion.div
                key={item.title}
                initial={{ opacity: 0, y: 36 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-50px' }}
                transition={{ duration: 0.65, delay: i * 0.1, ease: [0.22, 1, 0.36, 1] }}
                whileHover={{ y: -7, transition: { duration: 0.25 } }}
                className="bg-stone-50 p-8 rounded-2xl border border-stone-100 text-center hover:shadow-md transition-shadow"
              >
                <motion.div
                  whileHover={{ scale: 1.15, rotate: 6 }}
                  transition={{ type: 'spring', stiffness: 280, damping: 15 }}
                  className="w-14 h-14 mx-auto bg-red-50 text-red-700 border border-red-100 rounded-2xl flex items-center justify-center mb-5"
                >
                  {item.icon}
                </motion.div>
                <h3 className="mb-3 text-lg font-black uppercase">{item.title}</h3>
                <p className="text-stone-400 leading-relaxed text-sm">{item.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── MEETINGS ── */}
      <section className="bg-stone-100 py-14 sm:py-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 36 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1] }}
            className="bg-white rounded-3xl p-8 md:p-12 shadow-sm border border-stone-100 relative overflow-hidden"
          >
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-red-700 via-red-600 to-amber-400 rounded-t-3xl" />

            <div className="flex flex-col md:flex-row items-start gap-12">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-10 h-10 bg-red-50 text-red-700 border border-red-100 rounded-xl flex items-center justify-center">
                    <Calendar className="w-5 h-5" />
                  </div>
                  <h2 className="text-2xl font-black uppercase">Monthly Meetings</h2>
                </div>
                <p className="mb-6 text-base text-stone-500 leading-relaxed">
                  We meet on the first Tuesday of every month at 7:00 PM in the High School Library. All parents are welcome and encouraged to attend!
                </p>
                <ul className="space-y-3">
                  {meetings.map((date, i) => (
                    <motion.li
                      key={date}
                      initial={{ opacity: 0, x: -16 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.5, delay: 0.1 + i * 0.07 }}
                      className="flex items-center gap-3 text-stone-600 font-medium"
                    >
                      <div className="w-2 h-2 bg-red-600 rounded-full flex-shrink-0" />
                      {date}
                    </motion.li>
                  ))}
                </ul>
              </div>

              <motion.div
                initial={{ opacity: 0, scale: 0.85 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.7, type: 'spring', bounce: 0.3 }}
                className="flex-shrink-0 w-40 h-40 md:w-48 md:h-48 bg-red-50 rounded-full flex items-center justify-center border border-red-100 mx-auto md:mx-0"
              >
                <motion.div
                  animate={{ scale: [1, 1.08, 1] }}
                  transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
                >
                  <Heart className="w-16 h-16 text-red-600 fill-red-100" />
                </motion.div>
              </motion.div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="bg-stone-900 py-14 text-white sm:py-20 relative overflow-hidden">
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
            Join the Family
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.15 }}
            className="mb-8 text-base text-stone-400 sm:text-lg"
          >
            Your involvement makes a difference. Sign up for our newsletter to stay in the loop.
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.22 }}
            className="flex flex-col sm:flex-row justify-center gap-3"
          >
            <a
              href="mailto:parents@penncresttheater.org"
              className="group inline-flex items-center justify-center gap-2 bg-red-700 text-white px-8 py-3.5 rounded-full font-semibold hover:bg-red-800 transition-colors shadow-md shadow-red-900/30"
            >
              <Mail className="w-4 h-4" /> Email Us
            </a>
            <Link
              to="/about"
              className="group inline-flex items-center justify-center gap-2 bg-white/10 text-white border border-white/20 px-8 py-3.5 rounded-full font-semibold hover:bg-white/20 transition-colors"
            >
              Back to About <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
          </motion.div>
        </div>
      </section>

    </div>
  );
}