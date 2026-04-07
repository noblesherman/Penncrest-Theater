import { Link, useLocation } from 'react-router-dom';
import React, { useEffect, useState } from 'react';
import { ChevronDown, Ticket, Menu, X } from 'lucide-react';

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
    {
      name: 'Our Season',
      path: '/shows',
      children: [{ name: 'Community Events', path: '/shows/community-events' }]
    },
    { name: 'Fundraising', path: '/fundraising' },
    { name: 'About',      path: '/about' },
  ];

  const isActivePath = (path: string): boolean => {
    if (path === '/') return location.pathname === '/';
    return location.pathname === path || location.pathname.startsWith(`${path}/`);
  };

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
              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-red-700 text-white shadow-sm shadow-red-200 transition-transform duration-200 group-hover:-rotate-6">
                <Ticket className="w-4 h-4" />
              </div>
              <span className="font-bold text-stone-900 truncate" style={{ fontFamily: 'Georgia, serif', fontSize: '1.1rem' }}>
                Penncrest <em className="text-red-700 not-italic">Theater</em>
              </span>
            </Link>

            {/* Desktop nav */}
            <div className="hidden md:flex items-center gap-8">
              {navLinks.map((link) => (
                link.children ? (
                  <div key={link.name} className="group relative">
                    <Link
                      to={link.path}
                      className="relative inline-flex items-center gap-1 text-sm font-medium transition-colors hover:text-red-700"
                      style={{ color: isActivePath(link.path) ? '#b91c1c' : '#57534e' }}
                    >
                      {link.name}
                      <ChevronDown className="h-3.5 w-3.5" />
                      {isActivePath(link.path) && (
                        <span className="absolute -bottom-1 left-0 right-0 h-0.5 rounded-full bg-red-700" />
                      )}
                    </Link>
                    <div className="invisible pointer-events-none absolute left-0 top-full z-20 pt-2 opacity-0 transition-all duration-150 group-hover:visible group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:visible group-focus-within:pointer-events-auto group-focus-within:opacity-100">
                      <div className="min-w-[220px] rounded-xl border border-stone-200 bg-white p-1.5 shadow-lg shadow-stone-200/60">
                        {link.children.map((child) => (
                          <Link
                            key={child.path}
                            to={child.path}
                            className="block rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-stone-50 hover:text-red-700"
                            style={{ color: isActivePath(child.path) ? '#b91c1c' : '#57534e' }}
                          >
                            {child.name}
                          </Link>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <Link
                    key={link.name}
                    to={link.path}
                    className="relative text-sm font-medium transition-colors hover:text-red-700"
                    style={{ color: isActivePath(link.path) ? '#b91c1c' : '#57534e' }}
                  >
                    {link.name}
                    {isActivePath(link.path) && (
                      <span className="absolute -bottom-1 left-0 right-0 h-0.5 rounded-full bg-red-700" />
                    )}
                  </Link>
                )
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
              aria-label={isMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
              aria-expanded={isMenuOpen}
              aria-controls="mobile-navigation"
            >
              {isMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {isMenuOpen && (
          <div id="mobile-navigation" className="absolute w-full border-t border-stone-100 bg-white shadow-lg md:hidden">
            <div className="space-y-1 px-4 py-4">
              {navLinks.map((link) => (
                <div key={link.name}>
                  <Link
                    to={link.path}
                    className="block rounded-xl px-4 py-3 font-medium text-stone-700 transition-colors hover:bg-stone-50 hover:text-red-700"
                    style={{ color: isActivePath(link.path) ? '#b91c1c' : undefined }}
                    onClick={() => setIsMenuOpen(false)}
                  >
                    {link.name}
                  </Link>
                  {link.children?.map((child) => (
                    <Link
                      key={child.path}
                      to={child.path}
                      className="mt-1 block rounded-xl px-6 py-2.5 text-sm font-medium text-stone-600 transition-colors hover:bg-stone-50 hover:text-red-700"
                      style={{ color: isActivePath(child.path) ? '#b91c1c' : undefined }}
                      onClick={() => setIsMenuOpen(false)}
                    >
                      {child.name}
                    </Link>
                  ))}
                </div>
              ))}
              <Link
                to="/shows"
                className="mt-2 flex items-center justify-center gap-2 rounded-xl bg-red-700 px-4 py-3 font-semibold text-white transition-colors hover:bg-red-800"
                onClick={() => setIsMenuOpen(false)}
              >
                <Ticket className="w-4 h-4" /> Buy Tickets
              </Link>
            </div>
          </div>
        )}
      </nav>

      {/* ── MAIN ── */}
      <main className="flex-grow">
        {children}
      </main>

      {/* ── FOOTER ── */}
      <footer className="bg-stone-950 pt-14 pb-8 text-stone-300">
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
              <p className="max-w-xs text-sm leading-relaxed text-stone-300">
                Bringing stories to life in Media, PA. A theater program dedicated to creativity, community, and excellence in the arts.
              </p>
              <div className="mt-5 flex flex-col gap-2 text-sm">
                <Link to="/privacy-policy" className="hover:text-amber-400 transition-colors">Privacy Policy</Link>
                <Link to="/terms-of-service" className="hover:text-amber-400 transition-colors">Terms of Service</Link>
                <Link to="/refund-policy" className="hover:text-amber-400 transition-colors">Refund Policy</Link>
                <Link to="/admin/login" className="hover:text-amber-400 transition-colors">Staff Login</Link>
              </div>
            </div>

            {/* Explore */}
            <div>
              <p className="mb-5 text-xs font-semibold uppercase tracking-[0.15em] text-white">Explore</p>
              <ul className="space-y-3 text-sm">
                <li><Link to="/shows" className="hover:text-amber-400 transition-colors">Our Season</Link></li>
                <li><Link to="/shows/community-events" className="hover:text-amber-400 transition-colors">Community Events</Link></li>
                <li><Link to="/fundraising" className="hover:text-amber-400 transition-colors">Fundraising</Link></li>
                <li><Link to="/about#history" className="hover:text-amber-400 transition-colors">Our History</Link></li>
              </ul>
            </div>

            {/* Connect */}
            <div>
              <p className="mb-5 text-xs font-semibold uppercase tracking-[0.15em] text-white">Connect</p>
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
                  <a
                    href="https://www.instagram.com/penncrest.theater/"
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Penncrest Theater Instagram"
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-stone-800 text-xs font-bold text-stone-300 transition-all hover:-translate-y-0.5 hover:bg-red-700 hover:text-white"
                  >
                    IG
                  </a>
                </li>
              </ul>
            </div>

          </div>

          {/* Bottom rule */}
          <div className="border-t border-stone-800 pt-6 text-center text-xs text-stone-400">
            &copy; {new Date().getFullYear()} Penncrest High School Theater. All rights reserved.
          </div>
        </div>
      </footer>

      {isAddressMapOpen && (
        <div
          className="fixed inset-0 z-[140] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Penncrest Theater arrival map"
          onClick={() => setIsAddressMapOpen(false)}
        >
          <div
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
          </div>
        </div>
      )}

    </div>
  );
}
