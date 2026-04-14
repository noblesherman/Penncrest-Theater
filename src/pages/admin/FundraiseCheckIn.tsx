import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, CheckCircle2, CreditCard, ExternalLink, QrCode, RefreshCw, Search } from 'lucide-react';
import { adminFetch } from '../../lib/adminAuth';
import { toQrCodeDataUrl } from '../../lib/qrCode';
import {
  persistScannerSessionForPerformance,
  readStoredScannerSessions,
  type PersistedScannerSession
} from '../../lib/scannerRecovery';
import { buildGeneralAdmissionLineIds } from '../../lib/cashierRules';
import type { PaymentLineEntry } from '../../lib/paymentLineTypes';

type PricingTier = {
  id: string;
  name: string;
  priceCents: number;
};

type FundraiseEvent = {
  id: string;
  title: string;
  startsAt: string;
  isFundraiser?: boolean;
  seatSelectionEnabled?: boolean;
  pricingTiers?: PricingTier[];
};

type TicketRow = {
  seatId: string | null;
  attendeeName: string | null;
  ticketType: string | null;
  isComplimentary: boolean;
  price: number;
  seatLabel: string;
  ticketId: string | null;
  ticketPublicId: string | null;
  checkedInAt: string | null;
  checkedInBy: string | null;
  checkInGate: string | null;
  admissionDecision: 'FORCE_ADMIT' | 'DENY' | null;
  admissionReason: string | null;
};

type AttendeeOrderRow = {
  id: string;
  accessToken: string;
  status: string;
  source: string;
  email: string;
  customerName: string;
  amountTotal: number;
  currency: string;
  createdAt: string;
  orderSeats: TicketRow[];
  registrationSubmission: {
    id: string;
    submittedAt: string;
  } | null;
};

type AttendeeFeed = {
  performance: {
    id: string;
    title: string;
    seatSelectionEnabled: boolean;
  };
  summary: {
    orderCount: number;
    ticketCount: number;
    responseCount: number;
  };
  rows: AttendeeOrderRow[];
};

type ScannerSession = PersistedScannerSession;

type ScanResponse = {
  outcome: 'VALID' | 'ALREADY_CHECKED_IN' | 'WRONG_PERFORMANCE' | 'NOT_ADMITTED' | 'INVALID_QR' | 'NOT_FOUND';
  message: string;
  scannedAt: string;
};

type TerminalDevice = {
  deviceId: string;
  name: string;
  lastHeartbeatAt: string;
  isBusy: boolean;
};

type InPersonFinalizeSeatSummary = {
  id: string;
  sectionName: string;
  row: string;
  number: number;
  ticketType: string;
  priceCents: number;
};

type TerminalDispatch = {
  dispatchId: string;
  status: 'PENDING' | 'DELIVERED' | 'PROCESSING' | 'FAILED' | 'SUCCEEDED' | 'EXPIRED' | 'CANCELED';
  failureReason?: string | null;
  holdExpiresAt: string;
  holdActive: boolean;
  canRetry: boolean;
  expectedAmountCents: number;
  currency: string;
  attemptCount: number;
  finalOrderId?: string | null;
  targetDeviceId: string;
  targetDeviceName?: string | null;
  seatCount: number;
  seats: InPersonFinalizeSeatSummary[];
};

function mapEntryToTerminalDispatch(entry: PaymentLineEntry): TerminalDispatch {
  return {
    dispatchId: entry.entryId,
    status: entry.status,
    failureReason: entry.failureReason,
    holdExpiresAt: entry.holdExpiresAt,
    holdActive: entry.holdActive,
    canRetry: entry.canRetry,
    expectedAmountCents: entry.expectedAmountCents,
    currency: entry.currency,
    attemptCount: entry.attemptCount,
    finalOrderId: entry.finalOrderId,
    targetDeviceId: entry.targetDeviceId,
    targetDeviceName: entry.targetDeviceName,
    seatCount: entry.seatCount,
    seats: entry.seats.map((seat) => ({
      id: seat.id,
      sectionName: seat.sectionName,
      row: seat.row,
      number: seat.number,
      ticketType: seat.ticketType,
      priceCents: seat.priceCents
    }))
  };
}

function isTerminalDispatchFinalStatus(status: TerminalDispatch['status']): boolean {
  return status === 'SUCCEEDED' || status === 'FAILED' || status === 'EXPIRED' || status === 'CANCELED';
}

const inputClass =
  'w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 outline-none focus:border-stone-500 focus:ring-2 focus:ring-stone-200';

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase()
  }).format(cents / 100);
}

