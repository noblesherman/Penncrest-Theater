import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, Copy, Download, Plus, RefreshCw, Save, X } from 'lucide-react';
import { adminFetch } from '../../../lib/adminAuth';

type SeniorSendoffFormSummary = {
  id: string;
  showId: string;
  show: { id: string; title: string };
  publicSlug: string;
  sharePath: string;
  schemaVersion: string;
  title: string;
  instructions: string;
  deadlineAt: string;
  isOpen: boolean;
  secondSubmissionPriceCents: number;
  acceptingResponses: boolean;
  status: 'OPEN' | 'CLOSED';
  responseCount: number;
  paidResponseCount: number;
  createdAt: string;
  updatedAt: string;
};

type SeniorSendoffSubmission = {
  id: string;
  formId: string;
  parentName: string;
  parentEmail: string;
  parentPhone: string;
  studentName: string;
  message: string;
  entryNumber: number;
  isPaid: boolean;
  paymentIntentId?: string | null;
  paymentAmountCents?: number | null;
  paymentCurrency?: string | null;
  submittedAt: string;
  createdAt: string;
  updatedAt: string;
};

type PerformanceRow = { showId: string; showTitle: string };
type ShowOption = { id: string; title: string };
type FormDraft = {
  title: string;
  instructions: string;
  deadlineAt: string;
  isOpen: boolean;
  secondSubmissionPriceCents: number;
};

const inputCls =
  'w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-400 focus:outline-none transition';
const labelCls = 'block text-xs font-semibold uppercase tracking-wider text-stone-500 mb-1.5';

