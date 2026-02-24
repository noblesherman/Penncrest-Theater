import { motion } from 'motion/react';
import { Hammer, Paintbrush, Ruler, Box, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function SetDesign() {
  return (
    <div className="bg-stone-50 min-h-screen font-sans text-stone-900">
      {/* Hero Section */}
      <section className="relative py-24 overflow-hidden bg-blue-600 text-white">
        <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/blueprint.png')]"></div>
        
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="text-center"
          >
            <div className="inline-block bg-white/20 text-white px-4 py-1.5 rounded-full text-sm font-bold uppercase tracking-wider mb-6 border border-white/30">
              Stagecraft
            </div>
            <h1 className="text-5xl md:text-8xl font-black font-display mb-6 tracking-tighter uppercase">
              Set Design
            </h1>
            <p className="text-xl text-blue-100 max-w-3xl mx-auto leading-relaxed font-medium">
              We build worlds. From concept sketches to final construction, the Set Design club transforms the stage into new realities.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Process Section */}
      <section className="py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
            {[
              { title: 'Design', icon: <Ruler className="w-10 h-10" />, desc: 'Visualize the environment. Create blueprints and scale models.', color: 'bg-blue-100 text-blue-600' },
              { title: 'Build', icon: <Hammer className="w-10 h-10" />, desc: 'Carpentry and construction. Learn to use power tools safely to build structures.', color: 'bg-orange-100 text-orange-600' },
              { title: 'Paint', icon: <Paintbrush className="w-10 h-10" />, desc: 'Scenic painting techniques. Textures, faux finishes, and artistic details.', color: 'bg-purple-100 text-purple-600' },
            ].map((step, i) => (
              <motion.div 
                key={i}
                whileHover={{ y: -10 }}
                className="bg-white p-8 rounded-3xl shadow-xl border border-stone-100 text-center group"
              >
                <div className={`w-20 h-20 mx-auto rounded-full ${step.color} flex items-center justify-center mb-6 group-hover:scale-110 transition-transform`}>
                  {step.icon}
                </div>
                <h3 className="text-2xl font-black mb-4 uppercase">{step.title}</h3>
                <p className="text-stone-600 leading-relaxed">{step.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Gallery / Workshop */}
      <section className="py-20 bg-stone-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div className="relative">
              <div className="grid grid-cols-2 gap-4">
                <img src="https://picsum.photos/seed/set1/400/500" className="rounded-2xl shadow-lg mt-8" alt="Set construction" />
                <img src="https://picsum.photos/seed/set2/400/500" className="rounded-2xl shadow-lg" alt="Painting scenery" />
              </div>
              <div className="absolute -z-10 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[120%] h-[120%] bg-blue-200/50 rounded-full blur-3xl"></div>
            </div>
            
            <div className="space-y-8">
              <h2 className="text-4xl font-black uppercase text-stone-900">The Workshop</h2>
              <p className="text-lg text-stone-600 leading-relaxed">
                Our scene shop is a hive of activity. Students learn practical skills that go beyond the theater: project management, structural engineering, and collaborative problem-solving.
              </p>
              <div className="bg-white p-6 rounded-2xl border-l-4 border-blue-500 shadow-sm">
                <h4 className="font-bold text-lg mb-2 flex items-center gap-2">
                  <Box className="w-5 h-5 text-blue-500" />
                  Props Department
                </h4>
                <p className="text-stone-600">
                  Also part of Set Design is our Props team. They source, build, or modify every object actors touch on stage—from period-accurate furniture to magical artifacts.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-stone-900 text-white">
        <div className="max-w-4xl mx-auto text-center px-4">
          <h2 className="text-4xl font-black mb-6 uppercase">Grab a Hammer</h2>
          <p className="text-xl text-stone-400 mb-8">
            Set Design meets every Tuesday and Thursday. Come build something amazing.
          </p>
          <Link to="/about" className="inline-flex items-center gap-2 bg-blue-600 text-white px-8 py-4 rounded-full font-bold text-lg hover:bg-blue-500 transition-colors shadow-lg shadow-blue-900/20">
            Get Involved <ArrowRight className="w-5 h-5" />
          </Link>
        </div>
      </section>
    </div>
  );
}
