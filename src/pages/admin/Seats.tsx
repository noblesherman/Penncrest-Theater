import { FormEvent, useEffect, useMemo, useState } from 'react';
import { adminFetch } from '../../lib/adminAuth';
import { apiFetch } from '../../lib/api';

type Performance = { id: string; title: string; startsAt: string; isArchived: boolean };
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
  const [scope, setScope] = useState<'active' | 'archived' | 'all'>('active');
  const [performanceId, setPerformanceId] = useState('');
  const [seats, setSeats] = useState<Seat[]>([]);
  const [seatIdsInput, setSeatIdsInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const loadPerformances = () => {
    adminFetch<any[]>(`/api/admin/performances?scope=${scope}`)
      .then((rows) => {
        const mapped = rows.map((row) => ({
          id: row.id,
          title: row.title,
          startsAt: row.startsAt,
          isArchived: Boolean(row.isArchived)
        }));
        setPerformances(mapped);
        if (mapped.length === 0) {
          setPerformanceId('');
          setSeats([]);
          return;
        }

        const stillExists = mapped.some((row) => row.id === performanceId);
        if (!stillExists) {
          setPerformanceId(mapped[0].id);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load performances'));
  };

  const loadSeats = async () => {
    if (!performanceId) return;

    try {
      const adminSeats = await adminFetch<Seat[]>(`/api/admin/performances/${performanceId}/seats`);
      setSeats(adminSeats);
      setError(null);
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load seats';

      // Backward compatibility: if backend route is older and missing this admin endpoint,
      // fall back to the public seats endpoint for active performances.
      if (!message.toLowerCase().includes('not found')) {
        setError(message);
        return;
      }
    }

    try {
      const publicSeats = await apiFetch<Seat[]>(`/api/performances/${performanceId}/seats`);
      setSeats(publicSeats);
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load seats';
      setError(
        message.toLowerCase().includes('not found')
          ? 'Seats endpoint not available. Restart the backend so admin seat routes load, or switch to an active performance.'
          : message
      );
    }
  };

  useEffect(() => {
    loadPerformances();
  }, [scope]);

  useEffect(() => {
    void loadSeats();
  }, [performanceId]);

  const selectedSeatIds = useMemo(
    () => seatIdsInput.split(',').map((value) => value.trim()).filter(Boolean),
    [seatIdsInput]
  );
  const selectedPerformance = performances.find((performance) => performance.id === performanceId);
  const selectedPerformanceArchived = Boolean(selectedPerformance?.isArchived);

  const submitMutation = async (event: FormEvent, mode: 'block' | 'unblock') => {
    event.preventDefault();
    setError(null);

    if (selectedPerformanceArchived) {
      setError('Archived performances are read-only.');
      return;
    }

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
    if (selectedPerformanceArchived) {
      setError('Archived performances are read-only.');
      return;
    }

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
      <h1 className="text-2xl font-bold text-stone-900 mb-5">Seat Management</h1>

      <div className="flex flex-wrap gap-2 mb-5 text-sm">
        <span className="bg-stone-100 rounded-full px-3 py-1">Available {statusCounts.available}</span>
        <span className="bg-orange-100 rounded-full px-3 py-1">Held {statusCounts.held}</span>
        <span className="bg-stone-200 rounded-full px-3 py-1">Sold {statusCounts.sold}</span>
        <span className="bg-red-100 rounded-full px-3 py-1">Blocked {statusCounts.blocked}</span>
      </div>

      <form className="border border-stone-200 rounded-2xl p-4 mb-6 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <select value={scope} onChange={(event) => setScope(event.target.value as 'active' | 'archived' | 'all')} className="border border-stone-300 rounded-xl px-3 py-2">
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="all">All</option>
          </select>
          <select value={performanceId} onChange={(event) => setPerformanceId(event.target.value)} className="border border-stone-300 rounded-xl px-3 py-2">
            {performances.map((performance) => (
              <option key={performance.id} value={performance.id}>
                {performance.title} - {new Date(performance.startsAt).toLocaleString()} {performance.isArchived ? '(Archived)' : ''}
              </option>
            ))}
          </select>
        </div>

        <input
          value={seatIdsInput}
          onChange={(event) => setSeatIdsInput(event.target.value)}
          placeholder="Seat IDs, comma-separated"
          className="w-full border border-stone-300 rounded-xl px-3 py-2"
        />

        {error && <div className="text-red-600 text-sm">{error}</div>}
        {selectedPerformanceArchived ? <div className="text-amber-700 text-sm">Archived performance selected. Seat edits are disabled.</div> : null}

        <div className="flex flex-wrap gap-2">
          <button
            onClick={(event) => submitMutation(event, 'block')}
            disabled={selectedPerformanceArchived}
            className="w-full rounded-lg bg-red-600 px-4 py-2 font-bold text-white disabled:bg-red-300 sm:w-auto"
          >
            Block Seats
          </button>
          <button
            onClick={(event) => submitMutation(event, 'unblock')}
            disabled={selectedPerformanceArchived}
            className="w-full rounded-lg bg-red-700 px-4 py-2 font-bold text-white disabled:bg-stone-400 sm:w-auto"
          >
            Unblock Seats
          </button>
          <button type="button" onClick={() => void loadSeats()} className="w-full rounded-lg border border-stone-300 px-4 py-2 sm:w-auto">
            Refresh
          </button>
        </div>
      </form>

      <div className="max-h-[420px] overflow-auto border border-stone-200 rounded-xl">
        <table className="w-full min-w-[760px] text-sm">
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
                        disabled={selectedPerformanceArchived}
                        onChange={(event) => updateSeatFlags(seat.id, { isAccessible: event.target.checked })}
                      />
                      Accessible
                    </label>
                    <label className="inline-flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={Boolean(seat.isCompanion)}
                        disabled={selectedPerformanceArchived}
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
                        disabled={selectedPerformanceArchived}
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
