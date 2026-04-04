import { FormEvent, useEffect, useMemo, useState } from 'react';
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { ArrowRight, Calendar, CheckCircle2, Clock3, CreditCard, FileText, PieChart, TrendingUp, Wallet } from 'lucide-react';
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

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

function progressPercent(paidAmountCents: number, targetAmountCents: number): number {
  if (targetAmountCents <= 0) {
    return 100;
  }
  return Math.max(0, Math.min(100, Math.round((paidAmountCents / targetAmountCents) * 100)));
}

function dueCountdown(dueAt: string, isOverdue: boolean): string {
  const days = Math.ceil((new Date(dueAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  if (isOverdue) {
    const lateBy = Math.max(1, Math.abs(days));
    return `${lateBy} day${lateBy === 1 ? '' : 's'} overdue`;
  }
  if (days < 0) {
    return 'Past due date';
  }
  if (days === 0) {
    return 'Due today';
  }
  return `${days} day${days === 1 ? '' : 's'} left`;
}

function statusMeta(status: string): { label: string; className: string } {
  if (status === 'SUCCEEDED') {
    return {
      label: 'Completed',
      className: 'border-emerald-200 bg-emerald-50 text-emerald-700'
    };
  }
  if (status === 'PENDING') {
    return {
      label: 'Processing',
      className: 'border-amber-200 bg-amber-50 text-amber-700'
    };
  }
  if (status === 'FAILED') {
    return {
      label: 'Failed',
      className: 'border-rose-200 bg-rose-50 text-rose-700'
    };
  }
  if (status === 'EXPIRED') {
    return {
      label: 'Expired',
      className: 'border-stone-300 bg-stone-100 text-stone-700'
    };
  }
  return {
    label: status,
    className: 'border-stone-300 bg-stone-100 text-stone-700'
  };
}

type ProgressDonutProps = {
  paidAmountCents: number;
  targetAmountCents: number;
  size?: number;
  stroke?: number;
};

function ProgressDonut({ paidAmountCents, targetAmountCents, size = 132, stroke = 12 }: ProgressDonutProps) {
  const percent = progressPercent(paidAmountCents, targetAmountCents);
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} className="fill-none stroke-stone-200" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          strokeLinecap="round"
          className="fill-none stroke-orange-500 transition-all duration-500"
          style={{
            strokeDasharray: circumference,
            strokeDashoffset: offset
          }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <div className="text-2xl font-semibold text-stone-900">{percent}%</div>
        <div className="text-xs text-stone-500">funded</div>
      </div>
    </div>
  );
}

type EmbeddedCheckoutCardProps = {
  clientSecret: string;
  publishableKey: string;
  onComplete: () => void;
};

function EmbeddedCheckoutCard(props: EmbeddedCheckoutCardProps) {
  const stripePromise = useMemo(() => loadStripe(props.publishableKey), [props.publishableKey]);
  return (
    <div className="rounded-3xl border border-orange-200 bg-gradient-to-br from-orange-50 to-white p-4 shadow-sm">
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
  const [activeEnrollmentId, setActiveEnrollmentId] = useState<string | null>(null);
  const [historyFilter, setHistoryFilter] = useState<'ALL' | 'SUCCEEDED' | 'PENDING' | 'FAILED' | 'EXPIRED'>('ALL');
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
        setActiveEnrollmentId((prev) => {
          if (!prev || !dash.enrollments.some((enrollment) => enrollment.enrollmentId === prev)) {
            return dash.enrollments[0]?.enrollmentId || null;
          }
          return prev;
        });
      } else {
        setDashboard(null);
        setActiveEnrollmentId(null);
      }
    } catch (err) {
      clearTripToken();
      setSession(null);
      setClaimOptions(null);
      setDashboard(null);
      setActiveEnrollmentId(null);
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

      setActiveEnrollmentId(enrollment.enrollmentId);
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
    setActiveEnrollmentId(null);
    setAuthStage('request');
    setVerificationCode('');
  }

  const needsClaim = authStage === 'authenticated' && claimOptions && !claimOptions.account.hasClaimedStudent;

  const summary = useMemo(() => {
    if (!dashboard) return null;
    const targetAmountCents = dashboard.enrollments.reduce((sum, enrollment) => sum + enrollment.targetAmountCents, 0);
    const paidAmountCents = dashboard.enrollments.reduce((sum, enrollment) => sum + enrollment.paidAmountCents, 0);
    const remainingAmountCents = dashboard.enrollments.reduce((sum, enrollment) => sum + enrollment.remainingAmountCents, 0);
    const nextDue = [...dashboard.enrollments]
      .filter((enrollment) => enrollment.remainingAmountCents > 0)
      .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())[0];

    const completedPayments = dashboard.payments.filter((payment) => payment.status === 'SUCCEEDED');
    const pendingPayments = dashboard.payments.filter((payment) => payment.status === 'PENDING');

    return {
      targetAmountCents,
      paidAmountCents,
      remainingAmountCents,
      completionPercent: progressPercent(paidAmountCents, targetAmountCents),
      nextDue,
      completedPayments: completedPayments.length,
      pendingPayments: pendingPayments.length
    };
  }, [dashboard]);

  const selectedEnrollment = useMemo(() => {
    if (!dashboard) return null;
    return dashboard.enrollments.find((enrollment) => enrollment.enrollmentId === activeEnrollmentId) || dashboard.enrollments[0] || null;
  }, [dashboard, activeEnrollmentId]);

  const filteredPayments = useMemo(() => {
    if (!dashboard) return [];
    if (historyFilter === 'ALL') {
      return dashboard.payments;
    }
    return dashboard.payments.filter((payment) => payment.status === historyFilter);
  }, [dashboard, historyFilter]);

  const selectedEnrollmentPayments = useMemo(() => {
    if (!dashboard || !selectedEnrollment) return [];
    return dashboard.payments.filter((payment) => payment.enrollmentId === selectedEnrollment.enrollmentId);
  }, [dashboard, selectedEnrollment]);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#fff1d6_0%,#fff9ef_45%,#fffdf7_100%)] px-4 py-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="mb-1 inline-flex items-center gap-2 rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-orange-700">
              <PieChart className="h-3.5 w-3.5" />
              Trip Manager
            </p>
            <h1 className="text-3xl font-semibold tracking-tight text-stone-900">Trip Payments, Reimagined</h1>
            <p className="mt-1 max-w-2xl text-sm text-stone-600">
              Track progress, view payment momentum, and keep every trip deadline in one friendly dashboard.
            </p>
          </div>
          {authStage === 'authenticated' ? (
            <button
              onClick={handleLogout}
              className="rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-700 transition hover:border-stone-500"
            >
              Sign Out
            </button>
          ) : null}
        </div>

        {error ? <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
        {notice ? <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div> : null}
        {loading && authStage !== 'authenticated' ? <div className="mb-4 text-sm text-stone-500">Loading…</div> : null}

        {authStage === 'request' ? (
          <section className="max-w-md rounded-3xl border border-orange-100 bg-white p-5 shadow-sm">
            <h2 className="mb-1 text-lg font-semibold text-stone-900">Get Your Login Code</h2>
            <p className="mb-4 text-sm text-stone-600">We will send a one-time sign-in code so families can securely access payment plans.</p>
            <form className="space-y-3" onSubmit={handleRequestCode}>
              <input
                className="w-full rounded-xl border border-stone-300 px-3 py-2.5 text-sm"
                type="email"
                value={requestCodeEmail}
                onChange={(event) => setRequestCodeEmail(event.target.value)}
                placeholder="Email"
                required
              />
              <input
                className="w-full rounded-xl border border-stone-300 px-3 py-2.5 text-sm"
                value={requestCodeName}
                onChange={(event) => setRequestCodeName(event.target.value)}
                placeholder="Name (optional)"
              />
              <button className="inline-flex items-center gap-2 rounded-xl bg-stone-900 px-4 py-2 text-sm font-medium text-white">
                Send Code <ArrowRight className="h-4 w-4" />
              </button>
            </form>
          </section>
        ) : null}

        {authStage === 'verify' ? (
          <section className="max-w-md rounded-3xl border border-orange-100 bg-white p-5 shadow-sm">
            <h2 className="mb-1 text-lg font-semibold text-stone-900">Verify and Continue</h2>
            <p className="mb-4 text-sm text-stone-600">Enter the one-time code sent to {requestCodeEmail}.</p>
            <form className="space-y-3" onSubmit={handleVerifyCode}>
              <input
                className="w-full rounded-xl border border-stone-300 px-3 py-2.5 text-sm"
                value={verificationCode}
                onChange={(event) => setVerificationCode(event.target.value)}
                placeholder="6-digit code"
                required
              />
              <div className="flex gap-2">
                <button className="rounded-xl bg-stone-900 px-4 py-2 text-sm font-medium text-white">Verify</button>
                <button
                  type="button"
                  className="rounded-xl border border-stone-300 bg-white px-4 py-2 text-sm text-stone-700"
                  onClick={() => setAuthStage('request')}
                >
                  Back
                </button>
              </div>
            </form>
          </section>
        ) : null}

        {needsClaim ? (
          <section className="rounded-3xl border border-orange-100 bg-white p-5 shadow-sm">
            <h2 className="mb-1 text-lg font-semibold text-stone-900">Claim Your Student Profile</h2>
            <p className="mb-4 text-sm text-stone-600">Claiming links this account to one student so balances and documents stay clean and secure.</p>
            <div className="grid gap-3 md:grid-cols-2">
              {claimOptions?.claimableStudents.map((student) => (
                <div key={student.id} className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
                  <div className="text-base font-semibold text-stone-900">
                    {student.name}
                    {student.grade ? <span className="ml-2 text-sm font-normal text-stone-500">Grade {student.grade}</span> : null}
                  </div>
                  <div className="mt-1 text-xs text-stone-500">Trips: {student.trips.map((trip) => trip.title).join(', ')}</div>
                  <button
                    className="mt-3 rounded-xl border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-700 transition hover:border-stone-500"
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
          <div className="space-y-6">
            <section className="relative overflow-hidden rounded-3xl border border-orange-200 bg-gradient-to-br from-orange-50 via-amber-50 to-white p-5 shadow-sm">
              <div className="pointer-events-none absolute -right-16 -top-16 h-52 w-52 rounded-full bg-orange-200/35 blur-3xl" />
              <div className="grid gap-5 md:grid-cols-[1.3fr_1fr]">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-700">Family Dashboard</p>
                  <h2 className="mt-1 text-2xl font-semibold text-stone-900">
                    {dashboard.student?.name || session?.account.name || 'Student'}
                    {dashboard.student?.grade ? <span className="ml-2 text-lg font-normal text-stone-500">Grade {dashboard.student.grade}</span> : null}
                  </h2>
                  <p className="mt-2 max-w-xl text-sm text-stone-600">
                    You are {summary?.completionPercent || 0}% of the way to fully funding all active trips. Keep the momentum going.
                  </p>
                  {summary?.nextDue ? (
                    <div className="mt-4 inline-flex items-center gap-2 rounded-xl border border-orange-200 bg-white/80 px-3 py-2 text-sm text-stone-700">
                      <Calendar className="h-4 w-4 text-orange-600" />
                      Next due: <span className="font-medium">{summary.nextDue.trip.title}</span> on {formatDate(summary.nextDue.dueAt)}
                    </div>
                  ) : (
                    <div className="mt-4 inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                      <CheckCircle2 className="h-4 w-4" />
                      All published trip balances are paid.
                    </div>
                  )}
                </div>
                <div className="rounded-2xl border border-white/80 bg-white/90 p-4 shadow-sm backdrop-blur">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs uppercase tracking-[0.14em] text-stone-500">Overall Progress</div>
                      <div className="text-lg font-semibold text-stone-900">{formatMoney(summary?.paidAmountCents || 0)} paid</div>
                    </div>
                    <ProgressDonut paidAmountCents={summary?.paidAmountCents || 0} targetAmountCents={summary?.targetAmountCents || 0} />
                  </div>
                </div>
              </div>
            </section>

            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.12em] text-stone-500">
                  <Wallet className="h-4 w-4" />
                  Target
                </div>
                <div className="mt-1 text-2xl font-semibold text-stone-900">{formatMoney(summary?.targetAmountCents || 0)}</div>
              </div>
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.12em] text-emerald-700">
                  <TrendingUp className="h-4 w-4" />
                  Paid
                </div>
                <div className="mt-1 text-2xl font-semibold text-emerald-900">{formatMoney(summary?.paidAmountCents || 0)}</div>
              </div>
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.12em] text-amber-700">
                  <Clock3 className="h-4 w-4" />
                  Remaining
                </div>
                <div className="mt-1 text-2xl font-semibold text-amber-900">{formatMoney(summary?.remainingAmountCents || 0)}</div>
              </div>
              <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 shadow-sm">
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.12em] text-sky-700">
                  <CreditCard className="h-4 w-4" />
                  Activity
                </div>
                <div className="mt-1 text-lg font-semibold text-sky-900">
                  {summary?.completedPayments || 0} complete / {summary?.pendingPayments || 0} pending
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
              <h3 className="text-lg font-semibold text-stone-900">Trip Progress Board</h3>
              <p className="mb-4 mt-1 text-sm text-stone-600">Click any trip card to focus it. Each card shows progress, deadline pressure, and payment options.</p>
              <div className="grid gap-4 lg:grid-cols-2">
                {dashboard.enrollments.map((enrollment) => {
                  const isActive = enrollment.enrollmentId === selectedEnrollment?.enrollmentId;
                  const percent = progressPercent(enrollment.paidAmountCents, enrollment.targetAmountCents);
                  const enrollmentHistory = dashboard.payments.filter((payment) => payment.enrollmentId === enrollment.enrollmentId);
                  const successfulPayments = enrollmentHistory.filter((payment) => payment.status === 'SUCCEEDED');
                  const averagePaymentCents =
                    successfulPayments.length > 0
                      ? Math.round(successfulPayments.reduce((sum, payment) => sum + payment.amountCents, 0) / successfulPayments.length)
                      : null;

                  return (
                    <article
                      key={enrollment.enrollmentId}
                      className={`rounded-3xl border p-4 transition ${
                        isActive ? 'border-orange-300 bg-orange-50/60 shadow-sm' : 'border-stone-200 bg-stone-50/40 hover:border-stone-300'
                      }`}
                      onClick={() => setActiveEnrollmentId(enrollment.enrollmentId)}
                      onMouseEnter={() => setActiveEnrollmentId(enrollment.enrollmentId)}
                    >
                      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
                        <div>
                          <h4 className="text-base font-semibold text-stone-900">{enrollment.trip.title}</h4>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-stone-600">
                            <span className="rounded-full border border-stone-300 bg-white px-2 py-0.5">Due {formatDate(enrollment.dueAt)}</span>
                            <span
                              className={`rounded-full border px-2 py-0.5 ${
                                enrollment.isOverdue
                                  ? 'border-rose-200 bg-rose-50 text-rose-700'
                                  : enrollment.remainingAmountCents === 0
                                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                    : 'border-amber-200 bg-amber-50 text-amber-700'
                              }`}
                            >
                              {dueCountdown(enrollment.dueAt, enrollment.isOverdue)}
                            </span>
                          </div>
                          <div className="mt-3">
                            <div className="mb-1 flex items-center justify-between text-xs text-stone-600">
                              <span>Progress</span>
                              <span>{percent}%</span>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-stone-200">
                              <div className="h-full rounded-full bg-gradient-to-r from-orange-400 to-amber-500" style={{ width: `${percent}%` }} />
                            </div>
                          </div>
                          <div className="mt-3 text-sm text-stone-700">
                            Target {formatMoney(enrollment.targetAmountCents)} | Paid {formatMoney(enrollment.paidAmountCents)} | Remaining{' '}
                            {formatMoney(enrollment.remainingAmountCents)}
                          </div>
                        </div>
                        <ProgressDonut paidAmountCents={enrollment.paidAmountCents} targetAmountCents={enrollment.targetAmountCents} size={116} stroke={10} />
                      </div>

                      <div className="mt-4 grid gap-2 sm:grid-cols-3">
                        <div className="rounded-xl border border-stone-200 bg-white p-2">
                          <div className="text-[11px] uppercase tracking-[0.12em] text-stone-500">Payments Made</div>
                          <div className="text-base font-semibold text-stone-900">{successfulPayments.length}</div>
                        </div>
                        <div className="rounded-xl border border-stone-200 bg-white p-2">
                          <div className="text-[11px] uppercase tracking-[0.12em] text-stone-500">Avg Payment</div>
                          <div className="text-base font-semibold text-stone-900">{averagePaymentCents ? formatMoney(averagePaymentCents) : '—'}</div>
                        </div>
                        <div className="rounded-xl border border-stone-200 bg-white p-2">
                          <div className="text-[11px] uppercase tracking-[0.12em] text-stone-500">Last Payment</div>
                          <div className="text-sm font-medium text-stone-900">{successfulPayments[0]?.paidAt ? formatDate(successfulPayments[0].paidAt) : '—'}</div>
                        </div>
                      </div>

                      <div className="mt-4 rounded-2xl border border-stone-200 bg-white p-3">
                        {!enrollment.canPay ? (
                          <p className="text-sm text-stone-600">
                            {enrollment.isOverdue ? 'Payments are blocked because this enrollment is past the due date.' : 'No remaining balance.'}
                          </p>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              className="w-40 rounded-xl border border-stone-300 px-3 py-2 text-sm"
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
                              <span className="text-xs text-stone-500">Partial payments are enabled for this trip.</span>
                            )}
                            <button
                              className="inline-flex items-center gap-1 rounded-xl bg-stone-900 px-4 py-2 text-sm font-medium text-white"
                              onClick={() => void startPaymentSession(enrollment)}
                            >
                              Pay <ArrowRight className="h-4 w-4" />
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="mt-4">
                        <h5 className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-stone-800">
                          <FileText className="h-4 w-4" />
                          Documents
                        </h5>
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
                                className="rounded-xl border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-700 transition hover:border-stone-500"
                              >
                                {document.title}
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>

            {activeCheckout ? (
              <section className="space-y-2 rounded-3xl border border-orange-200 bg-white p-5 shadow-sm">
                <h2 className="text-lg font-semibold text-stone-900">Complete Payment</h2>
                <p className="text-sm text-stone-600">
                  Secure checkout is ready. After payment, this dashboard refreshes with your updated progress and history.
                </p>
                <EmbeddedCheckoutCard
                  key={activeCheckout.paymentId}
                  clientSecret={activeCheckout.clientSecret}
                  publishableKey={activeCheckout.publishableKey}
                  onComplete={() => void handleCheckoutComplete()}
                />
              </section>
            ) : null}

            <section className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold text-stone-900">Payment Activity</h2>
                <div className="flex flex-wrap items-center gap-2">
                  {(['ALL', 'SUCCEEDED', 'PENDING', 'FAILED', 'EXPIRED'] as const).map((status) => (
                    <button
                      key={status}
                      className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                        historyFilter === status
                          ? 'border-stone-900 bg-stone-900 text-white'
                          : 'border-stone-300 bg-white text-stone-700 hover:border-stone-500'
                      }`}
                      onClick={() => setHistoryFilter(status)}
                    >
                      {status === 'ALL' ? 'All' : status}
                    </button>
                  ))}
                </div>
              </div>

              {selectedEnrollment ? (
                <div className="mb-3 rounded-2xl border border-orange-200 bg-orange-50 p-3 text-sm text-stone-700">
                  <div className="font-medium text-stone-900">Focused Trip: {selectedEnrollment.trip.title}</div>
                  <div className="mt-1">
                    {selectedEnrollmentPayments.length} recorded transaction{selectedEnrollmentPayments.length === 1 ? '' : 's'} for this trip.
                  </div>
                </div>
              ) : null}

              {filteredPayments.length === 0 ? (
                <p className="text-sm text-stone-500">No payments yet for this filter.</p>
              ) : (
                <div className="space-y-2">
                  {filteredPayments.map((payment) => {
                    const meta = statusMeta(payment.status);
                    return (
                      <div key={payment.id} className="rounded-2xl border border-stone-200 bg-stone-50 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="font-medium text-stone-900">{payment.tripTitle}</div>
                            <div className="mt-1 text-xs text-stone-500">
                              Created {formatDate(payment.createdAt)}
                              {payment.paidAt ? ` • Paid ${formatDate(payment.paidAt)}` : ''}
                            </div>
                            {payment.stripePaymentIntentId ? (
                              <div className="mt-1 text-[11px] text-stone-500">Reference {payment.stripePaymentIntentId}</div>
                            ) : null}
                          </div>
                          <div className="text-right">
                            <div className="text-lg font-semibold text-stone-900">{formatMoney(payment.amountCents)}</div>
                            <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${meta.className}`}>{meta.label}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        ) : null}
      </div>
    </main>
  );
}
