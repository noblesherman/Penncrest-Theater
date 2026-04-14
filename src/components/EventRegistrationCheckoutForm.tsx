import { AlertCircle, Check, CheckCircle2, ChevronRight, FileText, Info, PenLine, Shield, User, Users } from 'lucide-react';
import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import {
  type EventRegistrationDefinition,
  type EventRegistrationFieldDefinition,
  type EventRegistrationFieldErrors,
  type EventRegistrationPublicFormResponse,
  type EventRegistrationSectionDefinition,
  type EventRegistrationSubmissionPayload,
  asRecord,
  asRecordArray,
  fieldDefaultValue,
  isFieldVisible,
  normalizeYesNo,
  resolveChildCount
} from '../lib/eventRegistrationForm';

type EnabledRegistrationForm = Extract<EventRegistrationPublicFormResponse, { enabled: true }>;

type Props = {
  form: EnabledRegistrationForm;
  ticketQuantity: number;
  storageKey: string;
  checkoutCustomerName?: string;
  disabled?: boolean;
  onValidityChange: (params: {
    valid: boolean;
    payload: EventRegistrationSubmissionPayload | null;
    errors: EventRegistrationFieldErrors;
  }) => void;
};

type SignatureState = {
  typedName: string;
  printedName: string;
};

type AcknowledgmentState = {
  infoAccurate: boolean;
  policiesRead: boolean;
  emergencyCare: boolean;
  participationRules: boolean;
};

type DraftState = {
  sections: Record<string, Record<string, unknown> | Array<Record<string, unknown>>>;
  policies: Record<string, unknown>;
  acknowledgments: AcknowledgmentState;
  signature: SignatureState;
};

function defaultAcknowledgments(): AcknowledgmentState {
  return {
    infoAccurate: false,
    policiesRead: false,
    emergencyCare: false,
    participationRules: false
  };
}

function defaultSignature(): SignatureState {
  return {
    typedName: '',
    printedName: ''
  };
}

function ensureSectionShape(params: {
  definition: EventRegistrationDefinition;
  current: Record<string, Record<string, unknown> | Array<Record<string, unknown>>>;
  childCount: number;
}): Record<string, Record<string, unknown> | Array<Record<string, unknown>>> {
  const next: Record<string, Record<string, unknown> | Array<Record<string, unknown>>> = {};

  for (const section of params.definition.sections) {
    if (section.hidden) continue;
    const existing = params.current[section.id];

    if (section.type === 'single') {
      const base = asRecord(existing);
      const row: Record<string, unknown> = {};
      for (const field of section.fields) row[field.id] = base[field.id] ?? fieldDefaultValue(field.type);
      next[section.id] = row;
      continue;
    }

    const rows = asRecordArray(existing);
    next[section.id] = Array.from({ length: params.childCount }, (_, index) => {
      const rowBase = rows[index] || {};
      const row: Record<string, unknown> = {};
      for (const field of section.fields) row[field.id] = rowBase[field.id] ?? fieldDefaultValue(field.type);
      return row;
    });
  }

  return next;
}

function normalizePolicyValue(type: string, value: unknown): unknown {
  if (type === 'required_checkbox') return value === true;
  if (type === 'yes_no') return normalizeYesNo(value);
  return String(value ?? '').trim();
}

function validateFieldValue(field: EventRegistrationFieldDefinition, value: unknown): string | null {
  if (field.type === 'checkbox') return field.required && value !== true ? 'This checkbox is required.' : null;

  if (field.type === 'multi_select') {
    const arrayValue = Array.isArray(value) ? value : [];
    if (field.required && arrayValue.length === 0) return 'Select at least one option.';
    if (field.options?.length) {
      const options = new Set(field.options);
      if (arrayValue.some((entry) => !options.has(String(entry)))) return 'Invalid option selected.';
    }
    return null;
  }

  const text = typeof value === 'string' ? value.trim() : value === null || value === undefined ? '' : String(value);
  if (field.required && !text) return 'This field is required.';
  if (!text) return null;

  if (field.type === 'email') {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(text)) return 'Enter a valid email address.';
  }
  if (field.type === 'number' && Number.isNaN(Number(text))) return 'Enter a valid number.';
  if (field.type === 'dropdown' && field.options?.length && !field.options.includes(text)) return 'Select a valid option.';
  if (field.type === 'radio_yes_no' && text !== 'yes' && text !== 'no') return 'Choose Yes or No.';

  return null;
}

