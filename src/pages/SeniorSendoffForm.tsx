import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe, type StripeElementsOptions } from '@stripe/stripe-js';
import { apiFetch } from '../lib/api';

type PublicSeniorSendoffForm = {
  id: string;
  publicSlug: string;
  schemaVersion: string;
  title: string;
  instructions: string;
  deadlineAt: string;
  isOpen: boolean;
  secondSubmissionPriceCents: number;
  acceptingResponses: boolean;
  closedMessage: string;
  show: {
    id: string;
    title: string;
  };
  limits: {
    maxPerStudent: number;
    firstIsFree: boolean;
    secondRequiresPayment: boolean;
  };
};

type SubmissionEligibility = {
  existingCount: number;
  remainingCount: number;
  requiresPaymentForNextSubmission: boolean;
  maxReached: boolean;
  secondSubmissionPriceCents: number;
  currency: string;
};

type SeniorSendoffPaymentIntentResponse = {
  paymentIntentId: string;
  clientSecret: string;
  publishableKey?: string;
  amountCents: number;
  currency: string;
};

type SeniorSendoffSubmissionResponse = {
  submissionId: string;
  entryNumber: number;
  isPaid: boolean;
  remainingCount: number;
  submittedAt: string;
  createdAt: string;
  updatedAt: string;
};

type ActivePaymentIntent = {
  paymentIntentId: string;
  clientSecret: string;
  publishableKey: string;
  amountCents: number;
};

type ShoutoutFormState = {
  parentName: string;
  parentEmail: string;
  parentPhone: string;
  studentName: string;
  message: string;
};

const FALLBACK_STRIPE_PUBLISHABLE_KEY = (import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '').trim();
const PAYMENT_BUTTON_CLASS =
  'inline-flex w-full items-center justify-center rounded-xl bg-red-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60';
const INPUT_CLASS =
  'w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 placeholder:text-stone-400 focus:border-red-700 focus:outline-none focus:ring-2 focus:ring-red-100';

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function isValidEmail(value: string): boolean {
  const normalized = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
}

function PaymentConfirmForm({
  amountCents,
  parentName,
  parentEmail,
  onSuccess,
  onError
}: {
  amountCents: number;
  parentName: string;
  parentEmail: string;
  onSuccess: (paymentIntentId: string) => void;
  onError: (message: string | null) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);

  const handlePaymentSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onError(null);
    if (!stripe || !elements) {
      onError('Payment form is still loading. Please try again.');
      return;
    }

    setSubmitting(true);
    const result = await stripe.confirmPayment({
      elements,
      confirmParams: {
        payment_method_data: {
          billing_details: {
            name: parentName,
            email: parentEmail
          }
        }
      },
      redirect: 'if_required'
    });
    setSubmitting(false);

    if (result.error) {
      onError(result.error.message || 'Payment could not be completed.');
      return;
    }

    const paymentIntentId = result.paymentIntent?.id;
    const paymentStatus = result.paymentIntent?.status;
    if (!paymentIntentId || !paymentStatus) {
      onError('Payment did not return a valid confirmation.');
      return;
    }

    if (!['succeeded', 'processing', 'requires_capture'].includes(paymentStatus)) {
      onError(`Payment did not complete. Current status: ${paymentStatus}.`);
      return;
    }

    onSuccess(paymentIntentId);
  };

  return (
    <form onSubmit={handlePaymentSubmit} className="space-y-4">
      <div className="rounded-2xl border border-stone-200 bg-white p-4">
        <PaymentElement />
      </div>
      <button type="submit" disabled={submitting || !stripe || !elements} className={PAYMENT_BUTTON_CLASS}>
        {submitting ? 'Confirming payment...' : `Pay ${formatUsd(amountCents)} and submit`}
      </button>
    </form>
  );
}

