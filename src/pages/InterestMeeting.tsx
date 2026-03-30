import { motion } from 'motion/react';
import { Calendar, MapPin, Clock, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function InterestMeeting() {
  return (
    <div className="bg-stone-50 min-h-screen font-sans text-stone-900">
      {/* Hero Section */}
      <section className="relative overflow-hidden bg-yellow-400 py-14 sm:py-20">
        <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/stardust.png')]"></div>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
          >
            <h1 className="mb-5 text-3xl font-black uppercase tracking-tight font-display sm:text-4xl md:mb-6 md:text-6xl">
              Interest Meeting
            </h1>
            <p className="mx-auto max-w-3xl text-base font-bold leading-relaxed text-stone-800 sm:text-xl">
              Join us to learn about the upcoming season!
            </p>
          </motion.div>
        </div>
      </section>

      {/* Details Section */}
      <section className="py-12 sm:py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="space-y-8 rounded-3xl border border-stone-100 bg-white p-5 shadow-xl sm:p-8 md:p-12">
            <div className="flex flex-col md:flex-row gap-8 items-start">
              <div className="flex-1 space-y-6">
                <h2 className="text-2xl font-black uppercase text-stone-900 sm:text-3xl">Event Details</h2>
                
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center text-yellow-600">
                      <Calendar className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-sm text-stone-500 font-bold uppercase tracking-wider">Date</p>
                      <p className="text-base font-bold text-stone-900 sm:text-lg">September 24, 2025</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center text-yellow-600">
                      <Clock className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-sm text-stone-500 font-bold uppercase tracking-wider">Time</p>
                      <p className="text-base font-bold text-stone-900 sm:text-lg">3:00 PM - 4:30 PM</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-yellow-100 rounded-full flex items-center justify-center text-yellow-600">
                      <MapPin className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-sm text-stone-500 font-bold uppercase tracking-wider">Location</p>
                      <p className="text-base font-bold text-stone-900 sm:text-lg">High School Auditorium</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex-1 bg-stone-50 p-6 rounded-2xl border border-stone-200">
                <h3 className="text-xl font-black uppercase mb-4">What to Expect</h3>
                <ul className="space-y-3 text-stone-600">
                  <li className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 bg-yellow-500 rounded-full mt-2.5"></div>
                    <span>Meet the Director and Staff</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 bg-yellow-500 rounded-full mt-2.5"></div>
                    <span>Learn about the Fall Play and Spring Musical</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 bg-yellow-500 rounded-full mt-2.5"></div>
                    <span>Sign up for Tech Crew and Set Design</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <div className="w-1.5 h-1.5 bg-yellow-500 rounded-full mt-2.5"></div>
                    <span>Audition information and materials</span>
                  </li>
                </ul>
              </div>
            </div>

            <div className="pt-8 border-t border-stone-100 text-center">
              <p className="mb-6 text-base text-stone-600 sm:text-lg">
                Can't make it? Don't worry! All information will be posted here after the meeting.
              </p>
              <Link 
                to="/contact" 
                className="inline-flex items-center gap-2 bg-stone-900 text-white px-8 py-3 rounded-full font-bold hover:bg-stone-800 transition-colors"
              >
                Contact Us for Info <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