function toLocalInputValue(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function toIsoFromLocalInput(value: string): string {
  return new Date(value).toISOString();
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function toSlugSafe(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function parseUsdToCents(value: string): number | null {
  const normalized = value.replace(/[^\d.]/g, '').trim();
  if (!normalized) return null;
  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100);
}

export default function SeniorSendoffFormsPanel() {
  const [forms, setForms] = useState<SeniorSendoffFormSummary[]>([]);
  const [shows, setShows] = useState<ShowOption[]>([]);
  const [selectedShowId, setSelectedShowId] = useState('');
  const [createDeadlineAt, setCreateDeadlineAt] = useState('');
  const [createSecondSubmissionPrice, setCreateSecondSubmissionPrice] = useState('25.00');
  const [selectedFormId, setSelectedFormId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, FormDraft>>({});
  const [submissions, setSubmissions] = useState<SeniorSendoffSubmission[]>([]);
  const [selectedSubmission, setSelectedSubmission] = useState<SeniorSendoffSubmission | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'settings' | 'responses'>('settings');

  const selectedForm = useMemo(() => forms.find((f) => f.id === selectedFormId) ?? null, [forms, selectedFormId]);
  const selectedDraft = selectedForm ? drafts[selectedForm.id] : null;

  const loadBase = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [formRows, performanceRows] = await Promise.all([
        adminFetch<SeniorSendoffFormSummary[]>('/api/admin/forms/senior-sendoff'),
        adminFetch<PerformanceRow[]>('/api/admin/performances?scope=all&kind=all')
      ]);

      const showMap = new Map<string, ShowOption>();
      performanceRows.forEach((row) => {
        if (!showMap.has(row.showId)) showMap.set(row.showId, { id: row.showId, title: row.showTitle });
      });

      setShows(Array.from(showMap.values()).sort((a, b) => a.title.localeCompare(b.title)));
      setForms(formRows);
      setDrafts(
        Object.fromEntries(
          formRows.map((form) => [
            form.id,
            {
              title: form.title,
              instructions: form.instructions,
              deadlineAt: toLocalInputValue(form.deadlineAt),
              isOpen: form.isOpen,
              secondSubmissionPriceCents: form.secondSubmissionPriceCents
            }
          ])
        )
      );

      setSelectedFormId((current) => {
        if (current && formRows.some((row) => row.id === current)) return current;
        return formRows[0]?.id ?? null;
      });

      if (!selectedShowId && showMap.size > 0) {
        setSelectedShowId(Array.from(showMap.values())[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load forms');
    } finally {
      setLoading(false);
    }
  }, [selectedShowId]);

  const loadSubmissions = useCallback(async (formId: string) => {
    setLoadingSubmissions(true);
    setError(null);
    try {
      const rows = await adminFetch<SeniorSendoffSubmission[]>(
        `/api/admin/forms/senior-sendoff/${formId}/submissions`
      );
      setSubmissions(rows);
    } catch (err) {
      setSubmissions([]);
      setError(err instanceof Error ? err.message : 'Failed to load submissions');
    } finally {
      setLoadingSubmissions(false);
    }
  }, []);

  useEffect(() => {
    void loadBase();
  }, [loadBase]);

  useEffect(() => {
    if (!selectedFormId) {
      setSubmissions([]);
      return;
    }
    void loadSubmissions(selectedFormId);
  }, [selectedFormId, loadSubmissions]);

  async function createForm(): Promise<void> {
    if (!selectedShowId) {
      setError('Choose a show first.');
      return;
    }

    const secondSubmissionPriceCents = parseUsdToCents(createSecondSubmissionPrice);
    if (secondSubmissionPriceCents === null) {
      setError('Enter a valid second shout-out fee amount.');
      return;
    }

    setCreating(true);
    setError(null);
    setNotice(null);

    try {
      const created = await adminFetch<SeniorSendoffFormSummary>('/api/admin/forms/senior-sendoff', {
        method: 'POST',
        body: JSON.stringify({
          showId: selectedShowId,
          secondSubmissionPriceCents,
          ...(createDeadlineAt ? { deadlineAt: toIsoFromLocalInput(createDeadlineAt) } : {})
        })
      });

      setForms((current) => [created, ...current]);
      setDrafts((current) => ({
        ...current,
        [created.id]: {
          title: created.title,
          instructions: created.instructions,
          deadlineAt: toLocalInputValue(created.deadlineAt),
          isOpen: created.isOpen,
          secondSubmissionPriceCents: created.secondSubmissionPriceCents
        }
      }));
      setSelectedFormId(created.id);
      setNotice('Senior send-off form created.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create form');
    } finally {
      setCreating(false);
    }
  }

  async function saveForm(formId: string): Promise<void> {
    const draft = drafts[formId];
    if (!draft) return;

    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const updated = await adminFetch<SeniorSendoffFormSummary>(`/api/admin/forms/senior-sendoff/${formId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: draft.title.trim(),
          instructions: draft.instructions.trim(),
          deadlineAt: toIsoFromLocalInput(draft.deadlineAt),
          isOpen: draft.isOpen,
          secondSubmissionPriceCents: draft.secondSubmissionPriceCents
        })
      });

      setForms((current) => current.map((row) => (row.id === formId ? updated : row)));
      setDrafts((current) => ({
        ...current,
        [formId]: {
          title: updated.title,
          instructions: updated.instructions,
          deadlineAt: toLocalInputValue(updated.deadlineAt),
          isOpen: updated.isOpen,
          secondSubmissionPriceCents: updated.secondSubmissionPriceCents
        }
      }));
      setNotice('Form settings saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save form settings');
    } finally {
      setSaving(false);
    }
  }

  async function copyShareLink(form: SeniorSendoffFormSummary): Promise<void> {
    const url = `${window.location.origin}${form.sharePath}`;
    try {
      await navigator.clipboard.writeText(url);
      setNotice('Share link copied.');
    } catch {
      setError('Unable to copy link on this device/browser.');
    }
  }

  function exportSubmissionsCsv(form: SeniorSendoffFormSummary): void {
    const headers = [
      'Submission ID',
      'Form ID',
      'Form Title',
      'Show ID',
      'Show Title',
      'Parent Name',
      'Parent Email',
      'Parent Phone',
      'Student Name',
      'Message',
      'Entry Number',
      'Is Paid',
      'Payment Amount',
      'Payment Currency',
      'Payment Intent ID',
      'Submitted At (Local)',
      'Created At (Local)',
      'Updated At (Local)'
    ];

    const rows = submissions.map((submission) => [
      submission.id,
      submission.formId,
      form.title,
      form.showId,
      form.show.title,
      submission.parentName,
      submission.parentEmail,
      submission.parentPhone,
      submission.studentName,
      submission.message,
      submission.entryNumber,
      submission.isPaid ? 'Yes' : 'No',
      submission.paymentAmountCents !== null && submission.paymentAmountCents !== undefined
        ? formatUsd(submission.paymentAmountCents)
        : '',
      submission.paymentCurrency || '',
      submission.paymentIntentId || '',
      formatDateTime(submission.submittedAt),
      formatDateTime(submission.createdAt),
      formatDateTime(submission.updatedAt)
    ]);

    const csvContent = [headers, ...rows]
      .map((row) => row.map((value) => escapeCsvValue(value)).join(','))
      .join('\n');

    const today = new Date().toISOString().slice(0, 10);
    const showSlug = toSlugSafe(form.show.title) || 'show';
    const fileName = `senior-sendoff-submissions-${showSlug}-${today}.csv`;
    const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
    setNotice(`Exported ${submissions.length} response${submissions.length === 1 ? '' : 's'} to CSV.`);
  }

  const usedShowIds = useMemo(() => new Set(forms.map((form) => form.showId)), [forms]);

  return (
    <div className="min-h-screen bg-stone-50 p-6 font-sans">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-red-700">Admin</p>
            <h1 className="mt-0.5 text-2xl font-bold text-stone-900">Senior Send-Off Forms</h1>
            <p className="mt-1 text-sm text-stone-500">Create and manage playbill shout-out forms by show.</p>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-semibold text-stone-600 transition hover:bg-stone-50 disabled:opacity-50"
            onClick={() => void loadBase()}
            disabled={loading}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <span className="mt-0.5 h-1.5 w-1.5 flex-none rounded-full bg-red-500" />
            {error}
          </div>
        )}
        {notice && (
          <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            <span className="mt-0.5 h-1.5 w-1.5 flex-none rounded-full bg-emerald-500" />
            {notice}
          </div>
        )}

        <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <p className={labelCls}>Create New Form</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2 lg:col-span-1">
              <p className="mb-1.5 text-xs text-stone-500">Show</p>
              <select className={inputCls} value={selectedShowId} onChange={(event) => setSelectedShowId(event.target.value)}>
                {shows.length === 0 && <option value="">No shows available</option>}
                {shows.map((show) => (
                  <option key={show.id} value={show.id} disabled={usedShowIds.has(show.id)}>
                    {show.title}
                    {usedShowIds.has(show.id) ? ' - form exists' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <p className="mb-1.5 text-xs text-stone-500">Deadline (optional)</p>
              <input type="datetime-local" value={createDeadlineAt} onChange={(event) => setCreateDeadlineAt(event.target.value)} className={inputCls} />
            </div>
            <div>
              <p className="mb-1.5 text-xs text-stone-500">2nd shout-out fee (USD)</p>
              <input
                value={createSecondSubmissionPrice}
                onChange={(event) => setCreateSecondSubmissionPrice(event.target.value)}
                className={inputCls}
                placeholder="25.00"
              />
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => void createForm()}
                disabled={creating || !selectedShowId || usedShowIds.has(selectedShowId)}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />
                {creating ? 'Creating...' : 'Create Form'}
              </button>
            </div>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[260px,1fr]">
          <aside className="space-y-2">
            <p className={labelCls + ' px-1'}>All Forms</p>
            {forms.length === 0 && !loading && (
              <p className="rounded-xl border border-stone-200 bg-white px-4 py-6 text-center text-sm text-stone-400">No forms yet.</p>
            )}
            {forms.map((form) => {
              const active = form.id === selectedFormId;
              return (
                <button
                  key={form.id}
                  type="button"
                  onClick={() => setSelectedFormId(form.id)}
                  className={`group w-full rounded-xl border px-4 py-3 text-left transition ${
                    active
                      ? 'border-red-200 bg-red-50'
                      : 'border-stone-200 bg-white hover:border-stone-300 hover:bg-stone-50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-stone-900 leading-tight">{form.show.title}</span>
                    <ChevronRight className={`h-3.5 w-3.5 flex-none transition ${active ? 'text-red-500' : 'text-stone-300 group-hover:text-stone-400'}`} />
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${form.status === 'OPEN' ? 'bg-emerald-100 text-emerald-700' : 'bg-stone-100 text-stone-500'}`}>
                      {form.status}
                    </span>
                    <span className="text-xs text-stone-400">{form.responseCount} responses</span>
                  </div>
                </button>
              );
            })}
          </aside>

          <div className="rounded-2xl border border-stone-200 bg-white shadow-sm">
            {!selectedForm || !selectedDraft ? (
              <div className="flex h-48 items-center justify-center text-sm text-stone-400">Select a form to view details.</div>
            ) : (
              <div>
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-100 px-6 pt-5 pb-4">
                  <div>
                    <h2 className="text-lg font-bold text-stone-900">{selectedForm.show.title}</h2>
                    <p className="mt-0.5 text-xs text-stone-400">Schema v{selectedForm.schemaVersion} - {selectedForm.responseCount} total - {selectedForm.paidResponseCount} paid</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void copyShareLink(selectedForm)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-semibold text-stone-600 transition hover:bg-stone-50"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      Copy Link
                    </button>
                    <button
                      type="button"
                      onClick={() => void saveForm(selectedForm.id)}
                      disabled={saving}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-stone-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-stone-700 disabled:opacity-50"
                    >
                      <Save className="h-3.5 w-3.5" />
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>

                <div className="flex gap-0 border-b border-stone-100 px-6">
                  {[
                    { key: 'settings', label: 'Settings' },
                    { key: 'responses', label: `Responses${submissions.length ? ` (${submissions.length})` : ''}` }
                  ].map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setActiveTab(tab.key as 'settings' | 'responses')}
                      className={`py-3 px-1 mr-6 text-sm font-semibold border-b-2 transition ${
                        activeTab === tab.key
                          ? 'border-red-700 text-red-700'
                          : 'border-transparent text-stone-400 hover:text-stone-700'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <div className="p-6">
                  {activeTab === 'settings' && (
                    <div className="space-y-5">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <label className={labelCls}>Title</label>
                          <input
                            value={selectedDraft.title}
                            onChange={(event) =>
                              setDrafts((current) => ({
                                ...current,
                                [selectedForm.id]: { ...current[selectedForm.id], title: event.target.value }
                              }))
                            }
                            className={inputCls}
                          />
                        </div>
                        <div>
                          <label className={labelCls}>Submission Deadline</label>
                          <input
                            type="datetime-local"
                            value={selectedDraft.deadlineAt}
                            onChange={(event) =>
                              setDrafts((current) => ({
                                ...current,
                                [selectedForm.id]: { ...current[selectedForm.id], deadlineAt: event.target.value }
                              }))
                            }
                            className={inputCls}
                          />
                        </div>
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <label className={labelCls}>Second Shout-Out Fee (USD)</label>
                          <input
                            value={(selectedDraft.secondSubmissionPriceCents / 100).toFixed(2)}
                            onChange={(event) => {
                              const cents = parseUsdToCents(event.target.value);
                              setDrafts((current) => ({
                                ...current,
                                [selectedForm.id]: {
                                  ...current[selectedForm.id],
                                  secondSubmissionPriceCents: cents ?? current[selectedForm.id].secondSubmissionPriceCents
                                }
                              }));
                            }}
                            className={inputCls}
                          />
                          <p className="mt-1 text-xs text-stone-400">Set to 0.00 to make both shout-outs free.</p>
                        </div>
                        <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
                          <p className="text-xs font-semibold uppercase tracking-wider text-stone-400">Current fee</p>
                          <p className="mt-1 text-lg font-bold text-stone-900">{formatUsd(selectedDraft.secondSubmissionPriceCents)}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
                        <input
                          id="senior-sendoff-is-open"
                          type="checkbox"
                          checked={selectedDraft.isOpen}
                          onChange={(event) =>
                            setDrafts((current) => ({
                              ...current,
                              [selectedForm.id]: { ...current[selectedForm.id], isOpen: event.target.checked }
                            }))
                          }
                          className="h-4 w-4 rounded border-stone-300 accent-red-700"
                        />
                        <label htmlFor="senior-sendoff-is-open" className="text-sm font-medium text-stone-700 cursor-pointer">
                          Form is open - parents can submit shout-outs
                        </label>
                      </div>

                      <div>
                        <label className={labelCls}>Instructions</label>
                        <textarea
                          rows={7}
                          value={selectedDraft.instructions}
                          onChange={(event) =>
                            setDrafts((current) => ({
                              ...current,
                              [selectedForm.id]: { ...current[selectedForm.id], instructions: event.target.value }
                            }))
                          }
                          className={inputCls + ' resize-none'}
                          placeholder="Instructions shown at the top of the public form..."
                        />
                      </div>
                    </div>
                  )}

                  {activeTab === 'responses' && (
                    <div>
                      <div className="mb-4 flex items-center justify-between">
                        <p className="text-xs text-stone-500">Track free vs paid second shout-outs and export all responses.</p>
                        <button
                          type="button"
                          onClick={() => exportSubmissionsCsv(selectedForm)}
                          disabled={submissions.length === 0}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-semibold text-stone-700 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Download className="h-3.5 w-3.5" />
                          Export CSV
                        </button>
                      </div>

                      {loadingSubmissions && (
                        <div className="flex items-center justify-center py-10">
                          <div className="h-7 w-7 animate-spin rounded-full border-2 border-stone-200 border-t-red-700" />
                        </div>
                      )}

                      {!loadingSubmissions && submissions.length === 0 && (
                        <div className="rounded-xl border border-dashed border-stone-200 px-4 py-10 text-center text-sm text-stone-400">
                          No responses yet.
                        </div>
                      )}

                      {!loadingSubmissions && submissions.length > 0 && (
                        <div className="overflow-hidden rounded-xl border border-stone-200">
                          <table className="min-w-full text-sm">
                            <thead>
                              <tr className="bg-stone-50 text-left">
                                <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-stone-500">Parent</th>
                                <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-stone-500">Student</th>
                                <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-stone-500">Entry</th>
                                <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-stone-500">Paid</th>
                                <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-stone-500">Updated</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-stone-100">
                              {submissions.map((submission) => (
                                <tr
                                  key={submission.id}
                                  className="cursor-pointer transition hover:bg-stone-50"
                                  onClick={() => setSelectedSubmission(submission)}
                                >
                                  <td className="px-4 py-3 font-medium text-stone-900">{submission.parentName}</td>
                                  <td className="px-4 py-3 text-stone-500">{submission.studentName}</td>
                                  <td className="px-4 py-3 text-stone-500">#{submission.entryNumber}</td>
                                  <td className="px-4 py-3 text-stone-500">{submission.isPaid ? 'Yes' : 'No'}</td>
                                  <td className="px-4 py-3 text-stone-400">{new Date(submission.updatedAt).toLocaleDateString()}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {selectedSubmission && (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={() => setSelectedSubmission(null)}>
          <div className="absolute inset-0 bg-black/25 backdrop-blur-sm" />
          <div
            className="relative z-10 h-full w-full max-w-md overflow-y-auto bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-stone-100 bg-white px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Response</p>
                <p className="mt-0.5 text-base font-bold text-stone-900">{selectedSubmission.parentName}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedSubmission(null)}
                className="rounded-lg p-1.5 text-stone-400 transition hover:bg-stone-100 hover:text-stone-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-5">
              <div className="grid grid-cols-2 gap-3">
                {[
                  ['Parent Email', selectedSubmission.parentEmail],
                  ['Parent Phone', selectedSubmission.parentPhone],
                  ['Student', selectedSubmission.studentName],
                  ['Entry', `#${selectedSubmission.entryNumber} of 2`],
                  ['Paid', selectedSubmission.isPaid ? 'Yes' : 'No'],
                  ['Submitted', new Date(selectedSubmission.submittedAt).toLocaleDateString()]
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl bg-stone-50 px-3 py-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-400">{label}</p>
                    <p className="mt-0.5 text-sm font-medium text-stone-800 break-words">{value}</p>
                  </div>
                ))}
              </div>

              {selectedSubmission.paymentIntentId && (
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-stone-400">Payment</p>
                  <div className="rounded-xl border border-stone-100 bg-stone-50 px-4 py-3 text-sm text-stone-700">
                    <p>
                      Amount:{' '}
                      {selectedSubmission.paymentAmountCents !== null && selectedSubmission.paymentAmountCents !== undefined
                        ? formatUsd(selectedSubmission.paymentAmountCents)
                        : '-'}{' '}
                      {(selectedSubmission.paymentCurrency || '').toUpperCase()}
                    </p>
                    <p className="mt-1 break-all text-xs text-stone-500">{selectedSubmission.paymentIntentId}</p>
                  </div>
                </div>
              )}

              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-stone-400">Message</p>
                <p className="whitespace-pre-wrap rounded-xl border border-stone-100 bg-stone-50 px-4 py-3 text-sm leading-relaxed text-stone-700">
                  {selectedSubmission.message || '-'}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
