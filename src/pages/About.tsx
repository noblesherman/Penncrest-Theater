import { motion } from 'motion/react';
import { Heart, Users, Award, Sparkles, Mail, ArrowRight, Quote } from 'lucide-react';
import TheaterCalendar from '../components/TheaterCalendar';
import ShowHistorySlideshow from '../components/ShowHistorySlideshow';
import { Link } from 'react-router-dom';

const departments = [
  { title: 'Musical Theater', icon: <Heart    className="w-5 h-5" />, desc: 'Sing, dance, and act in our fall play and spring musical. All skill levels welcome.', link: '/musical-theater' },
  { title: 'Tech Crew',       icon: <Sparkles className="w-5 h-5" />, desc: 'Run lights, sound, and stage management. The magic behind every performance.',      link: '/tech-crew'       },
  { title: 'Set Design',      icon: <Award    className="w-5 h-5" />, desc: 'Build and paint the worlds our actors inhabit. Carpentry, props, and scenic art.',   link: '/set-design'      },
  { title: 'Parents Assoc.',  icon: <Users    className="w-5 h-5" />, desc: 'Support the program through volunteering, fundraising, and community.',               link: '/parents-association' },
];

const staff = [
  { name: 'Jennifer Smith', role: 'Director',           image: 'https://picsum.photos/seed/director/400/400' },
  { name: 'Scott Smith',    role: 'Technical Director', image: 'https://picsum.photos/seed/music/400/400'    },
  { name: 'Ms. Oneil',      role: 'Incredible Person',  image: 'https://picsum.photos/seed/dance/400/400'    },
];

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-60px' },
  transition: { duration: 0.65, delay, ease: [0.22, 1, 0.36, 1] },
});

