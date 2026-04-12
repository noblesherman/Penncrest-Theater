import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { adminFetch, hasAdminRole } from '../../lib/adminAuth';
import { useAdminSession } from './useAdminSession';

type OrderDetail = {
  id: string;
  status: string;
  source: 'ONLINE' | 'DOOR' | 'COMP' | 'STAFF_FREE' | 'FAMILY_FREE' | 'STUDENT_COMP';
  inPersonPaymentMethod?: 'STRIPE' | 'CASH' | null;
  stripePaymentIntentId?: string | null;
  email: string;
  customerName: string;
  amountTotal: number;
  createdAt: string;
  performance: {
    id: string;
    title: string | null;
    startsAt: string;
    venue: string;
    show: { title: string };
  };
  orderSeats: Array<{
    seatId: string;
    attendeeName?: string | null;
    ticketType?: string | null;
    isComplimentary?: boolean;
    seat: { sectionName: string; row: string; number: number };
    price: number;
  }>;
  tickets: Array<{ publicId: string; seatId: string }>;
  stripeRefundStatus?: string | null;
  refundRequestedAt?: string | null;
};

type StripeTransactionDetail = {
  available: boolean;
  reason?: string;
  dashboardUrl?: string;
  paymentIntent?: {
    id: string;
    status: string;
    amount: number;
    amountReceived: number;
    currency: string;
    createdAt: string | null;
    canceledAt: string | null;
    cancellationReason: string | null;
    description: string | null;
    captureMethod: string;
    statementDescriptor: string | null;
    statementDescriptorSuffix: string | null;
    paymentMethodTypes: string[];
    livemode: boolean;
  };
  paymentMethod?: {
    id: string | null;
    type: string | null;
    brand: string | null;
    displayBrand: string | null;
    funding: string | null;
    last4: string | null;
    fingerprint: string | null;
    expMonth: number | null;
    expYear: number | null;
    issuer: string | null;
    country: string | null;
    network: string | null;
    walletType: string | null;
    checks: {
      cvcCheck: string | null;
      addressLine1Check: string | null;
      addressPostalCodeCheck: string | null;
    };
  };
  charge?: {
    id: string;
    status: string;
    paid: boolean;
    captured: boolean;
    amount: number;
    amountCaptured: number;
    amountRefunded: number;
    createdAt: string | null;
    receiptEmail: string | null;
    receiptUrl: string | null;
    failureCode: string | null;
    failureMessage: string | null;
    statementDescriptor: string | null;
    statementDescriptorSuffix: string | null;
    outcome: {
      riskLevel: string | null;
      riskScore: number | null;
      networkStatus: string | null;
      sellerMessage: string | null;
      type: string;
    } | null;
    billingDetails: {
      name: string | null;
      email: string | null;
      phone: string | null;
      postalCode: string | null;
      country: string | null;
    };
  } | null;
  balance?: {
    id: string;
    amount: number;
    fee: number;
    net: number;
    type: string;
    reportingCategory: string;
    availableOn: string | null;
    exchangeRate: number | null;
    feeDetails: Array<{
      amount: number;
      currency: string;
      description: string | null;
      type: string;
    }>;
  } | null;
  customer?: {
    id: string | null;
    name: string | null;
    email: string | null;
    phone: string | null;
    country: string | null;
  };
  refunds?: Array<{
    id: string;
    status: string | null;
    amount: number;
    reason: string | null;
    createdAt: string | null;
  }>;
  activity?: Array<{
    key: string;
    label: string;
    status: 'success' | 'warning' | 'info';
    occurredAt: string;
  }>;
  metadata?: Record<string, string>;
  orderRefundStatus?: string | null;
};

const STATUS_STYLES: Record<string, string> = {
  COMPLETED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  PENDING:   'bg-amber-50 text-amber-700 ring-amber-200',
  REFUNDED:  'bg-rose-50 text-rose-700 ring-rose-200',
  CANCELLED: 'bg-stone-100 text-stone-500 ring-stone-200',
};

const SOURCE_LABELS: Record<string, string> = {
  ONLINE:      'Online',
  DOOR:        'At the Door',
  COMP:        'Complimentary',
  STAFF_FREE:  'Staff',
  FAMILY_FREE: 'Family',
  STUDENT_COMP:'Student Comp',
};

