/*
Handoff note for Mr. Smith:
- File: `src/pages/ProgramBioForm.tsx`
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

type PublicProgramBioForm = {
  id: string;
  publicSlug: string;
  schemaVersion: string;
  title: string;
  instructions: string;
  deadlineAt: string;
  isOpen: boolean;
  acceptingResponses: boolean;
  closedMessage: string;
  show: {
    id: string;
    title: string;
  };
  requiredFields: string[];
  questions?: Partial<ProgramBioQuestions> & {
    customQuestions?: ProgramBioCustomQuestion[];
  };
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

type SubmissionResult = {
  submissionId: string;
  updatedExisting: boolean;
  submittedAt: string;
  updatedAt: string;
};

type FormState = {
  fullName: string;
  schoolEmail: string;
  gradeLevel: string;
  roleInShow: string;
  bio: string;
  customResponses: Record<string, string>;
};

const MAX_WORDS = 120;
const REQUIRED_SCHOOL_EMAIL_DOMAIN = 'rtmsd.org';

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
  customQuestions: []
};

function countWords(value: string): number {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function hasRequiredSchoolEmailDomain(email: string): boolean {
  return email.trim().toLowerCase().endsWith(`@${REQUIRED_SCHOOL_EMAIL_DOMAIN}`);
}

function normalizeCustomQuestions(value: ProgramBioCustomQuestion[] | undefined): ProgramBioCustomQuestion[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((question) => {
      const type: ProgramBioCustomQuestionType =
        question?.type === 'long_text' || question?.type === 'multiple_choice'
          ? question.type
          : 'short_text';
      return {
        id: (question?.id || '').trim(),
        label: (question?.label || '').trim(),
        type,
        required: Boolean(question?.required),
        hidden: Boolean(question?.hidden),
        options: type === 'multiple_choice'
          ? Array.from(new Set((Array.isArray(question?.options) ? question.options : []).map((option) => option.trim()).filter(Boolean)))
          : []
      };
    })
    .filter((question) => question.id && question.label && (question.type !== 'multiple_choice' || question.options.length >= 2));
}

async function imageFileToDataUrl(file: File, maxWidth: number, maxHeight: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('We hit a small backstage snag while trying to read image.'));
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('We hit a small backstage snag while trying to load image.'));
        return;
      }

      const image = new Image();
      image.onerror = () => reject(new Error('We hit a small backstage snag while trying to parse image.'));
      image.onload = () => {
        const ratio = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
        const width = Math.max(1, Math.round(image.width * ratio));
        const height = Math.max(1, Math.round(image.height * ratio));

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const context = canvas.getContext('2d');
        if (!context) {
          reject(new Error('Canvas is not available in this browser.'));
          return;
        }

        context.drawImage(image, 0, 0, width, height);
        const mime = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
        resolve(canvas.toDataURL(mime, mime === 'image/png' ? undefined : 0.86));
      };

      image.src = reader.result;
    };

    reader.readAsDataURL(file);
  });
}

export default function ProgramBioFormPage() {
  const { slug = '' } = useParams();
  const [formMeta, setFormMeta] = useState<PublicProgramBioForm | null>(null);
  const [formState, setFormState] = useState<FormState>({
    fullName: '',
    schoolEmail: '',
    gradeLevel: '',
    roleInShow: '',
    bio: '',
    customResponses: {}
  });
  const [headshotFile, setHeadshotFile] = useState<File | null>(null);
  const [result, setResult] = useState<SubmissionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    setError(null);
    void apiFetch<PublicProgramBioForm>(`/api/forms/${slug}`)
      .then((data) => setFormMeta(data))
      .catch((err) => setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to load form'))
      .finally(() => setLoading(false));
  }, [slug]);

  const bioWordCount = useMemo(() => countWords(formState.bio), [formState.bio]);
  const customQuestions = useMemo(
    () => normalizeCustomQuestions(formMeta?.questions?.customQuestions),
    [formMeta]
  );
  const questionLabels: ProgramBioQuestions = useMemo(() => ({
    ...DEFAULT_PROGRAM_BIO_QUESTIONS,
    ...(formMeta?.questions || {}),
    customQuestions
  }), [customQuestions, formMeta?.questions]);
  const requiredFieldSet = useMemo(
    () => new Set(formMeta?.requiredFields || []),
    [formMeta?.requiredFields]
  );
  const baseFieldConfig = useMemo(
    () => ({
      fullName: {
        enabled: questionLabels.fullNameEnabled,
        required: questionLabels.fullNameEnabled && (questionLabels.fullNameRequired || requiredFieldSet.has('fullName'))
      },
      schoolEmail: {
        enabled: questionLabels.schoolEmailEnabled,
        required: questionLabels.schoolEmailEnabled && (questionLabels.schoolEmailRequired || requiredFieldSet.has('schoolEmail'))
      },
      gradeLevel: {
        enabled: questionLabels.gradeLevelEnabled,
        required: questionLabels.gradeLevelEnabled && (questionLabels.gradeLevelRequired || requiredFieldSet.has('gradeLevel'))
      },
      roleInShow: {
        enabled: questionLabels.roleInShowEnabled,
        required: questionLabels.roleInShowEnabled && (questionLabels.roleInShowRequired || requiredFieldSet.has('roleInShow'))
      },
      bio: {
        enabled: questionLabels.bioEnabled,
        required: questionLabels.bioEnabled && (questionLabels.bioRequired || requiredFieldSet.has('bio'))
      },
      headshot: {
        enabled: questionLabels.headshotEnabled,
        required: questionLabels.headshotEnabled && (questionLabels.headshotRequired || requiredFieldSet.has('headshotDataUrl'))
      }
    }),
    [questionLabels, requiredFieldSet]
  );
  const visibleCustomQuestions = useMemo(
    () => customQuestions.filter((question) => !question.hidden),
    [customQuestions]
  );

  useEffect(() => {
    if (!formMeta) return;
    setFormState((current) => ({
      ...current,
      customResponses: Object.fromEntries(
        visibleCustomQuestions.map((question) => [question.id, current.customResponses[question.id] || ''])
      )
    }));
  }, [formMeta, visibleCustomQuestions]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!formMeta) return;

    const fullNameInput = baseFieldConfig.fullName.enabled ? formState.fullName.trim() : '';
    const schoolEmailInput = baseFieldConfig.schoolEmail.enabled ? formState.schoolEmail.trim() : '';
    const gradeLevelInput = baseFieldConfig.gradeLevel.enabled ? formState.gradeLevel : '';
    const roleInShowInput = baseFieldConfig.roleInShow.enabled ? formState.roleInShow.trim() : '';
    const bioInput = baseFieldConfig.bio.enabled ? formState.bio.trim() : '';

    if (baseFieldConfig.fullName.required && !fullNameInput) {
      setError(`${questionLabels.fullNameLabel} is required.`);
      return;
    }

    if (baseFieldConfig.schoolEmail.required && !schoolEmailInput) {
      setError(`${questionLabels.schoolEmailLabel} is required.`);
      return;
    }

    if (schoolEmailInput && !hasRequiredSchoolEmailDomain(schoolEmailInput)) {
      setError(`Use your school email ending in @${REQUIRED_SCHOOL_EMAIL_DOMAIN}.`);
      return;
    }

    if (baseFieldConfig.gradeLevel.required && !gradeLevelInput) {
      setError(`${questionLabels.gradeLevelLabel} is required.`);
      return;
    }

    if (baseFieldConfig.roleInShow.required && !roleInShowInput) {
      setError(`${questionLabels.roleInShowLabel} is required.`);
      return;
    }

    if (baseFieldConfig.bio.required && !bioInput) {
      setError(`${questionLabels.bioLabel} is required.`);
      return;
    }

    if (baseFieldConfig.headshot.required && !headshotFile) {
      setError(`${questionLabels.headshotLabel} is required.`);
      return;
    }

    if (bioInput && bioWordCount > MAX_WORDS) {
      setError(`Bio must be ${MAX_WORDS} words or fewer.`);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const headshotDataUrl = headshotFile ? await imageFileToDataUrl(headshotFile, 1400, 1400) : undefined;
      const visibleQuestionIds = new Set(visibleCustomQuestions.map((question) => question.id));
      const customResponses = Object.fromEntries(
        Object.entries(formState.customResponses)
          .filter(([key]) => visibleQuestionIds.has(key))
          .map(([key, value]) => [key, value.trim()])
          .filter(([, value]) => value)
      );

      const payload: Record<string, unknown> = {
        customResponses
      };
      if (baseFieldConfig.fullName.enabled && fullNameInput) payload.fullName = fullNameInput;
      if (baseFieldConfig.schoolEmail.enabled && schoolEmailInput) payload.schoolEmail = schoolEmailInput;
      if (baseFieldConfig.gradeLevel.enabled && gradeLevelInput) payload.gradeLevel = Number(gradeLevelInput);
      if (baseFieldConfig.roleInShow.enabled && roleInShowInput) payload.roleInShow = roleInShowInput;
      if (baseFieldConfig.bio.enabled && bioInput) payload.bio = bioInput;
      if (baseFieldConfig.headshot.enabled && headshotDataUrl) payload.headshotDataUrl = headshotDataUrl;

      const submission = await apiFetch<SubmissionResult>(`/api/forms/${formMeta.publicSlug}/submissions`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      setResult(submission);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to submit form');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="min-h-[50vh] flex items-center justify-center text-stone-500">Loading form…</div>;
  }

  if (error && !formMeta) {
    return <div className="mx-auto max-w-2xl rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  }

  if (!formMeta) {
    return <div className="mx-auto max-w-2xl rounded-xl border border-stone-200 bg-white p-4 text-sm text-stone-600">Form not found.</div>;
  }

  if (result) {
    return (
      <div className="mx-auto max-w-2xl rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-black text-stone-900">Thanks, you&apos;re all set.</h1>
        <p className="mt-2 text-sm text-stone-700">
          Your response was saved on {new Date(result.submittedAt).toLocaleString()}.
        </p>
        <p className="mt-1 text-sm text-stone-600">
          Submitting again with the same school email updates your existing response.
        </p>
        <div className="mt-4">
          <Link to="/shows" className="text-sm font-semibold text-red-700 hover:underline">Back to shows</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-black text-stone-900">{formMeta.title}</h1>
      <p className="mt-1 text-sm text-stone-600">Show: {formMeta.show.title}</p>
      <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-stone-700">{formMeta.instructions}</p>
      <p className="mt-2 text-xs text-stone-500">Deadline: {new Date(formMeta.deadlineAt).toLocaleString()}</p>

      {!formMeta.acceptingResponses ? (
        <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
          This form isn&apos;t accepting responses.
        </div>
      ) : (
        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          {baseFieldConfig.fullName.enabled && (
            <label className="block text-sm">
              <span className="font-semibold text-stone-800">{questionLabels.fullNameLabel}</span>
              <input
                required={baseFieldConfig.fullName.required}
                value={formState.fullName}
                onChange={(event) => setFormState((current) => ({ ...current, fullName: event.target.value }))}
                className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2"
              />
            </label>
          )}

          {baseFieldConfig.schoolEmail.enabled && (
            <label className="block text-sm">
              <span className="font-semibold text-stone-800">{questionLabels.schoolEmailLabel}</span>
              <input
                required={baseFieldConfig.schoolEmail.required}
                type="email"
                value={formState.schoolEmail}
                onChange={(event) => setFormState((current) => ({ ...current, schoolEmail: event.target.value }))}
                className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2"
                placeholder={`name@${REQUIRED_SCHOOL_EMAIL_DOMAIN}`}
              />
              <span className="mt-1 block text-xs text-stone-500">
                Must end in @{REQUIRED_SCHOOL_EMAIL_DOMAIN}
              </span>
            </label>
          )}

          {(baseFieldConfig.gradeLevel.enabled || baseFieldConfig.roleInShow.enabled) && (
            <div className="grid gap-4 md:grid-cols-2">
              {baseFieldConfig.gradeLevel.enabled && (
                <label className="block text-sm">
                  <span className="font-semibold text-stone-800">{questionLabels.gradeLevelLabel}</span>
                  <select
                    required={baseFieldConfig.gradeLevel.required}
                    value={formState.gradeLevel}
                    onChange={(event) => setFormState((current) => ({ ...current, gradeLevel: event.target.value }))}
                    className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2"
                  >
                    <option value="">Select grade</option>
                    <option value="9">9</option>
                    <option value="10">10</option>
                    <option value="11">11</option>
                    <option value="12">12</option>
                  </select>
                </label>
              )}

              {baseFieldConfig.roleInShow.enabled && (
                <label className="block text-sm">
                  <span className="font-semibold text-stone-800">{questionLabels.roleInShowLabel}</span>
                  <input
                    required={baseFieldConfig.roleInShow.required}
                    value={formState.roleInShow}
                    onChange={(event) => setFormState((current) => ({ ...current, roleInShow: event.target.value }))}
                    className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2"
                  />
                </label>
              )}
            </div>
          )}

          {baseFieldConfig.bio.enabled && (
            <label className="block text-sm">
              <span className="font-semibold text-stone-800">{questionLabels.bioLabel}</span>
              <textarea
                required={baseFieldConfig.bio.required}
                rows={6}
                value={formState.bio}
                onChange={(event) => setFormState((current) => ({ ...current, bio: event.target.value }))}
                className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2"
              />
              <span className={`mt-1 block text-xs ${bioWordCount > MAX_WORDS ? 'text-red-700' : 'text-stone-500'}`}>
                {bioWordCount}/{MAX_WORDS} words
              </span>
            </label>
          )}

          {visibleCustomQuestions.map((question) => (
            <label key={question.id} className="block text-sm">
              <span className="font-semibold text-stone-800">{question.label}</span>
              {question.type === 'long_text' ? (
                <textarea
                  required={question.required}
                  rows={4}
                  value={formState.customResponses[question.id] || ''}
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      customResponses: {
                        ...current.customResponses,
                        [question.id]: event.target.value
                      }
                    }))
                  }
                  className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2"
                />
              ) : question.type === 'multiple_choice' ? (
                <select
                  required={question.required}
                  value={formState.customResponses[question.id] || ''}
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      customResponses: {
                        ...current.customResponses,
                        [question.id]: event.target.value
                      }
                    }))
                  }
                  className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2"
                >
                  <option value="">Select an option</option>
                  {question.options.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              ) : (
                <input
                  required={question.required}
                  value={formState.customResponses[question.id] || ''}
                  onChange={(event) =>
                    setFormState((current) => ({
                      ...current,
                      customResponses: {
                        ...current.customResponses,
                        [question.id]: event.target.value
                      }
                    }))
                  }
                  className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2"
                />
              )}
            </label>
          ))}

          {baseFieldConfig.headshot.enabled && (
            <label className="block text-sm">
              <span className="font-semibold text-stone-800">{questionLabels.headshotLabel}</span>
              <input
                required={baseFieldConfig.headshot.required}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                onChange={(event) => setHeadshotFile(event.target.files?.[0] || null)}
                className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2"
              />
            </label>
          )}

          {error ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center rounded-xl bg-red-700 px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {submitting ? 'Submitting…' : 'Submit'}
          </button>
        </form>
      )}
    </div>
  );
}
