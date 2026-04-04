import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, RefreshCw, Save, Users, X } from 'lucide-react';
import { adminFetch } from '../../lib/adminAuth';

type ProgramBioFormSummary = {
  id: string;
  showId: string;
  show: { id: string; title: string };
  publicSlug: string;
  sharePath: string;
  schemaVersion: string;
  title: string;
  instructions: string;
  questions: ProgramBioQuestions;
  deadlineAt: string;
  isOpen: boolean;
  acceptingResponses: boolean;
  status: 'OPEN' | 'CLOSED';
  responseCount: number;
  createdAt: string;
  updatedAt: string;
};

type ProgramBioQuestions = {
  fullNameLabel: string;
  schoolEmailLabel: string;
  gradeLevelLabel: string;
  roleInShowLabel: string;
  bioLabel: string;
  headshotLabel: string;
};

type ProgramBioSubmission = {
  id: string;
  formId: string;
  fullName: string;
  schoolEmail: string;
  gradeLevel: number;
  roleInShow: string;
  bio: string;
  headshotUrl: string;
  submittedAt: string;
  createdAt: string;
  updatedAt: string;
};

type PerformanceRow = {
  showId: string;
  showTitle: string;
};

type ShowOption = {
  id: string;
  title: string;
};

type FormDraft = {
  title: string;
  instructions: string;
  questions: ProgramBioQuestions;
  deadlineAt: string;
  isOpen: boolean;
};

type SyncResult = {
  formId: string;
  submissionCount: number;
  syncCast: { created: number; updated: number; skipped: number } | null;
  syncStudentCredits: { created: number; updated: number; skipped: number } | null;
};

const DEFAULT_PROGRAM_BIO_QUESTIONS: ProgramBioQuestions = {
  fullNameLabel: 'Full name',
  schoolEmailLabel: 'School email',
  gradeLevelLabel: 'Grade',
  roleInShowLabel: 'Role in show',
  bioLabel: 'Bio',
  headshotLabel: 'Headshot upload'
};

function normalizeQuestions(questions: Partial<ProgramBioQuestions> | undefined): ProgramBioQuestions {
  return {
    ...DEFAULT_PROGRAM_BIO_QUESTIONS,
    ...(questions || {})
  };
}

