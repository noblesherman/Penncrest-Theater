import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { adminFetch } from '../../lib/adminAuth';

type SavingsSummaryResponse = {
  allTimeRevenueCents: number;
  paidTransactionCount: number;
  estimatedSavedCents: number;
  lowEstimateCents: number;
  highEstimateCents: number;
  updatedAt: string;
};

const moneyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0
});

export default function AdminSavingsCounter() {
  const [summary, setSummary] = useState<SavingsSummaryResponse | null>(null);
  const [displayCents, setDisplayCents] = useState(0);
  const [previousCents, setPreviousCents] = useState<number | null>(null);
  const [isFlipping, setIsFlipping] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const lastTargetRef = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setPrefersReducedMotion(media.matches);
    sync();

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', sync);
      return () => media.removeEventListener('change', sync);
    }

    media.addListener(sync);
    return () => media.removeListener(sync);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let cancelled = false;
    const desktopMedia = window.matchMedia('(min-width: 768px)');

    const fetchSummary = async () => {
      if (!desktopMedia.matches || document.visibilityState === 'hidden') return;
      try {
        const next = await adminFetch<SavingsSummaryResponse>('/api/admin/financial/savings-summary');
        if (!cancelled) {
          setSummary(next);
        }
      } catch {
        if (!cancelled) {
          setSummary(null);
        }
      }
    };

    void fetchSummary();
    const intervalId = window.setInterval(() => {
      void fetchSummary();
    }, 60_000);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void fetchSummary();
      }
    };
    const handleDesktopMediaChange = () => {
      if (desktopMedia.matches) {
        void fetchSummary();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    if (typeof desktopMedia.addEventListener === 'function') {
      desktopMedia.addEventListener('change', handleDesktopMediaChange);
    } else {
      desktopMedia.addListener(handleDesktopMediaChange);
    }

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibility);
      if (typeof desktopMedia.removeEventListener === 'function') {
        desktopMedia.removeEventListener('change', handleDesktopMediaChange);
      } else {
        desktopMedia.removeListener(handleDesktopMediaChange);
      }
    };
  }, []);

  useEffect(() => {
    const target = summary?.estimatedSavedCents;
    if (target === undefined) return;

    const previous = lastTargetRef.current;
    if (previous === null || previous === target || prefersReducedMotion) {
      setDisplayCents(target);
      lastTargetRef.current = target;
      setIsFlipping(false);
      return;
    }

    setPreviousCents(previous);
    setDisplayCents(target);
    setIsFlipping(true);
    lastTargetRef.current = target;

    const timer = window.setTimeout(() => {
      setIsFlipping(false);
    }, 820);
    return () => window.clearTimeout(timer);
  }, [prefersReducedMotion, summary?.estimatedSavedCents]);

  if (!summary) {
    return null;
  }

  const currentAmount = moneyFormatter.format(displayCents / 100);
  const previousAmount = previousCents === null ? currentAmount : moneyFormatter.format(previousCents / 100);

  return (
    <div
      className="mb-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-2.5 py-2"
      title={`Low ${moneyFormatter.format(summary.lowEstimateCents / 100)} · High ${moneyFormatter.format(summary.highEstimateCents / 100)}`}
    >
      <p className="text-[9px] leading-tight text-zinc-400">This beautiful app has saved</p>
      <p className="mt-0.5 text-[9px] leading-tight text-zinc-300">Penncrest Theater</p>
      <p className="mt-0.5 text-[9px] leading-tight text-zinc-500">from the greedy OTS</p>

      <div className="relative mt-1.5 overflow-hidden rounded-lg border border-white/10 bg-[#07090d] [perspective:900px]">
        <div className="absolute inset-x-0 top-1/2 h-px bg-white/15" />
        <div className="px-2 py-2 text-center text-sm font-black tracking-[0.02em] text-zinc-100 tabular-nums">
          {currentAmount}
        </div>

        <AnimatePresence initial={false}>
          {isFlipping ? (
            <>
              <motion.div
                key={`${previousAmount}-top`}
                initial={{ rotateX: 0, opacity: 1 }}
                animate={{ rotateX: -90, opacity: 0.15 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
                style={{ transformOrigin: 'bottom center' }}
                className="pointer-events-none absolute inset-x-0 top-0 h-1/2 overflow-hidden bg-[#0b0f16]"
              >
                <div className="flex h-full items-center justify-center pt-2 text-sm font-black tracking-[0.02em] text-zinc-200 tabular-nums">
                  {previousAmount}
                </div>
              </motion.div>

              <motion.div
                key={`${currentAmount}-bottom`}
                initial={{ rotateX: 90, opacity: 0.4 }}
                animate={{ rotateX: 0, opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1], delay: 0.16 }}
                style={{ transformOrigin: 'top center' }}
                className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 overflow-hidden bg-[#0b0f16]"
              >
                <div className="flex h-full items-center justify-center -translate-y-[50%] text-sm font-black tracking-[0.02em] text-zinc-100 tabular-nums">
                  {currentAmount}
                </div>
              </motion.div>
            </>
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
}
