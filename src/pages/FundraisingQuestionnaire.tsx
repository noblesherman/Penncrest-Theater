/*
Handoff note for Mr. Smith:
- File: `src/pages/FundraisingQuestionnaire.tsx`
- What this is: Public web route page.
- What it does: Renders a full user-facing page for the theater site.
- Connections: Registered in `src/App.tsx` and backed by shared components/helpers in `src/components` + `src/lib`.
- Main content type: Page layout + visible text + route-level logic.
- Safe edits here: Wording, headings, section order, and styling tweaks.
- Be careful with: Form payloads, URL param handling, and API response assumptions.
- Useful context: This folder is one of the most common edit points for visible site content.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import EventRegistrationCheckoutForm from '../components/EventRegistrationCheckoutForm';
import { apiFetch } from '../lib/api';
import type {
  EventRegistrationPublicFormResponse,
  EventRegistrationSubmissionPayload
} from '../lib/eventRegistrationForm';

type RegistrationContextResponse = {
  orderId: string;
  orderStatus: string;
  performanceId: string;
  ticketQuantity: number;
  customerName: string;
  existingSubmission: {
    responseJson: unknown;
    submittedAt: string;
  } | null;
};

type SubmitResponse = {
  success: boolean;
  submissionId: string;
  submittedAt: string;
  updatedAt: string;
};

type EnabledRegistrationForm = Extract<EventRegistrationPublicFormResponse, { enabled: true }>;

type PrefillDraft = {
  sections: Record<string, Record<string, unknown> | Array<Record<string, unknown>>>;
  policies: Record<string, unknown>;
  acknowledgments: {
    infoAccurate: boolean;
    policiesRead: boolean;
    emergencyCare: boolean;
    participationRules: boolean;
  };
  signature: {
    typedName: string;
    printedName: string;
  };
};

function toPrefillDraft(value: unknown): PrefillDraft | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const source = value as Record<string, unknown>;
  const sections = source.sections && typeof source.sections === 'object' && !Array.isArray(source.sections)
    ? (source.sections as Record<string, Record<string, unknown> | Array<Record<string, unknown>>>)
    : {};
  const policies = source.policies && typeof source.policies === 'object' && !Array.isArray(source.policies)
    ? (source.policies as Record<string, unknown>)
    : {};

  const rawAck = source.acknowledgments && typeof source.acknowledgments === 'object' && !Array.isArray(source.acknowledgments)
    ? (source.acknowledgments as Record<string, unknown>)
    : {};
  const rawSignature = source.signature && typeof source.signature === 'object' && !Array.isArray(source.signature)
    ? (source.signature as Record<string, unknown>)
    : {};

  return {
    sections,
    policies,
    acknowledgments: {
      infoAccurate: rawAck.infoAccurate === true,
      policiesRead: rawAck.policiesRead === true,
      emergencyCare: rawAck.emergencyCare === true,
      participationRules: rawAck.participationRules === true
    },
    signature: {
      typedName: typeof rawSignature.typedName === 'string' ? rawSignature.typedName : '',
      printedName: typeof rawSignature.printedName === 'string' ? rawSignature.printedName : ''
    }
  };
}

export default function FundraisingQuestionnairePage() {
  const [searchParams] = useSearchParams();
  const orderId = searchParams.get('orderId') || '';
  const token = searchParams.get('token') || '';

  const [context, setContext] = useState<RegistrationContextResponse | null>(null);
  const [form, setForm] = useState<EnabledRegistrationForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [payload, setPayload] = useState<EventRegistrationSubmissionPayload | null>(null);

  const storageKey = useMemo(() => (orderId ? `fundraiser_questionnaire_${orderId}` : 'fundraiser_questionnaire'), [orderId]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!orderId || !token) {
        setError('Missing order link information. Please use the QR code provided at check-in.');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const ctx = await apiFetch<RegistrationContextResponse>(
          `/api/orders/${encodeURIComponent(orderId)}/registration-context?token=${encodeURIComponent(token)}`
        );
        if (cancelled) return;

        const publicForm = await apiFetch<EventRegistrationPublicFormResponse>(
          `/api/performances/${encodeURIComponent(ctx.performanceId)}/registration-form`
        );
        if (cancelled) return;

        setContext(ctx);

        if (!publicForm.enabled) {
          setForm(null);
          setError('No registration questionnaire is currently published for this fundraiser event.');
          setLoading(false);
          return;
        }

        setForm(publicForm);

        if (ctx.existingSubmission) {
          const existingDraft = toPrefillDraft(ctx.existingSubmission.responseJson);
          if (existingDraft) {
            const existingLocal = window.localStorage.getItem(storageKey);
            if (!existingLocal) {
              window.localStorage.setItem(storageKey, JSON.stringify(existingDraft));
            }
          }
          setSavedAt(ctx.existingSubmission.submittedAt);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to load questionnaire');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [orderId, storageKey, token]);

  async function submitQuestionnaire() {
    if (!orderId || !token || !payload) {
      setError('Questionnaire is incomplete. Please fill all required fields.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const result = await apiFetch<SubmitResponse>(
        `/api/orders/${encodeURIComponent(orderId)}/registration-submission?token=${encodeURIComponent(token)}`,
        {
          method: 'POST',
          body: JSON.stringify(payload)
        }
      );
      setSavedAt(result.updatedAt || result.submittedAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to submit questionnaire');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="min-h-screen bg-stone-50 p-4 text-center text-stone-600 sm:p-6">Loading questionnaire...</div>;
  }

  return (
    <div className="min-h-screen bg-stone-50 px-3 py-5 sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto w-full max-w-5xl rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:rounded-3xl sm:p-8">
        <p className="text-xs font-bold uppercase tracking-widest text-stone-500">Fundraiser Questionnaire</p>
        <h1 className="mt-2 text-2xl font-black leading-tight text-stone-900 sm:text-3xl">Parent and Family Registration</h1>
        {context ? (
          <p className="mt-2 text-[15px] leading-relaxed text-stone-600 sm:text-sm">
            Order {context.orderId.slice(0, 10)} for {context.customerName}. Ticket count: {context.ticketQuantity}.
          </p>
        ) : null}

        {savedAt ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
            Questionnaire saved. Last update: {new Date(savedAt).toLocaleString()}.
          </div>
        ) : null}

        {error ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>
        ) : null}

        {form ? (
          <EventRegistrationCheckoutForm
            form={form}
            ticketQuantity={Math.max(0, context?.ticketQuantity || 0)}
            storageKey={storageKey}
            checkoutCustomerName={context?.customerName || undefined}
            submitButtonLabel="Save Questionnaire"
            disabled={saving}
            onSubmit={() => {
              void submitQuestionnaire();
            }}
            onValidityChange={(params) => {
              setPayload(params.payload);
            }}
          />
        ) : (
          <div className="mt-6 rounded-2xl border border-dashed border-stone-300 bg-stone-50 p-5 text-center text-sm text-stone-500 sm:p-8">
            If you expected a questionnaire, contact staff at the check-in desk.
          </div>
        )}

        <div className="mt-6 flex justify-center">
          <Link to="/" className="inline-flex items-center rounded-xl border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-100">
            Return Home
          </Link>
        </div>
      </div>
    </div>
  );
}