export default function AdminFundraiseCheckInPage() {
  const [events, setEvents] = useState<FundraiseEvent[]>([]);
  const [performanceId, setPerformanceId] = useState('');
  const [rows, setRows] = useState<AttendeeOrderRow[]>([]);
  const [summary, setSummary] = useState<AttendeeFeed['summary'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [scannerSession, setScannerSession] = useState<ScannerSession | null>(null);
  const [sessionDraft, setSessionDraft] = useState({
    staffName: '',
    gate: 'Fundraiser Check-In',
    deviceLabel: ''
  });
  const [sessionBusy, setSessionBusy] = useState(false);
  const [checkInBusyTicketId, setCheckInBusyTicketId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [qrOrderId, setQrOrderId] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrLink, setQrLink] = useState('');
  const [qrBusy, setQrBusy] = useState(false);
  const [saleOpen, setSaleOpen] = useState(false);
  const [saleStep, setSaleStep] = useState(0);
  const [saleQuantity, setSaleQuantity] = useState(1);
  const [saleTicketTypeId, setSaleTicketTypeId] = useState('');
  const [saleCustomerName, setSaleCustomerName] = useState('');
  const [saleCustomerEmail, setSaleCustomerEmail] = useState('');
  const [saleSendReceipt, setSaleSendReceipt] = useState(false);
  const [saleAttendeeNames, setSaleAttendeeNames] = useState<string[]>(['']);
  const [salePaymentMethod, setSalePaymentMethod] = useState<'CASH' | 'STRIPE'>('STRIPE');
  const [saleTerminalDevices, setSaleTerminalDevices] = useState<TerminalDevice[]>([]);
  const [saleTerminalLoading, setSaleTerminalLoading] = useState(false);
  const [saleTerminalDeviceId, setSaleTerminalDeviceId] = useState('');
  const [saleSubmitting, setSaleSubmitting] = useState(false);
  const [saleError, setSaleError] = useState<string | null>(null);
  const [saleDispatch, setSaleDispatch] = useState<TerminalDispatch | null>(null);
  const [saleResultOrderId, setSaleResultOrderId] = useState<string | null>(null);
  const [saleResultAmountCents, setSaleResultAmountCents] = useState(0);
  const [saleResultCurrency, setSaleResultCurrency] = useState('usd');
  const [saleResultQrLink, setSaleResultQrLink] = useState('');
  const [saleResultQrDataUrl, setSaleResultQrDataUrl] = useState<string | null>(null);
  const saleFinalizingOrderRef = useRef<string | null>(null);

  const sessionReady = Boolean(scannerSession && scannerSession.performanceId === performanceId);
  const selectedEvent = useMemo(
    () => events.find((event) => event.id === performanceId) || null,
    [events, performanceId]
  );
  const fundraiserTicketOptions = useMemo(
    () => (selectedEvent?.pricingTiers || []).filter((tier) => tier.priceCents >= 0),
    [selectedEvent]
  );

  async function loadEvents() {
    const items = await adminFetch<FundraiseEvent[]>('/api/admin/performances?scope=active&kind=fundraise');
    setEvents(items);
    if (items.length === 0) {
      setPerformanceId('');
      return;
    }

    setPerformanceId((current) => {
      if (items.some((item) => item.id === current)) return current;
      return items[0].id;
    });
  }

  async function loadRows(nextPerformanceId: string) {
    if (!nextPerformanceId) {
      setRows([]);
      setSummary(null);
      return;
    }

    const data = await adminFetch<AttendeeFeed>(
      `/api/admin/fundraising/events/${encodeURIComponent(nextPerformanceId)}/attendees`
    );
    setRows(Array.isArray(data.rows) ? data.rows : []);
    setSummary(data.summary || null);
  }

  async function loadAll(nextPerformanceId: string, showSpinner = true) {
    if (showSpinner) setRefreshing(true);
    setError(null);
    try {
      await loadRows(nextPerformanceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load fundraiser attendee roster');
      setRows([]);
      setSummary(null);
    } finally {
      if (showSpinner) setRefreshing(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        await loadEvents();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load fundraiser events');
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
  }, []);

  useEffect(() => {
    if (!performanceId) return;
    setNotice(null);
    void loadAll(performanceId, true);

    const stored = readStoredScannerSessions()[performanceId];
    setScannerSession(stored || null);
  }, [performanceId]);

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;

    return rows.filter((row) => {
      if (
        row.customerName.toLowerCase().includes(needle) ||
        row.email.toLowerCase().includes(needle) ||
        row.id.toLowerCase().includes(needle)
      ) {
        return true;
      }

      return row.orderSeats.some((seat) =>
        [seat.attendeeName || '', seat.seatLabel, seat.ticketPublicId || ''].some((value) =>
          value.toLowerCase().includes(needle)
        )
      );
    });
  }, [rows, search]);

  const flattenSeatCount = useMemo(
    () => filteredRows.reduce((sum, row) => sum + row.orderSeats.length, 0),
    [filteredRows]
  );

  useEffect(() => {
    if (!fundraiserTicketOptions.length) {
      setSaleTicketTypeId('');
      return;
    }

    setSaleTicketTypeId((current) => {
      if (fundraiserTicketOptions.some((tier) => tier.id === current)) return current;
      return fundraiserTicketOptions[0].id;
    });
  }, [fundraiserTicketOptions]);

  useEffect(() => {
    setSaleAttendeeNames((current) => {
      const next = Array.from({ length: Math.max(1, Math.min(50, saleQuantity)) }, (_, index) => current[index] || '');
      return next;
    });
  }, [saleQuantity]);

  async function loadSaleTerminalDevices() {
    setSaleTerminalLoading(true);
    try {
      const payload = await adminFetch<{ devices: TerminalDevice[] }>('/api/admin/orders/in-person/terminal/devices');
      setSaleTerminalDevices(payload.devices || []);
      setSaleTerminalDeviceId((current) => {
        if (current && payload.devices.some((device) => device.deviceId === current)) return current;
        return payload.devices[0]?.deviceId || '';
      });
    } catch {
      setSaleTerminalDevices([]);
      setSaleTerminalDeviceId('');
    } finally {
      setSaleTerminalLoading(false);
    }
  }

  function resetWalkUpSale(prefill?: { customerName?: string; customerEmail?: string }) {
    setSaleOpen(true);
    setSaleStep(0);
    setSaleQuantity(1);
    setSaleCustomerName(prefill?.customerName || '');
    setSaleCustomerEmail(prefill?.customerEmail || '');
    setSaleSendReceipt(Boolean(prefill?.customerEmail));
    setSaleAttendeeNames(['']);
    setSalePaymentMethod('STRIPE');
    setSaleError(null);
    setSaleSubmitting(false);
    setSaleDispatch(null);
    setSaleResultOrderId(null);
    setSaleResultAmountCents(0);
    setSaleResultCurrency('usd');
    setSaleResultQrLink('');
    setSaleResultQrDataUrl(null);
    saleFinalizingOrderRef.current = null;
    void loadSaleTerminalDevices();
  }

  function closeWalkUpSale() {
    setSaleOpen(false);
    setSaleStep(0);
    setSaleError(null);
    setSaleDispatch(null);
    setSaleSubmitting(false);
    setSaleResultOrderId(null);
    setSaleResultQrLink('');
    setSaleResultQrDataUrl(null);
    saleFinalizingOrderRef.current = null;
  }

  async function resolveOrderAccessToken(orderId: string): Promise<string> {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const data = await adminFetch<AttendeeFeed>(
        `/api/admin/fundraising/events/${encodeURIComponent(performanceId)}/attendees`
      );
      if (attempt === 0) {
        setRows(Array.isArray(data.rows) ? data.rows : []);
        setSummary(data.summary || null);
      }
      const match = (data.rows || []).find((row) => row.id === orderId);
      if (match?.accessToken) {
        setRows(Array.isArray(data.rows) ? data.rows : []);
        setSummary(data.summary || null);
        return match.accessToken;
      }

      await new Promise((resolve) => window.setTimeout(resolve, 350));
    }

    throw new Error('Order completed, but questionnaire link is not ready yet. Refresh in a moment.');
  }

  async function completeWalkUpSale(params: { orderId: string; amountCents: number; currency: string }) {
    if (!performanceId) return;
    if (saleFinalizingOrderRef.current === params.orderId) return;
    saleFinalizingOrderRef.current = params.orderId;

    try {
      const accessToken = await resolveOrderAccessToken(params.orderId);
      const link = `${window.location.origin}/fundraising/questionnaire?orderId=${encodeURIComponent(params.orderId)}&token=${encodeURIComponent(accessToken)}`;
      const qr = await toQrCodeDataUrl(link, 320);

      setSaleResultOrderId(params.orderId);
      setSaleResultAmountCents(params.amountCents);
      setSaleResultCurrency(params.currency || 'usd');
      setSaleResultQrLink(link);
      setSaleResultQrDataUrl(qr);
      setSaleStep(3);
      setSaleDispatch(null);
      setSaleError(null);
      setNotice({ kind: 'ok', text: 'Walk-up fundraiser order completed.' });
    } finally {
      saleFinalizingOrderRef.current = null;
      await loadAll(performanceId, false);
    }
  }

  function buildWalkUpSeatIds() {
    return buildGeneralAdmissionLineIds(Math.max(1, Math.min(50, saleQuantity)));
  }

  function buildWalkUpTicketSelection(seatIds: string[]) {
    return Object.fromEntries(seatIds.map((seatId) => [seatId, saleTicketTypeId]));
  }

  function buildWalkUpAttendeeNames(seatIds: string[]) {
    return Object.fromEntries(
      seatIds.map((seatId, index) => [seatId, (saleAttendeeNames[index] || '').trim()])
    );
  }

  async function startScannerSession(event: FormEvent) {
    event.preventDefault();
    if (!performanceId) return;
    setSessionBusy(true);
    setNotice(null);
    try {
      const nextSession = await adminFetch<ScannerSession>('/api/admin/check-in/session/start', {
        method: 'POST',
        body: JSON.stringify({
          performanceId,
          staffName: sessionDraft.staffName.trim(),
          gate: sessionDraft.gate.trim(),
          deviceLabel: sessionDraft.deviceLabel.trim() || undefined
        })
      });
      setScannerSession(nextSession);
      persistScannerSessionForPerformance(nextSession.performanceId, nextSession);
      setNotice({ kind: 'ok', text: 'Check-in session started.' });
    } catch (err) {
      setNotice({ kind: 'err', text: err instanceof Error ? err.message : 'Failed to start session' });
    } finally {
      setSessionBusy(false);
    }
  }

  async function endScannerSession() {
    if (!scannerSession) return;
    setSessionBusy(true);
    setNotice(null);
    try {
      await adminFetch('/api/admin/check-in/session/end', {
        method: 'POST',
        body: JSON.stringify({ sessionToken: scannerSession.sessionToken })
      });
      persistScannerSessionForPerformance(scannerSession.performanceId, null);
      setScannerSession(null);
      setNotice({ kind: 'ok', text: 'Check-in session ended.' });
    } catch (err) {
      setNotice({ kind: 'err', text: err instanceof Error ? err.message : 'Failed to end session' });
    } finally {
      setSessionBusy(false);
    }
  }

  async function checkInByTicketPublicId(ticket: TicketRow) {
    if (!ticket.ticketPublicId || !scannerSession || !sessionReady || !performanceId) return;
    setCheckInBusyTicketId(ticket.ticketId || ticket.ticketPublicId);
    setNotice(null);

    try {
      const result = await adminFetch<ScanResponse>('/api/admin/check-in/scan', {
        method: 'POST',
        body: JSON.stringify({
          performanceId,
          sessionToken: scannerSession.sessionToken,
          scannedValue: ticket.ticketPublicId,
          clientScanId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
        })
      });
      setNotice({
        kind: result.outcome === 'VALID' || result.outcome === 'ALREADY_CHECKED_IN' ? 'ok' : 'err',
        text: result.message
      });
      await loadAll(performanceId, false);
    } catch (err) {
      setNotice({ kind: 'err', text: err instanceof Error ? err.message : 'Check-in failed' });
    } finally {
      setCheckInBusyTicketId(null);
    }
  }

  function openWalkUpSale(prefill?: { customerName?: string; customerEmail?: string }) {
    if (!performanceId) return;
    resetWalkUpSale(prefill);
  }

  function updateSaleAttendeeName(index: number, value: string) {
    setSaleAttendeeNames((current) => {
      const next = [...current];
      next[index] = value;
      return next;
    });
  }

  function validateWalkUpStep(step: number): string | null {
    if (!selectedEvent) {
      return 'Select a fundraiser event first.';
    }
    if (selectedEvent.seatSelectionEnabled !== false) {
      return 'This event uses assigned seating and cannot use quick quantity checkout.';
    }

    if (step === 0) {
      if (saleQuantity < 1 || saleQuantity > 50) {
        return 'Choose between 1 and 50 tickets.';
      }
      if (!saleTicketTypeId) {
        return 'Choose a ticket type.';
      }
      return null;
    }

    if (step === 1) {
      if (!saleCustomerName.trim()) {
        return 'Buyer name is required.';
      }
      if (saleSendReceipt && !saleCustomerEmail.trim()) {
        return 'Receipt email is required when sending a receipt.';
      }
      const firstMissing = saleAttendeeNames.findIndex((name) => !name.trim());
      if (firstMissing >= 0) {
        return `Attendee name #${firstMissing + 1} is required.`;
      }
      return null;
    }

    if (step === 2) {
      if (salePaymentMethod === 'STRIPE' && !saleTerminalDeviceId) {
        return 'Choose a payment terminal device.';
      }
      return null;
    }

    return null;
  }

  function nextWalkUpStep() {
    const problem = validateWalkUpStep(saleStep);
    if (problem) {
      setSaleError(problem);
      return;
    }
    setSaleError(null);
    setSaleStep((current) => Math.min(3, current + 1));
  }

  function prevWalkUpStep() {
    setSaleError(null);
    setSaleStep((current) => Math.max(0, current - 1));
  }

  async function submitWalkUpPayment() {
    const problem = validateWalkUpStep(2);
    if (problem) {
      setSaleError(problem);
      return;
    }
    if (!performanceId) return;

    const seatIds = buildWalkUpSeatIds();
    const ticketSelectionBySeatId = buildWalkUpTicketSelection(seatIds);
    const attendeeNames = buildWalkUpAttendeeNames(seatIds);
    const normalizedReceiptEmail = saleCustomerEmail.trim().toLowerCase();

    setSaleSubmitting(true);
    setSaleError(null);
    try {
      if (salePaymentMethod === 'CASH') {
        const result = await adminFetch<{
          id: string;
          expectedAmountCents: number;
        }>('/api/admin/orders/in-person/finalize', {
          method: 'POST',
          body: JSON.stringify({
            performanceId,
            seatIds,
            ticketSelectionBySeatId,
            attendeeNames,
            paymentMethod: 'CASH',
            customerName: saleCustomerName.trim(),
            receiptEmail: normalizedReceiptEmail || undefined,
            sendReceipt: Boolean(saleSendReceipt && normalizedReceiptEmail)
          })
        });

        await completeWalkUpSale({
          orderId: result.id,
          amountCents: result.expectedAmountCents,
          currency: 'usd'
        });
        return;
      }

      const entry = await adminFetch<PaymentLineEntry>('/api/admin/payment-line/enqueue', {
        method: 'POST',
        body: JSON.stringify({
          performanceId,
          seatIds,
          ticketSelectionBySeatId,
          attendeeNames,
          customerName: saleCustomerName.trim(),
          receiptEmail: normalizedReceiptEmail || undefined,
          sendReceipt: Boolean(saleSendReceipt && normalizedReceiptEmail),
          deviceId: saleTerminalDeviceId
        })
      });

      const dispatch = mapEntryToTerminalDispatch(entry);
      setSaleDispatch(dispatch);
      if (dispatch.status === 'SUCCEEDED' && dispatch.finalOrderId) {
        await completeWalkUpSale({
          orderId: dispatch.finalOrderId,
          amountCents: dispatch.expectedAmountCents,
          currency: dispatch.currency
        });
      }
    } catch (err) {
      setSaleError(err instanceof Error ? err.message : 'Failed to start fundraiser payment flow');
    } finally {
      setSaleSubmitting(false);
    }
  }

  useEffect(() => {
    if (!saleDispatch) return;
    if (isTerminalDispatchFinalStatus(saleDispatch.status)) return;

    let cancelled = false;
    const refresh = async () => {
      try {
        const entry = await adminFetch<PaymentLineEntry>(
          `/api/admin/payment-line/entry/${encodeURIComponent(saleDispatch.dispatchId)}`
        );
        if (cancelled) return;

        const next = mapEntryToTerminalDispatch(entry);
        setSaleDispatch(next);

        if (next.status === 'SUCCEEDED' && next.finalOrderId) {
          await completeWalkUpSale({
            orderId: next.finalOrderId,
            amountCents: next.expectedAmountCents,
            currency: next.currency
          });
          return;
        }

        if (next.status === 'FAILED' || next.status === 'EXPIRED' || next.status === 'CANCELED') {
          setSaleError(next.failureReason || `Card terminal status: ${next.status.toLowerCase()}`);
        }
      } catch {
        // Silent retries keep this flow resilient while the terminal updates.
      }
    };

    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 1200);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [saleDispatch, completeWalkUpSale]);

  async function showQuestionnaireQr(order: AttendeeOrderRow) {
    setQrOrderId(order.id);
    setQrBusy(true);
    setQrDataUrl(null);

    const link = `${window.location.origin}/fundraising/questionnaire?orderId=${encodeURIComponent(order.id)}&token=${encodeURIComponent(order.accessToken)}`;
    setQrLink(link);

    try {
      const dataUrl = await toQrCodeDataUrl(link, 320);
      setQrDataUrl(dataUrl);
    } catch {
      setQrDataUrl(null);
    } finally {
      setQrBusy(false);
    }
  }

  useEffect(() => {
    if (!sessionDraft.staffName && scannerSession?.staffName) {
      setSessionDraft((current) => ({ ...current, staffName: scannerSession.staffName }));
    }
  }, [scannerSession?.staffName, sessionDraft.staffName]);

  const selectedSaleTier = useMemo(
    () => fundraiserTicketOptions.find((tier) => tier.id === saleTicketTypeId) || null,
    [fundraiserTicketOptions, saleTicketTypeId]
  );
  const saleEstimatedTotalCents = (selectedSaleTier?.priceCents || 0) * Math.max(1, Math.min(50, saleQuantity));

  return (
    <div className="min-h-screen bg-stone-50 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-7xl space-y-6">
        <header className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-stone-500">Fundraise</p>
              <h1 className="mt-1 text-2xl font-black text-stone-900">Fundraiser Check-In</h1>
              <p className="mt-1 text-sm text-stone-500">
                Check in paid guests, run walk-up ticket sales, and issue questionnaire QR links from one screen.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void loadAll(performanceId, true)}
                disabled={!performanceId || refreshing}
                className="inline-flex items-center gap-2 rounded-xl border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-700 transition hover:bg-stone-100 disabled:opacity-60"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              <button
                type="button"
                onClick={() => openWalkUpSale()}
                disabled={!performanceId}
                className="inline-flex items-center gap-2 rounded-xl bg-stone-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-stone-800 disabled:opacity-60"
              >
                <CreditCard className="h-4 w-4" />
                Start Walk-Up Sale
              </button>
            </div>
          </div>
        </header>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm xl:col-span-2">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <label className="block md:col-span-2">
                <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-stone-500">Fundraiser Event</span>
                <select
                  value={performanceId}
                  onChange={(event) => setPerformanceId(event.target.value)}
                  className={inputClass}
                  disabled={loading || events.length === 0}
                >
                  {events.map((event) => (
                    <option key={event.id} value={event.id}>
                      {event.title} - {new Date(event.startsAt).toLocaleString()}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-stone-500">Search Roster</span>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Buyer, attendee, ticket ID"
                    className={`${inputClass} pl-9`}
                  />
                </div>
              </label>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-stone-500">Orders</p>
                <p className="mt-1 text-2xl font-black text-stone-900">{summary?.orderCount ?? rows.length}</p>
              </div>
              <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-stone-500">Tickets</p>
                <p className="mt-1 text-2xl font-black text-stone-900">{summary?.ticketCount ?? flattenSeatCount}</p>
              </div>
              <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-stone-500">Questionnaires</p>
                <p className="mt-1 text-2xl font-black text-stone-900">{summary?.responseCount ?? 0}</p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-widest text-stone-500">Check-In Session</p>
            {!sessionReady ? (
              <form className="mt-3 space-y-3" onSubmit={startScannerSession}>
                <input
                  value={sessionDraft.staffName}
                  onChange={(event) => setSessionDraft((current) => ({ ...current, staffName: event.target.value }))}
                  placeholder="Staff name"
                  className={inputClass}
                  required
                />
                <input
                  value={sessionDraft.gate}
                  onChange={(event) => setSessionDraft((current) => ({ ...current, gate: event.target.value }))}
                  placeholder="Gate"
                  className={inputClass}
                  required
                />
                <input
                  value={sessionDraft.deviceLabel}
                  onChange={(event) => setSessionDraft((current) => ({ ...current, deviceLabel: event.target.value }))}
                  placeholder="Device label (optional)"
                  className={inputClass}
                />
                <button
                  type="submit"
                  disabled={sessionBusy || !performanceId}
                  className="inline-flex w-full items-center justify-center rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-stone-800 disabled:opacity-60"
                >
                  {sessionBusy ? 'Starting...' : 'Start Session'}
                </button>
              </form>
            ) : (
              <div className="mt-3 space-y-3">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                  <p className="text-sm font-bold text-emerald-800">{scannerSession?.staffName} - {scannerSession?.gate}</p>
                  <p className="mt-1 text-xs text-emerald-700">Session started {scannerSession ? new Date(scannerSession.createdAt).toLocaleTimeString() : ''}</p>
                </div>
                <button
                  type="button"
                  disabled={sessionBusy}
                  onClick={() => void endScannerSession()}
                  className="inline-flex w-full items-center justify-center rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 transition hover:bg-stone-100 disabled:opacity-60"
                >
                  {sessionBusy ? 'Ending...' : 'End Session'}
                </button>
                <Link
                  to="/admin/scanner"
                  className="inline-flex w-full items-center justify-center rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 transition hover:bg-stone-100"
                >
                  Open Full Scanner
                </Link>
              </div>
            )}
          </div>
        </section>

        {notice ? (
          <div
            className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm font-semibold ${
              notice.kind === 'ok'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-red-200 bg-red-50 text-red-700'
            }`}
          >
            {notice.kind === 'ok' ? <CheckCircle2 className="mt-0.5 h-4 w-4" /> : <AlertCircle className="mt-0.5 h-4 w-4" />}
            <span>{notice.text}</span>
          </div>
        ) : null}

        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>
        ) : null}

        <section className="space-y-4">
          {loading ? <p className="text-sm text-stone-500">Loading fundraiser events...</p> : null}

          {!loading && filteredRows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-10 text-center text-sm text-stone-500">
              No matching attendees found.
            </div>
          ) : null}

          {filteredRows.map((row) => (
            <article key={row.id} className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="flex flex-col gap-3 border-b border-stone-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-base font-black text-stone-900">{row.customerName}</p>
                  <p className="text-sm text-stone-500">{row.email}</p>
                  <p className="mt-1 text-xs text-stone-400">
                    Order {row.id.slice(0, 10)} - {formatMoney(row.amountTotal, row.currency)} - {new Date(row.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void showQuestionnaireQr(row)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-stone-700 transition hover:bg-stone-100"
                  >
                    <QrCode className="h-3.5 w-3.5" />
                    Questionnaire QR
                  </button>
                  <a
                    href={`/fundraising/questionnaire?orderId=${encodeURIComponent(row.id)}&token=${encodeURIComponent(row.accessToken)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-stone-700 transition hover:bg-stone-100"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open Form
                  </a>
                  <button
                    type="button"
                    onClick={() =>
                      openWalkUpSale({
                        customerName: row.customerName,
                        customerEmail: row.email
                      })
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-stone-700 transition hover:bg-stone-100"
                  >
                    <CreditCard className="h-3.5 w-3.5" />
                    Sell More Tickets
                  </button>
                  <span
                    className={`inline-flex items-center rounded-lg px-3 py-2 text-xs font-bold ${
                      row.registrationSubmission ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {row.registrationSubmission ? 'Questionnaire submitted' : 'Questionnaire pending'}
                  </span>
                </div>
              </div>

              <div className="mt-4 space-y-2">
                {row.orderSeats.map((seat, seatIndex) => {
                  const busy = checkInBusyTicketId === (seat.ticketId || seat.ticketPublicId || `${row.id}-${seatIndex}`);
                  const checkedIn = Boolean(seat.checkedInAt);

                  return (
                    <div key={`${row.id}-${seat.ticketId || seatIndex}`} className="rounded-xl border border-stone-200 bg-stone-50 p-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-sm font-bold text-stone-900">
                            {seat.attendeeName || row.customerName} - {seat.seatLabel}
                          </p>
                          <p className="text-xs text-stone-500">
                            Ticket {seat.ticketPublicId || 'N/A'}
                            {seat.ticketType ? ` - ${seat.ticketType}` : ''}
                            {seat.isComplimentary ? ' - Complimentary' : ''}
                          </p>
                          {checkedIn ? (
                            <p className="mt-1 text-xs font-semibold text-emerald-700">
                              Checked in {new Date(seat.checkedInAt as string).toLocaleString()}
                              {seat.checkInGate ? ` at ${seat.checkInGate}` : ''}
                            </p>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          disabled={!seat.ticketPublicId || !sessionReady || checkedIn || busy}
                          onClick={() => void checkInByTicketPublicId(seat)}
                          className="inline-flex items-center justify-center rounded-lg bg-stone-900 px-3 py-2 text-xs font-bold text-white transition hover:bg-stone-800 disabled:opacity-60"
                        >
                          {busy ? 'Checking...' : checkedIn ? 'Checked In' : 'Check In'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </article>
          ))}
        </section>
      </div>

      {saleOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-5">
          <div className="w-full max-w-3xl rounded-2xl bg-white shadow-2xl">
            <div className="border-b border-stone-200 px-5 py-4 sm:px-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-stone-500">Fundraiser Walk-Up Sale</p>
                  <h2 className="mt-1 text-xl font-black text-stone-900">Fast Ticket + Payment + QR Flow</h2>
                </div>
                <button
                  type="button"
                  onClick={closeWalkUpSale}
                  className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-semibold text-stone-700 transition hover:bg-stone-100"
                >
                  Close
                </button>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {['Tickets', 'Names', 'Payment', 'QR'].map((label, index) => (
                  <div
                    key={label}
                    className={`rounded-lg border px-3 py-2 text-center text-xs font-bold uppercase tracking-wide ${
                      saleStep === index
                        ? 'border-stone-900 bg-stone-900 text-white'
                        : saleStep > index
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                          : 'border-stone-200 bg-stone-50 text-stone-500'
                    }`}
                  >
                    {label}
                  </div>
                ))}
              </div>
            </div>

            <div className="max-h-[70vh] overflow-y-auto px-5 py-4 sm:px-6 sm:py-5">
              {saleError ? (
                <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                  {saleError}
                </div>
              ) : null}

              {selectedEvent?.seatSelectionEnabled !== false ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  This event uses assigned seating. Quick quantity checkout is only available for general admission fundraiser events.
                </div>
              ) : null}

              {selectedEvent?.seatSelectionEnabled === false && saleStep === 0 ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-stone-500">Ticket Quantity</span>
                      <input
                        type="number"
                        min={1}
                        max={50}
                        value={saleQuantity}
                        onChange={(event) => {
                          const next = Number(event.target.value || 1);
                          setSaleQuantity(Math.max(1, Math.min(50, Number.isFinite(next) ? next : 1)));
                        }}
                        className={inputClass}
                      />
                    </label>

                    <label className="block">
                      <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-stone-500">Ticket Type</span>
                      <select
                        value={saleTicketTypeId}
                        onChange={(event) => setSaleTicketTypeId(event.target.value)}
                        className={inputClass}
                      >
                        {fundraiserTicketOptions.map((tier) => (
                          <option key={tier.id} value={tier.id}>
                            {tier.name} · {formatMoney(tier.priceCents, 'usd')}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
                    <p className="text-xs font-bold uppercase tracking-wide text-stone-500">Estimated Total</p>
                    <p className="mt-1 text-2xl font-black text-stone-900">{formatMoney(saleEstimatedTotalCents, 'usd')}</p>
                    <p className="mt-1 text-sm text-stone-500">
                      {saleQuantity} ticket{saleQuantity === 1 ? '' : 's'} at {selectedSaleTier ? formatMoney(selectedSaleTier.priceCents, 'usd') : formatMoney(0, 'usd')} each.
                    </p>
                  </div>
                </div>
              ) : null}

              {selectedEvent?.seatSelectionEnabled === false && saleStep === 1 ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <label className="block">
                      <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-stone-500">Buyer Name</span>
                      <input
                        value={saleCustomerName}
                        onChange={(event) => setSaleCustomerName(event.target.value)}
                        placeholder="Parent / family name"
                        className={inputClass}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-stone-500">Receipt Email (optional)</span>
                      <input
                        value={saleCustomerEmail}
                        onChange={(event) => setSaleCustomerEmail(event.target.value)}
                        placeholder="name@email.com"
                        className={inputClass}
                      />
                    </label>
                  </div>

                  <label className="inline-flex items-center gap-2 text-sm font-semibold text-stone-700">
                    <input
                      type="checkbox"
                      checked={saleSendReceipt}
                      onChange={(event) => setSaleSendReceipt(event.target.checked)}
                    />
                    Email receipt and tickets after payment
                  </label>

                  <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
                    <p className="text-xs font-bold uppercase tracking-wide text-stone-500">Attendee Names</p>
                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {saleAttendeeNames.map((name, index) => (
                        <label key={`attendee-${index}`} className="block">
                          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-stone-500">
                            Ticket #{index + 1}
                          </span>
                          <input
                            value={name}
                            onChange={(event) => updateSaleAttendeeName(index, event.target.value)}
                            placeholder="Attendee full name"
                            className={inputClass}
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              {selectedEvent?.seatSelectionEnabled === false && saleStep === 2 ? (
                <div className="space-y-4">
                  <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
                    <p className="text-xs font-bold uppercase tracking-wide text-stone-500">Amount Due</p>
                    <p className="mt-1 text-2xl font-black text-stone-900">{formatMoney(saleEstimatedTotalCents, 'usd')}</p>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => setSalePaymentMethod('STRIPE')}
                      className={`rounded-xl border px-4 py-3 text-left text-sm font-semibold transition ${
                        salePaymentMethod === 'STRIPE'
                          ? 'border-stone-900 bg-stone-900 text-white'
                          : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-100'
                      }`}
                    >
                      Card via Terminal
                    </button>
                    <button
                      type="button"
                      onClick={() => setSalePaymentMethod('CASH')}
                      className={`rounded-xl border px-4 py-3 text-left text-sm font-semibold transition ${
                        salePaymentMethod === 'CASH'
                          ? 'border-stone-900 bg-stone-900 text-white'
                          : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-100'
                      }`}
                    >
                      Cash Payment
                    </button>
                  </div>

                  {salePaymentMethod === 'STRIPE' ? (
                    <div className="rounded-xl border border-stone-200 p-4">
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-xs font-bold uppercase tracking-wide text-stone-500">Payment Device</p>
                        <button
                          type="button"
                          onClick={() => void loadSaleTerminalDevices()}
                          className="text-xs font-semibold text-stone-600 hover:text-stone-900"
                        >
                          Refresh Devices
                        </button>
                      </div>
                      <select
                        value={saleTerminalDeviceId}
                        onChange={(event) => setSaleTerminalDeviceId(event.target.value)}
                        className={inputClass}
                        disabled={saleTerminalLoading || saleSubmitting}
                      >
                        {saleTerminalDevices.map((device) => (
                          <option key={device.deviceId} value={device.deviceId}>
                            {device.name}{device.isBusy ? ' (busy)' : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}

                  {saleDispatch ? (
                    <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
                      <p className="text-xs font-bold uppercase tracking-wide text-stone-500">Terminal Status</p>
                      <p className="mt-1 text-sm font-semibold text-stone-900">
                        {saleDispatch.status === 'PENDING' ? 'Waiting in payment line'
                          : saleDispatch.status === 'DELIVERED' ? 'Sent to terminal'
                          : saleDispatch.status === 'PROCESSING' ? 'Payment in progress on terminal'
                          : saleDispatch.status === 'SUCCEEDED' ? 'Payment approved'
                          : saleDispatch.status === 'FAILED' ? 'Payment failed'
                          : saleDispatch.status === 'EXPIRED' ? 'Payment request expired'
                          : 'Payment canceled'}
                      </p>
                      {saleDispatch.failureReason ? (
                        <p className="mt-1 text-xs text-red-600">{saleDispatch.failureReason}</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {selectedEvent?.seatSelectionEnabled === false && saleStep === 3 ? (
                <div className="space-y-4">
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
                    Sale complete. Show this QR code so the family can fill out the questionnaire.
                  </div>

                  <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
                    <p className="text-xs font-bold uppercase tracking-wide text-stone-500">Order</p>
                    <p className="mt-1 text-sm text-stone-700">{saleResultOrderId ? saleResultOrderId.slice(0, 12) : '-'}</p>
                    <p className="mt-1 text-lg font-black text-stone-900">{formatMoney(saleResultAmountCents, saleResultCurrency || 'usd')}</p>
                  </div>

                  <div className="flex min-h-[220px] items-center justify-center rounded-xl border border-stone-200 bg-stone-50 p-4">
                    {saleResultQrDataUrl ? (
                      <img src={saleResultQrDataUrl} alt="Walk-up questionnaire QR code" className="h-56 w-56 rounded bg-white p-2" />
                    ) : (
                      <p className="text-sm text-stone-500">Generating QR code...</p>
                    )}
                  </div>

                  <div>
                    <p className="mb-1 text-xs font-bold uppercase tracking-wide text-stone-500">Questionnaire Link</p>
                    <textarea readOnly value={saleResultQrLink} className={`${inputClass} min-h-[72px] resize-none`} />
                  </div>
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap justify-between gap-2 border-t border-stone-200 px-5 py-4 sm:px-6">
              <div className="flex gap-2">
                {saleStep > 0 && saleStep < 3 ? (
                  <button
                    type="button"
                    onClick={prevWalkUpStep}
                    disabled={saleSubmitting}
                    className="rounded-xl border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-700 transition hover:bg-stone-100 disabled:opacity-60"
                  >
                    Back
                  </button>
                ) : null}
              </div>

              <div className="flex gap-2">
                {saleStep < 2 ? (
                  <button
                    type="button"
                    onClick={nextWalkUpStep}
                    disabled={selectedEvent?.seatSelectionEnabled !== false}
                    className="rounded-xl bg-stone-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-stone-800 disabled:opacity-60"
                  >
                    Next Step
                  </button>
                ) : null}

                {saleStep === 2 ? (
                  <button
                    type="button"
                    onClick={() => void submitWalkUpPayment()}
                    disabled={
                      selectedEvent?.seatSelectionEnabled !== false ||
                      saleSubmitting ||
                      (saleDispatch !== null && !isTerminalDispatchFinalStatus(saleDispatch.status))
                    }
                    className="rounded-xl bg-stone-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-stone-800 disabled:opacity-60"
                  >
                    {saleSubmitting
                      ? 'Processing...'
                      : salePaymentMethod === 'CASH'
                        ? 'Take Cash + Complete'
                        : saleDispatch && !isTerminalDispatchFinalStatus(saleDispatch.status)
                          ? 'Waiting For Terminal'
                          : 'Start Card Payment'}
                  </button>
                ) : null}

                {saleStep === 3 ? (
                  <>
                    <button
                      type="button"
                      onClick={() => resetWalkUpSale()}
                      className="rounded-xl border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-700 transition hover:bg-stone-100"
                    >
                      New Sale
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard.writeText(saleResultQrLink);
                      }}
                      className="rounded-xl bg-stone-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-stone-800"
                    >
                      Copy Link
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {qrOrderId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <h2 className="text-lg font-black text-stone-900">Questionnaire QR</h2>
            <p className="mt-1 text-sm text-stone-500">Order {qrOrderId.slice(0, 10)}</p>

            <div className="mt-4 flex min-h-[220px] items-center justify-center rounded-xl border border-stone-200 bg-stone-50 p-4">
              {qrBusy ? (
                <p className="text-sm text-stone-500">Generating QR...</p>
              ) : qrDataUrl ? (
                <img src={qrDataUrl} alt="Questionnaire QR code" className="h-56 w-56 rounded bg-white p-2" />
              ) : (
                <p className="text-sm text-red-600">Could not generate QR code.</p>
              )}
            </div>

            <div className="mt-4">
              <p className="mb-1 text-xs font-bold uppercase tracking-wide text-stone-500">Link</p>
              <textarea readOnly value={qrLink} className={`${inputClass} min-h-[72px] resize-none`} />
            </div>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setQrOrderId(null);
                  setQrDataUrl(null);
                  setQrLink('');
                }}
                className="inline-flex flex-1 items-center justify-center rounded-xl border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-700 transition hover:bg-stone-100"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => void navigator.clipboard.writeText(qrLink)}
                className="inline-flex flex-1 items-center justify-center rounded-xl bg-stone-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-stone-800"
              >
                Copy Link
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
