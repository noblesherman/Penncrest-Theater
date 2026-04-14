import { useEffect, useMemo, useState } from 'react';
import { X, Plus, ArrowUp, ArrowDown, Copy, Eye, Save, Archive, Upload } from 'lucide-react';
import { adminFetch } from '../../../lib/adminAuth';
import {
  type EventRegistrationAdminFormResponse,
  type EventRegistrationDefinition,
  type EventRegistrationFieldDefinition,
  type EventRegistrationFieldType,
  type EventRegistrationPolicyDefinition,
  type EventRegistrationPolicyType,
  type EventRegistrationSectionDefinition,
  type EventRegistrationSectionType,
  type EventRegistrationSettings,
  createBuilderId,
  normalizeOptions
} from '../../../lib/eventRegistrationForm';

type PerformanceOption = {
  id: string;
  title: string;
  isFundraiser?: boolean;
};

type BuilderState = {
  id?: string;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  formName: string;
  internalDescription: string;
  settings: EventRegistrationSettings;
  definition: EventRegistrationDefinition;
  publishedVersionId?: string;
  publishedVersionNumber?: number;
  publishedAt?: string;
};

type Props = {
  open: boolean;
  performance: PerformanceOption | null;
  performanceOptions: PerformanceOption[];
  onClose: () => void;
};

const fieldTypeOptions: Array<{ value: EventRegistrationFieldType; label: string }> = [
  { value: 'short_text', label: 'Short text' },
  { value: 'long_text', label: 'Long text' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'dropdown', label: 'Dropdown' },
  { value: 'multi_select', label: 'Multi select' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'radio_yes_no', label: 'Yes/No radio' },
  { value: 'repeatable_person_list', label: 'Repeatable person list (text)' },
  { value: 'signature_typed', label: 'Typed signature' }
];

const sectionTypeOptions: Array<{ value: EventRegistrationSectionType; label: string }> = [
  { value: 'single', label: 'Single (once per order)' },
  { value: 'repeating_child', label: 'Repeating per child' }
];

const policyTypeOptions: Array<{ value: EventRegistrationPolicyType; label: string }> = [
  { value: 'required_checkbox', label: 'Required checkbox' },
  { value: 'yes_no', label: 'Yes/No' },
  { value: 'info_only', label: 'Info only' }
];

const inputCls = 'w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100';

function emptyField(): EventRegistrationFieldDefinition {
  return {
    id: createBuilderId('field'),
    type: 'short_text',
    label: 'New Field',
    required: false,
    hidden: false,
    helpText: '',
    placeholder: '',
    options: []
  };
}

function emptySection(): EventRegistrationSectionDefinition {
  return {
    id: createBuilderId('section'),
    title: 'New Section',
    description: '',
    type: 'single',
    hidden: false,
    fields: [emptyField()]
  };
}

function emptyPolicy(): EventRegistrationPolicyDefinition {
  return {
    id: createBuilderId('policy'),
    title: 'New Policy',
    body: '',
    type: 'required_checkbox',
    required: true,
    label: 'I acknowledge this policy.'
  };
}

function reorderItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= items.length) return items;
  const copy = [...items];
  const [moved] = copy.splice(index, 1);
  copy.splice(nextIndex, 0, moved);
  return copy;
}

