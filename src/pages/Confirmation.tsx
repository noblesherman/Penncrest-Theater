import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Calendar, MapPin, Ticket, Search } from 'lucide-react';
import { format } from 'date-fns';
import { apiFetch } from '../lib/api';
import { getRememberedOrderAccessToken, rememberOrderAccessToken } from '../lib/orderAccess';

type OrderResponse = {
  order: {
    id: string;
    status: 'PENDING' | 'PAID' | 'FINALIZATION_FAILED' | 'REFUNDED' | 'CANCELED';
    source: 'ONLINE' | 'DOOR' | 'COMP' | 'STAFF_FREE' | 'STAFF_COMP' | 'FAMILY_FREE' | 'STUDENT_COMP';
    email: string;
    customerName: string;
    amountTotal: number;
    currency: string;
    createdAt: string;
    refundStatus?: string | null;
    refundRequestedAt?: string | null;
  };
  performance: {
    id: string;
    title: string;
    showTitle: string;
    startsAt: string;
    venue: string;
    isGeneralAdmission?: boolean;
  };
  tickets: Array<{
    id: string;
    publicId: string;
    seatId: string;
    sectionName: string;
    row: string;
    number: number;
    isGeneralAdmission?: boolean;
    price: number;
    ticketType?: string | null;
    isComplimentary?: boolean;
    attendeeName?: string | null;
  }>;
};

const MIN_PENDING_POLL_DELAY_MS = 2_500;
const MAX_PENDING_POLL_DELAY_MS = 15_000;
const HIDDEN_PENDING_POLL_DELAY_MS = 20_000;
const PENDING_POLL_JITTER_MS = 600;
const MAX_PENDING_POLL_ATTEMPTS = 20;

function getPendingPollDelayMs(attemptNumber: number): number {
  const exponentialDelay = Math.round(MIN_PENDING_POLL_DELAY_MS * Math.pow(1.35, attemptNumber));
  return Math.min(MAX_PENDING_POLL_DELAY_MS, exponentialDelay);
}

