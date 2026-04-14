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
  submitButtonLabel?: string;
  disabled?: boolean;
  onSubmit?: () => void;
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
  submitButtonLabel = 'Continue to Checkout',
  disabled = false,
  onSubmit,
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
    const baseControlClass = "w-full rounded-xl border px-3.5 py-3 text-[15px] font-medium outline-none transition-all duration-200 placeholder:text-stone-400 sm:px-4 sm:py-3.5";
    const controlClass = error
      ? `${baseControlClass} border-red-300 bg-red-50 text-stone-900 focus:border-red-500 focus:ring-4 focus:ring-red-500/10`
      : `${baseControlClass} border-stone-300 bg-stone-50 text-stone-900 hover:border-stone-400 hover:bg-white focus:bg-white focus:border-[#C10008] focus:ring-4 focus:ring-[#C10008]/10 shadow-sm`;

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
        <div className="space-y-2.5 rounded-xl border border-stone-200 bg-stone-50 p-3.5 shadow-sm sm:space-y-3 sm:p-4">
          {(field.options || []).map((option) => {
            const checked = selected.includes(option);
            return (
              <label key={option} className="flex items-start gap-3 text-[15px] font-medium text-stone-700 cursor-pointer hover:text-[#C10008] transition-colors">
                <div className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-all ${checked ? 'bg-[#C10008] border-[#C10008]' : 'bg-white border-stone-300'}`}>
                  {checked && <Check size={14} className="text-white" strokeWidth={3} />}
                </div>
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
                  className="sr-only"
                />
                <span>{option}</span>
              </label>
            );
          })}
        </div>
      );
    } else if (field.type === 'checkbox') {
      input = (
        <label className="flex items-start gap-3 text-[15px] font-medium text-stone-700 cursor-pointer hover:text-[#C10008] transition-colors">
          <div className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-all ${value === true ? 'bg-[#C10008] border-[#C10008]' : 'bg-white border-stone-300'}`}>
            {value === true && <Check size={14} className="text-white" strokeWidth={3} />}
          </div>
          <input
            type="checkbox"
            checked={value === true}
            onChange={(event) => onValueChange(event.target.checked)}
            disabled={disabled}
            className="sr-only"
          />
          <span>{field.helpText || field.label}</span>
        </label>
      );
    } else if (field.type === 'radio_yes_no') {
      const radioValue = normalizeYesNo(value);
      input = (
        <div className="flex flex-wrap gap-4">
          {['yes', 'no'].map((option) => (
            <label key={option} className={`flex items-center gap-3 rounded-xl border px-4 py-2.5 text-[14px] font-bold cursor-pointer transition-all shadow-sm sm:px-5 sm:py-3 sm:text-[15px] ${radioValue === option ? 'border-[#C10008] bg-[#C10008]/5 text-[#C10008]' : 'border-stone-200 bg-stone-50 text-stone-600 hover:border-stone-300 hover:bg-white'}`}>
              <div className={`flex h-5 w-5 items-center justify-center rounded-full border transition-all ${radioValue === option ? 'border-[#C10008]' : 'border-stone-300 bg-white'}`}>
                {radioValue === option && <div className="h-2.5 w-2.5 rounded-full bg-[#C10008]" />}
              </div>
              <input
                type="radio"
                value={option}
                checked={radioValue === option}
                onChange={(event) => onValueChange(event.target.value)}
                disabled={disabled}
                className="sr-only"
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
      <label key={errorKey} id={`field-${errorKey.replace(/[[\]\.]/g, '-')}`} className="block relative group">
        <span className="mb-2 block text-xs font-black uppercase tracking-wider text-[#C10008]">
          {renderFieldLabel(field)}
        </span>
        {input}
        {field.helpText && field.type !== 'checkbox' ? (
          <p className="mt-2.5 text-sm text-stone-500 font-medium">{field.helpText}</p>
        ) : null}
        {error ? (
          <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-600 animate-in slide-in-from-top-1 fade-in">
            <AlertCircle size={16} className="shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}
      </label>
    );
  };

  return (
    <div className="mt-5 flex flex-col gap-4 sm:mt-8 sm:gap-6">
      {validation.errors.childCount ? (
        <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 shadow-sm sm:gap-4 sm:p-5">
          <AlertCircle className="mt-0.5 text-red-500 shrink-0" size={20} />
          <div>
            <h4 className="text-base font-bold text-red-900">Issue detected</h4>
            <p className="text-[15px] font-medium text-red-700 mt-1">{validation.errors.childCount}</p>
          </div>
        </div>
      ) : null}

      <div className="space-y-4 sm:space-y-6">
        {form.definition.sections.filter((section) => !section.hidden).map((section) => {
          if (section.type === 'single') {
            const values = asRecord(sections[section.id]);
            return (
              <section key={section.id} className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-8">
                {section.title && (
                  <div className="mb-5 border-b border-stone-100 pb-4 sm:mb-8 sm:pb-5">
                    <h4 className="text-lg font-black text-stone-900 sm:text-xl">{section.title}</h4>
                    {section.description ? <p className="mt-1.5 text-[14px] leading-relaxed font-medium text-stone-500 sm:mt-2 sm:text-[15px]">{section.description}</p> : null}
                  </div>
                )}
                {(() => {
                  const visibleFields = section.fields
                    .filter((field) => !field.hidden)
                    .filter((field) => isFieldVisible(field, values));
                  return (
                    <div className="flex flex-col items-start gap-x-8 gap-y-5 md:flex-row sm:gap-y-8">
                      <div className="flex w-full flex-1 flex-col gap-y-5 sm:gap-y-8">
                        {visibleFields.filter((_, index) => index % 2 === 0).map((field) =>
                          renderField(
                            field,
                            values[field.id] ?? fieldDefaultValue(field.type),
                            (next) => setSingleValue(section.id, field.id, next),
                            `${section.id}.${field.id}`
                          )
                        )}
                      </div>
                      {visibleFields.length > 1 && (
                        <div className="flex w-full flex-1 flex-col gap-y-5 sm:gap-y-8">
                          {visibleFields.filter((_, index) => index % 2 !== 0).map((field) =>
                            renderField(
                              field,
                              values[field.id] ?? fieldDefaultValue(field.type),
                              (next) => setSingleValue(section.id, field.id, next),
                              `${section.id}.${field.id}`
                            )
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </section>
            );
          }

          const rows = asRecordArray(sections[section.id]);
          const selectedRowIndex = rows.length > 0 ? Math.min(activeChildIndex, rows.length - 1) : 0;
          const selectedRow = rows[selectedRowIndex];

          return (
            <section key={section.id} className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-8">
              {section.title && (
                <div className="mb-5 border-b border-stone-100 pb-4 sm:mb-8 sm:pb-5">
                  <h4 className="text-lg font-black text-stone-900 sm:text-xl">{section.title}</h4>
                  {section.description ? <p className="mt-1.5 text-[14px] leading-relaxed font-medium text-stone-500 sm:mt-2 sm:text-[15px]">{section.description}</p> : null}
                </div>
              )}
              
              {childCount > 0 ? (
                childCount > 1 ? (
                  <div className="mb-5 flex flex-wrap gap-2.5 rounded-2xl border border-stone-100 bg-stone-50 p-2 sm:mb-8 sm:gap-3">
                    {Array.from({ length: childCount }, (_, index) => {
                      const isActive = activeChildIndex === index;
                      const errorCount = childErrorCounts[index] || 0;
                      
                      let displayName = `Kid #${index + 1}`;
                      for (const s of form.definition.sections) {
                        if (s.hidden || s.type === 'single') continue;
                        const nameF = s.fields.find(f => f.label.toLowerCase().includes('first name') || f.label.toLowerCase().includes('camper name') || f.label.toLowerCase().includes('name'));
                        if (nameF) {
                          const r = asRecordArray(sections[s.id])[index] || {};
                          if (r[nameF.id] && String(r[nameF.id]).trim()) {
                            displayName = String(r[nameF.id]).trim().split(' ')[0];
                            break;
                          }
                        }
                      }

                      return (
                        <button
                          key={`${section.id}-child-tab-${index}`}
                          type="button"
                          onClick={() => setActiveChildIndex(index)}
                          className={`relative inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-3.5 py-2.5 text-[14px] font-bold transition-all focus:outline-none sm:flex-none sm:px-6 sm:py-3 sm:text-[15px] ${
                            isActive
                              ? 'bg-white text-[#C10008] shadow-sm border border-stone-200'
                              : 'bg-transparent text-stone-600 hover:bg-stone-200/50'
                          }`}
                        >
                          {displayName}
                          {showErrors && errorCount > 0 ? (
                            <span
                              className={`inline-flex items-center justify-center rounded-full h-5 w-5 text-[10px] font-black ${
                                isActive ? 'bg-red-100 text-red-600' : 'bg-red-50 text-red-500 border border-red-100'
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
                <div className="pt-1 sm:pt-2">
                  {(() => {
                    const visibleFields = section.fields
                      .filter((field) => !field.hidden)
                      .filter((field) => isFieldVisible(field, selectedRow));
                    return (
                      <div className="flex flex-col items-start gap-x-8 gap-y-5 md:flex-row sm:gap-y-8">
                        <div className="flex w-full flex-1 flex-col gap-y-5 sm:gap-y-8">
                          {visibleFields.filter((_, index) => index % 2 === 0).map((field) =>
                            renderField(
                              field,
                              selectedRow[field.id] ?? fieldDefaultValue(field.type),
                              (next) => setRepeatingValue(section.id, selectedRowIndex, field.id, next),
                              `${section.id}[${selectedRowIndex}].${field.id}`
                            )
                          )}
                        </div>
                        {visibleFields.length > 1 && (
                          <div className="flex w-full flex-1 flex-col gap-y-5 sm:gap-y-8">
                            {visibleFields.filter((_, index) => index % 2 !== 0).map((field) =>
                              renderField(
                                field,
                                selectedRow[field.id] ?? fieldDefaultValue(field.type),
                                (next) => setRepeatingValue(section.id, selectedRowIndex, field.id, next),
                                `${section.id}[${selectedRowIndex}].${field.id}`
                              )
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-stone-300 bg-stone-50 py-8 sm:py-12">
                  <p className="text-[14px] font-bold text-stone-500 sm:text-[15px]">No entries available for this section.</p>
                </div>
              )}
            </section>
          );
        })}

        {form.definition.policies.length > 0 ? (
          <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-8">
            <div className="mb-5 border-b border-stone-100 pb-4 sm:mb-8 sm:pb-5">
              <h4 className="text-lg font-black text-stone-900 sm:text-xl">Camp Policies and Acknowledgments</h4>
            </div>
            <div className="space-y-5 sm:space-y-8">
              {form.definition.policies.map((policy) => {
                const value = policies[policy.id] ?? (policy.type === 'required_checkbox' ? false : '');
                const errorKey = `policy.${policy.id}`;
                const error = showErrors ? validation.errors[errorKey] : null;

                return (
                  <div key={policy.id} id={`field-policy-${policy.id}`} className="rounded-2xl border border-stone-200 bg-stone-50 p-4 sm:p-6">
                    <p className="text-base font-black text-stone-900 sm:text-lg">{policy.title}</p>
                    {policy.body ? <p className="mt-2.5 whitespace-pre-wrap text-[14px] font-medium leading-relaxed text-stone-600 sm:mt-3 sm:text-[15px]">{policy.body}</p> : null}

                    {policy.type === 'required_checkbox' ? (
                      <label className="mt-5 flex items-start gap-3 text-[14px] font-bold text-stone-800 cursor-pointer group sm:mt-6 sm:gap-4 sm:text-[15px]">
                        <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border transition-all ${value === true ? 'bg-[#C10008] border-[#C10008]' : 'bg-white border-stone-300 group-hover:border-[#C10008]'}`}>
                          {value === true && <Check size={16} className="text-white" strokeWidth={3} />}
                        </div>
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={value === true}
                          disabled={disabled}
                          onChange={(event) => setPolicies((current) => ({ ...current, [policy.id]: event.target.checked }))}
                        />
                        <span className="select-none mt-0.5">{policy.label || 'I acknowledge this policy.'}</span>
                      </label>
                    ) : policy.type === 'yes_no' ? (
                      <div className="mt-5 flex gap-5 sm:mt-6 sm:gap-6">
                        {['yes', 'no'].map((option) => (
                          <label key={`${policy.id}-${option}`} className="flex items-center gap-3 cursor-pointer group">
                            <div className={`flex h-6 w-6 items-center justify-center rounded-full border transition-all ${value === option ? 'border-[#C10008]' : 'border-stone-300 bg-white group-hover:border-[#C10008]'}`}>
                              {value === option && <div className="h-3 w-3 rounded-full bg-[#C10008]" />}
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
                            <span className="text-[15px] font-bold capitalize text-stone-800 transition-colors group-hover:text-[#C10008] sm:text-[17px]">{option}</span>
                          </label>
                        ))}
                      </div>
                    ) : null}

                    {error ? (
                      <div className="mt-4 flex w-max items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[14px] font-bold text-red-600">
                        <AlertCircle size={16} className="shrink-0" />
                        <span>{error}</span>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-8">
          <div className="mb-5 border-b border-stone-100 pb-4 sm:mb-8 sm:pb-5">
            <h4 className="text-lg font-black text-stone-900 sm:text-xl">Parent Certification and Signature</h4>
          </div>
          <p className="whitespace-pre-wrap rounded-xl border border-stone-200 bg-stone-50 p-4 text-[14px] font-medium leading-relaxed text-stone-700 sm:p-5 sm:text-[15px]">
            {form.definition.signature?.legalText ||
              'I confirm that the information submitted is accurate and that I am the parent or legal guardian for the listed child or children.'}
          </p>

          {form.settings.requireAcknowledgments ? (
            <div className="mt-6 space-y-4 sm:mt-8">
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
                  <label key={item.key} id={`field-ack-${item.key}`} className="flex items-start gap-3 text-[14px] font-bold text-stone-800 cursor-pointer group sm:gap-4 sm:text-[15px]">
                    <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border transition-all ${checked ? 'bg-[#C10008] border-[#C10008]' : 'bg-white border-stone-300 group-hover:border-[#C10008]'}`}>
                      {checked && <Check size={16} className="text-white" strokeWidth={3} />}
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
                    <div className="flex flex-col mt-0.5">
                      <span className="select-none tracking-wide">{item.label}</span>
                      {error ? (
                        <div className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-[12px] font-bold text-red-600 w-max">
                          <AlertCircle size={14} className="shrink-0" />
                          {error}
                        </div>
                      ) : null}
                    </div>
                  </label>
                );
              })}
            </div>
          ) : null}

          <div className="mt-6 grid gap-x-6 gap-y-5 md:grid-cols-2 sm:mt-10 sm:gap-x-8 sm:gap-y-8">
            <label id="field-signature-printedName" className="block relative">
              <span className="mb-2 block text-xs font-black uppercase tracking-wider text-[#C10008]">Printed Parent or Guardian Name *</span>
              <input
                type="text"
                value={signature.printedName}
                onChange={(event) => setSignature((current) => ({ ...current, printedName: event.target.value }))}
                disabled={disabled}
                placeholder="Jane Doe"
                className={`w-full rounded-xl border px-4 py-3.5 text-[15px] font-medium outline-none transition-all duration-200 placeholder:text-stone-400 shadow-sm ${
                  showErrors && validation.errors['signature.printedName']
                    ? 'border-red-300 bg-red-50 focus:border-red-500 focus:ring-4 focus:ring-red-500/10 text-stone-900'
                    : 'border-stone-300 bg-stone-50 hover:border-stone-400 hover:bg-white focus:bg-white focus:border-[#C10008] focus:ring-4 focus:ring-[#C10008]/10 text-stone-900'
                }`}
              />
              {showErrors && validation.errors['signature.printedName'] ? (
                <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-600">
                  <AlertCircle size={16} className="shrink-0" />
                  <span>{validation.errors['signature.printedName']}</span>
                </div>
              ) : null}
            </label>

            <label id="field-signature-typedName" className="block relative">
              <span className="mb-2 block text-xs font-black uppercase tracking-wider text-[#C10008]">Typed Signature *</span>
              <input
                type="text"
                value={signature.typedName}
                onChange={(event) => setSignature((current) => ({ ...current, typedName: event.target.value }))}
                disabled={disabled}
                placeholder="Jane Doe"
                className={`w-full rounded-xl border px-4 py-3.5 text-lg font-["Dancing_Script",cursive,serif] italic outline-none transition-all duration-200 placeholder:text-stone-400 shadow-sm placeholder:font-sans placeholder:not-italic ${
                  showErrors && validation.errors['signature.typedName']
                    ? 'border-red-300 bg-red-50 focus:border-red-500 focus:ring-4 focus:ring-red-500/10 text-stone-900'
                    : 'border-stone-300 bg-stone-50 hover:border-stone-400 hover:bg-white focus:bg-white focus:border-[#C10008] focus:ring-4 focus:ring-[#C10008]/10 text-stone-900'
                }`}
              />
              {showErrors && validation.errors['signature.typedName'] ? (
                <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-600">
                  <AlertCircle size={16} className="shrink-0" />
                  <span>{validation.errors['signature.typedName']}</span>
                </div>
              ) : null}
            </label>
          </div>

          <p className="mt-6 text-[13px] font-bold text-stone-400 uppercase tracking-wide">
            Date signed is recorded automatically when you submit checkout.
          </p>
          
          <div className="mt-6 flex border-t border-stone-100 pt-6 sm:mt-8 sm:justify-end sm:pt-8">
            <button
              type="button"
              onClick={() => {
                setShowErrors(true);
                if (validation.valid) {
                  if (onSubmit) onSubmit();
                } else {
                  const firstErrorKey = Object.keys(validation.errors)[0];
                  if (firstErrorKey) {
                    const match = firstErrorKey.match(/\[(\d+)\]\./);
                    if (match) {
                      setActiveChildIndex(Number(match[1]));
                    }
                    setTimeout(() => {
                      const idToFind = `field-${firstErrorKey.replace(/[[\]\.]/g, '-')}`;
                      const el = document.getElementById(idToFind);
                      if (el) {
                        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }
                    }, 50);
                  }
                }
              }}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-stone-900 px-6 py-3.5 text-[14px] font-bold tracking-wide text-white transition-all hover:bg-[#C10008] focus:outline-none focus:ring-4 focus:ring-[#C10008]/20 shadow-md hover:shadow-lg sm:w-auto sm:px-8 sm:py-4 sm:text-[15px]"
            >
              {submitButtonLabel}
              <ChevronRight size={18} className="translate-y-[0.5px]" />
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
