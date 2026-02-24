import { motion } from 'motion/react';
import { Music, Mic2, Users, Star, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function MusicalTheater() {
  return (
    <div className="bg-pink-50 min-h-screen font-sans text-stone-900">
      {/* Hero Section */}
      <section className="relative py-24 overflow-hidden bg-pink-500 text-white">
        <div className="absolute inset-0 opacity-20 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>
        <div className="absolute inset-0 bg-gradient-to-tr from-pink-600 to-purple-500 opacity-90"></div>
        
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8 }}
          >
            <div className="inline-block bg-white/20 text-white px-4 py-1.5 rounded-full text-sm font-bold uppercase tracking-wider mb-6 border border-white/30 backdrop-blur-sm">
              Center Stage
            </div>
            <h1 className="text-5xl md:text-8xl font-black font-display mb-6 tracking-tighter uppercase drop-shadow-lg">
              Musical Theater
            </h1>
            <p className="text-xl text-pink-100 max-w-3xl mx-auto leading-relaxed font-medium">
              Sing. Dance. Act. Tell stories that move audiences and create memories that last a lifetime.
            </p>
          </motion.div>
        </div>
      </section>

      {/* About Section */}
      <section className="py-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-white rounded-[3rem] p-10 md:p-16 shadow-2xl border border-pink-100 text-center relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-pink-500 via-purple-500 to-blue-500"></div>
            
            <h2 className="text-3xl font-black mb-8 uppercase text-stone-900">More Than Just a Club</h2>
            <p className="text-lg text-stone-600 leading-relaxed mb-10">
              The Musical Theater program is the heart of our performing arts department. We produce two major productions a year: a fall play and a spring musical. Whether you're a seasoned performer or stepping onto the stage for the first time, there is a role for you.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="flex flex-col items-center">
                <div className="w-16 h-16 bg-pink-100 text-pink-600 rounded-2xl flex items-center justify-center mb-4 rotate-3">
                  <Mic2 className="w-8 h-8" />
                </div>
                <h3 className="font-bold text-xl mb-2">Voice</h3>
                <p className="text-sm text-stone-500">Vocal training and ensemble singing.</p>
              </div>
              <div className="flex flex-col items-center">
                <div className="w-16 h-16 bg-purple-100 text-purple-600 rounded-2xl flex items-center justify-center mb-4 -rotate-3">
                  <Users className="w-8 h-8" />
                </div>
                <h3 className="font-bold text-xl mb-2">Acting</h3>
                <p className="text-sm text-stone-500">Character development and scene work.</p>
              </div>
              <div className="flex flex-col items-center">
                <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center mb-4 rotate-3">
                  <Music className="w-8 h-8" />
                </div>
                <h3 className="font-bold text-xl mb-2">Dance</h3>
                <p className="text-sm text-stone-500">Choreography for all skill levels.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Spotlight Section */}
      <section className="py-20 bg-stone-900 text-white overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center gap-12">
            <div className="flex-1 space-y-6">
              <div className="flex items-center gap-2 text-yellow-400 font-bold uppercase tracking-wider text-sm">
                <Star className="w-4 h-4" />
                Student Spotlight
              </div>
              <h2 className="text-4xl md:text-5xl font-black uppercase leading-tight">
                "It changed my high school experience."
              </h2>
              <p className="text-stone-400 text-lg leading-relaxed">
                "I was terrified to audition my freshman year. Four years later, I've found my best friends and my voice. The theater department is a family where everyone is accepted for who they are."
              </p>
              <div className="font-bold text-white">— Sarah M., Class of '24</div>
            </div>
            <div className="flex-1 relative">
              <div className="aspect-[3/4] bg-stone-800 rounded-2xl overflow-hidden rotate-3 border-4 border-stone-700 shadow-2xl">
                <img src="https://picsum.photos/seed/performer/600/800" alt="Performer on stage" className="w-full h-full object-cover" />
              </div>
              <div className="absolute -bottom-10 -right-10 w-40 h-40 bg-pink-500 rounded-full mix-blend-overlay filter blur-3xl opacity-50"></div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-white border-t border-stone-100">
        <div className="max-w-4xl mx-auto text-center px-4">
          <h2 className="text-4xl font-black mb-6 uppercase text-stone-900">Take the Stage</h2>
          <p className="text-xl text-stone-600 mb-8">
            Auditions for the Spring Musical are coming up soon. Don't miss your chance to shine.
          </p>
          <div className="flex justify-center gap-4">
            <Link to="/about" className="inline-flex items-center gap-2 bg-pink-600 text-white px-8 py-4 rounded-full font-bold text-lg hover:bg-pink-500 transition-colors shadow-lg shadow-pink-200">
              Audition Info <ArrowRight className="w-5 h-5" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
