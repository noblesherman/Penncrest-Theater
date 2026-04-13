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
    <div className="min-h-0 rounded-2xl border border-stone-200 bg-white">
      <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-red-600">Step 2 · Ticket Types</p>
          <p className="text-sm font-semibold text-stone-700">
            {props.lines.length} {props.seatSelectionEnabled ? 'seat' : 'ticket'}{props.lines.length === 1 ? '' : 's'} in cart
          </p>
        </div>
        <button
          type="button"
          onClick={props.onClearAll}
          disabled={!props.lines.length}
          className="inline-flex items-center gap-1 rounded-xl border border-stone-300 px-3 py-2 text-xs font-bold text-stone-700 transition hover:bg-stone-100 hover:text-red-700 disabled:opacity-40"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Clear
        </button>
      </div>

      {props.missingTicketTypeCount > 0 && (
        <div className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-900">
          {props.missingTicketTypeCount} line{props.missingTicketTypeCount === 1 ? '' : 's'} still missing a ticket type.
        </div>
      )}

      <div className="max-h-[38vh] overflow-y-auto">
        {!props.lines.length ? (
          <div className="px-4 py-6 text-sm text-stone-500">No selections yet. Add seats or GA tickets to start this sale.</div>
        ) : (
          <div className="divide-y divide-stone-100">
            {props.lines.map((line) => (
              <div key={line.id} className="px-4 py-3">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-stone-900">{line.label}</p>
                    <p className="text-xs text-stone-500">{line.id}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => props.onRemoveLine(line.id)}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-stone-200 text-stone-600 transition hover:border-red-200 hover:text-red-700"
                    aria-label={`Remove ${line.label}`}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <select
                  value={props.ticketSelectionByLineId[line.id] || ''}
                  onChange={(event) => props.onTicketChange(line.id, event.target.value)}
                  className="w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-100"
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
