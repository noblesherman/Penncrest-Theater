import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { apiFetch } from '../lib/api';

type LookupResponse = {
  order: {
    id: string;
    status: string;
    customerName: string;
    email: string;
    amountTotal: number;
  };
  performance: {
    showTitle: string;
    startsAt: string;
    venue: string;
  };
  tickets: Array<{
    publicId: string;
    sectionName: string;
    row: string;
    number: number;
    attendeeName?: string | null;
  }>;
};

export default function OrderLookup() {
  const [orderId, setOrderId] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LookupResponse | null>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const data = await apiFetch<LookupResponse>('/api/orders/lookup', {
        method: 'POST',
        body: JSON.stringify({ orderId, email })
      });
      setResult(data);
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : 'Failed to find order');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-stone-50 py-16 px-4">
      <div className="max-w-2xl mx-auto bg-white border border-stone-200 rounded-3xl shadow-sm p-8">
        <h1 className="text-3xl font-black text-stone-900 mb-2">Order Lookup</h1>
        <p className="text-stone-500 mb-8">Enter your order ID and purchase email to retrieve ticket links.</p>

        <form onSubmit={onSubmit} className="space-y-3 mb-8">
          <input
            value={orderId}
            onChange={(event) => setOrderId(event.target.value)}
            placeholder="Order ID"
            required
            className="w-full rounded-xl border border-stone-300 px-4 py-3"
          />
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email"
            type="email"
            required
            className="w-full rounded-xl border border-stone-300 px-4 py-3"
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-stone-900 text-white rounded-xl py-3 font-bold inline-flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <Search className="w-4 h-4" /> {loading ? 'Searching...' : 'Find Order'}
          </button>
        </form>

        {error && <div className="text-red-600 text-sm mb-4">{error}</div>}

        {result && (
          <div className="space-y-3">
            <div className="text-sm text-stone-600">Order <span className="font-bold text-stone-900">{result.order.id}</span> ({result.order.status})</div>
            <div className="text-sm text-stone-600">{result.performance.showTitle} at {new Date(result.performance.startsAt).toLocaleString()}</div>
            <div className="space-y-2">
              {result.tickets.map((ticket) => (
                <div key={ticket.publicId} className="bg-stone-50 border border-stone-200 rounded-xl p-3 flex items-center justify-between gap-3">
                  <div className="text-sm text-stone-700">
                    {ticket.sectionName} Row {ticket.row} Seat {ticket.number}
                    {ticket.attendeeName ? ` (${ticket.attendeeName})` : ''}
                  </div>
                  <Link to={`/tickets/${ticket.publicId}`} className="text-sm font-bold text-yellow-700 hover:text-yellow-900">
                    Open Ticket
                  </Link>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