function toLocalInputValue(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function toIsoFromLocalInput(value: string): string {
  const date = new Date(value);
  return date.toISOString();
}

export default function AdminFormsPage() {
  const [forms, setForms] = useState<ProgramBioFormSummary[]>([]);
  const [shows, setShows] = useState<ShowOption[]>([]);
  const [selectedShowId, setSelectedShowId] = useState('');
  const [createDeadlineAt, setCreateDeadlineAt] = useState('');
  const [selectedFormId, setSelectedFormId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, FormDraft>>({});
  const [submissions, setSubmissions] = useState<ProgramBioSubmission[]>([]);
  const [selectedSubmission, setSelectedSubmission] = useState<ProgramBioSubmission | null>(null);
  const [syncCast, setSyncCast] = useState(true);
  const [syncStudentCredits, setSyncStudentCredits] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedForm = useMemo(
    () => forms.find((form) => form.id === selectedFormId) || null,
    [forms, selectedFormId]
  );

  const selectedDraft = selectedForm ? drafts[selectedForm.id] : null;

  const loadBase = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [formRows, performanceRows] = await Promise.all([
        adminFetch<ProgramBioFormSummary[]>('/api/admin/forms'),
        adminFetch<PerformanceRow[]>('/api/admin/performances?scope=all&kind=all')
      ]);
      const normalizedFormRows = formRows.map((form) => ({
        ...form,
        questions: normalizeQuestions(form.questions)
      }));

      const showMap = new Map<string, ShowOption>();
      performanceRows.forEach((row) => {
        if (!showMap.has(row.showId)) {
          showMap.set(row.showId, { id: row.showId, title: row.showTitle });
        }
      });

      setShows(Array.from(showMap.values()).sort((a, b) => a.title.localeCompare(b.title)));
      setForms(normalizedFormRows);
      setDrafts(
        Object.fromEntries(
          normalizedFormRows.map((form) => [
            form.id,
            {
              title: form.title,
              instructions: form.instructions,
              questions: form.questions,
              deadlineAt: toLocalInputValue(form.deadlineAt),
              isOpen: form.isOpen
            }
          ])
        )
      );
      setSelectedFormId((current) => {
        if (current && normalizedFormRows.some((row) => row.id === current)) return current;
        return normalizedFormRows[0]?.id || null;
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
      const rows = await adminFetch<ProgramBioSubmission[]>(`/api/admin/forms/${formId}/submissions`);
      setSubmissions(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load submissions');
      setSubmissions([]);
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

    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      const created = await adminFetch<ProgramBioFormSummary>('/api/admin/forms', {
        method: 'POST',
        body: JSON.stringify({
          showId: selectedShowId,
          ...(createDeadlineAt ? { deadlineAt: toIsoFromLocalInput(createDeadlineAt) } : {})
        })
      });

      setForms((current) => [created, ...current]);
      setDrafts((current) => ({
        ...current,
        [created.id]: {
          title: created.title,
          instructions: created.instructions,
          questions: normalizeQuestions(created.questions),
          deadlineAt: toLocalInputValue(created.deadlineAt),
          isOpen: created.isOpen
        }
      }));
      setSelectedFormId(created.id);
      setNotice('Program bio form created.');
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
      const updated = await adminFetch<ProgramBioFormSummary>(`/api/admin/forms/${formId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: draft.title.trim(),
          instructions: draft.instructions.trim(),
          questions: draft.questions,
          deadlineAt: toIsoFromLocalInput(draft.deadlineAt),
          isOpen: draft.isOpen
        })
      });

      setForms((current) => current.map((row) => (row.id === formId ? updated : row)));
      setDrafts((current) => ({
        ...current,
        [formId]: {
          title: updated.title,
          instructions: updated.instructions,
          questions: normalizeQuestions(updated.questions),
          deadlineAt: toLocalInputValue(updated.deadlineAt),
          isOpen: updated.isOpen
        }
      }));
      setNotice('Form settings saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save form settings');
    } finally {
      setSaving(false);
    }
  }

  async function runSync(formId: string): Promise<void> {
    if (!syncCast && !syncStudentCredits) {
      setError('Choose at least one sync target.');
      return;
    }

    setSyncing(true);
    setError(null);
    setNotice(null);
    setSyncResult(null);
    try {
      const result = await adminFetch<SyncResult>(`/api/admin/forms/${formId}/sync`, {
        method: 'POST',
        body: JSON.stringify({ syncCast, syncStudentCredits })
      });
      setSyncResult(result);
      await loadBase();
      await loadSubmissions(formId);
      setNotice('Sync completed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync form submissions');
    } finally {
      setSyncing(false);
    }
  }

  async function copyShareLink(form: ProgramBioFormSummary): Promise<void> {
    const url = `${window.location.origin}${form.sharePath}`;
    try {
      await navigator.clipboard.writeText(url);
      setNotice('Share link copied.');
    } catch {
      setError('Unable to copy link on this device/browser.');
    }
  }

  const usedShowIds = useMemo(() => new Set(forms.map((form) => form.showId)), [forms]);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <h1 className="text-2xl font-black text-stone-900">Admin Forms</h1>
        <p className="mt-1 text-sm text-stone-600">Create and manage Program Bio forms linked to a specific show.</p>

        <div className="mt-4 grid gap-3 md:grid-cols-[1fr,220px,auto]">
          <select
            className="rounded-xl border border-stone-300 px-3 py-2 text-sm"
            value={selectedShowId}
            onChange={(event) => setSelectedShowId(event.target.value)}
          >
            {shows.length === 0 ? <option value="">No shows available</option> : null}
            {shows.map((show) => (
              <option key={show.id} value={show.id} disabled={usedShowIds.has(show.id)}>
                {show.title}{usedShowIds.has(show.id) ? ' (form exists)' : ''}
              </option>
            ))}
          </select>

          <input
            type="datetime-local"
            value={createDeadlineAt}
            onChange={(event) => setCreateDeadlineAt(event.target.value)}
            className="rounded-xl border border-stone-300 px-3 py-2 text-sm"
          />

          <button
            type="button"
            onClick={() => void createForm()}
            disabled={creating || !selectedShowId || usedShowIds.has(selectedShowId)}
            className="inline-flex items-center justify-center rounded-xl bg-red-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {creating ? 'Creating…' : 'Create Form'}
          </button>
        </div>
      </div>

      {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
      {notice ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</div> : null}

      <div className="grid gap-5 lg:grid-cols-[300px,1fr]">
        <aside className="rounded-2xl border border-stone-200 bg-white p-3 shadow-sm">
          <div className="mb-2 flex items-center justify-between px-1">
            <h2 className="text-sm font-semibold text-stone-700">Forms</h2>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-stone-600 hover:bg-stone-100"
              onClick={() => void loadBase()}
              disabled={loading}
            >
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </button>
          </div>

          {forms.length === 0 ? <div className="px-1 py-4 text-sm text-stone-500">No forms yet.</div> : null}

          <div className="space-y-2">
            {forms.map((form) => {
              const active = form.id === selectedFormId;
              return (
                <button
                  type="button"
                  key={form.id}
                  onClick={() => setSelectedFormId(form.id)}
                  className={`w-full rounded-xl border px-3 py-2 text-left transition ${
                    active ? 'border-red-300 bg-red-50' : 'border-stone-200 bg-white hover:border-stone-300'
                  }`}
                >
                  <div className="text-sm font-semibold text-stone-900">{form.show.title}</div>
                  <div className="mt-0.5 text-xs text-stone-600">{form.responseCount} responses</div>
                  <div className="mt-1 text-[11px] font-semibold text-stone-500">{form.status}</div>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          {!selectedForm || !selectedDraft ? (
            <div className="text-sm text-stone-500">Select a form to view details.</div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-xl font-black text-stone-900">{selectedForm.show.title}</h2>
                  <div className="text-xs text-stone-500">Schema: {selectedForm.schemaVersion}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void copyShareLink(selectedForm)}
                    className="inline-flex items-center gap-1 rounded-lg border border-stone-300 px-3 py-1.5 text-xs font-semibold text-stone-700"
                  >
                    <Copy className="h-3.5 w-3.5" /> Copy Link
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveForm(selectedForm.id)}
                    disabled={saving}
                    className="inline-flex items-center gap-1 rounded-lg bg-stone-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                  >
                    <Save className="h-3.5 w-3.5" /> {saving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-1 text-sm">
                  <span className="font-semibold text-stone-700">Title</span>
                  <input
                    value={selectedDraft.title}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [selectedForm.id]: { ...current[selectedForm.id], title: event.target.value }
                      }))
                    }
                    className="w-full rounded-xl border border-stone-300 px-3 py-2"
                  />
                </label>

                <label className="space-y-1 text-sm">
                  <span className="font-semibold text-stone-700">Deadline</span>
                  <input
                    type="datetime-local"
                    value={selectedDraft.deadlineAt}
                    onChange={(event) =>
                      setDrafts((current) => ({
                        ...current,
                        [selectedForm.id]: { ...current[selectedForm.id], deadlineAt: event.target.value }
                      }))
                    }
                    className="w-full rounded-xl border border-stone-300 px-3 py-2"
                  />
                </label>
              </div>

              <label className="flex items-center gap-2 text-sm text-stone-700">
                <input
                  type="checkbox"
                  checked={selectedDraft.isOpen}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [selectedForm.id]: { ...current[selectedForm.id], isOpen: event.target.checked }
                    }))
                  }
                />
                Form is open
              </label>

              <label className="space-y-1 text-sm">
                <span className="font-semibold text-stone-700">Instructions</span>
                <textarea
                  rows={8}
                  value={selectedDraft.instructions}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [selectedForm.id]: { ...current[selectedForm.id], instructions: event.target.value }
                    }))
                  }
                  className="w-full rounded-xl border border-stone-300 px-3 py-2"
                />
              </label>

              <div className="space-y-3 rounded-xl border border-stone-200 bg-stone-50 p-3">
                <h3 className="text-sm font-semibold text-stone-800">Form Questions</h3>
                <p className="text-xs text-stone-600">Edit the labels students see on the public form.</p>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="space-y-1 text-sm">
                    <span className="font-semibold text-stone-700">Full Name</span>
                    <input
                      value={selectedDraft.questions.fullNameLabel}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [selectedForm.id]: {
                            ...current[selectedForm.id],
                            questions: {
                              ...current[selectedForm.id].questions,
                              fullNameLabel: event.target.value
                            }
                          }
                        }))
                      }
                      className="w-full rounded-xl border border-stone-300 px-3 py-2"
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="font-semibold text-stone-700">School Email</span>
                    <input
                      value={selectedDraft.questions.schoolEmailLabel}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [selectedForm.id]: {
                            ...current[selectedForm.id],
                            questions: {
                              ...current[selectedForm.id].questions,
                              schoolEmailLabel: event.target.value
                            }
                          }
                        }))
                      }
                      className="w-full rounded-xl border border-stone-300 px-3 py-2"
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="font-semibold text-stone-700">Grade</span>
                    <input
                      value={selectedDraft.questions.gradeLevelLabel}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [selectedForm.id]: {
                            ...current[selectedForm.id],
                            questions: {
                              ...current[selectedForm.id].questions,
                              gradeLevelLabel: event.target.value
                            }
                          }
                        }))
                      }
                      className="w-full rounded-xl border border-stone-300 px-3 py-2"
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="font-semibold text-stone-700">Role In Show</span>
                    <input
                      value={selectedDraft.questions.roleInShowLabel}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [selectedForm.id]: {
                            ...current[selectedForm.id],
                            questions: {
                              ...current[selectedForm.id].questions,
                              roleInShowLabel: event.target.value
                            }
                          }
                        }))
                      }
                      className="w-full rounded-xl border border-stone-300 px-3 py-2"
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="font-semibold text-stone-700">Bio</span>
                    <input
                      value={selectedDraft.questions.bioLabel}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [selectedForm.id]: {
                            ...current[selectedForm.id],
                            questions: {
                              ...current[selectedForm.id].questions,
                              bioLabel: event.target.value
                            }
                          }
                        }))
                      }
                      className="w-full rounded-xl border border-stone-300 px-3 py-2"
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="font-semibold text-stone-700">Headshot</span>
                    <input
                      value={selectedDraft.questions.headshotLabel}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [selectedForm.id]: {
                            ...current[selectedForm.id],
                            questions: {
                              ...current[selectedForm.id].questions,
                              headshotLabel: event.target.value
                            }
                          }
                        }))
                      }
                      className="w-full rounded-xl border border-stone-300 px-3 py-2"
                    />
                  </label>
                </div>
              </div>

              <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
                <div className="text-sm font-semibold text-stone-800">Sync to Show</div>
                <div className="mt-2 space-y-2 text-sm text-stone-700">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={syncCast} onChange={(event) => setSyncCast(event.target.checked)} />
                    sync cast
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={syncStudentCredits}
                      onChange={(event) => setSyncStudentCredits(event.target.checked)}
                    />
                    sync cast promo codes (Student Credits)
                  </label>
                </div>
                <button
                  type="button"
                  onClick={() => void runSync(selectedForm.id)}
                  disabled={syncing || (!syncCast && !syncStudentCredits)}
                  className="mt-3 inline-flex items-center gap-2 rounded-lg bg-red-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                >
                  <Users className="h-3.5 w-3.5" /> {syncing ? 'Syncing…' : 'Sync to Show'}
                </button>

                {syncResult ? (
                  <div className="mt-3 rounded-lg border border-stone-200 bg-white p-2 text-xs text-stone-700">
                    <div>Processed submissions: {syncResult.submissionCount}</div>
                    {syncResult.syncCast ? (
                      <div>
                        Cast: +{syncResult.syncCast.created} created, {syncResult.syncCast.updated} updated, {syncResult.syncCast.skipped} skipped
                      </div>
                    ) : null}
                    {syncResult.syncStudentCredits ? (
                      <div>
                        Student Credits: +{syncResult.syncStudentCredits.created} created, {syncResult.syncStudentCredits.updated} updated, {syncResult.syncStudentCredits.skipped} skipped
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div>
                <h3 className="text-sm font-semibold text-stone-800">Responses</h3>
                {loadingSubmissions ? <div className="mt-2 text-sm text-stone-500">Loading responses…</div> : null}
                {!loadingSubmissions && submissions.length === 0 ? (
                  <div className="mt-2 text-sm text-stone-500">No responses yet.</div>
                ) : null}

                {!loadingSubmissions && submissions.length > 0 ? (
                  <div className="mt-2 overflow-x-auto rounded-xl border border-stone-200">
                    <table className="min-w-full text-left text-sm">
                      <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                        <tr>
                          <th className="px-3 py-2">Name</th>
                          <th className="px-3 py-2">Email</th>
                          <th className="px-3 py-2">Grade</th>
                          <th className="px-3 py-2">Updated</th>
                        </tr>
                      </thead>
                      <tbody>
                        {submissions.map((submission) => (
                          <tr
                            key={submission.id}
                            className="cursor-pointer border-t border-stone-100 hover:bg-stone-50"
                            onClick={() => setSelectedSubmission(submission)}
                          >
                            <td className="px-3 py-2 font-medium text-stone-900">{submission.fullName}</td>
                            <td className="px-3 py-2 text-stone-700">{submission.schoolEmail}</td>
                            <td className="px-3 py-2 text-stone-700">{submission.gradeLevel}</td>
                            <td className="px-3 py-2 text-stone-600">{new Date(submission.updatedAt).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </section>
      </div>

      {selectedSubmission ? (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={() => setSelectedSubmission(null)}>
          <div
            className="h-full w-full max-w-xl overflow-y-auto bg-white p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-black text-stone-900">Response Detail</h3>
              <button type="button" onClick={() => setSelectedSubmission(null)} className="rounded-md p-1 text-stone-500 hover:bg-stone-100">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-2 text-sm text-stone-700">
              <div><strong>Name:</strong> {selectedSubmission.fullName}</div>
              <div><strong>Email:</strong> {selectedSubmission.schoolEmail}</div>
              <div><strong>Grade:</strong> {selectedSubmission.gradeLevel}</div>
              <div><strong>Role:</strong> {selectedSubmission.roleInShow}</div>
              <div><strong>Updated:</strong> {new Date(selectedSubmission.updatedAt).toLocaleString()}</div>
            </div>

            <div className="mt-4">
              <div className="mb-1 text-sm font-semibold text-stone-800">Bio</div>
              <p className="whitespace-pre-wrap rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm text-stone-700">
                {selectedSubmission.bio}
              </p>
            </div>

            <div className="mt-4">
              <div className="mb-1 text-sm font-semibold text-stone-800">Headshot</div>
              <img src={selectedSubmission.headshotUrl} alt={selectedSubmission.fullName} className="w-full rounded-xl border border-stone-200 object-cover" />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
