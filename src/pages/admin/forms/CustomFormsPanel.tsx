import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  Plus,
  RefreshCw,
  Save,
  Send,
  Trash2,
  Users,
  X
} from 'lucide-react';
import { adminFetch } from '../../../lib/adminAuth';
import { createBuilderId } from '../../../lib/eventRegistrationForm';

type CustomFormFieldType = 'short_text' | 'long_text' | 'email' | 'phone' | 'number' | 'date' | 'dropdown' | 'checkbox';
type CustomFormStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
type FormScope = 'active' | 'archived' | 'all';
type ActiveTab = 'builder' | 'responses';

type CustomFormField = {
  id: string;
  label: string;
  type: CustomFormFieldType;
  required: boolean;
  hidden: boolean;
  placeholder?: string;
  helpText?: string;
  options: string[];
};

type CustomFormDefinition = {
  schemaVersion: string;
  introText?: string;
  successMessage?: string;
  submitButtonLabel?: string;
  fields: CustomFormField[];
};

type CustomFormSummary = {
  id: string;
  publicSlug: string;
  sharePath: string;
  formName: string;
  internalDescription: string | null;
  status: CustomFormStatus;
  schemaVersion: string;
  definition: CustomFormDefinition;
  archivedAt: string | null;
  responseCount: number;
  createdAt: string;
  updatedAt: string;
};

type CustomFormSubmission = {
  id: string;
  formId: string;
  responseJson: Record<string, unknown>;
  submitterName: string | null;
  submitterEmail: string | null;
  submittedAt: string;
  createdAt: string;
  updatedAt: string;
};

type CustomFormDraft = {
  formName: string;
  internalDescription: string;
  definition: CustomFormDefinition;
};

const inputCls =
  'w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900 placeholder:text-stone-400 transition focus:border-stone-400 focus:outline-none';
const labelCls = 'mb-1.5 block text-xs font-semibold uppercase tracking-wider text-stone-500';

const fieldTypeOptions: Array<{ value: CustomFormFieldType; label: string }> = [
  { value: 'short_text', label: 'Short text' },
  { value: 'long_text', label: 'Long text' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'dropdown', label: 'Dropdown' },
  { value: 'checkbox', label: 'Checkbox' }
];

const statusTone: Record<CustomFormStatus, string> = {
  DRAFT: 'border-amber-200 bg-amber-50 text-amber-700',
  PUBLISHED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  ARCHIVED: 'border-stone-200 bg-stone-100 text-stone-500'
};

function newField(type: CustomFormFieldType = 'short_text'): CustomFormField {
  return {
    id: createBuilderId('field'),
    label: 'Untitled field',
    type,
    required: false,
    hidden: false,
    placeholder: '',
    helpText: '',
    options: type === 'dropdown' ? ['Option 1', 'Option 2'] : []
  };
}

function normalizeOptions(value: string): string[] {
  return Array.from(new Set(value.split('\n').map((line) => line.trim()).filter(Boolean)));
}

function toLocalDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function normalizeDefinition(definition: Partial<CustomFormDefinition> | undefined): CustomFormDefinition {
  const fields = Array.isArray(definition?.fields) ? definition.fields : [];
  return {
    schemaVersion: definition?.schemaVersion || 'CUSTOM_FORM_V1',
    introText: definition?.introText || '',
    successMessage: definition?.successMessage || 'Thanks! Your response has been submitted.',
    submitButtonLabel: definition?.submitButtonLabel || 'Submit',
    fields: fields
      .map((field) => ({
        id: String(field.id || '').trim(),
        label: String(field.label || '').trim(),
        type: (field.type || 'short_text') as CustomFormFieldType,
        required: Boolean(field.required),
        hidden: Boolean(field.hidden),
        placeholder: String(field.placeholder || '').trim(),
        helpText: String(field.helpText || '').trim(),
        options:
          field.type === 'dropdown'
            ? Array.from(new Set((Array.isArray(field.options) ? field.options : []).map((option) => String(option).trim()).filter(Boolean)))
            : []
      }))
      .filter((field) => field.id && field.label)
  };
}

