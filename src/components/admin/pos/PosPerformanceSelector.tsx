import type { PosPerformanceOption } from './types';

type PosPerformanceSelectorProps = {
  performances: PosPerformanceOption[];
  value: string;
  onChange: (performanceId: string) => void;
};

export function PosPerformanceSelector(props: PosPerformanceSelectorProps) {
  return (
    <div className="space-y-3">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-red-600">Performance</p>
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
                  ? 'border-red-200 bg-red-50 shadow-sm'
                  : 'border-stone-200 bg-white hover:border-red-200 hover:bg-red-50/40'
              ].join(' ')}
            >
              <p className={`text-base font-bold ${selected ? 'text-red-800' : 'text-stone-900'}`}>{performance.title}</p>
              <p className={`mt-1 text-xs ${selected ? 'text-red-700' : 'text-stone-500'}`}>
                {new Date(performance.startsAt).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric'
                })}
              </p>
              {performance.isFundraiser && (
                <span className="mt-2 inline-flex rounded-full border border-amber-300 bg-amber-50 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-amber-800">
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
