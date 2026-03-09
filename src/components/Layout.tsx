import { Link, useLocation } from 'react-router-dom';
import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Ticket, Calendar, Users, Menu, X } from 'lucide-react';

export default function Layout({ children }: { children: React.ReactNode }) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const location = useLocation();

  const navLinks = [
    { name: 'Home', path: '/' },
    { name: 'Our Season', path: '/shows' },
    { name: 'About', path: '/about' },
  ];

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 font-sans selection:bg-yellow-200 selection:text-stone-900 flex flex-col">
      {/* Navbar */}
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-stone-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-20">
            {/* Logo */}
            <Link to="/" className="flex items-center gap-2 group">
              <div className="bg-yellow-400 text-stone-900 p-2 rounded-lg transform group-hover:rotate-3 transition-transform duration-300 shadow-sm border-2 border-stone-900">
                <Ticket className="w-6 h-6" />
              </div>
              <span className="font-bold text-xl tracking-tight uppercase font-mono">Penncrest<span className="text-yellow-500">Theater</span></span>
            </Link>

            {/* Desktop Nav */}
            <div className="hidden md:flex items-center gap-8">
              {navLinks.map((link) => (
                <Link
                  key={link.name}
                  to={link.path}
                  className={`text-sm font-medium uppercase tracking-wider hover:text-yellow-600 transition-colors relative ${
                    location.pathname === link.path ? 'text-yellow-600' : 'text-stone-600'
                  }`}
                >
                  {link.name}
                  {location.pathname === link.path && (
                    <motion.div
                      layoutId="underline"
                      className="absolute -bottom-1 left-0 right-0 h-0.5 bg-yellow-400"
                    />
                  )}
                </Link>
              ))}
              <Link
                to="/shows"
                className="bg-stone-900 text-white px-6 py-2.5 rounded-full font-bold text-sm uppercase tracking-wide hover:bg-stone-800 hover:scale-105 transition-all shadow-md active:scale-95"
              >
                Buy Tickets
              </Link>
            </div>

            {/* Mobile Menu Button */}
            <button
              className="md:hidden p-2 text-stone-600"
              onClick={() => setIsMenuOpen(!isMenuOpen)}
            >
              {isMenuOpen ? <X /> : <Menu />}
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        {isMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="md:hidden bg-white border-b border-stone-200 absolute w-full"
          >
            <div className="px-4 py-4 space-y-2">
              {navLinks.map((link) => (
                <Link
                  key={link.name}
                  to={link.path}
                  className="block px-4 py-3 rounded-lg hover:bg-yellow-50 font-medium text-stone-700"
                  onClick={() => setIsMenuOpen(false)}
                >
                  {link.name}
                </Link>
              ))}
              <Link
                to="/shows"
                className="block px-4 py-3 rounded-lg bg-yellow-400 text-stone-900 font-bold text-center mt-4"
                onClick={() => setIsMenuOpen(false)}
              >
                Buy Tickets
              </Link>
            </div>
          </motion.div>
        )}
      </nav>

      {/* Main Content */}
      <main className="flex-grow">
        {children}
      </main>

      {/* Footer */}
      <footer className="bg-stone-900 text-stone-400 py-12 mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 md:grid-cols-4 gap-12">
          <div className="col-span-1 md:col-span-2">
            <div className="flex items-center gap-2 mb-6">
              <div className="bg-yellow-400 text-stone-900 p-1.5 rounded-md">
                <Ticket className="w-5 h-5" />
              </div>
              <span className="font-bold text-lg text-white uppercase font-mono">Penncrest<span className="text-yellow-500">Theater</span></span>
            </div>
            <p className="max-w-sm text-sm leading-relaxed">
              Bringing stories to life in Media, PA. A theater program dedicated to creativity, community, and excellence in the arts. :)
            </p>
          </div>
          
          <div>
            <h4 className="text-white font-bold uppercase tracking-wider text-sm mb-6">Explore</h4>
            <ul className="space-y-3 text-sm">
              <li><Link to="/shows" className="hover:text-yellow-400 transition-colors">Our Season</Link></li>
              <li><Link to="/about" className="hover:text-yellow-400 transition-colors">Our History</Link></li>
              <li><Link to="/admin" className="hover:text-yellow-400 transition-colors">Staff Login</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="text-white font-bold uppercase tracking-wider text-sm mb-6">Connect</h4>
            <ul className="space-y-3 text-sm">
              <li>134 Barren Rd, Media, PA 19063</li>
              <li>jsmith3@rtmsd.org</li>
              <li className="flex gap-4 mt-4">
                {/* Social Icons Placeholder */}
                <div className="w-8 h-8 bg-stone-800 rounded-full hover:bg-yellow-400 hover:text-stone-900 transition-colors flex items-center justify-center cursor-pointer">IG</div>
                <div className="w-8 h-8 bg-stone-800 rounded-full hover:bg-yellow-400 hover:text-stone-900 transition-colors flex items-center justify-center cursor-pointer">FB</div>
              </li>
            </ul>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-12 pt-8 border-t border-stone-800 text-xs text-center">
          &copy; {new Date().getFullYear()} Penncrest High School Theater.
        </div>
      </footer>
    </div>
  );
}
