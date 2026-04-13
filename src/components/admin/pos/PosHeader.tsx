import { ArrowLeft, RotateCcw, Ticket } from 'lucide-react';

type PosHeaderProps = {
  performanceTitle: string;
  performanceDate: string;
  source: 'DOOR' | 'COMP';
  lineCount: number;
  totalCents: number;
  onExit: () => void;
  onStartOver: () => void;
};

export function PosHeader(props: PosHeaderProps) {
  return (
    <div className="rounded-3xl border border-slate-700/70 bg-slate-950/80 px-4 py-3 shadow-xl ring-1 ring-white/5 sm:px-5 sm:py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={props.onExit}
            className="inline-flex h-11 items-center justify-center rounded-2xl border border-slate-600 bg-slate-900 px-4 text-sm font-bold text-slate-100 transition hover:border-slate-500 hover:bg-slate-800"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Exit POS
          </button>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-rose-300">Penncrest Theater POS</p>
            <p className="truncate text-lg font-black text-white sm:text-xl">{props.performanceTitle || 'Select a performance'}</p>
            <p className="truncate text-xs text-slate-400">{props.performanceDate || 'No date selected yet'}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="rounded-2xl border border-rose-500/40 bg-rose-500/15 px-3 py-2 text-xs font-bold uppercase tracking-[0.12em] text-rose-200">
            {props.source === 'DOOR' ? 'Door Sale' : 'Comp Sale'}
          </div>
          <div className="rounded-2xl border border-slate-600 bg-slate-900 px-3 py-2 text-right">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Total</p>
            <p className="text-lg font-black text-white">${(props.totalCents / 100).toFixed(2)}</p>
            <p className="text-xs text-slate-400">
              {props.lineCount} ticket{props.lineCount === 1 ? '' : 's'}
            </p>
          </div>
          <button
            type="button"
            onClick={props.onStartOver}
            className="inline-flex h-11 items-center justify-center rounded-2xl border border-slate-600 bg-slate-900 px-4 text-sm font-bold text-slate-100 transition hover:border-slate-500 hover:bg-slate-800"
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            New Sale
          </button>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs text-slate-300">
        <Ticket className="h-3.5 w-3.5 text-rose-300" />
        Fast in-person checkout for box office rushes.
      </div>
    </div>
  );
}
