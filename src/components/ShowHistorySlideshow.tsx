import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const HISTORY_ITEMS = [
  { year: '2024', title: 'Suessical', image: 'https://picsum.photos/seed/beauty/800/600', description: 'Suess!' },
  { year: '2023', title: 'Cinderella', image: 'https://picsum.photos/seed/cinderella/800/600', description: 'Impossible things are happening every day.' },
  { year: '2022', title: 'Phantom of the Opera', image: 'https://picsum.photos/seed/phantom/800/600', description: 'The music of the night.' },
  { year: '2021', title: 'Newies', image: 'https://picsum.photos/seed/mamma/800/600', description: 'A pair of new shoes with matching laces.' },
  { year: '2019', title: 'Les Misérables', image: 'https://picsum.photos/seed/lesmis/800/600', description: 'In our dreams...' },
  { year: '2018', title: 'Some other show', image: 'https://picsum.photos/seed/grease/800/600', description: 'probobly another show' },
];

export default function ShowHistorySlideshow() {
  const [currentIndex, setCurrentIndex] = useState(0);

  const nextSlide = () => {
    setCurrentIndex((prev) => (prev + 1) % HISTORY_ITEMS.length);
  };

  const prevSlide = () => {
    setCurrentIndex((prev) => (prev - 1 + HISTORY_ITEMS.length) % HISTORY_ITEMS.length);
  };

  // Auto-advance
  useEffect(() => {
    const timer = setInterval(nextSlide, 5000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="group relative mx-auto w-full max-w-5xl overflow-hidden rounded-3xl bg-stone-900 shadow-2xl aspect-[5/4] sm:aspect-[16/9] md:aspect-[21/9]">
      <AnimatePresence mode="wait">
        <motion.div
          key={currentIndex}
          initial={{ opacity: 0, scale: 1.1 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.7 }}
          className="absolute inset-0"
        >
          <img 
            src={HISTORY_ITEMS[currentIndex].image} 
            alt={HISTORY_ITEMS[currentIndex].title} 
            className="w-full h-full object-cover opacity-60"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-stone-900 via-transparent to-transparent"></div>
          
          <div className="absolute bottom-0 left-0 w-full p-5 sm:p-8 md:p-12">
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.3 }}
            >
              <div className="mb-1 text-sm font-mono text-yellow-400 sm:mb-2 sm:text-xl">{HISTORY_ITEMS[currentIndex].year}</div>
              <h3 className="mb-1 text-2xl font-black uppercase text-white sm:mb-2 sm:text-4xl md:text-6xl">{HISTORY_ITEMS[currentIndex].title}</h3>
              <p className="text-sm text-stone-300 sm:text-lg md:text-xl">{HISTORY_ITEMS[currentIndex].description}</p>
            </motion.div>
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Controls */}
      <button 
        onClick={prevSlide}
        className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-white/20 p-2 text-white backdrop-blur-sm transition-all hover:bg-white/30 sm:left-4 sm:p-3 sm:bg-white/10 sm:opacity-0 sm:group-hover:opacity-100"
      >
        <ChevronLeft className="h-6 w-6 sm:h-8 sm:w-8" />
      </button>
      <button 
        onClick={nextSlide}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-white/20 p-2 text-white backdrop-blur-sm transition-all hover:bg-white/30 sm:right-4 sm:p-3 sm:bg-white/10 sm:opacity-0 sm:group-hover:opacity-100"
      >
        <ChevronRight className="h-6 w-6 sm:h-8 sm:w-8" />
      </button>

      {/* Indicators */}
      <div className="absolute bottom-4 right-4 flex gap-2 sm:bottom-6 sm:right-8">
        {HISTORY_ITEMS.map((_, index) => (
          <button
            key={index}
            onClick={() => setCurrentIndex(index)}
            className={`w-2 h-2 rounded-full transition-all ${index === currentIndex ? 'bg-yellow-400 w-8' : 'bg-white/30 hover:bg-white/50'}`}
          />
        ))}
      </div>
    </div>
  );
}