export default function SeniorSendoffFormPage() {
  const { slug = '' } = useParams();
  const [formMeta, setFormMeta] = useState<PublicSeniorSendoffForm | null>(null);
  const [formState, setFormState] = useState<ShoutoutFormState>({
    parentName: '',
    parentEmail: '',
    parentPhone: '',
    studentName: '',
    message: ''
  });
  const [eligibility, setEligibility] = useState<SubmissionEligibility | null>(null);
  const [eligibilityLoading, setEligibilityLoading] = useState(false);
  const [activeIntent, setActiveIntent] = useState<ActivePaymentIntent | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [result, setResult] = useState<SeniorSendoffSubmissionResponse | null>(null);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    setError(null);
    void apiFetch<PublicSeniorSendoffForm>(`/api/forms/senior-sendoff/${slug}`)
      .then((data) => setFormMeta(data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load form'))
      .finally(() => setLoading(false));
  }, [slug]);

  useEffect(() => {
    if (!formMeta) return;
    const parentEmail = formState.parentEmail.trim().toLowerCase();
    const studentName = formState.studentName.trim();
    if (!isValidEmail(parentEmail) || !studentName) {
      setEligibility(null);
      return;
    }

    const timeout = window.setTimeout(() => {
      setEligibilityLoading(true);
      void apiFetch<SubmissionEligibility>(`/api/forms/senior-sendoff/${formMeta.publicSlug}/eligibility`, {
        method: 'POST',
        body: JSON.stringify({ parentEmail, studentName })
      })
        .then((data) => setEligibility(data))
        .catch(() => setEligibility(null))
        .finally(() => setEligibilityLoading(false));
    }, 350);

    return () => window.clearTimeout(timeout);
  }, [formMeta, formState.parentEmail, formState.studentName]);

  const stripePromise = useMemo(() => {
    if (!activeIntent?.publishableKey) return null;
    return loadStripe(activeIntent.publishableKey);
  }, [activeIntent?.publishableKey]);

  const stripeOptions = useMemo<StripeElementsOptions | null>(() => {
    if (!activeIntent?.clientSecret) return null;
    return {
      clientSecret: activeIntent.clientSecret,
      appearance: { theme: 'stripe' }
    };
  }, [activeIntent?.clientSecret]);

  const readinessIssue = useMemo(() => {
    if (!formState.parentName.trim()) return 'Enter parent/guardian name.';
    if (!isValidEmail(formState.parentEmail)) return 'Enter a valid parent email.';
    if (!formState.parentPhone.trim()) return 'Enter parent phone.';
    if (!formState.studentName.trim()) return 'Enter student name.';
    if (!formState.message.trim()) return 'Enter a shout-out message.';
    return null;
  }, [formState]);

  async function fetchEligibility(): Promise<SubmissionEligibility | null> {
    if (!formMeta) return null;
    const parentEmail = formState.parentEmail.trim().toLowerCase();
    const studentName = formState.studentName.trim();
    if (!isValidEmail(parentEmail) || !studentName) return null;
    return apiFetch<SubmissionEligibility>(`/api/forms/senior-sendoff/${formMeta.publicSlug}/eligibility`, {
      method: 'POST',
      body: JSON.stringify({ parentEmail, studentName })
    });
  }

  async function submitShoutout(paymentIntentId?: string): Promise<void> {
    if (!formMeta) return;
    setSubmitting(true);
    setError(null);
    try {
      const submission = await apiFetch<SeniorSendoffSubmissionResponse>(
        `/api/forms/senior-sendoff/${formMeta.publicSlug}/submissions`,
        {
          method: 'POST',
          body: JSON.stringify({
            parentName: formState.parentName.trim(),
            parentEmail: formState.parentEmail.trim().toLowerCase(),
            parentPhone: formState.parentPhone.trim(),
            studentName: formState.studentName.trim(),
            message: formState.message.trim(),
            ...(paymentIntentId ? { paymentIntentId } : {})
          })
        }
      );
      setResult(submission);
      setActiveIntent(null);
      setPaymentError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit shout-out');
    } finally {
      setSubmitting(false);
    }
  }

  async function beginPaidFlow(): Promise<void> {
    if (!formMeta) return;
    setPaymentLoading(true);
    setError(null);
    try {
      const response = await apiFetch<SeniorSendoffPaymentIntentResponse>(
        `/api/forms/senior-sendoff/${formMeta.publicSlug}/payment-intent`,
        {
          method: 'POST',
          body: JSON.stringify({
            parentName: formState.parentName.trim(),
            parentEmail: formState.parentEmail.trim().toLowerCase(),
            studentName: formState.studentName.trim()
          })
        }
      );
      const publishableKey = (response.publishableKey || FALLBACK_STRIPE_PUBLISHABLE_KEY || '').trim();
      if (!publishableKey) {
        throw new Error('Stripe publishable key is missing.');
      }
      setActiveIntent({
        paymentIntentId: response.paymentIntentId,
        clientSecret: response.clientSecret,
        publishableKey,
        amountCents: response.amountCents
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open payment step.');
    } finally {
      setPaymentLoading(false);
    }
  }

  async function handlePrepareSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setPaymentError(null);
    if (!formMeta) return;

    if (readinessIssue) {
      setError(readinessIssue);
      return;
    }

    try {
      const latestEligibility = await fetchEligibility();
      if (latestEligibility) setEligibility(latestEligibility);

      if (latestEligibility?.maxReached) {
        setError('You already reached the 2 shout-out limit for this student.');
        return;
      }

      if (latestEligibility?.requiresPaymentForNextSubmission) {
        await beginPaidFlow();
        return;
      }

      await submitShoutout();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to prepare submission');
    }
  }

  if (loading) {
    return <div className="min-h-[50vh] flex items-center justify-center text-stone-500">Loading form...</div>;
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
        <h1 className="text-2xl font-black text-stone-900">Shout-out submitted.</h1>
        <p className="mt-2 text-sm text-stone-700">
          Entry #{result.entryNumber} for <span className="font-semibold">{formState.studentName}</span> is now recorded.
          {result.isPaid ? ' Payment was confirmed.' : ''}
        </p>
        <p className="mt-2 text-xs text-stone-500">
          A confirmation email was sent to {formState.parentEmail.trim().toLowerCase()}.
        </p>
        {result.remainingCount > 0 && (
          <button
            type="button"
            onClick={() => {
              setResult(null);
              setFormState((current) => ({ ...current, message: '' }));
              setActiveIntent(null);
              setPaymentError(null);
              setError(null);
            }}
            className="mt-4 inline-flex items-center rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm font-semibold text-stone-700 transition hover:bg-stone-50"
          >
            Submit another shout-out for this student ({result.remainingCount} left)
          </button>
        )}
        <div className="mt-6">
          <Link to="/" className="text-sm font-semibold text-red-700 hover:text-red-800">
            Back to Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-red-700">Playbill Form</p>
        <h1 className="mt-1 text-2xl font-black text-stone-900">{formMeta.title}</h1>
        <p className="mt-1 text-sm text-stone-500">
          {formMeta.show.title} - Deadline {new Date(formMeta.deadlineAt).toLocaleString()}
        </p>
      </div>

      <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700 whitespace-pre-wrap">
        {formMeta.instructions}
      </div>

      {!formMeta.acceptingResponses ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {formMeta.closedMessage || "This form isn't accepting responses."}
        </div>
      ) : (
        <form onSubmit={(event) => void handlePrepareSubmit(event)} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-stone-500">Parent/Guardian Name</label>
              <input
                className={INPUT_CLASS}
                value={formState.parentName}
                onChange={(event) => setFormState((current) => ({ ...current, parentName: event.target.value }))}
                placeholder="Full name"
                autoComplete="name"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-stone-500">Parent Email</label>
              <input
                className={INPUT_CLASS}
                type="email"
                value={formState.parentEmail}
                onChange={(event) => setFormState((current) => ({ ...current, parentEmail: event.target.value }))}
                placeholder="name@email.com"
                autoComplete="email"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-stone-500">Parent Phone</label>
              <input
                className={INPUT_CLASS}
                value={formState.parentPhone}
                onChange={(event) => setFormState((current) => ({ ...current, parentPhone: event.target.value }))}
                placeholder="(555) 555-5555"
                autoComplete="tel"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-stone-500">Student Name</label>
              <input
                className={INPUT_CLASS}
                value={formState.studentName}
                onChange={(event) => setFormState((current) => ({ ...current, studentName: event.target.value }))}
                placeholder="Student full name"
                autoComplete="name"
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-stone-500">Shout-Out Message</label>
            <textarea
              rows={7}
              className={INPUT_CLASS + ' resize-none'}
              value={formState.message}
              onChange={(event) => setFormState((current) => ({ ...current, message: event.target.value }))}
              placeholder="Write your message for the playbill..."
            />
          </div>

          <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700">
            {eligibilityLoading && <p>Checking limit and payment status...</p>}
            {!eligibilityLoading && eligibility?.maxReached && (
              <p className="text-red-700">This email already reached 2 shout-outs for this student.</p>
            )}
            {!eligibilityLoading && eligibility && !eligibility.maxReached && !eligibility.requiresPaymentForNextSubmission && (
              <p>Next submission is free ({eligibility.remainingCount} remaining for this student).</p>
            )}
            {!eligibilityLoading && eligibility?.requiresPaymentForNextSubmission && (
              <p>
                This will be your second shout-out for this student. A payment of{' '}
                <span className="font-semibold">{formatUsd(eligibility.secondSubmissionPriceCents)}</span> is required before final submit.
              </p>
            )}
            {!eligibilityLoading && !eligibility && (
              <p>First shout-out per student is free. The second shout-out requires payment.</p>
            )}
          </div>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting || paymentLoading || Boolean(readinessIssue)}
            className={PAYMENT_BUTTON_CLASS}
          >
            {submitting ? 'Submitting...' : paymentLoading ? 'Preparing payment...' : 'Continue'}
          </button>
        </form>
      )}

      {activeIntent && stripePromise && stripeOptions && (
        <div className="space-y-3 rounded-2xl border border-red-200 bg-red-50/40 p-4">
          <p className="text-sm font-semibold text-stone-800">
            Complete payment ({formatUsd(activeIntent.amountCents)}) to submit the second shout-out.
          </p>
          {paymentError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {paymentError}
            </div>
          )}
          <Elements stripe={stripePromise} options={stripeOptions}>
            <PaymentConfirmForm
              amountCents={activeIntent.amountCents}
              parentName={formState.parentName.trim()}
              parentEmail={formState.parentEmail.trim().toLowerCase()}
              onError={setPaymentError}
              onSuccess={(paymentIntentId) => {
                void submitShoutout(paymentIntentId);
              }}
            />
          </Elements>
        </div>
      )}
    </div>
  );
}
