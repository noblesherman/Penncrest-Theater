import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminFetch } from '../../lib/adminAuth';

type Order = {
  id: string;
  status: string;
  source: 'ONLINE' | 'DOOR' | 'COMP' | 'STAFF_FREE' | 'FAMILY_FREE' | 'STUDENT_COMP';
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
  const [scope, setScope] = useState<'active' | 'archived' | 'all'>('active');
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
  const [loadingRows, setLoadingRows] = useState(false);
  const [submittingAssign, setSubmittingAssign] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    setLoadingRows(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      if (status) params.set('status', status);
      if (sourceFilter) params.set('source', sourceFilter);
      params.set('scope', scope);

      const result = await adminFetch<Order[]>(`/api/admin/orders?${params.toString()}`);
      setRows(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load orders');
    } finally {
      setLoadingRows(false);
    }
  };

  const loadPerformances = async () => {
    try {
      const items = await adminFetch<Array<{ id: string; title: string; startsAt: string; isArchived?: boolean }>>(
        '/api/admin/performances?scope=active'
      );
      const mapped = items
        .filter((item) => !item.isArchived)
        .map((item) => ({ id: item.id, title: item.title, startsAt: item.startsAt }));

      setPerformances(mapped);
      if (mapped.length > 0) {
        setAssignForm((prev) => ({
          ...prev,
          performanceId: mapped.some((row) => row.id === prev.performanceId) ? prev.performanceId : mapped[0].id
        }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load performances');
    }
  };

  useEffect(() => {
    void Promise.all([load(), loadPerformances()]);
  }, []);

  useEffect(() => {
    void load();
  }, [scope]);

  const search = (event: FormEvent) => {
    event.preventDefault();
    void load();
  };

  const assignOrder = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setNotice(null);

    const seatIds = assignForm.seatIdsInput
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    if (!assignForm.performanceId || seatIds.length === 0) {
      setError('Choose a performance and provide at least one seat ID.');
      return;
    }

    const ticketTypeBySeatId = Object.fromEntries(
      seatIds.map((seatId) => [seatId, assignForm.ticketType || (assignForm.source === 'COMP' ? 'Comp' : 'Door')])
    );

    const priceBySeatId = Object.fromEntries(
      seatIds.map((seatId) => [seatId, assignForm.source === 'COMP' ? 0 : assignForm.priceCents])
    );

    setSubmittingAssign(true);
    try {
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
      setNotice(`Assigned ${seatIds.length} seat${seatIds.length === 1 ? '' : 's'} successfully.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assign seats');
    } finally {
      setSubmittingAssign(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-stone-900" style={{ fontFamily: 'Georgia, serif' }}>Orders</h1>
        <p className="text-sm text-stone-600">Search orders and assign door/comp tickets.</p>
      </div>

      {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
      {notice ? <div className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</div> : null}

      <form onSubmit={assignOrder} className="border border-stone-100 rounded-2xl p-4 space-y-3">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-red-600">Assign Seats (Door / Comp)</div>
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
          <button
            className="w-full rounded-xl bg-red-700 px-4 py-2 font-semibold text-white hover:bg-red-800 transition-colors disabled:opacity-60 sm:w-auto"
            disabled={submittingAssign}
          >
            {submittingAssign ? 'Assigning...' : 'Assign Seats'}
          </button>
        </div>
      </form>

      <form onSubmit={search} className="flex flex-wrap gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search email, name, or order id"
          className="w-full min-w-0 flex-1 rounded-xl border border-stone-300 px-3 py-2 sm:min-w-[220px]"
        />
        <select value={status} onChange={(event) => setStatus(event.target.value)} className="w-full rounded-xl border border-stone-300 px-3 py-2 sm:w-auto">
          <option value="">All statuses</option>
          <option value="PENDING">PENDING</option>
          <option value="PAID">PAID</option>
          <option value="REFUNDED">REFUNDED</option>
          <option value="CANCELED">CANCELED</option>
        </select>
        <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)} className="w-full rounded-xl border border-stone-300 px-3 py-2 sm:w-auto">
          <option value="">All sources</option>
          <option value="ONLINE">ONLINE</option>
          <option value="DOOR">DOOR</option>
          <option value="COMP">COMP</option>
          <option value="STAFF_FREE">STAFF_FREE</option>
          <option value="FAMILY_FREE">FAMILY_FREE</option>
          <option value="STUDENT_COMP">STUDENT_COMP</option>
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
        <button className="w-full rounded-xl bg-red-700 px-4 py-2 font-semibold text-white hover:bg-red-800 transition-colors sm:w-auto">Search</button>
      </form>

      {loadingRows ? <div className="text-sm text-stone-500">Loading orders...</div> : null}
      {!loadingRows && rows.length === 0 ? <div className="text-sm text-stone-500">No orders found for the current filters.</div> : null}

      <div className="space-y-2">
        {rows.map((order) => (
          <div key={order.id} className="flex flex-col gap-3 rounded-xl border border-stone-200 p-3 sm:flex-row sm:justify-between">
            <div>
              <div className="font-bold text-stone-900">{order.id}</div>
              <div className="text-xs text-stone-500">{order.customerName} • {order.email}</div>
              <div className="text-xs text-stone-500">{order.performanceTitle}</div>
              <div className="text-xs text-stone-500">{new Date(order.createdAt).toLocaleString()}</div>
            </div>
            <div className="sm:text-right">
              <div className="font-bold text-stone-900">${(order.amountTotal / 100).toFixed(2)}</div>
              <div className="text-xs text-stone-500">{order.status} • {order.source}</div>
              <Link to={`/admin/orders/${order.id}`} className="text-xs font-bold text-red-700 hover:text-red-800">View</Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
