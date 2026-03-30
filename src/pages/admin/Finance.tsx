import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { adminFetch, getAdminToken } from '../../lib/adminAuth';
import { apiUrl } from '../../lib/api';

type PerformanceItem = {
  id: string;
  title: string;
  startsAt: string;
  show?: { title: string };
};

type FinanceBreakdownRow = {
  key: string;
  label: string;
  orderCount: number;
  ticketCount: number;
  grossCents: number;
  refundCents: number;
  netCents: number;
};

type FinanceSummary = {
  stripeReportsUrl: string;
  generatedAtIso: string;
  startDate: string;
  endDate: string;
  includeCompOrders: boolean;
  performanceId: string | null;
  performanceLabel: string;
  totals: {
    orderCount: number;
    ticketCount: number;
    grossCents: number;
    refundCents: number;
    netCents: number;
    cashNetCents: number;
    cardNetCents: number;
  };
  paymentBreakdown: FinanceBreakdownRow[];
  sourceBreakdown: FinanceBreakdownRow[];
};

type SendFinanceInvoiceResponse = {
  invoiceId: string;
  invoiceNumber: string | null;
  customerId: string;
  customerEmail: string;
  amountDueCents: number;
  status: string | null;
  hostedInvoiceUrl: string | null;
};

type InvoiceComposerLineItemDraft = {
  id: string;
  description: string;
  details: string;
  quantity: string;
  unitAmountDollars: string;
};

type InvoiceComposerDraft = {
  customerName: string;
  customerEmail: string;
  description: string;
  customerNote: string;
  dueInDays: string;
  lineItems: InvoiceComposerLineItemDraft[];
};

let invoiceComposerLineItemSequence = 0;

function createInvoiceLineItemDraft(): InvoiceComposerLineItemDraft {
  invoiceComposerLineItemSequence += 1;
  return {
    id: `invoice-item-${invoiceComposerLineItemSequence}`,
    description: '',
    details: '',
    quantity: '1',
    unitAmountDollars: ''
  };
}

function createInvoiceComposerDraft(): InvoiceComposerDraft {
  return {
    customerName: '',
    customerEmail: '',
    description: '',
    customerNote: '',
    dueInDays: '30',
    lineItems: [createInvoiceLineItemDraft()]
  };
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function toDateInputValue(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function defaultMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
}

function monthToRange(month: string): { startDate: string; endDate: string } {
  const [yearText, monthText] = month.split('-');
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || monthIndex < 0 || monthIndex > 11) {
    const now = new Date();
    return monthToRange(`${now.getFullYear()}-${pad2(now.getMonth() + 1)}`);
  }
  const first = new Date(year, monthIndex, 1);
  const last = new Date(year, monthIndex + 1, 0);
  return {
    startDate: toDateInputValue(first),
    endDate: toDateInputValue(last)
  };
}

function cents(value: number): string {
  return `$${(value / 100).toFixed(2)}`;
}

function buildQuery(params: {
  startDate: string;
  endDate: string;
  performanceId: string;
  includeCompOrders: boolean;
}): URLSearchParams {
  const query = new URLSearchParams();
  query.set('startDate', params.startDate);
  query.set('endDate', params.endDate);
  query.set('includeCompOrders', params.includeCompOrders ? '1' : '0');
  if (params.performanceId) {
    query.set('performanceId', params.performanceId);
  }
  return query;
}

// ─── small presentational helpers ────────────────────────────────────────────

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: '#9ca3af',
        marginBottom: 14,
        fontFamily: "var(--font-sans)",
      }}
    >
      {children}
    </p>
  );
}

function StatCard({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        background: accent ? '#111827' : '#f9fafb',
        borderRadius: 16,
        padding: '18px 20px',
        border: accent ? 'none' : '1px solid #f3f4f6',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: accent ? '#6b7280' : '#9ca3af',
          fontFamily: "var(--font-sans)",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 26,
          fontWeight: 800,
          color: accent ? '#ffffff' : '#111827',
          fontFamily: "var(--font-sans)",
          letterSpacing: '-0.5px',
          lineHeight: 1,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function BreakdownRow({ row }: { row: FinanceBreakdownRow }) {
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #f3f4f6',
        borderRadius: 12,
        padding: '12px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        transition: 'box-shadow 0.15s',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.boxShadow = '0 2px 12px rgba(0,0,0,0.07)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: '#1f2937',
            fontFamily: "var(--font-sans)",
          }}
        >
          {row.label}
        </span>
        <span
          style={{
            fontSize: 15,
            fontWeight: 800,
            color: '#111827',
            fontFamily: "var(--font-sans)",
          }}
        >
          {cents(row.netCents)}
        </span>
      </div>
      <div
        style={{
          display: 'flex',
          gap: 12,
          fontSize: 11,
          color: '#9ca3af',
          fontFamily: "var(--font-sans)",
        }}
      >
        <span>{row.orderCount} orders</span>
        <span>·</span>
        <span>{row.ticketCount} tickets</span>
        <span>·</span>
        <span>Gross {cents(row.grossCents)}</span>
        <span>·</span>
        <span style={{ color: '#ef4444' }}>Refunds {cents(row.refundCents)}</span>
      </div>
    </div>
  );
}

