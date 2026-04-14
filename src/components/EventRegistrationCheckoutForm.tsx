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

  const hasRepeatingSections = useMemo(
    () => form.definition.sections.some((section) => !section.hidden && section.type === 'repeating_child'),
    [form.definition.sections]
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
    const controlClass = `mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none transition ${
      error
        ? 'border-red-300 bg-red-50'
        : 'border-stone-300 bg-white focus:border-red-400 focus:ring-2 focus:ring-red-100'
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
      <label key={errorKey} className="block">
        <span className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-600">{renderFieldLabel(field)}</span>
        {input}
        {field.helpText ? <p className="mt-1 text-xs text-stone-500">{field.helpText}</p> : null}
        {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
      </label>
    );
  };

  return (
    <div className="mt-6 rounded-3xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xl font-bold text-stone-900">{form.formName}</h3>
          <p className="mt-1 text-sm text-stone-600">Complete this registration form before finishing checkout.</p>
        </div>
        <button
          type="button"
          onClick={() => setShowErrors(true)}
          className="rounded-lg border border-stone-300 bg-stone-50 px-3 py-1.5 text-xs font-semibold text-stone-700 hover:bg-stone-100"
        >
          Check Form
        </button>
      </div>

      {validation.errors.childCount ? (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {validation.errors.childCount}
        </div>
      ) : null}

      <div className="mt-6 space-y-6">
        {hasRepeatingSections && childCount > 0 ? (
          <section className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h4 className="text-sm font-bold uppercase tracking-[0.12em] text-stone-700">Child Questionnaire</h4>
              <p className="text-xs text-stone-500">
                {childCount} {childCount === 1 ? 'child' : 'children'} in this registration
              </p>
            </div>
            {childCount > 1 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {Array.from({ length: childCount }, (_, index) => {
                  const isActive = activeChildIndex === index;
                  const errorCount = childErrorCounts[index] || 0;
                  return (
                    <button
                      key={`child-tab-${index}`}
                      type="button"
                      onClick={() => setActiveChildIndex(index)}
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                        isActive
                          ? 'border-stone-900 bg-stone-900 text-white'
                          : 'border-stone-300 bg-white text-stone-700 hover:border-stone-500'
                      }`}
                    >
                      <span>Child {index + 1}</span>
                      {showErrors && errorCount > 0 ? (
                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${isActive ? 'bg-white/20 text-white' : 'bg-red-100 text-red-700'}`}>
                          {errorCount}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="mt-2 text-sm font-semibold text-stone-700">Child 1</p>
            )}
          </section>
        ) : null}

        {form.definition.sections.filter((section) => !section.hidden).map((section) => {
          if (section.type === 'single') {
            const values = asRecord(sections[section.id]);
            return (
              <section key={section.id} className="rounded-2xl border border-stone-200 bg-white p-4">
                <h4 className="text-sm font-bold uppercase tracking-[0.12em] text-stone-700">{section.title}</h4>
                {section.description ? <p className="mt-1 text-sm text-stone-600">{section.description}</p> : null}
                <div className="mt-4 grid gap-4 md:grid-cols-2">
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
            <section key={section.id} className="rounded-2xl border border-stone-200 bg-white p-4">
              <h4 className="text-sm font-bold uppercase tracking-[0.12em] text-stone-700">{section.title}</h4>
              {section.description ? <p className="mt-1 text-sm text-stone-600">{section.description}</p> : null}
              {selectedRow ? (
                <div className="mt-4 rounded-2xl border border-stone-200 bg-stone-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.12em] text-red-700">
                    Child {selectedRowIndex + 1}
                    {childCount > 1 ? ` of ${childCount}` : ''}
                  </p>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
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
                <p className="mt-3 text-sm text-stone-600">No child entries available for this section.</p>
              )}
            </section>
          );
        })}

        {form.definition.policies.length > 0 ? (
          <section className="rounded-2xl border border-stone-200 bg-white p-4">
            <h4 className="text-sm font-bold uppercase tracking-[0.12em] text-stone-700">Camp Policies and Acknowledgments</h4>
            <div className="mt-4 space-y-4">
              {form.definition.policies.map((policy) => {
                const value = policies[policy.id] ?? (policy.type === 'required_checkbox' ? false : '');
                const errorKey = `policy.${policy.id}`;
                const error = showErrors ? validation.errors[errorKey] : null;

                return (
                  <div key={policy.id} className="rounded-xl border border-stone-200 bg-stone-50 p-3">
                    <p className="text-sm font-semibold text-stone-900">{policy.title}</p>
                    {policy.body ? <p className="mt-1 whitespace-pre-wrap text-sm text-stone-600">{policy.body}</p> : null}

                    {policy.type === 'required_checkbox' ? (
                      <label className="mt-2 flex items-start gap-2 text-sm text-stone-700">
                        <input
                          type="checkbox"
                          checked={value === true}
                          disabled={disabled}
                          onChange={(event) => setPolicies((current) => ({ ...current, [policy.id]: event.target.checked }))}
                          className="mt-0.5"
                        />
                        <span>{policy.label || 'I acknowledge this policy.'}</span>
                      </label>
                    ) : policy.type === 'yes_no' ? (
                      <div className="mt-2 flex gap-4">
                        {['yes', 'no'].map((option) => (
                          <label key={`${policy.id}-${option}`} className="flex items-center gap-2 text-sm text-stone-700">
                            <input
                              type="radio"
                              name={`policy-${policy.id}`}
                              value={option}
                              checked={value === option}
                              disabled={disabled}
                              onChange={(event) => setPolicies((current) => ({ ...current, [policy.id]: event.target.value }))}
                            />
                            <span>{option === 'yes' ? 'Yes' : 'No'}</span>
                          </label>
                        ))}
                      </div>
                    ) : null}

                    {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        <section className="rounded-2xl border border-stone-200 bg-white p-4">
          <h4 className="text-sm font-bold uppercase tracking-[0.12em] text-stone-700">Parent Certification and Signature</h4>
          <p className="mt-2 whitespace-pre-wrap text-sm text-stone-600">
            {form.definition.signature?.legalText ||
              'I confirm that the information submitted is accurate and that I am the parent or legal guardian for the listed child or children.'}
          </p>

          {form.settings.requireAcknowledgments ? (
            <div className="mt-4 space-y-2">
              {[
                { key: 'infoAccurate', label: 'I confirm the information provided is accurate and complete.' },
                { key: 'policiesRead', label: 'I confirm I have read and agree to the policies listed above.' },
                { key: 'emergencyCare', label: 'I authorize emergency medical care if needed.' },
                { key: 'participationRules', label: 'I understand participation and behavior rules.' }
              ].map((item) => {
                const key = item.key as keyof AcknowledgmentState;
                const error = showErrors ? validation.errors[`ack.${item.key}`] : null;

                return (
                  <label key={item.key} className="block text-sm text-stone-700">
                    <span className="inline-flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={acknowledgments[key]}
                        disabled={disabled}
                        onChange={(event) =>
                          setAcknowledgments((current) => ({
                            ...current,
                            [key]: event.target.checked
                          }))
                        }
                        className="mt-0.5"
                      />
                      <span>{item.label}</span>
                    </span>
                    {error ? <span className="ml-6 block text-xs text-red-600">{error}</span> : null}
                  </label>
                );
              })}
            </div>
          ) : null}

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-600">Printed Parent or Guardian Name *</span>
              <input
                type="text"
                value={signature.printedName}
                onChange={(event) => setSignature((current) => ({ ...current, printedName: event.target.value }))}
                disabled={disabled}
                className={`mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none transition ${
                  showErrors && validation.errors['signature.printedName']
                    ? 'border-red-300 bg-red-50'
                    : 'border-stone-300 bg-white focus:border-red-400 focus:ring-2 focus:ring-red-100'
                }`}
              />
              {showErrors && validation.errors['signature.printedName'] ? (
                <p className="mt-1 text-xs text-red-600">{validation.errors['signature.printedName']}</p>
              ) : null}
            </label>

            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-600">Typed Signature *</span>
              <input
                type="text"
                value={signature.typedName}
                onChange={(event) => setSignature((current) => ({ ...current, typedName: event.target.value }))}
                disabled={disabled}
                className={`mt-1 w-full rounded-xl border px-3 py-2 text-sm outline-none transition ${
                  showErrors && validation.errors['signature.typedName']
                    ? 'border-red-300 bg-red-50'
                    : 'border-stone-300 bg-white focus:border-red-400 focus:ring-2 focus:ring-red-100'
                }`}
              />
              {showErrors && validation.errors['signature.typedName'] ? (
                <p className="mt-1 text-xs text-red-600">{validation.errors['signature.typedName']}</p>
              ) : null}
            </label>
          </div>

          <p className="mt-3 text-xs text-stone-500">Date signed is recorded automatically when you submit checkout.</p>
        </section>
      </div>
    </div>
  );
}