export default function EventRegistrationFormBuilderModal({ open, performance, performanceOptions, onClose }: Props) {
  const [state, setState] = useState<BuilderState | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [preview, setPreview] = useState(false);
  const [duplicateSourcePerformanceId, setDuplicateSourcePerformanceId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const duplicateOptions = useMemo(
    () => performanceOptions.filter((option) => option.id !== performance?.id),
    [performance?.id, performanceOptions]
  );

  useEffect(() => {
    if (!open || !performance?.id) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setNotice(null);

    void adminFetch<EventRegistrationAdminFormResponse>(`/api/admin/performances/${performance.id}/registration-form`)
      .then((response) => {
        if (cancelled) return;
        const source = response.form;
        const nextState: BuilderState = source
          ? {
              id: source.id,
              status: source.status,
              formName: source.formName,
              internalDescription: source.internalDescription || '',
              settings: source.settings,
              definition: source.definition,
              publishedVersionId: source.publishedVersion?.id,
              publishedVersionNumber: source.publishedVersion?.versionNumber,
              publishedAt: source.publishedVersion?.publishedAt
            }
          : {
              status: 'DRAFT',
              formName: response.defaults.formName,
              internalDescription: response.defaults.internalDescription || '',
              settings: response.defaults.settings,
              definition: response.defaults.definition,
              publishedVersionId: undefined,
              publishedVersionNumber: undefined,
              publishedAt: undefined
            };

        setState(nextState);
        setDuplicateSourcePerformanceId((current) =>
          current && current !== performance.id ? current : duplicateOptions[0]?.id || ''
        );
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load form builder.');
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [duplicateOptions, open, performance?.id]);

  useEffect(() => {
    if (!open) {
      setState(null);
      setError(null);
      setNotice(null);
      setPreview(false);
    }
  }, [open]);

  if (!open || !performance) return null;

  const updateState = (updater: (current: BuilderState) => BuilderState) => {
    setState((current) => (current ? updater(current) : current));
  };

  const updateSection = (sectionIndex: number, updater: (section: EventRegistrationSectionDefinition) => EventRegistrationSectionDefinition) => {
    updateState((current) => ({
      ...current,
      definition: {
        ...current.definition,
        sections: current.definition.sections.map((section, index) => (index === sectionIndex ? updater(section) : section))
      }
    }));
  };

  const updateField = (
    sectionIndex: number,
    fieldIndex: number,
    updater: (field: EventRegistrationFieldDefinition) => EventRegistrationFieldDefinition
  ) => {
    updateSection(sectionIndex, (section) => ({
      ...section,
      fields: section.fields.map((field, index) => (index === fieldIndex ? updater(field) : field))
    }));
  };

  const updatePolicy = (policyIndex: number, updater: (policy: EventRegistrationPolicyDefinition) => EventRegistrationPolicyDefinition) => {
    updateState((current) => ({
      ...current,
      definition: {
        ...current.definition,
        policies: current.definition.policies.map((policy, index) => (index === policyIndex ? updater(policy) : policy))
      }
    }));
  };

  const saveDraft = async () => {
    if (!state) return;
    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const saved = await adminFetch<{
        id: string;
        status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
        formName: string;
        internalDescription?: string | null;
        settings: EventRegistrationSettings;
        definition: EventRegistrationDefinition;
        publishedVersion?: {
          id: string;
          versionNumber: number;
          publishedAt: string;
        } | null;
      }>(`/api/admin/performances/${performance.id}/registration-form/draft`, {
        method: 'PUT',
        body: JSON.stringify({
          formName: state.formName,
          internalDescription: state.internalDescription,
          settings: state.settings,
          definition: state.definition
        })
      });

      setState((current) =>
        current
          ? {
              ...current,
              id: saved.id,
              status: saved.status,
              formName: saved.formName,
              internalDescription: saved.internalDescription || '',
              settings: saved.settings,
              definition: saved.definition,
              publishedVersionId: saved.publishedVersion?.id,
              publishedVersionNumber: saved.publishedVersion?.versionNumber,
              publishedAt: saved.publishedVersion?.publishedAt
            }
          : current
      );
      setNotice('Draft saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save draft.');
    } finally {
      setSaving(false);
    }
  };

  const publishForm = async () => {
    if (!state) return;
    setPublishing(true);
    setError(null);
    setNotice(null);

    try {
      const published = await adminFetch<{
        id: string;
        status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
        formName: string;
        internalDescription?: string | null;
        settings: EventRegistrationSettings;
        definition: EventRegistrationDefinition;
        publishedVersion?: {
          id: string;
          versionNumber: number;
          publishedAt: string;
        } | null;
      }>(`/api/admin/performances/${performance.id}/registration-form/publish`, {
        method: 'POST',
        body: JSON.stringify({})
      });

      setState((current) =>
        current
          ? {
              ...current,
              id: published.id,
              status: published.status,
              formName: published.formName,
              internalDescription: published.internalDescription || '',
              settings: published.settings,
              definition: published.definition,
              publishedVersionId: published.publishedVersion?.id,
              publishedVersionNumber: published.publishedVersion?.versionNumber,
              publishedAt: published.publishedVersion?.publishedAt
            }
          : current
      );
      setNotice('Form published. Live checkout now uses this version.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to publish form.');
    } finally {
      setPublishing(false);
    }
  };

  const archiveForm = async () => {
    if (!state?.id) return;
    const confirmed = window.confirm('Archive this registration form? It will stop showing in checkout.');
    if (!confirmed) return;

    setArchiving(true);
    setError(null);
    setNotice(null);

    try {
      const archived = await adminFetch<{
        id: string;
        status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
        formName: string;
        internalDescription?: string | null;
        settings: EventRegistrationSettings;
        definition: EventRegistrationDefinition;
        publishedVersion?: {
          id: string;
          versionNumber: number;
          publishedAt: string;
        } | null;
      }>(`/api/admin/performances/${performance.id}/registration-form/archive`, {
        method: 'POST',
        body: JSON.stringify({})
      });

      setState((current) =>
        current
          ? {
              ...current,
              status: archived.status,
              settings: archived.settings,
              publishedVersionId: archived.publishedVersion?.id,
              publishedVersionNumber: archived.publishedVersion?.versionNumber,
              publishedAt: archived.publishedVersion?.publishedAt
            }
          : current
      );
      setNotice('Form archived.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to archive form.');
    } finally {
      setArchiving(false);
    }
  };

  const duplicateFromOtherEvent = async () => {
    if (!duplicateSourcePerformanceId) {
      setError('Choose a source event first.');
      return;
    }

    setDuplicating(true);
    setError(null);
    setNotice(null);

    try {
      const duplicated = await adminFetch<{
        id: string;
        status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
        formName: string;
        internalDescription?: string | null;
        settings: EventRegistrationSettings;
        definition: EventRegistrationDefinition;
        publishedVersion?: {
          id: string;
          versionNumber: number;
          publishedAt: string;
        } | null;
      }>(`/api/admin/performances/${performance.id}/registration-form/duplicate-from`, {
        method: 'POST',
        body: JSON.stringify({ sourcePerformanceId: duplicateSourcePerformanceId })
      });

      setState((current) =>
        current
          ? {
              ...current,
              id: duplicated.id,
              status: duplicated.status,
              formName: duplicated.formName,
              internalDescription: duplicated.internalDescription || '',
              settings: duplicated.settings,
              definition: duplicated.definition,
              publishedVersionId: duplicated.publishedVersion?.id,
              publishedVersionNumber: duplicated.publishedVersion?.versionNumber,
              publishedAt: duplicated.publishedVersion?.publishedAt
            }
          : current
      );
      setNotice('Draft duplicated from selected event.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to duplicate form.');
    } finally {
      setDuplicating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/45 p-3 sm:p-5" onClick={onClose}>
      <div
        className="max-h-[95vh] w-full max-w-6xl overflow-y-auto rounded-2xl border border-stone-200 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 z-20 border-b border-stone-200 bg-white px-4 py-3 sm:px-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-red-700">Event Form Builder</p>
              <h2 className="text-lg font-bold text-stone-900">{performance.title}</h2>
              <p className="text-xs text-stone-500">
                {performance.isFundraiser ? 'Fundraising event' : 'Standard event'}
                {state?.publishedVersionNumber
                  ? ` • Published v${state.publishedVersionNumber}${state.publishedAt ? ` on ${new Date(state.publishedAt).toLocaleString()}` : ''}`
                  : ' • No published version yet'}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-stone-300 bg-white p-2 text-stone-600 hover:bg-stone-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="space-y-4 px-4 py-4 sm:px-6 sm:py-5">
          {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
          {notice ? <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</div> : null}

          {loading || !state ? (
            <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-10 text-center text-sm text-stone-500">Loading form builder...</div>
          ) : (
            <>
              <div className="grid gap-3 rounded-xl border border-stone-200 bg-stone-50 p-4 md:grid-cols-3">
                <label className="block md:col-span-2">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-stone-600">Form Name</span>
                  <input
                    className={inputCls}
                    value={state.formName}
                    onChange={(event) => updateState((current) => ({ ...current, formName: event.target.value }))}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-stone-600">Status</span>
                  <div className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-800">
                    {state.status}
                  </div>
                </label>
                <label className="block md:col-span-3">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-stone-600">Internal Description</span>
                  <textarea
                    rows={2}
                    className={inputCls}
                    value={state.internalDescription}
                    onChange={(event) => updateState((current) => ({ ...current, internalDescription: event.target.value }))}
                  />
                </label>

                <div className="md:col-span-3 grid gap-3 rounded-lg border border-stone-300 bg-white p-3 md:grid-cols-4">
                  <label className="flex items-center gap-2 text-sm text-stone-700">
                    <input
                      type="checkbox"
                      checked={state.settings.enabled}
                      onChange={(event) =>
                        updateState((current) => ({
                          ...current,
                          settings: { ...current.settings, enabled: event.target.checked }
                        }))
                      }
                    />
                    Form enabled
                  </label>
                  <label className="flex items-center gap-2 text-sm text-stone-700">
                    <input
                      type="checkbox"
                      checked={state.settings.requireSignature}
                      onChange={(event) =>
                        updateState((current) => ({
                          ...current,
                          settings: { ...current.settings, requireSignature: event.target.checked }
                        }))
                      }
                    />
                    Require signature
                  </label>
                  <label className="flex items-center gap-2 text-sm text-stone-700">
                    <input
                      type="checkbox"
                      checked={state.settings.requireAcknowledgments}
                      onChange={(event) =>
                        updateState((current) => ({
                          ...current,
                          settings: { ...current.settings, requireAcknowledgments: event.target.checked }
                        }))
                      }
                    />
                    Require parent acknowledgments
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">Child Count Source</span>
                    <select
                      className={inputCls}
                      value={state.settings.childCountSource}
                      onChange={(event) =>
                        updateState((current) => ({
                          ...current,
                          settings: {
                            ...current.settings,
                            childCountSource: event.target.value === 'field_value' ? 'field_value' : 'ticket_quantity'
                          }
                        }))
                      }
                    >
                      <option value="ticket_quantity">Ticket quantity</option>
                      <option value="field_value">Field value</option>
                    </select>
                  </label>

                  {state.settings.childCountSource === 'field_value' ? (
                    <>
                      <label className="block text-sm md:col-span-2">
                        <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">Child Count Section ID</span>
                        <input
                          className={inputCls}
                          value={state.settings.childCountSectionId || ''}
                          onChange={(event) =>
                            updateState((current) => ({
                              ...current,
                              settings: { ...current.settings, childCountSectionId: event.target.value }
                            }))
                          }
                        />
                      </label>
                      <label className="block text-sm md:col-span-2">
                        <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">Child Count Field ID</span>
                        <input
                          className={inputCls}
                          value={state.settings.childCountFieldId || ''}
                          onChange={(event) =>
                            updateState((current) => ({
                              ...current,
                              settings: { ...current.settings, childCountFieldId: event.target.value }
                            }))
                          }
                        />
                      </label>
                    </>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-2 rounded-xl border border-stone-200 bg-stone-50 p-4 md:grid-cols-[1fr_auto_auto]">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-stone-600">Duplicate From Another Event</span>
                  <select
                    className={inputCls}
                    value={duplicateSourcePerformanceId}
                    onChange={(event) => setDuplicateSourcePerformanceId(event.target.value)}
                  >
                    {duplicateOptions.length === 0 ? <option value="">No other events</option> : null}
                    {duplicateOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.title}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => void duplicateFromOtherEvent()}
                  disabled={duplicating || !duplicateSourcePerformanceId}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Copy className="h-4 w-4" />
                  {duplicating ? 'Duplicating...' : 'Duplicate'}
                </button>
                <button
                  type="button"
                  onClick={() => setPreview((current) => !current)}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-100"
                >
                  <Eye className="h-4 w-4" />
                  {preview ? 'Edit Mode' : 'Preview Mode'}
                </button>
              </div>

              {preview ? (
                <div className="rounded-xl border border-stone-200 bg-white p-4">
                  <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-stone-700">Preview</h3>
                  <div className="mt-3 space-y-4">
                    {state.definition.sections.map((section) => (
                      <div key={section.id} className="rounded-lg border border-stone-200 bg-stone-50 p-3">
                        <p className="text-sm font-semibold text-stone-900">{section.title}</p>
                        <p className="text-xs text-stone-500">{section.type === 'repeating_child' ? 'Repeats per child' : 'Single per order'}</p>
                        <ul className="mt-2 space-y-1 text-sm text-stone-700">
                          {section.fields.map((field) => (
                            <li key={field.id}>
                              {field.label} ({field.type}){field.required ? ' *' : ''}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                    <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
                      <p className="text-sm font-semibold text-stone-900">Policies</p>
                      <ul className="mt-2 space-y-1 text-sm text-stone-700">
                        {state.definition.policies.map((policy) => (
                          <li key={policy.id}>
                            {policy.title} ({policy.type})
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-stone-700">Sections</h3>
                      <button
                        type="button"
                        onClick={() =>
                          updateState((current) => ({
                            ...current,
                            definition: {
                              ...current.definition,
                              sections: [...current.definition.sections, emptySection()]
                            }
                          }))
                        }
                        className="inline-flex items-center gap-1 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold text-stone-700 hover:bg-stone-100"
                      >
                        <Plus className="h-3.5 w-3.5" /> Add Section
                      </button>
                    </div>

                    {state.definition.sections.map((section, sectionIndex) => (
                      <div key={section.id} className="rounded-xl border border-stone-200 bg-white p-4">
                        <div className="grid gap-3 md:grid-cols-6">
                          <label className="block md:col-span-2">
                            <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">Section ID</span>
                            <input
                              className={inputCls}
                              value={section.id}
                              onChange={(event) => updateSection(sectionIndex, (current) => ({ ...current, id: event.target.value }))}
                            />
                          </label>
                          <label className="block md:col-span-2">
                            <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">Title</span>
                            <input
                              className={inputCls}
                              value={section.title}
                              onChange={(event) => updateSection(sectionIndex, (current) => ({ ...current, title: event.target.value }))}
                            />
                          </label>
                          <label className="block md:col-span-2">
                            <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">Type</span>
                            <select
                              className={inputCls}
                              value={section.type}
                              onChange={(event) =>
                                updateSection(sectionIndex, (current) => ({
                                  ...current,
                                  type: event.target.value === 'repeating_child' ? 'repeating_child' : 'single'
                                }))
                              }
                            >
                              {sectionTypeOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="block md:col-span-5">
                            <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">Description</span>
                            <input
                              className={inputCls}
                              value={section.description || ''}
                              onChange={(event) => updateSection(sectionIndex, (current) => ({ ...current, description: event.target.value }))}
                            />
                          </label>
                          <div className="flex items-center justify-end gap-2">
                            <label className="inline-flex items-center gap-2 rounded-lg border border-stone-300 bg-stone-50 px-2.5 py-2 text-xs font-semibold text-stone-700">
                              <input
                                type="checkbox"
                                checked={Boolean(section.hidden)}
                                onChange={(event) => updateSection(sectionIndex, (current) => ({ ...current, hidden: event.target.checked }))}
                              />
                              Hidden
                            </label>
                          </div>
                        </div>

                        <div className="mt-3 flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              updateState((current) => ({
                                ...current,
                                definition: {
                                  ...current.definition,
                                  sections: reorderItem(current.definition.sections, sectionIndex, -1)
                                }
                              }))
                            }
                            className="rounded-lg border border-stone-300 bg-white p-2 text-stone-700 hover:bg-stone-100"
                            disabled={sectionIndex === 0}
                          >
                            <ArrowUp className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              updateState((current) => ({
                                ...current,
                                definition: {
                                  ...current.definition,
                                  sections: reorderItem(current.definition.sections, sectionIndex, 1)
                                }
                              }))
                            }
                            className="rounded-lg border border-stone-300 bg-white p-2 text-stone-700 hover:bg-stone-100"
                            disabled={sectionIndex === state.definition.sections.length - 1}
                          >
                            <ArrowDown className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              updateState((current) => ({
                                ...current,
                                definition: {
                                  ...current.definition,
                                  sections: current.definition.sections.filter((_, index) => index !== sectionIndex)
                                }
                              }))
                            }
                            className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100"
                          >
                            Remove Section
                          </button>
                        </div>

                        <div className="mt-4 space-y-3 rounded-lg border border-stone-200 bg-stone-50 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-bold uppercase tracking-[0.12em] text-stone-600">Fields</p>
                            <button
                              type="button"
                              onClick={() =>
                                updateSection(sectionIndex, (current) => ({
                                  ...current,
                                  fields: [...current.fields, emptyField()]
                                }))
                              }
                              className="inline-flex items-center gap-1 rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-stone-700 hover:bg-stone-100"
                            >
                              <Plus className="h-3.5 w-3.5" /> Add Field
                            </button>
                          </div>

                          {section.fields.map((field, fieldIndex) => {
                            const fieldIds = section.fields.map((item) => item.id).filter((id) => id && id !== field.id);
                            return (
                              <div key={`${field.id}-${fieldIndex}`} className="rounded-lg border border-stone-200 bg-white p-3">
                                <div className="grid gap-3 md:grid-cols-6">
                                  <label className="block md:col-span-2">
                                    <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">Field ID</span>
                                    <input
                                      className={inputCls}
                                      value={field.id}
                                      onChange={(event) => updateField(sectionIndex, fieldIndex, (current) => ({ ...current, id: event.target.value }))}
                                    />
                                  </label>
                                  <label className="block md:col-span-2">
                                    <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">Label</span>
                                    <input
                                      className={inputCls}
                                      value={field.label}
                                      onChange={(event) => updateField(sectionIndex, fieldIndex, (current) => ({ ...current, label: event.target.value }))}
                                    />
                                  </label>
                                  <label className="block md:col-span-2">
                                    <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">Type</span>
                                    <select
                                      className={inputCls}
                                      value={field.type}
                                      onChange={(event) =>
                                        updateField(sectionIndex, fieldIndex, (current) => ({
                                          ...current,
                                          type: event.target.value as EventRegistrationFieldType,
                                          options:
                                            event.target.value === 'dropdown' || event.target.value === 'multi_select'
                                              ? current.options || []
                                              : event.target.value === 'radio_yes_no'
                                                ? ['yes', 'no']
                                                : []
                                        }))
                                      }
                                    >
                                      {fieldTypeOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                          {option.label}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                  <label className="block md:col-span-3">
                                    <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">Help Text</span>
                                    <input
                                      className={inputCls}
                                      value={field.helpText || ''}
                                      onChange={(event) => updateField(sectionIndex, fieldIndex, (current) => ({ ...current, helpText: event.target.value }))}
                                    />
                                  </label>
                                  <label className="block md:col-span-3">
                                    <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">Placeholder</span>
                                    <input
                                      className={inputCls}
                                      value={field.placeholder || ''}
                                      onChange={(event) => updateField(sectionIndex, fieldIndex, (current) => ({ ...current, placeholder: event.target.value }))}
                                    />
                                  </label>

                                  {(field.type === 'dropdown' || field.type === 'multi_select') && (
                                    <label className="block md:col-span-6">
                                      <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">Options (one per line)</span>
                                      <textarea
                                        rows={3}
                                        className={inputCls}
                                        value={(field.options || []).join('\n')}
                                        onChange={(event) =>
                                          updateField(sectionIndex, fieldIndex, (current) => ({
                                            ...current,
                                            options: normalizeOptions(event.target.value)
                                          }))
                                        }
                                      />
                                    </label>
                                  )}

                                  <label className="inline-flex items-center gap-2 rounded-lg border border-stone-300 bg-stone-50 px-2.5 py-2 text-xs font-semibold text-stone-700">
                                    <input
                                      type="checkbox"
                                      checked={Boolean(field.required)}
                                      onChange={(event) => updateField(sectionIndex, fieldIndex, (current) => ({ ...current, required: event.target.checked }))}
                                    />
                                    Required
                                  </label>
                                  <label className="inline-flex items-center gap-2 rounded-lg border border-stone-300 bg-stone-50 px-2.5 py-2 text-xs font-semibold text-stone-700">
                                    <input
                                      type="checkbox"
                                      checked={Boolean(field.hidden)}
                                      onChange={(event) => updateField(sectionIndex, fieldIndex, (current) => ({ ...current, hidden: event.target.checked }))}
                                    />
                                    Hidden
                                  </label>

                                  <label className="block md:col-span-2">
                                    <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">Show When Field</span>
                                    <select
                                      className={inputCls}
                                      value={field.showWhen?.fieldId || ''}
                                      onChange={(event) =>
                                        updateField(sectionIndex, fieldIndex, (current) => ({
                                          ...current,
                                          showWhen: event.target.value
                                            ? {
                                                fieldId: event.target.value,
                                                equals: current.showWhen?.equals ?? 'yes'
                                              }
                                            : undefined
                                        }))
                                      }
                                    >
                                      <option value="">Always visible</option>
                                      {fieldIds.map((fieldId) => (
                                        <option key={fieldId} value={fieldId}>
                                          {fieldId}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                  <label className="block md:col-span-2">
                                    <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">Show When Equals</span>
                                    <input
                                      className={inputCls}
                                      value={field.showWhen ? String(field.showWhen.equals) : ''}
                                      onChange={(event) =>
                                        updateField(sectionIndex, fieldIndex, (current) => ({
                                          ...current,
                                          showWhen: current.showWhen
                                            ? {
                                                ...current.showWhen,
                                                equals: event.target.value
                                              }
                                            : undefined
                                        }))
                                      }
                                      disabled={!field.showWhen}
                                    />
                                  </label>
                                  <div className="md:col-span-2 flex items-end justify-end gap-2">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        updateSection(sectionIndex, (current) => ({
                                          ...current,
                                          fields: reorderItem(current.fields, fieldIndex, -1)
                                        }))
                                      }
                                      disabled={fieldIndex === 0}
                                      className="rounded-lg border border-stone-300 bg-white p-2 text-stone-700 hover:bg-stone-100 disabled:opacity-40"
                                    >
                                      <ArrowUp className="h-4 w-4" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        updateSection(sectionIndex, (current) => ({
                                          ...current,
                                          fields: reorderItem(current.fields, fieldIndex, 1)
                                        }))
                                      }
                                      disabled={fieldIndex === section.fields.length - 1}
                                      className="rounded-lg border border-stone-300 bg-white p-2 text-stone-700 hover:bg-stone-100 disabled:opacity-40"
                                    >
                                      <ArrowDown className="h-4 w-4" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        updateSection(sectionIndex, (current) => ({
                                          ...current,
                                          fields: current.fields.filter((_, index) => index !== fieldIndex)
                                        }))
                                      }
                                      className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100"
                                    >
                                      Remove
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-3 rounded-xl border border-stone-200 bg-white p-4">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-stone-700">Policies</h3>
                      <button
                        type="button"
                        onClick={() =>
                          updateState((current) => ({
                            ...current,
                            definition: {
                              ...current.definition,
                              policies: [...current.definition.policies, emptyPolicy()]
                            }
                          }))
                        }
                        className="inline-flex items-center gap-1 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold text-stone-700 hover:bg-stone-100"
                      >
                        <Plus className="h-3.5 w-3.5" /> Add Policy
                      </button>
                    </div>

                    {state.definition.policies.map((policy, policyIndex) => (
                      <div key={policy.id} className="rounded-lg border border-stone-200 bg-stone-50 p-3">
                        <div className="grid gap-3 md:grid-cols-6">
                          <label className="block md:col-span-2">
                            <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">Policy ID</span>
                            <input
                              className={inputCls}
                              value={policy.id}
                              onChange={(event) => updatePolicy(policyIndex, (current) => ({ ...current, id: event.target.value }))}
                            />
                          </label>
                          <label className="block md:col-span-2">
                            <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">Title</span>
                            <input
                              className={inputCls}
                              value={policy.title}
                              onChange={(event) => updatePolicy(policyIndex, (current) => ({ ...current, title: event.target.value }))}
                            />
                          </label>
                          <label className="block md:col-span-2">
                            <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">Type</span>
                            <select
                              className={inputCls}
                              value={policy.type}
                              onChange={(event) => updatePolicy(policyIndex, (current) => ({ ...current, type: event.target.value as EventRegistrationPolicyType }))}
                            >
                              {policyTypeOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="block md:col-span-4">
                            <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">Body</span>
                            <textarea
                              rows={2}
                              className={inputCls}
                              value={policy.body || ''}
                              onChange={(event) => updatePolicy(policyIndex, (current) => ({ ...current, body: event.target.value }))}
                            />
                          </label>
                          <label className="block md:col-span-2">
                            <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">Label</span>
                            <input
                              className={inputCls}
                              value={policy.label || ''}
                              onChange={(event) => updatePolicy(policyIndex, (current) => ({ ...current, label: event.target.value }))}
                            />
                          </label>

                          <label className="inline-flex items-center gap-2 rounded-lg border border-stone-300 bg-white px-2.5 py-2 text-xs font-semibold text-stone-700">
                            <input
                              type="checkbox"
                              checked={policy.required !== false}
                              onChange={(event) => updatePolicy(policyIndex, (current) => ({ ...current, required: event.target.checked }))}
                            />
                            Required
                          </label>

                          <div className="md:col-span-5 flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                updateState((current) => ({
                                  ...current,
                                  definition: {
                                    ...current.definition,
                                    policies: reorderItem(current.definition.policies, policyIndex, -1)
                                  }
                                }))
                              }
                              disabled={policyIndex === 0}
                              className="rounded-lg border border-stone-300 bg-white p-2 text-stone-700 hover:bg-stone-100 disabled:opacity-40"
                            >
                              <ArrowUp className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                updateState((current) => ({
                                  ...current,
                                  definition: {
                                    ...current.definition,
                                    policies: reorderItem(current.definition.policies, policyIndex, 1)
                                  }
                                }))
                              }
                              disabled={policyIndex === state.definition.policies.length - 1}
                              className="rounded-lg border border-stone-300 bg-white p-2 text-stone-700 hover:bg-stone-100 disabled:opacity-40"
                            >
                              <ArrowDown className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                updateState((current) => ({
                                  ...current,
                                  definition: {
                                    ...current.definition,
                                    policies: current.definition.policies.filter((_, index) => index !== policyIndex)
                                  }
                                }))
                              }
                              className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100"
                            >
                              Remove Policy
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-xl border border-stone-200 bg-white p-4">
                    <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-stone-700">Signature</h3>
                    <div className="mt-3 grid gap-3 md:grid-cols-3">
                      <label className="inline-flex items-center gap-2 rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 text-sm text-stone-700">
                        <input
                          type="checkbox"
                          checked={Boolean(state.definition.signature?.enabled)}
                          onChange={(event) =>
                            updateState((current) => ({
                              ...current,
                              definition: {
                                ...current.definition,
                                signature: {
                                  ...current.definition.signature,
                                  enabled: event.target.checked
                                }
                              }
                            }))
                          }
                        />
                        Signature enabled
                      </label>
                      <label className="inline-flex items-center gap-2 rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 text-sm text-stone-700">
                        <input
                          type="checkbox"
                          checked={Boolean(state.definition.signature?.requireNameMatch)}
                          onChange={(event) =>
                            updateState((current) => ({
                              ...current,
                              definition: {
                                ...current.definition,
                                signature: {
                                  ...current.definition.signature,
                                  requireNameMatch: event.target.checked
                                }
                              }
                            }))
                          }
                        />
                        Require typed = printed
                      </label>
                    </div>
                    <label className="mt-3 block">
                      <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">Legal Text</span>
                      <textarea
                        rows={4}
                        className={inputCls}
                        value={state.definition.signature?.legalText || ''}
                        onChange={(event) =>
                          updateState((current) => ({
                            ...current,
                            definition: {
                              ...current.definition,
                              signature: {
                                ...current.definition.signature,
                                legalText: event.target.value
                              }
                            }
                          }))
                        }
                      />
                    </label>
                  </div>
                </>
              )}

              <div className="sticky bottom-0 z-20 flex flex-wrap items-center justify-end gap-2 border-t border-stone-200 bg-white px-1 py-3">
                <button
                  type="button"
                  onClick={() => void saveDraft()}
                  disabled={saving || loading || !state}
                  className="inline-flex items-center gap-2 rounded-lg border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Save className="h-4 w-4" />
                  {saving ? 'Saving...' : 'Save Draft'}
                </button>
                <button
                  type="button"
                  onClick={() => void publishForm()}
                  disabled={publishing || loading || !state}
                  className="inline-flex items-center gap-2 rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Upload className="h-4 w-4" />
                  {publishing ? 'Publishing...' : 'Publish Form'}
                </button>
                <button
                  type="button"
                  onClick={() => void archiveForm()}
                  disabled={archiving || loading || !state?.id}
                  className="inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Archive className="h-4 w-4" />
                  {archiving ? 'Archiving...' : 'Archive'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
