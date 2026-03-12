import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import { adminFetch } from '../../lib/adminAuth';

type PerformanceRow = {
  id: string;
  title: string;
  startsAt: string;
  showId: string;
  showTitle: string;
};

type StudentCreditRow = {
  id: string;
  showId: string;
  studentId?: string | null;
  studentName: string;
  studentEmail: string | null;
  roleName: string | null;
  allocatedTickets: number;
  usedTickets: number;
  remainingTickets: number;
  pendingTickets: number;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  lastTransactionDate: string | null;
};

type StudentCreditTransaction = {
  id: string;
  quantity: number;
  type: 'REDEEM' | 'ADJUSTMENT_ADD' | 'ADJUSTMENT_REMOVE' | 'MANUAL_REDEEM' | 'REFUND_RESTORE';
  verificationMethod: 'CODE' | 'SCHOOL_LOGIN' | 'ADMIN' | null;
  redeemedBy: string | null;
  notes: string | null;
  createdAt: string;
  order: {
    id: string;
    status: string;
    source: string;
    amountTotal: number;
  } | null;
  performance: {
    id: string;
    title: string | null;
    startsAt: string;
    show: {
      title: string;
    };
  } | null;
};

type StudentCreditHistoryResponse = {
  credit: {
    id: string;
    studentName: string;
    allocatedTickets: number;
    usedTickets: number;
    pendingTickets: number;
    remainingTickets: number;
  };
  transactions: StudentCreditTransaction[];
};

const initialCreateForm = {
  studentName: '',
  studentEmail: '',
  roleName: '',
  allocatedTickets: 2,
  notes: ''
};

