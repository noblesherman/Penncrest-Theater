import { useEffect, useState } from 'react';
import { adminFetch } from '../../lib/adminAuth';

type DashboardData = {
  salesToday: number;
  seatsSold: number;
  revenue: number;
  checkIns: number;
  salesByPerformance: Array<{
    performanceId: string;
    performanceTitle: string;
    startsAt: string;
    orders: number;
    revenue: number;
  }>;
};

export default function AdminDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [scope, setScope] = useState<'active' | 'archived' | 'all'>('active');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    adminFetch<DashboardData>(`/api/admin/dashboard?scope=${scope}`)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load dashboard'));
  }, [scope]);

  if (error) {
    return <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>;
  }

  if (!data) {
    return <div className="text-sm text-stone-500">Loading dashboard...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">Dashboard</h1>
          <p className="text-sm text-stone-600">Ticket sales and check-in overview.</p>
        </div>
        <select
          value={scope}
          onChange={(event) => setScope(event.target.value as 'active' | 'archived' | 'all')}
          className="rounded-xl border border-stone-300 px-3 py-2 text-sm"
        >
          <option value="active">Active</option>
          <option value="archived">Archived</option>
          <option value="all">All</option>
        </select>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Stat label="Sales Today" value={`$${(data.salesToday / 100).toFixed(2)}`} />
        <Stat label="Total Revenue" value={`$${(data.revenue / 100).toFixed(2)}`} />
        <Stat label="Seats Sold" value={`${data.seatsSold}`} />
        <Stat label="Check-Ins" value={`${data.checkIns}`} />
      </div>

      <section>
        <h2 className="mb-3 text-lg font-bold text-stone-900">Sales by Performance</h2>
        <div className="space-y-2">
          {data.salesByPerformance.map((item) => (
            <div key={item.performanceId} className="rounded-xl border border-stone-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-semibold text-stone-900">{item.performanceTitle}</div>
                  <div className="text-xs text-stone-500">{new Date(item.startsAt).toLocaleString()}</div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-stone-900">${(item.revenue / 100).toFixed(2)}</div>
                  <div className="text-xs text-stone-500">{item.orders} orders</div>
                </div>
              </div>
            </div>
          ))}
          {data.salesByPerformance.length === 0 ? <div className="text-sm text-stone-500">No sales yet.</div> : null}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
      <div className="text-xs uppercase tracking-wide text-stone-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-stone-900">{value}</div>
    </div>
  );
}
