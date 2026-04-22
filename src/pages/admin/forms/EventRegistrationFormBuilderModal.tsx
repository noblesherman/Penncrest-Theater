/*
Handoff note for Mr. Smith:
- File: `src/pages/admin/forms/EventRegistrationFormBuilderModal.tsx`
- What this is: Admin form-management sub-panel.
- What it does: Handles form builder/editor UI logic used in the admin dashboard.
- Connections: Nested under admin pages; talks to admin form endpoints and shared form helpers.
- Main content type: Layout + state logic + admin-visible text.
- Safe edits here: Copy labels/help text and small UI layout changes.
- Be careful with: Payload shape changes, question IDs, and validation assumptions.
- Useful context: If form editing or publishing breaks, this layer is usually part of the chain.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Plus, ArrowUp, ArrowDown, Copy, Eye, Save, Archive, Upload, ChevronDown, ChevronRight, Grip } from 'lucide-react';
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

type PerformanceOption = { id: string; title: string; isFundraiser?: boolean };

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

type ActiveTab = 'sections' | 'policies' | 'signature' | 'settings';

const FIELD_TYPE_LABELS: Record<string, string> = {
  short_text: 'Short text',
  long_text: 'Long text',
  email: 'Email',
  phone: 'Phone',
  number: 'Number',
  date: 'Date',
  dropdown: 'Dropdown',
  multi_select: 'Multi-select',
  checkbox: 'Checkbox',
  radio_yes_no: 'Yes / No',
  repeatable_person_list: 'Person list',
  signature_typed: 'Typed signature'
};

const fieldTypeOptions: Array<{ value: EventRegistrationFieldType; label: string }> = Object.entries(FIELD_TYPE_LABELS).map(
  ([value, label]) => ({ value: value as EventRegistrationFieldType, label })
);

const sectionTypeOptions = [
  { value: 'single' as const, label: 'Once per order' },
  { value: 'repeating_child' as const, label: 'Once per child' }
];

const policyTypeOptions = [
  { value: 'required_checkbox' as const, label: 'Required checkbox' },
  { value: 'yes_no' as const, label: 'Yes / No' },
  { value: 'info_only' as const, label: 'Info only' }
];

const STATUS_COLORS = {
  DRAFT: 'bg-amber-50 text-amber-700 border-amber-200',
  PUBLISHED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  ARCHIVED: 'bg-stone-100 text-stone-500 border-stone-200'
};

// --- Shared input styles ---
const input = 'w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 placeholder-stone-400 outline-none transition focus:border-stone-400 focus:ring-2 focus:ring-stone-100';
const textarea = `${input} resize-none`;
const selectCls = `${input} cursor-pointer`;

// --- Helpers ---
function emptyField(): EventRegistrationFieldDefinition {
  return { id: createBuilderId('field'), type: 'short_text', label: 'Untitled field', required: false, hidden: false, helpText: '', placeholder: '', options: [] };
}
function emptySection(): EventRegistrationSectionDefinition {
  return { id: createBuilderId('section'), title: 'New section', description: '', type: 'single', hidden: false, fields: [emptyField()] };
}
function emptyPolicy(): EventRegistrationPolicyDefinition {
  return { id: createBuilderId('policy'), title: 'New policy', body: '', type: 'required_checkbox', required: true, label: 'I acknowledge this policy.' };
}
function reorderItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const next = index + direction;
  if (next < 0 || next >= items.length) return items;
  const copy = [...items];
  const [moved] = copy.splice(index, 1);
  copy.splice(next, 0, moved);
  return copy;
}

// --- Sub-components ---
function Label({ children }: { children: React.ReactNode }) {
  return <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest text-stone-400">{children}</span>;
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
        checked ? 'border-stone-800 bg-stone-800 text-white' : 'border-stone-200 bg-white text-stone-500 hover:border-stone-300'
      }`}
    >
      <span className={`h-2 w-2 rounded-full transition-colors ${checked ? 'bg-white' : 'bg-stone-300'}`} />
      {label}
    </button>
  );
}

function ReorderButtons({
  onUp, onDown, disabledUp, disabledDown
}: { onUp: () => void; onDown: () => void; disabledUp: boolean; disabledDown: boolean }) {
  return (
    <div className="flex gap-1">
      <button type="button" onClick={onUp} disabled={disabledUp} className="rounded p-1 text-stone-400 hover:text-stone-700 disabled:opacity-20 transition-opacity">
        <ArrowUp className="h-3.5 w-3.5" />
      </button>
      <button type="button" onClick={onDown} disabled={disabledDown} className="rounded p-1 text-stone-400 hover:text-stone-700 disabled:opacity-20 transition-opacity">
        <ArrowDown className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function RemoveButton({ onClick, label = 'Remove' }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-transparent px-2 py-1 text-xs font-medium text-stone-400 hover:border-red-200 hover:bg-red-50 hover:text-red-600 transition-colors"
    >
      {label}
    </button>
  );
}

function SectionCard({
  section, sectionIndex, totalSections, updateSection, updateField, onMoveUp, onMoveDown, onRemove
}: {
  section: EventRegistrationSectionDefinition;
  sectionIndex: number;
  totalSections: number;
  updateSection: (updater: (s: EventRegistrationSectionDefinition) => EventRegistrationSectionDefinition) => void;
  updateField: (fieldIndex: number, updater: (f: EventRegistrationFieldDefinition) => EventRegistrationFieldDefinition) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="rounded-xl border border-stone-200 bg-white overflow-hidden">
      {/* Section header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-stone-50 border-b border-stone-100">
        <Grip className="h-4 w-4 text-stone-300 shrink-0" />
        <button type="button" onClick={() => setCollapsed((c) => !c)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
          {collapsed ? <ChevronRight className="h-3.5 w-3.5 text-stone-400 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 text-stone-400 shrink-0" />}
          <span className="text-sm font-semibold text-stone-800 truncate">{section.title || 'Untitled section'}</span>
          <span className="shrink-0 rounded-full border border-stone-200 bg-white px-2 py-0.5 text-[10px] font-medium text-stone-500">
            {sectionTypeOptions.find((o) => o.value === section.type)?.label}
          </span>
          <span className="shrink-0 text-xs text-stone-400">{section.fields.length} field{section.fields.length !== 1 ? 's' : ''}</span>
        </button>
        <div className="flex items-center gap-1 shrink-0">
          {section.hidden && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-600">Hidden</span>}
          <ReorderButtons onUp={onMoveUp} onDown={onMoveDown} disabledUp={sectionIndex === 0} disabledDown={sectionIndex === totalSections - 1} />
          <RemoveButton onClick={onRemove} label="Delete" />
        </div>
      </div>

      {!collapsed && (
        <div className="p-4 space-y-4">
          {/* Section metadata */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Section title</Label>
              <input className={input} value={section.title} onChange={(e) => updateSection((s) => ({ ...s, title: e.target.value }))} />
            </div>
            <div>
              <Label>Type</Label>
              <select className={selectCls} value={section.type} onChange={(e) => updateSection((s) => ({ ...s, type: e.target.value as EventRegistrationSectionType }))}>
                {sectionTypeOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <Label>Description (optional)</Label>
              <input className={input} value={section.description || ''} placeholder="Shown to users above this section" onChange={(e) => updateSection((s) => ({ ...s, description: e.target.value }))} />
            </div>
            <div className="sm:col-span-2 flex items-center gap-2">
              <Toggle checked={Boolean(section.hidden)} onChange={(v) => updateSection((s) => ({ ...s, hidden: v }))} label="Hide from users" />
              <span className="text-xs text-stone-400 ml-1">Section ID: <code className="font-mono text-stone-500">{section.id}</code></span>
            </div>
          </div>

          {/* Fields */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-widest text-stone-400">Fields</span>
              <button
                type="button"
                onClick={() => updateSection((s) => ({ ...s, fields: [...s.fields, emptyField()] }))}
                className="inline-flex items-center gap-1 rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-600 hover:border-stone-300 hover:bg-stone-50 transition-colors"
              >
                <Plus className="h-3 w-3" /> Add field
              </button>
            </div>
            <div className="space-y-2">
              {section.fields.map((field, fieldIndex) => {
                const otherFieldIds = section.fields.map((f) => f.id).filter((id) => id && id !== field.id);
                return (
                  <FieldCard
                    key={`${field.id}-${fieldIndex}`}
                    field={field}
                    fieldIndex={fieldIndex}
                    totalFields={section.fields.length}
                    otherFieldIds={otherFieldIds}
                    onUpdate={(updater) => updateField(fieldIndex, updater)}
                    onMoveUp={() => updateSection((s) => ({ ...s, fields: reorderItem(s.fields, fieldIndex, -1) }))}
                    onMoveDown={() => updateSection((s) => ({ ...s, fields: reorderItem(s.fields, fieldIndex, 1) }))}
                    onRemove={() => updateSection((s) => ({ ...s, fields: s.fields.filter((_, i) => i !== fieldIndex) }))}
                  />
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FieldCard({
  field, fieldIndex, totalFields, otherFieldIds, onUpdate, onMoveUp, onMoveDown, onRemove
}: {
  field: EventRegistrationFieldDefinition;
  fieldIndex: number;
  totalFields: number;
  otherFieldIds: string[];
  onUpdate: (updater: (f: EventRegistrationFieldDefinition) => EventRegistrationFieldDefinition) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasOptions = field.type === 'dropdown' || field.type === 'multi_select';

  return (
    <div className="rounded-lg border border-stone-100 bg-stone-50 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button type="button" onClick={() => setExpanded((e) => !e)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
          {expanded ? <ChevronDown className="h-3 w-3 text-stone-400 shrink-0" /> : <ChevronRight className="h-3 w-3 text-stone-400 shrink-0" />}
          <span className="text-sm text-stone-700 truncate font-medium">{field.label || 'Untitled field'}</span>
          <span className="shrink-0 text-xs text-stone-400 bg-white border border-stone-200 rounded px-1.5 py-0.5">{FIELD_TYPE_LABELS[field.type] ?? field.type}</span>
          {field.required && <span className="shrink-0 text-[10px] font-semibold text-red-500">Required</span>}
          {field.hidden && <span className="shrink-0 text-[10px] font-semibold text-amber-500">Hidden</span>}
        </button>
        <div className="flex items-center gap-1 shrink-0">
          <ReorderButtons onUp={onMoveUp} onDown={onMoveDown} disabledUp={fieldIndex === 0} disabledDown={fieldIndex === totalFields - 1} />
          <RemoveButton onClick={onRemove} />
        </div>
      </div>

      {expanded && (
        <div className="border-t border-stone-100 bg-white p-3 grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Label</Label>
            <input className={input} value={field.label} onChange={(e) => onUpdate((f) => ({ ...f, label: e.target.value }))} />
          </div>
          <div>
            <Label>Field type</Label>
            <select
              className={selectCls}
              value={field.type}
              onChange={(e) =>
                onUpdate((f) => ({
                  ...f,
                  type: e.target.value as EventRegistrationFieldType,
                  options: ['dropdown', 'multi_select'].includes(e.target.value) ? f.options || [] : e.target.value === 'radio_yes_no' ? ['yes', 'no'] : []
                }))
              }
            >
              {fieldTypeOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <Label>Placeholder</Label>
            <input className={input} value={field.placeholder || ''} placeholder="Optional" onChange={(e) => onUpdate((f) => ({ ...f, placeholder: e.target.value }))} />
          </div>
          <div>
            <Label>Help text</Label>
            <input className={input} value={field.helpText || ''} placeholder="Optional hint shown to users" onChange={(e) => onUpdate((f) => ({ ...f, helpText: e.target.value }))} />
          </div>

          {hasOptions && (
            <div className="sm:col-span-2">
              <Label>Options (one per line)</Label>
              <textarea className={textarea} rows={3} value={(field.options || []).join('\n')} onChange={(e) => onUpdate((f) => ({ ...f, options: normalizeOptions(e.target.value) }))} />
            </div>
          )}

          <div className="sm:col-span-2 flex flex-wrap gap-2">
            <Toggle checked={Boolean(field.required)} onChange={(v) => onUpdate((f) => ({ ...f, required: v }))} label="Required" />
            <Toggle checked={Boolean(field.hidden)} onChange={(v) => onUpdate((f) => ({ ...f, hidden: v }))} label="Hidden" />
          </div>

          <div>
            <Label>Show when field equals</Label>
            <select
              className={selectCls}
              value={field.showWhen?.fieldId || ''}
              onChange={(e) =>
                onUpdate((f) => ({
                  ...f,
                  showWhen: e.target.value ? { fieldId: e.target.value, equals: f.showWhen?.equals ?? 'yes' } : undefined
                }))
              }
            >
              <option value="">Always visible</option>
              {otherFieldIds.map((id) => <option key={id} value={id}>{id}</option>)}
            </select>
          </div>
          {field.showWhen && (
            <div>
              <Label>Equals value</Label>
              <input className={input} value={String(field.showWhen.equals)} onChange={(e) => onUpdate((f) => ({ ...f, showWhen: f.showWhen ? { ...f.showWhen, equals: e.target.value } : undefined }))} />
            </div>
          )}

          <div className="sm:col-span-2 pt-1">
            <p className="text-[10px] text-stone-400">Field ID: <code className="font-mono">{field.id}</code></p>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Main component ---
export default function EventRegistrationFormBuilderModal({ open, performance, performanceOptions, onClose }: Props) {
  const [state, setState] = useState<BuilderState | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>('sections');
  const [duplicateSourceId, setDuplicateSourceId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const duplicateOptions = useMemo(
    () => performanceOptions.filter((o) => o.id !== performance?.id),
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
        setState(source
          ? { id: source.id, status: source.status, formName: source.formName, internalDescription: source.internalDescription || '', settings: source.settings, definition: source.definition, publishedVersionId: source.publishedVersion?.id, publishedVersionNumber: source.publishedVersion?.versionNumber, publishedAt: source.publishedVersion?.publishedAt }
          : { status: 'DRAFT', formName: response.defaults.formName, internalDescription: response.defaults.internalDescription || '', settings: response.defaults.settings, definition: response.defaults.definition }
        );
        setDuplicateSourceId(duplicateOptions[0]?.id || '');
      })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to load.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, performance?.id, duplicateOptions]);

  useEffect(() => {
    if (!open) { setState(null); setError(null); setNotice(null); setActiveTab('sections'); }
  }, [open]);

  if (!open || !performance) return null;

  const updateState = (updater: (s: BuilderState) => BuilderState) => setState((c) => c ? updater(c) : c);
  const updateSection = (si: number, updater: (s: EventRegistrationSectionDefinition) => EventRegistrationSectionDefinition) =>
    updateState((c) => ({ ...c, definition: { ...c.definition, sections: c.definition.sections.map((s, i) => i === si ? updater(s) : s) } }));
  const updateField = (si: number, fi: number, updater: (f: EventRegistrationFieldDefinition) => EventRegistrationFieldDefinition) =>
    updateSection(si, (s) => ({ ...s, fields: s.fields.map((f, i) => i === fi ? updater(f) : f) }));
  const updatePolicy = (pi: number, updater: (p: EventRegistrationPolicyDefinition) => EventRegistrationPolicyDefinition) =>
    updateState((c) => ({ ...c, definition: { ...c.definition, policies: c.definition.policies.map((p, i) => i === pi ? updater(p) : p) } }));

  const handleSave = async (fn: () => Promise<void>) => { setError(null); setNotice(null); try { await fn(); } catch (err) { setError(err instanceof Error ? err.message : 'Something went wrong.'); } };

  const saveDraft = () => handleSave(async () => {
    if (!state) return;
    setSaving(true);
    try {
      const saved = await adminFetch<any>(`/api/admin/performances/${performance.id}/registration-form/draft`, { method: 'PUT', body: JSON.stringify({ formName: state.formName, internalDescription: state.internalDescription, settings: state.settings, definition: state.definition }) });
      setState((c) => c ? { ...c, id: saved.id, status: saved.status, formName: saved.formName, internalDescription: saved.internalDescription || '', settings: saved.settings, definition: saved.definition, publishedVersionId: saved.publishedVersion?.id, publishedVersionNumber: saved.publishedVersion?.versionNumber, publishedAt: saved.publishedVersion?.publishedAt } : c);
      setNotice('Draft saved.');
    } finally { setSaving(false); }
  });

  const publishForm = () => handleSave(async () => {
    if (!state) return;
    setPublishing(true);
    try {
      const published = await adminFetch<any>(`/api/admin/performances/${performance.id}/registration-form/publish`, { method: 'POST', body: JSON.stringify({}) });
      setState((c) => c ? { ...c, id: published.id, status: published.status, formName: published.formName, internalDescription: published.internalDescription || '', settings: published.settings, definition: published.definition, publishedVersionId: published.publishedVersion?.id, publishedVersionNumber: published.publishedVersion?.versionNumber, publishedAt: published.publishedVersion?.publishedAt } : c);
      setNotice('Form published — live checkout is now updated.');
    } finally { setPublishing(false); }
  });

  const archiveForm = () => handleSave(async () => {
    if (!state?.id) return;
    if (!window.confirm('Archive this form? It will stop showing in checkout.')) return;
    setArchiving(true);
    try {
      const archived = await adminFetch<any>(`/api/admin/performances/${performance.id}/registration-form/archive`, { method: 'POST', body: JSON.stringify({}) });
      setState((c) => c ? { ...c, status: archived.status, publishedVersionId: archived.publishedVersion?.id, publishedVersionNumber: archived.publishedVersion?.versionNumber, publishedAt: archived.publishedVersion?.publishedAt } : c);
      setNotice('Form archived.');
    } finally { setArchiving(false); }
  });

  const duplicateFrom = () => handleSave(async () => {
    if (!duplicateSourceId) { setError('Choose a source event.'); return; }
    setDuplicating(true);
    try {
      const dup = await adminFetch<any>(`/api/admin/performances/${performance.id}/registration-form/duplicate-from`, { method: 'POST', body: JSON.stringify({ sourcePerformanceId: duplicateSourceId }) });
      setState((c) => c ? { ...c, id: dup.id, status: dup.status, formName: dup.formName, internalDescription: dup.internalDescription || '', settings: dup.settings, definition: dup.definition, publishedVersionId: dup.publishedVersion?.id, publishedVersionNumber: dup.publishedVersion?.versionNumber, publishedAt: dup.publishedVersion?.publishedAt } : c);
      setNotice('Draft duplicated from selected event.');
    } finally { setDuplicating(false); }
  });

  const tabs: { id: ActiveTab; label: string; count?: number }[] = [
    { id: 'sections', label: 'Sections', count: state?.definition.sections.length },
    { id: 'policies', label: 'Policies', count: state?.definition.policies.length },
    { id: 'signature', label: 'Signature' },
    { id: 'settings', label: 'Settings' }
  ];

  const modal = (
    <div className="fixed inset-0 z-[140] flex items-end sm:items-center justify-center bg-black/30 backdrop-blur-sm p-0 sm:p-4" onClick={onClose}>
      <div
        className="w-full max-w-3xl max-h-[97vh] sm:max-h-[92vh] flex flex-col rounded-t-2xl sm:rounded-2xl bg-white border border-stone-200 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-4 border-b border-stone-100 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-[10px] font-bold uppercase tracking-widest text-stone-400">Form Builder</span>
              {state && (
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${STATUS_COLORS[state.status]}`}>
                  {state.status}
                </span>
              )}
            </div>
            <h2 className="text-lg font-bold text-stone-900 leading-tight truncate">{performance.title}</h2>
            {state?.publishedVersionNumber ? (
              <p className="text-xs text-stone-400 mt-0.5">
                Published v{state.publishedVersionNumber}
                {state.publishedAt ? ` · ${new Date(state.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}
              </p>
            ) : (
              <p className="text-xs text-stone-400 mt-0.5">No published version yet</p>
            )}
          </div>
          <button type="button" onClick={onClose} className="shrink-0 rounded-lg p-2 text-stone-400 hover:bg-stone-100 hover:text-stone-600 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Alerts */}
        {(error || notice) && (
          <div className="px-5 pt-3 shrink-0">
            {error && <div className="rounded-lg bg-red-50 border border-red-100 px-3 py-2.5 text-sm text-red-700">{error}</div>}
            {notice && <div className="rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2.5 text-sm text-emerald-700">{notice}</div>}
          </div>
        )}

        {loading || !state ? (
          <div className="flex-1 flex items-center justify-center text-sm text-stone-400">Loading…</div>
        ) : (
          <>
            {/* Form name bar */}
            <div className="px-5 py-3 border-b border-stone-100 shrink-0">
              <div className="flex gap-3 items-end">
                <div className="flex-1 min-w-0">
                  <Label>Form name</Label>
                  <input className={input} value={state.formName} onChange={(e) => updateState((c) => ({ ...c, formName: e.target.value }))} />
                </div>
                {duplicateOptions.length > 0 && (
                  <div className="flex gap-2 shrink-0 items-end">
                    <div>
                      <Label>Copy from event</Label>
                      <select className={selectCls} value={duplicateSourceId} onChange={(e) => setDuplicateSourceId(e.target.value)}>
                        {duplicateOptions.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
                      </select>
                    </div>
                    <button
                      type="button"
                      onClick={() => void duplicateFrom()}
                      disabled={duplicating}
                      className="inline-flex items-center gap-1.5 rounded-md border border-stone-200 bg-white px-3 py-2 text-xs font-medium text-stone-600 hover:bg-stone-50 hover:border-stone-300 disabled:opacity-50 transition-colors"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      {duplicating ? 'Copying…' : 'Copy'}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-stone-100 px-5 shrink-0 overflow-x-auto">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1.5 border-b-2 px-1 pb-3 pt-3 mr-5 text-sm font-medium whitespace-nowrap transition-colors ${
                    activeTab === tab.id ? 'border-stone-900 text-stone-900' : 'border-transparent text-stone-400 hover:text-stone-600'
                  }`}
                >
                  {tab.label}
                  {tab.count !== undefined && (
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${activeTab === tab.id ? 'bg-stone-100 text-stone-600' : 'bg-stone-100 text-stone-400'}`}>
                      {tab.count}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div className="flex-1 overflow-y-auto px-5 py-4">

              {/* SECTIONS TAB */}
              {activeTab === 'sections' && (
                <div className="space-y-3">
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => updateState((c) => ({ ...c, definition: { ...c.definition, sections: [...c.definition.sections, emptySection()] } }))}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-stone-300 bg-white px-3 py-2 text-xs font-medium text-stone-500 hover:border-stone-400 hover:text-stone-700 transition-colors"
                    >
                      <Plus className="h-3.5 w-3.5" /> Add section
                    </button>
                  </div>
                  {state.definition.sections.length === 0 && (
                    <div className="rounded-xl border border-dashed border-stone-200 py-10 text-center text-sm text-stone-400">
                      No sections yet — add one to get started.
                    </div>
                  )}
                  {state.definition.sections.map((section, si) => (
                    <SectionCard
                      key={section.id}
                      section={section}
                      sectionIndex={si}
                      totalSections={state.definition.sections.length}
                      updateSection={(updater) => updateSection(si, updater)}
                      updateField={(fi, updater) => updateField(si, fi, updater)}
                      onMoveUp={() => updateState((c) => ({ ...c, definition: { ...c.definition, sections: reorderItem(c.definition.sections, si, -1) } }))}
                      onMoveDown={() => updateState((c) => ({ ...c, definition: { ...c.definition, sections: reorderItem(c.definition.sections, si, 1) } }))}
                      onRemove={() => updateState((c) => ({ ...c, definition: { ...c.definition, sections: c.definition.sections.filter((_, i) => i !== si) } }))}
                    />
                  ))}
                </div>
              )}

              {/* POLICIES TAB */}
              {activeTab === 'policies' && (
                <div className="space-y-3">
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => updateState((c) => ({ ...c, definition: { ...c.definition, policies: [...c.definition.policies, emptyPolicy()] } }))}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-stone-300 bg-white px-3 py-2 text-xs font-medium text-stone-500 hover:border-stone-400 hover:text-stone-700 transition-colors"
                    >
                      <Plus className="h-3.5 w-3.5" /> Add policy
                    </button>
                  </div>
                  {state.definition.policies.length === 0 && (
                    <div className="rounded-xl border border-dashed border-stone-200 py-10 text-center text-sm text-stone-400">No policies yet.</div>
                  )}
                  {state.definition.policies.map((policy, pi) => (
                    <div key={policy.id} className="rounded-xl border border-stone-200 bg-white p-4">
                      <div className="flex items-start justify-between gap-4 mb-3">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-stone-800">{policy.title || 'Untitled policy'}</span>
                          <span className="rounded-full border border-stone-200 px-2 py-0.5 text-[10px] font-medium text-stone-500">{policyTypeOptions.find((o) => o.value === policy.type)?.label}</span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <ReorderButtons onUp={() => updateState((c) => ({ ...c, definition: { ...c.definition, policies: reorderItem(c.definition.policies, pi, -1) } }))} onDown={() => updateState((c) => ({ ...c, definition: { ...c.definition, policies: reorderItem(c.definition.policies, pi, 1) } }))} disabledUp={pi === 0} disabledDown={pi === state.definition.policies.length - 1} />
                          <RemoveButton onClick={() => updateState((c) => ({ ...c, definition: { ...c.definition, policies: c.definition.policies.filter((_, i) => i !== pi) } }))} label="Delete" />
                        </div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <Label>Title</Label>
                          <input className={input} value={policy.title} onChange={(e) => updatePolicy(pi, (p) => ({ ...p, title: e.target.value }))} />
                        </div>
                        <div>
                          <Label>Type</Label>
                          <select className={selectCls} value={policy.type} onChange={(e) => updatePolicy(pi, (p) => ({ ...p, type: e.target.value as EventRegistrationPolicyType }))}>
                            {policyTypeOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </div>
                        <div className="sm:col-span-2">
                          <Label>Body</Label>
                          <textarea className={textarea} rows={3} value={policy.body || ''} onChange={(e) => updatePolicy(pi, (p) => ({ ...p, body: e.target.value }))} />
                        </div>
                        <div>
                          <Label>Acknowledgment label</Label>
                          <input className={input} value={policy.label || ''} placeholder="e.g. I agree to this policy" onChange={(e) => updatePolicy(pi, (p) => ({ ...p, label: e.target.value }))} />
                        </div>
                        <div className="flex items-end">
                          <Toggle checked={policy.required !== false} onChange={(v) => updatePolicy(pi, (p) => ({ ...p, required: v }))} label="Required" />
                        </div>
                        <p className="sm:col-span-2 text-[10px] text-stone-400">Policy ID: <code className="font-mono">{policy.id}</code></p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* SIGNATURE TAB */}
              {activeTab === 'signature' && (
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    <Toggle
                      checked={Boolean(state.definition.signature?.enabled)}
                      onChange={(v) => updateState((c) => ({ ...c, definition: { ...c.definition, signature: { ...c.definition.signature, enabled: v } } }))}
                      label="Signature enabled"
                    />
                    <Toggle
                      checked={Boolean(state.definition.signature?.requireNameMatch)}
                      onChange={(v) => updateState((c) => ({ ...c, definition: { ...c.definition, signature: { ...c.definition.signature, requireNameMatch: v } } }))}
                      label="Require typed name to match"
                    />
                  </div>
                  <div>
                    <Label>Legal text shown to signer</Label>
                    <textarea
                      className={textarea}
                      rows={6}
                      value={state.definition.signature?.legalText || ''}
                      placeholder="By signing below, I agree to…"
                      onChange={(e) => updateState((c) => ({ ...c, definition: { ...c.definition, signature: { ...c.definition.signature, legalText: e.target.value } } }))}
                    />
                  </div>
                </div>
              )}

              {/* SETTINGS TAB */}
              {activeTab === 'settings' && (
                <div className="space-y-5">
                  <div>
                    <Label>Internal description</Label>
                    <textarea className={textarea} rows={3} value={state.internalDescription} placeholder="Notes visible only to admins" onChange={(e) => updateState((c) => ({ ...c, internalDescription: e.target.value }))} />
                  </div>
                  <div>
                    <Label>Form options</Label>
                    <div className="flex flex-wrap gap-2">
                      <Toggle checked={state.settings.enabled} onChange={(v) => updateState((c) => ({ ...c, settings: { ...c.settings, enabled: v } }))} label="Form enabled" />
                      <Toggle checked={state.settings.requireSignature} onChange={(v) => updateState((c) => ({ ...c, settings: { ...c.settings, requireSignature: v } }))} label="Require signature" />
                      <Toggle checked={state.settings.requireAcknowledgments} onChange={(v) => updateState((c) => ({ ...c, settings: { ...c.settings, requireAcknowledgments: v } }))} label="Require acknowledgments" />
                    </div>
                  </div>
                  <div>
                    <Label>Child count source</Label>
                    <select
                      className={`${selectCls} max-w-xs`}
                      value={state.settings.childCountSource}
                      onChange={(e) => updateState((c) => ({ ...c, settings: { ...c.settings, childCountSource: e.target.value === 'field_value' ? 'field_value' : 'ticket_quantity' } }))}
                    >
                      <option value="ticket_quantity">Ticket quantity</option>
                      <option value="field_value">Field value</option>
                    </select>
                  </div>
                  {state.settings.childCountSource === 'field_value' && (
                    <div className="grid gap-3 sm:grid-cols-2 max-w-md">
                      <div>
                        <Label>Child count section ID</Label>
                        <input className={input} value={state.settings.childCountSectionId || ''} onChange={(e) => updateState((c) => ({ ...c, settings: { ...c.settings, childCountSectionId: e.target.value } }))} />
                      </div>
                      <div>
                        <Label>Child count field ID</Label>
                        <input className={input} value={state.settings.childCountFieldId || ''} onChange={(e) => updateState((c) => ({ ...c, settings: { ...c.settings, childCountFieldId: e.target.value } }))} />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer actions */}
            <div className="shrink-0 flex flex-wrap items-center justify-between gap-3 border-t border-stone-100 px-5 py-4 bg-stone-50 rounded-b-2xl">
              <button
                type="button"
                onClick={() => void archiveForm()}
                disabled={archiving || !state.id}
                className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs font-medium text-stone-500 hover:border-amber-200 hover:bg-amber-50 hover:text-amber-700 disabled:opacity-40 transition-colors"
              >
                <Archive className="h-3.5 w-3.5" />
                {archiving ? 'Archiving…' : 'Archive form'}
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void saveDraft()}
                  disabled={saving || loading}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 bg-white px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-50 disabled:opacity-50 transition-colors"
                >
                  <Save className="h-4 w-4" />
                  {saving ? 'Saving…' : 'Save draft'}
                </button>
                <button
                  type="button"
                  onClick={() => void publishForm()}
                  disabled={publishing || loading}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-stone-900 px-4 py-2 text-sm font-semibold text-white hover:bg-stone-800 disabled:opacity-50 transition-colors"
                >
                  <Upload className="h-4 w-4" />
                  {publishing ? 'Publishing…' : 'Publish'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );

  if (typeof document === 'undefined') {
    return null;
  }

  return createPortal(modal, document.body);
}
