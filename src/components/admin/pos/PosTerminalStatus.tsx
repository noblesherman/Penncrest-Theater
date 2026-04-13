import { AlertCircle, CheckCircle2, Clock3, RefreshCw, XCircle } from 'lucide-react';
import type { PosTerminalDispatch } from './types';

type PosTerminalStatusProps = {
  dispatch: PosTerminalDispatch;
  inlineTitle: string;
  inlineDetail: string;
  tone: 'danger' | 'success' | 'neutral';
  streamConnected: boolean;
  actionBusy: boolean;
  onRetry: () => void;
  onCancel: () => void;
  onAcknowledgeSuccess: () => void;
  onClose: () => void;
};

export function PosTerminalStatus(props: PosTerminalStatusProps) {
  const toneClasses =
    props.tone === 'success'
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : props.tone === 'danger'
        ? 'border-red-200 bg-red-50 text-red-700'
        : 'border-stone-200 bg-stone-50 text-stone-700';

  const isFinal = ['FAILED', 'SUCCEEDED', 'EXPIRED', 'CANCELED'].includes(props.dispatch.status);

  return (
    <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-red-600">Terminal Dispatch</p>
          <p className="text-base font-bold text-stone-900">{props.dispatch.targetDeviceName || props.dispatch.targetDeviceId}</p>
          <p className="text-xs text-stone-500">
            ${((props.dispatch.expectedAmountCents || 0) / 100).toFixed(2)} · Attempt {props.dispatch.attemptCount}
          </p>
          <p className="mt-1 text-[11px] font-semibold text-stone-500">
            Live updates: {props.streamConnected ? 'connected' : 'reconnecting with polling'}
          </p>
        </div>
        {props.dispatch.status === 'SUCCEEDED' ? (
          <CheckCircle2 className="h-6 w-6 text-emerald-300" />
        ) : props.dispatch.status === 'FAILED' || props.dispatch.status === 'EXPIRED' ? (
          <XCircle className="h-6 w-6 text-red-300" />
        ) : (
          <Clock3 className="h-6 w-6 text-amber-200" />
        )}
      </div>

      <div className={`mt-3 rounded-xl border px-3 py-2.5 ${toneClasses}`}>
        <p className="text-[11px] font-bold uppercase tracking-[0.12em]">Checkout status</p>
        <p className="mt-1 text-sm font-bold">{props.inlineTitle}</p>
        <p className="mt-1 text-xs">{props.inlineDetail}</p>
      </div>

      {props.dispatch.failureReason && (
        <div className="mt-3 inline-flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
          {props.dispatch.failureReason}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {props.dispatch.status === 'FAILED' && props.dispatch.canRetry && (
          <button
            type="button"
            onClick={props.onRetry}
            disabled={props.actionBusy}
            className="inline-flex items-center gap-1 rounded-xl border border-stone-300 px-3 py-2 text-xs font-bold text-stone-700 transition hover:bg-stone-100 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${props.actionBusy ? 'animate-spin' : ''}`} /> Retry
          </button>
        )}

        {props.dispatch.status === 'SUCCEEDED' ? (
          <button
            type="button"
            onClick={props.onAcknowledgeSuccess}
            className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-emerald-700"
          >
            Continue
          </button>
        ) : (
          <>
            {!isFinal && (
              <button
                type="button"
                onClick={props.onCancel}
                disabled={props.actionBusy}
                className="inline-flex items-center gap-1 rounded-xl border border-stone-300 px-3 py-2 text-xs font-bold text-stone-700 transition hover:bg-stone-100 disabled:opacity-50"
              >
                Cancel Sale
              </button>
            )}
            {isFinal && (
              <button
                type="button"
                onClick={props.onClose}
                className="inline-flex items-center gap-1 rounded-xl border border-stone-300 px-3 py-2 text-xs font-bold text-stone-700 transition hover:bg-stone-100"
              >
                Close
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
