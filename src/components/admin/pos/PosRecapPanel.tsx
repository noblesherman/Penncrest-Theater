import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import type { PosSaleRecapSeat } from './types';

type PosRecapPanelProps = {
  open: boolean;
  paymentMethod: 'STRIPE' | 'CASH';
  expectedAmountCents: number;
  seats: PosSaleRecapSeat[];
  secondsLeft: number;
  onClose: () => void;
  onExtend: () => void;
};

export function PosRecapPanel(props: PosRecapPanelProps) {
  return (
    <AnimatePresence>
      {props.open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
        >
          <motion.div
            initial={{ y: 18, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 18, opacity: 0, scale: 0.98 }}
            className="w-full max-w-2xl rounded-3xl border border-slate-700 bg-slate-950 text-slate-100 shadow-2xl"
          >
            <div className="flex items-start justify-between border-b border-slate-800 px-5 py-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-300">Sale Complete</p>
                <h3 className="mt-1 text-2xl font-black">{props.seats.length} ticket{props.seats.length === 1 ? '' : 's'} sold</h3>
                <p className="mt-1 text-sm text-slate-300">
                  {props.paymentMethod === 'CASH' ? 'Cash' : 'Card'} · ${(props.expectedAmountCents / 100).toFixed(2)}
                </p>
              </div>
              <button
                type="button"
                onClick={props.onClose}
                className="rounded-full border border-slate-700 p-1.5 text-slate-300 transition hover:border-slate-500"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-[45vh] overflow-y-auto px-5 py-4">
              <div className="grid gap-2 sm:grid-cols-2">
                {props.seats.map((seat) => (
                  <div key={seat.id} className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2.5">
                    <p className="text-sm font-semibold text-slate-100">
                      {seat.row === 'GA'
                        ? `${seat.sectionName} Ticket ${seat.number}`
                        : `${seat.sectionName} · Row ${seat.row} · Seat ${seat.number}`}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400">{seat.ticketType}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-slate-800 px-5 py-4">
              <p className="text-sm text-slate-300">
                Auto-close in <span className="font-bold text-white">{props.secondsLeft}s</span>
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={props.onExtend}
                  className="rounded-xl border border-slate-600 px-3 py-2 text-xs font-bold text-slate-100 transition hover:border-slate-400"
                >
                  +10s
                </button>
                <button
                  type="button"
                  onClick={props.onClose}
                  className="rounded-xl bg-white px-3 py-2 text-xs font-bold text-slate-900 transition hover:bg-slate-200"
                >
                  Close
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