function cloneDraftFromForm(form: CustomFormSummary): CustomFormDraft {
  return {
    formName: form.formName,
    internalDescription: form.internalDescription || '',
    definition: normalizeDefinition(form.definition)
  };
}

function validateDraft(draft: CustomFormDraft): string | null {
  if (!draft.formName.trim()) return 'Form name is required.';
  if (!draft.definition.fields.length) return 'Add at least one field to the form.';

  const seen = new Set<string>();
  for (let index = 0; index < draft.definition.fields.length; index += 1) {
    const field = draft.definition.fields[index];
    const label = `Field ${index + 1}`;

    if (!field.id.trim()) return `${label} id is required.`;
    if (seen.has(field.id.trim())) return `${label} has a duplicate id.`;
    seen.add(field.id.trim());

    if (!field.label.trim()) return `${label} label is required.`;
    if (field.type === 'dropdown' && field.options.length < 1) return `${label} needs at least one dropdown option.`;
  }

  return null;
}

function asSubmissionLines(submission: CustomFormSubmission): Array<{ key: string; value: string }> {
  return Object.entries(submission.responseJson || {}).map(([key, value]) => ({
    key,
    value:
      typeof value === 'string'
        ? value
        : typeof value === 'number' || typeof value === 'boolean'
          ? String(value)
          : JSON.stringify(value)
  }));
}

