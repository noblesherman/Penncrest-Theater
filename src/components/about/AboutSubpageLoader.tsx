/*
Handoff note for Mr. Smith:
- File: `src/components/about/AboutSubpageLoader.tsx`
- What this is: Shared About-section component.
- What it does: Renders/transitions About subpages and shared About UX behavior.
- Connections: Used by About route files and fed by About content utilities.
- Main content type: Shared layout behavior rather than single-page copy.
- Safe edits here: Visual polish and non-breaking text updates.
- Be careful with: Slug/data-shape assumptions reused across multiple About pages.
- Useful context: If multiple About pages glitch together, check this shared layer first.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { useState, useEffect } from 'react';
import { Mic2, VenetianMask, Hammer, Scissors, UserCheck, Loader2 } from 'lucide-react';
import type { AboutPageSlug } from '../../lib/aboutContent';

const getIconForSlug = (slug: AboutPageSlug) => {
  switch (slug) {
    case 'performer':
    case 'musical-theater':
      return <VenetianMask className="w-16 h-16 text-stone-900 drop-shadow-md animate-[pulse_2s_ease-in-out_infinite]" />;
    case 'tech-crew':
    case 'set-design':
      return <Mic2 className="w-16 h-16 text-stone-900 drop-shadow-md animate-[bounce_2s_ease-in-out_infinite]" />;
    case 'stage-crew':
      return <Hammer className="w-16 h-16 text-stone-900 drop-shadow-md animate-[ping_2s_ease-in-out_infinite]" />;
    case 'costume-crew':
      return <Scissors className="w-16 h-16 text-stone-900 drop-shadow-md animate-[spin_3s_linear_infinite]" />;
    case 'about':
      return <UserCheck className="w-16 h-16 text-stone-900 drop-shadow-md animate-pulse" />;
    default:
      return <Loader2 className="w-16 h-16 text-stone-900 drop-shadow-md animate-spin" />;
  }
};

const getMessageForSlug = (slug: AboutPageSlug) => {
  switch (slug) {
    case 'performer':
    case 'musical-theater':
      return 'Raising the curtain...';
    case 'tech-crew':
    case 'set-design':
      return 'Checking the mics and lights...';
    case 'stage-crew':
      return 'Quiet on set, setting the scene...';
    case 'costume-crew':
      return 'Threading the needles...';
    case 'about':
    default:
      return 'Preparing the stage...';
  }
};

export default function AboutSubpageLoader({ slug }: { slug: AboutPageSlug }) {
  const [show, setShow] = useState(false);

  // Slight delay to prevent flashing if it loads very quickly
  useEffect(() => {
    const timer = setTimeout(() => setShow(true), 150);
    return () => clearTimeout(timer);
  }, []);

  if (!show) return null;

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center bg-stone-50 transition-all duration-700 ease-in-out fade-in">
      <div className="relative flex flex-col items-center gap-6">
        <div className="relative grid place-items-center w-32 h-32 rounded-full bg-stone-100 shadow-inner border border-stone-200">
          <div className="absolute inset-0 rounded-full border-t-2 border-stone-800 animate-spin opacity-20"></div>
          {getIconForSlug(slug)}
        </div>
        <div className="flex flex-col items-center gap-2">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-stone-500 animate-pulse">
            {getMessageForSlug(slug)}
          </p>
          <div className="flex gap-1">
            <div className="w-1.5 h-1.5 bg-stone-400 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
            <div className="w-1.5 h-1.5 bg-stone-400 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
            <div className="w-1.5 h-1.5 bg-stone-400 rounded-full animate-bounce"></div>
          </div>
        </div>
      </div>
    </div>
  );
}