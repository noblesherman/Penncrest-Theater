import type { PosPerformanceOption } from './types';

type PosPerformanceSelectorProps = {
  performances: PosPerformanceOption[];
  value: string;
  onChange: (performanceId: string) => void;
};

export function PosPerformanceSelector(props: PosPerformanceSelectorProps) {
  return (
    <div className="space-y-3">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Performance</p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {props.performances.map((performance) => {
          const selected = performance.id === props.value;
          return (
            <button
              key={performance.id}
              type="button"
              onClick={() => props.onChange(performance.id)}
              className={[
                'rounded-2xl border p-4 text-left transition',
                selected
                  ? 'border-rose-400 bg-rose-500/15 shadow-lg shadow-rose-900/20'
                  : 'border-slate-700 bg-slate-900/80 hover:border-slate-500 hover:bg-slate-900'
              ].join(' ')}
            >
              <p className={`text-base font-bold ${selected ? 'text-rose-100' : 'text-slate-100'}`}>{performance.title}</p>
              <p className={`mt-1 text-xs ${selected ? 'text-rose-200/90' : 'text-slate-400'}`}>
                {new Date(performance.startsAt).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric'
                })}
              </p>
              {performance.isFundraiser && (
                <span className="mt-2 inline-flex rounded-full border border-amber-400/50 bg-amber-500/15 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-amber-200">
                  Fundraiser
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
