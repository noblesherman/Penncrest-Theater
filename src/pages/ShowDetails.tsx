import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { Calendar, Clock, MapPin, ArrowLeft } from 'lucide-react';
import { format } from 'date-fns';

interface Performance {
  id: string;
  date: string;
}

interface Show {
  id: string;
  title: string;
  description: string;
  posterUrl: string;
  type: string;
  year: number;
  accentColor: string;
  performances: Performance[];
}

export default function ShowDetails() {
  const { id } = useParams();
  const [show, setShow] = useState<Show | null>(null);

  useEffect(() => {
    fetch(`/api/shows/${id}`)
      .then(res => res.json())
      .then(data => setShow(data));
  }, [id]);

  if (!show) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;

  return (
    <div className="bg-white min-h-screen pb-20">
      {/* Banner */}
      <div className="relative h-[60vh] min-h-[500px] bg-stone-900 overflow-hidden">
        <div className="absolute inset-0 opacity-40">
          <img src={show.posterUrl} alt={show.title} className="w-full h-full object-cover blur-sm" />
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-stone-900 via-stone-900/50 to-transparent"></div>
        
        <div className="absolute inset-0 flex items-end">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-20 w-full">
            <Link to="/shows" className="inline-flex items-center text-white/60 hover:text-white mb-8 transition-colors">
              <ArrowLeft className="w-5 h-5 mr-2" /> Back to Shows
            </Link>
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8 }}
            >
              <div className="flex items-center gap-4 mb-6">
                <span className="bg-yellow-400 text-stone-900 px-4 py-1.5 rounded-full text-sm font-bold uppercase tracking-wider shadow-lg">
                  {show.type}
                </span>
                <span className="text-white/80 font-mono text-sm border border-white/20 px-4 py-1.5 rounded-full">
                  {show.year} Season
                </span>
              </div>
              <h1 className="text-6xl md:text-8xl font-black text-white mb-6 tracking-tighter shadow-sm">
                {show.title}
              </h1>
            </motion.div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 -mt-10 relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-12">
            <div className="bg-white rounded-3xl p-8 md:p-12 shadow-xl border border-stone-100">
              <h2 className="text-2xl font-bold mb-6">About the Show</h2>
              <p className="text-stone-600 text-lg leading-relaxed whitespace-pre-line">
                {show.description}
              </p>
            </div>

            {/* Cast Grid */}
            <div>
              <h2 className="text-3xl font-black mb-8">Meet the Cast</h2>
              <div className="flex overflow-x-auto gap-6 pb-8 -mx-4 px-4 md:mx-0 md:px-0 no-scrollbar snap-x snap-mandatory">
                {[...Array(20)].map((_, i) => (
                  <div key={i} className="flex-none w-40 md:w-48 snap-start group">
                    <div className="relative aspect-[3/4] bg-stone-200 rounded-xl overflow-hidden mb-3 shadow-md group-hover:shadow-xl transition-all duration-300 group-hover:-translate-y-1">
                      <img 
                        src={`https://picsum.photos/seed/${show.id}${i}/300/400`} 
                        alt="Cast member" 
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" 
                      />
                    </div>
                    <div className="text-center">
                      <div className="font-bold text-stone-900 text-lg leading-tight">Student Name</div>
                      <div className="text-stone-500 text-sm font-medium">Role Name</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Sidebar / Tickets */}
          <div className="lg:col-span-1">
            <div className="bg-stone-50 rounded-3xl p-8 sticky top-24 border border-stone-200 shadow-lg">
              <h3 className="text-2xl font-black mb-6 flex items-center gap-2">
                <Calendar className="w-6 h-6 text-yellow-500" />
                Performances
              </h3>
              <div className="space-y-4">
                {show.performances.map((perf) => (
                  <div key={perf.id} className="bg-white p-6 rounded-2xl border border-stone-100 shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <div className="font-bold text-lg text-stone-900">
                          {format(new Date(perf.date), 'EEEE, MMMM d')}
                        </div>
                        <div className="text-stone-500 flex items-center gap-2 mt-1">
                          <Clock className="w-4 h-4" />
                          {format(new Date(perf.date), 'h:mm a')}
                        </div>
                      </div>
                    </div>
                    <Link
                      to={`/booking/${perf.id}`}
                      className="block w-full bg-stone-900 text-white text-center py-3 rounded-xl font-bold hover:bg-yellow-400 hover:text-stone-900 transition-colors"
                    >
                      Select Seats
                    </Link>
                  </div>
                ))}
                {show.performances.length === 0 && (
                  <div className="text-stone-500 italic">No upcoming performances scheduled.</div>
                )}
              </div>
              
              <div className="mt-8 pt-8 border-t border-stone-200">
                <div className="flex items-start gap-3 text-stone-600 text-sm">
                  <MapPin className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold block text-stone-900">Penncrest High School Auditorium</span>
                    134 Barren Rd, Media, PA 19063
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
