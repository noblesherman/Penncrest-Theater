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

const NAV_LINKS = [
  { to: '/admin/dashboard',        label: 'Dashboard' },
  { to: '/admin/performances',     label: 'Performances' },
  { to: '/admin/seats',            label: 'Seats' },
  { to: '/admin/orders',           label: 'Orders' },
  { to: '/admin/roster',           label: 'Roster' },
  { to: '/admin/staff-comps',      label: 'Staff Comps' },
  { to: '/admin/student-credits',  label: 'Student Credits' },
  { to: '/admin/audit',            label: 'Audit Log' },
];

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-sm">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-stone-400">{label}</p>
      <p className="text-2xl font-bold text-stone-900" style={{ fontFamily: "var(--font-sans)", letterSpacing: '-0.02em' }}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-stone-400">{sub}</p>}
    </div>
  );
}

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

  useEffect(() => { void load(); }, []);

  const totals = useMemo(() =>
    items.reduce(
      (acc, item) => ({
        seatsSold:        acc.seatsSold        + item.seatsSold,
        seatsTotal:       acc.seatsTotal       + item.seatsTotal,
        totalOrders:      acc.totalOrders      + item.totalOrders,
        paidOrders:       acc.paidOrders       + item.paidOrders,
        paidRevenueCents: acc.paidRevenueCents + item.paidRevenueCents,
      }),
      { seatsSold: 0, seatsTotal: 0, totalOrders: 0, paidOrders: 0, paidRevenueCents: 0 }
    ),
  [items]);

  const restore = async (item: ArchivedPerformance) => {
    if (!confirm(`Restore "${item.title || item.showTitle}" to active performances?`)) return;
    setError(null);
    try {
      await adminFetch(`/api/admin/performances/${item.id}/restore`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore performance');
    }
  };

  const fillPct = totals.seatsTotal > 0
    ? Math.round((totals.seatsSold / totals.seatsTotal) * 100)
    : 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-2">

      {/* ── Header ── */}
      <div>
        <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-widest text-stone-400">Admin</p>
        <h1
          className="text-3xl font-bold text-stone-900"
          style={{ fontFamily: "var(--font-sans)", letterSpacing: '-0.02em' }}
        >
          Archive
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          Archived performances are hidden from public sales but retain full historical data.
        </p>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="flex items-start gap-2 rounded-2xl border border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <svg className="mt-0.5 h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          {error}
        </div>
      )}

      {/* ── Stats ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Performances" value={String(items.length)} />
        <StatCard
          label="Seats Sold"
          value={`${totals.seatsSold.toLocaleString()}`}
          sub={`of ${totals.seatsTotal.toLocaleString()} · ${fillPct}% filled`}
        />
        <StatCard
          label="Paid Orders"
          value={totals.paidOrders.toLocaleString()}
          sub={`${totals.totalOrders} total`}
        />
        <StatCard
          label="Revenue"
          value={`$${(totals.paidRevenueCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          sub="paid orders only"
        />
      </div>

      {/* ── Quick Nav ── */}
      <div className="flex flex-wrap gap-2">
        {NAV_LINKS.map(({ to, label }) => (
          <Link
            key={to}
            to={to}
            className="rounded-full border border-stone-200 px-3 py-1 text-xs font-medium text-stone-600 transition hover:border-stone-400 hover:text-stone-900"
          >
            {label}
          </Link>
        ))}
      </div>

      {/* ── Performance List ── */}
      {loading && (
        <div className="flex items-center gap-2 py-6 text-sm text-stone-400">
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          Loading archived performances…
        </div>
      )}

      {!loading && items.length === 0 && (
        <p className="py-8 text-center text-sm text-stone-400">No archived performances yet.</p>
      )}

      {!loading && items.length > 0 && (
        <div className="divide-y divide-stone-100 rounded-2xl border border-stone-100 bg-white shadow-sm">
          {items.map((item) => {
            const fillPct = item.seatsTotal > 0 ? Math.round((item.seatsSold / item.seatsTotal) * 100) : 0;
            return (
              <div key={item.id} className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1.5 min-w-0">
                  <p className="font-semibold text-stone-900 truncate">{item.title || item.showTitle}</p>
                  <p className="text-xs text-stone-400">
                    {new Date(item.startsAt).toLocaleString()} · {item.venue}
                  </p>
                  <p className="text-xs text-stone-400">
                    Archived {item.archivedAt ? new Date(item.archivedAt).toLocaleDateString() : 'unknown'}
                  </p>

                  {/* Mini stats row */}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 pt-0.5 text-xs text-stone-500">
                    <span>
                      <span className="font-semibold text-stone-800">{item.seatsSold}</span>
                      /{item.seatsTotal} seats
                      <span className="ml-1 text-stone-400">({fillPct}%)</span>
                    </span>
                    <span>
                      <span className="font-semibold text-stone-800">{item.paidOrders}</span>
                      /{item.totalOrders} orders paid
                    </span>
                    <span>
                      <span className="font-semibold text-stone-800">
                        ${(item.paidRevenueCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                      {' '}revenue
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => { void restore(item); }}
                  className="w-full rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100 sm:w-auto"
                >
                  Restore
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
