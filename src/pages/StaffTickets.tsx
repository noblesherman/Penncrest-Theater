import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { buildConfirmationPath, rememberOrderAccessToken } from '../lib/orderAccess';

type Performance = {
  id: string;
  title: string;
  startsAt: string;
  salesOpen: boolean;
  staffCompsEnabled: boolean;
  staffCompLimitPerUser: number;
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

const naturalSort = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

function buildSeatGrid(seats: Seat[]) {
  const grid: Record<string, Record<string, Seat[]>> = {};

  seats.forEach((seat) => {
    if (!grid[seat.sectionName]) grid[seat.sectionName] = {};
    if (!grid[seat.sectionName][seat.row]) grid[seat.sectionName][seat.row] = [];
    grid[seat.sectionName][seat.row].push(seat);
  });

  Object.keys(grid).forEach((section) => {
    Object.keys(grid[section]).forEach((row) => {
      grid[section][row].sort((a, b) => a.number - b.number);
    });
  });

  return grid;
}

export default function StaffTicketsPage() {
  const navigate = useNavigate();

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [teacherPromoCode, setTeacherPromoCode] = useState('');

  const [performances, setPerformances] = useState<Performance[]>([]);
  const [performanceId, setPerformanceId] = useState('');
  const [seats, setSeats] = useState<Seat[]>([]);
  const [seatId, setSeatId] = useState('');
  const [attendeeName, setAttendeeName] = useState('');

  const availableSeats = useMemo(
    () =>
      seats
        .filter((seat) => seat.status === 'available' && !seat.isCompanion)
        .sort((a, b) => {
          if (a.sectionName !== b.sectionName) return a.sectionName.localeCompare(b.sectionName);
          if (a.row !== b.row) return a.row.localeCompare(b.row, undefined, { numeric: true, sensitivity: 'base' });
          return a.number - b.number;
        }),
    [seats]
  );

  const selectedPerformance = useMemo(
    () => performances.find((performance) => performance.id === performanceId) || null,
    [performanceId, performances]
  );
  const selectedSeat = useMemo(() => seats.find((seat) => seat.id === seatId) || null, [seatId, seats]);
  const seatGrid = useMemo(() => buildSeatGrid(seats), [seats]);
  const sections = useMemo(() => Object.keys(seatGrid).sort(naturalSort), [seatGrid]);

  useEffect(() => {
    apiFetch<Performance[]>('/api/performances')
      .then((rows) => {
        const eligible = rows.filter((row) => row.salesOpen && row.staffCompsEnabled);
        setPerformances(eligible);
        if (eligible.length > 0) {
          setPerformanceId((prev) => (prev && eligible.some((item) => item.id === prev) ? prev : eligible[0].id));
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to load performances'));
  }, []);

  useEffect(() => {
    if (!performanceId) {
      setSeats([]);
      setSeatId('');
      return;
    }

    apiFetch<Seat[]>(`/api/performances/${performanceId}/seats`)
      .then((rows) => {
        setSeats(rows);
        setSeatId((previousSeatId) => {
          const stillAvailable = rows.some(
            (seat) => seat.id === previousSeatId && seat.status === 'available' && !seat.isCompanion
          );
          if (stillAvailable) return previousSeatId;
          return rows.find((seat) => seat.status === 'available' && !seat.isCompanion)?.id || '';
        });
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to load seats'));
  }, [performanceId]);

  const reserveCompTicket = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const result = await apiFetch<{ orderId: string; orderAccessToken?: string }>('/tickets/staff-comp/reserve', {
        method: 'POST',
        body: JSON.stringify({
          performanceId,
          seatId,
          teacherPromoCode,
          customerName,
          customerEmail,
          attendeeName: attendeeName.trim() || undefined
        })
      });

      rememberOrderAccessToken(result.orderId, result.orderAccessToken);
      navigate(buildConfirmationPath(result.orderId, result.orderAccessToken));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to reserve staff comp ticket');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-stone-50 px-4 py-10 sm:py-16">
      <div className="mx-auto max-w-4xl rounded-3xl border border-stone-200 bg-white p-5 shadow-sm sm:p-8">
        <h1 className="mb-2 text-2xl font-black text-stone-900 sm:text-3xl">Teacher Complimentary Ticket</h1>
        <p className="mb-6 text-stone-600">Reserve complimentary teacher tickets using your teacher promo code.</p>

        <form onSubmit={reserveCompTicket} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input
              value={customerName}
              onChange={(event) => setCustomerName(event.target.value)}
              placeholder="Full name"
              className="w-full rounded-xl border border-stone-300 px-3 py-2"
              required
            />
            <input
              type="email"
              value={customerEmail}
              onChange={(event) => setCustomerEmail(event.target.value)}
              placeholder="Personal email"
              className="w-full rounded-xl border border-stone-300 px-3 py-2"
              required
            />
          </div>

          <select
            value={performanceId}
            onChange={(event) => setPerformanceId(event.target.value)}
            className="w-full rounded-xl border border-stone-300 px-3 py-2"
            required
          >
            {performances.map((performance) => (
              <option key={performance.id} value={performance.id}>
                {performance.title} - {new Date(performance.startsAt).toLocaleString()}
              </option>
            ))}
          </select>

          <div className="rounded-xl border border-stone-200 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold text-stone-900">Choose a Seat</h3>
              <div className="text-xs text-stone-500">
                {selectedSeat
                  ? `Selected: ${selectedSeat.sectionName} ${selectedSeat.row}-${selectedSeat.number}`
                  : 'Click an available seat'}
              </div>
            </div>

            <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-stone-500">
              <span className="inline-flex items-center gap-1">
                <span className="h-3 w-3 rounded-full border border-stone-300 bg-white" />
                Available
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-3 w-3 rounded-full bg-green-500" />
                Selected
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-3 w-3 rounded-full bg-orange-300" />
                Held
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-3 w-3 rounded-full bg-stone-300" />
                Unavailable
              </span>
            </div>

            {availableSeats.length === 0 ? (
              <div className="text-sm text-stone-500">No staff-comp seats are currently available for this performance.</div>
            ) : (
              <div className="max-h-80 space-y-4 overflow-y-auto pr-1">
                {sections.map((sectionName) => (
                  <div key={sectionName}>
                    <div className="mb-2 text-xs font-bold uppercase tracking-wide text-stone-500">{sectionName}</div>
                    <div className="space-y-2">
                      {Object.keys(seatGrid[sectionName]).sort(naturalSort).map((row) => (
                        <div key={`${sectionName}-${row}`} className="flex flex-col gap-2 sm:flex-row sm:items-start">
                          <div className="text-xs font-semibold text-stone-500 sm:w-10 sm:pt-2">Row {row}</div>
                          <div className="flex flex-wrap gap-2">
                            {seatGrid[sectionName][row].map((seat) => {
                              const selectable = seat.status === 'available' && !seat.isCompanion;
                              const selected = seat.id === seatId;

                              let statusClass = 'cursor-not-allowed border-stone-300 bg-stone-300 text-stone-600';
                              if (selected) statusClass = 'border-green-700 bg-green-600 text-white shadow-sm';
                              else if (selectable) statusClass = 'border-stone-300 bg-white text-stone-900 hover:border-stone-500 hover:bg-stone-50';
                              else if (seat.status === 'held') statusClass = 'cursor-not-allowed border-orange-300 bg-orange-200 text-orange-900';

                              return (
                                <button
                                  key={seat.id}
                                  type="button"
                                  onClick={() => selectable && setSeatId(seat.id)}
                                  disabled={!selectable}
                                  title={`${sectionName} Row ${seat.row} Seat ${seat.number}`}
                                  className={`min-w-10 rounded-lg border px-2 py-2 text-xs font-semibold transition-colors ${statusClass}`}
                                >
                                  {seat.number}
                                  {seat.isAccessible ? 'A' : ''}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <input
            value={attendeeName}
            onChange={(event) => setAttendeeName(event.target.value)}
            placeholder="Attendee name (optional)"
            className="w-full rounded-xl border border-stone-300 px-3 py-2"
          />

          <input
            value={teacherPromoCode}
            onChange={(event) => setTeacherPromoCode(event.target.value)}
            placeholder="Teacher promo code"
            className="w-full rounded-xl border border-stone-300 px-3 py-2"
            required
          />

          {selectedPerformance && (
            <div className="text-xs text-stone-500">
              Teacher comp limit per email for this performance: {selectedPerformance.staffCompLimitPerUser}
            </div>
          )}

          <button
            disabled={submitting || !performanceId || !seatId}
            className="w-full rounded-xl bg-stone-900 px-5 py-3 font-bold text-white disabled:opacity-50"
          >
            {submitting ? 'Reserving...' : 'Reserve Staff Comp Ticket'}
          </button>
        </form>

        {error && <div className="mt-4 text-sm text-red-600">{error}</div>}
      </div>
    </div>
  );
}