export default function About() {
  return (
    <div className="bg-white text-stone-900 overflow-hidden">

      {/* ── PAGE TITLE: simple, confident, not a "hero" ── */}
      <section className="border-b border-stone-100 bg-white relative">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-red-700 via-red-600 to-amber-400" />
        <div className="max-w-7xl mx-auto px-6 sm:px-10 pt-14 pb-10 sm:pt-16 sm:pb-12">
          <motion.p {...fadeUp(0)} className="text-xs font-semibold uppercase tracking-[0.2em] text-red-600 mb-3" style={{ fontFamily: 'system-ui, sans-serif' }}>
            Penncrest High School · Media, PA
          </motion.p>
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
            <motion.h1
              {...fadeUp(0.07)}
              className="font-bold leading-none"
              style={{ fontFamily: 'Georgia, serif', fontSize: 'clamp(2.8rem, 7vw, 5.5rem)' }}
            >
              About the<br />
              <em className="text-red-700 not-italic">Theater Program</em>
            </motion.h1>
            <motion.p {...fadeUp(0.15)} className="text-stone-400 max-w-md leading-relaxed text-base lg:text-right" style={{ fontFamily: 'system-ui, sans-serif' }}>
              Do you love to sing? Dance? Act? Paint? Draw? Work with technology? There's a place for you here.
            </motion.p>
          </div>
        </div>
      </section>

      {/* ── WELCOME: editorial two-column ── */}
      <section className="bg-stone-50 py-16 sm:py-20">
        <div className="max-w-7xl mx-auto px-6 sm:px-10">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.6fr] gap-12 lg:gap-20 items-start">

            {/* Left: big pull quote */}
            <motion.div {...fadeUp(0)}>
              <Quote className="w-8 h-8 text-red-700 mb-5 opacity-70" />
              <p
                className="font-bold text-stone-900 leading-snug mb-6"
                style={{ fontFamily: 'Georgia, serif', fontSize: 'clamp(1.4rem, 3vw, 2rem)' }}
              >
                "Whatever it is you're interested in —{' '}
                <em className="text-red-700">welcome.</em>{' '}
                We can't wait for another amazing year on and off the stage."
              </p>
              <div className="w-8 h-px bg-red-600 mb-3" />
              <p className="text-stone-400 text-sm uppercase tracking-widest" style={{ fontFamily: 'system-ui, sans-serif' }}>
                Jennifer Smith, Director
              </p>
            </motion.div>

            {/* Right: body copy */}
            <motion.div {...fadeUp(0.1)} className="space-y-5 text-stone-600 leading-relaxed" style={{ fontFamily: 'system-ui, sans-serif', fontSize: '1.05rem' }}>
              <p>
                Maybe you are interested in trying out for the school musical. Maybe you just want a taste of Musical Theater and want to attend Musical Theater Club.
              </p>
              <p>
                Maybe you enjoy art and want to be involved with creating props or set pieces through our set design club. Maybe you want to learn more about lights or sound equipment — you can do that through our Tech Crew.
              </p>
              <p>
                Our theater department is more than a club — it's a community where students find lifelong friendships, discover hidden talents, and create performances that our school remembers for years.
              </p>
            </motion.div>

          </div>
        </div>
      </section>

      {/* ── GET INVOLVED ── */}
      <section className="bg-white py-16 sm:py-20 border-t border-stone-100">
        <div className="max-w-7xl mx-auto px-6 sm:px-10">

          <div className="mb-10">
            <motion.p {...fadeUp(0)} className="text-xs font-semibold uppercase tracking-[0.2em] text-red-600 mb-2" style={{ fontFamily: 'system-ui, sans-serif' }}>
              Find Your Place
            </motion.p>
            <motion.h2 {...fadeUp(0.07)} className="font-bold" style={{ fontFamily: 'Georgia, serif', fontSize: 'clamp(1.8rem, 4vw, 2.8rem)' }}>
              Get Involved
            </motion.h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {departments.map((item, i) => (
              <motion.div key={item.title} {...fadeUp(i * 0.08)}>
                <Link to={item.link} className="group block h-full">
                  <motion.div
                    whileHover={{ y: -5 }}
                    transition={{ duration: 0.22 }}
                    className="h-full flex flex-col p-6 rounded-2xl border border-stone-100 bg-stone-50 hover:bg-white hover:border-red-100 hover:shadow-lg transition-all duration-300"
                  >
                    <motion.div
                      whileHover={{ rotate: 8, scale: 1.1 }}
                      transition={{ type: 'spring', stiffness: 300, damping: 15 }}
                      className="w-10 h-10 rounded-xl bg-red-50 text-red-700 border border-red-100 flex items-center justify-center mb-4"
                    >
                      {item.icon}
                    </motion.div>
                    <h3 className="font-bold text-stone-900 mb-2 group-hover:text-red-700 transition-colors" style={{ fontFamily: 'Georgia, serif', fontSize: '1.1rem' }}>
                      {item.title}
                    </h3>
                    <p className="text-stone-400 text-sm leading-relaxed flex-1" style={{ fontFamily: 'system-ui, sans-serif' }}>
                      {item.desc}
                    </p>
                    <span className="inline-flex items-center gap-1.5 text-red-600 text-xs font-bold uppercase tracking-widest mt-5 group-hover:gap-2.5 transition-all" style={{ fontFamily: 'system-ui, sans-serif' }}>
                      Learn more <ArrowRight className="w-3 h-3" />
                    </span>
                  </motion.div>
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── STAFF ── */}
      <section className="bg-stone-50 py-16 sm:py-20 border-t border-stone-100">
        <div className="max-w-7xl mx-auto px-6 sm:px-10">

          <div className="mb-10">
            <motion.p {...fadeUp(0)} className="text-xs font-semibold uppercase tracking-[0.2em] text-red-600 mb-2" style={{ fontFamily: 'system-ui, sans-serif' }}>
              The Team
            </motion.p>
            <motion.h2 {...fadeUp(0.07)} className="font-bold" style={{ fontFamily: 'Georgia, serif', fontSize: 'clamp(1.8rem, 4vw, 2.8rem)' }}>
              Meet the Staff
            </motion.h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {staff.map((person, i) => (
              <motion.div key={person.name} {...fadeUp(i * 0.1)} className="group">
                <div className="aspect-[4/3] rounded-2xl overflow-hidden mb-4 relative bg-stone-200">
                  <motion.img
                    whileHover={{ scale: 1.05 }}
                    transition={{ duration: 0.45 }}
                    src={person.image}
                    alt={person.name}
                    className="w-full h-full object-cover"
                  />
                  {/* Red line slides in from left on hover */}
                  <motion.div
                    className="absolute bottom-0 left-0 h-1 bg-red-700"
                    initial={{ width: '0%' }}
                    whileHover={{ width: '100%' }}
                    transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                  />
                </div>
                <h3 className="font-bold text-stone-900 text-lg" style={{ fontFamily: 'Georgia, serif' }}>{person.name}</h3>
                <p className="text-red-600 text-xs uppercase tracking-[0.15em] font-semibold mt-0.5" style={{ fontFamily: 'system-ui, sans-serif' }}>{person.role}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CALENDAR ── */}
      <section className="bg-white py-14 sm:py-20 border-t border-stone-100">
        <div className="max-w-6xl mx-auto px-6 sm:px-10">
          <div className="mb-10">
            <motion.p {...fadeUp(0)} className="text-xs font-semibold uppercase tracking-[0.2em] text-red-600 mb-2" style={{ fontFamily: 'system-ui, sans-serif' }}>
              Stay in the Loop
            </motion.p>
            <motion.h2 {...fadeUp(0.07)} className="font-bold" style={{ fontFamily: 'Georgia, serif', fontSize: 'clamp(1.8rem, 4vw, 2.8rem)' }}>
              Upcoming Events
            </motion.h2>
          </div>
          <motion.div {...fadeUp(0.1)}>
            <TheaterCalendar />
          </motion.div>
        </div>
      </section>

      {/* ── HISTORY ── */}
      <section className="bg-stone-900 text-white py-16 sm:py-24 overflow-hidden relative border-t border-stone-800">
        <motion.div
          animate={{ x: [0, 30, 0], y: [0, -20, 0] }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute top-0 right-0 w-[500px] h-[500px] bg-red-900/20 rounded-full blur-3xl pointer-events-none"
        />
        <motion.div
          animate={{ x: [0, -20, 0], y: [0, 20, 0] }}
          transition={{ duration: 13, repeat: Infinity, ease: 'easeInOut', delay: 3 }}
          className="absolute bottom-0 left-0 w-96 h-96 bg-amber-900/10 rounded-full blur-3xl pointer-events-none"
        />

        <div className="max-w-7xl mx-auto px-6 sm:px-10 relative z-10">
          <div className="mb-12">
            <div className="w-8 h-px bg-amber-400 mb-4" />
            <motion.p {...fadeUp(0)} className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-400 mb-2" style={{ fontFamily: 'system-ui, sans-serif' }}>
              25+ Years
            </motion.p>
            <motion.h2 {...fadeUp(0.07)} className="font-bold" style={{ fontFamily: 'Georgia, serif', fontSize: 'clamp(1.8rem, 4vw, 2.8rem)' }}>
              A Legacy of Performance
            </motion.h2>
          </div>
          <motion.div {...fadeUp(0.1)}>
            <ShowHistorySlideshow />
          </motion.div>
        </div>
      </section>

      {/* ── CONTACT ── */}
      <section className="bg-white py-16 sm:py-20 border-t border-stone-100">
        <div className="max-w-7xl mx-auto px-6 sm:px-10">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">

            <motion.div {...fadeUp(0)}>
              <div className="w-8 h-px bg-red-600 mb-5" />
              <h2 className="font-bold leading-tight mb-4" style={{ fontFamily: 'Georgia, serif', fontSize: 'clamp(1.8rem, 4vw, 3rem)' }}>
                Have a question?<br />
                <em className="text-red-700 not-italic">Reach out anytime.</em>
              </h2>
              <p className="text-stone-400 leading-relaxed" style={{ fontFamily: 'system-ui, sans-serif' }}>
                Whether you're a prospective student, a parent, or just curious about the program — we'd love to hear from you.
              </p>
            </motion.div>

            <motion.div {...fadeUp(0.1)}>
              <motion.a
                href="mailto:jsmith3@rtmsd.org"
                whileHover={{ x: 4 }}
                whileTap={{ scale: 0.98 }}
                className="group flex items-center justify-between bg-red-700 text-white px-8 py-5 rounded-2xl font-semibold hover:bg-red-800 transition-colors shadow-lg shadow-red-100 mb-3"
                style={{ fontFamily: 'system-ui, sans-serif' }}
              >
                <span className="flex items-center gap-3">
                  <Mail className="w-5 h-5" />
                  jsmith3@rtmsd.org
                </span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </motion.a>
              <p className="text-stone-400 text-sm pl-1" style={{ fontFamily: 'system-ui, sans-serif' }}>
                Jennifer Smith · Director, Penncrest Theater
              </p>
            </motion.div>

          </div>
        </div>
      </section>

    </div>
  );
}