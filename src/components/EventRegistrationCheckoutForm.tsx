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
    const baseControlClass = "w-full rounded-lg border px-3.5 py-3 text-[15px] outline-none transition-all duration-200 placeholder:text-slate-400";
    const controlClass = error
      ? `${baseControlClass} border-red-300 bg-red-50/40 text-slate-900 focus:border-red-500 focus:ring-2 focus:ring-red-500/20`
      : `${baseControlClass} border-slate-300 bg-white text-slate-900 hover:border-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20`;

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
        <div className="space-y-2.5 rounded-lg border border-slate-200 bg-slate-50/50 p-4">
          {(field.options || []).map((option) => {
            const checked = selected.includes(option);
            return (
              <label key={option} className="flex items-start gap-3 text-[15px] text-slate-700 cursor-pointer">
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
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600 focus:ring-offset-0 disabled:opacity-50"
                />
                <span>{option}</span>
              </label>
            );
          })}
        </div>
      );
    } else if (field.type === 'checkbox') {
      input = (
        <label className="flex items-start gap-3 text-[15px] text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            checked={value === true}
            onChange={(event) => onValueChange(event.target.checked)}
            disabled={disabled}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600 focus:ring-offset-0 disabled:opacity-50"
          />
          <span>{field.helpText || field.label}</span>
        </label>
      );
    } else if (field.type === 'radio_yes_no') {
      const radioValue = normalizeYesNo(value);
      input = (
        <div className="flex gap-6">
          {['yes', 'no'].map((option) => (
            <label key={option} className="flex items-center gap-2 text-[15px] text-slate-900 cursor-pointer select-none">
              <input
                type="radio"
                value={option}
                checked={radioValue === option}
                onChange={(event) => onValueChange(event.target.value)}
                disabled={disabled}
                className="h-4 w-4 border-slate-300 text-blue-600 focus:ring-blue-600 focus:ring-offset-0 disabled:opacity-50"
              />
              <span className="capitalize">{option}</span>
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
      <label key={errorKey} className="block relative">
        <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-blue-600">
          {renderFieldLabel(field)}
        </span>
        {input}
        {field.helpText && field.type !== 'checkbox' ? (
          <p className="mt-2 text-sm text-slate-500">{field.helpText}</p>
        ) : null}
        {error ? (
          <p className="mt-2 flex items-center gap-1.5 text-sm font-medium text-red-600">
            <AlertCircle size={16} className="shrink-0" />
            <span>{error}</span>
          </p>
        ) : null}
      </label>
    );
  };

  return (
    <div className="mt-8 rounded-xl border border-slate-200 bg-white sm:p-10 p-6 flex flex-col gap-10">
      {validation.errors.childCount ? (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4">
          <AlertCircle className="mt-0.5 text-red-500 shrink-0" size={20} />
          <div>
            <h4 className="text-sm font-bold text-red-900">Issue detected</h4>
            <p className="text-sm text-red-700 mt-1">{validation.errors.childCount}</p>
          </div>
        </div>
      ) : null}

      <div className="space-y-12">
        {form.definition.sections.filter((section) => !section.hidden).map((section) => {
          if (section.type === 'single') {
            const values = asRecord(sections[section.id]);
            return (
              <section key={section.id}>
                {section.title && <h4 className="text-lg font-bold text-slate-900 mb-6">{section.title}</h4>}
                {section.description ? <p className="mb-6 text-sm leading-relaxed text-slate-500">{section.description}</p> : null}
                <div className="grid gap-x-8 gap-y-6 md:grid-cols-2">
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
            <section key={section.id}>
              {section.title && <h4 className="text-lg font-bold text-slate-900 mb-6">{section.title}</h4>}
              {section.description ? <p className="mb-6 text-sm leading-relaxed text-slate-500">{section.description}</p> : null}
              
              {childCount > 0 ? (
                childCount > 1 ? (
                  <div className="mb-8 flex flex-wrap gap-3">
                    {Array.from({ length: childCount }, (_, index) => {
                      const isActive = activeChildIndex === index;
                      const errorCount = childErrorCounts[index] || 0;
                      
                      const row = rows[index] || {};
                      const nameField = section.fields.find(f => f.label.toLowerCase().includes('first name') || f.label.toLowerCase().includes('camper name') || f.label.toLowerCase().includes('name'));
                      const kidName = nameField && row[nameField.id] ? String(row[nameField.id]).trim().split(' ')[0] : `Kid #${index + 1}`;
                      const displayName = kidName || `Kid #${index + 1}`;

                      return (
                        <button
                          key={`${section.id}-child-tab-${index}`}
                          type="button"
                          onClick={() => setActiveChildIndex(index)}
                          className={`relative inline-flex items-center justify-center gap-2 rounded-full px-5 py-2 text-sm font-bold transition-all focus:outline-none focus:ring-2 focus:ring-blue-600/50 ${
                            isActive
                              ? 'bg-blue-600 text-white shadow-sm'
                              : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          {displayName}
                          {showErrors && errorCount > 0 ? (
                            <span
                              className={`inline-flex items-center justify-center rounded-full h-5 w-5 text-[10px] font-black ${
                                isActive ? 'bg-white/20 text-white' : 'bg-red-100 text-red-600'
                              }`}
                            >
                              {errorCount}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                ) : null
              ) : null}
              {selectedRow ? (
                <div className="pt-2 grid gap-x-8 gap-y-6 md:grid-cols-2">
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
              ) : (
                <div className="flex flex-col items-center justify-center py-10 opacity-60">
                  <p className="text-[15px] font-medium text-slate-500">No entries available for this section.</p>
                </div>
              )}
            </section>
          );
        })}

        {form.definition.policies.length > 0 ? (
          <section className="pt-8 border-t border-slate-200">
            <h4 className="text-lg font-bold text-slate-900 mb-6">Camp Policies and Acknowledgments</h4>
            <div className="space-y-6">
              {form.definition.policies.map((policy) => {
                const value = policies[policy.id] ?? (policy.type === 'required_checkbox' ? false : '');
                const errorKey = `policy.${policy.id}`;
                const error = showErrors ? validation.errors[errorKey] : null;

                return (
                  <div key={policy.id} className="pt-2">
                    <p className="text-[15px] font-bold text-slate-900">{policy.title}</p>
                    {policy.body ? <p className="mt-2 whitespace-pre-wrap text-[14px] text-slate-600">{policy.body}</p> : null}

                    {policy.type === 'required_checkbox' ? (
                      <label className="mt-4 flex items-start gap-3 text-[15px] text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={value === true}
                          disabled={disabled}
                          onChange={(event) => setPolicies((current) => ({ ...current, [policy.id]: event.target.checked }))}
                          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600 focus:ring-offset-0 disabled:opacity-50"
                        />
                        <span className="font-semibold select-none">{policy.label || 'I acknowledge this policy.'}</span>
                      </label>
                    ) : policy.type === 'yes_no' ? (
                      <div className="mt-4 flex gap-6">
                        {['yes', 'no'].map((option) => (
                          <label key={`${policy.id}-${option}`} className="flex items-center gap-2 text-[15px] font-medium text-slate-900 cursor-pointer select-none">
                            <input
                              type="radio"
                              name={`policy-${policy.id}`}
                              value={option}
                              checked={value === option}
                              disabled={disabled}
                              className="h-4 w-4 border-slate-300 text-blue-600 focus:ring-blue-600 focus:ring-offset-0 disabled:opacity-50"
                              onChange={(event) => setPolicies((current) => ({ ...current, [policy.id]: event.target.value }))}
                            />
                            <span className="capitalize">{option}</span>
                          </label>
                        ))}
                      </div>
                    ) : null}

                    {error ? (
                      <p className="mt-2 flex items-center gap-1.5 text-[13px] font-bold text-red-600">
                        <AlertCircle size={14} className="shrink-0" />
                        <span>{error}</span>
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        <section className="pt-8 border-t border-slate-200">
          <h4 className="text-lg font-bold text-slate-900 mb-6">Parent Certification and Signature</h4>
          <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-slate-600 outline-none">
            {form.definition.signature?.legalText ||
              'I confirm that the information submitted is accurate and that I am the parent or legal guardian for the listed child or children.'}
          </p>

          {form.settings.requireAcknowledgments ? (
            <div className="mt-6 space-y-3">
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
                  <label key={item.key} className="flex items-start gap-3 text-[15px] text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={(event) =>
                        setAcknowledgments((current) => ({
                          ...current,
                          [key]: event.target.checked
                        }))
                      }
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600 focus:ring-offset-0 disabled:opacity-50"
                    />
                    <div className="flex flex-col">
                      <span className="select-none tracking-wide text-slate-800">{item.label}</span>
                      {error ? (
                        <span className="mt-1 flex items-center gap-1.5 text-[12px] font-bold text-red-600">
                          <AlertCircle size={12} className="shrink-0" />
                          {error}
                        </span>
                      ) : null}
                    </div>
                  </label>
                );
              })}
            </div>
          ) : null}

          <div className="mt-8 grid gap-x-8 gap-y-6 md:grid-cols-2">
            <label className="block relative">
              <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-blue-600">Printed Parent or Guardian Name *</span>
              <input
                type="text"
                value={signature.printedName}
                onChange={(event) => setSignature((current) => ({ ...current, printedName: event.target.value }))}
                disabled={disabled}
                placeholder="Jane Doe"
                className={`w-full rounded-lg border px-3.5 py-3 text-[15px] outline-none transition-all duration-200 placeholder:text-slate-400 ${
                  showErrors && validation.errors['signature.printedName']
                    ? 'border-red-300 bg-red-50/40 focus:border-red-500 focus:ring-2 focus:ring-red-500/20 text-slate-900'
                    : 'border-slate-300 bg-white hover:border-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 text-slate-900'
                }`}
              />
              {showErrors && validation.errors['signature.printedName'] ? (
                <p className="mt-2 flex items-center gap-1.5 text-[13px] font-medium text-red-600">
                  <AlertCircle size={14} className="shrink-0" />
                  <span>{validation.errors['signature.printedName']}</span>
                </p>
              ) : null}
            </label>

            <label className="block relative">
              <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-blue-600">Typed Signature *</span>
              <input
                type="text"
                value={signature.typedName}
                onChange={(event) => setSignature((current) => ({ ...current, typedName: event.target.value }))}
                disabled={disabled}
                placeholder="Jane Doe"
                className={`w-full rounded-lg border px-3.5 py-3 text-[15px] outline-none transition-all duration-200 placeholder:text-slate-400 ${
                  showErrors && validation.errors['signature.typedName']
                    ? 'border-red-300 bg-red-50/40 focus:border-red-500 focus:ring-2 focus:ring-red-500/20 text-slate-900'
                    : 'border-slate-300 bg-white hover:border-slate-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20 text-slate-900 font-["Dancing_Script",cursive,serif] italic text-lg'
                }`}
              />
              {showErrors && validation.errors['signature.typedName'] ? (
                <p className="mt-2 flex items-center gap-1.5 text-[13px] font-medium text-red-600">
                  <AlertCircle size={14} className="shrink-0" />
                  <span>{validation.errors['signature.typedName']}</span>
                </p>
              ) : null}
            </label>
          </div>

          <p className="mt-6 text-[12px] text-slate-500">
            Date signed is recorded automatically when you submit checkout.
          </p>
          
          <button
            type="button"
            onClick={() => setShowErrors(true)}
            className="mt-6 w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-6 py-3.5 text-[14px] font-bold tracking-wide text-white transition-all hover:bg-slate-800 focus:outline-none focus:ring-4 focus:ring-slate-900/20"
          >
            Check Form
          </button>
        </section>
      </div>
    </div>
  );
}
