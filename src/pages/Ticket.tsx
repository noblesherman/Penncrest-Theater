import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Calendar, MapPin } from 'lucide-react';
import { format } from 'date-fns';
import { apiFetch } from '../lib/api';

type TicketResponse = {
  id: string;
  publicId: string;
  qrPayload: string;
  performance: {
    showTitle: string;
    startsAt: string;
    venue: string;
  };
  seat: {
    sectionName: string;
    row: string;
    number: number;
  };
  holder: {
    customerName: string;
    customerEmail: string;
    source: 'ONLINE' | 'DOOR' | 'COMP' | 'STAFF_FREE' | 'FAMILY_FREE';
    ticketType?: string | null;
    attendeeName?: string | null;
  };
};

export default function TicketPage() {
  const { publicId } = useParams();
  const [ticket, setTicket] = useState<TicketResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!publicId) {
      setError('Missing ticket id');
      return;
    }

    apiFetch<TicketResponse>(`/api/tickets/${publicId}`)
      .then(setTicket)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load ticket'));
  }, [publicId]);

  const qrImage = useMemo(() => {
    if (!ticket) return '';
    return `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(ticket.qrPayload)}`;
  }, [ticket]);

  if (error) {
    return <div className="min-h-screen flex items-center justify-center text-red-600">{error}</div>;
  }

  if (!ticket) {
    return <div className="min-h-screen flex items-center justify-center">Loading ticket...</div>;
  }

  return (
    <div className="min-h-screen bg-stone-100 py-16 px-4">
      <div className="max-w-xl mx-auto bg-white rounded-3xl border border-stone-200 shadow-xl overflow-hidden">
        <div className="bg-stone-900 text-white p-8 text-center">
          <h1 className="text-3xl font-black mb-2">{ticket.performance.showTitle}</h1>
          <div className="text-stone-300 text-sm">Ticket #{ticket.publicId}</div>
        </div>

        <div className="p-8">
          <div className="flex flex-col items-center mb-6">
            <img src={qrImage} alt="Ticket QR" className="w-64 h-64 border border-stone-200 rounded-xl" />
            <div className="text-[11px] text-stone-400 mt-2">Present this QR at the door</div>
          </div>

          <div className="space-y-3 text-sm text-stone-700">
            <div className="flex items-center gap-2"><Calendar className="w-4 h-4 text-stone-500" /> {format(new Date(ticket.performance.startsAt), 'EEEE, MMMM d, yyyy @ h:mm a')}</div>
            <div className="flex items-center gap-2"><MapPin className="w-4 h-4 text-stone-500" /> {ticket.performance.venue}</div>
            <div><span className="font-semibold">Seat:</span> {ticket.seat.sectionName} Row {ticket.seat.row} Seat {ticket.seat.number}</div>
            <div><span className="font-semibold">Name:</span> {ticket.holder.attendeeName || ticket.holder.customerName}</div>
            <div><span className="font-semibold">Email:</span> {ticket.holder.customerEmail}</div>
            {ticket.holder.ticketType && <div><span className="font-semibold">Type:</span> {ticket.holder.ticketType}</div>}
          </div>

          <Link to="/" className="mt-8 block text-center bg-stone-900 text-white py-3 rounded-xl font-bold hover:bg-stone-800">
            Return Home
          </Link>
        </div>
      </div>
    </div>
  );
}
