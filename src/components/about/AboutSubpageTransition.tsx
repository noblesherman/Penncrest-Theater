/*
Handoff note for Mr. Smith:
- File: `src/components/about/AboutSubpageTransition.tsx`
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
import { Mic2, VenetianMask, Hammer, Scissors, UserCheck, Play } from 'lucide-react';
import type { AboutPageSlug } from '../../lib/aboutContent';

const getIconForSlug = (slug: AboutPageSlug) => {
  switch (slug) {
    case 'performer':
    case 'musical-theater':
      return <VenetianMask className="w-20 h-20 icon-shape" />;
    case 'tech-crew':
    case 'set-design':
      return <Mic2 className="w-20 h-20 icon-shape" />;
    case 'stage-crew':
      return <Hammer className="w-20 h-20 icon-shape" />;
    case 'costume-crew':
      return <Scissors className="w-20 h-20 icon-shape" />;
    case 'about':
      return <UserCheck className="w-20 h-20 icon-shape" />;
    default:
      return <Play className="w-20 h-20 icon-shape" />;
  }
};

export default function AboutSubpageTransition({ slug, onComplete }: { slug: AboutPageSlug, onComplete?: () => void }) {
  useEffect(() => {
    // Scroll to the top of the page immediately when the transition starts
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });

    // Notify parent component when the main part of the transition hides the screen
    // so it can safely swap content underneath.
    const timer = setTimeout(() => {
      if (onComplete) onComplete();
    }, 1800);
    return () => clearTimeout(timer);
  }, [slug, onComplete]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none overflow-hidden disney-overlay">
      <style>{`
        .disney-overlay {
          background-color: #1c1917; /* stone-900 */
          animation: overlayFadeOut 2.2s cubic-bezier(0.8, 0, 0.1, 1) forwards;
        }

        .icon-container {
          position: relative;
          color: white;
          animation: iconPop 1.8s cubic-bezier(0.8, 0, 0.1, 1) forwards;
        }

        .icon-shape {
          stroke-dasharray: 100;
          stroke-dashoffset: 100;
          stroke-width: 1.5;
          fill: transparent;
          animation: 
            drawPath 0.8s cubic-bezier(0.4, 0, 0.2, 1) forwards,
            fillWhite 0.3s ease-out 0.8s forwards;
        }

        @keyframes drawPath {
          to {
            stroke-dashoffset: 0;
          }
        }

        @keyframes fillWhite {
          to {
            fill: white;
            stroke: white;
          }
        }

        @keyframes iconPop {
          0% {
            transform: scale(0.8);
            opacity: 0;
          }
          15% {
            transform: scale(1.1);
            opacity: 1;
          }
          30% {
            transform: scale(1);
          }
          65% {
            transform: scale(1);
          }
          85% {
            transform: scale(80); /* Massively scale up to cover the screen in white */
            opacity: 1; 
          }
          100% {
            transform: scale(150);
            opacity: 0;
          }
        }

        @keyframes overlayFadeOut {
          0% {
            background-color: #1c1917;
            opacity: 1;
          }
          75% {
            background-color: #1c1917;
            opacity: 1;
          }
          85% {
            background-color: transparent;
            opacity: 1;
          }
          100% {
            background-color: transparent;
            opacity: 0;
          }
        }
      `}</style>
      
      <div className="icon-container">
        {getIconForSlug(slug)}
      </div>
    </div>
  );
}