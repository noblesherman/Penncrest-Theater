import { FormEvent, useEffect, useMemo, useState } from 'react';
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { clearTripToken, getTripToken, setTripToken, tripFetch } from '../lib/tripAuth';
import { apiFetch } from '../lib/api';

type TripAuthMe = {
  account: {
    id: string;
    email: string;
    name: string | null;
    studentId: string | null;
    hasClaimedStudent: boolean;
  };
  student: {
    id: string;
    name: string;
    grade: string | null;
    isActive: boolean;
  } | null;
};

type ClaimOptionsResponse = {
  account: {
    id: string;
    email: string;
    name: string | null;
    studentId: string | null;
    hasClaimedStudent: boolean;
  };
  claimedStudent: {
    id: string;
    name: string;
    grade: string | null;
    isActive?: boolean;
  } | null;
  claimableStudents: Array<{
    id: string;
    name: string;
    grade: string | null;
    trips: Array<{
      id: string;
      title: string;
      dueAt: string;
    }>;
  }>;
};

type DashboardResponse = {
  account: {
    id: string;
    email: string;
    name: string | null;
    studentId: string;
    hasClaimedStudent: true;
  };
  student: {
    id: string;
    name: string;
    grade: string | null;
    isActive: boolean;
  } | null;
  enrollments: Array<{
    enrollmentId: string;
    targetAmountCents: number;
    paidAmountCents: number;
    remainingAmountCents: number;
    dueAt: string;
    dueAtOverridden: boolean;
    isOverdue: boolean;
    canPay: boolean;
    allowPartialPayments: boolean;
    claimedAt: string | null;
    trip: {
      id: string;
      title: string;
      slug: string;
      destination: string | null;
      startsAt: string | null;
      dueAt: string;
      documents: Array<{
        id: string;
        title: string;
        fileUrl: string;
        mimeType: string;
        sizeBytes: number;
      }>;
    };
  }>;
  payments: Array<{
    id: string;
    enrollmentId: string;
    tripId: string;
    tripTitle: string;
    tripSlug: string;
    amountCents: number;
    currency: string;
    status: string;
    paidAt: string | null;
    createdAt: string;
    stripePaymentIntentId: string | null;
  }>;
};

type VerifyCodeResponse = {
  token: string;
  account: {
    id: string;
    email: string;
    name: string | null;
    studentId: string | null;
    hasClaimedStudent: boolean;
  };
};

type StartPaymentSessionResponse = {
  paymentId: string;
  checkoutSessionId: string;
  clientSecret: string | null;
  publishableKey: string | null;
  amountCents: number;
  remainingAmountCents: number;
};

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

type EmbeddedCheckoutCardProps = {
  clientSecret: string;
  publishableKey: string;
  onComplete: () => void;
};

function EmbeddedCheckoutCard(props: EmbeddedCheckoutCardProps) {
  const stripePromise = useMemo(() => loadStripe(props.publishableKey), [props.publishableKey]);
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <EmbeddedCheckoutProvider
        stripe={stripePromise}
        options={{
          clientSecret: props.clientSecret,
          onComplete: props.onComplete
        }}
      >
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  );
}

