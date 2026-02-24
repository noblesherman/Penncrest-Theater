import { motion } from 'motion/react';
import { Users, Heart, Coffee, Gift, Calendar, ArrowRight, Mail } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function ParentsAssociation() {
  return (
    <div className="bg-green-50 min-h-screen font-sans text-stone-900">
      {/* Hero Section */}
      <section className="relative py-24 overflow-hidden bg-green-600 text-white">
        <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/diagmonds-light.png')]"></div>
        <div className="absolute inset-0 bg-gradient-to-br from-green-500 to-emerald-700 opacity-90"></div>
        
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
          >
            <div className="inline-block bg-white/20 text-white px-4 py-1.5 rounded-full text-sm font-bold uppercase tracking-wider mb-6 border border-white/30 backdrop-blur-sm">
              Supporting Our Stars
            </div>
            <h1 className="text-5xl md:text-7xl font-black font-display mb-6 tracking-tighter uppercase drop-shadow-lg">
              Parents Association
            </h1>
            <p className="text-xl text-green-100 max-w-3xl mx-auto leading-relaxed font-medium">
              We are the team behind the team. From fundraising to feeding the cast, we ensure the show goes on.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Mission Section */}
      <section className="py-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl font-black mb-8 uppercase text-stone-900">Our Mission</h2>
          <p className="text-xl text-stone-600 leading-relaxed">
            The Penncrest Theater Parents Association (PTPA) is dedicated to supporting the students and staff of the theater department. We provide volunteer support, financial assistance, and community engagement to ensure every production is a success.
          </p>
        </div>
      </section>

      {/* What We Do Grid */}
      <section className="py-20 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
            {[
              { title: 'Fundraising', icon: <Gift className="w-10 h-10" />, desc: 'We organize events and sales to fund scholarships, equipment upgrades, and production costs.', color: 'bg-green-100 text-green-600' },
              { title: 'Hospitality', icon: <Coffee className="w-10 h-10" />, desc: 'Tech week dinners, cast parties, and concession stands. We keep the cast and crew fueled.', color: 'bg-orange-100 text-orange-600' },
              { title: 'Volunteering', icon: <Users className="w-10 h-10" />, desc: 'Ushers, ticket sales, costume help, and set construction. Many hands make light work.', color: 'bg-blue-100 text-blue-600' },
            ].map((item, i) => (
              <motion.div 
                key={i}
                whileHover={{ y: -10 }}
                className="bg-stone-50 p-8 rounded-3xl border border-stone-100 text-center group hover:shadow-xl transition-all duration-300"
              >
                <div className={`w-20 h-20 mx-auto rounded-full ${item.color} flex items-center justify-center mb-6 group-hover:scale-110 transition-transform`}>
                  {item.icon}
                </div>
                <h3 className="text-2xl font-black mb-4 uppercase">{item.title}</h3>
                <p className="text-stone-600 leading-relaxed">{item.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Meeting Schedule */}
      <section className="py-20 bg-stone-100">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-white rounded-3xl p-8 md:p-12 shadow-lg border border-stone-200 flex flex-col md:flex-row items-center gap-12">
            <div className="flex-1">
              <h2 className="text-3xl font-black mb-6 uppercase flex items-center gap-3">
                <Calendar className="w-8 h-8 text-green-600" />
                Monthly Meetings
              </h2>
              <p className="text-lg text-stone-600 mb-6">
                We meet on the first Tuesday of every month at 7:00 PM in the High School Library. All parents are welcome and encouraged to attend!
              </p>
              <ul className="space-y-3 text-stone-600 font-medium">
                <li className="flex items-center gap-2"><div className="w-2 h-2 bg-green-500 rounded-full"></div> September 5th</li>
                <li className="flex items-center gap-2"><div className="w-2 h-2 bg-green-500 rounded-full"></div> October 3rd</li>
                <li className="flex items-center gap-2"><div className="w-2 h-2 bg-green-500 rounded-full"></div> November 7th</li>
                <li className="flex items-center gap-2"><div className="w-2 h-2 bg-green-500 rounded-full"></div> December 5th</li>
              </ul>
            </div>
            <div className="flex-1 relative">
               <div className="aspect-square bg-green-100 rounded-full flex items-center justify-center relative z-10">
                 <Heart className="w-32 h-32 text-green-500 animate-pulse" />
               </div>
               <div className="absolute inset-0 bg-green-200 rounded-full blur-3xl opacity-50"></div>
            </div>
          </div>
        </div>
      </section>

      {/* Contact / Join */}
      <section className="py-20 bg-stone-900 text-white">
        <div className="max-w-4xl mx-auto text-center px-4">
          <h2 className="text-4xl font-black mb-6 uppercase">Join the Family</h2>
          <p className="text-xl text-stone-400 mb-8">
            Your involvement makes a difference. Sign up for our newsletter to stay in the loop.
          </p>
          <div className="flex flex-col sm:flex-row justify-center gap-4">
            <a href="mailto:parents@penncresttheater.org" className="inline-flex items-center justify-center gap-2 bg-green-600 text-white px-8 py-4 rounded-full font-bold text-lg hover:bg-green-500 transition-colors shadow-lg shadow-green-900/20">
              <Mail className="w-5 h-5" /> Email Us
            </a>
            <Link to="/about" className="inline-flex items-center justify-center gap-2 bg-white text-stone-900 px-8 py-4 rounded-full font-bold text-lg hover:bg-stone-200 transition-colors">
              Back to About <ArrowRight className="w-5 h-5" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
