import { useEffect, useState } from 'react';
import { BarChart, Users, DollarSign, Calendar } from 'lucide-react';
import { apiUrl } from '../lib/api';

export default function Admin() {
  const [stats, setStats] = useState({ totalSales: 0, ticketsSold: 0 });

  useEffect(() => {
    fetch(apiUrl('/api/admin/stats'))
      .then(res => res.json())
      .then(data => setStats(data));
  }, []);

  return (
    <div className="min-h-screen bg-stone-100 p-4 sm:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-3xl font-bold text-stone-900">Admin Dashboard</h1>
          <div className="w-full rounded-lg bg-white px-4 py-2 text-sm font-medium text-stone-600 shadow-sm sm:w-auto">
            Logged in as Admin
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-12">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-stone-200">
            <div className="flex items-center gap-4 mb-2">
              <div className="p-3 bg-green-100 text-green-600 rounded-lg">
                <DollarSign className="w-6 h-6" />
              </div>
              <div className="text-sm font-medium text-stone-500">Total Revenue</div>
            </div>
            <div className="text-3xl font-black text-stone-900">${(stats.totalSales / 100).toFixed(2)}</div>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-stone-200">
            <div className="flex items-center gap-4 mb-2">
              <div className="p-3 bg-blue-100 text-blue-600 rounded-lg">
                <Users className="w-6 h-6" />
              </div>
              <div className="text-sm font-medium text-stone-500">Tickets Sold</div>
            </div>
            <div className="text-3xl font-black text-stone-900">{stats.ticketsSold}</div>
          </div>
          
           <div className="bg-white p-6 rounded-xl shadow-sm border border-stone-200 opacity-50">
            <div className="flex items-center gap-4 mb-2">
              <div className="p-3 bg-purple-100 text-purple-600 rounded-lg">
                <Calendar className="w-6 h-6" />
              </div>
              <div className="text-sm font-medium text-stone-500">Upcoming Season</div>
            </div>
            <div className="text-3xl font-black text-stone-900">3</div>
          </div>
        </div>

        {/* Content Area */}
        <div className="min-h-[400px] rounded-2xl border border-stone-200 bg-white p-5 shadow-sm sm:p-8">
          <h2 className="text-xl font-bold mb-6">Manage Productions</h2>
          <div className="text-center py-20 text-stone-400">
            <p>Select a show to manage performances, pricing, and seating.</p>
            <button className="mt-4 bg-stone-900 text-white px-6 py-2 rounded-lg font-bold text-sm">
              + Create New Show
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
