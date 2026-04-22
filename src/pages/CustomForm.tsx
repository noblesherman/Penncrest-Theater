/*
Handoff note for Mr. Smith:
- File: `src/pages/CustomForm.tsx`
- What this is: Public web route page.
- What it does: Renders a full user-facing page for the theater site.
- Connections: Registered in `src/App.tsx` and backed by shared components/helpers in `src/components` + `src/lib`.
- Main content type: Page layout + visible text + route-level logic.
- Safe edits here: Wording, headings, section order, and styling tweaks.
- Be careful with: Form payloads, URL param handling, and API response assumptions.
- Useful context: This folder is one of the most common edit points for visible site content.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiFetch } from '../lib/api';

type CustomFormFieldType = 'short_text' | 'long_text' | 'email' | 'phone' | 'number' | 'date' | 'dropdown' | 'checkbox';

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

type PublicCustomForm = {
  id: string;
  publicSlug: string;
  formName: string;
  internalDescription?: string | null;
  schemaVersion: string;
  definition: CustomFormDefinition;
};

type SubmissionResponse = {
  submissionId: string;
  submittedAt: string;
};

function normalizeDefinition(raw: CustomFormDefinition | undefined): CustomFormDefinition {
  const fields = Array.isArray(raw?.fields) ? raw.fields : [];
  return {
    schemaVersion: raw?.schemaVersion || 'CUSTOM_FORM_V1',
    introText: raw?.introText || '',
    successMessage: raw?.successMessage || 'Thanks! Your response has been submitted.',
    submitButtonLabel: raw?.submitButtonLabel || 'Submit',
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
            ? Array.from(new Set((Array.isArray(field.options) ? field.options : []).map((option) => option.trim()).filter(Boolean)))
            : []
      }))
      .filter((field) => field.id && field.label)
  };
}

function fieldInputClass(hasError: boolean): string {
  return `w-full rounded-lg border px-3 py-2 text-sm text-stone-900 transition focus:outline-none ${
    hasError
      ? 'border-red-300 bg-red-50/30 focus:border-red-400'
      : 'border-stone-200 bg-white focus:border-stone-400'
  }`;
}

export default function CustomFormPage() {
  const { slug = '' } = useParams();
  const [formMeta, setFormMeta] = useState<PublicCustomForm | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string | boolean>>({});
  const [submitted, setSubmitted] = useState<SubmissionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    setError(null);
    setSubmitted(null);

    void apiFetch<PublicCustomForm>(`/api/forms/custom/${slug}`)
      .then((data) => {
        const normalized = normalizeDefinition(data.definition);
        setFormMeta({ ...data, definition: normalized });
        setFormValues(
          Object.fromEntries(
            normalized.fields
              .filter((field) => !field.hidden)
              .map((field) => [field.id, field.type === 'checkbox' ? false : ''])
          )
        );
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to load form.'))
      .finally(() => setLoading(false));
  }, [slug]);

  const visibleFields = useMemo(
    () => (formMeta ? formMeta.definition.fields.filter((field) => !field.hidden) : []),
    [formMeta]
  );

  function setValue(id: string, value: string | boolean): void {
    setFormValues((previous) => ({ ...previous, [id]: value }));
    setFieldErrors((previous) => {
      if (!previous[id]) return previous;
      const next = { ...previous };
      delete next[id];
      return next;
    });
  }

  function validate(): boolean {
    const nextErrors: Record<string, string> = {};

    for (const field of visibleFields) {
      const value = formValues[field.id];

      if (field.type === 'checkbox') {
        if (field.required && value !== true) {
          nextErrors[field.id] = `${field.label} is required.`;
        }
        continue;
      }

      const text = String(value || '').trim();
      if (field.required && !text) {
        nextErrors[field.id] = `${field.label} is required.`;
        continue;
      }

      if (!text) continue;

      if (field.type === 'email') {
        const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
        if (!emailOk) nextErrors[field.id] = 'Enter a valid email.';
      }

      if (field.type === 'dropdown' && !field.options.includes(text)) {
        nextErrors[field.id] = 'Choose one of the listed options.';
      }

      if (field.type === 'number' && !Number.isFinite(Number(text))) {
        nextErrors[field.id] = 'Enter a valid number.';
      }
    }

    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!formMeta) return;

    if (!validate()) {
      setError('Please fix the highlighted fields.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const payload: Record<string, unknown> = {};

      for (const field of visibleFields) {
        const value = formValues[field.id];

        if (field.type === 'checkbox') {
          if (value === true || field.required) payload[field.id] = value === true;
          continue;
        }

        const text = String(value || '').trim();
        if (!text) continue;

        if (field.type === 'number') {
          payload[field.id] = Number(text);
        } else {
          payload[field.id] = text;
        }
      }

      const result = await apiFetch<SubmissionResponse>(`/api/forms/custom/${formMeta.publicSlug}/submissions`, {
        method: 'POST',
        body: JSON.stringify({ responses: payload })
      });

      setSubmitted(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to submit form.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="flex min-h-[50vh] items-center justify-center text-stone-500">Loading form...</div>;
  }

  if (!formMeta) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <div className="rounded-2xl border border-stone-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-xl font-bold text-stone-900">Form not found</h1>
          <p className="mt-2 text-sm text-stone-600">This form may be archived or not published yet.</p>
          <div className="mt-4">
            <Link to="/" className="text-sm font-semibold text-red-700 hover:text-red-800">
              Return home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <div className="rounded-2xl border border-emerald-200 bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-black text-stone-900">Thanks for your response.</h1>
          <p className="mt-2 text-sm text-stone-700">
            {formMeta.definition.successMessage || 'Your submission has been received.'}
          </p>
          <p className="mt-1 text-xs text-stone-500">Submitted on {new Date(submitted.submittedAt).toLocaleString()}</p>
          <div className="mt-5">
            <Link to="/" className="inline-flex items-center rounded-lg bg-stone-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black">
              Back to Penncrest Theater
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden px-4 py-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(239,68,68,0.12),transparent_40%),radial-gradient(circle_at_80%_0%,rgba(234,179,8,0.1),transparent_35%)]" />
      <div className="relative mx-auto max-w-3xl rounded-3xl border border-stone-200 bg-white/95 p-6 shadow-xl sm:p-8">
        <div className="mb-6">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-red-700">Penncrest Theater</div>
          <h1 className="mt-2 text-3xl font-black text-stone-900 sm:text-4xl">{formMeta.formName}</h1>
          {formMeta.definition.introText ? (
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-stone-700">{formMeta.definition.introText}</p>
          ) : null}
        </div>

        {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
          {visibleFields.map((field) => (
            <div key={field.id} className="space-y-1.5">
              <label className="block text-sm font-semibold text-stone-800" htmlFor={`custom-form-${field.id}`}>
                {field.label}
                {field.required ? <span className="ml-1 text-red-600">*</span> : null}
              </label>

              {field.type === 'long_text' && (
                <textarea
                  id={`custom-form-${field.id}`}
                  className={`${fieldInputClass(Boolean(fieldErrors[field.id]))} min-h-[110px] resize-y`}
                  placeholder={field.placeholder || ''}
                  value={String(formValues[field.id] || '')}
                  onChange={(event) => setValue(field.id, event.target.value)}
                />
              )}

              {field.type === 'dropdown' && (
                <select
                  id={`custom-form-${field.id}`}
                  className={fieldInputClass(Boolean(fieldErrors[field.id]))}
                  value={String(formValues[field.id] || '')}
                  onChange={(event) => setValue(field.id, event.target.value)}
                >
                  <option value="">Select an option</option>
                  {field.options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              )}

              {field.type === 'checkbox' && (
                <label className="inline-flex items-center gap-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700">
                  <input
                    id={`custom-form-${field.id}`}
                    type="checkbox"
                    checked={Boolean(formValues[field.id])}
                    onChange={(event) => setValue(field.id, event.target.checked)}
                  />
                  <span>I agree</span>
                </label>
              )}

              {!['long_text', 'dropdown', 'checkbox'].includes(field.type) && (
                <input
                  id={`custom-form-${field.id}`}
                  className={fieldInputClass(Boolean(fieldErrors[field.id]))}
                  placeholder={field.placeholder || ''}
                  type={
                    field.type === 'email'
                      ? 'email'
                      : field.type === 'phone'
                        ? 'tel'
                        : field.type === 'number'
                          ? 'number'
                          : field.type === 'date'
                            ? 'date'
                            : 'text'
                  }
                  value={String(formValues[field.id] || '')}
                  onChange={(event) => setValue(field.id, event.target.value)}
                />
              )}

              {field.helpText ? <div className="text-xs text-stone-500">{field.helpText}</div> : null}
              {fieldErrors[field.id] ? <div className="text-xs font-semibold text-red-600">{fieldErrors[field.id]}</div> : null}
            </div>
          ))}

          <button
            type="submit"
            disabled={submitting}
            className="mt-2 inline-flex w-full items-center justify-center rounded-xl bg-red-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Submitting...' : formMeta.definition.submitButtonLabel || 'Submit'}
          </button>
        </form>
      </div>
    </div>
  );
}
