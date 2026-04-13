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
    <div className="relative overflow-hidden rounded-2xl border border-stone-200 bg-white px-4 py-3 shadow-sm sm:px-5 sm:py-4">
      <div className="absolute left-0 right-0 top-0 h-0.5 bg-gradient-to-r from-red-700 via-red-600 to-amber-400" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={props.onExit}
            className="inline-flex h-11 items-center justify-center rounded-xl border border-stone-300 bg-white px-4 text-sm font-bold text-stone-700 transition hover:bg-stone-100"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Exit POS
          </button>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-red-600">Penncrest Theater POS</p>
            <p className="truncate text-lg font-black text-stone-900 sm:text-xl" style={{ fontFamily: 'Georgia, serif' }}>
              {props.performanceTitle || 'Select a performance'}
            </p>
            <p className="truncate text-xs text-stone-500">{props.performanceDate || 'No date selected yet'}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold uppercase tracking-[0.12em] text-red-700">
            {props.source === 'DOOR' ? 'Door Sale' : 'Comp Sale'}
          </div>
          <div className="rounded-xl border border-stone-300 bg-stone-50 px-3 py-2 text-right">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">Total</p>
            <p className="text-lg font-black text-stone-900">${(props.totalCents / 100).toFixed(2)}</p>
            <p className="text-xs text-stone-500">
              {props.lineCount} ticket{props.lineCount === 1 ? '' : 's'}
            </p>
          </div>
          <button
            type="button"
            onClick={props.onStartOver}
            className="inline-flex h-11 items-center justify-center rounded-xl border border-stone-300 bg-white px-4 text-sm font-bold text-stone-700 transition hover:bg-stone-100"
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            New Sale
          </button>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs text-stone-500">
        <Ticket className="h-3.5 w-3.5 text-red-600" />
        Fast in-person checkout for box office rushes.
      </div>
    </div>
  );
}