function serializeSubmission(params: {
  form: EnabledRegistrationForm;
  sections: Record<string, Record<string, unknown> | Array<Record<string, unknown>>>;
  policies: Record<string, unknown>;
  acknowledgments: AcknowledgmentState;
  signature: SignatureState;
}): EventRegistrationSubmissionPayload {
  return {
    formVersionId: params.form.versionId,
    sections: params.sections,
    policies: params.policies,
    acknowledgments: params.acknowledgments,
    signature: params.signature
  };
}

function validateSubmission(params: {
  form: EnabledRegistrationForm;
  sections: Record<string, Record<string, unknown> | Array<Record<string, unknown>>>;
  policies: Record<string, unknown>;
  acknowledgments: AcknowledgmentState;
  signature: SignatureState;
  ticketQuantity: number;
}): { valid: boolean; errors: EventRegistrationFieldErrors } {
  const errors: EventRegistrationFieldErrors = {};
  const childCount = resolveChildCount({
    settings: params.form.settings,
    sections: params.sections,
    ticketQuantity: params.ticketQuantity
  });

  if (params.form.settings.childCountSource === 'ticket_quantity' && childCount !== params.ticketQuantity) {
    errors.childCount = 'Child count must match ticket quantity.';
  }

  for (const section of params.form.definition.sections) {
    if (section.hidden) continue;

    if (section.type === 'single') {
      const values = asRecord(params.sections[section.id]);
      const normalizedValues: Record<string, unknown> = {};
      for (const field of section.fields) normalizedValues[field.id] = values[field.id] ?? fieldDefaultValue(field.type);

      for (const field of section.fields) {
        if (field.hidden || !isFieldVisible(field, normalizedValues)) continue;
        const error = validateFieldValue(field, normalizedValues[field.id]);
        if (error) errors[`${section.id}.${field.id}`] = error;
      }
      continue;
    }

    const values = asRecordArray(params.sections[section.id]);
    if (values.length !== childCount) {
      errors[`${section.id}._rows`] = `Expected ${childCount} child section${childCount === 1 ? '' : 's'}.`;
      continue;
    }

    for (let index = 0; index < values.length; index += 1) {
      const row = values[index];
      const normalizedValues: Record<string, unknown> = {};
      for (const field of section.fields) normalizedValues[field.id] = row[field.id] ?? fieldDefaultValue(field.type);

      for (const field of section.fields) {
        if (field.hidden || !isFieldVisible(field, normalizedValues)) continue;
        const error = validateFieldValue(field, normalizedValues[field.id]);
        if (error) errors[`${section.id}[${index}].${field.id}`] = error;
      }
    }
  }

  for (const policy of params.form.definition.policies) {
    const value = normalizePolicyValue(policy.type, params.policies[policy.id]);
    if (policy.type === 'required_checkbox' && policy.required !== false && value !== true) {
      errors[`policy.${policy.id}`] = 'This acknowledgment is required.';
    }
    if (policy.type === 'yes_no' && policy.required !== false && value !== 'yes' && value !== 'no') {
      errors[`policy.${policy.id}`] = 'Please choose Yes or No.';
    }
  }

  if (params.form.settings.requireAcknowledgments) {
    if (!params.acknowledgments.infoAccurate) errors['ack.infoAccurate'] = 'Required';
    if (!params.acknowledgments.policiesRead) errors['ack.policiesRead'] = 'Required';
    if (!params.acknowledgments.emergencyCare) errors['ack.emergencyCare'] = 'Required';
    if (!params.acknowledgments.participationRules) errors['ack.participationRules'] = 'Required';
  }

  if (params.form.settings.requireSignature || params.form.definition.signature?.enabled) {
    if (!params.signature.printedName.trim()) errors['signature.printedName'] = 'Required';
    if (!params.signature.typedName.trim()) errors['signature.typedName'] = 'Required';
    if (
      params.form.definition.signature?.requireNameMatch &&
      params.signature.printedName.trim() &&
      params.signature.typedName.trim() &&
      params.signature.printedName.trim().toLowerCase() !== params.signature.typedName.trim().toLowerCase()
    ) {
      errors['signature.typedName'] = 'Typed signature must match printed name.';
    }
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

function renderFieldLabel(field: EventRegistrationFieldDefinition): string {
  return field.required ? `${field.label} *` : field.label;
}

function isParentGuardianNameField(field: EventRegistrationFieldDefinition): boolean {
  const label = field.label.trim().toLowerCase();
  return label.includes('name') && !label.includes('child') && !label.includes('camper') && (label.includes('parent') || label.includes('guardian'));
}

export default function EventRegistrationCheckoutForm({
  form,
  ticketQuantity,
  storageKey,
  checkoutCustomerName,
  disabled = false,
  onValidityChange
}: Props) {
  const [sections, setSections] = useState<Record<string, Record<string, unknown> | Array<Record<string, unknown>>>>({});
  const [policies, setPolicies] = useState<Record<string, unknown>>({});
  const [acknowledgments, setAcknowledgments] = useState<AcknowledgmentState>(defaultAcknowledgments);
  const [signature, setSignature] = useState<SignatureState>(defaultSignature);
  const [showErrors, setShowErrors] = useState(false);
  const [activeChildIndex, setActiveChildIndex] = useState(0);

  const childCount = useMemo(
    () =>
      resolveChildCount({
        settings: form.settings,
        sections,
        ticketQuantity
      }),
    [form.settings, sections, ticketQuantity]
  );

  useEffect(() => {
    const initial = (() => {
      try {
        const raw = localStorage.getItem(storageKey);
        return raw ? (JSON.parse(raw) as Partial<DraftState>) : null;
      } catch {
        return null;
      }
    })();

    setSections(
      ensureSectionShape({
        definition: form.definition,
        current: initial?.sections || {},
        childCount: Math.max(0, ticketQuantity)
      })
    );

    const initialPolicies: Record<string, unknown> = {};
    for (const policy of form.definition.policies) {
      initialPolicies[policy.id] = initial?.policies?.[policy.id] ?? (policy.type === 'required_checkbox' ? false : '');
    }
    setPolicies(initialPolicies);

    setAcknowledgments({ ...defaultAcknowledgments(), ...(initial?.acknowledgments || {}) });
    setSignature({ ...defaultSignature(), ...(initial?.signature || {}) });
  }, [form.definition, storageKey, ticketQuantity]);

  useEffect(() => {
    setSections((current) =>
      ensureSectionShape({
        definition: form.definition,
        current,
        childCount: Math.max(0, childCount)
      })
    );
  }, [childCount, form.definition]);

  useEffect(() => {
    const normalizedName = checkoutCustomerName?.trim();
    if (!normalizedName) return;

    setSections((current) => {
      let changed = false;
      const next = { ...current };

      for (const section of form.definition.sections) {
        if (section.hidden || section.type !== 'single') continue;
        const row = asRecord(next[section.id]);
        const nextRow: Record<string, unknown> = { ...row };
        let rowChanged = false;

        for (const field of section.fields) {
          if (field.hidden || !isParentGuardianNameField(field)) continue;
          if (!String(nextRow[field.id] ?? '').trim()) {
            nextRow[field.id] = normalizedName;
            rowChanged = true;
          }
        }

        if (rowChanged) {
          next[section.id] = nextRow;
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [checkoutCustomerName, form.definition.sections]);

  useEffect(() => {
    setActiveChildIndex((current) => (childCount <= 1 ? 0 : Math.min(current, childCount - 1)));
  }, [childCount]);

  useEffect(() => {
    const draft: DraftState = { sections, policies, acknowledgments, signature };
    try {
      localStorage.setItem(storageKey, JSON.stringify(draft));
    } catch {}
  }, [acknowledgments, policies, sections, signature, storageKey]);

  const validation = useMemo(
    () =>
      validateSubmission({
        form,
        sections,
        policies,
        acknowledgments,
        signature,
        ticketQuantity
      }),
    [acknowledgments, form, policies, sections, signature, ticketQuantity]
  );

  const payload = useMemo(
    () =>
      validation.valid
        ? serializeSubmission({
            form,
            sections,
            policies,
            acknowledgments,
            signature
          })
        : null,
    [acknowledgments, form, policies, sections, signature, validation.valid]
  );

  const childErrorCounts = useMemo(() => {
    if (childCount <= 0) return [];
    const counts = Array.from({ length: childCount }, () => 0);
    for (const key of Object.keys(validation.errors)) {
      const match = key.match(/\[(\d+)\]\./);
      if (!match) continue;
      const index = Number(match[1]);
      if (Number.isInteger(index) && index >= 0 && index < counts.length) counts[index] += 1;
    }
    return counts;
  }, [childCount, validation.errors]);

  useEffect(() => {
    onValidityChange({
      valid: validation.valid,
      payload,
      errors: validation.errors
    });
  }, [onValidityChange, payload, validation.errors, validation.valid]);

  const setSingleValue = (sectionId: string, fieldId: string, value: unknown) => {
    setSections((current) => {
      const section = asRecord(current[sectionId]);
      return { ...current, [sectionId]: { ...section, [fieldId]: value } };
    });
  };

  const setRepeatingValue = (sectionId: string, rowIndex: number, fieldId: string, value: unknown) => {
    setSections((current) => {
      const rows = asRecordArray(current[sectionId]);
      const nextRows = rows.map((row, index) => (index === rowIndex ? { ...row, [fieldId]: value } : row));
      return { ...current, [sectionId]: nextRows };
    });
  };

  const renderField = (
    field: EventRegistrationFieldDefinition,
    value: unknown,
    onValueChange: (next: unknown) => void,
    errorKey: string
  ) => {
    const error = showErrors ? validation.errors[errorKey] : null;
    const controlClass = `mt-1 w-full rounded-xl border px-3.5 py-2.5 text-sm outline-none transition-all duration-200 ${
      error
        ? 'border-red-400 bg-red-50/50 shadow-[0_0_0_2px_rgba(248,113,113,0.2)] focus:border-red-500 focus:bg-white'
        : 'border-stone-200 bg-stone-50/50 hover:bg-white hover:border-stone-300 focus:border-indigo-500 focus:bg-white focus:ring-4 focus:ring-indigo-500/10'
    }`;

    let input: React.ReactNode = null;

    if (field.type === 'long_text' || field.type === 'repeatable_person_list') {
      input = (
        <textarea
          rows={3}
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onValueChange(event.target.value)}
          placeholder={field.placeholder || ''}
          disabled={disabled}
          className={controlClass}
        />
      );
    } else if (field.type === 'dropdown') {
      input = (
        <select
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onValueChange(event.target.value)}
          disabled={disabled}
          className={controlClass}
        >
          <option value="">Select...</option>
          {(field.options || []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    } else if (field.type === 'multi_select') {
      const selected = Array.isArray(value) ? value.map(String) : [];
      input = (
        <div className="mt-2 space-y-2 rounded-xl border border-stone-200 bg-stone-50 p-3">
          {(field.options || []).map((option) => {
            const checked = selected.includes(option);
            return (
              <label key={option} className="flex items-start gap-2 text-sm text-stone-700">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={(event) => {
                    if (event.target.checked) {
                      onValueChange(Array.from(new Set([...selected, option])));
                      return;
                    }
                    onValueChange(selected.filter((item) => item !== option));
                  }}
                  className="mt-0.5"
                />
                <span>{option}</span>
              </label>
            );
          })}
        </div>
      );
    } else if (field.type === 'checkbox') {
      input = (
        <label className="mt-2 flex items-start gap-2 text-sm text-stone-700">
          <input
            type="checkbox"
            checked={value === true}
            onChange={(event) => onValueChange(event.target.checked)}
            disabled={disabled}
            className="mt-0.5"
          />
          <span>{field.helpText || field.label}</span>
        </label>
      );
    } else if (field.type === 'radio_yes_no') {
      const radioValue = normalizeYesNo(value);
      input = (
        <div className="mt-2 flex gap-4">
          {['yes', 'no'].map((option) => (
            <label key={option} className="flex items-center gap-2 text-sm text-stone-700">
              <input
                type="radio"
                value={option}
                checked={radioValue === option}
                onChange={(event) => onValueChange(event.target.value)}
                disabled={disabled}
              />
              <span>{option === 'yes' ? 'Yes' : 'No'}</span>
            </label>
          ))}
        </div>
      );
    } else {
      const typeAttr =
        field.type === 'email' || field.type === 'phone' || field.type === 'number' || field.type === 'date'
          ? field.type === 'phone'
            ? 'tel'
            : field.type
          : 'text';

      input = (
        <input
          type={typeAttr}
          value={value === null || value === undefined ? '' : String(value)}
          onChange={(event) => onValueChange(event.target.value)}
          placeholder={field.placeholder || ''}
          disabled={disabled}
          className={controlClass}
        />
      );
    }

    return (
      <label key={errorKey} className="group relative block">
        <span className="mb-1.5 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-stone-500 transition-colors group-focus-within:text-indigo-600">
          {renderFieldLabel(field)}
        </span>
        {input}
        {field.helpText ? <p className="mt-2 text-[13px] leading-relaxed text-stone-500">{field.helpText}</p> : null}
        <div
          className={`grid transition-all duration-300 ease-in-out ${
            error ? 'grid-rows-[1fr] opacity-100 mt-2' : 'grid-rows-[0fr] opacity-0'
          }`}
        >
          <div className="overflow-hidden">
            <p className="flex items-center gap-1.5 text-[13px] font-medium text-red-600">
              <AlertCircle size={14} className="shrink-0" />
              <span>{error}</span>
            </p>
          </div>
        </div>
      </label>
    );
  };

  return (
    <div className="mt-8 overflow-hidden rounded-3xl border border-stone-200 bg-white/70 shadow-sm backdrop-blur-md ring-1 ring-stone-900/5 sm:p-8 p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-5 border-b border-stone-200/60 pb-6">
        <div className="flex items-center justify-start gap-4">
          <div className="flex flex-shrink-0 h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 shadow-sm border border-indigo-100">
            <FileText size={26} strokeWidth={2.5} />
          </div>
          <div>
            <h3 className="text-2xl font-black tracking-tight text-stone-900">{form.formName}</h3>
            <p className="mt-1 text-[15px] text-stone-500 font-medium">Please review and complete the registration details.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowErrors(true)}
          className="group flex flex-shrink-0 items-center justify-center gap-2 rounded-xl bg-stone-900 px-5 py-3 text-[13px] font-bold tracking-wide text-white shadow hover:bg-stone-800 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 transition-all duration-200 focus:outline-none focus:ring-4 focus:ring-stone-900/20"
        >
          Check Form
          <ChevronRight size={16} className="text-stone-400 group-hover:text-white transition-colors" />
        </button>
      </div>

      {validation.errors.childCount ? (
        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 shadow-sm animate-in slide-in-from-top-2 fade-in duration-300">
          <AlertCircle className="mt-0.5 text-red-500" size={20} />
          <div>
            <h4 className="text-sm font-bold text-red-900">Issue detected</h4>
            <p className="text-sm text-red-700 mt-1">{validation.errors.childCount}</p>
          </div>
        </div>
      ) : null}

      <div className="mt-8 space-y-8">
        {form.definition.sections.filter((section) => !section.hidden).map((section) => {
          if (section.type === 'single') {
            const values = asRecord(sections[section.id]);
            return (
              <section key={section.id} className="group overflow-hidden rounded-3xl border border-stone-200 bg-white/70 shadow-sm transition-all duration-300 hover:shadow-md hover:border-stone-300 relative before:absolute before:-inset-px before:rounded-3xl before:bg-gradient-to-b before:from-white/20 before:to-transparent">
                <div className="relative bg-stone-50 border-b border-stone-200/50 p-6 sm:px-8 flex items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-stone-200/60 shadow-inner text-stone-600 transition-colors group-hover:bg-indigo-100 group-hover:text-indigo-600">
                    <User size={20} strokeWidth={2.5} />
                  </div>
                  <div>
                    <h4 className="text-sm font-black uppercase tracking-widest text-stone-900 drop-shadow-sm">{section.title}</h4>
                    {section.description ? <p className="text-[13px] leading-tight text-stone-500 font-medium mt-1">{section.description}</p> : null}
                  </div>
                </div>
                <div className="relative p-6 sm:px-8 mt-2 grid gap-6 md:grid-cols-2">
                  {section.fields
                    .filter((field) => !field.hidden)
                    .filter((field) => isFieldVisible(field, values))
                    .map((field) =>
                      renderField(
                        field,
                        values[field.id] ?? fieldDefaultValue(field.type),
                        (next) => setSingleValue(section.id, field.id, next),
                        `${section.id}.${field.id}`
                      )
                    )}
                </div>
              </section>
            );
          }

          const rows = asRecordArray(sections[section.id]);
          const selectedRowIndex = rows.length > 0 ? Math.min(activeChildIndex, rows.length - 1) : 0;
          const selectedRow = rows[selectedRowIndex];

          return (
            <section key={section.id} className="group overflow-hidden rounded-3xl border border-stone-200 bg-white/70 shadow-sm transition-all duration-300 hover:shadow-md hover:border-stone-300 relative">
              <div className="relative bg-stone-50 border-b border-stone-200/50 p-6 sm:px-8 flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-stone-200/60 shadow-inner text-stone-600 transition-colors group-hover:bg-indigo-100 group-hover:text-indigo-600">
                    <Users size={20} strokeWidth={2.5} />
                  </div>
                  <div>
                    <h4 className="text-sm font-black uppercase tracking-widest text-stone-900 drop-shadow-sm">{section.title}</h4>
                    {section.description ? <p className="text-[13px] leading-tight text-stone-500 font-medium mt-1">{section.description}</p> : null}
                  </div>
                </div>
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-stone-200/60 shadow-inner font-bold text-xs text-stone-600">{childCount}</div>
              </div>
              <div className="relative p-6 sm:px-8">
              {childCount > 0 ? (
                childCount > 1 ? (
                  <div className="mb-8 flex flex-wrap gap-3">
                    {Array.from({ length: childCount }, (_, index) => {
                      const isActive = activeChildIndex === index;
                      const errorCount = childErrorCounts[index] || 0;
                      return (
                        <button
                          key={`${section.id}-child-tab-${index}`}
                          type="button"
                          onClick={() => setActiveChildIndex(index)}
                          className={`relative overflow-hidden inline-flex items-center gap-2.5 rounded-2xl border px-4 py-2.5 text-[13px] font-bold shadow-sm transition-all duration-300 ${
                            isActive
                              ? 'border-indigo-600 bg-indigo-600 text-white shadow-md shadow-indigo-600/30 scale-105'
                              : 'border-stone-200 bg-white text-stone-600 hover:border-stone-300 hover:bg-stone-50 hover:text-stone-900 focus:outline-none focus:ring-4 focus:ring-indigo-100'
                          }`}
                        >
                          <span className="relative z-10">Kid #{index + 1}</span>
                          {showErrors && errorCount > 0 ? (
                            <span
                              className={`relative z-10 flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-black ${
                                isActive ? 'bg-indigo-500 text-white border border-indigo-400' : 'bg-red-100 text-red-600 border border-red-200'
                              }`}
                            >
                              {errorCount}
                            </span>
                          ) : null}
                          {isActive && <div className="absolute inset-0 bg-gradient-to-tr from-white/10 to-transparent"></div>}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mb-6 inline-flex items-center gap-2 rounded-xl bg-stone-100/80 px-4 py-2.5 text-sm font-bold text-stone-700 shadow-inner ring-1 ring-stone-900/5">
                    <User size={16} className="text-stone-500" strokeWidth={2.5} />
                    Registration #{1}
                  </div>
                )
              ) : null}
              {selectedRow ? (
                <div className="relative animate-in slide-in-from-right-4 fade-in duration-500">
                  <div className="absolute -left-6 -right-6 top-0 h-px bg-stone-100/50 sm:-left-8 sm:-right-8" />
                  <div className="pt-2 grid gap-6 md:grid-cols-2">
                    {section.fields
                      .filter((field) => !field.hidden)
                      .filter((field) => isFieldVisible(field, selectedRow))
                      .map((field) =>
                        renderField(
                          field,
                          selectedRow[field.id] ?? fieldDefaultValue(field.type),
                          (next) => setRepeatingValue(section.id, selectedRowIndex, field.id, next),
                          `${section.id}[${selectedRowIndex}].${field.id}`
                        )
                      )}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-10 opacity-60">
                  <Info size={40} className="mb-3 text-stone-400" />
                  <p className="text-[15px] font-medium text-stone-500">No entries available for this section.</p>
                </div>
              )}
              </div>
            </section>
          );
        })}

        {form.definition.policies.length > 0 ? (
          <section className="group overflow-hidden rounded-3xl border border-stone-200 bg-white/70 shadow-sm transition-all duration-300 hover:shadow-md hover:border-stone-300 relative">
            <div className="relative bg-stone-50 border-b border-stone-200/50 p-6 sm:px-8 flex items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-stone-200/60 shadow-inner text-stone-600 transition-colors group-hover:bg-indigo-100 group-hover:text-indigo-600">
                <Shield size={20} strokeWidth={2.5} />
              </div>
              <div>
                <h4 className="text-sm font-black uppercase tracking-widest text-stone-900 drop-shadow-sm">Camp Policies and Acknowledgments</h4>
              </div>
            </div>
            <div className="relative p-6 sm:px-8 space-y-5">
              {form.definition.policies.map((policy) => {
                const value = policies[policy.id] ?? (policy.type === 'required_checkbox' ? false : '');
                const errorKey = `policy.${policy.id}`;
                const error = showErrors ? validation.errors[errorKey] : null;

                return (
                  <div key={policy.id} className={`rounded-2xl border bg-white p-5 shadow-sm transition-colors duration-300 ${error ? 'border-red-300 bg-red-50/50 ring-2 ring-red-50' : 'border-stone-200 hover:border-stone-300 focus-within:ring-4 focus-within:ring-indigo-50 leading-relaxed'}`}>
                    <p className="text-[15px] font-bold text-stone-900">{policy.title}</p>
                    {policy.body ? <p className="mt-2.5 whitespace-pre-wrap text-[14px] text-stone-500">{policy.body}</p> : null}

                    {policy.type === 'required_checkbox' ? (
                      <label className="mt-4 flex items-start gap-3 text-sm text-stone-700 max-w-fit cursor-pointer group/label">
                        <div className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border shadow-sm transition-colors group-hover/label:border-indigo-400 ${value === true ? 'bg-indigo-600 border-indigo-600' : 'bg-white border-stone-300'}`}>
                          {value === true && <Check size={14} className="text-white" strokeWidth={3} />}
                        </div>
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={value === true}
                          disabled={disabled}
                          onChange={(event) => setPolicies((current) => ({ ...current, [policy.id]: event.target.checked }))}
                        />
                        <span className="font-semibold select-none">{policy.label || 'I acknowledge this policy.'}</span>
                      </label>
                    ) : policy.type === 'yes_no' ? (
                      <div className="mt-4 flex gap-5">
                        {['yes', 'no'].map((option) => (
                          <label key={`${policy.id}-${option}`} className="flex items-center gap-2.5 text-[15px] font-bold text-stone-700 cursor-pointer group/radio">
                            <div className={`flex h-5 w-5 items-center justify-center rounded-full border shadow-sm transition-colors group-hover/radio:border-indigo-400 ${value === option ? 'border-indigo-600' : 'border-stone-300 bg-white'}`}>
                              {value === option && <div className="h-2.5 w-2.5 rounded-full bg-indigo-600" />}
                            </div>
                            <input
                              type="radio"
                              className="sr-only"
                              name={`policy-${policy.id}`}
                              value={option}
                              checked={value === option}
                              disabled={disabled}
                              onChange={(event) => setPolicies((current) => ({ ...current, [policy.id]: event.target.value }))}
                            />
                            <span className="select-none capitalize tracking-wider text-sm">{option}</span>
                          </label>
                        ))}
                      </div>
                    ) : null}

                    <div
                      className={`grid transition-all duration-300 ease-in-out ${
                        error ? 'grid-rows-[1fr] opacity-100 mt-3' : 'grid-rows-[0fr] opacity-0'
                      }`}
                    >
                      <div className="overflow-hidden">
                        <p className="flex items-center gap-1.5 text-[13px] font-bold text-red-600 bg-red-100/50 w-max px-3 py-1.5 rounded-lg border border-red-200">
                          <AlertCircle size={14} className="shrink-0" />
                          <span>{error}</span>
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        <section className="group overflow-hidden rounded-3xl border border-stone-200 bg-white/70 shadow-sm transition-all duration-300 hover:shadow-md hover:border-stone-300 relative">
          <div className="relative bg-stone-50 border-b border-stone-200/50 p-6 sm:px-8 flex items-center gap-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-stone-200/60 shadow-inner text-stone-600 transition-colors group-hover:bg-indigo-100 group-hover:text-indigo-600">
              <PenLine size={20} strokeWidth={2.5} />
            </div>
            <div>
              <h4 className="text-sm font-black uppercase tracking-widest text-stone-900 drop-shadow-sm">Parent Certification and Signature</h4>
            </div>
          </div>
          <div className="relative p-6 sm:px-8">
            <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-stone-600 border-l-4 border-indigo-400 bg-indigo-50/50 pl-5 outline-none rounded-xl rounded-l-none py-3 shadow-sm">
              {form.definition.signature?.legalText ||
                'I confirm that the information submitted is accurate and that I am the parent or legal guardian for the listed child or children.'}
            </p>

            {form.settings.requireAcknowledgments ? (
              <div className="mt-8 space-y-4 rounded-2xl bg-white border border-stone-200 p-6 shadow-sm">
                {[
                  { key: 'infoAccurate', label: 'I confirm the information provided is accurate and complete.' },
                  { key: 'policiesRead', label: 'I confirm I have read and agree to the policies listed above.' },
                  { key: 'emergencyCare', label: 'I authorize emergency medical care if needed.' },
                  { key: 'participationRules', label: 'I understand participation and behavior rules.' }
                ].map((item) => {
                  const key = item.key as keyof AcknowledgmentState;
                  const checked = acknowledgments[key];
                  const error = showErrors ? validation.errors[`ack.${item.key}`] : null;

                  return (
                    <label key={item.key} className={`group/ack block text-[14px] font-bold text-stone-700 cursor-pointer ${error ? 'bg-red-50/80 -mx-4 px-4 py-2 rounded-xl border border-red-100/50' : 'hover:bg-stone-50 -mx-4 px-4 py-2 rounded-xl transition-colors'}`}>
                      <span className="inline-flex items-center gap-3 w-full">
                        <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border shadow-sm transition-colors group-hover/ack:border-indigo-400 ${checked ? 'bg-indigo-600 border-indigo-600' : 'bg-white border-stone-300'}`}>
                          {checked && <Check size={14} className="text-white" strokeWidth={3} />}
                        </div>
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={checked}
                          disabled={disabled}
                          onChange={(event) =>
                            setAcknowledgments((current) => ({
                              ...current,
                              [key]: event.target.checked
                            }))
                          }
                        />
                        <span className="select-none tracking-wide text-stone-800">{item.label}</span>
                      </span>
                      {error ? (
                        <span className="mt-2 ml-8 flex w-max items-center gap-1.5 rounded-lg border border-red-200 bg-white px-2 py-1 text-[11px] font-bold text-red-600 shadow-sm animate-in slide-in-from-top-1 fade-in duration-300 relative z-10">
                          <AlertCircle size={12} className="shrink-0" />
                          {error}
                        </span>
                      ) : null}
                    </label>
                  );
                })}
              </div>
            ) : null}

            <div className="mt-8 grid gap-8 md:grid-cols-2">
              <label className="block group">
                <span className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-stone-500 transition-colors group-focus-within:text-indigo-600">Printed Parent or Guardian Name *</span>
                <div className="relative">
                  <User size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400" />
                  <input
                    type="text"
                    value={signature.printedName}
                    onChange={(event) => setSignature((current) => ({ ...current, printedName: event.target.value }))}
                    disabled={disabled}
                    placeholder="Jane Doe"
                    className={`mt-1 pl-11 w-full rounded-xl border py-3 text-sm font-semibold outline-none transition-all duration-200 shadow-sm ${
                      showErrors && validation.errors['signature.printedName']
                        ? 'border-red-400 bg-red-50/50 shadow-[0_0_0_2px_rgba(248,113,113,0.2)] focus:border-red-500 focus:bg-white text-red-900'
                        : 'border-stone-300 bg-white hover:border-stone-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 text-stone-900'
                    }`}
                  />
                </div>
                <div
                  className={`grid transition-all duration-300 ease-in-out ${
                    showErrors && validation.errors['signature.printedName'] ? 'grid-rows-[1fr] opacity-100 mt-2' : 'grid-rows-[0fr] opacity-0'
                  }`}
                >
                  <div className="overflow-hidden">
                    <p className="flex items-center gap-1.5 text-[13px] font-medium text-red-600">
                      <AlertCircle size={14} className="shrink-0" />
                      <span>{validation.errors['signature.printedName']}</span>
                    </p>
                  </div>
                </div>
              </label>

              <label className="block group">
                <span className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-stone-500 transition-colors group-focus-within:text-indigo-600">Typed Signature *</span>
                <div className="relative">
                  <PenLine size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400" />
                  <input
                    type="text"
                    value={signature.typedName}
                    onChange={(event) => setSignature((current) => ({ ...current, typedName: event.target.value }))}
                    disabled={disabled}
                    placeholder="Jane Doe"
                    className={`mt-1 pl-11 w-full rounded-xl border py-3 text-sm font-semibold outline-none transition-all duration-200 shadow-sm ${
                      showErrors && validation.errors['signature.typedName']
                        ? 'border-red-400 bg-red-50/50 shadow-[0_0_0_2px_rgba(248,113,113,0.2)] focus:border-red-500 focus:bg-white text-red-900'
                        : 'border-stone-300 bg-white hover:border-stone-400 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 text-stone-900 font-["Dancing_Script",cursive,serif] italic text-lg'
                    }`}
                  />
                  {signature.typedName.length > 0 && !(showErrors && validation.errors['signature.typedName']) && (
                    <CheckCircle2 size={18} className="absolute right-4 top-1/2 -translate-y-1/2 text-green-500 animate-in zoom-in" />
                  )}
                </div>
                <div
                  className={`grid transition-all duration-300 ease-in-out ${
                    showErrors && validation.errors['signature.typedName'] ? 'grid-rows-[1fr] opacity-100 mt-2' : 'grid-rows-[0fr] opacity-0'
                  }`}
                >
                  <div className="overflow-hidden">
                    <p className="flex items-center gap-1.5 text-[13px] font-medium text-red-600">
                      <AlertCircle size={14} className="shrink-0" />
                      <span>{validation.errors['signature.typedName']}</span>
                    </p>
                  </div>
                </div>
              </label>
            </div>

            <p className="mt-6 flex items-center justify-center gap-2 rounded-xl bg-stone-50 py-3 text-[12px] font-semibold text-stone-500">
              <Info size={14} className="text-stone-400" />
              Date signed is recorded automatically when you submit checkout.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
