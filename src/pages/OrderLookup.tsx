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
    isGeneralAdmission?: boolean;
  };
  tickets: Array<{
    publicId: string;
    sectionName: string;
    row: string;
    number: number;
    isGeneralAdmission?: boolean;
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
      setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to find order');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-stone-50 px-4 py-10 sm:py-16">
      <div className="mx-auto max-w-2xl rounded-3xl border border-stone-200 bg-white p-5 shadow-sm sm:p-8">
        <h1 className="mb-2 text-2xl font-black text-stone-900 sm:text-3xl">Order Lookup</h1>
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
                <div key={ticket.publicId} className="flex flex-col gap-2 rounded-xl border border-stone-200 bg-stone-50 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm text-stone-700">
                    {ticket.isGeneralAdmission || result.performance.isGeneralAdmission
                      ? `General Admission Ticket ${ticket.number || 1}`
                      : `${ticket.sectionName} Row ${ticket.row} Seat ${ticket.number}`}
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