export default function Confirmation() {
  const [searchParams] = useSearchParams();
  const orderId = searchParams.get('orderId');
  const tokenFromUrl = searchParams.get('token');
  const [orderData, setOrderData] = useState<OrderResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orderId) {
      setError('Missing order ID in URL.');
      return;
    }

    const orderAccessToken = tokenFromUrl || getRememberedOrderAccessToken(orderId);
    if (!orderAccessToken) {
      setError('This confirmation link is incomplete. Use Order Lookup to retrieve your tickets.');
      return;
    }

    rememberOrderAccessToken(orderId, orderAccessToken);

    let cancelled = false;
    let attempts = 0;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    const fetchOrder = async () => {
      try {
        const result = await apiFetch<OrderResponse>(`/api/orders/${orderId}?token=${encodeURIComponent(orderAccessToken)}`);
        if (cancelled) return;
        setOrderData(result);

        if (result.order.status === 'PENDING' && attempts < MAX_PENDING_POLL_ATTEMPTS) {
          attempts += 1;
          const isHidden = document.visibilityState !== 'visible';
          const baseDelay = isHidden ? HIDDEN_PENDING_POLL_DELAY_MS : getPendingPollDelayMs(attempts - 1);
          const jitter = Math.floor(Math.random() * PENDING_POLL_JITTER_MS);
          pollTimer = setTimeout(fetchOrder, baseDelay + jitter);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to load order confirmation');
      }
    };

    fetchOrder();

    return () => {
      cancelled = true;
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [orderId, tokenFromUrl]);

  const totalLabel = useMemo(() => {
    if (!orderData) return '$0.00';
    return `$${(orderData.order.amountTotal / 100).toFixed(2)}`;
  }, [orderData]);

  if (error) {
    return <div className="min-h-screen flex items-center justify-center text-red-600">{error}</div>;
  }

  if (!orderData) {
    return <div className="min-h-screen flex items-center justify-center">Loading confirmation...</div>;
  }

  const pending = orderData.order.status === 'PENDING';
  const finalizationFailed = orderData.order.status === 'FINALIZATION_FAILED';

  return (
    <div className="min-h-screen bg-yellow-50 px-4 py-10 sm:py-20">
      <div className="max-w-3xl mx-auto">
        <div className="bg-white rounded-[2rem] shadow-2xl overflow-hidden border border-stone-100">
          <div className="bg-stone-900 p-6 text-center text-white sm:p-10">
            <h1 className="mb-2 text-3xl font-black sm:text-4xl">
              {pending ? 'PROCESSING PAYMENT' : finalizationFailed ? 'ORDER NEEDS REVIEW' : 'YOU\'RE ALL SET!'}
            </h1>
            <p className="text-stone-400 text-sm">Order #{orderData.order.id.slice(0, 8)}</p>
          </div>

          <div className="p-8 md:p-12">
            {pending && (
              <div className="bg-yellow-100 border border-yellow-200 text-yellow-900 p-4 rounded-xl mb-8">
                Your payment is still being confirmed. This page will refresh automatically.
              </div>
            )}

            {finalizationFailed && (
              <div className="bg-red-100 border border-red-200 text-red-900 p-4 rounded-xl mb-8">
                We received a paid checkout event but could not safely finish ticket issuance. A refund has
                {orderData.order.refundStatus ? ` (${orderData.order.refundStatus})` : ' '}
                been requested automatically. Do not purchase the same seats again until staff confirms recovery.
              </div>
            )}

            <div className="text-center mb-10">
              <h2 className="text-3xl font-bold text-stone-900 mb-2">{orderData.performance.showTitle}</h2>
              <div className="flex flex-col md:flex-row items-center justify-center gap-4 text-stone-500 mt-4">
                <div className="flex items-center gap-2">
                  <Calendar className="w-5 h-5" />
                  {format(new Date(orderData.performance.startsAt), 'EEEE, MMMM d, yyyy @ h:mm a')}
                </div>
                <div className="hidden md:block">•</div>
                <div className="flex items-center gap-2">
                  <MapPin className="w-5 h-5" />
                  {orderData.performance.venue}
                </div>
              </div>
            </div>

            <div className="bg-stone-50 rounded-2xl p-6 mb-8 border border-stone-100">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-bold text-stone-900 uppercase tracking-wider text-sm">Tickets</h3>
                <div className="text-sm font-bold text-stone-700">Total {totalLabel}</div>
              </div>

              <div className="space-y-3">
                {orderData.tickets.map((ticket) => (
                  <div key={ticket.seatId} className="flex flex-col gap-3 rounded-xl border border-stone-100 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="font-bold text-stone-900">
                        {ticket.isGeneralAdmission || orderData.performance.isGeneralAdmission
                          ? `General Admission Ticket ${ticket.number || 1}`
                          : `${ticket.sectionName} - Row ${ticket.row} Seat ${ticket.number}`}
                      </div>
                      {ticket.ticketType && <div className="text-xs text-stone-500">Type: {ticket.ticketType}</div>}
                      {ticket.attendeeName && <div className="text-xs text-stone-500">Attendee: {ticket.attendeeName}</div>}
                      {ticket.isComplimentary && <div className="text-xs text-green-700 font-semibold">Complimentary</div>}
                    </div>
                    {ticket.publicId && !finalizationFailed && (
                      <Link to={`/tickets/${ticket.publicId}`} className="inline-flex items-center gap-1 text-sm font-bold text-yellow-700 hover:text-yellow-900">
                        <Ticket className="w-4 h-4" /> View Ticket
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Link to="/orders/lookup" className="w-full bg-white border-2 border-stone-200 text-stone-700 font-bold py-3 rounded-xl hover:bg-stone-50 transition-colors text-center inline-flex items-center justify-center gap-2">
                <Search className="w-4 h-4" /> Find Another Order
              </Link>
              <Link to="/" className="w-full bg-stone-900 text-white font-bold py-3 rounded-xl hover:bg-stone-800 transition-colors text-center">
                Return Home
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
