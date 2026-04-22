/*
Handoff note for Mr. Smith:
- File: `src/pages/admin/Roster.tsx`
- What this is: Admin route page.
- What it does: Runs one full admin screen with data loading and operator actions.
- Connections: Wired from `src/App.tsx`; depends on admin auth helpers and backend admin routes.
- Main content type: Business logic + admin UI + visible wording.
- Safe edits here: Table labels, section copy, and presentational layout.
- Be careful with: Request/response contracts, auth checks, and state transitions tied to backend behavior.
- Useful context: Operationally sensitive area: UI polish is safe, contract changes need extra care.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { FormEvent, useEffect, useState } from 'react';
import { adminFetch } from '../../lib/adminAuth';

type Performance = { id: string; title: string; startsAt: string };
type RosterRow = {
  orderId: string;
  source: 'ONLINE' | 'DOOR' | 'COMP' | 'STAFF_FREE' | 'FAMILY_FREE' | 'STUDENT_COMP';
  customerName: string;
  customerEmail: string;
  attendeeName: string;
  showTitle: string;
  startsAt: string;
  venue: string;
  sectionName: string;
  row: string;
  number: number;
  ticketType?: string | null;
  isComplimentary?: boolean;
  ticketPublicId: string | null;
};

export default function AdminRosterPage() {
  const [performances, setPerformances] = useState<Performance[]>([]);
  const [performanceId, setPerformanceId] = useState('');
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'active' | 'archived' | 'all'>('active');
  const [rows, setRows] = useState<RosterRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPerformances = async () => {
    try {
      const items = await adminFetch<Array<{ id: string; title: string; startsAt: string }>>(`/api/admin/performances?scope=${scope}`);
      const mapped = items.map((item) => ({ id: item.id, title: item.title, startsAt: item.startsAt }));
      setPerformances(mapped);
      if (mapped.length === 0) {
        setPerformanceId('');
        setRows([]);
        return;
      }
      setPerformanceId((prev) => (mapped.some((item) => item.id === prev) ? prev : mapped[0].id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to load performances');
    }
  };

  const load = async (targetPerformanceId: string, targetQuery = query) => {
    if (!targetPerformanceId) {
      setRows([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('performanceId', targetPerformanceId);
      if (targetQuery.trim()) params.set('q', targetQuery.trim());
      params.set('scope', scope);

      const result = await adminFetch<RosterRow[]>(`/api/admin/roster?${params.toString()}`);
      setRows(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to load roster');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPerformances();
  }, [scope]);

  useEffect(() => {
    if (!performanceId) return;
    void load(performanceId);
  }, [performanceId]);

  const onSearch = (event: FormEvent) => {
    event.preventDefault();
    void load(performanceId, query);
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-stone-900" style={{ fontFamily: 'var(--font-sans)' }}>Attendee Roster</h1>
        <p className="text-sm text-stone-600">Search by attendee, buyer, email, or order.</p>
      </div>

      {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}

      <form onSubmit={onSearch} className="flex flex-wrap gap-2">
        <select value={performanceId} onChange={(event) => setPerformanceId(event.target.value)} className="w-full rounded-xl border border-stone-300 px-3 py-2 sm:w-auto">
          {performances.map((performance) => (
            <option key={performance.id} value={performance.id}>
              {performance.title} - {new Date(performance.startsAt).toLocaleString()}
            </option>
          ))}
        </select>
        <select
          value={scope}
          onChange={(event) => setScope(event.target.value as 'active' | 'archived' | 'all')}
          className="w-full rounded-xl border border-stone-300 px-3 py-2 sm:w-auto"
        >
          <option value="active">Active</option>
          <option value="archived">Archived</option>
          <option value="all">All</option>
        </select>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search attendee, buyer, email, order"
          className="w-full min-w-0 flex-1 rounded-xl border border-stone-300 px-3 py-2 sm:min-w-[200px]"
        />
        <button className="w-full rounded-xl bg-red-700 px-4 py-2 font-semibold text-white hover:bg-red-800 transition-colors sm:w-auto">Search</button>
      </form>

      {loading ? <div className="text-sm text-stone-500">Loading roster...</div> : null}
      {!loading && rows.length === 0 ? <div className="text-sm text-stone-500">No attendee rows found for the selected filters.</div> : null}

      <div className="space-y-3 md:hidden">
        {rows.map((row) => (
          <div key={`${row.orderId}-${row.sectionName}-${row.row}-${row.number}`} className="rounded-2xl border border-stone-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-stone-900">{row.attendeeName}</p>
                <p className="text-xs text-stone-500">{row.customerName}</p>
                <p className="text-xs text-stone-400">{row.customerEmail}</p>
              </div>
              <span className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-semibold text-stone-600">{row.source}</span>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-stone-500">
              <div>
                <span className="font-semibold text-stone-700">Seat:</span> {row.sectionName} {row.row}-{row.number}
              </div>
              <div>
                <span className="font-semibold text-stone-700">Order:</span> {row.orderId}
              </div>
              <div>
                <span className="font-semibold text-stone-700">Ticket:</span> {row.ticketPublicId || '-'}
              </div>
              {row.ticketType ? <div><span className="font-semibold text-stone-700">Type:</span> {row.ticketType}</div> : null}
              {row.isComplimentary ? <div className="font-semibold text-green-700">Complimentary</div> : null}
            </div>
          </div>
        ))}
      </div>

      <div className="hidden max-h-[520px] overflow-auto rounded-xl border border-stone-200 md:block">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-stone-50 sticky top-0">
            <tr>
              <th className="text-left px-3 py-2">Attendee</th>
              <th className="text-left px-3 py-2">Buyer</th>
              <th className="text-left px-3 py-2">Seat</th>
              <th className="text-left px-3 py-2">Source</th>
              <th className="text-left px-3 py-2">Order</th>
              <th className="text-left px-3 py-2">Ticket</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.orderId}-${row.sectionName}-${row.row}-${row.number}`} className="border-t border-stone-100">
                <td className="px-3 py-2">{row.attendeeName}</td>
                <td className="px-3 py-2 text-xs">{row.customerName}<br />{row.customerEmail}</td>
                <td className="px-3 py-2">
                  {row.sectionName} {row.row}-{row.number}
                  {row.ticketType ? <div className="text-xs text-stone-500">{row.ticketType}</div> : null}
                  {row.isComplimentary ? <div className="text-xs text-green-700 font-semibold">Complimentary</div> : null}
                </td>
                <td className="px-3 py-2 text-xs">{row.source}</td>
                <td className="px-3 py-2 text-xs">{row.orderId}</td>
                <td className="px-3 py-2 text-xs">{row.ticketPublicId || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