function Badge({ label, style }: { label: string; style?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ring-1 ${style ?? 'bg-stone-100 text-stone-500 ring-stone-200'}`}
    >
      {label}
    </span>
  );
}

function formatCurrency(cents: number | null | undefined, currency = 'usd'): string {
  if (typeof cents !== 'number' || Number.isNaN(cents)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: (currency || 'usd').toUpperCase(),
  }).format(cents / 100);
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

function formatLabel(value: string | null | undefined): string {
  if (!value) return '—';
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export default function AdminOrderDetailPage() {
  const { id } = useParams();
  const { admin } = useAdminSession();
  const [data, setData] = useState<OrderDetail | null>(null);
  const [transaction, setTransaction] = useState<StripeTransactionDetail | null>(null);
  const [transactionLoading, setTransactionLoading] = useState(false);
  const [transactionError, setTransactionError] = useState<string | null>(null);
  const [showTransactionDetails, setShowTransactionDetails] = useState(true);
  const [loading, setLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const result = await adminFetch<OrderDetail>(`/api/admin/orders/${id}`);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load order');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [id]);

  useEffect(() => {
    if (!data) {
      setTransaction(null);
      setTransactionError(null);
      setTransactionLoading(false);
      return;
    }

    const shouldLoadTransaction =
      Boolean(data.stripePaymentIntentId) ||
      data.source === 'ONLINE' ||
      (data.source === 'DOOR' && data.inPersonPaymentMethod === 'STRIPE');

    if (!shouldLoadTransaction) {
      setTransaction(null);
      setTransactionError(null);
      setTransactionLoading(false);
      return;
    }

    let cancelled = false;
    setTransaction(null);
    setTransactionLoading(true);
    setTransactionError(null);
    void adminFetch<StripeTransactionDetail>(`/api/admin/orders/${data.id}/transaction`)
      .then((result) => {
        if (cancelled) return;
        setTransaction(result);
      })
      .catch((err) => {
        if (cancelled) return;
        setTransactionError(err instanceof Error ? err.message : 'Failed to load transaction details');
      })
      .finally(() => {
        if (cancelled) return;
        setTransactionLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [data]);

  const resendTickets = async () => {
    if (!data) return;
    setActionBusy(true); setError(null); setNotice(null);
    try {
      await adminFetch(`/api/admin/orders/${data.id}/resend`, { method: 'POST' });
      setNotice('Ticket confirmation email has been resent.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resend tickets');
    } finally { setActionBusy(false); }
  };

  const refundOrder = async () => {
    if (!data) return;
    setActionBusy(true); setError(null); setNotice(null);
    try {
      const result = await adminFetch<{ message?: string }>(`/api/admin/orders/${data.id}/refund`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setNotice(result.message || 'Refund request submitted.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refund order');
    } finally { setActionBusy(false); }
  };

  const canRefund = hasAdminRole(admin.role, 'ADMIN');

  /* ── Loading ── */
  if (loading && !data) {
    return (
      <div className="flex items-center gap-2 py-12 text-sm text-stone-400">
        <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
        </svg>
        Loading order…
      </div>
    );
  }

  /* ── Not found ── */
  if (!data) {
    return (
      <div className="rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
        {error ?? 'Order not found.'}
      </div>
    );
  }

  const refundSettled = data.status === 'REFUNDED' || data.stripeRefundStatus?.toLowerCase() === 'succeeded';
  const refundInFlight =
    Boolean(data.stripeRefundStatus) &&
    !['failed', 'canceled', 'succeeded'].includes(data.stripeRefundStatus.toLowerCase());
  const showRefundAction = canRefund && !refundSettled && !refundInFlight;

  const statusStyle = STATUS_STYLES[data.status] ?? 'bg-stone-100 text-stone-500 ring-stone-200';
  const formattedTotal = `$${(data.amountTotal / 100).toFixed(2)}`;
  const shouldShowTransactionPanel =
    Boolean(transaction) || Boolean(transactionError) || transactionLoading || Boolean(data.stripePaymentIntentId) || data.source === 'ONLINE' || (data.source === 'DOOR' && data.inPersonPaymentMethod === 'STRIPE');
  const hasTransactionDetails = Boolean(transaction?.available && transaction.paymentIntent);
  const paymentIntent = transaction?.paymentIntent;
  const paymentMethod = transaction?.paymentMethod;
  const paymentCharge = transaction?.charge;
  const paymentBalance = transaction?.balance;
  const paymentRefunds = transaction?.refunds || [];
  const paymentActivity = transaction?.activity || [];
  const metadataEntries = Object.entries(transaction?.metadata || {});

  return (
    <div className="mx-auto max-w-2xl space-y-6 py-2">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="mb-0.5 text-xs font-medium uppercase tracking-widest text-stone-400">Order</p>
          <h1
            className="text-3xl font-bold text-stone-900"
            style={{ fontFamily: "var(--font-sans)", letterSpacing: '-0.02em' }}
          >
            #{data.id}
          </h1>
        </div>
        <Link
          to="/admin/orders"
          className="mt-1 inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-stone-400 transition-colors hover:text-stone-700"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          All Orders
        </Link>
      </div>

      {/* ── Alerts ── */}
      {error && (
        <div className="flex items-start gap-2 rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <svg className="mt-0.5 h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          {error}
        </div>
      )}
      {notice && (
        <div className="flex items-start gap-2 rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <svg className="mt-0.5 h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          {notice}
        </div>
      )}

      {/* ── Customer card ── */}
      <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-sm">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-stone-400">Customer</p>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-base font-semibold text-stone-900">{data.customerName}</p>
            <p className="mt-0.5 text-sm text-stone-500">{data.email}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge label={data.status} style={statusStyle} />
            <Badge label={SOURCE_LABELS[data.source] ?? data.source} />
            {data.source === 'DOOR' && data.inPersonPaymentMethod && (
              <Badge label={data.inPersonPaymentMethod === 'CASH' ? 'Cash' : 'Stripe'} />
            )}
            <span className="text-sm font-bold text-stone-800">{formattedTotal}</span>
          </div>
        </div>
      </div>

      {/* ── Refund status ── */}
      {data.stripeRefundStatus && (
        <div className="rounded-2xl border border-stone-100 bg-stone-50 px-5 py-3 text-sm text-stone-600">
          <span className="font-medium text-stone-500">Refund status: </span>
          <span className="font-semibold text-stone-800">{data.stripeRefundStatus}</span>
          {data.refundRequestedAt && (
            <span className="text-stone-400">
              {' '}— requested {new Date(data.refundRequestedAt).toLocaleString()}
            </span>
          )}
          <div className="mt-2 text-xs text-stone-500">
            Refunded orders automatically return their seats to inventory for resale.
          </div>
        </div>
      )}

      {/* ── Stripe transaction ── */}
      {shouldShowTransactionPanel && (
        <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="mb-1 text-[11px] font-semibold uppercase tracking-widest text-stone-400">Transaction</p>
              {hasTransactionDetails && paymentIntent ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    label={formatLabel(paymentIntent.status)}
                    style={
                      paymentIntent.status === 'succeeded'
                        ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                        : paymentIntent.status === 'canceled'
                          ? 'bg-rose-50 text-rose-700 ring-rose-200'
                          : 'bg-amber-50 text-amber-700 ring-amber-200'
                    }
                  />
                  <span className="text-sm font-semibold text-stone-800">
                    {formatCurrency(paymentIntent.amount, paymentIntent.currency)}
                  </span>
                  {paymentMethod?.brand && paymentMethod?.last4 && (
                    <span className="text-sm text-stone-500">
                      {formatLabel(paymentMethod.brand)} •••• {paymentMethod.last4}
                    </span>
                  )}
                </div>
              ) : (
                <p className="text-sm text-stone-500">
                  {transactionLoading ? 'Loading Stripe transaction details…' : transaction?.reason || 'Stripe transaction details are unavailable.'}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {transaction?.dashboardUrl && (
                <a
                  href={transaction.dashboardUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs font-semibold text-stone-600 transition-colors hover:border-stone-300 hover:bg-white hover:text-stone-900"
                >
                  Open in Stripe
                </a>
              )}
              {hasTransactionDetails && (
                <button
                  type="button"
                  onClick={() => setShowTransactionDetails((current) => !current)}
                  className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-semibold text-stone-600 transition-colors hover:border-stone-300 hover:text-stone-900"
                >
                  {showTransactionDetails ? 'Hide Details' : 'View Details'}
                </button>
              )}
            </div>
          </div>

          {transactionError && (
            <div className="mt-4 rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {transactionError}
            </div>
          )}

          {hasTransactionDetails && showTransactionDetails && paymentIntent && (
            <div className="mt-4 space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-stone-100 bg-stone-50 p-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-500">Payment Breakdown</p>
                  <dl className="space-y-1.5 text-sm text-stone-600">
                    <div className="flex items-center justify-between gap-2">
                      <dt>Payment amount</dt>
                      <dd className="font-semibold text-stone-900">
                        {formatCurrency(paymentIntent.amount, paymentIntent.currency)}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <dt>Stripe fees</dt>
                      <dd className="font-medium text-stone-700">
                        {paymentBalance ? `- ${formatCurrency(paymentBalance.fee, paymentIntent.currency)}` : '—'}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-2 border-t border-stone-200 pt-2">
                      <dt className="font-semibold text-stone-700">Net amount</dt>
                      <dd className="font-bold text-stone-900">
                        {paymentBalance ? formatCurrency(paymentBalance.net, paymentIntent.currency) : '—'}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs text-stone-500">
                      <dt>Funds available</dt>
                      <dd>{formatDateTime(paymentBalance?.availableOn)}</dd>
                    </div>
                  </dl>
                </div>

                <div className="rounded-xl border border-stone-100 bg-stone-50 p-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-500">Payment Method</p>
                  <dl className="space-y-1.5 text-sm text-stone-600">
                    <div className="flex items-center justify-between gap-2">
                      <dt>Type</dt>
                      <dd className="font-medium text-stone-900">{formatLabel(paymentMethod?.type)}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <dt>Card</dt>
                      <dd className="font-medium text-stone-900">
                        {paymentMethod?.brand && paymentMethod?.last4
                          ? `${formatLabel(paymentMethod.brand)} •••• ${paymentMethod.last4}`
                          : '—'}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <dt>Expires</dt>
                      <dd>{paymentMethod?.expMonth && paymentMethod?.expYear ? `${String(paymentMethod.expMonth).padStart(2, '0')} / ${paymentMethod.expYear}` : '—'}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <dt>CVC check</dt>
                      <dd>{formatLabel(paymentMethod?.checks?.cvcCheck)}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <dt>Zip check</dt>
                      <dd>{formatLabel(paymentMethod?.checks?.addressPostalCodeCheck)}</dd>
                    </div>
                  </dl>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-stone-100 bg-white p-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-500">Details</p>
                  <dl className="space-y-1.5 text-sm text-stone-600 break-all">
                    <div>
                      <dt className="text-stone-400">Payment ID</dt>
                      <dd className="font-mono text-xs text-stone-800">{paymentIntent.id}</dd>
                    </div>
                    <div>
                      <dt className="text-stone-400">Charge ID</dt>
                      <dd className="font-mono text-xs text-stone-800">{paymentCharge?.id || '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-stone-400">Payment method ID</dt>
                      <dd className="font-mono text-xs text-stone-800">{paymentMethod?.id || '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-stone-400">Fingerprint</dt>
                      <dd className="font-mono text-xs text-stone-800">{paymentMethod?.fingerprint || '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-stone-400">Created</dt>
                      <dd>{formatDateTime(paymentIntent.createdAt)}</dd>
                    </div>
                    <div>
                      <dt className="text-stone-400">Customer email</dt>
                      <dd>{paymentCharge?.billingDetails.email || transaction?.customer?.email || data.email || '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-stone-400">Billing location</dt>
                      <dd>
                        {[paymentCharge?.billingDetails.postalCode, paymentCharge?.billingDetails.country]
                          .filter(Boolean)
                          .join(', ') || '—'}
                      </dd>
                    </div>
                  </dl>
                </div>

                <div className="rounded-xl border border-stone-100 bg-white p-4">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-500">Recent Activity</p>
                  {paymentActivity.length > 0 ? (
                    <ul className="space-y-2">
                      {paymentActivity.map((item) => (
                        <li key={item.key} className="rounded-lg border border-stone-100 bg-stone-50 px-3 py-2">
                          <p className="text-sm font-medium text-stone-800">{item.label}</p>
                          <p className="text-xs text-stone-500">{formatDateTime(item.occurredAt)}</p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-stone-500">No activity available.</p>
                  )}
                </div>
              </div>

              {(metadataEntries.length > 0 || paymentRefunds.length > 0) && (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-xl border border-stone-100 bg-stone-50 p-4">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-500">Metadata</p>
                    {metadataEntries.length > 0 ? (
                      <div className="space-y-1.5 text-sm text-stone-600">
                        {metadataEntries.map(([key, value]) => (
                          <div key={key} className="flex items-start justify-between gap-3">
                            <span className="font-medium text-stone-500">{key}</span>
                            <span className="max-w-[70%] text-right break-all text-stone-800">{value}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-stone-500">No metadata attached.</p>
                    )}
                  </div>

                  <div className="rounded-xl border border-stone-100 bg-stone-50 p-4">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-500">Refunds</p>
                    {paymentRefunds.length > 0 ? (
                      <div className="space-y-2">
                        {paymentRefunds.map((refund) => (
                          <div key={refund.id} className="rounded-lg border border-stone-200 bg-white px-3 py-2">
                            <p className="text-sm font-medium text-stone-800">
                              {formatCurrency(refund.amount, paymentIntent.currency)} · {formatLabel(refund.status)}
                            </p>
                            <p className="text-xs text-stone-500">
                              {refund.reason ? `${formatLabel(refund.reason)} · ` : ''}{formatDateTime(refund.createdAt)}
                            </p>
                            <p className="mt-1 font-mono text-[11px] text-stone-500 break-all">{refund.id}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-stone-500">No refunds on this payment.</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Seats ── */}
      <div>
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-stone-400">Seats</p>
        <div className="divide-y divide-stone-100 rounded-2xl border border-stone-100 bg-white shadow-sm">
          {data.orderSeats.map((seat) => {
            const ticket = data.tickets.find((t) => t.seatId === seat.seatId);
            return (
              <div key={seat.seatId} className="flex items-center justify-between gap-4 px-5 py-4">
                <div className="space-y-0.5">
                  <p className="text-sm font-semibold text-stone-800">
                    {seat.seat.sectionName} · Row {seat.seat.row} · Seat {seat.seat.number}
                  </p>
                  <p className="text-xs text-stone-400">
                    {[
                      seat.attendeeName,
                      seat.ticketType,
                      seat.isComplimentary ? 'Complimentary' : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-sm font-medium text-stone-600">
                    ${(seat.price / 100).toFixed(2)}
                  </span>
                  {ticket && (
                    <Link
                      to={`/tickets/${ticket.publicId}`}
                      className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-1 text-xs font-semibold text-stone-600 transition-colors hover:border-stone-300 hover:bg-white hover:text-stone-900"
                    >
                      View Ticket →
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Actions ── */}
      <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-sm">
        <p className="mb-4 text-[11px] font-semibold uppercase tracking-widest text-stone-400">Actions</p>
        <p className="mb-4 text-sm text-stone-500">
          Refunding an order automatically cancels the tickets and puts those seats back on sale.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => { void resendTickets(); }}
            disabled={actionBusy}
            className="rounded-xl bg-stone-900 px-5 py-2.5 text-sm font-semibold text-white transition-all hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {actionBusy ? 'Working…' : 'Resend Tickets'}
          </button>

          {showRefundAction && (
            <button
              onClick={() => { void refundOrder(); }}
              disabled={actionBusy}
              className="rounded-xl border border-rose-200 bg-rose-50 px-5 py-2.5 text-sm font-semibold text-rose-700 transition-all hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {actionBusy ? 'Working…' : 'Refund via Stripe'}
            </button>
          )}
        </div>

        {refundSettled && (
          <div className="mt-4 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-600">
            This order has already been refunded. Its seats are already available for resale.
          </div>
        )}

        {refundInFlight && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
            A refund is already in progress. Once it completes, the seats will automatically return to inventory.
          </div>
        )}
      </div>

    </div>
  );
}
