/*
Handoff note for Mr. Smith:
- File: `src/components/BoxFiveNotice.tsx`
- What this is: Shared web component.
- What it does: Shows a one-time-per-visit lightbox telling visitors that tickets are sold through Box Five, with the Box Five ticket embed inside.
- Connections: Rendered by `src/components/Layout.tsx`, so it only appears on public pages (not admin).
- Main content type: Visible microcopy plus the Box Five embed.
- Safe edits here: Copy and styling tweaks.
- Be careful with: The embed script only scans the page once when it loads, so it is re-added each time the lightbox opens.
- Useful context: The Box Five script/iframe domains must stay allowed in the CSP in `vercel.json`.
- Practical note: Bump `BOX_FIVE_NOTICE_SEEN_KEY` if you want everyone to see the notice again.
*/

import { useEffect, useRef, useState } from 'react';
import { ExternalLink, X } from 'lucide-react';

const BOX_FIVE_NOTICE_SEEN_KEY = 'theater_box_five_notice_seen_v1';
const BOX_FIVE_EMBED_SRC = 'https://boxfiveapp.com/embed.js';
const BOX_FIVE_ORGANIZATION = 'penncrest-high-school-theater';
const BOX_FIVE_URL = `https://${BOX_FIVE_ORGANIZATION}.boxfiveapp.com`;

export default function BoxFiveNotice() {
  const [isOpen, setIsOpen] = useState(() => {
    if (typeof window === 'undefined') return false;

    try {
      return sessionStorage.getItem(BOX_FIVE_NOTICE_SEEN_KEY) !== '1';
    } catch {
      return true;
    }
  });
  const embedRef = useRef<HTMLDivElement>(null);

  const close = () => {
    setIsOpen(false);
    try {
      sessionStorage.setItem(BOX_FIVE_NOTICE_SEEN_KEY, '1');
    } catch {
      // Ignore storage issues; the notice may show again next page load.
    }
  };

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    // The Box Five script mounts any [data-box-five] node present when it runs,
    // so load it after the embed container is in the DOM.
    const script = document.createElement('script');
    script.src = BOX_FIVE_EMBED_SRC;
    script.async = true;
    embedRef.current?.appendChild(script);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      script.remove();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="box-five-notice-title"
      onClick={close}
    >
      <div
        className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-[28px] border border-white/10 bg-white shadow-2xl shadow-black/40"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={close}
          className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-stone-900/85 text-stone-200 transition-colors hover:bg-red-700 hover:text-white"
          aria-label="Close ticketing notice"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="border-b border-stone-800 bg-gradient-to-r from-stone-950 via-stone-900 to-stone-950 px-5 py-5 pr-16 sm:px-7">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-400">
            Tickets have moved
          </p>
          <h2
            id="box-five-notice-title"
            className="mt-2 text-2xl font-bold text-white sm:text-3xl"
            style={{ fontFamily: 'Georgia, serif' }}
          >
            We're using Box Five for tickets
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-stone-400">
            Feel free to explore our site, but if you'd like to buy tickets, please visit{' '}
            <a
              href={BOX_FIVE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-amber-400 underline-offset-2 hover:underline"
            >
              Box Five
            </a>{' '}
            or get them right here.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-3 sm:p-4">
          <div ref={embedRef}>
            <div data-box-five data-organization={BOX_FIVE_ORGANIZATION} />
          </div>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-stone-100 px-5 py-4 sm:flex-row sm:justify-end sm:px-7">
          <button
            type="button"
            onClick={close}
            className="rounded-full px-5 py-2 text-sm font-semibold text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900"
          >
            Continue to site
          </button>
          <a
            href={BOX_FIVE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-1.5 rounded-full bg-red-700 px-5 py-2 text-sm font-semibold text-white shadow-sm shadow-red-200 transition-colors hover:bg-red-800"
          >
            Go to Box Five
            <ExternalLink className="h-4 w-4" />
          </a>
        </div>
      </div>
    </div>
  );
}
