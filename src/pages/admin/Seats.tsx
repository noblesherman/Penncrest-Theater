import { FormEvent, useEffect, useMemo, useState } from 'react';
import { adminFetch } from '../../lib/adminAuth';
import { apiFetch } from '../../lib/api';

type Performance = { id: string; title: string; startsAt: string };
type Seat = {
  id: string;
  sectionName: string;
  row: string;
  number: number;
  status: 'available' | 'held' | 'sold' | 'blocked';
  isAccessible?: boolean;
  isCompanion?: boolean;
  companionForSeatId?: string | null;
};

export default function AdminSeatsPage() {
  const [performances, setPerformances] = useState<Performance[]>([]);
  const [performanceId, setPerformanceId] = useState('');
  const [seats, setSeats] = useState<Seat[]>([]);
  const [seatIdsInput, setSeatIdsInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const loadPerformances = () => {
    adminFetch<any[]>('/api/admin/performances')
      .then((rows) => {
        const mapped = rows.map((row) => ({ id: row.id, title: row.title, startsAt: row.startsAt }));
        setPerformances(mapped);
        if (!performanceId && mapped.length > 0) setPerformanceId(mapped[0].id);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load performances'));
  };

  const loadSeats = () => {
    if (!performanceId) return;
    apiFetch<Seat[]>(`/api/performances/${performanceId}/seats`)
      .then(setSeats)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load seats'));
  };

  useEffect(() => {
    loadPerformances();
  }, []);

  useEffect(() => {
    loadSeats();
  }, [performanceId]);

  const selectedSeatIds = useMemo(
    () => seatIdsInput.split(',').map((value) => value.trim()).filter(Boolean),
    [seatIdsInput]
  );

  const submitMutation = async (event: FormEvent, mode: 'block' | 'unblock') => {
    event.preventDefault();
    setError(null);

    if (!performanceId || selectedSeatIds.length === 0) {
      setError('Choose a performance and provide one or more seat IDs.');
      return;
    }

    try {
      await adminFetch(`/api/admin/seats/${mode}`, {
        method: 'POST',
        body: JSON.stringify({ performanceId, seatIds: selectedSeatIds })
      });
      setSeatIdsInput('');
      loadSeats();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${mode} seats`);
    }
  };

  const updateSeatFlags = async (
    seatId: string,
    payload: {
      isAccessible?: boolean;
      isCompanion?: boolean;
      companionForSeatId?: string | null;
    }
  ) => {
    if (!performanceId) return;

    setError(null);
    try {
      await adminFetch('/api/admin/seats/update', {
        method: 'POST',
        body: JSON.stringify({
          performanceId,
          seatId,
          ...payload
        })
      });
      loadSeats();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update seat flags');
    }
  };

  const statusCounts = seats.reduce(
    (acc, seat) => {
      acc[seat.status] += 1;
      return acc;
    },
    { available: 0, held: 0, sold: 0, blocked: 0 }
  );

  return (
    <div>
      <h1 className="text-2xl font-black text-stone-900 mb-5">Seat Management</h1>

      <div className="flex flex-wrap gap-2 mb-5 text-sm">
        <span className="bg-stone-100 rounded-full px-3 py-1">Available {statusCounts.available}</span>
        <span className="bg-orange-100 rounded-full px-3 py-1">Held {statusCounts.held}</span>
        <span className="bg-stone-200 rounded-full px-3 py-1">Sold {statusCounts.sold}</span>
        <span className="bg-red-100 rounded-full px-3 py-1">Blocked {statusCounts.blocked}</span>
      </div>

      <form className="border border-stone-200 rounded-2xl p-4 mb-6 space-y-3">
        <select value={performanceId} onChange={(event) => setPerformanceId(event.target.value)} className="w-full border border-stone-300 rounded-xl px-3 py-2">
          {performances.map((performance) => (
            <option key={performance.id} value={performance.id}>
              {performance.title} - {new Date(performance.startsAt).toLocaleString()}
            </option>
          ))}
        </select>

        <input
          value={seatIdsInput}
          onChange={(event) => setSeatIdsInput(event.target.value)}
          placeholder="Seat IDs, comma-separated"
          className="w-full border border-stone-300 rounded-xl px-3 py-2"
        />

        {error && <div className="text-red-600 text-sm">{error}</div>}

        <div className="flex gap-2">
          <button onClick={(event) => submitMutation(event, 'block')} className="bg-red-600 text-white px-4 py-2 rounded-lg font-bold">Block Seats</button>
          <button onClick={(event) => submitMutation(event, 'unblock')} className="bg-stone-900 text-white px-4 py-2 rounded-lg font-bold">Unblock Seats</button>
          <button type="button" onClick={loadSeats} className="border border-stone-300 px-4 py-2 rounded-lg">Refresh</button>
        </div>
      </form>

      <div className="max-h-[420px] overflow-auto border border-stone-200 rounded-xl">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 sticky top-0">
            <tr>
              <th className="text-left px-3 py-2">Seat ID</th>
              <th className="text-left px-3 py-2">Section</th>
              <th className="text-left px-3 py-2">Row</th>
              <th className="text-left px-3 py-2">Number</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="text-left px-3 py-2">Accessibility</th>
            </tr>
          </thead>
          <tbody>
            {seats.map((seat) => (
              <tr key={seat.id} className="border-t border-stone-100">
                <td className="px-3 py-2 text-xs">{seat.id}</td>
                <td className="px-3 py-2">{seat.sectionName}</td>
                <td className="px-3 py-2">{seat.row}</td>
                <td className="px-3 py-2">{seat.number}</td>
                <td className="px-3 py-2 capitalize">{seat.status}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <label className="inline-flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={Boolean(seat.isAccessible)}
                        onChange={(event) => updateSeatFlags(seat.id, { isAccessible: event.target.checked })}
                      />
                      Accessible
                    </label>
                    <label className="inline-flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={Boolean(seat.isCompanion)}
                        onChange={(event) =>
                          updateSeatFlags(seat.id, {
                            isCompanion: event.target.checked,
                            companionForSeatId: event.target.checked ? seat.companionForSeatId || null : null
                          })
                        }
                      />
                      Companion
                    </label>
                    {seat.isCompanion && (
                      <select
                        value={seat.companionForSeatId || ''}
                        onChange={(event) =>
                          updateSeatFlags(seat.id, { companionForSeatId: event.target.value || null, isCompanion: true })
                        }
                        className="border border-stone-300 rounded px-1 py-0.5 text-xs"
                      >
                        <option value="">No pair</option>
                        {seats
                          .filter((candidate) => candidate.id !== seat.id && candidate.isAccessible)
                          .map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>
                              {candidate.sectionName} {candidate.row}-{candidate.number}
                            </option>
                          ))}
                      </select>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
