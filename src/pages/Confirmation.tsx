import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Calendar, MapPin, Ticket, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { apiFetch } from '../lib/api';
import { getRememberedOrderAccessToken, rememberOrderAccessToken } from '../lib/orderAccess';
import { toQrCodeDataUrl } from '../lib/qrCode';

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
    id?: string | null;
    publicId?: string | null;
    seatId?: string | null;
    sectionName: string;
    row: string;
    number: number;
    isGeneralAdmission?: boolean;
    price: number;
    ticketType?: string | null;
    isComplimentary?: boolean;
    attendeeName?: string | null;
    qrPayload?: string | null;
    checkedInAt?: string | null;
    checkedInBy?: string | null;
  }>;
};

const VISIBLE_REFRESH_DELAY_MS = 20_000;
const HIDDEN_REFRESH_DELAY_MS = 60_000;

function getTicketKey(
  ticket: OrderResponse['tickets'][number],
  index: number
): string {
  return ticket.id || ticket.publicId || ticket.seatId || `ticket-${index}`;
}

export default function Confirmation() {
  const [searchParams] = useSearchParams();
  const orderId = searchParams.get('orderId');
  const tokenFromUrl = searchParams.get('token');
  const [orderData, setOrderData] = useState<OrderResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qrByTicketKey, setQrByTicketKey] = useState<Record<string, string>>({});
  const [activeTicketIndex, setActiveTicketIndex] = useState(0);
  const [isVisible, setIsVisible] = useState(() => (typeof document === 'undefined' ? true : document.visibilityState === 'visible'));
  const carouselRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onVisibilityChange = () => {
      setIsVisible(document.visibilityState === 'visible');
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

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
    let hasLoadedOnce = false;

    const fetchOrder = async (initialLoad = false) => {
      try {
        const result = await apiFetch<OrderResponse>(`/api/orders/${orderId}?token=${encodeURIComponent(orderAccessToken)}`);
        if (cancelled) return;
        setOrderData(result);
        setError(null);
        hasLoadedOnce = true;
      } catch (err) {
        if (cancelled) return;
        if (!hasLoadedOnce || initialLoad) {
          setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to load order confirmation');
        }
      }
    };

    void fetchOrder(true);
    const interval = window.setInterval(() => {
      void fetchOrder();
    }, isVisible ? VISIBLE_REFRESH_DELAY_MS : HIDDEN_REFRESH_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [orderId, tokenFromUrl, isVisible]);

  useEffect(() => {
    setQrByTicketKey({});
  }, [orderId]);

  useEffect(() => {
    if (!orderData) {
      return;
    }

    let cancelled = false;
    const missingTickets = orderData.tickets
      .map((ticket, index) => ({
        key: getTicketKey(ticket, index),
        qrPayload: ticket.qrPayload
      }))
      .filter((ticket) => Boolean(ticket.qrPayload) && !qrByTicketKey[ticket.key]);

    if (missingTickets.length === 0) {
      return;
    }

    void Promise.all(
      missingTickets.map(async (ticket) => {
        const imageUrl = await toQrCodeDataUrl(ticket.qrPayload as string, 320);
        return [ticket.key, imageUrl] as const;
      })
    )
      .then((entries) => {
        if (cancelled) return;
        setQrByTicketKey((current) => {
          const next = { ...current };
          for (const [key, imageUrl] of entries) {
            next[key] = imageUrl;
          }
          return next;
        });
      })
      .catch(() => {
      });

    return () => {
      cancelled = true;
    };
  }, [orderData, qrByTicketKey]);

  useEffect(() => {
    if (!orderData) {
      setActiveTicketIndex(0);
      return;
    }
    setActiveTicketIndex((current) => Math.min(current, Math.max(0, orderData.tickets.length - 1)));
  }, [orderData]);

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
  const totalTickets = orderData.tickets.length;

  const goToTicket = (index: number) => {
    const container = carouselRef.current;
    if (!container || totalTickets === 0) {
      return;
    }

    const clampedIndex = Math.max(0, Math.min(totalTickets - 1, index));
    const nextChild = container.children.item(clampedIndex) as HTMLElement | null;
    if (nextChild) {
      nextChild.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
    }
    setActiveTicketIndex(clampedIndex);
  };

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
              <div className="mb-4 flex items-center justify-between">
                <h3 className="font-bold text-stone-900 uppercase tracking-wider text-sm">Tickets</h3>
                <div className="text-sm font-bold text-stone-700">Total {totalLabel}</div>
              </div>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => goToTicket(activeTicketIndex - 1)}
                  disabled={activeTicketIndex <= 0 || totalTickets <= 1}
                  className="absolute left-1 top-1/2 z-10 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-stone-300 bg-white/95 text-stone-700 shadow-sm transition hover:bg-white disabled:opacity-35 sm:left-2"
                  aria-label="Previous ticket"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => goToTicket(activeTicketIndex + 1)}
                  disabled={activeTicketIndex >= totalTickets - 1 || totalTickets <= 1}
                  className="absolute right-1 top-1/2 z-10 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-stone-300 bg-white/95 text-stone-700 shadow-sm transition hover:bg-white disabled:opacity-35 sm:right-2"
                  aria-label="Next ticket"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>

                <div
                  ref={carouselRef}
                  onScroll={(event) => {
                    const container = event.currentTarget;
                    if (!container.clientWidth || totalTickets === 0) return;
                    const index = Math.round(container.scrollLeft / container.clientWidth);
                    setActiveTicketIndex(Math.max(0, Math.min(totalTickets - 1, index)));
                  }}
                  className="flex h-[74vh] min-h-[560px] max-h-[780px] snap-x snap-mandatory overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                  aria-label="Order ticket wallet"
                >
                  {orderData.tickets.map((ticket, index) => {
                    const seatLabel =
                      ticket.isGeneralAdmission || orderData.performance.isGeneralAdmission
                        ? `General Admission Ticket ${ticket.number || index + 1}`
                        : `${ticket.sectionName} - Row ${ticket.row} Seat ${ticket.number}`;
                    const ticketKey = getTicketKey(ticket, index);
                    const qrImageUrl = qrByTicketKey[ticketKey];

                    return (
                      <article key={ticketKey} className="min-w-full snap-start px-8 py-1 sm:px-10">
                        <div className="flex h-full flex-col rounded-3xl border border-stone-200 bg-white p-6">
                          <div className="space-y-2">
                            <div className="text-4xl font-black leading-tight text-stone-900">{seatLabel}</div>
                            {ticket.ticketType && <div className="text-lg text-stone-600">Type: {ticket.ticketType}</div>}
                            {ticket.attendeeName && <div className="text-base text-stone-600">Attendee: {ticket.attendeeName}</div>}
                            {ticket.isComplimentary && <div className="text-sm font-semibold text-green-700">Complimentary</div>}
                            {ticket.checkedInAt && (
                              <div className="mt-2 inline-flex flex-col rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                                <span className="font-semibold uppercase tracking-wide">Checked In</span>
                                <span>{format(new Date(ticket.checkedInAt), 'MMM d, yyyy @ h:mm a')}</span>
                                {ticket.checkedInBy && <span>By {ticket.checkedInBy}</span>}
                              </div>
                            )}
                          </div>

                          <div className="flex flex-1 items-center justify-center py-6">
                            {qrImageUrl ? (
                              <img
                                src={qrImageUrl}
                                alt="Ticket QR"
                                className="w-full max-w-[420px] rounded-2xl border border-stone-200"
                              />
                            ) : (
                              <div className="flex aspect-square w-full max-w-[420px] items-center justify-center rounded-2xl border border-stone-200 bg-stone-50 text-sm text-stone-400">
                                {ticket.qrPayload ? 'Generating QR…' : 'QR pending'}
                              </div>
                            )}
                          </div>

                          <div className="space-y-2">
                            <div className="text-center text-xs text-stone-400">Present this QR at the door</div>
                            {ticket.publicId && !finalizationFailed && (
                              <div className="text-center">
                                <Link to={`/tickets/${ticket.publicId}`} className="inline-flex items-center gap-1 text-sm font-bold text-yellow-700 hover:text-yellow-900">
                                  <Ticket className="w-4 h-4" /> Open Single Ticket
                                </Link>
                              </div>
                            )}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>

              {totalTickets > 1 && (
                <div className="mt-4 flex justify-center gap-2">
                  {orderData.tickets.map((ticket, index) => {
                    const ticketKey = getTicketKey(ticket, index);
                    const isActive = activeTicketIndex === index;
                    return (
                      <button
                        key={`${ticketKey}-dot`}
                        type="button"
                        onClick={() => goToTicket(index)}
                        className={`h-2 rounded-full transition-all ${isActive ? 'w-6 bg-stone-900' : 'w-2 bg-stone-300 hover:bg-stone-400'}`}
                        aria-label={`Go to ticket ${index + 1}`}
                        aria-current={isActive ? 'true' : undefined}
                      />
                    );
                  })}
                </div>
              )}

              {totalTickets > 0 && (
                <div className="mt-3 text-center text-xs font-medium text-stone-500">
                  Ticket {activeTicketIndex + 1} of {totalTickets}
                </div>
              )}
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
