/*
Handoff note for Mr. Smith:
- File: `src/pages/admin/forms/SeniorSendoffFormsPanel.tsx`
- What this is: Admin form-management sub-panel.
- What it does: Handles form builder/editor UI logic used in the admin dashboard.
- Connections: Nested under admin pages; talks to admin form endpoints and shared form helpers.
- Main content type: Layout + state logic + admin-visible text.
- Safe edits here: Copy labels/help text and small UI layout changes.
- Be careful with: Payload shape changes, question IDs, and validation assumptions.
- Useful context: If form editing or publishing breaks, this layer is usually part of the chain.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, ChevronLeft, ChevronRight, Copy, Download, Plus, RefreshCw, Save, Trash2, X } from 'lucide-react';
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
  questions: SeniorSendoffQuestions;
  deadlineAt: string;
  isOpen: boolean;
  isArchived: boolean;
  archivedAt: string | null;
  secondSubmissionPriceCents: number;
  acceptingResponses: boolean;
  status: 'OPEN' | 'CLOSED' | 'ARCHIVED';
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
  extraResponses?: Record<string, string>;
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
  questions: SeniorSendoffQuestions;
  deadlineAt: string;
  isOpen: boolean;
  secondSubmissionPriceCents: number;
  secondSubmissionPriceInput: string;
};

type SeniorSendoffQuestions = {
  parentNameLabel: string;
  parentEmailLabel: string;
  parentPhoneLabel: string;
  studentNameLabel: string;
  messageLabel: string;
  customQuestions: SeniorSendoffCustomQuestion[];
};

type SeniorSendoffCustomQuestionType = 'short_text' | 'long_text' | 'multiple_choice';

type SeniorSendoffCustomQuestion = {
  id: string;
  label: string;
  type: SeniorSendoffCustomQuestionType;
  required: boolean;
  hidden: boolean;
  options: string[];
};

type FormScope = 'active' | 'archived' | 'all';

const DEFAULT_SENIOR_SENDOFF_QUESTIONS: SeniorSendoffQuestions = {
  parentNameLabel: 'Parent/Guardian Name',
  parentEmailLabel: 'Parent Email',
  parentPhoneLabel: 'Parent Phone',
  studentNameLabel: 'Student Name',
  messageLabel: 'Shout-Out Message',
  customQuestions: []
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

function normalizeQuestions(questions: Partial<SeniorSendoffQuestions> | undefined): SeniorSendoffQuestions {
  const customQuestions = Array.isArray(questions?.customQuestions)
    ? questions.customQuestions
        .map((question) => {
          const type: SeniorSendoffCustomQuestionType =
            question?.type === 'long_text' || question?.type === 'multiple_choice' ? question.type : 'short_text';
          return {
            id: (question?.id || '').trim(),
            label: (question?.label || '').trim(),
            type,
            required: Boolean(question?.required),
            hidden: Boolean(question?.hidden),
            options:
              type === 'multiple_choice'
                ? Array.from(
                    new Set(
                      (Array.isArray(question?.options) ? question.options : [])
                        .map((option) => option.trim())
                        .filter(Boolean)
                    )
                  )
                : []
          };
        })
        .filter((question) => question.id && question.label && (question.type !== 'multiple_choice' || question.options.length >= 2))
    : [];

  return { ...DEFAULT_SENIOR_SENDOFF_QUESTIONS, ...(questions || {}), customQuestions };
}

function makeCustomQuestionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `q_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeOptionsText(value: string): string[] {
  return Array.from(new Set(value.split('\n').map((line) => line.trim()).filter(Boolean)));
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
  const [formScope, setFormScope] = useState<FormScope>('active');
  const [loading, setLoading] = useState(false);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletingSubmissionId, setDeletingSubmissionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'settings' | 'questions' | 'responses'>('settings');

  const visibleForms = useMemo(() => {
    if (formScope === 'active') return forms.filter((form) => !form.isArchived);
    if (formScope === 'archived') return forms.filter((form) => form.isArchived);
    return forms;
  }, [forms, formScope]);
  const selectedForm = useMemo(() => forms.find((f) => f.id === selectedFormId) ?? null, [forms, selectedFormId]);
  const selectedDraft = selectedForm ? drafts[selectedForm.id] : null;
  const selectedCustomQuestionsById = useMemo(
    () => new Map((selectedForm?.questions.customQuestions ?? []).map((question) => [question.id, question])),
    [selectedForm]
  );
  const selectedSubmissionIndex = useMemo(() => {
    if (!selectedSubmission) return -1;
    return submissions.findIndex((submission) => submission.id === selectedSubmission.id);
  }, [selectedSubmission, submissions]);
  const hasPreviousSubmission = selectedSubmissionIndex > 0;
  const hasNextSubmission = selectedSubmissionIndex >= 0 && selectedSubmissionIndex < submissions.length - 1;

  const updateSelectedDraftQuestions = useCallback(
    (updater: (questions: SeniorSendoffQuestions) => SeniorSendoffQuestions) => {
      if (!selectedForm) return;
      setDrafts((current) => {
        const draft = current[selectedForm.id];
        if (!draft) return current;
        return {
          ...current,
          [selectedForm.id]: {
            ...draft,
            questions: updater(draft.questions)
          }
        };
      });
    },
    [selectedForm]
  );

  const addCustomQuestion = useCallback(() => {
    updateSelectedDraftQuestions((questions) => ({
      ...questions,
      customQuestions: [
        ...questions.customQuestions,
        {
          id: makeCustomQuestionId(),
          label: '',
          type: 'short_text',
          required: false,
          hidden: false,
          options: []
        }
      ]
    }));
  }, [updateSelectedDraftQuestions]);

  const loadBase = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [formRows, performanceRows] = await Promise.all([
        adminFetch<SeniorSendoffFormSummary[]>('/api/admin/forms/senior-sendoff'),
        adminFetch<PerformanceRow[]>('/api/admin/performances?scope=all&kind=all')
      ]);
      const normalized = formRows.map((form) => ({
        ...form,
        questions: normalizeQuestions(form.questions)
      }));

      const showMap = new Map<string, ShowOption>();
      performanceRows.forEach((row) => {
        if (!showMap.has(row.showId)) showMap.set(row.showId, { id: row.showId, title: row.showTitle });
      });

      setShows(Array.from(showMap.values()).sort((a, b) => a.title.localeCompare(b.title)));
      setForms(normalized);
      setDrafts(
        Object.fromEntries(
          normalized.map((form) => [
            form.id,
            {
              title: form.title,
              instructions: form.instructions,
              questions: form.questions,
              deadlineAt: toLocalInputValue(form.deadlineAt),
              isOpen: form.isOpen,
              secondSubmissionPriceCents: form.secondSubmissionPriceCents,
              secondSubmissionPriceInput: (form.secondSubmissionPriceCents / 100).toFixed(2)
            }
          ])
        )
      );

      setSelectedFormId((current) => {
        if (current && normalized.some((row) => row.id === current)) return current;
        return normalized[0]?.id ?? null;
      });

      if (!selectedShowId && showMap.size > 0) {
        setSelectedShowId(Array.from(showMap.values())[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to load forms');
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
      setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to load submissions');
    } finally {
      setLoadingSubmissions(false);
    }
  }, []);

  useEffect(() => {
    void loadBase();
  }, [loadBase]);

  useEffect(() => {
    if (visibleForms.length === 0) {
      setSelectedFormId(null);
      return;
    }
    if (!selectedFormId || !visibleForms.some((form) => form.id === selectedFormId)) {
      setSelectedFormId(visibleForms[0].id);
    }
  }, [visibleForms, selectedFormId]);

  useEffect(() => {
    if (!selectedFormId) {
      setSubmissions([]);
      return;
    }
    void loadSubmissions(selectedFormId);
  }, [selectedFormId, loadSubmissions]);

  useEffect(() => {
    if (!selectedSubmission) return;
    const match = submissions.find((submission) => submission.id === selectedSubmission.id);
    if (!match) {
      setSelectedSubmission(null);
      return;
    }
    if (match !== selectedSubmission) {
      setSelectedSubmission(match);
    }
  }, [selectedSubmission, submissions]);

  function goToPreviousSubmission(): void {
    if (!hasPreviousSubmission) return;
    setSelectedSubmission(submissions[selectedSubmissionIndex - 1]);
  }

  function goToNextSubmission(): void {
    if (!hasNextSubmission) return;
    setSelectedSubmission(submissions[selectedSubmissionIndex + 1]);
  }

  async function deleteSubmission(submission: SeniorSendoffSubmission): Promise<void> {
    if (!selectedForm) return;
    const confirmed = window.confirm(
      `Delete the response from ${submission.parentName} for ${submission.studentName}? This cannot be undone.`
    );
    if (!confirmed) return;

    setDeletingSubmissionId(submission.id);
    setError(null);
    setNotice(null);

    try {
      await adminFetch(
        `/api/admin/forms/senior-sendoff/${encodeURIComponent(selectedForm.id)}/submissions/${encodeURIComponent(submission.id)}`,
        { method: 'DELETE' }
      );

      setSubmissions((current) => {
        const removedIndex = current.findIndex((row) => row.id === submission.id);
        const nextRows = current.filter((row) => row.id !== submission.id);

        setSelectedSubmission((currentSelected) => {
          if (!currentSelected || currentSelected.id !== submission.id) {
            return currentSelected;
          }
          if (nextRows.length === 0) {
            return null;
          }
          const nextIndex = removedIndex <= 0 ? 0 : Math.min(removedIndex - 1, nextRows.length - 1);
          return nextRows[nextIndex];
        });

        return nextRows;
      });

      setForms((current) =>
        current.map((form) =>
          form.id === selectedForm.id
            ? {
                ...form,
                responseCount: Math.max(0, form.responseCount - 1),
                paidResponseCount: submission.isPaid
                  ? Math.max(0, form.paidResponseCount - 1)
                  : form.paidResponseCount
              }
            : form
        )
      );

      setNotice('Response deleted.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to delete response');
    } finally {
      setDeletingSubmissionId(null);
    }
  }

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
      const normalizedCreated = { ...created, questions: normalizeQuestions(created.questions) };

      setForms((current) => [normalizedCreated, ...current]);
      setDrafts((current) => ({
        ...current,
        [normalizedCreated.id]: {
          title: normalizedCreated.title,
          instructions: normalizedCreated.instructions,
          questions: normalizedCreated.questions,
          deadlineAt: toLocalInputValue(normalizedCreated.deadlineAt),
          isOpen: normalizedCreated.isOpen,
          secondSubmissionPriceCents: normalizedCreated.secondSubmissionPriceCents,
          secondSubmissionPriceInput: (normalizedCreated.secondSubmissionPriceCents / 100).toFixed(2)
        }
      }));
      setSelectedFormId(normalizedCreated.id);
      setNotice('Shout out form created.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to create form');
    } finally {
      setCreating(false);
    }
  }

  async function saveForm(formId: string): Promise<void> {
    const draft = drafts[formId];
    if (!draft) return;

    const secondSubmissionPriceCents = parseUsdToCents(draft.secondSubmissionPriceInput);
    if (secondSubmissionPriceCents === null) {
      setError('Enter a valid second shout-out fee amount.');
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const updated = await adminFetch<SeniorSendoffFormSummary>(`/api/admin/forms/senior-sendoff/${formId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: draft.title.trim(),
          instructions: draft.instructions.trim(),
          questions: draft.questions,
          deadlineAt: toIsoFromLocalInput(draft.deadlineAt),
          isOpen: draft.isOpen,
          secondSubmissionPriceCents
        })
      });
      const normalizedUpdated = { ...updated, questions: normalizeQuestions(updated.questions) };

      setForms((current) => current.map((row) => (row.id === formId ? normalizedUpdated : row)));
      setDrafts((current) => ({
        ...current,
        [formId]: {
          title: normalizedUpdated.title,
          instructions: normalizedUpdated.instructions,
          questions: normalizedUpdated.questions,
          deadlineAt: toLocalInputValue(normalizedUpdated.deadlineAt),
          isOpen: normalizedUpdated.isOpen,
          secondSubmissionPriceCents: normalizedUpdated.secondSubmissionPriceCents,
          secondSubmissionPriceInput: (normalizedUpdated.secondSubmissionPriceCents / 100).toFixed(2)
        }
      }));
      setNotice('Form settings saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to save form settings');
    } finally {
      setSaving(false);
    }
  }

  async function archiveForm(form: SeniorSendoffFormSummary): Promise<void> {
    const confirmed = window.confirm(
      `Archive "${form.show.title}" shout out form?\n\nThis keeps all responses but removes it from active form operations.`
    );
    if (!confirmed) return;

    setArchiving(true);
    setError(null);
    setNotice(null);
    try {
      const archived = await adminFetch<SeniorSendoffFormSummary>(`/api/admin/forms/senior-sendoff/${form.id}/archive`, {
        method: 'POST',
        body: JSON.stringify({})
      });
      const normalizedArchived = { ...archived, questions: normalizeQuestions(archived.questions) };
      setForms((current) => current.map((row) => (row.id === form.id ? normalizedArchived : row)));
      setDrafts((current) => ({
        ...current,
        [form.id]: {
          title: normalizedArchived.title,
          instructions: normalizedArchived.instructions,
          questions: normalizedArchived.questions,
          deadlineAt: toLocalInputValue(normalizedArchived.deadlineAt),
          isOpen: normalizedArchived.isOpen,
          secondSubmissionPriceCents: normalizedArchived.secondSubmissionPriceCents,
          secondSubmissionPriceInput: (normalizedArchived.secondSubmissionPriceCents / 100).toFixed(2)
        }
      }));
      setNotice('Form archived. Data was preserved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to archive form');
    } finally {
      setArchiving(false);
    }
  }

  async function deleteForm(form: SeniorSendoffFormSummary): Promise<void> {
    const confirmed = window.confirm(
      `Delete "${form.show.title}" shout out form permanently?\n\nThis permanently deletes the form and all submissions. This cannot be undone.`
    );
    if (!confirmed) return;

    setDeleting(true);
    setError(null);
    setNotice(null);
    try {
      const result = await adminFetch<{
        deleted: boolean;
        formId: string;
        submissionCount: number;
      }>(`/api/admin/forms/senior-sendoff/${form.id}`, {
        method: 'DELETE'
      });

      setForms((current) => current.filter((row) => row.id !== form.id));
      setDrafts((current) => {
        const next = { ...current };
        delete next[form.id];
        return next;
      });
      if (selectedFormId === form.id) {
        setSelectedFormId(null);
      }
      setSubmissions([]);
      setSelectedSubmission(null);
      setNotice(
        `Form deleted permanently. Removed ${result.submissionCount} response${result.submissionCount === 1 ? '' : 's'}.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to delete form');
    } finally {
      setDeleting(false);
    }
  }

  async function copyShareLink(form: SeniorSendoffFormSummary): Promise<void> {
    const url = `${window.location.origin}${form.sharePath}`;
    try {
      await navigator.clipboard.writeText(url);
      setNotice('Share link copied.');
    } catch {
      setError('We could not copy link on this device/browser.');
    }
  }

  function exportSubmissionsCsv(form: SeniorSendoffFormSummary): void {
    const customQuestions = form.questions.customQuestions;
    const configuredQuestionIds = new Set(customQuestions.map((question) => question.id));
    const legacyQuestionIds = Array.from(
      new Set(submissions.flatMap((submission) => Object.keys(submission.extraResponses || {})))
    )
      .filter((questionId) => !configuredQuestionIds.has(questionId))
      .sort((a, b) => a.localeCompare(b));

    const customColumns = [
      ...customQuestions.map((question) => ({
        id: question.id,
        header: `Custom: ${question.label} (${question.id}${question.hidden ? ', hidden' : ''}${question.required ? ', required' : ''})`
      })),
      ...legacyQuestionIds.map((questionId) => ({
        id: questionId,
        header: `Custom: ${questionId} (legacy key)`
      }))
    ];

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
      'Updated At (Local)',
      ...customColumns.map((column) => column.header)
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
      formatDateTime(submission.updatedAt),
      ...customColumns.map((column) => submission.extraResponses?.[column.id] || '')
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
    <div className="space-y-6 font-sans">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-red-700">Admin</p>
          <h1 className="mt-0.5 text-2xl font-bold text-stone-900">Shout Out Forms</h1>
          <p className="mt-1 text-sm text-stone-500">Create and manage playbill shout-out forms by show.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={formScope}
            onChange={(event) => setFormScope(event.target.value as FormScope)}
            className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-semibold text-stone-700"
          >
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="all">All</option>
          </select>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-semibold text-stone-600 transition hover:bg-stone-50 disabled:opacity-50"
            onClick={() => void loadBase()}
            disabled={loading}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
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
            {visibleForms.length === 0 && !loading && (
              <p className="rounded-xl border border-stone-200 bg-white px-4 py-6 text-center text-sm text-stone-400">No forms yet.</p>
            )}
            {visibleForms.map((form) => {
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
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                        form.status === 'OPEN'
                          ? 'bg-emerald-100 text-emerald-700'
                          : form.status === 'ARCHIVED'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-stone-100 text-stone-500'
                      }`}
                    >
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
                    <p className="mt-0.5 text-xs text-stone-400">
                      Schema v{selectedForm.schemaVersion} - {selectedForm.responseCount} total - {selectedForm.paidResponseCount} paid
                      {selectedForm.isArchived && selectedForm.archivedAt ? ` - archived ${formatDateTime(selectedForm.archivedAt)}` : ''}
                    </p>
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
                    {!selectedForm.isArchived && (
                      <button
                        type="button"
                        onClick={() => void archiveForm(selectedForm)}
                        disabled={archiving || deleting}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 transition hover:bg-amber-100 disabled:opacity-50"
                      >
                        <Archive className="h-3.5 w-3.5" />
                        {archiving ? 'Archiving…' : 'Archive'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void deleteForm(selectedForm)}
                      disabled={deleting || archiving}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {deleting ? 'Deleting…' : 'Delete'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void saveForm(selectedForm.id)}
                      disabled={saving || deleting}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-stone-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-stone-700 disabled:opacity-50"
                    >
                      <Save className="h-3.5 w-3.5" />
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>

                <div className="flex gap-0 border-b border-stone-100 px-6">
                  {[
                    { key: 'settings', label: 'Settings' },
                    { key: 'questions', label: 'Questions' },
                    { key: 'responses', label: `Responses${submissions.length ? ` (${submissions.length})` : ''}` }
                  ].map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setActiveTab(tab.key as 'settings' | 'questions' | 'responses')}
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
                            value={selectedDraft.secondSubmissionPriceInput}
                            onChange={(event) =>
                              setDrafts((current) => ({
                                ...current,
                                [selectedForm.id]: {
                                  ...current[selectedForm.id],
                                  secondSubmissionPriceInput: event.target.value
                                }
                              }))
                            }
                            className={inputCls}
                          />
                          <p className="mt-1 text-xs text-stone-400">Set to 0.00 to make both shout-outs free.</p>
                        </div>
                        <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
                          <p className="text-xs font-semibold uppercase tracking-wider text-stone-400">Current fee</p>
                          <p className="mt-1 text-lg font-bold text-stone-900">
                            {formatUsd(
                              parseUsdToCents(selectedDraft.secondSubmissionPriceInput) ?? selectedDraft.secondSubmissionPriceCents
                            )}
                          </p>
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
                          disabled={selectedForm.isArchived}
                          className="h-4 w-4 rounded border-stone-300 accent-red-700"
                        />
                        <label htmlFor="senior-sendoff-is-open" className="text-sm font-medium text-stone-700 cursor-pointer">
                          Form is open - parents can submit shout-outs
                        </label>
                      </div>
                      {selectedForm.isArchived && (
                        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                          This form is archived. Responses are preserved, and public access is disabled.
                        </p>
                      )}

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

                  {activeTab === 'questions' && (
                    <div className="space-y-6">
                      <div>
                        <p className="text-sm font-semibold text-stone-700 mb-1">Base Fields</p>
                        <p className="text-xs text-stone-400 mb-4">These fields are always included. You can rename their labels.</p>
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                          {(
                            [
                              ['parentNameLabel', 'Parent/Guardian Name'],
                              ['parentEmailLabel', 'Parent Email'],
                              ['parentPhoneLabel', 'Parent Phone'],
                              ['studentNameLabel', 'Student Name'],
                              ['messageLabel', 'Message'],
                            ] as [keyof SeniorSendoffQuestions, string][]
                          ).map(([field, display]) => (
                            <div key={field}>
                              <label className={labelCls}>{display}</label>
                              <input
                                value={selectedDraft.questions[field] as string}
                                onChange={(event) =>
                                  updateSelectedDraftQuestions((questions) => ({ ...questions, [field]: event.target.value }))
                                }
                                className={inputCls}
                              />
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="border-t border-stone-100 pt-5">
                        <div className="mb-4 flex items-center justify-between">
                          <div>
                            <p className="text-sm font-semibold text-stone-700">Custom Questions</p>
                            <p className="text-xs text-stone-400">Additional fields shown after the base fields. Hidden questions are saved but not shown to parents.</p>
                          </div>
                          <button
                            type="button"
                            onClick={addCustomQuestion}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-semibold text-stone-700 transition hover:bg-stone-50"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            Add Question
                          </button>
                        </div>

                        {selectedDraft.questions.customQuestions.length === 0 ? (
                          <div className="rounded-xl border border-dashed border-stone-200 px-4 py-8 text-center text-sm text-stone-400">
                            No custom questions yet. Click Add Question to create one.
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {selectedDraft.questions.customQuestions.map((question, index) => (
                              <div key={question.id} className="rounded-xl border border-stone-200 bg-stone-50 p-4">
                                <div className="mb-3 flex items-center justify-between">
                                  <span className="text-xs font-bold uppercase tracking-widest text-stone-400">
                                    Question {index + 1}
                                    {question.hidden ? ' - hidden' : ''}
                                  </span>
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        updateSelectedDraftQuestions((questions) => ({
                                          ...questions,
                                          customQuestions: questions.customQuestions.map((item) =>
                                            item.id === question.id ? { ...item, hidden: !item.hidden } : item
                                          ),
                                        }))
                                      }
                                      className="rounded-lg border border-stone-200 bg-white px-2.5 py-1 text-xs font-semibold text-stone-600 transition hover:bg-stone-100"
                                    >
                                      {question.hidden ? 'Unhide' : 'Hide'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        updateSelectedDraftQuestions((questions) => ({
                                          ...questions,
                                          customQuestions: questions.customQuestions.filter((item) => item.id !== question.id),
                                        }))
                                      }
                                      className="rounded-lg border border-red-100 bg-white px-2.5 py-1 text-xs font-semibold text-red-600 transition hover:bg-red-50"
                                    >
                                      Delete
                                    </button>
                                  </div>
                                </div>

                                <div className="grid gap-3 sm:grid-cols-[1fr,160px,auto]">
                                  <div>
                                    <label className={labelCls}>Label</label>
                                    <input
                                      value={question.label}
                                      onChange={(event) =>
                                        updateSelectedDraftQuestions((questions) => ({
                                          ...questions,
                                          customQuestions: questions.customQuestions.map((item) =>
                                            item.id === question.id ? { ...item, label: event.target.value } : item
                                          ),
                                        }))
                                      }
                                      className={inputCls}
                                      placeholder="Question text..."
                                    />
                                  </div>

                                  <div>
                                    <label className={labelCls}>Type</label>
                                    <select
                                      value={question.type}
                                      onChange={(event) => {
                                        const nextType = event.target.value as SeniorSendoffCustomQuestionType;
                                        updateSelectedDraftQuestions((questions) => ({
                                          ...questions,
                                          customQuestions: questions.customQuestions.map((item) =>
                                            item.id === question.id
                                              ? {
                                                  ...item,
                                                  type: nextType,
                                                  options: nextType === 'multiple_choice' ? item.options : []
                                                }
                                              : item
                                          ),
                                        }));
                                      }}
                                      className={inputCls}
                                    >
                                      <option value="short_text">Short text</option>
                                      <option value="long_text">Long text</option>
                                      <option value="multiple_choice">Multiple choice</option>
                                    </select>
                                  </div>

                                  <div className="flex items-end pb-2">
                                    <label className="flex items-center gap-2 text-sm text-stone-600 cursor-pointer">
                                      <input
                                        type="checkbox"
                                        checked={question.required}
                                        onChange={(event) =>
                                          updateSelectedDraftQuestions((questions) => ({
                                            ...questions,
                                            customQuestions: questions.customQuestions.map((item) =>
                                              item.id === question.id ? { ...item, required: event.target.checked } : item
                                            ),
                                          }))
                                        }
                                        className="accent-red-700"
                                      />
                                      Required
                                    </label>
                                  </div>
                                </div>

                                {question.type === 'multiple_choice' && (
                                  <div className="mt-3">
                                    <label className={labelCls}>Options (one per line, min. 2)</label>
                                    <textarea
                                      rows={4}
                                      value={question.options.join('\n')}
                                      onChange={(event) =>
                                        updateSelectedDraftQuestions((questions) => ({
                                          ...questions,
                                          customQuestions: questions.customQuestions.map((item) =>
                                            item.id === question.id
                                              ? { ...item, options: normalizeOptionsText(event.target.value) }
                                              : item
                                          ),
                                        }))
                                      }
                                      className={inputCls + ' resize-none'}
                                      placeholder="Option A&#10;Option B&#10;Option C"
                                    />
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
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
                                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-stone-500">Actions</th>
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
                                  <td className="px-4 py-3 text-right">
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        void deleteSubmission(submission);
                                      }}
                                      disabled={deletingSubmissionId === submission.id}
                                      className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                      {deletingSubmissionId === submission.id ? 'Deleting...' : 'Delete'}
                                    </button>
                                  </td>
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

      {selectedSubmission && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6" onClick={() => setSelectedSubmission(null)}>
          <div className="absolute inset-0 bg-black/25 backdrop-blur-sm" />
          <div
            className="relative z-10 w-full max-w-3xl overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-stone-100 bg-white px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Response</p>
                <p className="mt-0.5 text-base font-bold text-stone-900">{selectedSubmission.parentName}</p>
                <p className="mt-0.5 text-xs text-stone-400">
                  {selectedSubmissionIndex >= 0 ? `Response ${selectedSubmissionIndex + 1} of ${submissions.length}` : `Total ${submissions.length}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={goToPreviousSubmission}
                  disabled={!hasPreviousSubmission}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-semibold text-stone-700 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Back
                </button>
                <button
                  type="button"
                  onClick={goToNextSubmission}
                  disabled={!hasNextSubmission}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs font-semibold text-stone-700 transition hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Next
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => void deleteSubmission(selectedSubmission)}
                  disabled={deletingSubmissionId === selectedSubmission.id}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {deletingSubmissionId === selectedSubmission.id ? 'Deleting...' : 'Delete'}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedSubmission(null)}
                  className="rounded-lg p-1.5 text-stone-400 transition hover:bg-stone-100 hover:text-stone-700"
                  aria-label="Close response"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="max-h-[80vh] overflow-y-auto p-5 space-y-5">
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

              {selectedSubmission.extraResponses && Object.keys(selectedSubmission.extraResponses).length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-400">Custom Responses</p>
                  <div className="space-y-2">
                    {Object.entries(selectedSubmission.extraResponses).map(([questionId, value]) => (
                      <div key={questionId} className="rounded-xl border border-stone-100 bg-stone-50 px-4 py-3">
                        <p className="text-xs font-semibold text-stone-600">
                          {selectedCustomQuestionsById.get(questionId)?.label ?? 'Custom question'}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-sm text-stone-700">{value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
