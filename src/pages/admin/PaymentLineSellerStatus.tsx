import { Link, useSearchParams } from 'react-router-dom';
import { useMemo } from 'react';
import { usePaymentLineStatusStream } from '../../hooks/usePaymentLineStatusStream';

const STATUS_LABEL: Record<string, string> = {
  WAITING_FOR_PAYMENT: 'Waiting For Payment',
  ACTIVE_PAYMENT: 'Active Payment',
  PAYMENT_SUCCESS: 'Payment Success',
  PAYMENT_FAILED: 'Payment Failed',
  CANCELED: 'Canceled'
};

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

export default function PaymentLineSellerStatusPage() {
  const [searchParams] = useSearchParams();
  const queueKey = searchParams.get('queueKey');
  const sellerEntryId = searchParams.get('entryId');
  const overlayMode = searchParams.get('overlay') === '1';

  const stream = usePaymentLineStatusStream({
    queueKey,
    sellerEntryId,
    enabled: Boolean(queueKey)
  });

  const stationName =
    stream.sellerPayload.sellerEntry?.targetDeviceName ||
    stream.sellerPayload.sellerEntry?.targetDeviceId ||
    queueKey ||
    'Unknown device';

  const estimatedWaitMinutes = useMemo(() => {
    const sellerEntry = stream.sellerPayload.sellerEntry;
    if (!sellerEntry?.position) return null;
    if (sellerEntry.position <= 1) return 0;
    const baseSecondsPerPayment = 120;
    return Math.max(0, Math.ceil(((sellerEntry.position - 1) * baseSecondsPerPayment) / 60));
  }, [stream.sellerPayload.sellerEntry]);

  if (!queueKey) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-800">
        <p className="text-sm font-semibold">Missing queue key. Open this page with `?queueKey=&lt;deviceId&gt;`.</p>
      </div>
    );
  }

  const wrapperClass = overlayMode
    ? 'fixed inset-0 z-[100] flex min-h-screen items-center justify-center bg-[#09090b] p-6 text-white'
    : 'mx-auto max-w-4xl rounded-3xl border border-slate-200 bg-white p-8';

  const cardClass = overlayMode
    ? 'w-full max-w-5xl rounded-[28px] border border-white/20 bg-white/10 p-8 backdrop-blur-md'
    : 'rounded-2xl border border-slate-200 bg-slate-50 p-6';

  const mutedText = overlayMode ? 'text-white/70' : 'text-slate-500';
  const titleText = overlayMode ? 'text-white' : 'text-slate-900';

  return (
    <div className={wrapperClass}>
      <div className={cardClass}>
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <p className={`text-xs font-semibold uppercase tracking-[0.2em] ${mutedText}`}>Seller Status</p>
            <h1 className={`mt-2 text-3xl font-black tracking-tight ${titleText}`}>Payment Line</h1>
          </div>
          {!overlayMode ? (
            <Link to="/admin/orders" className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">
              Back To Orders
            </Link>
          ) : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-white/20 bg-black/10 p-4">
            <p className={`text-xs font-semibold uppercase tracking-wider ${mutedText}`}>Queue Position</p>
            <p className={`mt-2 text-3xl font-black ${titleText}`}>{stream.sellerPayload.sellerEntry?.position ?? '—'}</p>
          </div>
          <div className="rounded-xl border border-white/20 bg-black/10 p-4">
            <p className={`text-xs font-semibold uppercase tracking-wider ${mutedText}`}>Active Seller</p>
            <p className={`mt-2 text-xl font-bold ${titleText}`}>{formatSeller(stream.sellerPayload.activeEntry)}</p>
          </div>
          <div className="rounded-xl border border-white/20 bg-black/10 p-4">
            <p className={`text-xs font-semibold uppercase tracking-wider ${mutedText}`}>Estimated Wait</p>
            <p className={`mt-2 text-xl font-bold ${titleText}`}>
              {estimatedWaitMinutes == null ? '—' : estimatedWaitMinutes === 0 ? 'Now' : `${estimatedWaitMinutes} min`}
            </p>
          </div>
          <div className="rounded-xl border border-white/20 bg-black/10 p-4">
            <p className={`text-xs font-semibold uppercase tracking-wider ${mutedText}`}>Station</p>
            <p className={`mt-2 text-xl font-bold ${titleText}`}>{stationName}</p>
          </div>
          <div className="rounded-xl border border-white/20 bg-black/10 p-4">
            <p className={`text-xs font-semibold uppercase tracking-wider ${mutedText}`}>Current Status</p>
            <p className={`mt-2 text-xl font-bold ${titleText}`}>
              {STATUS_LABEL[stream.sellerPayload.sellerEntry?.uiState || ''] || 'Not In Queue'}
            </p>
          </div>
          <div className="rounded-xl border border-white/20 bg-black/10 p-4">
            <p className={`text-xs font-semibold uppercase tracking-wider ${mutedText}`}>Realtime</p>
            <p className={`mt-2 text-xl font-bold ${titleText}`}>{stream.connected ? 'Connected' : 'Reconnecting'}</p>
            <p className={`mt-1 text-xs ${mutedText}`}>{new Date(stream.updatedAt).toLocaleTimeString()}</p>
          </div>
        </div>

        {stream.error ? (
          <div className="mt-4 rounded-xl border border-rose-300/60 bg-rose-500/20 px-4 py-3 text-sm text-rose-100">{stream.error}</div>
        ) : null}
      </div>
    </div>
  );
}
