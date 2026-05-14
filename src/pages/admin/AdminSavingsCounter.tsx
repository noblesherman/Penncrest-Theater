import { useEffect, useRef, useState } from 'react';
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

    const from = lastTargetRef.current ?? target;
    if (from === target || prefersReducedMotion) {
      setDisplayCents(target);
      lastTargetRef.current = target;
      return;
    }

    const durationMs = 800;
    const start = performance.now();
    let rafId = 0;

    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = Math.round(from + (target - from) * eased);
      setDisplayCents(value);
      if (progress < 1) {
        rafId = window.requestAnimationFrame(tick);
      } else {
        lastTargetRef.current = target;
      }
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [prefersReducedMotion, summary?.estimatedSavedCents]);

  if (!summary) {
    return null;
  }

  return (
    <div
      className="mb-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2"
      title={`Low ${moneyFormatter.format(summary.lowEstimateCents / 100)} · High ${moneyFormatter.format(summary.highEstimateCents / 100)}`}
    >
      <p className="text-[10px] leading-tight text-zinc-400">This incredible system</p>
      <p className="mt-0.5 text-[10px] leading-tight text-zinc-500">has saved</p>
      <p className="mt-1 text-sm font-bold leading-none text-emerald-300 tabular-nums">
        {moneyFormatter.format(displayCents / 100)}
      </p>
    </div>
  );
}
