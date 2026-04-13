import { Trash2, X } from 'lucide-react';
import type { PosSelectionLine, PosTicketOption } from './types';

type PosSelectedLinesPanelProps = {
  lines: PosSelectionLine[];
  seatSelectionEnabled: boolean;
  ticketOptions: PosTicketOption[];
  ticketSelectionByLineId: Record<string, string>;
  onTicketChange: (lineId: string, ticketTypeId: string) => void;
  onRemoveLine: (lineId: string) => void;
  onClearAll: () => void;
  missingTicketTypeCount: number;
  formatTicketOptionLabel: (tier: PosTicketOption) => string;
};

export function PosSelectedLinesPanel(props: PosSelectedLinesPanelProps) {
  return (
    <div className="min-h-0 rounded-2xl border border-slate-700 bg-slate-900/70">
      <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Selected Lines</p>
          <p className="text-sm font-semibold text-slate-200">
            {props.lines.length} {props.seatSelectionEnabled ? 'seat' : 'ticket'}{props.lines.length === 1 ? '' : 's'} in cart
          </p>
        </div>
        <button
          type="button"
          onClick={props.onClearAll}
          disabled={!props.lines.length}
          className="inline-flex items-center gap-1 rounded-xl border border-slate-600 px-3 py-2 text-xs font-bold text-slate-200 transition hover:border-red-400 hover:text-red-200 disabled:opacity-40"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Clear
        </button>
      </div>

      {props.missingTicketTypeCount > 0 && (
        <div className="border-b border-amber-400/30 bg-amber-500/10 px-4 py-2 text-xs font-semibold text-amber-100">
          {props.missingTicketTypeCount} line{props.missingTicketTypeCount === 1 ? '' : 's'} still missing a ticket type.
        </div>
      )}

      <div className="max-h-[38vh] overflow-y-auto">
        {!props.lines.length ? (
          <div className="px-4 py-6 text-sm text-slate-500">No selections yet. Add seats or GA tickets to start this sale.</div>
        ) : (
          <div className="divide-y divide-slate-800">
            {props.lines.map((line) => (
              <div key={line.id} className="px-4 py-3">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-100">{line.label}</p>
                    <p className="text-xs text-slate-500">{line.id}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => props.onRemoveLine(line.id)}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-700 text-slate-300 transition hover:border-red-400 hover:text-red-200"
                    aria-label={`Remove ${line.label}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <select
                  value={props.ticketSelectionByLineId[line.id] || ''}
                  onChange={(event) => props.onTicketChange(line.id, event.target.value)}
                  className="w-full rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-rose-400 focus:outline-none"
                >
                  <option value="">Select ticket type</option>
                  {props.ticketOptions.map((tier) => (
                    <option key={tier.id} value={tier.id}>
                      {props.formatTicketOptionLabel(tier)}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
