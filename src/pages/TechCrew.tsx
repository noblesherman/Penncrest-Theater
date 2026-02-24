import { motion } from 'motion/react';
import { Mic, Zap, Settings, Headphones, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function TechCrew() {
  return (
    <div className="bg-stone-900 min-h-screen font-sans text-white">
      {/* Hero Section */}
      <section className="relative py-24 overflow-hidden">
        <div className="absolute inset-0 opacity-20 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')]"></div>
        <div className="absolute inset-0 bg-gradient-to-b from-purple-900/20 to-stone-900"></div>
        
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="text-center"
          >
            <div className="inline-block bg-purple-500/20 text-purple-300 px-4 py-1.5 rounded-full text-sm font-bold uppercase tracking-wider mb-6 border border-purple-500/30">
              Behind the Scenes
            </div>
            <h1 className="text-5xl md:text-8xl font-black font-display mb-6 tracking-tighter uppercase text-transparent bg-clip-text bg-gradient-to-r from-white to-stone-400">
              Tech Crew
            </h1>
            <p className="text-xl text-stone-300 max-w-3xl mx-auto leading-relaxed">
              The magic doesn't just happen on stage. It happens in the booth, on the catwalks, and in the wings. We control the lights, the sound, and the flow of the show.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Roles Grid */}
      <section className="py-20 bg-stone-800/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              { title: 'Lighting', icon: <Zap className="w-8 h-8" />, desc: 'Design and operate the lighting rig to set the mood and atmosphere.', color: 'text-yellow-400', bg: 'bg-yellow-400/10' },
              { title: 'Sound', icon: <Headphones className="w-8 h-8" />, desc: 'Manage microphones, sound effects, and the overall mix for the audience.', color: 'text-blue-400', bg: 'bg-blue-400/10' },
              { title: 'Stage Management', icon: <Settings className="w-8 h-8" />, desc: 'Call the cues and run the show. The captain of the ship during performances.', color: 'text-green-400', bg: 'bg-green-400/10' },
              { title: 'Run Crew', icon: <Mic className="w-8 h-8" />, desc: 'Handle scene changes, props, and backstage logistics in real-time.', color: 'text-red-400', bg: 'bg-red-400/10' },
            ].map((role, i) => (
              <motion.div 
                key={i}
                whileHover={{ y: -5 }}
                className="bg-stone-900 p-8 rounded-2xl border border-stone-700 hover:border-stone-600 transition-colors"
              >
                <div className={`w-16 h-16 rounded-2xl ${role.bg} ${role.color} flex items-center justify-center mb-6`}>
                  {role.icon}
                </div>
                <h3 className="text-2xl font-bold mb-3">{role.title}</h3>
                <p className="text-stone-400 leading-relaxed">{role.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Image Showcase */}
      <section className="py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
            <div className="space-y-6">
              <h2 className="text-4xl font-black uppercase">Master the Machine</h2>
              <p className="text-lg text-stone-300 leading-relaxed">
                Our theater is equipped with professional-grade technology. As a member of Tech Crew, you'll get hands-on training with industry-standard equipment. No prior experience is necessary—just a willingness to learn and problem-solve.
              </p>
              <ul className="space-y-4 text-stone-300">
                <li className="flex items-center gap-3">
                  <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                  ETC Ion Lighting Console
                </li>
                <li className="flex items-center gap-3">
                  <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                  Digital Audio Workstations
                </li>
                <li className="flex items-center gap-3">
                  <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                  Wireless Mic Systems
                </li>
              </ul>
            </div>
            <div className="relative">
              <div className="aspect-video bg-stone-800 rounded-2xl overflow-hidden border border-stone-700 shadow-2xl">
                <img src="https://picsum.photos/seed/techbooth/800/600" alt="Tech Booth" className="w-full h-full object-cover opacity-80 hover:opacity-100 transition-opacity duration-500" />
              </div>
              <div className="absolute -bottom-6 -left-6 w-32 h-32 bg-purple-600 rounded-full blur-3xl opacity-20"></div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-purple-900/20 border-t border-purple-500/20">
        <div className="max-w-4xl mx-auto text-center px-4">
          <h2 className="text-4xl font-black mb-6 uppercase">Join the Crew</h2>
          <p className="text-xl text-stone-300 mb-8">
            Ready to run the show? We're always looking for new technicians.
          </p>
          <Link to="/about" className="inline-flex items-center gap-2 bg-white text-stone-900 px-8 py-4 rounded-full font-bold text-lg hover:bg-purple-400 transition-colors">
            Contact Us <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      </section>
    </div>
  );
}
