import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { adminFetch } from '../../lib/adminAuth';

type OrderDetail = {
  id: string;
  status: string;
  source: 'ONLINE' | 'DOOR' | 'COMP' | 'STAFF_FREE' | 'FAMILY_FREE' | 'STUDENT_COMP';
  email: string;
  customerName: string;
  amountTotal: number;
  createdAt: string;
  performance: {
    id: string;
    title: string | null;
    startsAt: string;
    venue: string;
    show: {
      title: string;
    };
  };
  orderSeats: Array<{
    seatId: string;
    attendeeName?: string | null;
    ticketType?: string | null;
    isComplimentary?: boolean;
    seat: { sectionName: string; row: string; number: number };
    price: number;
  }>;
  tickets: Array<{
    publicId: string;
    seatId: string;
  }>;
};

export default function AdminOrderDetailPage() {
  const { id } = useParams();
  const [data, setData] = useState<OrderDetail | null>(null);
  const [releaseSeats, setReleaseSeats] = useState(false);
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

  useEffect(() => {
    void load();
  }, [id]);

  const resendTickets = async () => {
    if (!data) return;
    setActionBusy(true);
    setError(null);
    setNotice(null);
    try {
      await adminFetch(`/api/admin/orders/${data.id}/resend`, { method: 'POST' });
      setNotice('Ticket email resent.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resend tickets');
    } finally {
      setActionBusy(false);
    }
  };

  const refundOrder = async () => {
    if (!data) return;
    setActionBusy(true);
    setError(null);
    setNotice(null);
    try {
      await adminFetch(`/api/admin/orders/${data.id}/refund`, {
        method: 'POST',
        body: JSON.stringify({ releaseSeats })
      });
      setNotice('Order marked refunded.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to mark order refunded');
    } finally {
      setActionBusy(false);
    }
  };

  if (loading && !data) return <div className="text-sm text-stone-500">Loading order...</div>;

  if (!data) {
    return <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error || 'Order not found.'}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-stone-900" style={{ fontFamily: 'Georgia, serif' }}>Order {data.id}</h1>
        <Link to="/admin/orders" className="text-sm font-semibold text-stone-600 hover:text-red-700 transition-colors">Back to orders</Link>
      </div>

      {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
      {notice ? <div className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</div> : null}

      <div className="text-sm text-stone-600">
        {data.customerName} • {data.email} • ${(data.amountTotal / 100).toFixed(2)} • {data.status} • {data.source}
      </div>

      <div className="space-y-2">
        {data.orderSeats.map((seat) => {
          const ticket = data.tickets.find((item) => item.seatId === seat.seatId);
          return (
            <div key={seat.seatId} className="flex flex-col gap-3 rounded-xl border border-stone-200 p-3 sm:flex-row sm:justify-between">
              <div className="text-sm text-stone-700">
                {seat.seat.sectionName} Row {seat.seat.row} Seat {seat.seat.number}
                {seat.attendeeName ? ` (${seat.attendeeName})` : ''}
                {seat.ticketType ? ` • ${seat.ticketType}` : ''}
                {seat.isComplimentary ? ' • Complimentary' : ''}
              </div>
              {ticket ? (
                <Link to={`/tickets/${ticket.publicId}`} className="text-xs font-bold text-red-700 hover:text-red-800">
                  Ticket
                </Link>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <button
          className="w-full rounded-lg bg-red-700 px-4 py-2 font-semibold text-white hover:bg-red-800 transition-colors disabled:opacity-60 sm:w-auto"
          disabled={actionBusy}
          onClick={() => {
            void resendTickets();
          }}
        >
          {actionBusy ? 'Working...' : 'Resend Tickets'}
        </button>

        <label className="text-sm text-stone-600 inline-flex items-center gap-2">
          <input type="checkbox" checked={releaseSeats} onChange={(event) => setReleaseSeats(event.target.checked)} />
          Release seats for resale
        </label>

        <button
          className="w-full rounded-lg bg-red-600 px-4 py-2 font-semibold text-white hover:bg-red-700 transition-colors disabled:opacity-60 sm:w-auto"
          disabled={actionBusy}
          onClick={() => {
            void refundOrder();
          }}
        >
          Mark Refunded
        </button>
      </div>
    </div>
  );
}
