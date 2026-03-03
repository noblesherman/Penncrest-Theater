import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Calendar, MapPin, Ticket, Search } from 'lucide-react';
import { format } from 'date-fns';
import { apiFetch } from '../lib/api';

type OrderResponse = {
  order: {
    id: string;
    status: 'PENDING' | 'PAID' | 'REFUNDED' | 'CANCELED';
    source: 'ONLINE' | 'DOOR' | 'COMP' | 'STAFF_FREE' | 'FAMILY_FREE';
    email: string;
    customerName: string;
    amountTotal: number;
    currency: string;
    createdAt: string;
  };
  performance: {
    id: string;
    title: string;
    showTitle: string;
    startsAt: string;
    venue: string;
  };
  tickets: Array<{
    id: string;
    publicId: string;
    seatId: string;
    sectionName: string;
    row: string;
    number: number;
    price: number;
    ticketType?: string | null;
    isComplimentary?: boolean;
    attendeeName?: string | null;
  }>;
};

export default function Confirmation() {
  const [searchParams] = useSearchParams();
  const orderId = searchParams.get('orderId');
  const [orderData, setOrderData] = useState<OrderResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orderId) {
      setError('Missing order ID in URL.');
      return;
    }

    let cancelled = false;
    let attempts = 0;

    const fetchOrder = async () => {
      try {
        const result = await apiFetch<OrderResponse>(`/api/orders/${orderId}`);
        if (cancelled) return;
        setOrderData(result);

        attempts += 1;
        if (result.order.status !== 'PAID' && attempts < 20) {
          setTimeout(fetchOrder, 2500);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load order confirmation');
      }
    };

    fetchOrder();

    return () => {
      cancelled = true;
    };
  }, [orderId]);

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

  const pending = orderData.order.status !== 'PAID';

  return (
    <div className="min-h-screen bg-yellow-50 py-20 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="bg-white rounded-[2rem] shadow-2xl overflow-hidden border border-stone-100">
          <div className="bg-stone-900 text-white p-10 text-center">
            <h1 className="text-4xl font-black mb-2">{pending ? 'PROCESSING PAYMENT' : 'YOU\'RE ALL SET!'}</h1>
            <p className="text-stone-400 text-sm">Order #{orderData.order.id.slice(0, 8)}</p>
          </div>

          <div className="p-8 md:p-12">
            {pending && (
              <div className="bg-yellow-100 border border-yellow-200 text-yellow-900 p-4 rounded-xl mb-8">
                Your payment is still being confirmed by Stripe. This page will refresh automatically.
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
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-stone-900 uppercase tracking-wider text-sm">Tickets</h3>
                <div className="text-sm font-bold text-stone-700">Total {totalLabel}</div>
              </div>

              <div className="space-y-3">
                {orderData.tickets.map((ticket) => (
                  <div key={ticket.seatId} className="bg-white p-4 rounded-xl border border-stone-100 flex items-center justify-between gap-3">
                    <div>
                      <div className="font-bold text-stone-900">
                        {ticket.sectionName} - Row {ticket.row} Seat {ticket.number}
                      </div>
                      {ticket.ticketType && <div className="text-xs text-stone-500">Type: {ticket.ticketType}</div>}
                      {ticket.attendeeName && <div className="text-xs text-stone-500">Attendee: {ticket.attendeeName}</div>}
                      {ticket.isComplimentary && <div className="text-xs text-green-700 font-semibold">Complimentary</div>}
                    </div>
                    {ticket.publicId && (
                      <Link to={`/tickets/${ticket.publicId}`} className="text-sm font-bold text-yellow-700 hover:text-yellow-900 inline-flex items-center gap-1">
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
