import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';

interface Show {
  id: string;
  title: string;
  description: string;
  posterUrl: string;
  type: string;
  year: number;
  accentColor: string;
}

export default function Shows() {
  const [shows, setShows] = useState<Show[]>([]);

  useEffect(() => {
    fetch('/api/shows')
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok || !Array.isArray(data)) {
          console.error('Failed to fetch shows', data);
          setShows([]);
          return;
        }
        setShows(data);
      })
      .catch((err) => {
        console.error('Failed to fetch shows', err);
        setShows([]);
      });
  }, []);

  return (
    <div className="bg-stone-50 min-h-screen py-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-20">
          <h1 className="text-5xl md:text-7xl font-black text-stone-900 mb-6">OUR SEASON</h1>
          <p className="text-xl text-stone-500 max-w-2xl mx-auto">
            From fall opener to spring finale, explore the productions lighting up the Penncrest stage.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-12">
          {shows.map((show, index) => (
            <motion.div
              key={show.id}
              initial={{ opacity: 0, y: 50 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6, delay: index * 0.1 }}
            >
              <Link to={`/shows/${show.id}`} className="group block">
                <div className="bg-white rounded-[2rem] p-4 shadow-xl hover:shadow-2xl transition-all duration-500 border border-stone-100 flex flex-col md:flex-row gap-8 overflow-hidden">
                  <div className="w-full md:w-1/3 aspect-[3/4] md:aspect-[4/5] rounded-3xl overflow-hidden relative">
                    <img 
                      src={show.posterUrl} 
                      alt={show.title} 
                      className="object-cover w-full h-full group-hover:scale-105 transition-transform duration-700"
                    />
                    <div className="absolute top-4 left-4 bg-white/90 backdrop-blur-md px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider shadow-sm">
                      {show.year}
                    </div>
                  </div>
                  <div className="flex-1 py-4 md:py-8 pr-4 md:pr-8 flex flex-col justify-center">
                    <div className="mb-4">
                      <span className="inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider mb-4" style={{ backgroundColor: `${show.accentColor}20`, color: show.accentColor }}>
                        {show.type}
                      </span>
                      <h2 className="text-4xl md:text-6xl font-black text-stone-900 mb-6 group-hover:text-stone-700 transition-colors leading-tight">
                        {show.title}
                      </h2>
                      <p className="text-stone-600 text-lg leading-relaxed mb-8 max-w-2xl">
                        {show.description}
                      </p>
                    </div>
                    <div className="flex items-center gap-4 mt-auto">
                      <span className="bg-stone-900 text-white px-8 py-4 rounded-full font-bold text-lg group-hover:bg-yellow-400 group-hover:text-stone-900 transition-all shadow-lg">
                        View Details & Tickets
                      </span>
                    </div>
                  </div>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
