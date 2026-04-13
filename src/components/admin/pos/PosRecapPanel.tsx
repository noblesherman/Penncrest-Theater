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
            className="w-full max-w-2xl rounded-3xl border border-stone-200 bg-white text-stone-900 shadow-2xl"
          >
            <div className="flex items-start justify-between border-b border-stone-200 px-5 py-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">Sale Complete</p>
                <h3 className="mt-1 text-2xl font-black" style={{ fontFamily: 'Georgia, serif' }}>
                  {props.seats.length} ticket{props.seats.length === 1 ? '' : 's'} sold
                </h3>
                <p className="mt-1 text-sm text-stone-500">
                  {props.paymentMethod === 'CASH' ? 'Cash' : 'Card'} · ${(props.expectedAmountCents / 100).toFixed(2)}
                </p>
              </div>
              <button
                type="button"
                onClick={props.onClose}
                className="rounded-full border border-stone-300 p-1.5 text-stone-600 transition hover:bg-stone-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-[45vh] overflow-y-auto px-5 py-4">
              <div className="grid gap-2 sm:grid-cols-2">
                {props.seats.map((seat) => (
                  <div key={seat.id} className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5">
                    <p className="text-sm font-semibold text-stone-900">
                      {seat.row === 'GA'
                        ? `${seat.sectionName} Ticket ${seat.number}`
                        : `${seat.sectionName} · Row ${seat.row} · Seat ${seat.number}`}
                    </p>
                    <p className="mt-0.5 text-xs text-stone-500">{seat.ticketType}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-stone-200 px-5 py-4">
              <p className="text-sm text-stone-600">
                Auto-close in <span className="font-bold text-stone-900">{props.secondsLeft}s</span>
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={props.onExtend}
                  className="rounded-xl border border-stone-300 px-3 py-2 text-xs font-bold text-stone-700 transition hover:bg-stone-100"
                >
                  +10s
                </button>
                <button
                  type="button"
                  onClick={props.onClose}
                  className="rounded-xl bg-red-700 px-3 py-2 text-xs font-bold text-white transition hover:bg-red-800"
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
