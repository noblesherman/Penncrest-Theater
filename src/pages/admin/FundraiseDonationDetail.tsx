/*
Handoff note for Mr. Smith:
- File: `src/pages/admin/FundraiseDonationDetail.tsx`
- What this is: Admin route page.
- What it does: Runs one full admin screen with data loading and operator actions.
- Connections: Wired from `src/App.tsx`; depends on admin auth helpers and backend admin routes.
- Main content type: Business logic + admin UI + visible wording.
- Safe edits here: Table labels, section copy, and presentational layout.
- Be careful with: Request/response contracts, auth checks, and state transitions tied to backend behavior.
- Useful context: Operationally sensitive area: UI polish is safe, contract changes need extra care.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, ExternalLink, RefreshCcw } from 'lucide-react';
import { adminFetch } from '../../lib/adminAuth';

type DonationDetail = {
  available: boolean;
  reason?: string;
  dashboardUrl?: string;
  donation?: {
    donorName: string;
    donorEmail: string;
    donorRecognitionPreference: 'known' | 'anonymous';
    donationOptionId: string | null;
    donationOptionName: string | null;
    donationLevelId: string | null;
    donationLevelTitle: string | null;
    donationLevelAmountLabel: string | null;
    donationSelectionType: string | null;
    donationBucketKey: string | null;
    donationBucketLabel: string | null;
    receiptEmail: string | null;
    thankYouEmailSent: boolean;
  };
  paymentIntent?: {
    id: string;
    status: string;
    amount: number;
    amountReceived: number;
    currency: string;
    createdAt: string | null;
    canceledAt: string | null;
    cancellationReason: string | null;
    description: string | null;
    captureMethod: string;
    statementDescriptor: string | null;
    statementDescriptorSuffix: string | null;
    paymentMethodTypes: string[];
    livemode: boolean;
  };
  paymentMethod?: {
    id: string | null;
    type: string | null;
    brand: string | null;
    displayBrand: string | null;
    funding: string | null;
    last4: string | null;
    fingerprint: string | null;
    expMonth: number | null;
    expYear: number | null;
    issuer: string | null;
    country: string | null;
    network: string | null;
    walletType: string | null;
    checks: {
      cvcCheck: string | null;
      addressLine1Check: string | null;
      addressPostalCodeCheck: string | null;
    };
  };
  charge?: {
    id: string;
    status: string;
    paid: boolean;
    captured: boolean;
    amount: number;
    amountCaptured: number;
    amountRefunded: number;
    createdAt: string | null;
    receiptEmail: string | null;
    receiptUrl: string | null;
    failureCode: string | null;
    failureMessage: string | null;
    statementDescriptor: string | null;
    statementDescriptorSuffix: string | null;
    outcome: {
      riskLevel: string | null;
      riskScore: number | null;
      networkStatus: string | null;
      sellerMessage: string | null;
      type: string;
    } | null;
    billingDetails: {
      name: string | null;
      email: string | null;
      phone: string | null;
      postalCode: string | null;
      country: string | null;
    };
  } | null;
  balance?: {
    id: string;
    amount: number;
    fee: number;
    net: number;
    type: string;
    reportingCategory: string;
    availableOn: string | null;
    exchangeRate: number | null;
    feeDetails: Array<{
      amount: number;
      currency: string;
      description: string | null;
      type: string;
    }>;
  } | null;
  customer?: {
    id: string | null;
    name: string | null;
    email: string | null;
    phone: string | null;
    country: string | null;
  };
  refunds?: Array<{
    id: string;
    status: string | null;
    amount: number;
    reason: string | null;
    createdAt: string | null;
  }>;
  activity?: Array<{
    key: string;
    label: string;
    status: 'success' | 'warning' | 'info';
    occurredAt: string;
  }>;
  metadata?: Record<string, string>;
};

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-stone-200 bg-white p-5 ${className}`}>
      {children}
    </section>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.12em] text-stone-500">{children}</p>;
}

function formatCurrency(cents: number | null | undefined, currency = 'usd'): string {
  if (typeof cents !== 'number' || Number.isNaN(cents)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase()
  }).format(cents / 100);
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString();
}

function formatLabel(value: string | null | undefined): string {
  if (!value) return '—';
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

export default function AdminFundraiseDonationDetailPage() {
  const { paymentIntentId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<DonationDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!paymentIntentId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await adminFetch<DonationDetail>(`/api/admin/fundraising/donations/${encodeURIComponent(paymentIntentId)}`);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to load donation details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [paymentIntentId]);

  if (!paymentIntentId) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Missing donation id.
        </div>
        <Link to="/admin/fundraise" className="inline-flex items-center gap-2 text-sm font-semibold text-stone-700 hover:text-stone-900">
          <ArrowLeft className="h-4 w-4" />
          Back to Fundraise
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => navigate('/admin/fundraise')}
            className="inline-flex items-center gap-2 text-sm font-semibold text-stone-500 transition hover:text-stone-900"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Fundraise
          </button>
          <h1 className="text-2xl font-bold text-stone-900">Donation Details</h1>
          <p className="text-sm text-stone-600">{paymentIntentId}</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 transition hover:bg-stone-50 disabled:opacity-60"
          >
            <RefreshCcw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          {data?.dashboardUrl ? (
            <a
              href={data.dashboardUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-xl bg-red-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-red-800"
            >
              Open in Stripe
              <ExternalLink className="h-4 w-4" />
            </a>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-2xl border border-stone-200 bg-white px-4 py-10 text-center text-sm text-stone-500">
          Loading donation details...
        </div>
      ) : data && data.available === false ? (
        <div className="rounded-2xl border border-stone-200 bg-white px-4 py-10 text-center text-sm text-stone-500">
          {data.reason || 'Donation details are unavailable.'}
        </div>
      ) : data ? (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <Card className="p-4">
              <SectionLabel>Amount</SectionLabel>
              <p className="text-xl font-bold text-stone-900">
                {formatCurrency(data.paymentIntent?.amount ?? null, data.paymentIntent?.currency || 'usd')}
              </p>
            </Card>
            <Card className="p-4">
              <SectionLabel>Status</SectionLabel>
              <p className="text-xl font-bold text-stone-900">{formatLabel(data.paymentIntent?.status || null)}</p>
            </Card>
            <Card className="p-4">
              <SectionLabel>Donor</SectionLabel>
              <p className="text-base font-semibold text-stone-900">{data.donation?.donorName || 'Supporter'}</p>
              <p className="text-xs text-stone-500">{data.donation?.donorEmail || 'No email'}</p>
            </Card>
            <Card className="p-4">
              <SectionLabel>Created</SectionLabel>
              <p className="text-sm font-semibold text-stone-900">{formatDateTime(data.paymentIntent?.createdAt || null)}</p>
            </Card>
          </div>

          <Card>
            <SectionLabel>Donation Metadata</SectionLabel>
            <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <p><span className="text-stone-500">Recognition:</span> <span className="font-semibold text-stone-900">{formatLabel(data.donation?.donorRecognitionPreference || null)}</span></p>
              <p><span className="text-stone-500">Receipt Email:</span> <span className="font-semibold text-stone-900">{data.donation?.receiptEmail || '—'}</span></p>
              <p><span className="text-stone-500">Option:</span> <span className="font-semibold text-stone-900">{data.donation?.donationOptionName || '—'}</span></p>
              <p><span className="text-stone-500">Level:</span> <span className="font-semibold text-stone-900">{data.donation?.donationLevelTitle || '—'}</span></p>
              <p><span className="text-stone-500">Amount Label:</span> <span className="font-semibold text-stone-900">{data.donation?.donationLevelAmountLabel || '—'}</span></p>
              <p><span className="text-stone-500">Bucket:</span> <span className="font-semibold text-stone-900">{data.donation?.donationBucketLabel || '—'}</span></p>
              <p><span className="text-stone-500">Selection Type:</span> <span className="font-semibold text-stone-900">{formatLabel(data.donation?.donationSelectionType || null)}</span></p>
              <p><span className="text-stone-500">Thank-you Email:</span> <span className="font-semibold text-stone-900">{data.donation?.thankYouEmailSent ? 'Sent' : 'Pending'}</span></p>
            </div>
          </Card>

          <Card>
            <SectionLabel>Payment Intent</SectionLabel>
            <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <p><span className="text-stone-500">Payment Intent:</span> <span className="font-semibold text-stone-900">{data.paymentIntent?.id || '—'}</span></p>
              <p><span className="text-stone-500">Amount Received:</span> <span className="font-semibold text-stone-900">{formatCurrency(data.paymentIntent?.amountReceived ?? null, data.paymentIntent?.currency || 'usd')}</span></p>
              <p><span className="text-stone-500">Capture Method:</span> <span className="font-semibold text-stone-900">{formatLabel(data.paymentIntent?.captureMethod || null)}</span></p>
              <p><span className="text-stone-500">Payment Method Types:</span> <span className="font-semibold text-stone-900">{data.paymentIntent?.paymentMethodTypes?.join(', ') || '—'}</span></p>
              <p><span className="text-stone-500">Description:</span> <span className="font-semibold text-stone-900">{data.paymentIntent?.description || '—'}</span></p>
              <p><span className="text-stone-500">Canceled At:</span> <span className="font-semibold text-stone-900">{formatDateTime(data.paymentIntent?.canceledAt || null)}</span></p>
            </div>
          </Card>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Card>
              <SectionLabel>Charge</SectionLabel>
              <div className="space-y-2 text-sm">
                <p><span className="text-stone-500">Charge ID:</span> <span className="font-semibold text-stone-900">{data.charge?.id || '—'}</span></p>
                <p><span className="text-stone-500">Status:</span> <span className="font-semibold text-stone-900">{formatLabel(data.charge?.status || null)}</span></p>
                <p><span className="text-stone-500">Captured:</span> <span className="font-semibold text-stone-900">{data.charge?.captured ? 'Yes' : 'No'}</span></p>
                <p><span className="text-stone-500">Receipt URL:</span> {data.charge?.receiptUrl ? <a className="font-semibold text-red-700 hover:text-red-800" href={data.charge.receiptUrl} target="_blank" rel="noreferrer">Open Receipt</a> : <span className="font-semibold text-stone-900">—</span>}</p>
                <p><span className="text-stone-500">Failure:</span> <span className="font-semibold text-stone-900">{data.charge?.failureMessage || '—'}</span></p>
              </div>
            </Card>

            <Card>
              <SectionLabel>Payment Method</SectionLabel>
              <div className="space-y-2 text-sm">
                <p><span className="text-stone-500">Method ID:</span> <span className="font-semibold text-stone-900">{data.paymentMethod?.id || '—'}</span></p>
                <p><span className="text-stone-500">Type:</span> <span className="font-semibold text-stone-900">{formatLabel(data.paymentMethod?.type || null)}</span></p>
                <p><span className="text-stone-500">Brand:</span> <span className="font-semibold text-stone-900">{formatLabel(data.paymentMethod?.brand || null)}</span></p>
                <p><span className="text-stone-500">Last 4:</span> <span className="font-semibold text-stone-900">{data.paymentMethod?.last4 || '—'}</span></p>
                <p><span className="text-stone-500">Expires:</span> <span className="font-semibold text-stone-900">{data.paymentMethod?.expMonth && data.paymentMethod?.expYear ? `${data.paymentMethod.expMonth}/${data.paymentMethod.expYear}` : '—'}</span></p>
                <p><span className="text-stone-500">Network:</span> <span className="font-semibold text-stone-900">{data.paymentMethod?.network || '—'}</span></p>
              </div>
            </Card>
          </div>

          <Card>
            <SectionLabel>Customer</SectionLabel>
            <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <p><span className="text-stone-500">Customer ID:</span> <span className="font-semibold text-stone-900">{data.customer?.id || '—'}</span></p>
              <p><span className="text-stone-500">Name:</span> <span className="font-semibold text-stone-900">{data.customer?.name || '—'}</span></p>
              <p><span className="text-stone-500">Email:</span> <span className="font-semibold text-stone-900">{data.customer?.email || '—'}</span></p>
              <p><span className="text-stone-500">Phone:</span> <span className="font-semibold text-stone-900">{data.customer?.phone || '—'}</span></p>
            </div>
          </Card>

          <Card>
            <SectionLabel>Refunds</SectionLabel>
            {!data.refunds || data.refunds.length === 0 ? (
              <p className="text-sm text-stone-500">No refunds recorded.</p>
            ) : (
              <div className="space-y-2">
                {data.refunds.map((refund) => (
                  <div key={refund.id} className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm">
                    <p className="font-semibold text-stone-900">{refund.id}</p>
                    <p className="text-stone-600">
                      {formatCurrency(refund.amount, data.paymentIntent?.currency || 'usd')} · {formatLabel(refund.status || null)} · {formatDateTime(refund.createdAt)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <SectionLabel>Activity</SectionLabel>
            {!data.activity || data.activity.length === 0 ? (
              <p className="text-sm text-stone-500">No activity available.</p>
            ) : (
              <div className="space-y-2">
                {data.activity.map((entry) => (
                  <div key={entry.key} className="flex items-center justify-between gap-2 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm">
                    <p className="font-semibold text-stone-900">{entry.label}</p>
                    <p className="text-xs text-stone-500">{formatDateTime(entry.occurredAt)}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}
