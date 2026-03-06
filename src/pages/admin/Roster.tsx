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
  const [rows, setRows] = useState<RosterRow[]>([]);

  useEffect(() => {
    adminFetch<any[]>('/api/admin/performances')
      .then((items) => {
        const mapped = items.map((item) => ({ id: item.id, title: item.title, startsAt: item.startsAt }));
        setPerformances(mapped);
        if (mapped.length > 0) setPerformanceId(mapped[0].id);
      })
      .catch(console.error);
  }, []);

  const load = () => {
    const params = new URLSearchParams();
    if (performanceId) params.set('performanceId', performanceId);
    if (query.trim()) params.set('q', query.trim());

    adminFetch<RosterRow[]>(`/api/admin/roster?${params.toString()}`).then(setRows).catch(console.error);
  };

  useEffect(() => {
    if (performanceId) load();
  }, [performanceId]);

  const onSearch = (event: FormEvent) => {
    event.preventDefault();
    load();
  };

  return (
    <div>
      <h1 className="text-2xl font-black text-stone-900 mb-5">Attendee Roster</h1>

      <form onSubmit={onSearch} className="flex flex-wrap gap-2 mb-5">
        <select value={performanceId} onChange={(event) => setPerformanceId(event.target.value)} className="border border-stone-300 rounded-xl px-3 py-2">
          {performances.map((performance) => (
            <option key={performance.id} value={performance.id}>
              {performance.title} - {new Date(performance.startsAt).toLocaleString()}
            </option>
          ))}
        </select>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search attendee, buyer, email, order" className="flex-1 min-w-[200px] border border-stone-300 rounded-xl px-3 py-2" />
        <button className="bg-stone-900 text-white px-4 py-2 rounded-xl font-bold">Search</button>
      </form>

      <div className="max-h-[520px] overflow-auto border border-stone-200 rounded-xl">
        <table className="w-full text-sm">
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
