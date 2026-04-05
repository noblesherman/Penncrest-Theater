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
  { value: 'today', label: 'Today' },
  { value: 'month', label: 'This Month' },
  { value: 'rolling30', label: 'Last 30 Days' },
];

function formatCurrency(cents: number, currency = 'usd') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
  });
}

function ViewAllLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-900 transition-colors"
    >
      {label}
      <ArrowRight className="h-3 w-3" />
    </Link>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5">
      <div className="text-xs font-semibold uppercase tracking-widest text-zinc-400">{label}</div>
      <div className="mt-2 text-3xl font-bold tracking-tight text-zinc-900">{value}</div>
    </div>
  );
}

function SkeletonCard({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl border border-zinc-200 bg-zinc-100 ${className}`} />;
}

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      {icon}
      <h2 className="text-sm font-semibold uppercase tracking-widest text-zinc-500">{title}</h2>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <p className="rounded-lg border border-dashed border-zinc-200 px-4 py-6 text-sm text-center text-zinc-400">
      {message}
    </p>
  );
}

function MetricPair({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-zinc-100 last:border-0">
      <span className="text-sm text-zinc-500">{label}</span>
      <span className="text-sm font-semibold text-zinc-900">{value}</span>
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
        if (!cancelled) setData(payload);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load dashboard');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [range]);

  const generatedLabel = useMemo(() => {
    if (!data?.generatedAt) return null;
    return `Updated ${formatDateTime(data.generatedAt)}`;
  }, [data?.generatedAt]);

  const quickLinks = data?.quickLinks ?? {
    orders: '/admin/orders',
    scanner: '/admin/scanner',
    trips: '/admin/trips',
    fundraise: '/admin/fundraise',
    forms: '/admin/forms',
    audit: '/admin/audit',
  };

  return (
    <div className="space-y-6">

      {/* Page header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Dashboard</h1>
          {generatedLabel && (
            <p className="mt-0.5 text-xs text-zinc-400">{generatedLabel}</p>
          )}
        </div>

        {/* Range toggle */}
        <div className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-white p-1">
          {RANGE_OPTIONS.map((option) => {
            const active = option.value === range;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setRange(option.value)}
                disabled={loading}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all ${
                  active
                    ? 'bg-zinc-900 text-white'
                    : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Unable to load dashboard data. {error}
        </div>
      )}

      {/* Core stats */}
      {loading && !data ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <SkeletonCard key={i} className="h-24" />)}
        </div>
      ) : data ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Revenue" value={formatCurrency(data.core.paidRevenueCents)} />
          <StatCard label="Orders" value={String(data.core.paidOrderCount)} />
          <StatCard label="Tickets Issued" value={String(data.core.ticketsIssuedCount)} />
          <StatCard label="Check-Ins" value={String(data.core.checkInsCount)} />
        </div>
      ) : null}

      {/* Performances + Recent Orders */}
      {loading && !data ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <SkeletonCard className="h-64 xl:col-span-2" />
          <SkeletonCard className="h-64" />
        </div>
      ) : data ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          {/* Upcoming Performances */}
          <div className="rounded-xl border border-zinc-200 bg-white p-5 xl:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <SectionHeader
                icon={<CalendarClock className="h-4 w-4 text-zinc-400" />}
                title="Upcoming Performances"
              />
              <ViewAllLink to={quickLinks.orders} label="All orders" />
            </div>

            {data.operations.upcomingPerformances.length === 0 ? (
              <EmptyState message="No upcoming performances." />
            ) : (
              <div className="space-y-2">
                {data.operations.upcomingPerformances.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-4 rounded-lg bg-zinc-50 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-zinc-900 truncate">{p.title}</div>
                      <div className="text-xs text-zinc-500 mt-0.5">{p.venue}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-sm font-medium text-zinc-700">{formatDate(p.startsAt)}</div>
                      <div className="text-xs text-zinc-400">
                        {new Date(p.startsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Orders */}
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <div className="flex items-center justify-between mb-4">
              <SectionHeader
                icon={<ReceiptText className="h-4 w-4 text-zinc-400" />}
                title="Recent Orders"
              />
              <ViewAllLink to={quickLinks.orders} label="View all" />
            </div>

            {data.operations.recentOrders.length === 0 ? (
              <EmptyState message="No orders yet." />
            ) : (
              <div className="space-y-2">
                {data.operations.recentOrders.map((order) => (
                  <div key={order.id} className="rounded-lg bg-zinc-50 px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-zinc-900 truncate">{order.customerName}</div>
                        <div className="text-xs text-zinc-500 truncate">{order.performance.title}</div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-sm font-semibold text-zinc-900">
                          {formatCurrency(order.amountTotalCents, order.currency)}
                        </div>
                        <div className="text-[11px] uppercase tracking-wide text-zinc-400">{order.status}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* Scanner Status */}
      {loading && !data ? (
        <SkeletonCard className="h-28" />
      ) : data ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <div className="flex items-center justify-between mb-4">
            <SectionHeader
              icon={<ScanLine className="h-4 w-4 text-zinc-400" />}
              title="Scanner Status"
            />
            <ViewAllLink to={quickLinks.scanner} label="Open scanner" />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-zinc-50 px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Active Sessions</div>
              <div className="mt-1 text-2xl font-bold text-zinc-900">{data.operations.scanner.activeSessions}</div>
            </div>
            <div className="rounded-lg bg-zinc-50 px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Latest Scan</div>
              <div className="mt-1 text-sm font-semibold text-zinc-900">
                {data.operations.scanner.latestScanAt
                  ? formatDateTime(data.operations.scanner.latestScanAt)
                  : 'No scans yet'}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Admin Modules */}
      {isAdminOrHigher && (
        loading && !data ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {[0, 1, 2, 3].map((i) => <SkeletonCard key={i} className="h-52" />)}
          </div>
        ) : data?.adminModules ? (
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-zinc-400" />
              <h2 className="text-sm font-semibold uppercase tracking-widest text-zinc-400">Admin</h2>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

              {/* Trips */}
              <div className="rounded-xl border border-zinc-200 bg-white p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-zinc-900">Trip Payments</h3>
                  <ViewAllLink to={quickLinks.trips ?? '/admin/trips'} label="Manage" />
                </div>
                <div className="divide-y divide-zinc-100">
                  <MetricPair label="Active Trips" value={String(data.adminModules.trips.activeTripCount)} />
                  <MetricPair label="Enrollments" value={String(data.adminModules.trips.enrollmentCount)} />
                  <MetricPair label="Collected" value={formatCurrency(data.adminModules.trips.collectedCents)} />
                  <MetricPair label="Remaining" value={formatCurrency(data.adminModules.trips.remainingCents)} />
                </div>
                {data.adminModules.trips.nextDueAt && (
                  <p className="mt-3 text-xs text-zinc-500">
                    Next payment due:{' '}
                    <span className="font-semibold text-zinc-900">
                      {formatDateTime(data.adminModules.trips.nextDueAt)}
                    </span>
                  </p>
                )}
              </div>

              {/* Fundraise */}
              <div className="rounded-xl border border-zinc-200 bg-white p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-zinc-900">Fundraise</h3>
                  <ViewAllLink to={quickLinks.fundraise ?? '/admin/fundraise'} label="Manage" />
                </div>
                <div className="divide-y divide-zinc-100">
                  <MetricPair label="Active Events" value={String(data.adminModules.fundraise.activeEventCount)} />
                  <MetricPair
                    label="Seats Sold"
                    value={`${data.adminModules.fundraise.seatsSold} / ${data.adminModules.fundraise.seatsTotal}`}
                  />
                  <MetricPair
                    label="Donations"
                    value={
                      data.adminModules.fundraise.donationSucceededCents === null
                        ? '—'
                        : formatCurrency(data.adminModules.fundraise.donationSucceededCents)
                    }
                  />
                </div>
              </div>

              {/* Forms */}
              <div className="rounded-xl border border-zinc-200 bg-white p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold text-zinc-900">Forms</h3>
                  <ViewAllLink to={quickLinks.forms ?? '/admin/forms'} label="Manage" />
                </div>
                <div className="divide-y divide-zinc-100">
                  <MetricPair label="Open" value={String(data.adminModules.forms.openCount)} />
                  <MetricPair label="Closed" value={String(data.adminModules.forms.closedCount)} />
                  <MetricPair label="Total Responses" value={String(data.adminModules.forms.responseCount)} />
                  <MetricPair
                    label="Program Bio"
                    value={`${data.adminModules.forms.programBio.responseCount} responses`}
                  />
                  <MetricPair
                    label="Senior Sendoff"
                    value={`${data.adminModules.forms.seniorSendoff.responseCount} responses`}
                  />
                </div>
              </div>

              {/* System Activity */}
              <div className="rounded-xl border border-zinc-200 bg-white p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Activity className="h-4 w-4 text-zinc-400" />
                    <h3 className="font-bold text-zinc-900">System Activity</h3>
                  </div>
                  <ViewAllLink to={quickLinks.audit ?? '/admin/audit'} label="Audit log" />
                </div>

                {data.adminModules.system.recentAudit.length === 0 ? (
                  <EmptyState message="No recent audit entries." />
                ) : (
                  <div className="space-y-2">
                    {data.adminModules.system.recentAudit.map((entry) => (
                      <div key={entry.id} className="rounded-lg bg-zinc-50 px-4 py-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-zinc-900 truncate">{entry.action}</div>
                            <div className="text-xs text-zinc-500 mt-0.5 truncate">
                              {entry.actor} · {entry.entityType}/{entry.entityId}
                            </div>
                          </div>
                          <div className="shrink-0 text-xs text-zinc-400">{formatDateTime(entry.createdAt)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        ) : data && !data.adminModules ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Admin module data is unavailable.
          </div>
        ) : null
      )}
    </div>
  );
}