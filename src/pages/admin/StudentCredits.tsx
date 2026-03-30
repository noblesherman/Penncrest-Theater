import { type ReactNode, ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
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
  order: { id: string; status: string; source: string; amountTotal: number } | null;
  performance: { id: string; title: string | null; startsAt: string; show: { title: string } } | null;
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

type StudentCreditImportResponse = {
  createdCount: number;
  createdIds: string[];
  warnings?: string[];
};

const initialCreateForm = {
  studentName: '',
  studentEmail: '',
  roleName: '',
  allocatedTickets: 2,
  notes: '',
};

const TXN_LABELS: Record<string, string> = {
  REDEEM:           'Redeemed',
  ADJUSTMENT_ADD:   'Adjustment +',
  ADJUSTMENT_REMOVE:'Adjustment −',
  MANUAL_REDEEM:    'Manual Redeem',
  REFUND_RESTORE:   'Refund Restored',
};

const TXN_COLORS: Record<string, string> = {
  REDEEM:           'bg-sky-50 text-sky-700 ring-sky-200',
  ADJUSTMENT_ADD:   'bg-emerald-50 text-emerald-700 ring-emerald-200',
  ADJUSTMENT_REMOVE:'bg-rose-50 text-rose-700 ring-rose-200',
  MANUAL_REDEEM:    'bg-amber-50 text-amber-700 ring-amber-200',
  REFUND_RESTORE:   'bg-violet-50 text-violet-700 ring-violet-200',
};

const inputCls =
  'w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-stone-400 focus:ring-2 focus:ring-stone-100 placeholder:text-stone-400';

const selectCls =
  'w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 outline-none transition focus:border-stone-400 focus:ring-2 focus:ring-stone-100 cursor-pointer';

function normalizeStudentCode(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '');
}

function buildStudentCodeFromName(name: string): string {
  const tokens = name
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/[^a-zA-Z0-9]/g, ''))
    .filter(Boolean);
  if (tokens.length === 0) return '';
  const firstInitial = tokens[0][0] || '';
  const lastName = tokens[tokens.length - 1] || '';
  return normalizeStudentCode(`${firstInitial}${lastName}`);
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-stone-400">{children}</p>
  );
}

function Badge({ label, style }: { label: string; style?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wider ring-1 ${style ?? 'bg-stone-100 text-stone-500 ring-stone-200'}`}>
      {label}
    </span>
  );
}

function ActionButton({ onClick, children, variant = 'default' }: { onClick: () => void; children: ReactNode; variant?: 'default' | 'danger' | 'warning' }) {
  const styles = {
    default: 'border border-stone-200 bg-stone-50 text-stone-600 hover:bg-white hover:border-stone-300 hover:text-stone-900',
    danger:  'border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100',
    warning: 'border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100',
  };
  return (
    <button onClick={onClick} className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${styles[variant]}`}>
      {children}
    </button>
  );
}

