import { motion } from 'motion/react';
import { Link } from 'react-router-dom';
import { ArrowRight, Star, Calendar, MapPin } from 'lucide-react';
import { useEffect, useState } from 'react';

interface Show {
  id: string;
  title: string;
  description: string;
  posterUrl: string;
  type: string;
  year: number;
  accentColor: string;
}

export default function Home() {
  const [shows, setShows] = useState<Show[]>([]);

  useEffect(() => {
    fetch('/api/shows')
      .then(res => res.json())
      .then(data => setShows(data));
  }, []);

  const featuredShow = shows[0];

  return (
    <div className="overflow-hidden">
      {/* Hero Section */}
      <section className="relative bg-yellow-50 pt-20 pb-32 overflow-hidden">
        {/* Decorative Blobs */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-yellow-300 rounded-full mix-blend-multiply filter blur-3xl opacity-50 animate-blob"></div>
        <div className="absolute top-0 left-0 w-96 h-96 bg-pink-300 rounded-full mix-blend-multiply filter blur-3xl opacity-50 animate-blob animation-delay-2000"></div>
        <div className="absolute -bottom-32 left-20 w-96 h-96 bg-blue-300 rounded-full mix-blend-multiply filter blur-3xl opacity-50 animate-blob animation-delay-4000"></div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8 }}
            >
              <div className="inline-block bg-stone-900 text-white text-xs font-bold px-3 py-1 rounded-full uppercase tracking-widest mb-6">
                Now Enrolling for Fall 2024
              </div>
              <h1 className="text-6xl md:text-8xl font-black font-display text-stone-900 tracking-tighter leading-[0.9] mb-8">
                PENNCREST <br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-yellow-500 via-orange-500 to-pink-500">
                  THEATER
                </span>
              </h1>
              <p className="text-xl text-stone-600 mb-10 max-w-lg leading-relaxed">
                Bringing stories to life in Media, PA. Join us for a season of creativity, community, and unforgettable performances.
              </p>
              <div className="flex flex-wrap gap-4">
                <Link
                  to="/shows"
                  className="bg-stone-900 text-white px-8 py-4 rounded-full font-bold text-lg hover:bg-stone-800 hover:scale-105 transition-all shadow-xl flex items-center gap-2 group"
                >
                  Get Tickets
                  <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </Link>
                <Link
                  to="/about"
                  className="bg-white text-stone-900 border-2 border-stone-200 px-8 py-4 rounded-full font-bold text-lg hover:border-stone-900 hover:bg-stone-50 transition-all"
                >
                  Join the Cast
                </Link>
              </div>
            </motion.div>

            {/* Floating Posters */}
            <div className="relative h-[600px] hidden lg:block">
              {featuredShow && (
                <motion.div
                  initial={{ rotate: -6, y: 100, opacity: 0 }}
                  animate={{ rotate: -6, y: 0, opacity: 1 }}
                  transition={{ duration: 0.8, delay: 0.2 }}
                  className="absolute top-10 right-20 w-80 bg-white p-4 rounded-2xl shadow-2xl transform hover:rotate-0 transition-transform duration-500 z-20"
                >
                  <div className="aspect-[2/3] bg-stone-200 rounded-xl overflow-hidden mb-4 relative">
                    <img src={featuredShow.posterUrl} alt={featuredShow.title} className="object-cover w-full h-full" />
                    <div className="absolute top-4 right-4 bg-yellow-400 text-stone-900 font-bold px-3 py-1 rounded-full text-xs uppercase shadow-md">
                      Upcoming
                    </div>
                  </div>
                  <h3 className="font-bold text-2xl mb-1">{featuredShow.title}</h3>
                  <p className="text-stone-500 text-sm">{featuredShow.type} • {featuredShow.year}</p>
                </motion.div>
              )}
              
              {/* Decorative background card */}
              <motion.div
                initial={{ rotate: 6, x: 50, opacity: 0 }}
                animate={{ rotate: 6, x: 0, opacity: 1 }}
                transition={{ duration: 0.8, delay: 0.4 }}
                className="absolute top-32 right-0 w-72 bg-pink-500 p-4 rounded-2xl shadow-xl z-10"
              >
                 <div className="aspect-[2/3] bg-pink-600 rounded-xl opacity-50"></div>
              </motion.div>
            </div>
          </div>
        </div>
      </section>

      {/* Upcoming Shows Spotlight */}
      <section className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-end mb-16">
            <div>
              <h2 className="text-4xl font-black text-stone-900 mb-4">ON STAGE</h2>
              <p className="text-stone-500 text-lg">Don't miss our latest productions.</p>
            </div>
            <Link to="/shows" className="hidden md:flex items-center gap-2 font-bold text-stone-900 hover:text-yellow-500 transition-colors">
              View All Shows <ArrowRight className="w-5 h-5" />
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {shows.map((show) => (
              <Link key={show.id} to={`/shows/${show.id}`} className="group">
                <div className="bg-stone-50 rounded-3xl overflow-hidden border border-stone-100 hover:shadow-2xl transition-all duration-500 hover:-translate-y-2">
                  <div className="aspect-[4/3] overflow-hidden relative">
                    <img 
                      src={show.posterUrl} 
                      alt={show.title} 
                      className="object-cover w-full h-full group-hover:scale-110 transition-transform duration-700"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end p-6">
                      <span className="text-white font-bold bg-yellow-500 px-4 py-2 rounded-full text-sm">Get Tickets</span>
                    </div>
                  </div>
                  <div className="p-8">
                    <div className="flex items-center gap-3 mb-4">
                      <span className="bg-stone-200 text-stone-600 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider">
                        {show.type}
                      </span>
                      <span className="text-stone-400 text-xs font-bold uppercase tracking-wider">
                        {show.year}
                      </span>
                    </div>
                    <h3 className="text-2xl font-bold text-stone-900 mb-2 group-hover:text-yellow-600 transition-colors">
                      {show.title}
                    </h3>
                    <p className="text-stone-500 line-clamp-2 text-sm leading-relaxed">
                      {show.description}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Community Section */}
      <section className="py-24 bg-stone-900 text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/stardust.png')]"></div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center">
          <Star className="w-12 h-12 text-yellow-400 mx-auto mb-8 animate-spin-slow" />
          <h2 className="text-4xl md:text-6xl font-black mb-8 tracking-tight">
            MORE THAN JUST A STAGE
          </h2>
          <p className="text-xl text-stone-400 max-w-2xl mx-auto mb-12 leading-relaxed">
            We are a community of actors, designers, technicians, and dreamers. 
            Every ticket you buy supports arts education at Penncrest High School.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 max-w-4xl mx-auto">
            {[
              { label: 'Productions', value: '50+' },
              { label: 'Students', value: '120+' },
              { label: 'Awards', value: '15' },
              { label: 'Years', value: '25' },
            ].map((stat) => (
              <div key={stat.label} className="p-6 border border-stone-800 rounded-2xl bg-stone-800/50 backdrop-blur-sm">
                <div className="text-4xl font-black text-yellow-400 mb-2">{stat.value}</div>
                <div className="text-stone-400 text-sm uppercase tracking-widest font-bold">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
