import { useEffect, useMemo, useState } from 'react';
import { Activity, ArrowRight, CalendarClock, ReceiptText, ScanLine, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { adminFetch, hasAdminRole } from '../../lib/adminAuth';
import { useAdminSession } from './useAdminSession';

type DashboardRange = 'month' | 'today' | 'rolling30';

type DashboardResponse = {
  generatedAt: string;
  range: DashboardRange;
  core: {
    paidRevenueCents: number;
    paidOrderCount: number;
    ticketsIssuedCount: number;
    checkInsCount: number;
  };
  operations: {
    upcomingPerformances: Array<{
      id: string;
      title: string;
      startsAt: string;
      venue: string;
    }>;
    recentOrders: Array<{
      id: string;
      customerName: string;
      email: string;
      amountTotalCents: number;
      currency: string;
      status: string;
      createdAt: string;
      performance: {
        id: string;
        title: string;
        startsAt: string;
      };
    }>;
    scanner: {
      activeSessions: number;
      latestScanAt: string | null;
    };
  };
  quickLinks: {
    orders: string;
    scanner: string;
    drive?: string;
    trips?: string;
    fundraise?: string;
    forms?: string;
    audit?: string;
  };
  adminModules?: {
    trips: {
      activeTripCount: number;
      enrollmentCount: number;
      collectedCents: number;
      remainingCents: number;
      nextDueAt: string | null;
    };
    fundraise: {
      activeEventCount: number;
      seatsSold: number;
      seatsTotal: number;
      donationSucceededCents: number | null;
    };
    forms: {
      openCount: number;
      closedCount: number;
      responseCount: number;
      programBio: {
        openCount: number;
        closedCount: number;
        responseCount: number;
      };
      seniorSendoff: {
        openCount: number;
        closedCount: number;
        responseCount: number;
      };
    };
    system: {
      recentAudit: Array<{
        id: string;
        actor: string;
        action: string;
        entityType: string;
        entityId: string;
        createdAt: string;
      }>;
    };
  };
};

const RANGE_OPTIONS: Array<{ value: DashboardRange; label: string }> = [
  { value: 'month', label: 'Month' },
  { value: 'today', label: 'Today' },
  { value: 'rolling30', label: '30 Days' }
];

function formatCurrency(cents: number, currency = 'usd') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase()
  }).format(cents / 100);
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString([], {
    month: 'short',
    day: 'numeric'
  });
}

function CtaLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1 rounded-full border border-black/[0.1] bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-700 transition-all hover:border-zinc-400 hover:text-zinc-900"
    >
      {label}
      <ArrowRight className="h-3 w-3" />
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-black/[0.08] bg-white/85 p-4 shadow-[0_12px_28px_-20px_rgba(0,0,0,0.35)] backdrop-blur-sm">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <div className="mt-2 text-2xl font-black tracking-tight text-zinc-900">{value}</div>
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="h-[94px] animate-pulse rounded-2xl border border-black/[0.06] bg-white/70" />
      ))}
    </div>
  );
}

function SkeletonPanel({ heightClass }: { heightClass: string }) {
  return <div className={`${heightClass} animate-pulse rounded-2xl border border-black/[0.06] bg-white/70`} />;
}

function MetricLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-black/[0.06] bg-zinc-50/70 p-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-zinc-500">{label}</div>
      <div className="mt-1 text-sm font-bold text-zinc-900">{value}</div>
    </div>
  );
}