export default function AdminStudentCreditsPage() {
  const [performances, setPerformances] = useState<PerformanceRow[]>([]);
  const [scope, setScope] = useState<'active' | 'archived' | 'all'>('active');
  const [selectedShowId, setSelectedShowId] = useState('');
  const [rows, setRows] = useState<StudentCreditRow[]>([]);
  const [query, setQuery] = useState('');
  const [createForm, setCreateForm] = useState(initialCreateForm);
  const [autoGenerateCode, setAutoGenerateCode] = useState(true);
  const [importCsv, setImportCsv] = useState('');
  const [importFileName, setImportFileName] = useState('');
  const [importWarnings, setImportWarnings] = useState<string[]>([]);
  const [importSummary, setImportSummary] = useState<string | null>(null);
  const [selectedCreditId, setSelectedCreditId] = useState<string | null>(null);
  const [history, setHistory] = useState<StudentCreditHistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const shows = useMemo(() => {
    const map = new Map<string, { showId: string; showTitle: string; performances: PerformanceRow[] }>();
    performances.forEach((p) => {
      const existing = map.get(p.showId);
      if (existing) existing.performances.push(p);
      else map.set(p.showId, { showId: p.showId, showTitle: p.showTitle, performances: [p] });
    });
    return [...map.values()].sort((a, b) => a.showTitle.localeCompare(b.showTitle));
  }, [performances]);

  const loadPerformances = async () => {
    const items = await adminFetch<PerformanceRow[]>(`/api/admin/performances?scope=${scope}`);
    setPerformances(items);
    if (items.length === 0) { setSelectedShowId(''); setRows([]); return; }
    const available = new Set(items.map((i) => i.showId));
    if (!selectedShowId || !available.has(selectedShowId)) setSelectedShowId(items[0].showId);
  };

  const loadCredits = async (showId: string, q = query) => {
    if (!showId) { setRows([]); return; }
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    const qs = params.toString();
    const result = await adminFetch<StudentCreditRow[]>(`/api/admin/shows/${showId}/student-credits${qs ? `?${qs}` : ''}`);
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
    if (selectedCreditId) await loadHistory(selectedCreditId);
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

    const studentCode = autoGenerateCode
      ? buildStudentCodeFromName(createForm.studentName)
      : normalizeStudentCode(createForm.studentEmail);
    if (!studentCode) {
      setError('Student code is required. Use first initial + last name (example: jsmith).');
      return;
    }

    try {
      await adminFetch(`/api/admin/shows/${selectedShowId}/student-credits`, {
        method: 'POST',
        body: JSON.stringify({
          studentName: createForm.studentName,
          studentEmail: studentCode,
          roleName: createForm.roleName || null,
          allocatedTickets: createForm.allocatedTickets,
          notes: createForm.notes || null,
        }),
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
    setImportSummary(null);
    setImportWarnings([]);
    if (!importCsv.trim()) {
      setError('Choose a CSV file (or paste CSV text) before importing.');
      return;
    }
    try {
      const result = await adminFetch<StudentCreditImportResponse>(`/api/admin/shows/${selectedShowId}/student-credits/import`, {
        method: 'POST',
        body: JSON.stringify({ csv: importCsv }),
      });
      setImportCsv('');
      setImportFileName('');
      setImportWarnings(result.warnings || []);
      setImportSummary(`Imported ${result.createdCount} student credit record${result.createdCount === 1 ? '' : 's'}.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import CSV');
    }
  };

  const onCsvFileSelect = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportFileName(file.name);
    setImportSummary(null);
    setImportWarnings([]);
    setImportCsv(await file.text());
    event.target.value = '';
  };

  const updateCredit = async (id: string, payload: Record<string, unknown>) => {
    setError(null);
    try {
      await adminFetch(`/api/admin/student-credits/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update student credit');
    }
  };

  const manualRedeem = async (id: string) => {
    const qty = Number(prompt('How many tickets should be manually redeemed?') || '0');
    if (!Number.isFinite(qty) || qty <= 0) return;
    setError(null);
    try {
      await adminFetch(`/api/admin/student-credits/${id}/manual-redeem`, { method: 'POST', body: JSON.stringify({ quantity: Math.floor(qty) }) });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to manually redeem credits');
    }
  };

  const manualRestore = async (id: string) => {
    const qty = Number(prompt('How many tickets should be restored?') || '0');
    if (!Number.isFinite(qty) || qty <= 0) return;
    setError(null);
    try {
      await adminFetch(`/api/admin/student-credits/${id}/manual-restore`, { method: 'POST', body: JSON.stringify({ quantity: Math.floor(qty) }) });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore credits');
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 py-2">

      {/* ── Header ── */}
      <div>
        <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-widest text-stone-400">Admin</p>
        <h1
          className="text-3xl font-bold text-stone-900"
          style={{ fontFamily: "var(--font-sans)", letterSpacing: '-0.02em' }}
        >
          Student Credits
        </h1>
        <p className="mt-1 text-sm text-stone-500">
          Manage cast &amp; crew complimentary ticket balances by show.
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

      {/* ── Filters ── */}
      <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-sm">
        <SectionLabel>Filter</SectionLabel>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="mb-1 text-xs text-stone-500">Scope</p>
            <select value={scope} onChange={(e) => setScope(e.target.value as 'active' | 'archived' | 'all')} className={selectCls}>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
              <option value="all">All</option>
            </select>
          </div>
          <div>
            <p className="mb-1 text-xs text-stone-500">Show</p>
            <select value={selectedShowId} onChange={(e) => setSelectedShowId(e.target.value)} className={selectCls}>
              {shows.map((s) => <option key={s.showId} value={s.showId}>{s.showTitle}</option>)}
            </select>
          </div>
          <div>
            <p className="mb-1 text-xs text-stone-500">Search</p>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void loadCredits(selectedShowId); }}
              placeholder="Name, code, or role…"
              className={inputCls}
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={() => loadCredits(selectedShowId).catch((err) => setError(err instanceof Error ? err.message : 'Search failed'))}
              className="w-full rounded-xl bg-stone-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-stone-700"
            >
              Search
            </button>
          </div>
        </div>
      </div>

      {/* ── Create + Import (side by side) ── */}
      <div className="grid gap-4 lg:grid-cols-2">

        {/* Create */}
        <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-sm">
          <SectionLabel>Create Student Credit</SectionLabel>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                value={createForm.studentName}
                onChange={(e) => {
                  const studentName = e.target.value;
                  setCreateForm((prev) => ({
                    ...prev,
                    studentName,
                    studentEmail: autoGenerateCode ? buildStudentCodeFromName(studentName) : prev.studentEmail,
                  }));
                }}
                placeholder="Full name"
                required
                className={inputCls}
              />
              <div className="space-y-1">
                <input
                  type="text"
                  value={createForm.studentEmail}
                  onChange={(e) => setCreateForm({ ...createForm, studentEmail: normalizeStudentCode(e.target.value) })}
                  placeholder="Student code (e.g. jsmith)"
                  required
                  readOnly={autoGenerateCode}
                  className={`${inputCls} ${autoGenerateCode ? 'bg-stone-50 text-stone-500 cursor-not-allowed' : ''}`}
                />
                <button
                  type="button"
                  role="switch"
                  aria-checked={autoGenerateCode}
                  onClick={() => {
                    setAutoGenerateCode((prev) => {
                      const next = !prev;
                      if (next) {
                        setCreateForm((current) => ({
                          ...current,
                          studentEmail: buildStudentCodeFromName(current.studentName),
                        }));
                      }
                      return next;
                    });
                  }}
                  className={`inline-flex items-center gap-2 rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition ${
                    autoGenerateCode
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-stone-200 bg-white text-stone-600 hover:border-stone-300'
                  }`}
                >
                  <span
                    className={`h-4 w-7 rounded-full relative transition-colors ${
                      autoGenerateCode ? 'bg-emerald-500' : 'bg-stone-300'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform ${
                        autoGenerateCode ? 'translate-x-3.5' : 'translate-x-0.5'
                      }`}
                    />
                  </span>
                  Auto-generate from name
                </button>
              </div>
              <input
                value={createForm.roleName}
                onChange={(e) => setCreateForm({ ...createForm, roleName: e.target.value })}
                placeholder="Role (optional)"
                className={inputCls}
              />
              <div>
                <p className="mb-1 text-xs text-stone-500">Allocated tickets</p>
                <input
                  type="number"
                  min={0}
                  max={50}
                  value={createForm.allocatedTickets}
                  onChange={(e) => setCreateForm({ ...createForm, allocatedTickets: Math.max(0, Number(e.target.value) || 0) })}
                  className={inputCls}
                />
              </div>
            </div>
            <textarea
              value={createForm.notes}
              onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })}
              placeholder="Notes (optional)"
              rows={2}
              className={inputCls}
            />
            <button
              type="submit"
              className="rounded-xl bg-stone-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-stone-700"
            >
              Create Credit
            </button>
          </form>
        </div>

        {/* CSV Import */}
        <div className="rounded-2xl border border-stone-100 bg-white p-5 shadow-sm">
          <SectionLabel>CSV Import</SectionLabel>
          <form onSubmit={handleImportCsv} className="space-y-3">
            <p className="text-xs text-stone-400">
              Preferred columns: <span className="font-sans text-stone-600">studentName, roleName, allocatedTickets</span>
              <br />Student codes are auto-generated from full names (`first initial + last name`).
              <br />Legacy `studentCode` / `studentEmail` columns are optional and no longer required.
            </p>
            <div>
              <p className="mb-1 text-xs text-stone-500">Upload file</p>
              <div className="flex flex-wrap items-center gap-2">
                <input id="student-credit-csv-file" type="file" accept=".csv,text/csv" onChange={onCsvFileSelect} className="hidden" />
                <label
                  htmlFor="student-credit-csv-file"
                  className="inline-flex cursor-pointer items-center rounded-lg border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs font-semibold text-stone-700 transition hover:border-stone-300 hover:bg-white"
                >
                  {importFileName ? 'Replace CSV File' : 'Choose CSV File'}
                </label>
                <span className="text-xs text-stone-500">{importFileName || 'No file selected'}</span>
              </div>
            </div>
            <textarea
              value={importCsv}
              onChange={(e) => setImportCsv(e.target.value)}
              rows={5}
              placeholder={'studentName,roleName,allocatedTickets\nJane Smith,Juliet,2\nJohn Smith,Romeo,2'}
              className={`${inputCls} font-sans text-xs`}
            />
            {importSummary && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                {importSummary}
              </div>
            )}
            {importWarnings.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                <p className="font-semibold">{importWarnings.length} code warning{importWarnings.length === 1 ? '' : 's'}:</p>
                <ul className="mt-1 list-disc pl-4">
                  {importWarnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}
            <button
              type="submit"
              className="rounded-xl border border-stone-200 bg-stone-50 px-5 py-2.5 text-sm font-semibold text-stone-700 transition hover:bg-white hover:border-stone-300"
            >
              Import CSV
            </button>
          </form>
        </div>
      </div>

      {/* ── Student Records ── */}
      <div className="rounded-2xl border border-stone-100 bg-white shadow-sm">
        <div className="border-b border-stone-100 px-5 py-4">
          <SectionLabel>Student Records</SectionLabel>
          {!loading && rows.length > 0 && (
            <p className="text-xs text-stone-400">{rows.length} record{rows.length !== 1 ? 's' : ''} found</p>
          )}
        </div>

        {loading && (
          <div className="flex items-center gap-2 px-5 py-8 text-sm text-stone-400">
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Loading…
          </div>
        )}

        {!loading && rows.length === 0 && (
          <p className="px-5 py-8 text-center text-sm text-stone-400">No student credit records found for this show.</p>
        )}

        {!loading && rows.length > 0 && (
          <div className="space-y-3 p-4 md:hidden">
            {rows.map((row) => (
              <div key={row.id} className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-stone-900">{row.studentName}</p>
                    <p className="text-xs text-stone-500">{row.roleName ?? 'No role listed'}</p>
                    <p className="mt-1 text-xs text-stone-500">{row.studentEmail || 'Missing student code'}</p>
                  </div>
                  <Badge
                    label={row.isActive ? 'Active' : 'Inactive'}
                    style={row.isActive
                      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                      : 'bg-stone-100 text-stone-500 ring-stone-200'}
                  />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-xl bg-white px-3 py-2">
                    <p className="text-stone-400">Allocated</p>
                    <p className="font-semibold text-stone-900">{row.allocatedTickets}</p>
                  </div>
                  <div className="rounded-xl bg-white px-3 py-2">
                    <p className="text-stone-400">Used</p>
                    <p className="font-semibold text-stone-900">{row.usedTickets}</p>
                  </div>
                  <div className="rounded-xl bg-white px-3 py-2">
                    <p className="text-stone-400">Remaining</p>
                    <p className="font-semibold text-stone-900">{row.remainingTickets}</p>
                  </div>
                  <div className="rounded-xl bg-white px-3 py-2">
                    <p className="text-stone-400">Last Activity</p>
                    <p className="font-semibold text-stone-900">{row.lastTransactionDate ? new Date(row.lastTransactionDate).toLocaleDateString() : '—'}</p>
                  </div>
                </div>
                {row.pendingTickets > 0 && (
                  <p className="mt-2 text-xs font-semibold text-amber-600">{row.pendingTickets} pending ticket(s)</p>
                )}
                <div className="mt-3 flex flex-wrap gap-1">
                  <ActionButton onClick={() => {
                    const next = prompt('Set student code', row.studentEmail ?? '');
                    if (next === null) return;
                    const v = normalizeStudentCode(next);
                    if (!v) return;
                    void updateCredit(row.id, { studentEmail: v });
                  }}>
                    Edit Code
                  </ActionButton>
                  <ActionButton onClick={() => {
                    const next = prompt('Set allocated tickets', String(row.allocatedTickets));
                    const v = Number(next ?? '');
                    if (!Number.isFinite(v) || v < 0) return;
                    void updateCredit(row.id, { allocatedTickets: Math.floor(v) });
                  }}>
                    Edit Alloc.
                  </ActionButton>
                  <ActionButton
                    variant={row.isActive ? 'danger' : 'default'}
                    onClick={() => void updateCredit(row.id, { isActive: !row.isActive })}
                  >
                    {row.isActive ? 'Disable' : 'Enable'}
                  </ActionButton>
                  <ActionButton variant="warning" onClick={() => void manualRedeem(row.id)}>
                    Redeem
                  </ActionButton>
                  <ActionButton onClick={() => void manualRestore(row.id)}>
                    Restore
                  </ActionButton>
                  <ActionButton onClick={() => loadHistory(row.id).catch((err) => setError(err instanceof Error ? err.message : 'Failed to load history'))}>
                    History
                  </ActionButton>
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && rows.length > 0 && (
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b border-stone-100 text-left">
                  {['Student', 'Role', 'Student Code', 'Alloc.', 'Used', 'Remaining', 'Status', 'Last Activity', 'Actions'].map((h) => (
                    <th key={h} className="px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-stone-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-50">
                {rows.map((row) => (
                  <tr key={row.id} className="align-top hover:bg-stone-50 transition-colors">
                    <td className="px-4 py-3 font-semibold text-stone-900 whitespace-nowrap">{row.studentName}</td>
                    <td className="px-4 py-3 text-stone-500 whitespace-nowrap">{row.roleName ?? <span className="text-stone-300">—</span>}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {row.studentEmail
                        ? <span className="text-stone-600">{row.studentEmail}</span>
                        : <span className="font-semibold text-rose-600">Missing</span>}
                    </td>
                    <td className="px-4 py-3 text-center font-sans text-stone-700">{row.allocatedTickets}</td>
                    <td className="px-4 py-3 text-center font-sans text-stone-700">{row.usedTickets}</td>
                    <td className="px-4 py-3 text-center">
                      <span className="font-sans font-semibold text-stone-900">{row.remainingTickets}</span>
                      {row.pendingTickets > 0 && (
                        <span className="ml-1 text-[10px] text-amber-600">+{row.pendingTickets} pending</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        label={row.isActive ? 'Active' : 'Inactive'}
                        style={row.isActive
                          ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                          : 'bg-stone-100 text-stone-500 ring-stone-200'}
                      />
                    </td>
                    <td className="px-4 py-3 text-xs text-stone-400 whitespace-nowrap">
                      {row.lastTransactionDate ? new Date(row.lastTransactionDate).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        <ActionButton onClick={() => {
                          const next = prompt('Set student code', row.studentEmail ?? '');
                          if (next === null) return;
                          const v = normalizeStudentCode(next);
                          if (!v) return;
                          void updateCredit(row.id, { studentEmail: v });
                        }}>
                          Edit Code
                        </ActionButton>
                        <ActionButton onClick={() => {
                          const next = prompt('Set allocated tickets', String(row.allocatedTickets));
                          const v = Number(next ?? '');
                          if (!Number.isFinite(v) || v < 0) return;
                          void updateCredit(row.id, { allocatedTickets: Math.floor(v) });
                        }}>
                          Edit Alloc.
                        </ActionButton>
                        <ActionButton
                          variant={row.isActive ? 'danger' : 'default'}
                          onClick={() => void updateCredit(row.id, { isActive: !row.isActive })}
                        >
                          {row.isActive ? 'Disable' : 'Enable'}
                        </ActionButton>
                        <ActionButton variant="warning" onClick={() => void manualRedeem(row.id)}>
                          Redeem
                        </ActionButton>
                        <ActionButton onClick={() => void manualRestore(row.id)}>
                          Restore
                        </ActionButton>
                        <ActionButton onClick={() => loadHistory(row.id).catch((err) => setError(err instanceof Error ? err.message : 'Failed to load history'))}>
                          History
                        </ActionButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Transaction History ── */}
      {history && (
        <div className="rounded-2xl border border-stone-100 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 px-5 py-4">
            <div>
              <SectionLabel>Transaction History</SectionLabel>
              <p className="text-sm font-semibold text-stone-900">{history.credit.studentName}</p>
            </div>
            <button
              onClick={() => setHistory(null)}
              className="rounded-lg border border-stone-200 px-3 py-1 text-xs font-semibold text-stone-500 transition hover:border-stone-300 hover:text-stone-900"
            >
              Close
            </button>
          </div>

          {/* Summary bar */}
          <div className="flex flex-wrap gap-4 border-b border-stone-100 px-5 py-3">
            {[
              { label: 'Allocated', value: history.credit.allocatedTickets },
              { label: 'Used', value: history.credit.usedTickets },
              { label: 'Remaining', value: history.credit.remainingTickets },
              { label: 'Pending', value: history.credit.pendingTickets },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-400">{label}</p>
                <p className="text-lg font-bold text-stone-900">{value}</p>
              </div>
            ))}
          </div>

          <div className="divide-y divide-stone-50 max-h-80 overflow-auto">
            {history.transactions.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-stone-400">No transactions yet.</p>
            ) : (
              history.transactions.map((txn) => (
                <div key={txn.id} className="px-5 py-3">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <Badge label={TXN_LABELS[txn.type] ?? txn.type} style={TXN_COLORS[txn.type]} />
                    <span className="font-sans text-sm font-bold text-stone-900">×{txn.quantity}</span>
                    <span className="text-xs text-stone-400">{new Date(txn.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="space-y-0.5 text-xs text-stone-500">
                    {txn.performance && (
                      <p>{txn.performance.title ?? txn.performance.show.title} · {new Date(txn.performance.startsAt).toLocaleString()}</p>
                    )}
                    {txn.order && (
                      <p>Order {txn.order.id} · {txn.order.status} · {txn.order.source}</p>
                    )}
                    {txn.verificationMethod && <p>Method: {txn.verificationMethod}</p>}
                    {txn.redeemedBy && <p>By: {txn.redeemedBy}</p>}
                    {txn.notes && <p>Notes: {txn.notes}</p>}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
