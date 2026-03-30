import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { RefreshCw, X, Lock, Unlock, AlertCircle } from 'lucide-react';
import { SeatMapViewport } from '../../components/SeatMapViewport';
import { adminFetch } from '../../lib/adminAuth';
import { apiFetch } from '../../lib/api';

type Performance = { id: string; title: string; startsAt: string; isArchived: boolean };
type Seat = {
  id: string; sectionName: string; row: string; number: number;
  x: number; y: number; price: number;
  status: 'available' | 'held' | 'sold' | 'blocked';
  isAccessible?: boolean; isCompanion?: boolean; companionForSeatId?: string | null;
};

const naturalSort = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

function normalizeSeat(raw: any): Seat {
  const rawStatus = String(raw?.status || 'available').toLowerCase();
  const status: Seat['status'] = ['available', 'held', 'sold', 'blocked'].includes(rawStatus)
    ? (rawStatus as Seat['status']) : 'available';
  const sectionOffset = raw?.sectionName === 'LEFT' ? 0 : raw?.sectionName === 'CENTER' ? 700 : 1400;
  const rowCode = String(raw?.row || 'A').charCodeAt(0) || 65;
  return {
    id: String(raw?.id || ''),
    sectionName: String(raw?.sectionName || 'Unknown'),
    row: String(raw?.row || ''),
    number: Number(raw?.number || 0),
    x: Number.isFinite(Number(raw?.x)) ? Number(raw.x) : sectionOffset + Number(raw?.number || 0) * 36,
    y: Number.isFinite(Number(raw?.y)) ? Number(raw.y) : (rowCode - 65) * 40,
    price: Number(raw?.price || 0),
    status,
    isAccessible: Boolean(raw?.isAccessible),
    isCompanion: Boolean(raw?.isCompanion),
    companionForSeatId: raw?.companionForSeatId ?? null,
  };
}

const STATUS_DOT: Record<string, string> = {
  available: 'bg-white border-2 border-stone-300',
  held:      'bg-amber-300',
  sold:      'bg-stone-400',
  blocked:   'bg-red-300',
};
const STATUS_LABEL: Record<string, string> = {
  available: 'text-stone-600',
  held:      'text-amber-700',
  sold:      'text-stone-500',
  blocked:   'text-red-600',
};

// ── main ─────────────────────────────────────────────────────────────────────

