import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { adminFetch } from '../../lib/adminAuth';

type OrderDetail = {
  id: string;
  status: string;
  source: 'ONLINE' | 'DOOR' | 'COMP' | 'STAFF_FREE' | 'FAMILY_FREE';
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

  const load = () => {
    if (!id) return;
    adminFetch<OrderDetail>(`/api/admin/orders/${id}`).then(setData).catch(console.error);
  };

  useEffect(() => {
    load();
  }, [id]);

  if (!data) return <div>Loading order...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-black text-stone-900">Order {data.id}</h1>
        <Link to="/admin/orders" className="text-sm font-bold text-stone-600">Back to orders</Link>
      </div>

      <div className="text-sm text-stone-600 mb-6">
        {data.customerName} • {data.email} • ${ (data.amountTotal / 100).toFixed(2) } • {data.status} • {data.source}
      </div>

      <div className="space-y-2 mb-6">
        {data.orderSeats.map((seat) => {
          const ticket = data.tickets.find((item) => item.seatId === seat.seatId);
          return (
            <div key={seat.seatId} className="border border-stone-200 rounded-xl p-3 flex justify-between gap-3">
              <div className="text-sm text-stone-700">
                {seat.seat.sectionName} Row {seat.seat.row} Seat {seat.seat.number}
                {seat.attendeeName ? ` (${seat.attendeeName})` : ''}
                {seat.ticketType ? ` • ${seat.ticketType}` : ''}
                {seat.isComplimentary ? ' • Complimentary' : ''}
              </div>
              {ticket && (
                <Link to={`/tickets/${ticket.publicId}`} className="text-xs font-bold text-yellow-700">
                  Ticket
                </Link>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <button
          className="bg-stone-900 text-white px-4 py-2 rounded-lg font-bold"
          onClick={async () => {
            await adminFetch(`/api/admin/orders/${data.id}/resend`, { method: 'POST' });
            alert('Ticket email resent.');
          }}
        >
          Resend Tickets
        </button>

        <label className="text-sm text-stone-600 inline-flex items-center gap-2">
          <input type="checkbox" checked={releaseSeats} onChange={(event) => setReleaseSeats(event.target.checked)} />
          Release seats for resale
        </label>

        <button
          className="bg-red-600 text-white px-4 py-2 rounded-lg font-bold"
          onClick={async () => {
            await adminFetch(`/api/admin/orders/${data.id}/refund`, {
              method: 'POST',
              body: JSON.stringify({ releaseSeats })
            });
            load();
          }}
        >
          Mark Refunded
        </button>
      </div>
    </div>
  );
}