export default function CustomFormsPanel() {
  const [forms, setForms] = useState<CustomFormSummary[]>([]);
  const [selectedFormId, setSelectedFormId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, CustomFormDraft>>({});
  const [scope, setScope] = useState<FormScope>('active');
  const [activeTab, setActiveTab] = useState<ActiveTab>('builder');
  const [submissions, setSubmissions] = useState<CustomFormSubmission[]>([]);
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<string | null>(null);

  const [newFormName, setNewFormName] = useState('');
  const [newFormDescription, setNewFormDescription] = useState('');

  const [loading, setLoading] = useState(false);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [deletingForm, setDeletingForm] = useState(false);
  const [deletingSubmissionId, setDeletingSubmissionId] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const visibleForms = useMemo(() => {
    if (scope === 'active') {
      return forms.filter((form) => form.status !== 'ARCHIVED');
    }
    if (scope === 'archived') {
      return forms.filter((form) => form.status === 'ARCHIVED');
    }
    return forms;
  }, [forms, scope]);

  const selectedForm = useMemo(
    () => forms.find((form) => form.id === selectedFormId) || null,
    [forms, selectedFormId]
  );

  const selectedDraft = useMemo(
    () => (selectedForm ? drafts[selectedForm.id] || cloneDraftFromForm(selectedForm) : null),
    [drafts, selectedForm]
  );

  const selectedSubmissionIndex = useMemo(
    () => submissions.findIndex((submission) => submission.id === selectedSubmissionId),
    [submissions, selectedSubmissionId]
  );

  const selectedSubmission = selectedSubmissionIndex >= 0 ? submissions[selectedSubmissionIndex] : null;

  const refreshForms = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await adminFetch<CustomFormSummary[]>('/api/admin/custom-forms');
      setForms(data || []);
      setDrafts((previous) => {
        const next: Record<string, CustomFormDraft> = {};
        for (const form of data || []) {
          next[form.id] = previous[form.id] || cloneDraftFromForm(form);
        }
        return next;
      });
      setSelectedFormId((current) => {
        if (current && (data || []).some((form) => form.id === current)) return current;
        return (data || [])[0]?.id || null;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load forms.');
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshSubmissions = useCallback(async (formId: string) => {
    setLoadingSubmissions(true);
    try {
      const data = await adminFetch<CustomFormSubmission[]>(`/api/admin/custom-forms/${formId}/submissions`);
      setSubmissions(data || []);
      setSelectedSubmissionId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load responses.');
    } finally {
      setLoadingSubmissions(false);
    }
  }, []);

  useEffect(() => {
    void refreshForms();
  }, [refreshForms]);

  useEffect(() => {
    if (!selectedForm || activeTab !== 'responses') {
      setSubmissions([]);
      setSelectedSubmissionId(null);
      return;
    }
    void refreshSubmissions(selectedForm.id);
  }, [activeTab, refreshSubmissions, selectedForm]);

  function patchDraft(formId: string, update: (draft: CustomFormDraft) => CustomFormDraft): void {
    setDrafts((previous) => {
      const form = forms.find((candidate) => candidate.id === formId);
      const source = previous[formId] || (form ? cloneDraftFromForm(form) : {
        formName: '',
        internalDescription: '',
        definition: {
          schemaVersion: 'CUSTOM_FORM_V1',
          introText: '',
          successMessage: 'Thanks! Your response has been submitted.',
          submitButtonLabel: 'Submit',
          fields: [newField('short_text')]
        }
      });
      return { ...previous, [formId]: update(source) };
    });
  }

  async function createForm(): Promise<void> {
    if (!newFormName.trim()) {
      setError('Give the form a name first.');
      return;
    }

    setCreating(true);
    setError(null);
    setNotice(null);

    try {
      const created = await adminFetch<CustomFormSummary>('/api/admin/custom-forms', {
        method: 'POST',
        body: JSON.stringify({
          formName: newFormName.trim(),
          internalDescription: newFormDescription.trim() || undefined
        })
      });

      setForms((previous) => [created, ...previous]);
      setDrafts((previous) => ({ ...previous, [created.id]: cloneDraftFromForm(created) }));
      setSelectedFormId(created.id);
      setActiveTab('builder');
      setNewFormName('');
      setNewFormDescription('');
      setNotice('Custom form created.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create form.');
    } finally {
      setCreating(false);
    }
  }

  async function saveDraft(): Promise<void> {
    if (!selectedForm || !selectedDraft) return;

    const validation = validateDraft(selectedDraft);
    if (validation) {
      setError(validation);
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const updated = await adminFetch<CustomFormSummary>(`/api/admin/custom-forms/${selectedForm.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          formName: selectedDraft.formName.trim(),
          internalDescription: selectedDraft.internalDescription.trim() || null,
          definition: {
            ...selectedDraft.definition,
            fields: selectedDraft.definition.fields.map((field) => ({
              ...field,
              id: field.id.trim(),
              label: field.label.trim(),
              options: field.type === 'dropdown' ? field.options : []
            }))
          }
        })
      });

      setForms((previous) => previous.map((form) => (form.id === updated.id ? updated : form)));
      setDrafts((previous) => ({ ...previous, [updated.id]: cloneDraftFromForm(updated) }));
      setNotice('Form saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save form.');
    } finally {
      setSaving(false);
    }
  }

  async function setFormStatus(status: CustomFormStatus): Promise<void> {
    if (!selectedForm) return;

    const busySetter = status === 'ARCHIVED' ? setArchiving : setPublishing;
    busySetter(true);
    setError(null);
    setNotice(null);

    try {
      const updated = await adminFetch<CustomFormSummary>(`/api/admin/custom-forms/${selectedForm.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status })
      });

      setForms((previous) => previous.map((form) => (form.id === updated.id ? updated : form)));
      setDrafts((previous) => ({ ...previous, [updated.id]: previous[updated.id] || cloneDraftFromForm(updated) }));
      setNotice(status === 'PUBLISHED' ? 'Form published.' : status === 'DRAFT' ? 'Form moved to draft.' : 'Form archived.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update form status.');
    } finally {
      busySetter(false);
    }
  }

  async function deleteForm(): Promise<void> {
    if (!selectedForm) return;
    if (!window.confirm(`Delete "${selectedForm.formName}" and all of its responses?`)) return;

    setDeletingForm(true);
    setError(null);
    setNotice(null);

    try {
      await adminFetch(`/api/admin/custom-forms/${selectedForm.id}`, { method: 'DELETE' });
      setForms((previous) => previous.filter((form) => form.id !== selectedForm.id));
      setDrafts((previous) => {
        const next = { ...previous };
        delete next[selectedForm.id];
        return next;
      });
      setSelectedFormId((previous) => {
        if (previous !== selectedForm.id) return previous;
        const nextCandidate = forms.find((form) => form.id !== selectedForm.id);
        return nextCandidate?.id || null;
      });
      setSubmissions([]);
      setSelectedSubmissionId(null);
      setNotice('Form deleted.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete form.');
    } finally {
      setDeletingForm(false);
    }
  }

  async function deleteSubmission(submissionId: string): Promise<void> {
    if (!selectedForm) return;
    if (!window.confirm('Delete this response?')) return;

    setDeletingSubmissionId(submissionId);
    setError(null);
    setNotice(null);

    try {
      await adminFetch(`/api/admin/custom-forms/${selectedForm.id}/submissions/${submissionId}`, {
        method: 'DELETE'
      });
      setSubmissions((previous) => previous.filter((submission) => submission.id !== submissionId));
      if (selectedSubmissionId === submissionId) setSelectedSubmissionId(null);
      setForms((previous) =>
        previous.map((form) =>
          form.id === selectedForm.id ? { ...form, responseCount: Math.max(0, form.responseCount - 1) } : form
        )
      );
      setNotice('Response deleted.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete response.');
    } finally {
      setDeletingSubmissionId(null);
    }
  }

  function copyShareLink(): void {
    if (!selectedForm) return;
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const value = `${origin}${selectedForm.sharePath}`;
    void navigator.clipboard.writeText(value);
    setNotice('Public link copied to clipboard.');
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 px-4 py-6 sm:px-6">
      <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-600">Standalone Custom Forms</h2>
          <button
            type="button"
            onClick={() => void refreshForms()}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-medium text-stone-700 transition hover:bg-stone-50 disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="md:col-span-1">
            <label className={labelCls}>New form name</label>
            <input
              className={inputCls}
              value={newFormName}
              onChange={(event) => setNewFormName(event.target.value)}
              placeholder="Volunteer Signup, Camp Interest Form, etc."
            />
          </div>
          <div className="md:col-span-1">
            <label className={labelCls}>Internal notes (optional)</label>
            <input
              className={inputCls}
              value={newFormDescription}
              onChange={(event) => setNewFormDescription(event.target.value)}
              placeholder="Who this form is for"
            />
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => void createForm()}
              disabled={creating}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-800 disabled:opacity-60"
            >
              <Plus className="h-4 w-4" /> Create form
            </button>
          </div>
        </div>

        {(error || notice) && (
          <div className={`mt-3 rounded-lg border px-3 py-2 text-sm ${error ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
            {error || notice}
          </div>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="rounded-2xl border border-stone-200 bg-white shadow-sm">
          <div className="border-b border-stone-100 px-3 py-2">
            <div className="mb-2 flex rounded-lg border border-stone-200 p-1 text-xs font-medium text-stone-500">
              {[
                { key: 'active', label: 'Active' },
                { key: 'archived', label: 'Archived' },
                { key: 'all', label: 'All' }
              ].map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setScope(tab.key as FormScope)}
                  className={`flex-1 rounded-md px-2 py-1 transition ${scope === tab.key ? 'bg-stone-900 text-white' : 'hover:bg-stone-100'}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="text-xs text-stone-400">{visibleForms.length} form{visibleForms.length !== 1 ? 's' : ''}</div>
          </div>

          <div className="max-h-[62vh] space-y-2 overflow-auto p-2">
            {visibleForms.map((form) => (
              <button
                key={form.id}
                type="button"
                onClick={() => {
                  setSelectedFormId(form.id);
                  setActiveTab('builder');
                }}
                className={`w-full rounded-xl border px-3 py-2 text-left transition ${
                  selectedFormId === form.id
                    ? 'border-red-300 bg-red-50/60'
                    : 'border-stone-200 bg-white hover:border-stone-300 hover:bg-stone-50'
                }`}
              >
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="line-clamp-1 text-sm font-semibold text-stone-800">{form.formName}</span>
                  <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${statusTone[form.status]}`}>
                    {form.status}
                  </span>
                </div>
                <div className="line-clamp-2 text-xs text-stone-500">{form.internalDescription || 'No internal description'}</div>
                <div className="mt-2 flex items-center gap-2 text-[11px] text-stone-400">
                  <Users className="h-3.5 w-3.5" /> {form.responseCount} responses
                </div>
              </button>
            ))}
            {visibleForms.length === 0 && <div className="px-2 py-6 text-center text-xs text-stone-400">No forms in this view.</div>}
          </div>
        </aside>

        <section className="rounded-2xl border border-stone-200 bg-white shadow-sm">
          {!selectedForm || !selectedDraft ? (
            <div className="flex min-h-[460px] items-center justify-center px-6 text-center text-sm text-stone-500">
              Create a form on the left, then build fields, publish, and share your public link.
            </div>
          ) : (
            <>
              <div className="border-b border-stone-100 px-4 py-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-2 py-1 text-[11px] font-semibold ${statusTone[selectedForm.status]}`}>
                    {selectedForm.status}
                  </span>
                  <span className="text-xs text-stone-400">Public path: {selectedForm.sharePath}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {[
                    { key: 'builder', label: 'Builder' },
                    { key: 'responses', label: `Responses (${selectedForm.responseCount})` }
                  ].map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setActiveTab(tab.key as ActiveTab)}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                        activeTab === tab.key
                          ? 'border-stone-900 bg-stone-900 text-white'
                          : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-50'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {activeTab === 'builder' && (
                <div className="space-y-4 p-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <label className={labelCls}>Form title</label>
                      <input
                        className={inputCls}
                        value={selectedDraft.formName}
                        onChange={(event) =>
                          patchDraft(selectedForm.id, (draft) => ({ ...draft, formName: event.target.value }))
                        }
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Internal description</label>
                      <input
                        className={inputCls}
                        value={selectedDraft.internalDescription}
                        onChange={(event) =>
                          patchDraft(selectedForm.id, (draft) => ({ ...draft, internalDescription: event.target.value }))
                        }
                        placeholder="Shown only in admin"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className={labelCls}>Intro text (optional)</label>
                      <textarea
                        className={`${inputCls} min-h-[74px] resize-y`}
                        value={selectedDraft.definition.introText || ''}
                        onChange={(event) =>
                          patchDraft(selectedForm.id, (draft) => ({
                            ...draft,
                            definition: { ...draft.definition, introText: event.target.value }
                          }))
                        }
                        placeholder="Text shown above the form for families"
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Success message</label>
                      <input
                        className={inputCls}
                        value={selectedDraft.definition.successMessage || ''}
                        onChange={(event) =>
                          patchDraft(selectedForm.id, (draft) => ({
                            ...draft,
                            definition: { ...draft.definition, successMessage: event.target.value }
                          }))
                        }
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Submit button label</label>
                      <input
                        className={inputCls}
                        value={selectedDraft.definition.submitButtonLabel || ''}
                        onChange={(event) =>
                          patchDraft(selectedForm.id, (draft) => ({
                            ...draft,
                            definition: { ...draft.definition, submitButtonLabel: event.target.value }
                          }))
                        }
                      />
                    </div>
                  </div>

                  <div className="rounded-xl border border-stone-200 bg-stone-50/60 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-stone-700">Fields</h3>
                      <button
                        type="button"
                        onClick={() =>
                          patchDraft(selectedForm.id, (draft) => ({
                            ...draft,
                            definition: {
                              ...draft.definition,
                              fields: [...draft.definition.fields, newField()]
                            }
                          }))
                        }
                        className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-700 transition hover:bg-stone-100"
                      >
                        <Plus className="h-3.5 w-3.5" /> Add field
                      </button>
                    </div>

                    <div className="space-y-3">
                      {selectedDraft.definition.fields.map((field, fieldIndex) => (
                        <div key={`${field.id}-${fieldIndex}`} className="rounded-lg border border-stone-200 bg-white p-3">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <div className="text-xs font-semibold uppercase tracking-wider text-stone-500">Field {fieldIndex + 1}</div>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() =>
                                  patchDraft(selectedForm.id, (draft) => {
                                    if (fieldIndex === 0) return draft;
                                    const fields = [...draft.definition.fields];
                                    const [item] = fields.splice(fieldIndex, 1);
                                    fields.splice(fieldIndex - 1, 0, item);
                                    return { ...draft, definition: { ...draft.definition, fields } };
                                  })
                                }
                                className="rounded-md border border-stone-200 p-1 text-stone-500 hover:bg-stone-100"
                                disabled={fieldIndex === 0}
                              >
                                <ChevronLeft className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  patchDraft(selectedForm.id, (draft) => {
                                    if (fieldIndex >= draft.definition.fields.length - 1) return draft;
                                    const fields = [...draft.definition.fields];
                                    const [item] = fields.splice(fieldIndex, 1);
                                    fields.splice(fieldIndex + 1, 0, item);
                                    return { ...draft, definition: { ...draft.definition, fields } };
                                  })
                                }
                                className="rounded-md border border-stone-200 p-1 text-stone-500 hover:bg-stone-100"
                                disabled={fieldIndex >= selectedDraft.definition.fields.length - 1}
                              >
                                <ChevronRight className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  patchDraft(selectedForm.id, (draft) => ({
                                    ...draft,
                                    definition: {
                                      ...draft.definition,
                                      fields: draft.definition.fields.filter((_, idx) => idx !== fieldIndex)
                                    }
                                  }))
                                }
                                className="rounded-md border border-red-200 p-1 text-red-600 hover:bg-red-50"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>

                          <div className="grid gap-3 md:grid-cols-2">
                            <div>
                              <label className={labelCls}>Label</label>
                              <input
                                className={inputCls}
                                value={field.label}
                                onChange={(event) =>
                                  patchDraft(selectedForm.id, (draft) => ({
                                    ...draft,
                                    definition: {
                                      ...draft.definition,
                                      fields: draft.definition.fields.map((current, idx) =>
                                        idx === fieldIndex ? { ...current, label: event.target.value } : current
                                      )
                                    }
                                  }))
                                }
                              />
                            </div>
                            <div>
                              <label className={labelCls}>Field id</label>
                              <input
                                className={inputCls}
                                value={field.id}
                                onChange={(event) =>
                                  patchDraft(selectedForm.id, (draft) => ({
                                    ...draft,
                                    definition: {
                                      ...draft.definition,
                                      fields: draft.definition.fields.map((current, idx) =>
                                        idx === fieldIndex ? { ...current, id: event.target.value } : current
                                      )
                                    }
                                  }))
                                }
                              />
                            </div>
                            <div>
                              <label className={labelCls}>Type</label>
                              <select
                                className={inputCls}
                                value={field.type}
                                onChange={(event) => {
                                  const nextType = event.target.value as CustomFormFieldType;
                                  patchDraft(selectedForm.id, (draft) => ({
                                    ...draft,
                                    definition: {
                                      ...draft.definition,
                                      fields: draft.definition.fields.map((current, idx) =>
                                        idx === fieldIndex
                                          ? {
                                              ...current,
                                              type: nextType,
                                              options:
                                                nextType === 'dropdown'
                                                  ? current.options.length > 0
                                                    ? current.options
                                                    : ['Option 1', 'Option 2']
                                                  : []
                                            }
                                          : current
                                      )
                                    }
                                  }));
                                }}
                              >
                                {fieldTypeOptions.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className={labelCls}>Placeholder</label>
                              <input
                                className={inputCls}
                                value={field.placeholder || ''}
                                onChange={(event) =>
                                  patchDraft(selectedForm.id, (draft) => ({
                                    ...draft,
                                    definition: {
                                      ...draft.definition,
                                      fields: draft.definition.fields.map((current, idx) =>
                                        idx === fieldIndex ? { ...current, placeholder: event.target.value } : current
                                      )
                                    }
                                  }))
                                }
                              />
                            </div>
                            <div className="md:col-span-2">
                              <label className={labelCls}>Help text (optional)</label>
                              <input
                                className={inputCls}
                                value={field.helpText || ''}
                                onChange={(event) =>
                                  patchDraft(selectedForm.id, (draft) => ({
                                    ...draft,
                                    definition: {
                                      ...draft.definition,
                                      fields: draft.definition.fields.map((current, idx) =>
                                        idx === fieldIndex ? { ...current, helpText: event.target.value } : current
                                      )
                                    }
                                  }))
                                }
                              />
                            </div>

                            {field.type === 'dropdown' && (
                              <div className="md:col-span-2">
                                <label className={labelCls}>Dropdown options (one per line)</label>
                                <textarea
                                  className={`${inputCls} min-h-[80px] resize-y`}
                                  value={field.options.join('\n')}
                                  onChange={(event) =>
                                    patchDraft(selectedForm.id, (draft) => ({
                                      ...draft,
                                      definition: {
                                        ...draft.definition,
                                        fields: draft.definition.fields.map((current, idx) =>
                                          idx === fieldIndex ? { ...current, options: normalizeOptions(event.target.value) } : current
                                        )
                                      }
                                    }))
                                  }
                                />
                              </div>
                            )}

                            <div className="md:col-span-2 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  patchDraft(selectedForm.id, (draft) => ({
                                    ...draft,
                                    definition: {
                                      ...draft.definition,
                                      fields: draft.definition.fields.map((current, idx) =>
                                        idx === fieldIndex ? { ...current, required: !current.required } : current
                                      )
                                    }
                                  }))
                                }
                                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                                  field.required
                                    ? 'border-stone-800 bg-stone-800 text-white'
                                    : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-100'
                                }`}
                              >
                                {field.required ? <Check className="mr-1 inline h-3.5 w-3.5" /> : null}
                                Required
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  patchDraft(selectedForm.id, (draft) => ({
                                    ...draft,
                                    definition: {
                                      ...draft.definition,
                                      fields: draft.definition.fields.map((current, idx) =>
                                        idx === fieldIndex ? { ...current, hidden: !current.hidden } : current
                                      )
                                    }
                                  }))
                                }
                                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                                  field.hidden
                                    ? 'border-amber-300 bg-amber-50 text-amber-700'
                                    : 'border-stone-200 bg-white text-stone-600 hover:bg-stone-100'
                                }`}
                              >
                                Hidden
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 border-t border-stone-100 pt-2">
                    <button
                      type="button"
                      onClick={() => void saveDraft()}
                      disabled={saving}
                      className="inline-flex items-center gap-1 rounded-lg bg-stone-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-black disabled:opacity-60"
                    >
                      <Save className="h-3.5 w-3.5" /> Save
                    </button>
                    {selectedForm.status !== 'PUBLISHED' ? (
                      <button
                        type="button"
                        onClick={() => void setFormStatus('PUBLISHED')}
                        disabled={publishing}
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-60"
                      >
                        <Send className="h-3.5 w-3.5" /> Publish
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void setFormStatus('DRAFT')}
                        disabled={publishing}
                        className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 transition hover:bg-amber-100 disabled:opacity-60"
                      >
                        Move to draft
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={copyShareLink}
                      className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-semibold text-stone-700 transition hover:bg-stone-100"
                    >
                      <Copy className="h-3.5 w-3.5" /> Copy public link
                    </button>
                    <button
                      type="button"
                      onClick={() => void setFormStatus('ARCHIVED')}
                      disabled={archiving || selectedForm.status === 'ARCHIVED'}
                      className="inline-flex items-center gap-1 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-semibold text-stone-700 transition hover:bg-stone-100 disabled:opacity-60"
                    >
                      <Archive className="h-3.5 w-3.5" /> Archive
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteForm()}
                      disabled={deletingForm}
                      className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-60"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </button>
                  </div>
                </div>
              )}

              {activeTab === 'responses' && (
                <div className="p-4">
                  {loadingSubmissions ? (
                    <div className="py-8 text-center text-sm text-stone-500">Loading responses...</div>
                  ) : submissions.length === 0 ? (
                    <div className="py-8 text-center text-sm text-stone-500">No responses yet.</div>
                  ) : (
                    <div className="space-y-2">
                      {submissions.map((submission) => (
                        <div key={submission.id} className="rounded-lg border border-stone-200 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <div className="text-sm font-semibold text-stone-800">
                                {submission.submitterName || 'Unnamed response'}
                              </div>
                              <div className="text-xs text-stone-500">
                                {submission.submitterEmail || 'No email provided'} • {toLocalDateTime(submission.submittedAt)}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setSelectedSubmissionId(submission.id)}
                                className="inline-flex items-center gap-1 rounded-lg border border-stone-200 px-2.5 py-1.5 text-xs font-semibold text-stone-700 transition hover:bg-stone-100"
                              >
                                <Eye className="h-3.5 w-3.5" /> View
                              </button>
                              <button
                                type="button"
                                onClick={() => void deleteSubmission(submission.id)}
                                disabled={deletingSubmissionId === submission.id}
                                className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:opacity-60"
                              >
                                <Trash2 className="h-3.5 w-3.5" /> Delete
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      </div>

      {selectedSubmission && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 px-3"
          role="dialog"
          aria-modal="true"
          onMouseDown={() => setSelectedSubmissionId(null)}
        >
          <div
            className="w-full max-w-2xl rounded-2xl border border-stone-200 bg-white shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-stone-100 px-4 py-3">
              <div>
                <h3 className="text-base font-semibold text-stone-900">Response details</h3>
                <p className="text-xs text-stone-500">
                  {selectedSubmissionIndex + 1} of {submissions.length}
                </p>
              </div>
              <button
                type="button"
                className="rounded-full p-1 text-stone-500 hover:bg-stone-100"
                onClick={() => setSelectedSubmissionId(null)}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-[70vh] space-y-4 overflow-y-auto px-4 py-4">
              <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-sm">
                <div className="font-semibold text-stone-800">{selectedSubmission.submitterName || 'Unnamed response'}</div>
                <div className="text-stone-500">{selectedSubmission.submitterEmail || 'No email provided'}</div>
                <div className="text-xs text-stone-400">Submitted {toLocalDateTime(selectedSubmission.submittedAt)}</div>
              </div>

              <div className="space-y-2">
                {asSubmissionLines(selectedSubmission).map((line) => (
                  <div key={line.key} className="rounded-lg border border-stone-200 p-3">
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500">{line.key}</div>
                    <div className="whitespace-pre-wrap text-sm text-stone-800">{line.value || '—'}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-stone-100 px-4 py-3">
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-lg border border-stone-200 px-3 py-2 text-xs font-semibold text-stone-700 transition hover:bg-stone-100 disabled:opacity-40"
                onClick={() => {
                  if (selectedSubmissionIndex <= 0) return;
                  setSelectedSubmissionId(submissions[selectedSubmissionIndex - 1].id);
                }}
                disabled={selectedSubmissionIndex <= 0}
              >
                <ChevronLeft className="h-4 w-4" /> Previous
              </button>

              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-100"
                onClick={() => {
                  const targetId = selectedSubmission.id;
                  setSelectedSubmissionId(null);
                  void deleteSubmission(targetId);
                }}
              >
                <Trash2 className="h-4 w-4" /> Delete response
              </button>

              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-lg border border-stone-200 px-3 py-2 text-xs font-semibold text-stone-700 transition hover:bg-stone-100 disabled:opacity-40"
                onClick={() => {
                  if (selectedSubmissionIndex >= submissions.length - 1) return;
                  setSelectedSubmissionId(submissions[selectedSubmissionIndex + 1].id);
                }}
                disabled={selectedSubmissionIndex >= submissions.length - 1}
              >
                Next <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
