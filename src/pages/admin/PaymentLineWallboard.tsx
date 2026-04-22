/*
Handoff note for Mr. Smith:
- File: `src/pages/admin/PaymentLineWallboard.tsx`
- What this is: Admin route page.
- What it does: Runs one full admin screen with data loading and operator actions.
- Connections: Wired from `src/App.tsx`; depends on admin auth helpers and backend admin routes.
- Main content type: Business logic + admin UI + visible wording.
- Safe edits here: Table labels, section copy, and presentational layout.
- Be careful with: Request/response contracts, auth checks, and state transitions tied to backend behavior.
- Useful context: Operationally sensitive area: UI polish is safe, contract changes need extra care.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { usePaymentLineStatusStream } from '../../hooks/usePaymentLineStatusStream';

function formatSeller(entry?: {
  sellerStationName?: string | null;
  sellerClientSessionId?: string | null;
  sellerAdminId?: string | null;
} | null): string {
  if (!entry) return 'No seller';
  if (entry.sellerStationName && entry.sellerStationName.trim()) return entry.sellerStationName.trim();
  if (entry.sellerClientSessionId && entry.sellerClientSessionId.trim()) return `Seller ${entry.sellerClientSessionId.slice(0, 8)}`;
  if (entry.sellerAdminId && entry.sellerAdminId.trim()) return `Seller ${entry.sellerAdminId.slice(0, 8)}`;
  return 'Seller';
}

function formatElapsed(startIso: string | null): string {
  if (!startIso) return '00:00';
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(startIso).getTime()) / 1000));
  const mins = Math.floor(elapsedSeconds / 60);
  const secs = elapsedSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export default function PaymentLineWallboardPage() {
  const [searchParams] = useSearchParams();
  const queueKey = searchParams.get('queueKey');
  const overlayMode = searchParams.get('overlay') === '1';
  const requestedLimit = Number.parseInt(searchParams.get('limit') || '', 10);

  const stream = usePaymentLineStatusStream({
    queueKey,
    enabled: Boolean(queueKey)
  });

  const defaultLimit = stream.ready?.wallboardDefaultLimit || 5;
  const waitingLimit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : defaultLimit;

  const waitingEntries = useMemo(() => {
    if (!stream.snapshot) return [];
    return stream.snapshot.entries
      .filter((entry) => entry.uiState === 'WAITING_FOR_PAYMENT')
      .slice(0, waitingLimit);
  }, [stream.snapshot, waitingLimit]);

  if (!queueKey) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-800">
        <p className="text-sm font-semibold">Missing queue key. Open this page with `?queueKey=&lt;deviceId&gt;`.</p>
      </div>
    );
  }

  const wrapperClass = overlayMode
    ? 'fixed inset-0 z-[100] bg-[#050507] text-white'
    : 'mx-auto max-w-6xl rounded-3xl border border-slate-200 bg-white p-8';

  const frameClass = overlayMode ? 'min-h-screen p-8' : '';
  const tileClass = overlayMode
    ? 'rounded-2xl border border-white/20 bg-white/10 p-5 backdrop-blur-md'
    : 'rounded-2xl border border-slate-200 bg-slate-50 p-5';
  const mutedText = overlayMode ? 'text-white/65' : 'text-slate-500';
  const strongText = overlayMode ? 'text-white' : 'text-slate-900';

  return (
    <div className={wrapperClass}>
      <div className={frameClass}>
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <p className={`text-xs font-semibold uppercase tracking-[0.24em] ${mutedText}`}>Payment Line Wallboard</p>
            <h1 className={`mt-2 text-4xl font-black tracking-tight ${strongText}`}>{queueKey}</h1>
          </div>
          {!overlayMode ? (
            <Link to="/admin/orders" className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">
              Back To Orders
            </Link>
          ) : null}
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className={tileClass}>
            <p className={`text-xs font-semibold uppercase tracking-wider ${mutedText}`}>Active Seller</p>
            <p className={`mt-2 text-3xl font-black ${strongText}`}>{formatSeller(stream.sellerPayload.activeEntry)}</p>
            <p className={`mt-3 text-sm ${mutedText}`}>Amount</p>
            <p className={`text-2xl font-bold ${strongText}`}>${((stream.sellerPayload.activeEntry?.expectedAmountCents || 0) / 100).toFixed(2)}</p>
            <p className={`mt-3 text-sm ${mutedText}`}>Elapsed</p>
            <p className={`text-2xl font-bold ${strongText}`}>{formatElapsed(stream.sellerPayload.activeEntry?.processingStartedAt || null)}</p>
          </div>

          <div className={tileClass}>
            <p className={`text-xs font-semibold uppercase tracking-wider ${mutedText}`}>Next {waitingLimit} Waiting</p>
            <div className="mt-3 space-y-2">
              {waitingEntries.length === 0 ? (
                <p className={`text-sm ${mutedText}`}>No waiting sellers.</p>
              ) : (
                waitingEntries.map((entry, index) => (
                  <div key={entry.entryId} className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                    <span className={`text-sm font-semibold ${strongText}`}>{index + 1}. {formatSeller(entry)}</span>
                    <span className={`text-xs ${mutedText}`}>${(entry.expectedAmountCents / 100).toFixed(2)}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className={tileClass}>
            <p className={`text-xs font-semibold uppercase tracking-wider ${mutedText}`}>Queue</p>
            <p className={`mt-2 text-5xl font-black ${strongText}`}>{stream.snapshot?.waitingCount ?? 0}</p>
            <p className={`mt-1 text-sm ${mutedText}`}>Total waiting</p>

            <p className={`mt-5 text-sm ${mutedText}`}>Updated</p>
            <p className={`text-lg font-bold ${strongText}`}>{new Date(stream.updatedAt).toLocaleTimeString()}</p>

            <p className={`mt-5 text-sm ${mutedText}`}>Realtime</p>
            <p className={`text-lg font-bold ${strongText}`}>{stream.connected ? 'Connected' : 'Reconnecting'}</p>
          </div>
        </div>

        {stream.error ? (
          <div className="mt-4 rounded-xl border border-rose-300/50 bg-rose-500/20 px-4 py-3 text-sm text-rose-100">{stream.error}</div>
        ) : null}
      </div>
    </div>
  );
}