// ─── main page ────────────────────────────────────────────────────────────────

export default function AdminFinancePage() {
  const [performances, setPerformances] = useState<PerformanceItem[]>([]);
  const [loadingPerformances, setLoadingPerformances] = useState(false);
  const [rangeMode, setRangeMode] = useState<'month' | 'custom'>('month');
  const [monthValue, setMonthValue] = useState(defaultMonthValue);
  const initialRange = useMemo(() => monthToRange(defaultMonthValue()), []);
  const [startDate, setStartDate] = useState(initialRange.startDate);
  const [endDate, setEndDate] = useState(initialRange.endDate);
  const [performanceId, setPerformanceId] = useState('');
  const [includeCompOrders, setIncludeCompOrders] = useState(true);

  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [downloadingStripeCsv, setDownloadingStripeCsv] = useState(false);
  const [downloadingLocalCsv, setDownloadingLocalCsv] = useState(false);
  const [stripeCsvStatus, setStripeCsvStatus] = useState<string | null>(null);
  const [sendingInvoice, setSendingInvoice] = useState(false);
  const [showInvoiceComposer, setShowInvoiceComposer] = useState(false);
  const [lastInvoiceUrl, setLastInvoiceUrl] = useState<string | null>(null);
  const [invoiceDraft, setInvoiceDraft] = useState<InvoiceComposerDraft>(createInvoiceComposerDraft);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const next = monthToRange(monthValue);
    if (rangeMode === 'month') {
      setStartDate(next.startDate);
      setEndDate(next.endDate);
    }
  }, [monthValue, rangeMode]);

  useEffect(() => {
    const load = async () => {
      setLoadingPerformances(true);
      try {
        const rows = await adminFetch<PerformanceItem[]>('/api/admin/performances?scope=all');
        setPerformances(rows);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load performances');
      } finally {
        setLoadingPerformances(false);
      }
    };
    void load();
  }, []);

  const refreshSummary = async () => {
    setLoadingSummary(true);
    setError(null);
    setNotice(null);
    try {
      const query = buildQuery({ startDate, endDate, performanceId, includeCompOrders });
      const result = await adminFetch<FinanceSummary>(`/api/admin/finance/summary?${query.toString()}`);
      setSummary(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load finance summary');
    } finally {
      setLoadingSummary(false);
    }
  };

  useEffect(() => {
    void refreshSummary();
  }, [startDate, endDate, performanceId, includeCompOrders]);

  const openStripeReports = () => {
    const url = summary?.stripeReportsUrl || 'https://dashboard.stripe.com/reports';
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const downloadStripeCsv = async () => {
    setDownloadingStripeCsv(true);
    setStripeCsvStatus('Preparing Stripe CSV...');
    setError(null);
    setNotice(null);
    try {
      const token = getAdminToken();
      const query = new URLSearchParams({ startDate, endDate });
      const response = await fetch(apiUrl(`/api/admin/finance/stripe-report.csv?${query.toString()}`), {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (!response.ok) {
        let message = `Stripe CSV export failed (${response.status})`;
        try {
          const body = await response.json();
          if (body?.error && typeof body.error === 'string') message = body.error;
        } catch {}
        throw new Error(message);
      }

      const blob = await response.blob();
      const contentDisposition = response.headers.get('content-disposition') || '';
      const filenameMatch = contentDisposition.match(/filename="([^"]+)"/i);
      const filename = filenameMatch?.[1] || `stripe-report-${startDate}-to-${endDate}.csv`;
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setStripeCsvStatus(`Stripe CSV downloaded: ${filename}`);
      setNotice(`Downloaded ${filename}`);
    } catch (err) {
      setStripeCsvStatus('Stripe CSV failed. Check error above.');
      setError(err instanceof Error ? err.message : 'Failed to download Stripe CSV');
    } finally {
      setDownloadingStripeCsv(false);
    }
  };

  const downloadLocalCsv = async () => {
    setDownloadingLocalCsv(true);
    setError(null);
    setNotice(null);
    try {
      const token = getAdminToken();
      const query = buildQuery({ startDate, endDate, performanceId, includeCompOrders });
      const response = await fetch(apiUrl(`/api/admin/finance/local-report.csv?${query.toString()}`), {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (!response.ok) {
        let message = `Local CSV export failed (${response.status})`;
        try {
          const body = await response.json();
          if (body?.error && typeof body.error === 'string') message = body.error;
        } catch {}
        throw new Error(message);
      }

      const blob = await response.blob();
      const contentDisposition = response.headers.get('content-disposition') || '';
      const filenameMatch = contentDisposition.match(/filename="([^"]+)"/i);
      const filename = filenameMatch?.[1] || `local-finance-${startDate}-to-${endDate}.csv`;
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setNotice(`Downloaded ${filename}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download local CSV');
    } finally {
      setDownloadingLocalCsv(false);
    }
  };

  const downloadPdf = async () => {
    setDownloadingPdf(true);
    setError(null);
    setNotice(null);
    try {
      const token = getAdminToken();
      const query = buildQuery({ startDate, endDate, performanceId, includeCompOrders });
      const response = await fetch(apiUrl(`/api/admin/finance/report.pdf?${query.toString()}`), {
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      });
      if (!response.ok) {
        let message = `PDF export failed (${response.status})`;
        try {
          const body = await response.json();
          if (body?.error && typeof body.error === 'string') message = body.error;
        } catch {}
        throw new Error(message);
      }
      const blob = await response.blob();
      const contentDisposition = response.headers.get('content-disposition') || '';
      const filenameMatch = contentDisposition.match(/filename="([^"]+)"/i);
      const filename = filenameMatch?.[1] || `finance-report-${startDate}-to-${endDate}.pdf`;
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setNotice(`Downloaded ${filename}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download PDF');
    } finally {
      setDownloadingPdf(false);
    }
  };

  const sendInvoice = async () => {
    const customerName = invoiceDraft.customerName.trim();
    const customerEmail = invoiceDraft.customerEmail.trim().toLowerCase();
    const description = invoiceDraft.description.trim();
    const dueInDays = Number(invoiceDraft.dueInDays);

    if (!customerName) {
      setError('Customer name is required');
      setNotice(null);
      return;
    }

    if (!customerEmail || !customerEmail.includes('@')) {
      setError('A valid customer email is required');
      setNotice(null);
      return;
    }

    if (!description) {
      setError('Invoice description is required');
      setNotice(null);
      return;
    }

    if (!Number.isInteger(dueInDays) || dueInDays < 1 || dueInDays > 90) {
      setError('Due in days must be between 1 and 90');
      setNotice(null);
      return;
    }

    const lineItems: Array<{ description: string; quantity: number; unitAmountCents: number }> = [];

    for (const row of invoiceDraft.lineItems) {
      const itemDescription = row.description.trim();
      const itemDetails = row.details.trim();
      const quantityRaw = row.quantity.trim();
      const unitAmountRaw = row.unitAmountDollars.trim();

      const hasAnyValue = Boolean(itemDescription || itemDetails || quantityRaw || unitAmountRaw);
      if (!hasAnyValue) {
        continue;
      }

      if (!itemDescription) {
        setError('Each invoice item needs a description');
        setNotice(null);
        return;
      }

      const quantity = Number(quantityRaw || '1');
      if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 1000) {
        setError('Item quantity must be a whole number between 1 and 1000');
        setNotice(null);
        return;
      }

      const unitAmountDollars = Number(unitAmountRaw);
      if (!Number.isFinite(unitAmountDollars) || unitAmountDollars <= 0) {
        setError(`Item "${itemDescription}" needs a valid unit price`);
        setNotice(null);
        return;
      }

      const unitAmountCents = Math.round(unitAmountDollars * 100);
      if (unitAmountCents <= 0) {
        setError(`Item "${itemDescription}" unit price must be greater than 0`);
        setNotice(null);
        return;
      }

      lineItems.push({
        description: itemDetails ? `${itemDescription} — ${itemDetails}` : itemDescription,
        quantity,
        unitAmountCents
      });
    }

    if (lineItems.length === 0) {
      setError('Add at least one invoice item');
      setNotice(null);
      return;
    }

    const totalAmountCents = lineItems.reduce((sum, item) => sum + item.quantity * item.unitAmountCents, 0);
    if (totalAmountCents < 50) {
      setError('Invoice total must be at least $0.50');
      setNotice(null);
      return;
    }

    setSendingInvoice(true);
    setError(null);
    setNotice(null);
    setLastInvoiceUrl(null);
    try {
      const result = await adminFetch<SendFinanceInvoiceResponse>('/api/admin/finance/invoices/send', {
        method: 'POST',
        body: JSON.stringify({
          customerName,
          customerEmail,
          description,
          customerNote: invoiceDraft.customerNote.trim() || undefined,
          dueInDays,
          lineItems
        })
      });

      setLastInvoiceUrl(result.hostedInvoiceUrl || null);
      setNotice(
        `Invoice sent to ${result.customerEmail} for ${cents(result.amountDueCents)} (${lineItems.length} item${lineItems.length === 1 ? '' : 's'}).`
      );
      setInvoiceDraft(createInvoiceComposerDraft());
      setShowInvoiceComposer(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send invoice');
    } finally {
      setSendingInvoice(false);
    }
  };

  const openInvoiceComposer = () => {
    setError(null);
    setNotice(null);
    setShowInvoiceComposer(true);
  };

  const closeInvoiceComposer = () => {
    if (sendingInvoice) return;
    setShowInvoiceComposer(false);
  };

  const updateInvoiceField = <K extends keyof InvoiceComposerDraft>(field: K, value: InvoiceComposerDraft[K]) => {
    setInvoiceDraft((current) => ({
      ...current,
      [field]: value
    }));
  };

  const updateInvoiceLineItem = (id: string, next: Partial<InvoiceComposerLineItemDraft>) => {
    setInvoiceDraft((current) => ({
      ...current,
      lineItems: current.lineItems.map((item) => (item.id === id ? { ...item, ...next } : item))
    }));
  };

  const addInvoiceLineItem = () => {
    setInvoiceDraft((current) => ({
      ...current,
      lineItems: [...current.lineItems, createInvoiceLineItemDraft()]
    }));
  };

  const removeInvoiceLineItem = (id: string) => {
    setInvoiceDraft((current) => {
      const nextItems = current.lineItems.filter((item) => item.id !== id);
      return {
        ...current,
        lineItems: nextItems.length > 0 ? nextItems : [createInvoiceLineItemDraft()]
      };
    });
  };

  const invoicePreviewTotalCents = useMemo(() => {
    return invoiceDraft.lineItems.reduce((sum, row) => {
      const quantity = Number(row.quantity.trim() || '1');
      const unitAmountDollars = Number(row.unitAmountDollars.trim());
      if (!Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity <= 0) return sum;
      if (!Number.isFinite(unitAmountDollars) || unitAmountDollars <= 0) return sum;
      return sum + quantity * Math.round(unitAmountDollars * 100);
    }, 0);
  }, [invoiceDraft.lineItems]);

  // ─── styles ────────────────────────────────────────────────────────────────

  const inputStyle: CSSProperties = {
    width: '100%',
    borderRadius: 10,
    border: '1.5px solid #e5e7eb',
    padding: '10px 14px',
    fontSize: 14,
    color: '#111827',
    background: '#fff',
    fontFamily: "var(--font-sans)",
    outline: 'none',
    boxSizing: 'border-box',
    transition: 'border-color 0.15s',
  };

  const labelStyle: CSSProperties = {
    display: 'block',
    marginBottom: 6,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: '#9ca3af',
    fontFamily: "var(--font-sans)",
  };

  const cardStyle: CSSProperties = {
    background: '#ffffff',
    borderRadius: 20,
    border: '1px solid #f0f0f0',
    padding: 24,
    boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
  };

  return (
    <>
      <style>{`
        .finance-input:focus {
          border-color: #e11d48 !important;
          box-shadow: 0 0 0 3px rgba(225,29,72,0.08);
        }
        .finance-select:focus {
          border-color: #e11d48 !important;
          box-shadow: 0 0 0 3px rgba(225,29,72,0.08);
          outline: none;
        }
        .btn-pill {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 999px;
          font-weight: 700;
          font-size: 13px;
          padding: 10px 22px;
          cursor: pointer;
          transition: all 0.15s;
          font-family: var(--font-sans);
          letter-spacing: 0.01em;
          border: none;
        }
        .btn-pill:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .btn-stripe {
          background: #635bff;
          color: #fff;
        }
        .btn-stripe:not(:disabled):hover {
          background: #4f46e5;
          transform: translateY(-1px);
          box-shadow: 0 4px 16px rgba(99,91,255,0.3);
        }
        .btn-pdf {
          background: #e11d48;
          color: #fff;
        }
        .btn-pdf:not(:disabled):hover {
          background: #be123c;
          transform: translateY(-1px);
          box-shadow: 0 4px 16px rgba(225,29,72,0.3);
        }
        .btn-invoice {
          background: #0f766e;
          color: #fff;
        }
        .btn-invoice:not(:disabled):hover {
          background: #0d5f58;
          transform: translateY(-1px);
          box-shadow: 0 4px 16px rgba(15,118,110,0.28);
        }
        .btn-ghost {
          background: transparent;
          color: #374151;
          border: 1.5px solid #e5e7eb;
        }
        .btn-ghost:not(:disabled):hover {
          background: #f9fafb;
          border-color: #d1d5db;
        }
        .tab-btn {
          flex: 1;
          border-radius: 8px;
          padding: 8px 16px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          border: none;
          transition: all 0.15s;
          font-family: var(--font-sans);
        }
        .tab-active {
          background: #111827;
          color: #fff;
        }
        .tab-inactive {
          background: transparent;
          color: #6b7280;
        }
        .tab-inactive:hover {
          background: #f3f4f6;
          color: #374151;
        }
      `}</style>

      <div
        style={{
          maxWidth: 900,
          margin: '0 auto',
          padding: '32px 24px',
          fontFamily: "var(--font-sans)",
          display: 'flex',
          flexDirection: 'column',
          gap: 24,
        }}
      >
        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h1
              style={{
                fontFamily: "var(--font-sans)",
                fontSize: 34,
                fontWeight: 800,
                color: '#0f172a',
                margin: 0,
                letterSpacing: '-0.5px',
                lineHeight: 1.1,
              }}
            >
              Finance
            </h1>
            <p style={{ marginTop: 6, fontSize: 13, color: '#9ca3af', margin: '6px 0 0' }}>
              Stripe reporting shortcut &amp; branded finance PDF — cash, card, and refunds in one place.
            </p>
          </div>

          {summary && (
            <div
              style={{
                background: '#f9fafb',
                border: '1px solid #f3f4f6',
                borderRadius: 12,
                padding: '8px 14px',
                fontSize: 11,
                color: '#6b7280',
                whiteSpace: 'nowrap',
                fontFamily: "var(--font-sans)",
              }}
            >
              Updated {new Date(summary.generatedAtIso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          )}
        </div>

        {/* ── Toasts ── */}
        {error && (
          <div
            style={{
              borderRadius: 12,
              border: '1px solid #fecaca',
              background: '#fff5f5',
              padding: '12px 16px',
              fontSize: 13,
              color: '#dc2626',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontFamily: "var(--font-sans)",
            }}
          >
            <span style={{ fontSize: 15 }}>⚠</span>
            {error}
          </div>
        )}
        {notice && (
          <div
            style={{
              borderRadius: 12,
              border: '1px solid #bbf7d0',
              background: '#f0fdf4',
              padding: '12px 16px',
              fontSize: 13,
              color: '#16a34a',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontFamily: "var(--font-sans)",
            }}
          >
            <span style={{ fontSize: 15 }}>✓</span>
            {notice}
          </div>
        )}

        {/* ── Filters card ── */}
        <div style={cardStyle}>
          <SectionLabel>Filters</SectionLabel>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: 20,
            }}
          >
            {/* Date range column */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Tab toggle */}
              <div
                style={{
                  display: 'flex',
                  background: '#f9fafb',
                  borderRadius: 10,
                  padding: 4,
                  border: '1px solid #f3f4f6',
                }}
              >
                <button
                  type="button"
                  onClick={() => setRangeMode('month')}
                  className={`tab-btn ${rangeMode === 'month' ? 'tab-active' : 'tab-inactive'}`}
                >
                  Month
                </button>
                <button
                  type="button"
                  onClick={() => setRangeMode('custom')}
                  className={`tab-btn ${rangeMode === 'custom' ? 'tab-active' : 'tab-inactive'}`}
                >
                  Custom Range
                </button>
              </div>

              {rangeMode === 'month' ? (
                <div>
                  <label style={labelStyle}>Month</label>
                  <input
                    type="month"
                    value={monthValue}
                    onChange={(e) => setMonthValue(e.target.value)}
                    className="finance-input"
                    style={inputStyle}
                  />
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label style={labelStyle}>Start Date</label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="finance-input"
                      style={inputStyle}
                    />
                  </div>
                  <div>
                    <label style={labelStyle}>End Date</label>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="finance-input"
                      style={inputStyle}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Performance + controls column */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <label style={labelStyle}>Performance</label>
                <select
                  value={performanceId}
                  onChange={(e) => setPerformanceId(e.target.value)}
                  className="finance-select"
                  style={{ ...inputStyle, appearance: 'none', backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='%239ca3af' d='M1 1l5 5 5-5'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 14px center', paddingRight: 36 }}
                >
                  <option value="">All performances</option>
                  {performances.map((row) => (
                    <option key={row.id} value={row.id}>
                      {(row.title || row.show?.title || 'Performance')} — {new Date(row.startsAt).toLocaleDateString()}
                    </option>
                  ))}
                </select>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  background: '#f9fafb',
                  border: '1px solid #f3f4f6',
                  borderRadius: 10,
                  padding: '10px 14px',
                }}
              >
                <label
                  style={{
                    fontSize: 13,
                    color: '#374151',
                    fontWeight: 500,
                    cursor: 'pointer',
                    fontFamily: "var(--font-sans)",
                    userSelect: 'none',
                  }}
                  htmlFor="compOrders"
                >
                  Include comp / no-charge orders
                </label>
                <input
                  id="compOrders"
                  type="checkbox"
                  checked={includeCompOrders}
                  onChange={(e) => setIncludeCompOrders(e.target.checked)}
                  style={{
                    width: 16,
                    height: 16,
                    accentColor: '#e11d48',
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                />
              </div>

              <button
                type="button"
                onClick={() => void refreshSummary()}
                disabled={loadingSummary || loadingPerformances}
                className="btn-pill btn-ghost"
                style={{ alignSelf: 'flex-start' }}
              >
                {loadingSummary ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span
                      style={{
                        width: 12,
                        height: 12,
                        border: '2px solid #9ca3af',
                        borderTopColor: 'transparent',
                        borderRadius: '50%',
                        display: 'inline-block',
                        animation: 'spin 0.7s linear infinite',
                      }}
                    />
                    Refreshing…
                  </span>
                ) : (
                  '↻  Refresh Summary'
                )}
              </button>
            </div>
          </div>
        </div>

        {/* ── Action cards ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
          {/* Stripe */}
          <div
            style={{
              ...cardStyle,
              display: 'flex',
              flexDirection: 'column',
              gap: 0,
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: -30,
                right: -30,
                width: 100,
                height: 100,
                borderRadius: '50%',
                background: 'rgba(99,91,255,0.05)',
              }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  background: '#635bff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontSize: 15,
                  flexShrink: 0,
                }}
              >
                ↗
              </div>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: '#6b7280',
                  fontFamily: "var(--font-sans)",
                }}
              >
                Stripe
              </span>
            </div>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16, lineHeight: 1.5, fontFamily: "var(--font-sans)" }}>
              Download Stripe's own CSV directly from this tab (online + at-door card activity), no Stripe login needed.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button
                type="button"
                onClick={() => void downloadStripeCsv()}
                disabled={downloadingStripeCsv}
                className="btn-pill btn-stripe"
                style={{ alignSelf: 'flex-start' }}
              >
                {downloadingStripeCsv ? 'Preparing…' : '↓  Download Stripe CSV'}
              </button>
              <button
                type="button"
                onClick={openStripeReports}
                className="btn-pill btn-ghost"
                style={{ alignSelf: 'flex-start' }}
              >
                Open Stripe Reports
              </button>
            </div>
            {stripeCsvStatus && (
              <p style={{ fontSize: 11, color: '#64748b', marginTop: 8, marginBottom: 0, lineHeight: 1.4, fontFamily: "var(--font-sans)" }}>
                {stripeCsvStatus}
              </p>
            )}
            <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 10, marginBottom: 0, lineHeight: 1.45, fontFamily: "var(--font-sans)" }}>
              Stripe export excludes cash and comp-only orders by design.
            </p>
          </div>

          {/* Branded PDF */}
          <div
            style={{
              ...cardStyle,
              display: 'flex',
              flexDirection: 'column',
              gap: 0,
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: -30,
                right: -30,
                width: 100,
                height: 100,
                borderRadius: '50%',
                background: 'rgba(225,29,72,0.05)',
              }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  background: '#e11d48',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontSize: 15,
                  flexShrink: 0,
                }}
              >
                ↓
              </div>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: '#6b7280',
                  fontFamily: "var(--font-sans)",
                }}
              >
                Branded Report
              </span>
            </div>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16, lineHeight: 1.5, fontFamily: "var(--font-sans)" }}>
              Download your Penncrest finance PDF or local CSV (with card vs cash split, refunds, and totals) for the selected range.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button
                type="button"
                onClick={() => void downloadPdf()}
                disabled={downloadingPdf}
                className="btn-pill btn-pdf"
                style={{ alignSelf: 'flex-start' }}
              >
                {downloadingPdf ? 'Generating…' : '↓  Download PDF'}
              </button>
              <button
                type="button"
                onClick={() => void downloadLocalCsv()}
                disabled={downloadingLocalCsv}
                className="btn-pill btn-ghost"
                style={{ alignSelf: 'flex-start' }}
              >
                {downloadingLocalCsv ? 'Preparing…' : '↓  Download Local CSV'}
              </button>
            </div>
          </div>

          {/* Invoices */}
          <div
            style={{
              ...cardStyle,
              display: 'flex',
              flexDirection: 'column',
              gap: 0,
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: -30,
                right: -30,
                width: 100,
                height: 100,
                borderRadius: '50%',
                background: 'rgba(15,118,110,0.07)',
              }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  background: '#0f766e',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontSize: 15,
                  flexShrink: 0,
                }}
              >
                $
              </div>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: '#6b7280',
                  fontFamily: "var(--font-sans)",
                }}
              >
                Invoices
              </span>
            </div>
            <p style={{ fontSize: 13, color: '#6b7280', margin: 0, lineHeight: 1.5, fontFamily: "var(--font-sans)" }}>
              Open a full invoice composer with customer details, invoice notes, and optional multi-line items.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
              <button
                type="button"
                onClick={openInvoiceComposer}
                className="btn-pill btn-invoice"
                style={{ alignSelf: 'flex-start' }}
              >
                Open Invoice Composer
              </button>
              {lastInvoiceUrl && (
                <button
                  type="button"
                  onClick={() => window.open(lastInvoiceUrl, '_blank', 'noopener,noreferrer')}
                  className="btn-pill btn-ghost"
                  style={{ alignSelf: 'flex-start' }}
                >
                  Open Hosted Invoice
                </button>
              )}
            </div>
          </div>
        </div>

        {/* ── Summary ── */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <SectionLabel>Summary</SectionLabel>
            {loadingSummary && (
              <span
                style={{
                  fontSize: 11,
                  color: '#9ca3af',
                  fontFamily: "var(--font-sans)",
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    border: '1.5px solid #d1d5db',
                    borderTopColor: '#6b7280',
                    borderRadius: '50%',
                    display: 'inline-block',
                    animation: 'spin 0.7s linear infinite',
                  }}
                />
                Loading…
              </span>
            )}
          </div>

          {!summary ? (
            <p style={{ fontSize: 13, color: '#9ca3af', fontFamily: "var(--font-sans)" }}>
              {loadingSummary ? '' : 'No summary data yet.'}
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

              {/* Stat row */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
                <StatCard label="Net Revenue" value={cents(summary.totals.netCents)} accent />
                <StatCard label="Gross Revenue" value={cents(summary.totals.grossCents)} />
                <StatCard label="Cash Net" value={cents(summary.totals.cashNetCents)} />
                <StatCard label="Card Net" value={cents(summary.totals.cardNetCents)} />
              </div>

              {/* Breakdown tables */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 24 }}>
                <div>
                  <p
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                      color: '#9ca3af',
                      marginBottom: 10,
                      fontFamily: "var(--font-sans)",
                    }}
                  >
                    By Payment Method
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {summary.paymentBreakdown.map((row) => (
                      <div key={row.key}>
                        <BreakdownRow row={row} />
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <p
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: '0.12em',
                      textTransform: 'uppercase',
                      color: '#9ca3af',
                      marginBottom: 10,
                      fontFamily: "var(--font-sans)",
                    }}
                  >
                    By Source
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {summary.sourceBreakdown.map((row) => (
                      <div key={row.key}>
                        <BreakdownRow row={row} />
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Footer meta */}
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 6,
                  paddingTop: 14,
                  borderTop: '1px solid #f3f4f6',
                }}
              >
                {[
                  `${summary.startDate} → ${summary.endDate}`,
                  summary.performanceLabel,
                  `Generated ${new Date(summary.generatedAtIso).toLocaleString()}`,
                ].map((pill) => (
                  <span
                    key={pill}
                    style={{
                      background: '#f9fafb',
                      border: '1px solid #f0f0f0',
                      borderRadius: 6,
                      padding: '3px 10px',
                      fontSize: 11,
                      color: '#9ca3af',
                      fontFamily: "var(--font-sans)",
                    }}
                  >
                    {pill}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {showInvoiceComposer && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={closeInvoiceComposer}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 80,
            background: 'rgba(15, 23, 42, 0.45)',
            backdropFilter: 'blur(2px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px 14px',
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              width: 'min(980px, 100%)',
              maxHeight: '92dvh',
              background: '#ffffff',
              borderRadius: 24,
              border: '1px solid #e5e7eb',
              boxShadow: '0 24px 56px rgba(15, 23, 42, 0.28)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                borderBottom: '1px solid #f1f5f9',
                padding: '18px 22px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <div>
                <p style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#0f172a', fontFamily: "var(--font-sans)" }}>
                  New Invoice
                </p>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b', fontFamily: "var(--font-sans)" }}>
                  Enter customer details and add one or more billable line items.
                </p>
              </div>
              <button
                type="button"
                onClick={closeInvoiceComposer}
                disabled={sendingInvoice}
                className="btn-pill btn-ghost"
                style={{ padding: '7px 14px', fontSize: 12 }}
              >
                Close
              </button>
            </div>

            <div style={{ overflowY: 'auto', padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>Invoice Title</label>
                  <input
                    type="text"
                    value={invoiceDraft.description}
                    onChange={(e) => updateInvoiceField('description', e.target.value)}
                    placeholder="Example: Spring Gala Sponsorship Invoice"
                    className="finance-input"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Customer Name</label>
                  <input
                    type="text"
                    value={invoiceDraft.customerName}
                    onChange={(e) => updateInvoiceField('customerName', e.target.value)}
                    placeholder="Jordan Taylor"
                    className="finance-input"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Customer Email</label>
                  <input
                    type="email"
                    value={invoiceDraft.customerEmail}
                    onChange={(e) => updateInvoiceField('customerEmail', e.target.value)}
                    placeholder="jordan@example.com"
                    className="finance-input"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Due In Days</label>
                  <input
                    type="number"
                    min="1"
                    max="90"
                    value={invoiceDraft.dueInDays}
                    onChange={(e) => updateInvoiceField('dueInDays', e.target.value)}
                    className="finance-input"
                    style={inputStyle}
                  />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={labelStyle}>Customer Note (Optional)</label>
                  <textarea
                    value={invoiceDraft.customerNote}
                    onChange={(e) => updateInvoiceField('customerNote', e.target.value)}
                    placeholder="Payment terms, contact details, or extra note shown on the invoice."
                    className="finance-input"
                    rows={3}
                    style={{ ...inputStyle, resize: 'vertical' }}
                  />
                </div>
              </div>

              <div
                style={{
                  border: '1px solid #e5e7eb',
                  borderRadius: 14,
                  padding: 14,
                  background: '#f8fafc',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                  <p style={{ margin: 0, fontSize: 12, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#64748b', fontFamily: "var(--font-sans)" }}>
                    Line Items
                  </p>
                  <button type="button" onClick={addInvoiceLineItem} className="btn-pill btn-ghost" style={{ padding: '7px 14px', fontSize: 12 }}>
                    + Add Item
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {invoiceDraft.lineItems.map((item, index) => {
                    const rowQuantity = Number(item.quantity.trim() || '1');
                    const rowUnitAmount = Number(item.unitAmountDollars.trim());
                    const rowTotalCents =
                      Number.isInteger(rowQuantity) && rowQuantity > 0 && Number.isFinite(rowUnitAmount) && rowUnitAmount > 0
                        ? rowQuantity * Math.round(rowUnitAmount * 100)
                        : 0;
                    return (
                      <div
                        key={item.id}
                        style={{
                          border: '1px solid #e2e8f0',
                          borderRadius: 12,
                          background: '#ffffff',
                          padding: 10,
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                          gap: 8,
                          alignItems: 'center',
                        }}
                      >
                        <input
                          type="text"
                          placeholder={`Item ${index + 1} description`}
                          value={item.description}
                          onChange={(e) => updateInvoiceLineItem(item.id, { description: e.target.value })}
                          className="finance-input"
                          style={{ ...inputStyle, padding: '9px 10px', fontSize: 13 }}
                        />
                        <input
                          type="text"
                          placeholder="Optional details"
                          value={item.details}
                          onChange={(e) => updateInvoiceLineItem(item.id, { details: e.target.value })}
                          className="finance-input"
                          style={{ ...inputStyle, padding: '9px 10px', fontSize: 13 }}
                        />
                        <input
                          type="number"
                          min="1"
                          step="1"
                          placeholder="Qty"
                          value={item.quantity}
                          onChange={(e) => updateInvoiceLineItem(item.id, { quantity: e.target.value })}
                          className="finance-input"
                          style={{ ...inputStyle, padding: '9px 10px', fontSize: 13, textAlign: 'right' }}
                        />
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          placeholder="Unit $"
                          value={item.unitAmountDollars}
                          onChange={(e) => updateInvoiceLineItem(item.id, { unitAmountDollars: e.target.value })}
                          className="finance-input"
                          style={{ ...inputStyle, padding: '9px 10px', fontSize: 13, textAlign: 'right' }}
                        />
                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            color: '#0f172a',
                            textAlign: 'left',
                            minWidth: 78,
                            fontFamily: "var(--font-sans)",
                          }}
                        >
                          {rowTotalCents > 0 ? cents(rowTotalCents) : '$0.00'}
                        </div>
                        <button
                          type="button"
                          onClick={() => removeInvoiceLineItem(item.id)}
                          className="btn-pill btn-ghost"
                          style={{ padding: '7px 10px', fontSize: 12 }}
                        >
                          Remove
                        </button>
                      </div>
                    );
                  })}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <p style={{ margin: 0, fontSize: 11, color: '#64748b', fontFamily: "var(--font-sans)" }}>
                    Add as many items as you need. Amount is calculated per line as quantity × unit price.
                  </p>
                  <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: '#0f172a', fontFamily: "var(--font-sans)" }}>
                    Preview Total: {cents(invoicePreviewTotalCents)}
                  </p>
                </div>
              </div>
            </div>

            <div
              style={{
                borderTop: '1px solid #f1f5f9',
                background: '#f8fafc',
                padding: '14px 22px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 10,
              }}
            >
              <p style={{ margin: 0, fontSize: 11, color: '#64748b', fontFamily: "var(--font-sans)" }}>
                Stripe sends this invoice email immediately after submission.
              </p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" onClick={closeInvoiceComposer} disabled={sendingInvoice} className="btn-pill btn-ghost">
                  Cancel
                </button>
                <button type="button" onClick={() => void sendInvoice()} disabled={sendingInvoice} className="btn-pill btn-invoice">
                  {sendingInvoice ? 'Sending…' : 'Send Invoice'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* spinner keyframe */}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
