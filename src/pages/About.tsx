import { motion } from 'motion/react';
import { Star, Heart, Users, Award, Sparkles, Calendar, Mail, ArrowRight } from 'lucide-react';
import TheaterCalendar from '../components/TheaterCalendar';
import ShowHistorySlideshow from '../components/ShowHistorySlideshow';
import { Link } from 'react-router-dom';

export default function About() {
  return (
    <div className="bg-stone-50 min-h-screen font-sans text-stone-900">
      {/* Hero Section */}
      <section className="relative py-20 bg-yellow-400 overflow-hidden">
        <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/stardust.png')]"></div>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
          >
            <h1 className="text-4xl md:text-6xl font-black font-display mb-6 tracking-tight uppercase">
              Welcome to Penncrest<br/>High School Theater
            </h1>
            <p className="text-xl font-bold text-stone-800 max-w-3xl mx-auto leading-relaxed">
              Do you love to sing? Do you enjoy dancing? Do you like to act? Paint? Draw? Work with technology?
            </p>
          </motion.div>
        </div>
      </section>

      {/* Welcome Text */}
      <section className="py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-white rounded-3xl p-8 md:p-12 shadow-xl border border-stone-100 leading-relaxed text-lg text-stone-600 space-y-6">
            <p>
              Maybe you are interested in trying out for the school musical. Maybe you just want a taste of Musical Theater and want to attend Musical Theater Club. Maybe you enjoy art and want to be involved with creating props or set pieces through our set design club. Maybe you want to learn more about lights or sound equipment, you can do that through our Tech Crew.
            </p>
            <p className="font-bold text-stone-900 text-xl">
              Whatever it is you're interested in - welcome to the Theater Department! We're glad that you're here and can't wait for another amazing year on and off the stage!
            </p>
          </div>
        </div>
      </section>

      {/* Calendar Section */}
      <section className="py-12 bg-stone-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-black uppercase tracking-wide mb-4">Upcoming Events</h2>
            <p className="text-stone-500 max-w-2xl mx-auto">
              Stay up to date with our rehearsal schedule, performances, and community events.
            </p>
          </div>
          <TheaterCalendar />
        </div>
      </section>

      {/* Departments / Clubs */}
      <section className="py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-black text-center mb-12 uppercase">Get Involved</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {[
              { title: 'Tech Crew', icon: <Sparkles className="w-6 h-6" />, color: 'bg-purple-100 text-purple-600', link: '/tech-crew' },
              { title: 'Set Design', icon: <Award className="w-6 h-6" />, color: 'bg-blue-100 text-blue-600', link: '/set-design' },
              { title: 'Musical Theater', icon: <Heart className="w-6 h-6" />, color: 'bg-pink-100 text-pink-600', link: '/musical-theater' },
              { title: 'Parents Association', icon: <Users className="w-6 h-6" />, color: 'bg-green-100 text-green-600', link: '/parents-association' },
            ].map((item) => (
              <Link to={item.link} key={item.title} className="bg-white p-6 rounded-2xl shadow-sm border border-stone-100 hover:shadow-md transition-shadow text-center group cursor-pointer block">
                <div className={`w-12 h-12 mx-auto ${item.color} rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                  {item.icon}
                </div>
                <h3 className="font-bold text-stone-900">{item.title}</h3>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Staff Section */}
      <section className="py-20 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-3xl font-black text-center mb-12 uppercase">Meet the Staff</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { name: 'Sarah Johnson', role: 'Director', image: 'https://picsum.photos/seed/director/400/400' },
              { name: 'Michael Chen', role: 'Musical Director', image: 'https://picsum.photos/seed/music/400/400' },
              { name: 'Emily Davis', role: 'Choreographer', image: 'https://picsum.photos/seed/dance/400/400' },
            ].map((staff) => (
              <div key={staff.name} className="text-center group">
                <div className="w-48 h-48 mx-auto rounded-full overflow-hidden mb-6 border-4 border-stone-100 shadow-lg group-hover:border-yellow-400 transition-colors">
                  <img src={staff.image} alt={staff.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                </div>
                <h3 className="text-xl font-bold text-stone-900">{staff.name}</h3>
                <p className="text-stone-500 font-medium uppercase tracking-wider text-sm">{staff.role}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* History Slideshow */}
      <section className="py-20 bg-stone-900 text-white overflow-hidden relative">
         <div className="absolute top-0 right-0 w-96 h-96 bg-yellow-500 rounded-full mix-blend-overlay filter blur-3xl opacity-20"></div>
         <div className="absolute bottom-0 left-0 w-96 h-96 bg-pink-500 rounded-full mix-blend-overlay filter blur-3xl opacity-20"></div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="text-center mb-16">
            <h2 className="text-4xl md:text-5xl font-black mb-4">A LEGACY OF PERFORMANCE</h2>
            <p className="text-stone-400">Highlighting some of our favorite moments over the years.</p>
          </div>
          
          <ShowHistorySlideshow />
        </div>
      </section>

      {/* Contact */}
      <section className="py-20 bg-yellow-50 border-t border-yellow-100">
        <div className="max-w-3xl mx-auto text-center px-4">
          <div className="w-16 h-16 bg-stone-900 text-white rounded-full flex items-center justify-center mx-auto mb-6">
            <Mail className="w-8 h-8" />
          </div>
          <h2 className="text-3xl font-black text-stone-900 mb-4 uppercase">Contact Us</h2>
          <p className="text-lg text-stone-600 mb-8">
            If you have any questions or concerns, don't hesitate to reach out.
          </p>
          <a href="mailto:theater@penncrest.edu" className="text-2xl font-bold text-stone-900 hover:text-yellow-600 transition-colors underline decoration-yellow-400 decoration-4 underline-offset-4">
            theater@penncrest.edu
          </a>
        </div>
      </section>
    </div>
  );
}