export default function TripPaymentsPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [requestCodeEmail, setRequestCodeEmail] = useState('');
  const [requestCodeName, setRequestCodeName] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [authStage, setAuthStage] = useState<'request' | 'verify' | 'authenticated'>('request');

  const [session, setSession] = useState<TripAuthMe | null>(null);
  const [claimOptions, setClaimOptions] = useState<ClaimOptionsResponse | null>(null);
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [activeCheckout, setActiveCheckout] = useState<{
    paymentId: string;
    enrollmentId: string;
    clientSecret: string;
    publishableKey: string;
  } | null>(null);
  const [amountDraftByEnrollmentId, setAmountDraftByEnrollmentId] = useState<Record<string, string>>({});

  const fallbackPublishableKey = (import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '').trim();

  async function loadAuthenticatedState(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const me = await tripFetch<TripAuthMe>('/api/trip-auth/me');
      setSession(me);
      setAuthStage('authenticated');

      const claims = await tripFetch<ClaimOptionsResponse>('/api/trips/portal/claim-options');
      setClaimOptions(claims);

      if (claims.account.hasClaimedStudent) {
        const dash = await tripFetch<DashboardResponse>('/api/trips/portal/dashboard');
        setDashboard(dash);
        setAmountDraftByEnrollmentId(
          Object.fromEntries(dash.enrollments.map((enrollment) => [enrollment.enrollmentId, (enrollment.remainingAmountCents / 100).toFixed(2)]))
        );
      } else {
        setDashboard(null);
      }
    } catch (err) {
      clearTripToken();
      setSession(null);
      setClaimOptions(null);
      setDashboard(null);
      setAuthStage('request');
      setError(err instanceof Error ? err.message : 'Authentication required');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!getTripToken()) {
      return;
    }
    void loadAuthenticatedState();
  }, []);

  async function handleRequestCode(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);

    try {
      await apiFetch<{ success: true; expiresInMinutes: number }>('/api/trip-auth/request-code', {
        method: 'POST',
        body: JSON.stringify({
          email: requestCodeEmail.trim(),
          name: requestCodeName.trim() || undefined
        })
      });
      setAuthStage('verify');
      setNotice('Code sent. Check your email and enter the code below.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to request code');
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyCode(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);

    try {
      const verified = await apiFetch<VerifyCodeResponse>('/api/trip-auth/verify-code', {
        method: 'POST',
        body: JSON.stringify({
          email: requestCodeEmail.trim(),
          code: verificationCode.trim()
        })
      });
      setTripToken(verified.token);
      setVerificationCode('');
      await loadAuthenticatedState();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to verify code');
    } finally {
      setLoading(false);
    }
  }

  async function handleClaimStudent(studentId: string) {
    setError(null);
    setNotice(null);
    setLoading(true);

    try {
      await tripFetch('/api/trips/portal/claim', {
        method: 'POST',
        body: JSON.stringify({ studentId })
      });
      await loadAuthenticatedState();
      setNotice('Student claimed successfully.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to claim student');
    } finally {
      setLoading(false);
    }
  }

  async function startPaymentSession(enrollment: DashboardResponse['enrollments'][number]) {
    setError(null);
    setNotice(null);

    const amountRaw = amountDraftByEnrollmentId[enrollment.enrollmentId] || '';
    const amountCents = Math.round(Number.parseFloat(amountRaw || '0') * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      setError('Enter a valid amount.');
      return;
    }

    try {
      const sessionResponse = await tripFetch<StartPaymentSessionResponse>('/api/trips/portal/payments/session', {
        method: 'POST',
        body: JSON.stringify({
          enrollmentId: enrollment.enrollmentId,
          amountCents
        })
      });

      const publishableKey = (sessionResponse.publishableKey || fallbackPublishableKey || '').trim();
      if (!publishableKey) {
        throw new Error('Stripe publishable key is missing.');
      }
      if (!sessionResponse.clientSecret) {
        throw new Error('Stripe client secret missing from payment session.');
      }

      setActiveCheckout({
        paymentId: sessionResponse.paymentId,
        enrollmentId: enrollment.enrollmentId,
        clientSecret: sessionResponse.clientSecret,
        publishableKey
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start payment session');
    }
  }

  async function handleCheckoutComplete() {
    setActiveCheckout(null);
    await loadAuthenticatedState();
    setNotice('Payment completed. Balance and history refreshed.');
  }

  function handleLogout() {
    clearTripToken();
    setSession(null);
    setClaimOptions(null);
    setDashboard(null);
    setActiveCheckout(null);
    setAuthStage('request');
    setVerificationCode('');
  }

  const needsClaim = authStage === 'authenticated' && claimOptions && !claimOptions.account.hasClaimedStudent;

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900">Trip Payments Portal</h1>
          <p className="text-sm text-stone-600">Sign in with an email code, claim your student once, and make trip payments.</p>
        </div>
        {authStage === 'authenticated' ? (
          <button onClick={handleLogout} className="rounded-md border border-stone-300 px-3 py-1.5 text-sm text-stone-700">
            Sign Out
          </button>
        ) : null}
      </div>

      {error ? <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
      {notice ? <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</div> : null}

      {loading && authStage !== 'authenticated' ? <div className="mb-4 text-sm text-stone-500">Loading…</div> : null}

      {authStage === 'request' ? (
        <section className="max-w-md rounded-xl border border-stone-200 bg-white p-4">
          <h2 className="mb-3 text-base font-semibold text-stone-900">Request Login Code</h2>
          <form className="space-y-3" onSubmit={handleRequestCode}>
            <input
              className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
              type="email"
              value={requestCodeEmail}
              onChange={(event) => setRequestCodeEmail(event.target.value)}
              placeholder="Email"
              required
            />
            <input
              className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
              value={requestCodeName}
              onChange={(event) => setRequestCodeName(event.target.value)}
              placeholder="Name (optional)"
            />
            <button className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white">Send Code</button>
          </form>
        </section>
      ) : null}

      {authStage === 'verify' ? (
        <section className="max-w-md rounded-xl border border-stone-200 bg-white p-4">
          <h2 className="mb-3 text-base font-semibold text-stone-900">Verify Code</h2>
          <form className="space-y-3" onSubmit={handleVerifyCode}>
            <div className="text-sm text-stone-600">Code sent to {requestCodeEmail}</div>
            <input
              className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
              value={verificationCode}
              onChange={(event) => setVerificationCode(event.target.value)}
              placeholder="6-digit code"
              required
            />
            <div className="flex gap-2">
              <button className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white">Verify</button>
              <button type="button" className="rounded-md border border-stone-300 px-4 py-2 text-sm text-stone-700" onClick={() => setAuthStage('request')}>
                Back
              </button>
            </div>
          </form>
        </section>
      ) : null}

      {needsClaim ? (
        <section className="rounded-xl border border-stone-200 bg-white p-4">
          <h2 className="mb-3 text-base font-semibold text-stone-900">Claim Your Student</h2>
          <p className="mb-3 text-sm text-stone-600">
            First claim wins. Your account will be locked to one student and cannot be changed by families.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {claimOptions?.claimableStudents.map((student) => (
              <div key={student.id} className="rounded-md border border-stone-200 p-3">
                <div className="text-sm font-medium text-stone-900">
                  {student.name}
                  {student.grade ? <span className="ml-1 text-stone-500">({student.grade})</span> : null}
                </div>
                <div className="mt-1 text-xs text-stone-500">
                  Trips: {student.trips.map((trip) => trip.title).join(', ')}
                </div>
                <button
                  className="mt-2 rounded-md border border-stone-300 px-3 py-1.5 text-sm text-stone-700"
                  onClick={() => void handleClaimStudent(student.id)}
                >
                  Claim Student
                </button>
              </div>
            ))}
          </div>
          {claimOptions && claimOptions.claimableStudents.length === 0 ? (
            <p className="text-sm text-stone-500">No unclaimed roster entries are currently available.</p>
          ) : null}
        </section>
      ) : null}

      {authStage === 'authenticated' && dashboard && !needsClaim ? (
        <div className="space-y-4">
          <section className="rounded-xl border border-stone-200 bg-white p-4">
            <h2 className="text-base font-semibold text-stone-900">Student Dashboard</h2>
            <p className="mt-1 text-sm text-stone-600">
              {dashboard.student?.name || 'Student'} {dashboard.student?.grade ? `(${dashboard.student.grade})` : ''}
            </p>
          </section>

          {dashboard.enrollments.map((enrollment) => (
            <section key={enrollment.enrollmentId} className="rounded-xl border border-stone-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-base font-semibold text-stone-900">{enrollment.trip.title}</h3>
                  <p className="text-sm text-stone-600">
                    Due {new Date(enrollment.dueAt).toLocaleString()} {enrollment.isOverdue ? '(Overdue)' : ''}
                  </p>
                </div>
                <div className="text-sm text-stone-700">
                  Target {formatMoney(enrollment.targetAmountCents)} | Paid {formatMoney(enrollment.paidAmountCents)} | Remaining{' '}
                  {formatMoney(enrollment.remainingAmountCents)}
                </div>
              </div>

              <div className="mt-3 rounded-md border border-stone-200 p-3">
                {!enrollment.canPay ? (
                  <p className="text-sm text-stone-600">
                    {enrollment.isOverdue ? 'Payments are blocked because this enrollment is past the due date.' : 'No remaining balance.'}
                  </p>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      className="w-40 rounded-md border border-stone-300 px-3 py-2 text-sm"
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={amountDraftByEnrollmentId[enrollment.enrollmentId] || ''}
                      onChange={(event) =>
                        setAmountDraftByEnrollmentId((prev) => ({ ...prev, [enrollment.enrollmentId]: event.target.value }))
                      }
                      disabled={!enrollment.allowPartialPayments}
                    />
                    {!enrollment.allowPartialPayments ? (
                      <span className="text-xs text-stone-500">One-time full payment only.</span>
                    ) : (
                      <span className="text-xs text-stone-500">Partial payments enabled.</span>
                    )}
                    <button
                      className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white"
                      onClick={() => void startPaymentSession(enrollment)}
                    >
                      Pay
                    </button>
                  </div>
                )}
              </div>

              <div className="mt-3">
                <h4 className="mb-1 text-sm font-semibold text-stone-800">Documents</h4>
                {enrollment.trip.documents.length === 0 ? (
                  <p className="text-sm text-stone-500">No documents uploaded.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {enrollment.trip.documents.map((document) => (
                      <a
                        key={document.id}
                        href={document.fileUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-md border border-stone-300 px-3 py-1.5 text-sm text-stone-700 hover:border-stone-500"
                      >
                        {document.title}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </section>
          ))}

          {activeCheckout ? (
            <section className="space-y-2">
              <h2 className="text-base font-semibold text-stone-900">Complete Payment</h2>
              <EmbeddedCheckoutCard
                key={activeCheckout.paymentId}
                clientSecret={activeCheckout.clientSecret}
                publishableKey={activeCheckout.publishableKey}
                onComplete={() => void handleCheckoutComplete()}
              />
            </section>
          ) : null}

          <section className="rounded-xl border border-stone-200 bg-white p-4">
            <h2 className="mb-2 text-base font-semibold text-stone-900">Payment History</h2>
            {dashboard.payments.length === 0 ? (
              <p className="text-sm text-stone-500">No payments yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-stone-200 text-left text-stone-600">
                      <th className="px-2 py-2">Trip</th>
                      <th className="px-2 py-2">Amount</th>
                      <th className="px-2 py-2">Status</th>
                      <th className="px-2 py-2">Paid At</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.payments.map((payment) => (
                      <tr key={payment.id} className="border-b border-stone-100">
                        <td className="px-2 py-2">{payment.tripTitle}</td>
                        <td className="px-2 py-2">{formatMoney(payment.amountCents)}</td>
                        <td className="px-2 py-2">{payment.status}</td>
                        <td className="px-2 py-2">{payment.paidAt ? new Date(payment.paidAt).toLocaleString() : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </main>
  );
}
