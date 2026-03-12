import { useEffect, useMemo, useState } from 'react';
import { adminFetch } from '../../lib/adminAuth';
import { Link } from 'react-router-dom';

type ArchivedPerformance = {
  id: string;
  title: string;
  showTitle: string;
  startsAt: string;
  archivedAt: string | null;
  venue: string;
  seatsTotal: number;
  seatsSold: number;
  totalOrders: number;
  paidOrders: number;
  paidRevenueCents: number;
};

export default function AdminArchivePage() {
  const [items, setItems] = useState<ArchivedPerformance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await adminFetch<ArchivedPerformance[]>('/api/admin/performances?scope=archived');
      setItems(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load archived performances');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const totals = useMemo(() => {
    return items.reduce(
      (acc, item) => {
        acc.seatsSold += item.seatsSold;
        acc.seatsTotal += item.seatsTotal;
        acc.totalOrders += item.totalOrders;
        acc.paidOrders += item.paidOrders;
        acc.paidRevenueCents += item.paidRevenueCents;
        return acc;
      },
      { seatsSold: 0, seatsTotal: 0, totalOrders: 0, paidOrders: 0, paidRevenueCents: 0 }
    );
  }, [items]);

  const restore = async (item: ArchivedPerformance) => {
    if (!confirm(`Restore "${item.title}" to active performances?`)) return;

    setError(null);
    try {
      await adminFetch(`/api/admin/performances/${item.id}/restore`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore performance');
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-stone-900 mb-1">Archive</h1>
        <p className="text-sm text-stone-600">
          Archived performances are hidden from public sales but keep full historical data.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <StatCard label="Archived Performances" value={String(items.length)} />
        <StatCard label="Seats Sold" value={`${totals.seatsSold}/${totals.seatsTotal}`} />
        <StatCard label="Paid Orders" value={String(totals.paidOrders)} />
        <StatCard label="Paid Revenue" value={`$${(totals.paidRevenueCents / 100).toFixed(2)}`} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Link to="/admin/dashboard" className="text-xs px-3 py-1 rounded-full border border-stone-300 text-stone-700">
          Dashboard
        </Link>
        <Link to="/admin/performances" className="text-xs px-3 py-1 rounded-full border border-stone-300 text-stone-700">
          Performances
        </Link>
        <Link to="/admin/seats" className="text-xs px-3 py-1 rounded-full border border-stone-300 text-stone-700">
          Seats
        </Link>
        <Link to="/admin/orders" className="text-xs px-3 py-1 rounded-full border border-stone-300 text-stone-700">
          Orders
        </Link>
        <Link to="/admin/roster" className="text-xs px-3 py-1 rounded-full border border-stone-300 text-stone-700">
          Roster
        </Link>
        <Link to="/admin/staff-comps" className="text-xs px-3 py-1 rounded-full border border-stone-300 text-stone-700">
          Staff Comps
        </Link>
        <Link to="/admin/student-credits" className="text-xs px-3 py-1 rounded-full border border-stone-300 text-stone-700">
          Student Credits
        </Link>
        <Link to="/admin/audit" className="text-xs px-3 py-1 rounded-full border border-stone-300 text-stone-700">
          Audit Log
        </Link>
      </div>

      {loading ? <div className="text-sm text-stone-500">Loading archived performances...</div> : null}
      {!loading && items.length === 0 ? <div className="text-sm text-stone-500">No archived performances yet.</div> : null}

      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.id} className="border border-stone-200 rounded-xl p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="space-y-1">
              <div className="font-bold text-stone-900">{item.title}</div>
              <div className="text-xs text-stone-500">
                {new Date(item.startsAt).toLocaleString()} • {item.venue}
              </div>
              <div className="text-xs text-stone-500">
                Archived: {item.archivedAt ? new Date(item.archivedAt).toLocaleString() : 'Unknown'}
              </div>
              <div className="text-xs text-stone-600">
                Seats sold {item.seatsSold}/{item.seatsTotal} • Orders {item.paidOrders} paid / {item.totalOrders} total • Revenue ${' '}
                {(item.paidRevenueCents / 100).toFixed(2)}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                className="text-sm px-3 py-1 rounded-md border border-green-300 text-green-700"
                onClick={() => {
                  void restore(item);
                }}
              >
                Restore
              </button>
            </div>
          </div>
        ))}
      </div>

      {error ? <div className="text-sm text-red-600">{error}</div> : null}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-stone-200 rounded-xl p-4">
      <div className="text-xs uppercase tracking-wide text-stone-500 mb-2">{label}</div>
      <div className="text-2xl font-bold text-stone-900">{value}</div>
    </div>
  );
}