export default function AdminDashboardPage() {
  const { admin } = useAdminSession();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [range, setRange] = useState<DashboardRange>('month');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isAdminOrHigher = hasAdminRole(admin.role, 'ADMIN');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);

    adminFetch<DashboardResponse>(`/api/admin/dashboard?range=${range}`)
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load dashboard');
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [range]);

  const generatedLabel = useMemo(() => {
    if (!data?.generatedAt) return 'No sync yet';
    return `Updated ${formatDateTime(data.generatedAt)}`;
  }, [data?.generatedAt]);

  const quickLinks = data?.quickLinks || {
    orders: '/admin/orders',
    scanner: '/admin/scanner',
    drive: '/admin/drive',
    trips: '/admin/trips',
    fundraise: '/admin/fundraise',
    forms: '/admin/forms',
    audit: '/admin/audit'
  };

  return (
    <div className="relative isolate space-y-6">
      <div className="pointer-events-none absolute inset-x-0 -top-6 -z-10 h-48 rounded-[32px] bg-gradient-to-r from-rose-200/55 via-amber-100/70 to-sky-200/55 blur-2xl" />

      <header className="rounded-3xl border border-black/[0.08] bg-[linear-gradient(145deg,rgba(255,255,255,0.95),rgba(250,247,241,0.94))] p-5 shadow-[0_24px_48px_-38px_rgba(0,0,0,0.45)] sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">Admin Cockpit</p>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-zinc-900 sm:text-3xl">Operations at a glance</h1>
            <p className="mt-1 text-sm text-zinc-600">{generatedLabel}</p>
          </div>
          <div className="flex items-center gap-1 rounded-full border border-black/[0.08] bg-white/80 p-1 backdrop-blur">
            {RANGE_OPTIONS.map((option) => {
              const active = option.value === range;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setRange(option.value)}
                  disabled={loading}
                  className={`rounded-full px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] transition-all ${
                    active
                      ? 'bg-zinc-900 text-white shadow-sm'
                      : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {error ? (
        <div className="rounded-2xl border border-red-300/70 bg-red-50 p-3 text-sm font-medium text-red-700">
          Unable to refresh dashboard data. {error}
        </div>
      ) : null}

      {loading && !data ? (
        <SkeletonRow />
      ) : data ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <Stat label="Paid Revenue" value={formatCurrency(data.core.paidRevenueCents)} />
          <Stat label="Paid Orders" value={String(data.core.paidOrderCount)} />
          <Stat label="Tickets Issued" value={String(data.core.ticketsIssuedCount)} />
          <Stat label="Check-Ins" value={String(data.core.checkInsCount)} />
        </div>
      ) : null}

      {loading && !data ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <SkeletonPanel heightClass="h-72 xl:col-span-2" />
          <SkeletonPanel heightClass="h-72" />
        </div>
      ) : data ? (
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <div className="rounded-2xl border border-black/[0.08] bg-white p-5 shadow-[0_16px_34px_-26px_rgba(0,0,0,0.45)] xl:col-span-2">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4 text-rose-600" />
                <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-zinc-700">Upcoming Performances</h2>
              </div>
              <CtaLink to={quickLinks.orders} label="Orders" />
            </div>
            <div className="space-y-2">
              {data.operations.upcomingPerformances.length === 0 ? (
                <p className="rounded-xl border border-dashed border-black/[0.12] p-4 text-sm text-zinc-500">
                  No non-archived upcoming performances.
                </p>
              ) : (
                data.operations.upcomingPerformances.map((performance) => (
                  <div
                    key={performance.id}
                    className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-black/[0.06] bg-zinc-50/70 p-3"
                  >
                    <div>
                      <div className="font-semibold text-zinc-900">{performance.title}</div>
                      <div className="text-xs text-zinc-600">
                        {formatDateTime(performance.startsAt)} at {performance.venue}
                      </div>
                    </div>
                    <div className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-600">
                      {formatDate(performance.startsAt)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-black/[0.08] bg-white p-5 shadow-[0_16px_34px_-26px_rgba(0,0,0,0.45)]">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <ReceiptText className="h-4 w-4 text-sky-600" />
                <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-zinc-700">Recent Orders</h2>
              </div>
              <CtaLink to={quickLinks.orders} label="View All" />
            </div>
            <div className="space-y-2">
              {data.operations.recentOrders.length === 0 ? (
                <p className="rounded-xl border border-dashed border-black/[0.12] p-4 text-sm text-zinc-500">
                  No orders yet.
                </p>
              ) : (
                data.operations.recentOrders.map((order) => (
                  <div key={order.id} className="rounded-xl border border-black/[0.06] bg-zinc-50/70 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-zinc-900">{order.customerName}</div>
                        <div className="truncate text-xs text-zinc-600">{order.performance.title}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-bold text-zinc-900">{formatCurrency(order.amountTotalCents, order.currency)}</div>
                        <div className="text-[11px] uppercase tracking-wide text-zinc-500">{order.status}</div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      ) : null}

      {loading && !data ? (
        <SkeletonPanel heightClass="h-36" />
      ) : data ? (
        <section className="rounded-2xl border border-black/[0.08] bg-white p-5 shadow-[0_16px_34px_-26px_rgba(0,0,0,0.45)]">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ScanLine className="h-4 w-4 text-emerald-600" />
              <h2 className="text-sm font-semibold uppercase tracking-[0.15em] text-zinc-700">Scanner Status</h2>
            </div>
            <CtaLink to={quickLinks.scanner} label="Open Scanner" />
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-black/[0.06] bg-zinc-50/70 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-zinc-500">Active Sessions</div>
              <div className="mt-1 text-2xl font-black text-zinc-900">{data.operations.scanner.activeSessions}</div>
            </div>
            <div className="rounded-xl border border-black/[0.06] bg-zinc-50/70 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.15em] text-zinc-500">Latest Scan</div>
              <div className="mt-1 text-sm font-semibold text-zinc-900">
                {data.operations.scanner.latestScanAt ? formatDateTime(data.operations.scanner.latestScanAt) : 'No scans yet'}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {isAdminOrHigher ? (
        loading && !data ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <SkeletonPanel heightClass="h-52" />
            <SkeletonPanel heightClass="h-52" />
            <SkeletonPanel heightClass="h-52" />
            <SkeletonPanel heightClass="h-52" />
          </div>
        ) : data?.adminModules ? (
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-zinc-700" />
                <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-zinc-700">Admin Modules</h2>
              </div>
              <CtaLink to={quickLinks.drive || '/admin/drive'} label="Drive" />
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <article className="rounded-2xl border border-black/[0.08] bg-white p-5 shadow-[0_16px_34px_-26px_rgba(0,0,0,0.45)]">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-base font-bold text-zinc-900">Trips</h3>
                  <CtaLink to={quickLinks.trips || '/admin/trips'} label="Trip Payments" />
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <MetricLine label="Active Trips" value={String(data.adminModules.trips.activeTripCount)} />
                  <MetricLine label="Enrollments" value={String(data.adminModules.trips.enrollmentCount)} />
                  <MetricLine label="Collected" value={formatCurrency(data.adminModules.trips.collectedCents)} />
                  <MetricLine label="Remaining" value={formatCurrency(data.adminModules.trips.remainingCents)} />
                </div>
                <div className="mt-3 text-xs text-zinc-600">
                  Next due:{' '}
                  {data.adminModules.trips.nextDueAt ? (
                    <span className="font-semibold text-zinc-900">{formatDateTime(data.adminModules.trips.nextDueAt)}</span>
                  ) : (
                    'No upcoming due date'
                  )}
                </div>
              </article>

              <article className="rounded-2xl border border-black/[0.08] bg-white p-5 shadow-[0_16px_34px_-26px_rgba(0,0,0,0.45)]">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-base font-bold text-zinc-900">Fundraise</h3>
                  <CtaLink to={quickLinks.fundraise || '/admin/fundraise'} label="Fundraise" />
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <MetricLine label="Active Events" value={String(data.adminModules.fundraise.activeEventCount)} />
                  <MetricLine
                    label="Seats Sold"
                    value={`${data.adminModules.fundraise.seatsSold}/${data.adminModules.fundraise.seatsTotal}`}
                  />
                  <MetricLine
                    label="Donations"
                    value={
                      data.adminModules.fundraise.donationSucceededCents === null
                        ? 'Unavailable'
                        : formatCurrency(data.adminModules.fundraise.donationSucceededCents)
                    }
                  />
                </div>
              </article>

              <article className="rounded-2xl border border-black/[0.08] bg-white p-5 shadow-[0_16px_34px_-26px_rgba(0,0,0,0.45)]">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h3 className="text-base font-bold text-zinc-900">Forms</h3>
                  <CtaLink to={quickLinks.forms || '/admin/forms'} label="Forms" />
                </div>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <MetricLine label="Open" value={String(data.adminModules.forms.openCount)} />
                  <MetricLine label="Closed" value={String(data.adminModules.forms.closedCount)} />
                  <MetricLine label="Responses" value={String(data.adminModules.forms.responseCount)} />
                </div>
                <div className="mt-3 space-y-1 text-xs text-zinc-600">
                  <div className="flex items-center justify-between">
                    <span>Program Bio</span>
                    <span>{data.adminModules.forms.programBio.responseCount} responses</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Senior Sendoff</span>
                    <span>{data.adminModules.forms.seniorSendoff.responseCount} responses</span>
                  </div>
                </div>
              </article>

              <article className="rounded-2xl border border-black/[0.08] bg-white p-5 shadow-[0_16px_34px_-26px_rgba(0,0,0,0.45)]">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Activity className="h-4 w-4 text-zinc-700" />
                    <h3 className="text-base font-bold text-zinc-900">System Activity</h3>
                  </div>
                  <CtaLink to={quickLinks.audit || '/admin/audit'} label="Audit Log" />
                </div>
                {data.adminModules.system.recentAudit.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-black/[0.12] p-4 text-sm text-zinc-500">
                    No recent audit entries.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {data.adminModules.system.recentAudit.map((entry) => (
                      <div key={entry.id} className="rounded-xl border border-black/[0.06] bg-zinc-50/70 p-2.5">
                        <div className="text-xs font-semibold text-zinc-800">{entry.action}</div>
                        <div className="mt-0.5 text-[11px] text-zinc-600">
                          {entry.actor} • {entry.entityType}/{entry.entityId}
                        </div>
                        <div className="mt-0.5 text-[11px] text-zinc-500">{formatDateTime(entry.createdAt)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </article>
            </div>
          </section>
        ) : (
          <div className="rounded-2xl border border-red-300/70 bg-red-50 p-3 text-sm text-red-700">
            Admin module data is unavailable.
          </div>
        )
      ) : null}
    </div>
  );
}
