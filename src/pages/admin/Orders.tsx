import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminFetch } from '../../lib/adminAuth';

type Order = {
  id: string;
  status: string;
  source: 'ONLINE' | 'DOOR' | 'COMP' | 'STAFF_FREE' | 'FAMILY_FREE';
  email: string;
  customerName: string;
  amountTotal: number;
  createdAt: string;
  performanceTitle: string;
  ticketCount: number;
};

type Performance = {
  id: string;
  title: string;
  startsAt: string;
};

export default function AdminOrdersPage() {
  const [rows, setRows] = useState<Order[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [performances, setPerformances] = useState<Performance[]>([]);
  const [assignForm, setAssignForm] = useState({
    performanceId: '',
    source: 'DOOR' as 'DOOR' | 'COMP',
    customerName: '',
    customerEmail: '',
    seatIdsInput: '',
    ticketType: '',
    priceCents: 1800,
    sendEmail: false
  });

  const load = async () => {
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    if (status) params.set('status', status);
    if (sourceFilter) params.set('source', sourceFilter);

    const result = await adminFetch<Order[]>(`/api/admin/orders?${params.toString()}`);
    setRows(result);
  };

  useEffect(() => {
    load().catch(console.error);
    adminFetch<any[]>('/api/admin/performances')
      .then((items) => {
        const mapped = items.map((item) => ({ id: item.id, title: item.title, startsAt: item.startsAt }));
        setPerformances(mapped);
        if (mapped.length > 0) {
          setAssignForm((prev) => ({ ...prev, performanceId: prev.performanceId || mapped[0].id }));
        }
      })
      .catch(console.error);
  }, []);

  const search = (event: FormEvent) => {
    event.preventDefault();
    load().catch(console.error);
  };

  const assignOrder = async (event: FormEvent) => {
    event.preventDefault();

    const seatIds = assignForm.seatIdsInput
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    if (!assignForm.performanceId || seatIds.length === 0) {
      alert('Choose a performance and provide at least one seat ID.');
      return;
    }

    const ticketTypeBySeatId = Object.fromEntries(
      seatIds.map((seatId) => [seatId, assignForm.ticketType || (assignForm.source === 'COMP' ? 'Comp' : 'Door')])
    );

    const priceBySeatId = Object.fromEntries(
      seatIds.map((seatId) => [seatId, assignForm.source === 'COMP' ? 0 : assignForm.priceCents])
    );

    await adminFetch('/api/admin/orders/assign', {
      method: 'POST',
      body: JSON.stringify({
        performanceId: assignForm.performanceId,
        seatIds,
        customerName: assignForm.customerName,
        customerEmail: assignForm.customerEmail,
        ticketTypeBySeatId,
        priceBySeatId,
        source: assignForm.source,
        sendEmail: assignForm.sendEmail
      })
    });

    setAssignForm((prev) => ({
      ...prev,
      customerName: '',
      customerEmail: '',
      seatIdsInput: ''
    }));

    load().catch(console.error);
  };

  return (
    <div>
      <h1 className="text-2xl font-black text-stone-900 mb-5">Orders</h1>

      <form onSubmit={assignOrder} className="border border-stone-200 rounded-2xl p-4 mb-6 space-y-3">
        <div className="font-bold text-sm text-stone-700">Assign Seats (Door / Comp)</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <select
            value={assignForm.performanceId}
            onChange={(event) => setAssignForm({ ...assignForm, performanceId: event.target.value })}
            className="border border-stone-300 rounded-xl px-3 py-2"
          >
            {performances.map((performance) => (
              <option key={performance.id} value={performance.id}>
                {performance.title} - {new Date(performance.startsAt).toLocaleString()}
              </option>
            ))}
          </select>
          <select
            value={assignForm.source}
            onChange={(event) => setAssignForm({ ...assignForm, source: event.target.value as 'DOOR' | 'COMP' })}
            className="border border-stone-300 rounded-xl px-3 py-2"
          >
            <option value="DOOR">Door Sale</option>
            <option value="COMP">Comp</option>
          </select>
          <input
            value={assignForm.ticketType}
            onChange={(event) => setAssignForm({ ...assignForm, ticketType: event.target.value })}
            placeholder="Ticket label (optional)"
            className="border border-stone-300 rounded-xl px-3 py-2"
          />
          <input
            value={assignForm.customerName}
            onChange={(event) => setAssignForm({ ...assignForm, customerName: event.target.value })}
            placeholder="Customer name"
            className="border border-stone-300 rounded-xl px-3 py-2"
            required
          />
          <input
            type="email"
            value={assignForm.customerEmail}
            onChange={(event) => setAssignForm({ ...assignForm, customerEmail: event.target.value })}
            placeholder="Customer email"
            className="border border-stone-300 rounded-xl px-3 py-2"
            required
          />
          <input
            type="number"
            min={0}
            value={assignForm.priceCents}
            onChange={(event) => setAssignForm({ ...assignForm, priceCents: Math.max(0, Number(event.target.value) || 0) })}
            placeholder="Price cents"
            className="border border-stone-300 rounded-xl px-3 py-2"
            disabled={assignForm.source === 'COMP'}
          />
        </div>

        <input
          value={assignForm.seatIdsInput}
          onChange={(event) => setAssignForm({ ...assignForm, seatIdsInput: event.target.value })}
          placeholder="Seat IDs (comma-separated)"
          className="w-full border border-stone-300 rounded-xl px-3 py-2"
          required
        />

        <label className="inline-flex items-center gap-2 text-sm text-stone-700">
          <input
            type="checkbox"
            checked={assignForm.sendEmail}
            onChange={(event) => setAssignForm({ ...assignForm, sendEmail: event.target.checked })}
          />
          Email tickets immediately
        </label>

        <div>
          <button className="bg-stone-900 text-white px-4 py-2 rounded-xl font-bold">Assign Seats</button>
        </div>
      </form>

      <form onSubmit={search} className="flex flex-wrap gap-2 mb-5">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search email, name, or order id" className="flex-1 min-w-[220px] border border-stone-300 rounded-xl px-3 py-2" />
        <select value={status} onChange={(event) => setStatus(event.target.value)} className="border border-stone-300 rounded-xl px-3 py-2">
          <option value="">All statuses</option>
          <option value="PENDING">PENDING</option>
          <option value="PAID">PAID</option>
          <option value="REFUNDED">REFUNDED</option>
          <option value="CANCELED">CANCELED</option>
        </select>
        <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} className="border border-stone-300 rounded-xl px-3 py-2">
          <option value="">All sources</option>
          <option value="ONLINE">ONLINE</option>
          <option value="DOOR">DOOR</option>
          <option value="COMP">COMP</option>
          <option value="STAFF_FREE">STAFF_FREE</option>
          <option value="FAMILY_FREE">FAMILY_FREE</option>
        </select>
        <button className="bg-stone-900 text-white px-4 py-2 rounded-xl font-bold">Search</button>
      </form>

      <div className="space-y-2">
        {rows.map((order) => (
          <div key={order.id} className="border border-stone-200 rounded-xl p-3 flex justify-between gap-3">
            <div>
              <div className="font-bold text-stone-900">{order.id}</div>
              <div className="text-xs text-stone-500">{order.customerName} • {order.email}</div>
              <div className="text-xs text-stone-500">{order.performanceTitle}</div>
              <div className="text-xs text-stone-500">{new Date(order.createdAt).toLocaleString()}</div>
            </div>
            <div className="text-right">
              <div className="font-bold text-stone-900">${(order.amountTotal / 100).toFixed(2)}</div>
              <div className="text-xs text-stone-500">{order.status} • {order.source}</div>
              <Link to={`/admin/orders/${order.id}`} className="text-xs font-bold text-yellow-700 hover:text-yellow-900">View</Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
