import { Link, useLocation } from 'react-router-dom';
import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Ticket, Menu, X } from 'lucide-react';

export default function Layout({ children }: { children: React.ReactNode }) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isAddressMapOpen, setIsAddressMapOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    if (!isAddressMapOpen) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsAddressMapOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAddressMapOpen]);

  const navLinks = [
    { name: 'Home',       path: '/'      },
    { name: 'Our Season', path: '/shows' },
    { name: 'Fundraising', path: '/fundraising' },
    { name: 'About',      path: '/about' },
  ];

  return (
    <div className="min-h-screen bg-white text-stone-900 flex flex-col" style={{ fontFamily: 'system-ui, sans-serif' }}>

      {/* ── NAVBAR ── */}
      <nav className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-stone-100">
        {/* Red-to-gold top rule — matches page headers */}
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-red-700 via-red-600 to-amber-400" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between sm:h-18">

            {/* Logo */}
            <Link to="/" className="group flex items-center gap-2.5 min-w-0">
              <motion.div
                whileHover={{ rotate: 6 }}
                transition={{ type: 'spring', stiffness: 300, damping: 15 }}
                className="w-8 h-8 bg-red-700 text-white rounded-lg flex items-center justify-center shadow-sm shadow-red-200 flex-shrink-0"
              >
                <Ticket className="w-4 h-4" />
              </motion.div>
              <span className="font-bold text-stone-900 truncate" style={{ fontFamily: 'Georgia, serif', fontSize: '1.1rem' }}>
                Penncrest <em className="text-red-700 not-italic">Theater</em>
              </span>
            </Link>

            {/* Desktop nav */}
            <div className="hidden md:flex items-center gap-8">
              {navLinks.map((link) => (
                <Link
                  key={link.name}
                  to={link.path}
                  className="relative text-sm font-medium transition-colors hover:text-red-700"
                  style={{ color: location.pathname === link.path ? '#b91c1c' : '#57534e' }}
                >
                  {link.name}
                  {location.pathname === link.path && (
                    <motion.div
                      layoutId="underline"
                      className="absolute -bottom-1 left-0 right-0 h-0.5 bg-red-700 rounded-full"
                    />
                  )}
                </Link>
              ))}
              <Link
                to="/shows"
                className="group flex items-center gap-1.5 bg-red-700 text-white px-5 py-2 rounded-full text-sm font-semibold hover:bg-red-800 transition-colors shadow-sm shadow-red-200"
              >
                <Ticket className="w-3.5 h-3.5" />
                Buy Tickets
              </Link>
            </div>

            {/* Mobile button */}
            <button
              className="md:hidden p-2 text-stone-500 hover:text-stone-900 transition-colors"
              onClick={() => setIsMenuOpen(!isMenuOpen)}
            >
              {isMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        <AnimatePresence>
          {isMenuOpen && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="md:hidden bg-white border-t border-stone-100 absolute w-full shadow-lg"
            >
              <div className="px-4 py-4 space-y-1">
                {navLinks.map((link) => (
                  <Link
                    key={link.name}
                    to={link.path}
                    className="block px-4 py-3 rounded-xl text-stone-700 font-medium hover:bg-stone-50 hover:text-red-700 transition-colors"
                    style={{ color: location.pathname === link.path ? '#b91c1c' : undefined }}
                    onClick={() => setIsMenuOpen(false)}
                  >
                    {link.name}
                  </Link>
                ))}
                <Link
                  to="/shows"
                  className="flex items-center justify-center gap-2 mt-2 px-4 py-3 rounded-xl bg-red-700 text-white font-semibold hover:bg-red-800 transition-colors"
                  onClick={() => setIsMenuOpen(false)}
                >
                  <Ticket className="w-4 h-4" /> Buy Tickets
                </Link>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </nav>

      {/* ── MAIN ── */}
      <main className="flex-grow">
        {children}
      </main>

      {/* ── FOOTER ── */}
      <footer className="bg-stone-950 text-stone-400 pt-14 pb-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-10 mb-12">

            {/* Brand */}
            <div className="md:col-span-2">
              <div className="flex items-center gap-2.5 mb-5">
                <div className="w-8 h-8 bg-red-700 text-white rounded-lg flex items-center justify-center flex-shrink-0">
                  <Ticket className="w-4 h-4" />
                </div>
                <span className="font-bold text-white" style={{ fontFamily: 'Georgia, serif', fontSize: '1.1rem' }}>
                  Penncrest <em className="text-red-500 not-italic">Theater</em>
                </span>
              </div>
              <p className="text-sm leading-relaxed max-w-xs text-stone-500">
                Bringing stories to life in Media, PA. A theater program dedicated to creativity, community, and excellence in the arts.
              </p>
              <div className="mt-5 flex flex-col gap-2 text-sm">
                <Link to="/privacy-policy" className="hover:text-amber-400 transition-colors">Privacy Policy</Link>
                <Link to="/terms-of-service" className="hover:text-amber-400 transition-colors">Terms of Service</Link>
                <Link to="/refund-policy" className="hover:text-amber-400 transition-colors">Refund Policy</Link>
              </div>
            </div>

            {/* Explore */}
            <div>
              <h4 className="text-white font-semibold text-xs uppercase tracking-[0.15em] mb-5">Explore</h4>
              <ul className="space-y-3 text-sm">
                <li><Link to="/shows" className="hover:text-amber-400 transition-colors">Our Season</Link></li>
                <li><Link to="/fundraising" className="hover:text-amber-400 transition-colors">Fundraising</Link></li>
                <li><Link to="/about" className="hover:text-amber-400 transition-colors">Our History</Link></li>
              </ul>
            </div>

            {/* Connect */}
            <div>
              <h4 className="text-white font-semibold text-xs uppercase tracking-[0.15em] mb-5">Connect</h4>
              <ul className="space-y-3 text-sm">
                <li>
                  <button
                    type="button"
                    onClick={() => setIsAddressMapOpen(true)}
                    className="text-left underline decoration-stone-700 underline-offset-4 transition-colors hover:text-amber-400 hover:decoration-amber-400"
                  >
                    134 Barren Rd, Media, PA 19063
                  </button>
                </li>
                <li>
                  <a href="mailto:jsmith3@rtmsd.org" className="hover:text-amber-400 transition-colors">
                    jsmith3@rtmsd.org
                  </a>
                </li>
                <li className="flex gap-3 pt-1">
                  <motion.a
                    whileHover={{ y: -2 }}
                    href="https://www.instagram.com/penncrest.theater/"
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Penncrest Theater Instagram"
                    className="w-8 h-8 bg-stone-800 hover:bg-red-700 text-stone-400 hover:text-white rounded-full flex items-center justify-center cursor-pointer transition-colors text-xs font-bold"
                  >
                    IG
                  </motion.a>
                  <motion.div whileHover={{ y: -2 }} className="w-8 h-8 bg-stone-800 hover:bg-red-700 text-stone-400 hover:text-white rounded-full flex items-center justify-center cursor-pointer transition-colors text-xs font-bold">
                    FB
                  </motion.div>
                </li>
              </ul>
            </div>

          </div>

          {/* Bottom rule */}
          <div className="border-t border-stone-800 pt-6 text-xs text-stone-600 text-center">
            &copy; {new Date().getFullYear()} Penncrest High School Theater. All rights reserved.
          </div>
        </div>
      </footer>

      <AnimatePresence>
        {isAddressMapOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-[140] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-label="Penncrest Theater arrival map"
            onClick={() => setIsAddressMapOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.98 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="relative w-full max-w-3xl overflow-hidden rounded-[28px] border border-white/10 bg-stone-950 shadow-2xl shadow-black/40"
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => setIsAddressMapOpen(false)}
                className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-stone-900/85 text-stone-200 transition-colors hover:bg-red-700 hover:text-white"
                aria-label="Close arrival map"
              >
                <X className="h-5 w-5" />
              </button>

              <div className="border-b border-stone-800 bg-gradient-to-r from-stone-950 via-stone-900 to-stone-950 px-5 py-5 sm:px-7">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-400">
                  Penncrest Theater
                </p>
                <h3
                  className="mt-2 text-2xl font-bold text-white sm:text-3xl"
                  style={{ fontFamily: 'Georgia, serif' }}
                >
                  Lion Entrance Map
                </h3>
                <p className="mt-2 max-w-xl text-sm leading-relaxed text-stone-400">
                  134 Barren Rd, Media, PA 19063
                </p>
              </div>

              <div className="bg-stone-900 p-3 sm:p-4">
                <img
                  src="/footer-address-map.png"
                  alt="Map showing Penncrest High School and the Lion Entrance parking area."
                  className="max-h-[75vh] w-full rounded-2xl border border-stone-800 bg-white object-contain"
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
