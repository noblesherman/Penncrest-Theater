import { FormEvent, useEffect, useMemo, useState } from 'react';
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { ArrowRight, FileText } from 'lucide-react';
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
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function progressPercent(paidAmountCents: number, targetAmountCents: number): number {
  if (targetAmountCents <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((paidAmountCents / targetAmountCents) * 100)));
}

function dueCountdown(dueAt: string, isOverdue: boolean): string {
  const days = Math.ceil((new Date(dueAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  if (isOverdue) {
    const lateBy = Math.max(1, Math.abs(days));
    return `${lateBy} day${lateBy === 1 ? '' : 's'} overdue`;
  }
  if (days < 0) return 'Past due date';
  if (days === 0) return 'Due today';
  return `${days} day${days === 1 ? '' : 's'} left`;
}

function statusMeta(status: string): { label: string; className: string } {
  if (status === 'SUCCEEDED') return { label: 'Completed', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
  if (status === 'PENDING') return { label: 'Processing', className: 'bg-amber-50 text-amber-700 border-amber-200' };
  if (status === 'FAILED') return { label: 'Failed', className: 'bg-rose-50 text-rose-700 border-rose-200' };
  if (status === 'EXPIRED') return { label: 'Expired', className: 'bg-stone-100 text-stone-600 border-stone-300' };
  return { label: status, className: 'bg-stone-100 text-stone-600 border-stone-300' };
}

// SVG donut — no Chart.js dependency, keeps the bundle light
function ProgressDonut({
  paidAmountCents,
  targetAmountCents,
  size = 110,
  stroke = 9,
}: {
  paidAmountCents: number;
  targetAmountCents: number;
  size?: number;
  stroke?: number;
}) {
  const percent = progressPercent(paidAmountCents, targetAmountCents);
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;

  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} className="fill-none stroke-[#e8d5d3]" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          strokeLinecap="round"
          style={{ fill: 'none', stroke: '#C0392B', strokeDasharray: circumference, strokeDashoffset: offset, transition: 'stroke-dashoffset 0.6s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-xl font-semibold text-[#1a1611]" style={{ fontFamily: "'Playfair Display', Georgia, serif" }}>{percent}%</span>
        <span className="text-[10px] text-[#7a7268]">funded</span>
      </div>
    </div>
  );
}

function EmbeddedCheckoutCard({ clientSecret, publishableKey, onComplete }: { clientSecret: string; publishableKey: string; onComplete: () => void }) {
  const stripePromise = useMemo(() => loadStripe(publishableKey), [publishableKey]);
  return (
    <div className="rounded-2xl border border-[#e8d5d3] bg-[#FDF5F4] p-4">
      <EmbeddedCheckoutProvider stripe={stripePromise} options={{ clientSecret, onComplete }}>
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  );
}

// Shared card wrapper
function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-[rgba(26,22,17,0.1)] bg-white p-5 ${className}`}>
      {children}
    </div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.16em] text-[#C0392B]">{children}</p>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xl font-semibold text-[#1a1611]" style={{ fontFamily: "'Playfair Display', Georgia, serif" }}>{children}</h2>
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
          Object.fromEntries(dash.enrollments.map((e) => [e.enrollmentId, (e.remainingAmountCents / 100).toFixed(2)]))
        );
        setActiveEnrollmentId((prev) => {
          if (!prev || !dash.enrollments.some((e) => e.enrollmentId === prev)) {
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
    if (!getTripToken()) return;
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
        body: JSON.stringify({ email: requestCodeEmail.trim(), name: requestCodeName.trim() || undefined }),
      });
      setAuthStage('verify');
      setNotice('Code sent. Check your email and enter it below.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to request code');
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
        body: JSON.stringify({ email: requestCodeEmail.trim(), code: verificationCode.trim() }),
      });
      setTripToken(verified.token);
      setVerificationCode('');
      await loadAuthenticatedState();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to verify code');
    } finally {
      setLoading(false);
    }
  }

  async function handleClaimStudent(studentId: string) {
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      await tripFetch('/api/trips/portal/claim', { method: 'POST', body: JSON.stringify({ studentId }) });
      await loadAuthenticatedState();
      setNotice('Student claimed successfully.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to claim student');
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
        body: JSON.stringify({ enrollmentId: enrollment.enrollmentId, amountCents }),
      });
      const publishableKey = (sessionResponse.publishableKey || fallbackPublishableKey || '').trim();
      if (!publishableKey) throw new Error('Stripe publishable key is missing.');
      if (!sessionResponse.clientSecret) throw new Error('Stripe client secret missing from payment session.');
      setActiveEnrollmentId(enrollment.enrollmentId);
      setActiveCheckout({ paymentId: sessionResponse.paymentId, enrollmentId: enrollment.enrollmentId, clientSecret: sessionResponse.clientSecret, publishableKey });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to start payment session');
    }
  }

  async function handleCheckoutComplete() {
    setActiveCheckout(null);
    await loadAuthenticatedState();
    setNotice('Payment completed. Your balance and history have been refreshed.');
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
    const targetAmountCents = dashboard.enrollments.reduce((s, e) => s + e.targetAmountCents, 0);
    const paidAmountCents = dashboard.enrollments.reduce((s, e) => s + e.paidAmountCents, 0);
    const remainingAmountCents = dashboard.enrollments.reduce((s, e) => s + e.remainingAmountCents, 0);
    const nextDue = [...dashboard.enrollments]
      .filter((e) => e.remainingAmountCents > 0)
      .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())[0];
    const completedPayments = dashboard.payments.filter((p) => p.status === 'SUCCEEDED');
    const pendingPayments = dashboard.payments.filter((p) => p.status === 'PENDING');
    return {
      targetAmountCents,
      paidAmountCents,
      remainingAmountCents,
      completionPercent: progressPercent(paidAmountCents, targetAmountCents),
      nextDue,
      completedPayments: completedPayments.length,
      pendingPayments: pendingPayments.length,
    };
  }, [dashboard]);

  const selectedEnrollment = useMemo(() => {
    if (!dashboard) return null;
    return dashboard.enrollments.find((e) => e.enrollmentId === activeEnrollmentId) || dashboard.enrollments[0] || null;
  }, [dashboard, activeEnrollmentId]);

  const filteredPayments = useMemo(() => {
    if (!dashboard) return [];
    if (historyFilter === 'ALL') return dashboard.payments;
    return dashboard.payments.filter((p) => p.status === historyFilter);
  }, [dashboard, historyFilter]);

  const selectedEnrollmentPayments = useMemo(() => {
    if (!dashboard || !selectedEnrollment) return [];
    return dashboard.payments.filter((p) => p.enrollmentId === selectedEnrollment.enrollmentId);
  }, [dashboard, selectedEnrollment]);

  const inputCls = 'w-full rounded-xl border border-[rgba(26,22,17,0.15)] bg-[#FAF8F5] px-3 py-2.5 text-sm text-[#1a1611] outline-none focus:border-[#C0392B] transition-colors';
  const primaryBtn = 'inline-flex items-center gap-2 rounded-xl bg-[#C0392B] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#922b21] transition-colors';
  const ghostBtn = 'rounded-xl border border-[rgba(26,22,17,0.15)] bg-white px-4 py-2.5 text-sm text-[#1a1611] hover:border-[rgba(26,22,17,0.35)] transition-colors';

  const playfair = { fontFamily: "'Playfair Display', Georgia, serif" };

  return (
    <main className="min-h-screen bg-[#FAF8F5] px-4 py-10">
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;0,600;1,500&display=swap');`}</style>

      <div className="mx-auto max-w-4xl">

        {/* Header */}
        <div className="mb-8 flex flex-wrap items-end justify-between gap-3 border-b border-[rgba(26,22,17,0.1)] pb-6">
          <div>
            <Eyebrow>Penncrest Theater · Trip Portal</Eyebrow>
            <h1 className="text-4xl font-semibold leading-tight text-[#1a1611]" style={playfair}>
              Trip <em className="italic text-[#C0392B]">Finances</em>
            </h1>
            <p className="mt-1.5 text-sm text-[#7a7268]">Track balances, payments, and deadlines for your student.</p>
          </div>
          {authStage === 'authenticated' && (
            <button onClick={handleLogout} className={ghostBtn}>Sign out</button>
          )}
        </div>

        {/* Alerts */}
        {error && <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
        {notice && <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}
        {loading && authStage !== 'authenticated' && <div className="mb-5 text-sm text-[#7a7268]">Loading…</div>}

        {/* ── Request code ── */}
        {authStage === 'request' && (
          <Card className="max-w-md">
            <Eyebrow>Sign in</Eyebrow>
            <SectionTitle>Get your login code</SectionTitle>
            <p className="mt-1 mb-5 text-sm text-[#7a7268]">We'll send a one-time code so families can securely access payment plans.</p>
            <form className="space-y-3" onSubmit={handleRequestCode}>
              <input className={inputCls} type="email" value={requestCodeEmail} onChange={(e) => setRequestCodeEmail(e.target.value)} placeholder="Email address" required />
              <input className={inputCls} value={requestCodeName} onChange={(e) => setRequestCodeName(e.target.value)} placeholder="Your name (optional)" />
              <button className={primaryBtn} disabled={loading}>
                Send code <ArrowRight className="h-4 w-4" />
              </button>
            </form>
          </Card>
        )}

        {/* ── Verify code ── */}
        {authStage === 'verify' && (
          <Card className="max-w-md">
            <Eyebrow>Verification</Eyebrow>
            <SectionTitle>Enter your code</SectionTitle>
            <p className="mt-1 mb-5 text-sm text-[#7a7268]">We sent a 6-digit code to {requestCodeEmail}.</p>
            <form className="space-y-3" onSubmit={handleVerifyCode}>
              <input className={inputCls} value={verificationCode} onChange={(e) => setVerificationCode(e.target.value)} placeholder="6-digit code" required />
              <div className="flex gap-2">
                <button className={primaryBtn}>Verify</button>
                <button type="button" className={ghostBtn} onClick={() => setAuthStage('request')}>Back</button>
              </div>
            </form>
          </Card>
        )}

        {/* ── Claim student ── */}
        {needsClaim && (
          <Card>
            <Eyebrow>Account setup</Eyebrow>
            <SectionTitle>Claim your student profile</SectionTitle>
            <p className="mt-1 mb-5 text-sm text-[#7a7268]">Link this account to your student so balances and documents stay secure.</p>
            <div className="grid gap-3 md:grid-cols-2">
              {claimOptions?.claimableStudents.map((student) => (
                <div key={student.id} className="rounded-xl border border-[rgba(26,22,17,0.1)] bg-[#FAF8F5] p-4">
                  <p className="font-semibold text-[#1a1611]" style={playfair}>
                    {student.name}
                    {student.grade && <span className="ml-2 text-sm font-normal text-[#7a7268]">Grade {student.grade}</span>}
                  </p>
                  <p className="mt-1 text-xs text-[#7a7268]">{student.trips.map((t) => t.title).join(', ')}</p>
                  <button className={`mt-3 ${ghostBtn}`} onClick={() => void handleClaimStudent(student.id)}>Claim student</button>
                </div>
              ))}
            </div>
            {claimOptions?.claimableStudents.length === 0 && (
              <p className="text-sm text-[#7a7268]">No unclaimed roster entries are currently available.</p>
            )}
          </Card>
        )}

        {/* ── Dashboard ── */}
        {authStage === 'authenticated' && dashboard && !needsClaim && (
          <div className="space-y-5">

            {/* Hero summary */}
            <div className="rounded-2xl border border-[#e8d5d3] bg-[#FDF5F4] p-6">
              <div className="grid gap-6 md:grid-cols-[1fr_auto]">
                <div>
                  <Eyebrow>Family dashboard</Eyebrow>
                  <h2 className="text-3xl font-semibold text-[#1a1611]" style={playfair}>
                    {dashboard.student?.name || session?.account.name || 'Student'}
                    {dashboard.student?.grade && (
                      <span className="ml-3 text-xl font-normal text-[#7a7268]">Grade {dashboard.student.grade}</span>
                    )}
                  </h2>
                  <p className="mt-2 text-sm text-[#7a7268]">
                    {summary?.completionPercent || 0}% of all trip costs funded — keep the momentum going.
                  </p>
                  {summary?.nextDue ? (
                    <div className="mt-4 inline-flex items-center gap-2 rounded-xl border border-[#e8d5d3] bg-white px-3 py-2 text-sm text-[#1a1611]">
                      <span className="h-2 w-2 rounded-full bg-amber-400 flex-shrink-0" />
                      Next due: <span className="font-medium">{summary.nextDue.trip.title}</span> · {formatDate(summary.nextDue.dueAt)}
                    </div>
                  ) : (
                    <div className="mt-4 inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                      <span className="h-2 w-2 rounded-full bg-emerald-500 flex-shrink-0" />
                      All trip balances are fully paid.
                    </div>
                  )}
                </div>
                {/* Overall donut */}
                <div className="flex flex-col items-center justify-center gap-1">
                  <ProgressDonut paidAmountCents={summary?.paidAmountCents || 0} targetAmountCents={summary?.targetAmountCents || 0} size={120} stroke={10} />
                  <p className="text-[10px] uppercase tracking-widest text-[#7a7268]">Overall</p>
                </div>
              </div>
            </div>

            {/* Metric row */}
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[
                { label: 'Target', value: formatMoney(summary?.targetAmountCents || 0), sub: 'across all trips', cls: '' },
                { label: 'Paid to date', value: formatMoney(summary?.paidAmountCents || 0), sub: `${summary?.completedPayments || 0} payments`, cls: 'border-[#e8d5d3] bg-[#FDF5F4]' },
                { label: 'Remaining', value: formatMoney(summary?.remainingAmountCents || 0), sub: 'still to pay', cls: 'border-amber-200 bg-amber-50' },
                { label: 'Activity', value: `${summary?.completedPayments || 0} done`, sub: `${summary?.pendingPayments || 0} pending`, cls: '' },
              ].map(({ label, value, sub, cls }) => (
                <div key={label} className={`rounded-2xl border border-[rgba(26,22,17,0.1)] bg-white p-4 ${cls}`}>
                  <p className="text-[10px] uppercase tracking-[0.14em] text-[#7a7268]">{label}</p>
                  <p className="mt-1 text-2xl font-semibold text-[#1a1611]" style={playfair}>{value}</p>
                  <p className="mt-0.5 text-[11px] text-[#7a7268]">{sub}</p>
                </div>
              ))}
            </div>

            {/* Trip progress cards */}
            <Card>
              <Eyebrow>Enrollments</Eyebrow>
              <SectionTitle>Trip progress</SectionTitle>
              <p className="mt-1 mb-5 text-sm text-[#7a7268]">Select a trip to make a payment or view documents.</p>
              <div className="grid gap-4 lg:grid-cols-2">
                {dashboard.enrollments.map((enrollment) => {
                  const isActive = enrollment.enrollmentId === selectedEnrollment?.enrollmentId;
                  const percent = progressPercent(enrollment.paidAmountCents, enrollment.targetAmountCents);
                  const enrollmentHistory = dashboard.payments.filter((p) => p.enrollmentId === enrollment.enrollmentId);
                  const successfulPayments = enrollmentHistory.filter((p) => p.status === 'SUCCEEDED');
                  const avgCents = successfulPayments.length > 0
                    ? Math.round(successfulPayments.reduce((s, p) => s + p.amountCents, 0) / successfulPayments.length)
                    : null;

                  return (
                    <article
                      key={enrollment.enrollmentId}
                      className={`rounded-2xl border p-4 cursor-pointer transition-all ${
                        isActive
                          ? 'border-[#C0392B] bg-[#FDF5F4] shadow-sm'
                          : 'border-[rgba(26,22,17,0.1)] bg-[#FAF8F5] hover:border-[rgba(26,22,17,0.2)]'
                      }`}
                      onClick={() => setActiveEnrollmentId(enrollment.enrollmentId)}
                    >
                      {/* Title row */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <h4 className="font-semibold text-[#1a1611] truncate" style={playfair}>{enrollment.trip.title}</h4>
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            <span className="rounded-full border border-[rgba(26,22,17,0.1)] bg-white px-2 py-0.5 text-[11px] text-[#7a7268]">
                              Due {formatDate(enrollment.dueAt)}
                            </span>
                            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                              enrollment.isOverdue
                                ? 'border-rose-200 bg-rose-50 text-rose-700'
                                : enrollment.remainingAmountCents === 0
                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                  : 'border-amber-200 bg-amber-50 text-amber-700'
                            }`}>
                              {dueCountdown(enrollment.dueAt, enrollment.isOverdue)}
                            </span>
                          </div>
                        </div>
                        <ProgressDonut paidAmountCents={enrollment.paidAmountCents} targetAmountCents={enrollment.targetAmountCents} size={80} stroke={7} />
                      </div>

                      {/* Progress bar */}
                      <div className="mt-4">
                        <div className="mb-1 flex justify-between text-[11px] text-[#7a7268]">
                          <span>{formatMoney(enrollment.paidAmountCents)} paid</span>
                          <span className="text-[#C0392B]">{formatMoney(enrollment.remainingAmountCents)} left</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-[#e8d5d3]">
                          <div className="h-full rounded-full bg-[#C0392B] transition-all duration-500" style={{ width: `${percent}%` }} />
                        </div>
                        <p className="mt-1 text-[10px] text-[#7a7268]">{percent}% of {formatMoney(enrollment.targetAmountCents)} target</p>
                      </div>

                      {/* Mini stats */}
                      <div className="mt-4 grid grid-cols-3 gap-2">
                        {[
                          { label: 'Payments', value: String(successfulPayments.length) },
                          { label: 'Avg payment', value: avgCents ? formatMoney(avgCents) : '—' },
                          { label: 'Last paid', value: successfulPayments[0]?.paidAt ? formatDate(successfulPayments[0].paidAt) : '—' },
                        ].map(({ label, value }) => (
                          <div key={label} className="rounded-xl border border-[rgba(26,22,17,0.08)] bg-white p-2">
                            <p className="text-[10px] uppercase tracking-[0.1em] text-[#7a7268]">{label}</p>
                            <p className="mt-0.5 text-sm font-medium text-[#1a1611]">{value}</p>
                          </div>
                        ))}
                      </div>

                      {/* Payment input */}
                      <div className="mt-4 rounded-xl border border-[rgba(26,22,17,0.08)] bg-white p-3">
                        {!enrollment.canPay ? (
                          <p className="text-sm text-[#7a7268]">
                            {enrollment.isOverdue ? 'Payments are blocked — this enrollment is past due.' : 'No remaining balance.'}
                          </p>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              className="w-36 rounded-xl border border-[rgba(26,22,17,0.15)] bg-[#FAF8F5] px-3 py-2 text-sm text-[#1a1611] outline-none focus:border-[#C0392B] transition-colors"
                              type="number"
                              min="0.01"
                              step="0.01"
                              value={amountDraftByEnrollmentId[enrollment.enrollmentId] || ''}
                              onChange={(e) => setAmountDraftByEnrollmentId((prev) => ({ ...prev, [enrollment.enrollmentId]: e.target.value }))}
                              disabled={!enrollment.allowPartialPayments}
                              onClick={(e) => e.stopPropagation()}
                            />
                            <button
                              className={primaryBtn}
                              onClick={(e) => { e.stopPropagation(); void startPaymentSession(enrollment); }}
                            >
                              Pay <ArrowRight className="h-4 w-4" />
                            </button>
                            <span className="text-[11px] text-[#7a7268]">
                              {enrollment.allowPartialPayments ? 'Partial payments enabled' : 'Full payment only'}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Documents */}
                      {enrollment.trip.documents.length > 0 && (
                        <div className="mt-4">
                          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.1em] text-[#7a7268]">
                            <FileText className="h-3.5 w-3.5" /> Documents
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {enrollment.trip.documents.map((doc) => (
                              <a
                                key={doc.id}
                                href={doc.fileUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="rounded-xl border border-[rgba(26,22,17,0.12)] bg-white px-3 py-1.5 text-[12px] text-[#1a1611] hover:border-[rgba(26,22,17,0.3)] transition-colors"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {doc.title}
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </Card>

            {/* Embedded checkout */}
            {activeCheckout && (
              <Card>
                <Eyebrow>Checkout</Eyebrow>
                <SectionTitle>Complete payment</SectionTitle>
                <p className="mt-1 mb-4 text-sm text-[#7a7268]">
                  Secure checkout powered by Stripe. Your dashboard refreshes automatically after payment.
                </p>
                <EmbeddedCheckoutCard
                  key={activeCheckout.paymentId}
                  clientSecret={activeCheckout.clientSecret}
                  publishableKey={activeCheckout.publishableKey}
                  onComplete={() => void handleCheckoutComplete()}
                />
              </Card>
            )}

            {/* Payment history */}
            <Card>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <Eyebrow>History</Eyebrow>
                  <SectionTitle>Payment activity</SectionTitle>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(['ALL', 'SUCCEEDED', 'PENDING', 'FAILED', 'EXPIRED'] as const).map((status) => (
                    <button
                      key={status}
                      className={`rounded-full border px-3 py-1 text-[11px] font-medium transition ${
                        historyFilter === status
                          ? 'border-[#C0392B] bg-[#C0392B] text-white'
                          : 'border-[rgba(26,22,17,0.15)] bg-white text-[#7a7268] hover:border-[rgba(26,22,17,0.3)]'
                      }`}
                      onClick={() => setHistoryFilter(status)}
                    >
                      {status === 'ALL' ? 'All' : status === 'SUCCEEDED' ? 'Completed' : status === 'PENDING' ? 'Pending' : status === 'FAILED' ? 'Failed' : 'Expired'}
                    </button>
                  ))}
                </div>
              </div>

              {selectedEnrollment && (
                <div className="mb-4 rounded-xl border border-[#e8d5d3] bg-[#FDF5F4] px-4 py-3 text-sm">
                  <span className="font-medium text-[#1a1611]">{selectedEnrollment.trip.title}</span>
                  <span className="ml-2 text-[#7a7268]">· {selectedEnrollmentPayments.length} transaction{selectedEnrollmentPayments.length === 1 ? '' : 's'}</span>
                </div>
              )}

              {filteredPayments.length === 0 ? (
                <p className="text-sm text-[#7a7268]">No payments match this filter.</p>
              ) : (
                <div className="divide-y divide-[rgba(26,22,17,0.07)]">
                  {filteredPayments.map((payment) => {
                    const meta = statusMeta(payment.status);
                    return (
                      <div key={payment.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                        <div>
                          <p className="text-sm font-medium text-[#1a1611]">{payment.tripTitle}</p>
                          <p className="mt-0.5 text-[11px] text-[#7a7268]">
                            {formatDate(payment.createdAt)}
                            {payment.paidAt ? ` · Paid ${formatDate(payment.paidAt)}` : ''}
                          </p>
                          {payment.stripePaymentIntentId && (
                            <p className="mt-0.5 font-mono text-[10px] text-[#7a7268]">{payment.stripePaymentIntentId}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-lg font-semibold text-[#1a1611]" style={playfair}>{formatMoney(payment.amountCents)}</span>
                          <span className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${meta.className}`}>{meta.label}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

          </div>
        )}

        <p className="mt-8 text-center text-[11px] text-[#7a7268]">Penncrest High School Theater · Payments secured by Stripe</p>
      </div>
    </main>
  );
}