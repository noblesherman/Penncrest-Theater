import type { PosTicketOption } from './types';

type PosTicketGridProps = {
  title?: string;
  options: PosTicketOption[];
  onApplyToAll: (ticketTypeId: string) => void;
  selectedOptionId?: string | null;
  formatLabel: (option: PosTicketOption) => string;
};

export function PosTicketGrid(props: PosTicketGridProps) {
  if (!props.options.length) {
    return (
      <div className="rounded-2xl border border-amber-400/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
        No pricing tiers are configured for this performance.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">{props.title || 'Ticket Quick Actions'}</p>
        <p className="text-xs text-slate-500">Tap once to apply to all selected lines</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {props.options.map((option) => {
          const selected = option.id === props.selectedOptionId;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => props.onApplyToAll(option.id)}
              className={[
                'min-h-[92px] rounded-2xl border px-4 py-3 text-left transition',
                selected
                  ? 'border-rose-300 bg-rose-500/20 shadow-lg shadow-rose-900/25'
                  : 'border-slate-700 bg-slate-900/80 hover:border-slate-500 hover:bg-slate-900'
              ].join(' ')}
            >
              <p className={`text-sm font-bold ${selected ? 'text-rose-100' : 'text-slate-100'}`}>{option.name}</p>
              <p className={`mt-2 text-xs leading-5 ${selected ? 'text-rose-200/90' : 'text-slate-400'}`}>{props.formatLabel(option)}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
