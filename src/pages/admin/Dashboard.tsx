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

  useEffect(() => {
    adminFetch<DashboardData>('/api/admin/dashboard').then(setData).catch(console.error);
  }, []);

  if (!data) return <div>Loading dashboard...</div>;

  return (
    <div>
      <h1 className="text-2xl font-black text-stone-900 mb-6">Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <Stat label="Sales Today" value={`$${(data.salesToday / 100).toFixed(2)}`} />
        <Stat label="Total Revenue" value={`$${(data.revenue / 100).toFixed(2)}`} />
        <Stat label="Seats Sold" value={String(data.seatsSold)} />
        <Stat label="Check Ins" value={String(data.checkIns)} />
      </div>

      <h2 className="text-lg font-bold text-stone-900 mb-3">Sales by Performance</h2>
      <div className="space-y-2">
        {data.salesByPerformance.map((item) => (
          <div key={item.performanceId} className="border border-stone-200 rounded-xl p-3 flex justify-between gap-3">
            <div>
              <div className="font-semibold text-stone-900">{item.performanceTitle}</div>
              <div className="text-xs text-stone-500">{new Date(item.startsAt).toLocaleString()}</div>
            </div>
            <div className="text-right">
              <div className="font-bold text-stone-900">${(item.revenue / 100).toFixed(2)}</div>
              <div className="text-xs text-stone-500">{item.orders} orders</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-stone-200 rounded-xl p-4">
      <div className="text-xs uppercase tracking-wide text-stone-500 mb-2">{label}</div>
      <div className="text-2xl font-black text-stone-900">{value}</div>
    </div>
  );
}