export default function AdminStudentCreditsPage() {
  const [performances, setPerformances] = useState<PerformanceRow[]>([]);
  const [scope, setScope] = useState<'active' | 'archived' | 'all'>('active');
  const [selectedShowId, setSelectedShowId] = useState('');
  const [rows, setRows] = useState<StudentCreditRow[]>([]);
  const [query, setQuery] = useState('');
  const [createForm, setCreateForm] = useState(initialCreateForm);
  const [importCsv, setImportCsv] = useState('');
  const [selectedCreditId, setSelectedCreditId] = useState<string | null>(null);
  const [history, setHistory] = useState<StudentCreditHistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const shows = useMemo(() => {
    const map = new Map<string, { showId: string; showTitle: string; performances: PerformanceRow[] }>();
    performances.forEach((performance) => {
      const existing = map.get(performance.showId);
      if (existing) {
        existing.performances.push(performance);
      } else {
        map.set(performance.showId, {
          showId: performance.showId,
          showTitle: performance.showTitle,
          performances: [performance]
        });
      }
    });

    return [...map.values()].sort((a, b) => a.showTitle.localeCompare(b.showTitle));
  }, [performances]);

  const loadPerformances = async () => {
    const items = await adminFetch<PerformanceRow[]>(`/api/admin/performances?scope=${scope}`);
    setPerformances(items);
    if (items.length === 0) {
      setSelectedShowId('');
      setRows([]);
      return;
    }

    const availableShowIds = new Set(items.map((item) => item.showId));
    if (!selectedShowId || !availableShowIds.has(selectedShowId)) {
      setSelectedShowId(items[0].showId);
    }
  };

  const loadCredits = async (showId: string, q = query) => {
    if (!showId) {
      setRows([]);
      return;
    }

    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    const queryString = params.toString();
    const path = `/api/admin/shows/${showId}/student-credits${queryString ? `?${queryString}` : ''}`;
    const result = await adminFetch<StudentCreditRow[]>(path);
    setRows(result);
  };

  useEffect(() => {
    loadPerformances().catch((err) => setError(err instanceof Error ? err.message : 'Failed to load performances'));
  }, [scope]);

  useEffect(() => {
    if (!selectedShowId) return;
    setLoading(true);
    loadCredits(selectedShowId)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load student credits'))
      .finally(() => setLoading(false));
  }, [selectedShowId]);

  const refresh = async () => {
    if (!selectedShowId) return;
    await loadCredits(selectedShowId);
    if (selectedCreditId) {
      await loadHistory(selectedCreditId);
    }
  };

  const loadHistory = async (creditId: string) => {
    const result = await adminFetch<StudentCreditHistoryResponse>(`/api/admin/student-credits/${creditId}/transactions`);
    setHistory(result);
    setSelectedCreditId(creditId);
  };

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedShowId) return;
    setError(null);

    try {
      await adminFetch(`/api/admin/shows/${selectedShowId}/student-credits`, {
        method: 'POST',
        body: JSON.stringify({
          studentName: createForm.studentName,
          studentEmail: createForm.studentEmail.trim().toLowerCase(),
          roleName: createForm.roleName || null,
          allocatedTickets: createForm.allocatedTickets,
          notes: createForm.notes || null
        })
      });
      setCreateForm(initialCreateForm);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create student credit');
    }
  };

  const handleImportCsv = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedShowId) return;
    setError(null);

    try {
      await adminFetch(`/api/admin/shows/${selectedShowId}/student-credits/import`, {
        method: 'POST',
        body: JSON.stringify({ csv: importCsv })
      });
      setImportCsv('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import CSV');
    }
  };

  const onCsvFileSelect = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setImportCsv(text);
  };

  const updateCredit = async (id: string, payload: Record<string, unknown>) => {
    setError(null);
    try {
      await adminFetch(`/api/admin/student-credits/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update student credit');
    }
  };

  const manualRedeem = async (id: string) => {
    const quantityInput = prompt('How many tickets should be manually redeemed?');
    const quantity = Number(quantityInput || '0');
    if (!Number.isFinite(quantity) || quantity <= 0) return;

    setError(null);
    try {
      await adminFetch(`/api/admin/student-credits/${id}/manual-redeem`, {
        method: 'POST',
        body: JSON.stringify({ quantity: Math.floor(quantity) })
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to manually redeem credits');
    }
  };

  const manualRestore = async (id: string) => {
    const quantityInput = prompt('How many tickets should be restored?');
    const quantity = Number(quantityInput || '0');
    if (!Number.isFinite(quantity) || quantity <= 0) return;

    setError(null);
    try {
      await adminFetch(`/api/admin/student-credits/${id}/manual-restore`, {
        method: 'POST',
        body: JSON.stringify({ quantity: Math.floor(quantity) })
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore credits');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-stone-900 mb-1">Student Complimentary Credits</h1>
        <p className="text-sm text-stone-600">Manage cast and crew complimentary ticket balances by show and school email.</p>
      </div>

      <section className="border border-stone-200 rounded-2xl p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="text-xs font-semibold text-stone-500">Performance Scope</label>
            <select
              value={scope}
              onChange={(event) => setScope(event.target.value as 'active' | 'archived' | 'all')}
              className="w-full border border-stone-300 rounded-xl px-3 py-2"
            >
              <option value="active">Active</option>
              <option value="archived">Archived</option>
              <option value="all">All</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-stone-500">Show</label>
            <select
              value={selectedShowId}
              onChange={(event) => setSelectedShowId(event.target.value)}
              className="w-full border border-stone-300 rounded-xl px-3 py-2"
            >
              {shows.map((show) => (
                <option key={show.showId} value={show.showId}>
                  {show.showTitle}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-stone-500">Search</label>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name, school email, or role"
              className="w-full border border-stone-300 rounded-xl px-3 py-2"
            />
          </div>
          <div className="flex items-end">
            <button
              className="w-full rounded-xl bg-red-700 px-4 py-2 font-bold text-white"
              onClick={() => loadCredits(selectedShowId).catch((err) => setError(err instanceof Error ? err.message : 'Search failed'))}
            >
              Search
            </button>
          </div>
        </div>
      </section>

      <section className="border border-stone-200 rounded-2xl p-4">
        <h2 className="font-bold text-stone-900 mb-3">Create Student Credit</h2>
        <form onSubmit={handleCreate} className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <input
            value={createForm.studentName}
            onChange={(event) => setCreateForm({ ...createForm, studentName: event.target.value })}
            placeholder="Student name"
            className="border border-stone-300 rounded-xl px-3 py-2"
            required
          />
          <input
            type="email"
            value={createForm.studentEmail}
            onChange={(event) => setCreateForm({ ...createForm, studentEmail: event.target.value })}
            placeholder="School email (required)"
            className="border border-stone-300 rounded-xl px-3 py-2"
            required
          />
          <input
            value={createForm.roleName}
            onChange={(event) => setCreateForm({ ...createForm, roleName: event.target.value })}
            placeholder="Role (optional)"
            className="border border-stone-300 rounded-xl px-3 py-2"
          />
          <input
            type="number"
            min={0}
            max={50}
            value={createForm.allocatedTickets}
            onChange={(event) => setCreateForm({ ...createForm, allocatedTickets: Math.max(0, Number(event.target.value) || 0) })}
            className="border border-stone-300 rounded-xl px-3 py-2"
          />
          <button className="w-full rounded-xl bg-red-700 px-4 py-2 font-bold text-white md:w-auto">Create</button>
          <textarea
            value={createForm.notes}
            onChange={(event) => setCreateForm({ ...createForm, notes: event.target.value })}
            placeholder="Notes (optional)"
            className="md:col-span-3 border border-stone-300 rounded-xl px-3 py-2"
            rows={2}
          />
        </form>
      </section>

      <section className="border border-stone-200 rounded-2xl p-4">
        <h2 className="font-bold text-stone-900 mb-3">CSV Import</h2>
        <form onSubmit={handleImportCsv} className="space-y-3">
          <div className="text-xs text-stone-500">
            Column order: studentName, studentEmail, roleName, allocatedTickets (studentEmail required)
          </div>
          <input type="file" accept=".csv,text/csv" onChange={onCsvFileSelect} className="text-sm" />
          <textarea
            value={importCsv}
            onChange={(event) => setImportCsv(event.target.value)}
            className="w-full border border-stone-300 rounded-xl px-3 py-2 font-mono text-xs"
            rows={5}
            placeholder="studentName,studentEmail,roleName,allocatedTickets"
          />
          <button className="bg-red-700 text-white px-4 py-2 rounded-xl font-bold">Import CSV</button>
        </form>
      </section>

      <section className="border border-stone-200 rounded-2xl p-4">
        <h2 className="font-bold text-stone-900 mb-3">Student Records</h2>
        {loading ? (
          <div className="text-sm text-stone-500">Loading...</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-stone-500">No student credit records found for this show.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-xs md:text-sm">
              <thead className="text-left bg-stone-50">
                <tr>
                  <th className="px-2 py-2">Student</th>
                  <th className="px-2 py-2">Role</th>
                  <th className="px-2 py-2">Email</th>
                  <th className="px-2 py-2">Allocated</th>
                  <th className="px-2 py-2">Used</th>
                  <th className="px-2 py-2">Remaining</th>
                  <th className="px-2 py-2">Active</th>
                  <th className="px-2 py-2">Last Txn</th>
                  <th className="px-2 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-stone-100 align-top">
                    <td className="px-2 py-2 font-semibold text-stone-900">{row.studentName}</td>
                    <td className="px-2 py-2">{row.roleName || '-'}</td>
                    <td className="px-2 py-2">
                      {row.studentEmail ? row.studentEmail : <span className="text-red-600 font-semibold">Missing school email</span>}
                    </td>
                    <td className="px-2 py-2">{row.allocatedTickets}</td>
                    <td className="px-2 py-2">{row.usedTickets}</td>
                    <td className="px-2 py-2">
                      {row.remainingTickets}
                      {row.pendingTickets > 0 ? <span className="text-[10px] text-amber-700"> (+{row.pendingTickets} pending)</span> : null}
                    </td>
                    <td className="px-2 py-2">{row.isActive ? 'Yes' : 'No'}</td>
                    <td className="px-2 py-2">{row.lastTransactionDate ? new Date(row.lastTransactionDate).toLocaleString() : '-'}</td>
                    <td className="px-2 py-2 space-x-1 space-y-1">
                      <button
                        className="text-xs border border-stone-300 rounded-md px-2 py-1"
                        onClick={() => {
                          const next = prompt('Set school email for verification', row.studentEmail || '');
                          if (next === null) return;
                          const value = next.trim().toLowerCase();
                          if (!value) return;
                          void updateCredit(row.id, { studentEmail: value });
                        }}
                      >
                        Edit School Email
                      </button>
                      <button
                        className="text-xs border border-stone-300 rounded-md px-2 py-1"
                        onClick={() => {
                          const next = prompt('Set new allocated ticket count', String(row.allocatedTickets));
                          const value = Number(next || '');
                          if (!Number.isFinite(value) || value < 0) return;
                          void updateCredit(row.id, { allocatedTickets: Math.floor(value) });
                        }}
                      >
                        Edit Allocation
                      </button>
                      <button
                        className="text-xs border border-stone-300 rounded-md px-2 py-1"
                        onClick={() => void updateCredit(row.id, { isActive: !row.isActive })}
                      >
                        {row.isActive ? 'Disable' : 'Enable'}
                      </button>
                      <button className="text-xs border border-stone-300 rounded-md px-2 py-1" onClick={() => manualRedeem(row.id)}>
                        Manual Redeem
                      </button>
                      <button className="text-xs border border-stone-300 rounded-md px-2 py-1" onClick={() => manualRestore(row.id)}>
                        Restore
                      </button>
                      <button
                        className="text-xs border border-stone-300 rounded-md px-2 py-1"
                        onClick={() => loadHistory(row.id).catch((err) => setError(err instanceof Error ? err.message : 'Failed to load history'))}
                      >
                        View History
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {history && (
        <section className="border border-stone-200 rounded-2xl p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-bold text-stone-900">History: {history.credit.studentName}</h2>
            <button className="text-sm text-stone-600" onClick={() => setHistory(null)}>Close</button>
          </div>
          <div className="text-xs text-stone-500 mb-3">
            Allocated {history.credit.allocatedTickets} • Used {history.credit.usedTickets} • Remaining {history.credit.remainingTickets}
          </div>
          <div className="space-y-2 max-h-72 overflow-auto">
            {history.transactions.map((txn) => (
              <div key={txn.id} className="border border-stone-200 rounded-xl p-3 text-xs text-stone-700">
                <div className="font-semibold text-stone-900">
                  {txn.type} • Qty {txn.quantity} • {new Date(txn.createdAt).toLocaleString()}
                </div>
                {txn.performance ? (
                  <div>
                    Performance: {(txn.performance.title || txn.performance.show.title)} ({new Date(txn.performance.startsAt).toLocaleString()})
                  </div>
                ) : null}
                {txn.order ? <div>Order: {txn.order.id} ({txn.order.status}, {txn.order.source})</div> : null}
                {txn.verificationMethod ? <div>Method: {txn.verificationMethod}</div> : null}
                {txn.redeemedBy ? <div>By: {txn.redeemedBy}</div> : null}
                {txn.notes ? <div>Notes: {txn.notes}</div> : null}
              </div>
            ))}
            {history.transactions.length === 0 ? <div className="text-sm text-stone-500">No transactions yet.</div> : null}
          </div>
        </section>
      )}

      {error && <div className="text-sm text-red-600">{error}</div>}
    </div>
  );
}