export default function AdminSeatsPage() {
  const [performances,  setPerformances]  = useState<Performance[]>([]);
  const [scope,         setScope]         = useState<'active' | 'archived' | 'all'>('active');
  const [performanceId, setPerformanceId] = useState('');
  const [seats,         setSeats]         = useState<Seat[]>([]);
  const [loadingSeats,  setLoadingSeats]  = useState(false);
  const [activeSection, setActiveSection] = useState<string>('All');
  const [seatIdsInput,  setSeatIdsInput]  = useState('');
  const [error,         setError]         = useState<string | null>(null);

  // ── data ──────────────────────────────────────────────────────────────────

  const loadPerformances = () => {
    adminFetch<any[]>(`/api/admin/performances?scope=${scope}`)
      .then(rows => {
        const mapped = rows.map(r => ({ id: r.id, title: r.title, startsAt: r.startsAt, isArchived: Boolean(r.isArchived) }));
        setPerformances(mapped);
        if (!mapped.length) { setPerformanceId(''); setSeats([]); return; }
        if (!mapped.some(r => r.id === performanceId)) setPerformanceId(mapped[0].id);
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load performances'));
  };

  const loadSeats = useCallback(async () => {
    if (!performanceId) return;
    setLoadingSeats(true);
    try {
      try {
        setSeats((await adminFetch<any[]>(`/api/admin/performances/${performanceId}/seats`)).map(normalizeSeat));
        setError(null); return;
      } catch (e) {
        if (!(e instanceof Error && e.message.toLowerCase().includes('not found'))) { setError(e instanceof Error ? e.message : 'Failed'); return; }
      }
      try {
        setSeats((await apiFetch<any[]>(`/api/performances/${performanceId}/seats`)).map(normalizeSeat));
        setError(null);
      } catch (e) {
        setError(e instanceof Error && e.message.toLowerCase().includes('not found')
          ? 'Seats endpoint unavailable. Restart the backend or switch to an active performance.'
          : e instanceof Error ? e.message : 'Failed to load seats');
      }
    } finally { setLoadingSeats(false); }
  }, [performanceId]);

  useEffect(() => { loadPerformances(); }, [scope]);
  useEffect(() => { void loadSeats(); }, [loadSeats]);

  // ── selection ─────────────────────────────────────────────────────────────

  const selectedSeatIds = useMemo(
    () => [...new Set<string>(seatIdsInput.split(',').map(v => v.trim()).filter((value): value is string => Boolean(value)))],
    [seatIdsInput]
  );
  const selectedSeatIdSet = useMemo(() => new Set(selectedSeatIds), [selectedSeatIds]);

  const updateSelectedSeatIds = useCallback((updater: (c: string[]) => string[]) => {
    setSeatIdsInput(prev => {
      const current: string[] = [
        ...new Set<string>(prev.split(',').map(v => v.trim()).filter((value): value is string => Boolean(value)))
      ];
      return [...new Set<string>(updater(current))].join(', ');
    });
  }, []);

  const toggleSeat = useCallback((id: string) => {
    updateSelectedSeatIds(c => c.includes(id) ? c.filter(x => x !== id) : [...c, id]);
  }, [updateSelectedSeatIds]);

  // ── mutations ─────────────────────────────────────────────────────────────

  const selectedPerformance = performances.find(p => p.id === performanceId);
  const isArchived = Boolean(selectedPerformance?.isArchived);

  const submitMutation = async (mode: 'block' | 'unblock') => {
    if (isArchived) { setError('Archived performances are read-only.'); return; }
    if (!performanceId || !selectedSeatIds.length) { setError('Choose a performance and provide seat IDs.'); return; }
    setError(null);
    try {
      await adminFetch(`/api/admin/seats/${mode}`, { method: 'POST', body: JSON.stringify({ performanceId, seatIds: selectedSeatIds }) });
      setSeatIdsInput('');
      await loadSeats();
    } catch (e) { setError(e instanceof Error ? e.message : `Failed to ${mode} seats`); }
  };

  const updateSeatFlags = async (seatId: string, payload: { isAccessible?: boolean; isCompanion?: boolean; companionForSeatId?: string | null }) => {
    if (!performanceId || isArchived) { if (isArchived) setError('Archived performances are read-only.'); return; }
    setError(null);
    try {
      await adminFetch('/api/admin/seats/update', { method: 'POST', body: JSON.stringify({ performanceId, seatId, ...payload }) });
      await loadSeats();
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to update seat'); }
  };

  const sections = useMemo(() => [...new Set(seats.map(s => s.sectionName))].sort(naturalSort), [seats]);

  useEffect(() => { if (activeSection !== 'All' && !sections.includes(activeSection)) setActiveSection('All'); }, [activeSection, sections]);

  const visibleSeats = useMemo(
    () => seats.filter(s => activeSection === 'All' || s.sectionName === activeSection),
    [activeSection, seats]
  );

  const seatById = useMemo(() => new Map(seats.map(s => [s.id, s])), [seats]);

  const selectedMappedSeats = useMemo(() =>
    selectedSeatIds.map(id => seatById.get(id)).filter((s): s is Seat => Boolean(s))
      .sort((a, b) => naturalSort(a.sectionName, b.sectionName) || naturalSort(a.row, b.row) || a.number - b.number),
    [seatById, selectedSeatIds]
  );

  const selectedUnknownSeatIds = useMemo(() => selectedSeatIds.filter(id => !seatById.has(id)), [seatById, selectedSeatIds]);

  const statusCounts = seats.reduce((acc, s) => { acc[s.status]++; return acc; }, { available: 0, held: 0, sold: 0, blocked: 0 });

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-5xl space-y-5" style={{ fontFamily: 'var(--font-sans)' }}>

      {/* header */}
      <div>
        <h1 className="text-2xl font-bold text-stone-900" style={{ fontFamily: 'var(--font-sans)' }}>Seat Management</h1>
        <p className="text-sm text-stone-400 mt-0.5">Click seats on the chart or type IDs to select, then block or unblock.</p>
      </div>

      {/* error */}
      <AnimatePresence>
        {error && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="flex items-center gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
            <button onClick={() => setError(null)} className="ml-auto text-red-300 hover:text-red-600"><X className="w-4 h-4" /></button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* controls card */}
      <div className="rounded-2xl border border-stone-100 bg-white p-4 space-y-4">

        {/* performance selectors */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-stone-400 mb-1.5">Scope</label>
            <select value={scope} onChange={e => setScope(e.target.value as any)}
              className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-100 transition">
              <option value="active">Active</option>
              <option value="archived">Archived</option>
              <option value="all">All</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-widest text-stone-400 mb-1.5">Performance</label>
            <select value={performanceId} onChange={e => setPerformanceId(e.target.value)}
              className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-100 transition">
              {performances.map(p => (
                <option key={p.id} value={p.id}>{p.title} — {new Date(p.startsAt).toLocaleDateString()}{p.isArchived ? ' (Archived)' : ''}</option>
              ))}
            </select>
          </div>
        </div>

        {isArchived && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-700 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" /> Archived performance — seat edits are disabled.
          </div>
        )}

        {/* seat ID input */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-widest text-stone-400 mb-1.5">Seat IDs <span className="normal-case font-normal text-stone-300">(comma-separated, or click on chart)</span></label>
          <input value={seatIdsInput} onChange={e => setSeatIdsInput(e.target.value)}
            placeholder="e.g. A1, A2, B3…"
            className="w-full rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-100 transition" />
          <p className="text-xs text-stone-400 mt-1">{selectedSeatIds.length} seat{selectedSeatIds.length !== 1 ? 's' : ''} selected</p>
        </div>

        {/* actions */}
        <div className="flex flex-wrap gap-2">
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }} type="button"
            onClick={() => void submitMutation('block')} disabled={isArchived}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-red-700 px-5 py-2.5 text-sm font-semibold text-white transition shadow-sm shadow-red-100 hover:bg-red-800 disabled:opacity-40 sm:w-auto">
            <Lock className="w-3.5 h-3.5" /> Block Seats
          </motion.button>
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }} type="button"
            onClick={() => void submitMutation('unblock')} disabled={isArchived}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-stone-800 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-stone-900 disabled:opacity-40 sm:w-auto">
            <Unlock className="w-3.5 h-3.5" /> Unblock Seats
          </motion.button>
          <button type="button" onClick={() => void loadSeats()}
            className="flex w-full items-center justify-center gap-2 rounded-full border border-stone-200 px-4 py-2.5 text-sm font-semibold text-stone-600 transition hover:bg-stone-50 sm:w-auto">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
          {selectedSeatIds.length > 0 && (
            <button type="button" onClick={() => setSeatIdsInput('')}
              className="flex w-full items-center justify-center gap-2 rounded-full border border-stone-200 px-4 py-2.5 text-sm font-semibold text-stone-500 transition hover:bg-stone-50 sm:w-auto">
              <X className="w-3.5 h-3.5" /> Clear
            </button>
          )}
        </div>

        {/* status summary chips */}
        <div className="flex flex-wrap gap-2 pt-1 border-t border-stone-100">
          {(Object.entries(statusCounts) as [string, number][]).map(([s, count]) => (
            <span key={s} className="inline-flex items-center gap-1.5 rounded-full bg-stone-50 border border-stone-200 px-3 py-1 text-xs font-semibold">
              <span className={`w-2 h-2 rounded-full ${STATUS_DOT[s]}`} />
              <span className={STATUS_LABEL[s]}>{s.charAt(0).toUpperCase() + s.slice(1)}</span>
              <span className="text-stone-400">{count}</span>
            </span>
          ))}
        </div>
      </div>

      {/* ── seating chart ── */}
      <div className="rounded-2xl border border-stone-100 bg-white overflow-hidden">

        {/* chart header */}
        <div className="border-b border-stone-100 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1.5">
            {['All', ...sections].map(section => (
              <button key={section} type="button" onClick={() => setActiveSection(section)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-all ${
                  activeSection === section ? 'bg-red-700 text-white shadow-sm' : 'bg-stone-100 text-stone-500 hover:bg-stone-200'
                }`}>
                {section}
              </button>
            ))}
          </div>
          <p className="text-xs font-medium text-stone-400">Drag to pan. Scroll or pinch to zoom.</p>
        </div>

        {/* legend */}
        <div className="px-4 py-2 border-b border-stone-50 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-500">
          {[
            ['Available', 'bg-white border-2 border-stone-300'],
            ['Held',      'bg-amber-300'],
            ['Sold',      'bg-stone-300'],
            ['Blocked',   'bg-red-300'],
            ['Selected',  'bg-green-500'],
            ['Accessible','bg-blue-400'],
            ['Companion', 'bg-cyan-400'],
          ].map(([label, cls]) => (
            <span key={label} className="inline-flex items-center gap-1.5">
              <span className={`w-2.5 h-2.5 rounded-full ${cls}`} />{label}
            </span>
          ))}
        </div>

        {/* map viewport — fixed height, contained */}
        <SeatMapViewport
          seats={seats}
          visibleSeats={visibleSeats}
          loading={loadingSeats}
          loadingLabel="Loading seats..."
          emptyText="No seats for this performance."
          resetKey={performanceId || 'admin-seat-map'}
          containerClassName="h-[420px] sm:h-[480px]"
          controlsClassName="absolute bottom-4 right-4 z-30 flex flex-col gap-2"
          renderSeat={({ seat, x, y }) => {
            const isSelected = selectedSeatIdSet.has(seat.id);
            const colorCls = isSelected
              ? 'bg-green-500 text-white shadow-lg scale-110 z-10 ring-2 ring-green-300'
              : seat.status === 'blocked'
                ? 'bg-red-200 border-2 border-red-400 text-red-900 hover:bg-red-100 hover:shadow-md hover:-translate-y-1'
                : seat.status === 'sold'
                  ? 'bg-stone-200 border-2 border-stone-300 text-stone-500 hover:bg-stone-100 hover:shadow-md hover:-translate-y-1'
                  : seat.status === 'held'
                    ? 'bg-orange-200 border-2 border-orange-300 text-orange-700 hover:bg-orange-100 hover:shadow-md hover:-translate-y-1'
                    : seat.isCompanion
                      ? 'bg-cyan-100 border-2 border-cyan-400 text-cyan-700 hover:border-cyan-500 hover:bg-cyan-50 hover:shadow-md hover:-translate-y-1'
                      : seat.isAccessible
                        ? 'bg-blue-100 border-2 border-blue-400 text-blue-700 hover:border-blue-500 hover:bg-blue-50 hover:shadow-md hover:-translate-y-1'
                        : 'bg-white border-2 border-stone-200 text-stone-600 hover:border-red-400 hover:shadow-md hover:-translate-y-1';

            return (
              <button
                key={seat.id}
                type="button"
                onClick={() => toggleSeat(seat.id)}
                style={{ left: `${x}px`, top: `${y}px` }}
                title={`${seat.id} · ${seat.sectionName} ${seat.row}-${seat.number} · ${seat.status}`}
                className={`seat-button absolute flex h-8 w-8 md:h-10 md:w-10 items-center justify-center rounded-t-lg rounded-b-md text-[10px] font-bold transition-all duration-200 ${colorCls}`}
              >
                <div className={`absolute -left-1 bottom-1 h-4 w-1 rounded-full opacity-55 ${isSelected ? 'bg-green-600' : seat.isCompanion ? 'bg-cyan-500' : seat.isAccessible ? 'bg-blue-500' : 'bg-stone-300'}`} />
                <div className={`absolute -right-1 bottom-1 h-4 w-1 rounded-full opacity-55 ${isSelected ? 'bg-green-600' : seat.isCompanion ? 'bg-cyan-500' : seat.isAccessible ? 'bg-blue-500' : 'bg-stone-300'}`} />
                {seat.number}
              </button>
            );
          }}
        />

        {/* selected seat chips */}
        <div className="border-t border-stone-100 px-4 py-3 min-h-[52px]">
          {selectedMappedSeats.length === 0 && selectedUnknownSeatIds.length === 0
            ? <p className="text-sm text-stone-300">Click seats on the chart to select them.</p>
            : (
              <div className="flex flex-wrap gap-2">
                {selectedMappedSeats.map(s => (
                  <button key={s.id} type="button" onClick={() => toggleSeat(s.id)}
                    className="inline-flex items-center gap-1 rounded-full border border-red-100 bg-red-50 px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-100 transition">
                    {s.sectionName} {s.row}-{s.number} <X className="w-3 h-3" />
                  </button>
                ))}
                {selectedUnknownSeatIds.map(id => (
                  <button key={id} type="button" onClick={() => toggleSeat(id)}
                    className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-100 transition">
                    ? {id.slice(0, 8)}… <X className="w-3 h-3" />
                  </button>
                ))}
              </div>
            )
          }
        </div>
      </div>

      {/* ── seat table ── */}
      <div className="rounded-2xl border border-stone-100 bg-white overflow-hidden">
        <div className="border-b border-stone-100 px-4 py-3">
          <p className="text-sm font-semibold text-stone-700">All Seats</p>
          <p className="text-xs text-stone-400 mt-0.5">{seats.length} seats total</p>
        </div>
        <div className="overflow-auto" style={{ maxHeight: 400 }}>
          <table className="w-full min-w-[720px] text-sm">
            <thead className="sticky top-0 bg-stone-50 border-b border-stone-100">
              <tr>
                {['Seat ID', 'Section', 'Row', '#', 'Status', 'Accessibility'].map(h => (
                  <th key={h} className="text-left px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-stone-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-50">
              {seats.map(seat => (
                <tr key={seat.id} className={`hover:bg-stone-50 transition ${selectedSeatIdSet.has(seat.id) ? 'bg-red-50/60' : ''}`}>
                  <td className="px-4 py-2.5 text-xs font-sans text-stone-500">{seat.id}</td>
                  <td className="px-4 py-2.5 text-stone-700">{seat.sectionName}</td>
                  <td className="px-4 py-2.5 text-stone-700">{seat.row}</td>
                  <td className="px-4 py-2.5 text-stone-700">{seat.number}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold border ${
                      seat.status === 'available' ? 'bg-green-50 text-green-700 border-green-200' :
                      seat.status === 'held'      ? 'bg-amber-50 text-amber-700 border-amber-200' :
                      seat.status === 'sold'      ? 'bg-stone-100 text-stone-500 border-stone-200' :
                                                    'bg-red-50 text-red-700 border-red-200'
                    }`}>
                      {seat.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                        <input type="checkbox" checked={Boolean(seat.isAccessible)} disabled={isArchived}
                          onChange={e => void updateSeatFlags(seat.id, { isAccessible: e.target.checked })}
                          className="w-3.5 h-3.5 accent-red-700" />
                        <span className="text-stone-600">Accessible</span>
                      </label>
                      <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
                        <input type="checkbox" checked={Boolean(seat.isCompanion)} disabled={isArchived}
                          onChange={e => void updateSeatFlags(seat.id, { isCompanion: e.target.checked, companionForSeatId: e.target.checked ? seat.companionForSeatId || null : null })}
                          className="w-3.5 h-3.5 accent-red-700" />
                        <span className="text-stone-600">Companion</span>
                      </label>
                      {seat.isCompanion && (
                        <select value={seat.companionForSeatId || ''} disabled={isArchived}
                          onChange={e => void updateSeatFlags(seat.id, { companionForSeatId: e.target.value || null, isCompanion: true })}
                          className="rounded-lg border border-stone-200 px-2 py-1 text-xs text-stone-600 focus:border-red-400 focus:outline-none">
                          <option value="">No pair</option>
                          {seats.filter(c => c.id !== seat.id && c.isAccessible).map(c => (
                            <option key={c.id} value={c.id}>{c.sectionName} {c.row}-{c.number}</option>
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
    </div>
  );
}
