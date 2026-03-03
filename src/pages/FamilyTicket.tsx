import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';

type Performance = {
  id: string;
  title: string;
  startsAt: string;
  salesOpen: boolean;
  familyFreeTicketEnabled: boolean;
};

type Seat = {
  id: string;
  sectionName: string;
  row: string;
  number: number;
  status: 'available' | 'held' | 'sold' | 'blocked';
  isAccessible?: boolean;
  isCompanion?: boolean;
};

export default function FamilyTicketPage() {
  const navigate = useNavigate();
  const [performances, setPerformances] = useState<Performance[]>([]);
  const [performanceId, setPerformanceId] = useState('');
  const [seats, setSeats] = useState<Seat[]>([]);
  const [seatId, setSeatId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [attendeeName, setAttendeeName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    apiFetch<Performance[]>('/api/performances')
      .then((rows) => {
        const eligible = rows.filter((item) => item.salesOpen && item.familyFreeTicketEnabled);
        setPerformances(eligible);
        if (eligible.length > 0) setPerformanceId(eligible[0].id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load performances'));
  }, []);

  useEffect(() => {
    if (!performanceId) return;
    apiFetch<Seat[]>(`/api/performances/${performanceId}/seats`)
      .then((rows) => {
        const available = rows.filter((seat) => seat.status === 'available');
        setSeats(available);
        setSeatId(available[0]?.id || '');
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load seats'));
  }, [performanceId]);

  const selectedPerformance = useMemo(
    () => performances.find((item) => item.id === performanceId) || null,
    [performanceId, performances]
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!performanceId || !seatId) {
      setError('Please choose a performance and seat.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await apiFetch<{ orderId: string }>('/api/family-ticket/claim', {
        method: 'POST',
        body: JSON.stringify({
          performanceId,
          seatId,
          customerName,
          customerEmail,
          attendeeName: attendeeName.trim() || undefined
        })
      });

      navigate(`/confirmation?orderId=${result.orderId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to claim family ticket');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-stone-50 py-16 px-4">
      <div className="max-w-3xl mx-auto bg-white border border-stone-200 rounded-3xl p-8 shadow-sm">
        <h1 className="text-3xl font-black text-stone-900 mb-2">Family Free Ticket</h1>
        <p className="text-stone-600 mb-6">One free ticket per family for the run of a show (when enabled).</p>

        {selectedPerformance ? (
          <div className="text-sm text-stone-500 mb-4">
            Selected performance: {selectedPerformance.title} - {new Date(selectedPerformance.startsAt).toLocaleString()}
          </div>
        ) : null}

        <form onSubmit={submit} className="space-y-4">
          <select value={performanceId} onChange={(event) => setPerformanceId(event.target.value)} className="w-full border border-stone-300 rounded-xl px-3 py-2">
            {performances.map((performance) => (
              <option key={performance.id} value={performance.id}>
                {performance.title} - {new Date(performance.startsAt).toLocaleString()}
              </option>
            ))}
          </select>

          <select value={seatId} onChange={(event) => setSeatId(event.target.value)} className="w-full border border-stone-300 rounded-xl px-3 py-2">
            {seats.map((seat) => (
              <option key={seat.id} value={seat.id}>
                {seat.sectionName} {seat.row}-{seat.number}
                {seat.isAccessible ? ' • Accessible' : ''}
                {seat.isCompanion ? ' • Companion' : ''}
              </option>
            ))}
          </select>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              value={customerName}
              onChange={(event) => setCustomerName(event.target.value)}
              placeholder="Your name"
              className="border border-stone-300 rounded-xl px-3 py-2"
              required
            />
            <input
              type="email"
              value={customerEmail}
              onChange={(event) => setCustomerEmail(event.target.value)}
              placeholder="Your email"
              className="border border-stone-300 rounded-xl px-3 py-2"
              required
            />
          </div>

          <input
            value={attendeeName}
            onChange={(event) => setAttendeeName(event.target.value)}
            placeholder="Attendee name (optional)"
            className="w-full border border-stone-300 rounded-xl px-3 py-2"
          />

          {error && <div className="text-sm text-red-600">{error}</div>}

          <button
            disabled={submitting || !performanceId || !seatId}
            className="bg-stone-900 text-white px-5 py-3 rounded-xl font-bold disabled:opacity-50"
          >
            {submitting ? 'Submitting...' : 'Claim Free Family Ticket'}
          </button>
        </form>
      </div>
    </div>
  );
}
