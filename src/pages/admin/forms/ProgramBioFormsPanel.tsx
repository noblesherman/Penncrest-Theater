/*
Handoff note for Mr. Smith:
- File: `src/pages/admin/forms/ProgramBioFormsPanel.tsx`
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
import { Archive, ChevronLeft, ChevronRight, Copy, Download, Plus, RefreshCw, Save, Trash2, Users, X } from 'lucide-react';
import { adminFetch } from '../../../lib/adminAuth';

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
  isArchived: boolean;
  archivedAt: string | null;
  acceptingResponses: boolean;
  status: 'OPEN' | 'CLOSED' | 'ARCHIVED';
  responseCount: number;
  createdAt: string;
  updatedAt: string;
};

type ProgramBioQuestions = {
  fullNameLabel: string;
  fullNameEnabled: boolean;
  fullNameRequired: boolean;
  schoolEmailLabel: string;
  schoolEmailEnabled: boolean;
  schoolEmailRequired: boolean;
  gradeLevelLabel: string;
  gradeLevelEnabled: boolean;
  gradeLevelRequired: boolean;
  roleInShowLabel: string;
  roleInShowEnabled: boolean;
  roleInShowRequired: boolean;
  bioLabel: string;
  bioEnabled: boolean;
  bioRequired: boolean;
  headshotLabel: string;
  headshotEnabled: boolean;
  headshotRequired: boolean;
  customQuestions: ProgramBioCustomQuestion[];
};

type ProgramBioCustomQuestionType = 'short_text' | 'long_text' | 'multiple_choice';

type ProgramBioCustomQuestion = {
  id: string;
  label: string;
  type: ProgramBioCustomQuestionType;
  required: boolean;
  hidden: boolean;
  options: string[];
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
  extraResponses?: Record<string, string>;
  submittedAt: string;
  createdAt: string;
  updatedAt: string;
};

type PerformanceRow = { showId: string; showTitle: string };
type ShowOption = { id: string; title: string };
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

type FormScope = 'active' | 'archived' | 'all';

const DEFAULT_PROGRAM_BIO_QUESTIONS: ProgramBioQuestions = {
  fullNameLabel: 'Full name',
  fullNameEnabled: true,
  fullNameRequired: true,
  schoolEmailLabel: 'School email',
  schoolEmailEnabled: true,
  schoolEmailRequired: true,
  gradeLevelLabel: 'Grade',
  gradeLevelEnabled: true,
  gradeLevelRequired: true,
  roleInShowLabel: 'Role in show',
  roleInShowEnabled: true,
  roleInShowRequired: true,
  bioLabel: 'Bio',
  bioEnabled: true,
  bioRequired: true,
  headshotLabel: 'Headshot upload',
  headshotEnabled: true,
  headshotRequired: true,
  customQuestions: [],
};

function normalizeQuestions(questions: Partial<ProgramBioQuestions> | undefined): ProgramBioQuestions {
  const customQuestions = Array.isArray(questions?.customQuestions)
    ? questions.customQuestions
        .map((q) => {
          const type: ProgramBioCustomQuestionType =
            q?.type === 'long_text' || q?.type === 'multiple_choice' ? q.type : 'short_text';
          return {
            id: (q?.id || '').trim(),
            label: (q?.label || '').trim(),
            type,
            required: Boolean(q?.required),
            hidden: Boolean(q?.hidden),
            options:
              type === 'multiple_choice'
                ? Array.from(
                    new Set(
                      (Array.isArray(q?.options) ? q.options : [])
                        .map((o) => o.trim())
                        .filter(Boolean)
                    )
                  )
                : [],
          };
        })
        .filter(
          (q) =>
            q.id && q.label && (q.type !== 'multiple_choice' || q.options.length >= 2)
        )
    : [];
  const merged = { ...DEFAULT_PROGRAM_BIO_QUESTIONS, ...(questions || {}), customQuestions };
  if (!merged.fullNameEnabled) merged.fullNameRequired = false;
  if (!merged.schoolEmailEnabled) merged.schoolEmailRequired = false;
  if (!merged.gradeLevelEnabled) merged.gradeLevelRequired = false;
  if (!merged.roleInShowEnabled) merged.roleInShowRequired = false;
  if (!merged.bioEnabled) merged.bioRequired = false;
  if (!merged.headshotEnabled) merged.headshotRequired = false;
  return merged;
}

function makeCustomQuestionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `q_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeOptionsText(value: string): string[] {
  return Array.from(new Set(value.split('\n').map((l) => l.trim()).filter(Boolean)));
}

function parseOptionsTextLines(value: string): string[] {
  return value.split('\n');
}

function normalizeCustomQuestionsForSave(customQuestions: ProgramBioCustomQuestion[]): ProgramBioCustomQuestion[] {
  return customQuestions.map((question) => ({
    ...question,
    id: question.id.trim(),
    label: question.label.trim(),
    options: question.type === 'multiple_choice' ? normalizeOptionsText(question.options.join('\n')) : []
  }));
}

function validateCustomQuestionsForSave(customQuestions: ProgramBioCustomQuestion[]): string | null {
  const seenIds = new Set<string>();
  for (let index = 0; index < customQuestions.length; index += 1) {
    const question = customQuestions[index];
    const questionNumber = index + 1;

    if (!question.id) return `Question ${questionNumber} is missing an id.`;
    if (seenIds.has(question.id)) return `Question ${questionNumber} has a duplicate id.`;
    seenIds.add(question.id);

    if (!question.label) return `Question ${questionNumber} label is required.`;
    if (question.type === 'multiple_choice' && question.options.length < 2) {
      return `Question ${questionNumber} needs at least two options.`;
    }
  }
  return null;
}

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

function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function toSlugSafe(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ── Shared input styles ──
const inputCls = 'w-full rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-stone-400 focus:outline-none transition';
const labelCls = 'block text-xs font-semibold uppercase tracking-wider text-stone-500 mb-2';

const PROGRAM_BIO_BASE_FIELD_ROWS = [
  {
    id: 'fullName',
    display: 'Full Name',
    labelKey: 'fullNameLabel',
    enabledKey: 'fullNameEnabled',
    requiredKey: 'fullNameRequired'
  },
  {
    id: 'schoolEmail',
    display: 'School Email',
    labelKey: 'schoolEmailLabel',
    enabledKey: 'schoolEmailEnabled',
    requiredKey: 'schoolEmailRequired'
  },
  {
    id: 'gradeLevel',
    display: 'Grade Level',
    labelKey: 'gradeLevelLabel',
    enabledKey: 'gradeLevelEnabled',
    requiredKey: 'gradeLevelRequired'
  },
  {
    id: 'roleInShow',
    display: 'Role in Show',
    labelKey: 'roleInShowLabel',
    enabledKey: 'roleInShowEnabled',
    requiredKey: 'roleInShowRequired'
  },
  {
    id: 'bio',
    display: 'Bio',
    labelKey: 'bioLabel',
    enabledKey: 'bioEnabled',
    requiredKey: 'bioRequired'
  },
  {
    id: 'headshot',
    display: 'Headshot',
    labelKey: 'headshotLabel',
    enabledKey: 'headshotEnabled',
    requiredKey: 'headshotRequired'
  }
] as const satisfies Array<{
  id: string;
  display: string;
  labelKey: keyof ProgramBioQuestions;
  enabledKey: keyof ProgramBioQuestions;
  requiredKey: keyof ProgramBioQuestions;
}>;

export default function ProgramBioFormsPanel() {
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
  const [formScope, setFormScope] = useState<FormScope>('active');
  const [loading, setLoading] = useState(false);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletingSubmissionId, setDeletingSubmissionId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // which tab is active in the detail panel
  const [activeTab, setActiveTab] = useState<'settings' | 'questions' | 'sync' | 'responses'>('settings');

  const visibleForms = useMemo(() => {
    if (formScope === 'active') {
      return forms.filter((form) => !form.isArchived);
    }
    if (formScope === 'archived') {
      return forms.filter((form) => form.isArchived);
    }
    return forms;
  }, [forms, formScope]);
  const selectedForm = useMemo(() => forms.find((f) => f.id === selectedFormId) ?? null, [forms, selectedFormId]);
  const selectedDraft = selectedForm ? drafts[selectedForm.id] : null;
  const selectedCustomQuestionsById = useMemo(
    () => new Map((selectedForm?.questions.customQuestions ?? []).map((q) => [q.id, q])),
    [selectedForm]
  );
  const selectedSubmissionIndex = useMemo(() => {
    if (!selectedSubmission) return -1;
    return submissions.findIndex((submission) => submission.id === selectedSubmission.id);
  }, [selectedSubmission, submissions]);
  const hasPreviousSubmission = selectedSubmissionIndex > 0;
  const hasNextSubmission = selectedSubmissionIndex >= 0 && selectedSubmissionIndex < submissions.length - 1;

  const updateSelectedDraftQuestions = useCallback(
    (updater: (q: ProgramBioQuestions) => ProgramBioQuestions) => {
      if (!selectedForm) return;
      setDrafts((cur) => {
        const draft = cur[selectedForm.id];
        if (!draft) return cur;
        return { ...cur, [selectedForm.id]: { ...draft, questions: updater(draft.questions) } };
      });
    },
    [selectedForm]
  );

  const addCustomQuestion = useCallback(() => {
    updateSelectedDraftQuestions((q) => ({
      ...q,
      customQuestions: [
        ...q.customQuestions,
        { id: makeCustomQuestionId(), label: '', type: 'short_text', required: false, hidden: false, options: [] },
      ],
    }));
  }, [updateSelectedDraftQuestions]);

  const loadBase = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [formRows, performanceRows] = await Promise.all([
        adminFetch<ProgramBioFormSummary[]>('/api/admin/forms'),
        adminFetch<PerformanceRow[]>('/api/admin/performances?scope=all&kind=all'),
      ]);
      const normalized = formRows.map((f) => ({ ...f, questions: normalizeQuestions(f.questions) }));
      const showMap = new Map<string, ShowOption>();
      performanceRows.forEach((r) => {
        if (!showMap.has(r.showId)) showMap.set(r.showId, { id: r.showId, title: r.showTitle });
      });
      setShows(Array.from(showMap.values()).sort((a, b) => a.title.localeCompare(b.title)));
      setForms(normalized);
      setDrafts(
        Object.fromEntries(
          normalized.map((f) => [
            f.id,
            {
              title: f.title,
              instructions: f.instructions,
              questions: f.questions,
              deadlineAt: toLocalInputValue(f.deadlineAt),
              isOpen: f.isOpen,
            },
          ])
        )
      );
      setSelectedFormId((cur) => {
        if (cur && normalized.some((r) => r.id === cur)) return cur;
        return normalized[0]?.id ?? null;
      });
      if (!selectedShowId && showMap.size > 0) setSelectedShowId(Array.from(showMap.values())[0].id);
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
      const rows = await adminFetch<ProgramBioSubmission[]>(`/api/admin/forms/${formId}/submissions`);
      setSubmissions(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to load submissions');
      setSubmissions([]);
    } finally {
      setLoadingSubmissions(false);
    }
  }, []);

  useEffect(() => { void loadBase(); }, [loadBase]);
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
    if (!selectedFormId) { setSubmissions([]); return; }
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

  async function deleteSubmission(submission: ProgramBioSubmission): Promise<void> {
    if (!selectedForm) return;
    const confirmed = window.confirm(
      `Delete the response from ${submission.fullName}? This cannot be undone.`
    );
    if (!confirmed) return;

    setDeletingSubmissionId(submission.id);
    setError(null);
    setNotice(null);

    try {
      await adminFetch(`/api/admin/forms/${encodeURIComponent(selectedForm.id)}/submissions/${encodeURIComponent(submission.id)}`, {
        method: 'DELETE'
      });

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
            ? { ...form, responseCount: Math.max(0, form.responseCount - 1) }
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
    if (!selectedShowId) { setError('Choose a show first.'); return; }
    setCreating(true); setError(null); setNotice(null);
    try {
      const created = await adminFetch<ProgramBioFormSummary>('/api/admin/forms', {
        method: 'POST',
        body: JSON.stringify({ showId: selectedShowId, ...(createDeadlineAt ? { deadlineAt: toIsoFromLocalInput(createDeadlineAt) } : {}) }),
      });
      const norm = { ...created, questions: normalizeQuestions(created.questions) };
      setForms((cur) => [norm, ...cur]);
      setDrafts((cur) => ({
        ...cur,
        [norm.id]: { title: norm.title, instructions: norm.instructions, questions: norm.questions, deadlineAt: toLocalInputValue(norm.deadlineAt), isOpen: norm.isOpen },
      }));
      setSelectedFormId(norm.id);
      setNotice('Program bio form created.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to create form');
    } finally {
      setCreating(false);
    }
  }

  async function saveForm(formId: string): Promise<void> {
    const draft = drafts[formId];
    if (!draft) return;
    const normalizedCustomQuestions = normalizeCustomQuestionsForSave(draft.questions.customQuestions);
    const customQuestionError = validateCustomQuestionsForSave(normalizedCustomQuestions);
    if (customQuestionError) {
      setError(customQuestionError);
      setNotice(null);
      return;
    }
    setSaving(true); setError(null); setNotice(null);
    try {
      const updated = await adminFetch<ProgramBioFormSummary>(`/api/admin/forms/${formId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: draft.title.trim(),
          instructions: draft.instructions.trim(),
          questions: {
            ...draft.questions,
            customQuestions: normalizedCustomQuestions
          },
          deadlineAt: toIsoFromLocalInput(draft.deadlineAt),
          isOpen: draft.isOpen
        }),
      });
      const norm = { ...updated, questions: normalizeQuestions(updated.questions) };
      setForms((cur) => cur.map((r) => (r.id === formId ? norm : r)));
      setDrafts((cur) => ({
        ...cur,
        [formId]: { title: norm.title, instructions: norm.instructions, questions: norm.questions, deadlineAt: toLocalInputValue(norm.deadlineAt), isOpen: norm.isOpen },
      }));
      setNotice('Form settings saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to save form settings');
    } finally {
      setSaving(false);
    }
  }

  async function archiveForm(form: ProgramBioFormSummary): Promise<void> {
    const confirmed = window.confirm(
      `Archive "${form.show.title}" program bio form?\n\nThis keeps all responses but removes it from active form operations.`
    );
    if (!confirmed) return;

    setArchiving(true);
    setError(null);
    setNotice(null);
    try {
      const archived = await adminFetch<ProgramBioFormSummary>(`/api/admin/forms/${form.id}/archive`, {
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
          isOpen: normalizedArchived.isOpen
        }
      }));
      setNotice('Form archived. Data was preserved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to archive form');
    } finally {
      setArchiving(false);
    }
  }

  async function deleteForm(form: ProgramBioFormSummary): Promise<void> {
    const confirmed = window.confirm(
      `Delete "${form.show.title}" program bio form permanently?\n\nThis permanently deletes the form and all submissions. This cannot be undone.`
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
      }>(`/api/admin/forms/${form.id}`, {
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
      setNotice(`Form deleted permanently. Removed ${result.submissionCount} response${result.submissionCount === 1 ? '' : 's'}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to delete form');
    } finally {
      setDeleting(false);
    }
  }

  async function runSync(formId: string): Promise<void> {
    if (!syncCast && !syncStudentCredits) { setError('Choose at least one sync target.'); return; }
    setSyncing(true); setError(null); setNotice(null); setSyncResult(null);
    try {
      const result = await adminFetch<SyncResult>(`/api/admin/forms/${formId}/sync`, {
        method: 'POST',
        body: JSON.stringify({ syncCast, syncStudentCredits }),
      });
      setSyncResult(result);
      await loadBase();
      await loadSubmissions(formId);
      setNotice('Sync completed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to sync');
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
      setError('We could not copy link on this device/browser.');
    }
  }

  function exportSubmissionsCsv(form: ProgramBioFormSummary): void {
    const customQuestions = form.questions.customQuestions;
    const configuredQuestionIds = new Set(customQuestions.map((question) => question.id));
    const legacyQuestionIds = Array.from(
      new Set(
        submissions.flatMap((submission) => Object.keys(submission.extraResponses || {}))
      )
    )
      .filter((questionId) => !configuredQuestionIds.has(questionId))
      .sort((a, b) => a.localeCompare(b));

    const customColumns = [
      ...customQuestions.map((question) => ({
        id: question.id,
        header: `Custom: ${question.label} (${question.id}${question.hidden ? ', hidden' : ''}${question.required ? ', required' : ''})`,
      })),
      ...legacyQuestionIds.map((questionId) => ({
        id: questionId,
        header: `Custom: ${questionId} (legacy key)`,
      })),
    ];

    const headers = [
      'Submission ID',
      'Form ID',
      'Form Title',
      'Show ID',
      'Show Title',
      'Full Name',
      'School Email',
      'Grade Level',
      'Role In Show',
      'Bio',
      'Headshot URL',
      'Submitted At (Local)',
      'Created At (Local)',
      'Updated At (Local)',
      ...customColumns.map((column) => column.header),
    ];

    const rows = submissions.map((submission) => [
      submission.id,
      submission.formId,
      form.title,
      form.showId,
      form.show.title,
      submission.fullName,
      submission.schoolEmail,
      submission.gradeLevel,
      submission.roleInShow,
      submission.bio,
      submission.headshotUrl,
      formatDateTime(submission.submittedAt),
      formatDateTime(submission.createdAt),
      formatDateTime(submission.updatedAt),
      ...customColumns.map((column) => submission.extraResponses?.[column.id] || ''),
    ]);

    const csvContent = [headers, ...rows]
      .map((row) => row.map((value) => escapeCsvValue(value)).join(','))
      .join('\n');

    const today = new Date().toISOString().slice(0, 10);
    const showSlug = toSlugSafe(form.show.title) || 'show';
    const fileName = `program-bio-submissions-${showSlug}-${today}.csv`;
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

  const usedShowIds = useMemo(() => new Set(forms.map((f) => f.showId)), [forms]);
  const tabs = [
    { key: 'settings', label: 'Settings' },
    { key: 'questions', label: 'Questions' },
    { key: 'sync', label: 'Sync' },
    { key: 'responses', label: `Responses${submissions.length ? ` (${submissions.length})` : ''}` },
  ] as const;

  return (
    <div className="space-y-8 font-sans">

        {/* ── Page header ── */}
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-red-700">Admin</p>
            <h1 className="mt-1 text-2xl font-bold text-stone-900">Program Bio Forms</h1>
            <p className="mt-2 text-sm text-stone-500">Create and manage bio collection forms linked to a show.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={formScope}
              onChange={(event) => setFormScope(event.target.value as FormScope)}
              className="rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-xs font-semibold text-stone-700"
            >
              <option value="active">Active</option>
              <option value="archived">Archived</option>
              <option value="all">All</option>
            </select>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-2.5 text-xs font-semibold text-stone-600 transition hover:bg-stone-50 disabled:opacity-50"
              onClick={() => void loadBase()}
              disabled={loading}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>

        {/* ── Alerts ── */}
        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3.5 text-sm text-red-700">
            <span className="mt-0.5 h-1.5 w-1.5 flex-none rounded-full bg-red-500" />
            {error}
          </div>
        )}
        {notice && (
          <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3.5 text-sm text-emerald-700">
            <span className="mt-0.5 h-1.5 w-1.5 flex-none rounded-full bg-emerald-500" />
            {notice}
          </div>
        )}

        {/* ── Create form row ── */}
        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
          <p className={labelCls}>Create New Form</p>
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-[200px]">
              <p className="mb-2 text-xs text-stone-500">Show</p>
              <select className={inputCls} value={selectedShowId} onChange={(e) => setSelectedShowId(e.target.value)}>
                {shows.length === 0 && <option value="">No shows available</option>}
                {shows.map((s) => (
                  <option key={s.id} value={s.id} disabled={usedShowIds.has(s.id)}>
                    {s.title}{usedShowIds.has(s.id) ? ' — form exists' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-52">
              <p className="mb-2 text-xs text-stone-500">Deadline (optional)</p>
              <input type="datetime-local" value={createDeadlineAt} onChange={(e) => setCreateDeadlineAt(e.target.value)} className={inputCls} />
            </div>
            <button
              type="button"
              onClick={() => void createForm()}
              disabled={creating || !selectedShowId || usedShowIds.has(selectedShowId)}
              className="inline-flex items-center gap-2 rounded-lg bg-red-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              {creating ? 'Creating…' : 'Create Form'}
            </button>
          </div>
        </div>

        {/* ── Main layout ── */}
        <div className="grid gap-6 lg:grid-cols-[280px,1fr]">

          {/* Sidebar */}
          <aside className="space-y-3">
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
                  className={`group w-full rounded-xl border px-4 py-4 text-left transition ${
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
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                      form.status === 'OPEN'
                        ? 'bg-emerald-100 text-emerald-700'
                        : form.status === 'ARCHIVED'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-stone-100 text-stone-500'
                    }`}>
                      {form.status}
                    </span>
                    <span className="text-xs text-stone-400">{form.responseCount} response{form.responseCount !== 1 ? 's' : ''}</span>
                  </div>
                </button>
              );
            })}
          </aside>

          {/* Detail panel */}
          <div className="rounded-2xl border border-stone-200 bg-white shadow-sm">
            {!selectedForm || !selectedDraft ? (
              <div className="flex h-48 items-center justify-center text-sm text-stone-400">
                Select a form to view details.
              </div>
            ) : (
              <div>
                {/* Panel header */}
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-stone-100 px-6 pt-6 pb-5">
                  <div>
                    <h2 className="text-lg font-bold text-stone-900">{selectedForm.show.title}</h2>
                    <p className="mt-1 text-xs text-stone-400">
                      Schema v{selectedForm.schemaVersion} · {selectedForm.responseCount} response{selectedForm.responseCount !== 1 ? 's' : ''}
                      {selectedForm.isArchived && selectedForm.archivedAt ? ` · archived ${formatDateTime(selectedForm.archivedAt)}` : ''}
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

                {/* Tabs */}
                <div className="flex gap-0 border-b border-stone-100 px-6">
                  {tabs.map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setActiveTab(tab.key)}
                      className={`py-4 px-1 mr-8 text-sm font-semibold border-b-2 transition ${
                        activeTab === tab.key
                          ? 'border-red-700 text-red-700'
                          : 'border-transparent text-stone-400 hover:text-stone-700'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <div className="p-8">

                  {/* ── SETTINGS TAB ── */}
                  {activeTab === 'settings' && (
                    <div className="space-y-6">
                      <div className="grid gap-5 sm:grid-cols-2">
                        <div>
                          <label className={labelCls}>Title</label>
                          <input
                            value={selectedDraft.title}
                            onChange={(e) => setDrafts((cur) => ({ ...cur, [selectedForm.id]: { ...cur[selectedForm.id], title: e.target.value } }))}
                            className={inputCls}
                          />
                        </div>
                        <div>
                          <label className={labelCls}>Submission Deadline</label>
                          <input
                            type="datetime-local"
                            value={selectedDraft.deadlineAt}
                            onChange={(e) => setDrafts((cur) => ({ ...cur, [selectedForm.id]: { ...cur[selectedForm.id], deadlineAt: e.target.value } }))}
                            className={inputCls}
                          />
                        </div>
                      </div>

                      <div className="flex items-center gap-3 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3.5">
                        <input
                          id="isOpen"
                          type="checkbox"
                          checked={selectedDraft.isOpen}
                          onChange={(e) => setDrafts((cur) => ({ ...cur, [selectedForm.id]: { ...cur[selectedForm.id], isOpen: e.target.checked } }))}
                          disabled={selectedForm.isArchived}
                          className="h-4 w-4 rounded border-stone-300 accent-red-700"
                        />
                        <label htmlFor="isOpen" className="text-sm font-medium text-stone-700 cursor-pointer">
                          Form is open — students can submit responses
                        </label>
                      </div>
                      {selectedForm.isArchived && (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5 text-sm text-amber-800">
                          This form is archived. Responses are preserved, but it is no longer active.
                        </div>
                      )}

                      <div>
                        <label className={labelCls}>Instructions</label>
                        <textarea
                          rows={6}
                          value={selectedDraft.instructions}
                          onChange={(e) => setDrafts((cur) => ({ ...cur, [selectedForm.id]: { ...cur[selectedForm.id], instructions: e.target.value } }))}
                          className={inputCls + ' resize-none'}
                          placeholder="Instructions shown to students at the top of the form…"
                        />
                      </div>
                    </div>
                  )}

                  {/* ── QUESTIONS TAB ── */}
                  {activeTab === 'questions' && (
                    <div className="space-y-7">
                      <div>
                        <p className="text-sm font-semibold text-stone-700 mb-1.5">Base Fields</p>
                        <p className="text-xs text-stone-400 mb-5">Enable, disable, or rename base fields. Disabled fields are hidden from students.</p>
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                          {PROGRAM_BIO_BASE_FIELD_ROWS.map((field) => (
                            <div key={field.id} className={`rounded-xl border p-3 ${selectedDraft.questions[field.enabledKey] ? 'border-stone-200 bg-white' : 'border-stone-200 bg-stone-50/80'}`}>
                              <div className="mb-2 flex items-center justify-between gap-2">
                                <span className="text-xs font-semibold uppercase tracking-wider text-stone-500">{field.display}</span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateSelectedDraftQuestions((questions) => {
                                      const isEnabled = Boolean(questions[field.enabledKey]);
                                      return {
                                        ...questions,
                                        [field.enabledKey]: !isEnabled,
                                        [field.requiredKey]: !isEnabled ? true : false
                                      };
                                    })
                                  }
                                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                                    selectedDraft.questions[field.enabledKey]
                                      ? 'border border-red-100 bg-white text-red-600 hover:bg-red-50'
                                      : 'border border-stone-200 bg-white text-stone-700 hover:bg-stone-100'
                                  }`}
                                >
                                  {selectedDraft.questions[field.enabledKey] ? 'Remove' : 'Restore'}
                                </button>
                              </div>
                              <label className={labelCls}>Label</label>
                              <input
                                value={selectedDraft.questions[field.labelKey] as string}
                                onChange={(e) =>
                                  updateSelectedDraftQuestions((questions) => ({ ...questions, [field.labelKey]: e.target.value }))
                                }
                                className={inputCls}
                                disabled={!selectedDraft.questions[field.enabledKey]}
                              />
                              <label className={`mt-2 inline-flex items-center gap-2 text-xs font-medium ${selectedDraft.questions[field.enabledKey] ? 'text-stone-600' : 'text-stone-400'}`}>
                                <input
                                  type="checkbox"
                                  checked={Boolean(selectedDraft.questions[field.requiredKey])}
                                  disabled={!selectedDraft.questions[field.enabledKey]}
                                  onChange={(event) =>
                                    updateSelectedDraftQuestions((questions) => ({
                                      ...questions,
                                      [field.requiredKey]: event.target.checked
                                    }))
                                  }
                                  className="accent-red-700"
                                />
                                Required
                              </label>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="border-t border-stone-100 pt-6">
                        <div className="mb-5 flex items-center justify-between">
                          <div>
                            <p className="text-sm font-semibold text-stone-700">Custom Questions</p>
                            <p className="text-xs text-stone-400">Additional fields shown after the base fields. Hidden questions are saved but not shown to students.</p>
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
                            {selectedDraft.questions.customQuestions.map((q, i) => (
                              <div key={q.id} className="rounded-xl border border-stone-200 bg-stone-50 p-4">
                                <div className="mb-3 flex items-center justify-between">
                                  <span className="text-xs font-bold uppercase tracking-widest text-stone-400">
                                    Question {i + 1}{q.hidden ? ' · hidden' : ''}
                                  </span>
                                  <div className="flex items-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        updateSelectedDraftQuestions((questions) => ({
                                          ...questions,
                                          customQuestions: questions.customQuestions.map((item) =>
                                            item.id === q.id ? { ...item, hidden: !item.hidden } : item
                                          ),
                                        }))
                                      }
                                      className="rounded-lg border border-stone-200 bg-white px-2.5 py-1 text-xs font-semibold text-stone-600 transition hover:bg-stone-100"
                                    >
                                      {q.hidden ? 'Unhide' : 'Hide'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        updateSelectedDraftQuestions((questions) => ({
                                          ...questions,
                                          customQuestions: questions.customQuestions.filter((item) => item.id !== q.id),
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
                                      value={q.label}
                                      onChange={(e) =>
                                        updateSelectedDraftQuestions((questions) => ({
                                          ...questions,
                                          customQuestions: questions.customQuestions.map((item) =>
                                            item.id === q.id ? { ...item, label: e.target.value } : item
                                          ),
                                        }))
                                      }
                                      className={inputCls}
                                      placeholder="Question text…"
                                    />
                                  </div>
                                  <div>
                                    <label className={labelCls}>Type</label>
                                    <select
                                      value={q.type}
                                      onChange={(e) => {
                                        const nextType = e.target.value as ProgramBioCustomQuestionType;
                                        updateSelectedDraftQuestions((questions) => ({
                                          ...questions,
                                          customQuestions: questions.customQuestions.map((item) =>
                                            item.id === q.id
                                              ? { ...item, type: nextType, options: nextType === 'multiple_choice' ? item.options : [] }
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
                                        checked={q.required}
                                        onChange={(e) =>
                                          updateSelectedDraftQuestions((questions) => ({
                                            ...questions,
                                            customQuestions: questions.customQuestions.map((item) =>
                                              item.id === q.id ? { ...item, required: e.target.checked } : item
                                            ),
                                          }))
                                        }
                                        className="accent-red-700"
                                      />
                                      Required
                                    </label>
                                  </div>
                                </div>
                                {q.type === 'multiple_choice' && (
                                  <div className="mt-3">
                                    <label className={labelCls}>Options (one per line, min. 2)</label>
                                    <textarea
                                      rows={4}
                                      value={q.options.join('\n')}
                                      onChange={(e) =>
                                        updateSelectedDraftQuestions((questions) => ({
                                          ...questions,
                                          customQuestions: questions.customQuestions.map((item) =>
                                            item.id === q.id ? { ...item, options: parseOptionsTextLines(e.target.value) } : item
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

                  {/* ── SYNC TAB ── */}
                  {activeTab === 'sync' && (
                    <div className="space-y-5 max-w-md">
                      <div>
                        <p className="text-sm font-semibold text-stone-700 mb-1">Sync Submissions to Show</p>
                        <p className="text-xs leading-relaxed text-stone-400">
                          Pull submitted bios into the show's cast list and optionally generate student promo codes.
                        </p>
                      </div>

                      <div className="space-y-2">
                        {[
                          { checked: syncCast, onChange: setSyncCast, label: 'Sync cast', sub: 'Creates or updates cast members from submissions' },
                          { checked: syncStudentCredits, onChange: setSyncStudentCredits, label: 'Sync student credits', sub: 'Generates promo codes for cast members' },
                        ].map(({ checked, onChange, label, sub }) => (
                          <label key={label} className="flex cursor-pointer items-start gap-3 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 transition hover:border-stone-300">
                            <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 accent-red-700" />
                            <div>
                              <p className="text-sm font-semibold text-stone-800">{label}</p>
                              <p className="text-xs text-stone-400">{sub}</p>
                            </div>
                          </label>
                        ))}
                      </div>

                      <button
                        type="button"
                        onClick={() => void runSync(selectedForm.id)}
                        disabled={selectedForm.isArchived || syncing || (!syncCast && !syncStudentCredits)}
                        className="inline-flex items-center gap-2 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-800 disabled:opacity-50"
                      >
                        <Users className="h-4 w-4" />
                        {syncing ? 'Syncing…' : 'Run Sync'}
                      </button>
                      {selectedForm.isArchived && (
                        <p className="text-xs text-amber-700">Archived forms cannot be synced.</p>
                      )}

                      {syncResult && (
                        <div className="rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm space-y-1">
                          <p className="font-semibold text-stone-800 mb-2">Sync Results</p>
                          <p className="text-stone-600">Submissions processed: <span className="font-semibold text-stone-900">{syncResult.submissionCount}</span></p>
                          {syncResult.syncCast && (
                            <p className="text-stone-600">
                              Cast: <span className="text-emerald-700 font-medium">+{syncResult.syncCast.created} created</span>, {syncResult.syncCast.updated} updated, {syncResult.syncCast.skipped} skipped
                            </p>
                          )}
                          {syncResult.syncStudentCredits && (
                            <p className="text-stone-600">
                              Credits: <span className="text-emerald-700 font-medium">+{syncResult.syncStudentCredits.created} created</span>, {syncResult.syncStudentCredits.updated} updated, {syncResult.syncStudentCredits.skipped} skipped
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── RESPONSES TAB ── */}
                  {activeTab === 'responses' && (
                    <div>
                      <div className="mb-4 flex items-center justify-between">
                        <p className="text-xs text-stone-500">
                          Export includes all submission fields and custom question responses.
                        </p>
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
                                <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-stone-500">Name</th>
                                <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-stone-500">Email</th>
                                <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-stone-500">Grade</th>
                                <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-stone-500">Role</th>
                                <th className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-stone-500">Updated</th>
                                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-stone-500">Actions</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-stone-100">
                              {submissions.map((sub) => (
                                <tr
                                  key={sub.id}
                                  className="cursor-pointer transition hover:bg-stone-50"
                                  onClick={() => setSelectedSubmission(sub)}
                                >
                                  <td className="px-4 py-3 font-medium text-stone-900">{sub.fullName}</td>
                                  <td className="px-4 py-3 text-stone-500">{sub.schoolEmail}</td>
                                  <td className="px-4 py-3 text-stone-500">{sub.gradeLevel}</td>
                                  <td className="px-4 py-3 text-stone-500">{sub.roleInShow}</td>
                                  <td className="px-4 py-3 text-stone-400">{new Date(sub.updatedAt).toLocaleDateString()}</td>
                                  <td className="px-4 py-3 text-right">
                                    <button
                                      type="button"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        void deleteSubmission(sub);
                                      }}
                                      disabled={deletingSubmissionId === sub.id}
                                      className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                      {deletingSubmissionId === sub.id ? 'Deleting...' : 'Delete'}
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

      {/* ── Submission detail modal ── */}
      {selectedSubmission && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6" onClick={() => setSelectedSubmission(null)}>
          <div className="absolute inset-0 bg-black/25 backdrop-blur-sm" />
          <div
            className="relative z-10 w-full max-w-3xl overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-stone-100 bg-white px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Response</p>
                <p className="mt-0.5 text-base font-bold text-stone-900">{selectedSubmission.fullName}</p>
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
              {/* Quick facts */}
              <div className="grid grid-cols-2 gap-3">
                {[
                  ['Email', selectedSubmission.schoolEmail],
                  ['Grade', String(selectedSubmission.gradeLevel)],
                  ['Role', selectedSubmission.roleInShow],
                  ['Submitted', new Date(selectedSubmission.submittedAt).toLocaleDateString()],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl bg-stone-50 px-3 py-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-stone-400">{label}</p>
                    <p className="mt-0.5 text-sm font-medium text-stone-800 break-words">{value}</p>
                  </div>
                ))}
              </div>

              {/* Bio */}
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-stone-400">Bio</p>
                <p className="whitespace-pre-wrap rounded-xl border border-stone-100 bg-stone-50 px-4 py-3 text-sm leading-relaxed text-stone-700">
                  {selectedSubmission.bio || '—'}
                </p>
              </div>

              {/* Custom responses */}
              {selectedSubmission.extraResponses && Object.keys(selectedSubmission.extraResponses).length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-400">Custom Responses</p>
                  <div className="space-y-2">
                    {Object.entries(selectedSubmission.extraResponses).map(([qId, value]) => (
                      <div key={qId} className="rounded-xl border border-stone-100 bg-stone-50 px-4 py-3">
                        <p className="text-xs font-semibold text-stone-600">
                          {selectedCustomQuestionsById.get(qId)?.label ?? 'Custom question'}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-sm text-stone-700">{value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Headshot */}
              {selectedSubmission.headshotUrl && (
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-stone-400">Headshot</p>
                  <img
                    src={selectedSubmission.headshotUrl}
                    alt={selectedSubmission.fullName}
                    className="w-full rounded-xl border border-stone-100 object-cover"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
