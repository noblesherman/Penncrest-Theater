import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe, type StripeElementsOptions } from '@stripe/stripe-js';
import { adminFetch } from '../../lib/adminAuth';
import { apiFetch } from '../../lib/api';
import { usePaymentLineStatusStream } from '../../hooks/usePaymentLineStatusStream';
import { readCashierDefaultPerformanceId, writeCashierDefaultPerformanceId } from '../../hooks/useCashierDefaultPerformance';
import type { PaymentLineEntry } from '../../lib/paymentLineTypes';
import {
  buildGeneralAdmissionLineIds,
  isStudentInShowTicketName,
  isTeacherTicketName,
  MAX_STUDENT_COMP_TICKETS,
  MAX_TEACHER_COMP_TICKETS,
  naturalSort,
  parseSeatIds,
  pickComplimentarySeatIds,
  STUDENT_SHOW_TICKET_OPTION_ID,
  TEACHER_TICKET_OPTION_ID
} from '../../lib/cashierRules';
import { SeatMapViewport } from '../../components/SeatMapViewport';
import {
  Search, X, Check, ChevronRight, ChevronLeft,
  Hash, Ticket, Plus, ExternalLink, AlertCircle,
  CheckCircle2, RefreshCw, CreditCard, Banknote,
  ArrowRight, MapPin, Tag, Users
} from 'lucide-react';

// ── types ────────────────────────────────────────────────────────────────────

type Order = {
  id: string; status: string;
  source: 'ONLINE' | 'DOOR' | 'COMP' | 'STAFF_FREE' | 'STAFF_COMP' | 'FAMILY_FREE' | 'STUDENT_COMP';
  inPersonPaymentMethod?: 'STRIPE' | 'CASH' | null;
  email: string; customerName: string;
  amountTotal: number; createdAt: string;
  performanceTitle: string; ticketCount: number;
};

type PricingTier = { id: string; name: string; priceCents: number; };
type CashierTicketOption = { id: string; name: string; priceCents: number; isSynthetic?: boolean; };
type Performance = {
  id: string;
  title: string;
  startsAt: string;
  isFundraiser?: boolean;
  pricingTiers: PricingTier[];
  staffCompsEnabled?: boolean;
  studentCompTicketsEnabled?: boolean;
  seatSelectionEnabled?: boolean;
};
type Seat = {
  id: string; sectionName: string; row: string; number: number;
  x: number; y: number; price: number;
  status: 'available' | 'held' | 'sold' | 'blocked';
  isAccessible?: boolean; isCompanion?: boolean; companionForSeatId?: string | null;
};
type AssignForm = {
  performanceId: string; source: 'DOOR' | 'COMP';
  customerName: string; customerEmail: string;
  seatIdsInput: string; gaQuantityInput: string; ticketType: string; sendEmail: boolean;
};
type CashierSelectionLine = {
  id: string;
  label: string;
  sectionName: string;
  row: string;
  number: number;
  seatPriceCents: number;
};
type InPersonCashTonightSummary = {
  totalCashCents: number; saleCount: number;
  nightStartIso: string; nightEndIso: string; performanceId: string | null;
};
type InPersonFinalizeSeatSummary = {
  id: string;
  sectionName: string;
  row: string;
  number: number;
  ticketType: string;
  priceCents: number;
};
type InPersonSaleRecap = {
  expectedAmountCents: number;
  paymentMethod: 'STRIPE' | 'CASH';
  seats: InPersonFinalizeSeatSummary[];
  expiresAtMs: number;
};
type CashierDeepLinkPrefill = {
  customerName?: string;
  customerEmail?: string;
  sourceOrderId?: string;
};
type TerminalDevice = {
  deviceId: string;
  name: string;
  lastHeartbeatAt: string;
  isBusy: boolean;
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

type ManualInPersonPaymentIntent = {
  paymentIntentId: string;
  clientSecret: string;
  publishableKey?: string;
  expectedAmountCents: number;
  currency: string;
};

type ManualCheckoutSession = {
  performanceId: string;
  seatIds: string[];
  ticketSelectionBySeatId: Record<string, string>;
  studentCode?: string;
  sendReceipt: boolean;
  customerName: string;
  receiptEmail: string;
  paymentIntentId: string;
  clientSecret: string;
  publishableKey: string;
  expectedAmountCents: number;
  currency: string;
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

const TERMINAL_DISPATCH_POLL_INTERVAL_MS = 750;
const TERMINAL_DISPATCH_REFRESH_MIN_INTERVAL_MS = 300;
const FALLBACK_STRIPE_PUBLISHABLE_KEY = (import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '').trim();

// ── helpers ──────────────────────────────────────────────────────────────────

function isTerminalDispatchFinalStatus(status: TerminalDispatch['status']): boolean {
  return status === 'SUCCEEDED' || status === 'FAILED' || status === 'EXPIRED' || status === 'CANCELED';
}

function normalizeSeat(raw: any): Seat {
  const rawStatus = String(raw?.status || 'available').toLowerCase();
  const status: Seat['status'] = ['available', 'held', 'sold', 'blocked'].includes(rawStatus)
    ? (rawStatus as Seat['status']) : 'available';
  const sectionOffset = raw?.sectionName === 'LEFT' ? 0 : raw?.sectionName === 'CENTER' ? 700 : 1400;
  const rowCode = String(raw?.row || 'A').charCodeAt(0) || 65;
  return {
    id: String(raw?.id || ''),
    sectionName: String(raw?.sectionName || 'Unknown'),
    row: String(raw?.row || ''),
    number: Number(raw?.number || 0),
    x: Number.isFinite(Number(raw?.x)) ? Number(raw.x) : sectionOffset + Number(raw?.number || 0) * 36,
    y: Number.isFinite(Number(raw?.y)) ? Number(raw.y) : (rowCode - 65) * 40,
    price: Number(raw?.price || 0),
    status,
    isAccessible: Boolean(raw?.isAccessible),
    isCompanion: Boolean(raw?.isCompanion),
    companionForSeatId: raw?.companionForSeatId ?? null,
  };
}

const STATUS_META: Record<string, { label: string; dot: string; text: string; bg: string }> = {
  PAID:     { label: 'Paid',     dot: 'bg-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-50 ring-emerald-200' },
  PENDING:  { label: 'Pending',  dot: 'bg-amber-400',   text: 'text-amber-700',   bg: 'bg-amber-50 ring-amber-200'    },
  REFUNDED: { label: 'Refunded', dot: 'bg-slate-400',   text: 'text-slate-600',   bg: 'bg-slate-50 ring-slate-200'    },
  CANCELED: { label: 'Canceled', dot: 'bg-red-400',     text: 'text-red-600',     bg: 'bg-red-50 ring-red-200'        },
};

const SOURCE_META: Record<string, { label: string; bg: string; text: string }> = {
  ONLINE:       { label: 'Online',       bg: 'bg-blue-50 ring-blue-200',    text: 'text-blue-700'   },
  DOOR:         { label: 'Door',         bg: 'bg-violet-50 ring-violet-200', text: 'text-violet-700' },
  COMP:         { label: 'Comp',         bg: 'bg-slate-100 ring-slate-200',  text: 'text-slate-600'  },
  STAFF_FREE:   { label: 'Staff',        bg: 'bg-amber-50 ring-amber-200',   text: 'text-amber-700'  },
  STAFF_COMP:   { label: 'Staff',        bg: 'bg-amber-50 ring-amber-200',   text: 'text-amber-700'  },
  FAMILY_FREE:  { label: 'Family',       bg: 'bg-pink-50 ring-pink-200',     text: 'text-pink-700'   },
  STUDENT_COMP: { label: 'Student',      bg: 'bg-indigo-50 ring-indigo-200', text: 'text-indigo-700' },
};

function Badge({ label, bg, text, dot }: { label: string; bg: string; text: string; dot?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${bg} ${text}`}>
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />}
      {label}
    </span>
  );
}

const STEPS = [
  { id: 'show',    label: 'Performance', icon: Ticket },
  { id: 'seats',   label: 'Seats',       icon: MapPin  },
  { id: 'tickets', label: 'Checkout',    icon: Tag     },
];

const CHECKOUT_OVERLAY_BASE =
  'fixed inset-0 flex items-center justify-center bg-black/55 backdrop-blur-sm';
const CHECKOUT_PANEL_BASE =
  'w-full rounded-[28px] border border-slate-200/90 bg-white shadow-[0_28px_80px_rgba(15,23,42,0.28)]';

// ── base input styles ─────────────────────────────────────────────────────────

const baseInput = [
  'w-full rounded-xl border border-slate-200/90 bg-white px-4 py-3 text-sm font-medium text-slate-900',
  'placeholder:text-slate-400 transition',
  'focus:border-rose-400 focus:outline-none focus:ring-2 focus:ring-rose-100/80',
].join(' ');

const baseSelect = baseInput + ' cursor-pointer';

// ── label helper ──────────────────────────────────────────────────────────────

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">{children}</p>
  );
}

// ── section card ─────────────────────────────────────────────────────────────

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-slate-200/80 bg-white shadow-[0_6px_20px_rgba(15,23,42,0.05)] ${className}`}>
      {children}
    </div>
  );
}

function ManualDispatchChargeForm(props: {
  amountCents: number;
  customerName: string;
  receiptEmail: string;
  disabled?: boolean;
  onError: (message: string | null) => void;
  onPaymentConfirmed: (paymentIntentId: string) => Promise<void>;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    props.onError(null);

    if (!stripe || !elements) {
      props.onError('Card form is still loading. Please try again.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await stripe.confirmPayment({
        elements,
        confirmParams: {
          payment_method_data: {
            billing_details: {
              name: props.customerName || undefined,
              email: props.receiptEmail || undefined,
            }
          }
        },
        redirect: 'if_required'
      });

      if (result.error) {
        throw new Error(result.error.message || 'Card charge failed.');
      }

      const confirmedIntent = result.paymentIntent;
      if (!confirmedIntent?.id) {
        throw new Error('Stripe did not return a payment intent id.');
      }
      if (confirmedIntent.status !== 'succeeded') {
        throw new Error(`Payment is ${confirmedIntent.status}. Charge must be succeeded before finalizing checkout.`);
      }

      await props.onPaymentConfirmed(confirmedIntent.id);
    } catch (err) {
      props.onError(err instanceof Error ? err.message : 'Card charge failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="rounded-xl border border-slate-200 bg-white p-3 sm:p-4">
        <PaymentElement />
      </div>
      <button
        type="submit"
        disabled={props.disabled || submitting || !stripe || !elements}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
        Charge ${(props.amountCents / 100).toFixed(2)}
      </button>
    </form>
  );
}

// ── main ─────────────────────────────────────────────────────────────────────

export default function AdminOrdersPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [rows,         setRows]         = useState<Order[]>([]);
  const [query,        setQuery]        = useState('');
  const [status,       setStatus]       = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [scope,        setScope]        = useState<'active' | 'archived' | 'all'>('active');
  const [performances, setPerformances] = useState<Performance[]>([]);
  const [loadingRows,  setLoadingRows]  = useState(false);
  const [submitting,   setSubmitting]   = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [notice,       setNotice]       = useState<string | null>(null);
  const [showWizard,   setShowWizard]   = useState(false);
  const [showCashierPerformancePicker, setShowCashierPerformancePicker] = useState(false);
  const [cashierPerformanceDraftId, setCashierPerformanceDraftId] = useState('');
  const [step,         setStep]         = useState(0);
  const [dir,          setDir]          = useState<1 | -1>(1);
  const didAutoOpenSeatPickerRef = useRef(false);
  const selectedSeatIdsRef = useRef<string[]>([]);
  const [seatPickerOpen,  setSeatPickerOpen]  = useState(false);
  const [seats,           setSeats]           = useState<Seat[]>([]);
  const [loadingSeats,    setLoadingSeats]    = useState(false);
  const [seatPickerError, setSeatPickerError] = useState<string | null>(null);
  const [activeSection,   setActiveSection]   = useState<string>('All');
  const [ticketSelectionBySeatId, setTicketSelectionBySeatId] = useState<Record<string, string>>({});
  const [inPersonFlowError, setInPersonFlowError] = useState<string | null>(null);
  const [inPersonSubmitting, setInPersonSubmitting] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'STRIPE' | 'CASH'>('STRIPE');
  const [stripeChargePath, setStripeChargePath] = useState<'TERMINAL' | 'MANUAL'>('TERMINAL');
  const [receiptEmail, setReceiptEmail] = useState('');
  const [sendReceipt, setSendReceipt] = useState(false);
  const [studentCode, setStudentCode] = useState('');
  const [terminalDevices, setTerminalDevices] = useState<TerminalDevice[]>([]);
  const [loadingTerminalDevices, setLoadingTerminalDevices] = useState(false);
  const [selectedTerminalDeviceId, setSelectedTerminalDeviceId] = useState('');
  const [terminalDispatch, setTerminalDispatch] = useState<TerminalDispatch | null>(null);
  const [terminalDispatchActionBusy, setTerminalDispatchActionBusy] = useState(false);
  const [manualCheckout, setManualCheckout] = useState<ManualCheckoutSession | null>(null);
  const [manualCheckoutError, setManualCheckoutError] = useState<string | null>(null);
  const [manualCheckoutLoading, setManualCheckoutLoading] = useState(false);
  const [manualCheckoutCompleting, setManualCheckoutCompleting] = useState(false);
  const [manualCapturedPaymentIntentId, setManualCapturedPaymentIntentId] = useState<string | null>(null);
  const [cashTonight, setCashTonight] = useState<InPersonCashTonightSummary | null>(null);
  const [loadingCashTonight, setLoadingCashTonight] = useState(false);
  const [saleRecap, setSaleRecap] = useState<InPersonSaleRecap | null>(null);
  const [saleRecapSecondsLeft, setSaleRecapSecondsLeft] = useState(0);
  const terminalDispatchRefreshInFlightRef = useRef(false);
  const terminalDispatchRefreshLastAtRef = useRef(0);
  const terminalDispatchRefreshLastIdRef = useRef<string | null>(null);
  const cashierDeepLinkConsumedRef = useRef<string | null>(null);

  const manualStripePromise = useMemo(() => {
    if (!manualCheckout?.publishableKey) return null;
    return loadStripe(manualCheckout.publishableKey);
  }, [manualCheckout?.publishableKey]);
  const manualStripeOptions = useMemo<StripeElementsOptions | null>(() => {
    if (!manualCheckout?.clientSecret) return null;
    return {
      clientSecret: manualCheckout.clientSecret,
      appearance: { theme: 'stripe' }
    };
  }, [manualCheckout?.clientSecret]);

  const sellerStatusStream = usePaymentLineStatusStream({
    queueKey: terminalDispatch?.targetDeviceId || null,
    sellerEntryId: terminalDispatch?.dispatchId || null,
    enabled: Boolean(terminalDispatch?.targetDeviceId)
  });

  const [assignForm, setAssignForm] = useState<AssignForm>({
    performanceId: '', source: 'DOOR',
    customerName: '', customerEmail: '',
    seatIdsInput: '', gaQuantityInput: '1', ticketType: '', sendEmail: false,
  });

  // ── data loading ───────────────────────────────────────────────────────────

  const load = async () => {
    setLoadingRows(true); setError(null);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      if (status) params.set('status', status);
      if (sourceFilter) params.set('source', sourceFilter);
      params.set('scope', scope);
      setRows(await adminFetch<Order[]>(`/api/admin/orders?${params.toString()}`));
    } catch (e) { setError(e instanceof Error ? e.message : 'We hit a small backstage snag while trying to load orders'); }
    finally { setLoadingRows(false); }
  };

  const loadPerformances = async () => {
    try {
      const items = await adminFetch<Array<{
        id: string;
        title: string;
        startsAt: string;
        isArchived?: boolean;
        isFundraiser?: boolean;
        pricingTiers?: PricingTier[];
        staffCompsEnabled?: boolean;
        studentCompTicketsEnabled?: boolean;
        seatSelectionEnabled?: boolean;
      }>>('/api/admin/performances?scope=active&kind=standard');
      const mapped = items.filter(i => !i.isArchived && !i.isFundraiser)
        .map(i => ({
          id: i.id,
          title: i.title,
          startsAt: i.startsAt,
          isFundraiser: Boolean(i.isFundraiser),
          pricingTiers: i.pricingTiers || [],
          staffCompsEnabled: Boolean(i.staffCompsEnabled),
          studentCompTicketsEnabled: Boolean(i.studentCompTicketsEnabled),
          seatSelectionEnabled: i.seatSelectionEnabled !== false,
        }));
      setPerformances(mapped);
      if (mapped.length > 0) {
        const storedPerformanceId = readCashierDefaultPerformanceId();
        const fallbackPerformanceId = mapped[0].id;
        setAssignForm(prev => {
          const nextPerformanceId =
            mapped.some(r => r.id === prev.performanceId) ? prev.performanceId
            : mapped.some(r => r.id === storedPerformanceId) ? storedPerformanceId
            : fallbackPerformanceId;
          return { ...prev, performanceId: nextPerformanceId };
        });
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'We hit a small backstage snag while trying to load performances'); }
  };

  useEffect(() => { void Promise.all([load(), loadPerformances()]); }, []);
  useEffect(() => { void load(); }, [scope]);

  const search = (e: FormEvent) => { e.preventDefault(); void load(); };

  // ── assign ─────────────────────────────────────────────────────────────────

  const assignOrder = async () => {
    setError(null); setNotice(null);
    if (!assignForm.performanceId || selectionIds.length === 0) {
      setError(seatSelectionEnabled ? 'Choose a performance and provide at least one seat ID.' : 'Choose a performance and enter at least one GA ticket.');
      return;
    }
    if (assignForm.source !== 'COMP') {
      setError('Door sales must use the in-person finalize flow.'); return;
    }
    if (assignForm.sendEmail && !assignForm.customerEmail.trim()) {
      setError('Enter an email address to send comp tickets.'); return;
    }
    if (missingTicketTypeCount > 0) {
      setError(`Choose a ticket type for every selected ${seatSelectionEnabled ? 'seat' : 'ticket'} before assigning checkout.`); return;
    }
    const ticketTypeBySeatId = Object.fromEntries(
      selectionIds.map((id) => [id, ticketSelectionBySeatId[id] || 'Comp'])
    );
    const priceBySeatId = Object.fromEntries(selectionIds.map(id => [id, 0]));
    const fallbackName = assignForm.customerName.trim() || 'Comp Guest';
    const fallbackEmail = assignForm.customerEmail.trim().toLowerCase() || `comp+${Date.now()}@boxoffice.local`;
    setSubmitting(true);
    try {
      await adminFetch('/api/admin/orders/assign', {
        method: 'POST',
        body: JSON.stringify({
          performanceId: assignForm.performanceId,
          seatIds: selectionIds,
          customerName: fallbackName, customerEmail: fallbackEmail,
          ticketTypeBySeatId, priceBySeatId,
          source: assignForm.source,
          sendEmail: Boolean(assignForm.sendEmail && assignForm.customerEmail.trim())
        }),
      });
      setAssignForm(prev => ({ ...prev, customerName: '', customerEmail: '', seatIdsInput: '', gaQuantityInput: '1', ticketType: '' }));
      setNotice(`Assigned ${selectionIds.length} ${seatSelectionEnabled ? 'seat' : 'ticket'}${selectionIds.length === 1 ? '' : 's'} successfully.`);
      startCashierLoop(assignForm.performanceId);
      void load();
      void loadSeatsForPerformance(assignForm.performanceId, { showLoading: false, syncSelection: false });
    } catch (e) { setError(e instanceof Error ? e.message : 'We hit a small backstage snag while trying to assign seats'); }
    finally { setSubmitting(false); }
  };

  const loadCashTonight = useCallback(async (performanceId: string) => {
    if (!performanceId) { setCashTonight(null); return; }
    setLoadingCashTonight(true);
    try {
      const params = new URLSearchParams({ performanceId });
      const summary = await adminFetch<InPersonCashTonightSummary>(`/api/admin/orders/in-person/cash-tonight?${params.toString()}`);
      setCashTonight(summary);
    } catch { setCashTonight(null); }
    finally { setLoadingCashTonight(false); }
  }, []);

  const loadTerminalDevices = useCallback(async () => {
    setLoadingTerminalDevices(true);
    try {
      const payload = await adminFetch<{ devices: TerminalDevice[] }>('/api/admin/orders/in-person/terminal/devices');
      setTerminalDevices(payload.devices);
      setSelectedTerminalDeviceId(prev => {
        if (prev && payload.devices.some((device) => device.deviceId === prev)) return prev;
        return payload.devices[0]?.deviceId || '';
      });
    } catch {
      setTerminalDevices([]);
      setSelectedTerminalDeviceId('');
    } finally {
      setLoadingTerminalDevices(false);
    }
  }, []);

  const startManualInPersonCheckout = useCallback(async (params: {
    performanceId: string;
    seatIds: string[];
    ticketSelectionBySeatId: Record<string, string>;
    customerName: string;
    receiptEmail: string;
    sendReceipt: boolean;
    studentCode?: string;
  }): Promise<boolean> => {
    setManualCheckoutLoading(true);
    setManualCheckoutError(null);
    setManualCapturedPaymentIntentId(null);
    setInPersonFlowError(null);
    try {
      const intent = await adminFetch<ManualInPersonPaymentIntent>(
        '/api/admin/orders/in-person/manual-intent',
        {
          method: 'POST',
          body: JSON.stringify({
            performanceId: params.performanceId,
            seatIds: params.seatIds,
            ticketSelectionBySeatId: params.ticketSelectionBySeatId,
            customerName: params.customerName,
            receiptEmail: params.receiptEmail || undefined,
            sendReceipt: params.sendReceipt,
            studentCode: params.studentCode
          })
        }
      );

      const publishableKey = (intent.publishableKey || FALLBACK_STRIPE_PUBLISHABLE_KEY || '').trim();
      if (!publishableKey) {
        throw new Error('Stripe publishable key is not configured for manual checkout.');
      }

      setManualCheckout({
        performanceId: params.performanceId,
        seatIds: [...params.seatIds],
        ticketSelectionBySeatId: { ...params.ticketSelectionBySeatId },
        studentCode: params.studentCode,
        sendReceipt: params.sendReceipt,
        customerName: params.customerName,
        receiptEmail: params.receiptEmail,
        paymentIntentId: intent.paymentIntentId,
        clientSecret: intent.clientSecret,
        publishableKey,
        expectedAmountCents: intent.expectedAmountCents,
        currency: intent.currency
      });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'We could not start manual card checkout';
      setManualCheckoutError(message);
      setInPersonFlowError(message);
      return false;
    } finally {
      setManualCheckoutLoading(false);
    }
  }, []);

  async function finalizeManualCheckout(paymentIntentId: string) {
    if (!manualCheckout) {
      throw new Error('Manual checkout session is missing.');
    }

    setManualCheckoutCompleting(true);
    setManualCheckoutError(null);
    setInPersonFlowError(null);
    setManualCapturedPaymentIntentId(paymentIntentId);
    try {
      const result = await adminFetch<{
        success: boolean;
        id: string;
        expectedAmountCents: number;
        paymentMethod: 'STRIPE' | 'CASH';
        seats: InPersonFinalizeSeatSummary[];
        alreadyCompleted?: boolean;
      }>(
        '/api/admin/orders/in-person/manual-complete',
        {
          method: 'POST',
          body: JSON.stringify({
            performanceId: manualCheckout.performanceId,
            seatIds: manualCheckout.seatIds,
            ticketSelectionBySeatId: manualCheckout.ticketSelectionBySeatId,
            customerName: manualCheckout.customerName,
            receiptEmail: manualCheckout.receiptEmail || undefined,
            sendReceipt: manualCheckout.sendReceipt,
            studentCode: manualCheckout.studentCode,
            paymentIntentId
          })
        }
      );

      setManualCheckout(null);
      setManualCapturedPaymentIntentId(null);
      setSaleRecap({
        expectedAmountCents: result.expectedAmountCents,
        paymentMethod: result.paymentMethod,
        seats: result.seats,
        expiresAtMs: Date.now() + 10000
      });
      setAssignForm(prev => ({ ...prev, customerName: '', customerEmail: '', seatIdsInput: '', gaQuantityInput: '1', ticketType: '' }));
      setTicketSelectionBySeatId({});
      setNotice(
        `Stripe sale completed — ${result.seats.length} ${seatSelectionEnabled ? 'seat' : 'ticket'}${result.seats.length === 1 ? '' : 's'} · $${(result.expectedAmountCents / 100).toFixed(2)}`
      );
      startCashierLoop(manualCheckout.performanceId);
      void load();
      void loadSeatsForPerformance(manualCheckout.performanceId, { showLoading: false, syncSelection: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'We could not finalize successful manual charge.';
      setManualCheckoutError(message);
      setInPersonFlowError(message);
      throw err;
    } finally {
      setManualCheckoutCompleting(false);
    }
  }

  const closeManualCheckout = useCallback(() => {
    setManualCheckout(null);
    setManualCheckoutError(null);
    setManualCapturedPaymentIntentId(null);
    setManualCheckoutLoading(false);
    setManualCheckoutCompleting(false);
  }, []);

  const cancelManualSale = useCallback(() => {
    closeManualCheckout();
  }, [closeManualCheckout]);

  const finalizeInPersonSale = async () => {
    setError(null); setNotice(null); setInPersonFlowError(null);
    if (!assignForm.performanceId || selectionIds.length === 0) {
      setError(seatSelectionEnabled ? 'Choose a performance and provide at least one seat ID.' : 'Choose a performance and enter at least one GA ticket.');
      return;
    }
    if (selectedTicketOptions.length === 0) {
      setError('No ticket pricing tiers are configured for this performance.'); return;
    }
    if (missingTicketTypeCount > 0) {
      setError(`Choose a ticket type for every selected ${seatSelectionEnabled ? 'seat' : 'ticket'} before completing checkout.`); return;
    }
    if (hasMixedCompSelection) {
      setInPersonFlowError('Teacher and Student in Show complimentary tickets cannot be mixed in one order.'); return;
    }
    const normalizedStudentCode = studentCode.trim().toLowerCase().replace(/\s+/g, '');
    if (hasStudentInShowCompSelection && !normalizedStudentCode) {
      setInPersonFlowError('Student code is required when Student in Show tickets are selected.'); return;
    }
    const normalizedReceiptEmail = receiptEmail.trim().toLowerCase();
    if (sendReceipt && !normalizedReceiptEmail) {
      setInPersonFlowError('Enter an email address before sending a receipt.'); return;
    }

    const effectivePaymentMethod: 'STRIPE' | 'CASH' = isComplimentaryDoorCheckout ? 'CASH' : paymentMethod;
    if (effectivePaymentMethod === 'STRIPE') {
      if (stripeChargePath === 'MANUAL') {
        setInPersonSubmitting(true);
        try {
          await startManualInPersonCheckout({
            performanceId: assignForm.performanceId,
            seatIds: selectionIds,
            ticketSelectionBySeatId,
            customerName: assignForm.customerName.trim() || 'Walk-in Guest',
            receiptEmail: normalizedReceiptEmail,
            sendReceipt,
            studentCode: hasStudentInShowCompSelection ? normalizedStudentCode : undefined
          });
        } catch (e) {
          setInPersonFlowError(e instanceof Error ? e.message : 'We hit a small backstage snag while trying to start manual checkout');
        } finally {
          setInPersonSubmitting(false);
        }
        return;
      }

      if (!selectedTerminalDeviceId) {
        setInPersonFlowError('Select an active payment phone before starting terminal checkout.');
        return;
      }

      setInPersonSubmitting(true);
      try {
        const dispatch = await adminFetch<TerminalDispatch>('/api/admin/payment-line/enqueue', {
          method: 'POST',
          body: JSON.stringify({
            performanceId: assignForm.performanceId,
            seatIds: selectionIds,
            ticketSelectionBySeatId,
            receiptEmail: normalizedReceiptEmail || undefined,
            sendReceipt,
            customerName: assignForm.customerName.trim() || undefined,
            studentCode: hasStudentInShowCompSelection ? normalizedStudentCode : undefined,
            deviceId: selectedTerminalDeviceId
          })
        });
        setTerminalDispatch(dispatch);
      } catch (e) {
        setInPersonFlowError(e instanceof Error ? e.message : 'We hit a small backstage snag while trying to send sale to payment line');
      } finally {
        setInPersonSubmitting(false);
      }
      return;
    }

    setInPersonSubmitting(true);
    try {
      const result = await adminFetch<{
        expectedAmountCents: number;
        paymentMethod: 'STRIPE' | 'CASH';
        seats: InPersonFinalizeSeatSummary[];
      }>('/api/admin/orders/in-person/finalize', {
        method: 'POST',
        body: JSON.stringify({
          performanceId: assignForm.performanceId,
          seatIds: selectionIds,
          ticketSelectionBySeatId, paymentMethod: effectivePaymentMethod,
          receiptEmail: normalizedReceiptEmail || undefined,
          sendReceipt, customerName: assignForm.customerName.trim() || undefined,
          studentCode: hasStudentInShowCompSelection ? normalizedStudentCode : undefined
        })
      });
      setSaleRecap({
        expectedAmountCents: result.expectedAmountCents,
        paymentMethod: result.paymentMethod,
        seats: result.seats,
        expiresAtMs: Date.now() + 10000
      });
      setAssignForm(prev => ({ ...prev, customerName: '', customerEmail: '', seatIdsInput: '', gaQuantityInput: '1', ticketType: '' }));
      setTicketSelectionBySeatId({});
      setNotice(
          `${result.paymentMethod === 'CASH' ? 'Cash' : 'Stripe'} sale completed — ${selectionIds.length} ${seatSelectionEnabled ? 'seat' : 'ticket'}${selectionIds.length === 1 ? '' : 's'} · $${(result.expectedAmountCents / 100).toFixed(2)}`
      );
      startCashierLoop(assignForm.performanceId);
      void load();
    } catch (e) {
      setInPersonFlowError(e instanceof Error ? e.message : 'We hit a small backstage snag while trying to finalize in-person sale');
    } finally { setInPersonSubmitting(false); }
  };

  function finalizeSuccessfulTerminalDispatch(dispatch: TerminalDispatch) {
    const isGeneralAdmissionDispatch = dispatch.seats.every((seat) => seat.row === 'GA');
    setSaleRecap({
      expectedAmountCents: dispatch.expectedAmountCents,
      paymentMethod: 'STRIPE',
      seats: dispatch.seats,
      expiresAtMs: Date.now() + 10000
    });
    setAssignForm(prev => ({ ...prev, customerName: '', customerEmail: '', seatIdsInput: '', gaQuantityInput: '1', ticketType: '' }));
    setTicketSelectionBySeatId({});
    setNotice(
      `Stripe sale completed — ${dispatch.seatCount} ${isGeneralAdmissionDispatch ? 'ticket' : 'seat'}${dispatch.seatCount === 1 ? '' : 's'} · $${(dispatch.expectedAmountCents / 100).toFixed(2)}`
    );
    setTerminalDispatch(null);
    startCashierLoop(assignForm.performanceId);
    void load();
    void loadSeatsForPerformance(assignForm.performanceId, { showLoading: false, syncSelection: false });
  }

  const applyTerminalDispatchStatus = useCallback((dispatch: TerminalDispatch) => {
    setTerminalDispatch((previous) => {
      if (!previous || previous.dispatchId !== dispatch.dispatchId) return dispatch;
      if (
        previous.status === dispatch.status &&
        previous.failureReason === dispatch.failureReason &&
        previous.holdExpiresAt === dispatch.holdExpiresAt &&
        previous.holdActive === dispatch.holdActive &&
        previous.canRetry === dispatch.canRetry &&
        previous.attemptCount === dispatch.attemptCount &&
        previous.finalOrderId === dispatch.finalOrderId
      ) {
        return previous;
      }
      return dispatch;
    });
  }, []);

  const refreshTerminalDispatchStatus = useCallback(async (dispatchId: string, force = false) => {
    if (!dispatchId) return;
    if (terminalDispatchRefreshInFlightRef.current) return;
    const now = Date.now();
    const isSameDispatch = terminalDispatchRefreshLastIdRef.current === dispatchId;
    if (!force && isSameDispatch && now - terminalDispatchRefreshLastAtRef.current < TERMINAL_DISPATCH_REFRESH_MIN_INTERVAL_MS) {
      return;
    }
    terminalDispatchRefreshInFlightRef.current = true;
    terminalDispatchRefreshLastAtRef.current = now;
    terminalDispatchRefreshLastIdRef.current = dispatchId;
    try {
      const dispatch = await adminFetch<TerminalDispatch>(`/api/admin/payment-line/entry/${encodeURIComponent(dispatchId)}`);
      applyTerminalDispatchStatus(dispatch);
    } finally {
      terminalDispatchRefreshInFlightRef.current = false;
    }
  }, [applyTerminalDispatchStatus]);

  const retryTerminalDispatch = useCallback(async () => {
    if (!terminalDispatch) return;
    setTerminalDispatchActionBusy(true);
    setInPersonFlowError(null);
    try {
      const dispatch = await adminFetch<TerminalDispatch>(
        `/api/admin/payment-line/entry/${encodeURIComponent(terminalDispatch.dispatchId)}/retry-now`,
        { method: 'POST' }
      );
      applyTerminalDispatchStatus(dispatch);
    } catch (e) {
      setInPersonFlowError(e instanceof Error ? e.message : 'Retry failed');
      await refreshTerminalDispatchStatus(terminalDispatch.dispatchId, true).catch(() => undefined);
    } finally {
      setTerminalDispatchActionBusy(false);
    }
  }, [applyTerminalDispatchStatus, refreshTerminalDispatchStatus, terminalDispatch]);

  const cancelTerminalDispatch = useCallback(async () => {
    if (!terminalDispatch) return;
    setTerminalDispatchActionBusy(true);
    try {
      const dispatch = await adminFetch<TerminalDispatch>(
        `/api/admin/payment-line/entry/${encodeURIComponent(terminalDispatch.dispatchId)}/cancel`,
        { method: 'POST' }
      );
      setTerminalDispatch(dispatch.status === 'CANCELED' ? null : dispatch);
    } catch (e) {
      setInPersonFlowError(e instanceof Error ? e.message : 'Cancel failed');
    } finally {
      setTerminalDispatchActionBusy(false);
    }
  }, [terminalDispatch]);

  // ── wizard nav ─────────────────────────────────────────────────────────────

  const goTo = (next: number) => { setDir(next > step ? 1 : -1); setStep(next); setError(null); };

  const resetInPersonFlow = () => {
    setInPersonFlowError(null); setInPersonSubmitting(false);
    setPaymentMethod('STRIPE'); setStripeChargePath('TERMINAL'); setReceiptEmail(''); setSendReceipt(false);
    setStudentCode('');
    setTerminalDevices([]);
    setLoadingTerminalDevices(false);
    setSelectedTerminalDeviceId('');
    setTerminalDispatch(null);
    setTerminalDispatchActionBusy(false);
    setManualCheckout(null);
    setManualCheckoutError(null);
    setManualCheckoutLoading(false);
    setManualCheckoutCompleting(false);
    setManualCapturedPaymentIntentId(null);
    setCashTonight(null); setLoadingCashTonight(false);
  };

  function closeWizard() {
    setShowWizard(false); setStep(0); setError(null);
    setSeatPickerOpen(false); setSeatPickerError(null);
    setTicketSelectionBySeatId({}); resetInPersonFlow();
  }

  function startCashierLoop(performanceId: string, prefill?: CashierDeepLinkPrefill) {
    if (!performanceId) {
      setError('No active performances available for cashier checkout.');
      return;
    }

    writeCashierDefaultPerformanceId(performanceId);
    didAutoOpenSeatPickerRef.current = false;
    setAssignForm((prev) => ({
      ...prev,
      performanceId,
      customerName: prefill?.customerName || '',
      customerEmail: prefill?.customerEmail || '',
      seatIdsInput: '',
      gaQuantityInput: '1',
      ticketType: '',
      sendEmail: false
    }));
    setTicketSelectionBySeatId({});
    resetInPersonFlow();
    setShowCashierPerformancePicker(false);
    setSeatPickerError(null);
    setSeatPickerOpen(false);
    setShowWizard(true);
    setDir(1);
    setStep(prefill ? 1 : 0);
    setError(null);
    if (prefill?.sourceOrderId) {
      setNotice(`Loaded cashier prefill from fundraiser order ${prefill.sourceOrderId.slice(0, 10)}.`);
    }
    void loadSeatsForPerformance(performanceId, { showLoading: false, syncSelection: false });
  }

  const openCashierFlow = () => {
    if (performances.length === 0) {
      setError('No active performances available for cashier checkout.');
      return;
    }
    const fallbackPerformanceId = performances[0]?.id || '';
    const nextDraftId =
      performances.some((item) => item.id === assignForm.performanceId)
        ? assignForm.performanceId
        : performances.some((item) => item.id === readCashierDefaultPerformanceId())
          ? readCashierDefaultPerformanceId()
          : fallbackPerformanceId;
    setCashierPerformanceDraftId(nextDraftId);
    if (nextDraftId) {
      startCashierLoop(nextDraftId);
      return;
    }
    setShowCashierPerformancePicker(true);
    setError(null);
  };

  const confirmCashierPerformanceSelection = () => {
    const chosenPerformanceId =
      performances.some((item) => item.id === cashierPerformanceDraftId)
        ? cashierPerformanceDraftId
        : performances[0]?.id || '';
    if (!chosenPerformanceId) {
      setError('No active performances available for cashier checkout.');
      setShowCashierPerformancePicker(false);
      return;
    }

    startCashierLoop(chosenPerformanceId);
  };

  useEffect(() => {
    if (performances.length === 0) return;
    if (!location.search) return;
    if (cashierDeepLinkConsumedRef.current === location.search) return;

    const params = new URLSearchParams(location.search);
    if (params.get('cashier') !== '1') return;

    const requestedPerformanceId = params.get('performanceId') || '';
    const chosenPerformanceId = performances.some((item) => item.id === requestedPerformanceId)
      ? requestedPerformanceId
      : performances.some((item) => item.id === readCashierDefaultPerformanceId())
        ? readCashierDefaultPerformanceId()
        : performances[0]?.id || '';

    if (!chosenPerformanceId) return;

    const customerName = (params.get('customerName') || '').trim();
    const customerEmail = (params.get('customerEmail') || '').trim().toLowerCase();
    const sourceOrderId = (params.get('sourceOrderId') || '').trim();

    cashierDeepLinkConsumedRef.current = location.search;
    startCashierLoop(chosenPerformanceId, {
      customerName: customerName || undefined,
      customerEmail: customerEmail || undefined,
      sourceOrderId: sourceOrderId || undefined
    });

    navigate('/admin/orders', { replace: true });
  }, [location.search, navigate, performances]);

  useEffect(() => {
    if (!saleRecap) {
      setSaleRecapSecondsLeft(0);
      return;
    }

    const updateCountdown = () => {
      const secondsLeft = Math.max(0, Math.ceil((saleRecap.expiresAtMs - Date.now()) / 1000));
      setSaleRecapSecondsLeft(secondsLeft);
      if (secondsLeft <= 0) {
        setSaleRecap(null);
      }
    };

    updateCountdown();
    const timerId = window.setInterval(updateCountdown, 250);
    return () => window.clearInterval(timerId);
  }, [saleRecap]);

  const handleWizardNext = () => {
    if (step === 0) { goTo(1); return; }
    if (step === 1) {
      if (selectionIds.length === 0) {
        setError(seatSelectionEnabled ? 'Select at least one seat to continue.' : 'Enter at least one GA ticket to continue.');
        if (seatSelectionEnabled) setSeatPickerOpen(true);
        return;
      }
      goTo(2); return;
    }
    goTo(step + 1);
  };

  const moveOnFromSeatPicker = () => {
    if (step === 1) {
      if (seatIds.length === 0) { setSeatPickerError('Select at least one seat before moving on.'); return; }
      setSeatPickerOpen(false); goTo(2); return;
    }
    setSeatPickerOpen(false);
  };

  // ── seat loading ───────────────────────────────────────────────────────────

  const loadSeatsForPerformance = useCallback(async (
    performanceId: string,
    options?: { showLoading?: boolean; syncSelection?: boolean }
  ) => {
    if (!performanceId) return;
    const showLoading = options?.showLoading ?? true;
    const syncSelection = options?.syncSelection ?? true;
    if (showLoading) setLoadingSeats(true);
    try {
      let nextSeats: Seat[] = [];
      try {
        const adminSeats = await adminFetch<any[]>(`/api/admin/performances/${performanceId}/seats`);
        nextSeats = adminSeats.map(normalizeSeat);
      } catch (e) {
        if (!(e instanceof Error && e.message.toLowerCase().includes('not found'))) throw e;
        const publicSeats = await apiFetch<any[] | { seats: any[] }>(`/api/performances/${performanceId}/seats`);
        const seatList = Array.isArray(publicSeats) ? publicSeats : publicSeats.seats;
        nextSeats = seatList.map(normalizeSeat);
      }

      setSeats(nextSeats);
      setSeatPickerError(null);

      const currentSeatIds = selectedSeatIdsRef.current;
      if (syncSelection && currentSeatIds.length > 0) {
        const unavailableSeatIds = new Set(
          nextSeats
            .filter((seat) => seat.status !== 'available')
            .map((seat) => seat.id)
        );
        const removedSeatIds = currentSeatIds.filter((seatId) => unavailableSeatIds.has(seatId));

        if (removedSeatIds.length > 0) {
          setAssignForm((prev) => ({
            ...prev,
            seatIdsInput: parseSeatIds(prev.seatIdsInput)
              .filter((seatId) => !unavailableSeatIds.has(seatId))
              .join(', ')
          }));
          setTicketSelectionBySeatId((prev) => {
            const next = { ...prev };
            removedSeatIds.forEach((seatId) => {
              delete next[seatId];
            });
            return next;
          });
          setError(
            removedSeatIds.length === 1
              ? 'A selected seat is no longer available. The seating chart was refreshed.'
              : `${removedSeatIds.length} selected seats are no longer available. The seating chart was refreshed.`
          );
        }
      }
    } catch (e) {
      setSeatPickerError(e instanceof Error ? e.message : 'We hit a small backstage snag while trying to load seats');
    } finally {
      if (showLoading) setLoadingSeats(false);
    }
  }, []);

  // ── derived state ──────────────────────────────────────────────────────────

  const seatIds = useMemo(() => parseSeatIds(assignForm.seatIdsInput), [assignForm.seatIdsInput]);
  const gaTicketQuantity = useMemo(() => {
    const parsed = Number.parseInt(assignForm.gaQuantityInput, 10);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.min(parsed, 50));
  }, [assignForm.gaQuantityInput]);
  const selectedPerformance = performances.find(p => p.id === assignForm.performanceId);
  const seatSelectionEnabled = selectedPerformance?.seatSelectionEnabled !== false;
  const selectionIds = useMemo(
    () => (seatSelectionEnabled ? seatIds : buildGeneralAdmissionLineIds(gaTicketQuantity)),
    [gaTicketQuantity, seatIds, seatSelectionEnabled]
  );

  useEffect(() => {
    selectedSeatIdsRef.current = seatIds;
  }, [seatIds]);

  useEffect(() => {
    if (!showWizard || step !== 1 || !seatSelectionEnabled) setSeatPickerOpen(false);
  }, [seatSelectionEnabled, showWizard, step]);

  useEffect(() => {
    if (!showWizard || step !== 1 || !seatSelectionEnabled) { didAutoOpenSeatPickerRef.current = false; return; }
    if (didAutoOpenSeatPickerRef.current || seatPickerOpen || seatIds.length > 0) return;
    didAutoOpenSeatPickerRef.current = true;
    setSeatPickerOpen(true);
  }, [seatIds.length, seatPickerOpen, seatSelectionEnabled, showWizard, step]);

  useEffect(() => { setActiveSection('All'); setSeatPickerError(null); setSeats([]); }, [assignForm.performanceId]);
  useEffect(() => {
    if (!seatSelectionEnabled || !seatPickerOpen || !assignForm.performanceId) return;
    void loadSeatsForPerformance(assignForm.performanceId);
  }, [assignForm.performanceId, loadSeatsForPerformance, seatPickerOpen, seatSelectionEnabled]);
  useEffect(() => {
    if (!showWizard || assignForm.source !== 'DOOR') { setCashTonight(null); setLoadingCashTonight(false); return; }
    void loadCashTonight(assignForm.performanceId);
  }, [assignForm.performanceId, assignForm.source, loadCashTonight, showWizard]);
  useEffect(() => {
    if (
      !showWizard ||
      assignForm.source !== 'DOOR' ||
      paymentMethod !== 'STRIPE' ||
      stripeChargePath !== 'TERMINAL' ||
      step !== 2
    ) {
      return;
    }
    void loadTerminalDevices();
  }, [assignForm.source, loadTerminalDevices, paymentMethod, showWizard, step, stripeChargePath]);

  useEffect(() => {
    if (!terminalDispatch?.dispatchId || !terminalDispatch.status || !sellerStatusStream.snapshot) {
      return;
    }

    const nextEntry = sellerStatusStream.snapshot.entries.find((entry) => entry.entryId === terminalDispatch.dispatchId);
    if (!nextEntry) {
      if (!sellerStatusStream.connected || isTerminalDispatchFinalStatus(terminalDispatch.status)) {
        return;
      }
      void refreshTerminalDispatchStatus(terminalDispatch.dispatchId).catch(() => undefined);
      return;
    }

    applyTerminalDispatchStatus(mapEntryToTerminalDispatch(nextEntry));
  }, [
    applyTerminalDispatchStatus,
    refreshTerminalDispatchStatus,
    sellerStatusStream.connected,
    sellerStatusStream.snapshot,
    terminalDispatch?.dispatchId,
    terminalDispatch?.status
  ]);

  useEffect(() => {
    if (!terminalDispatch?.dispatchId || !terminalDispatch.status || sellerStatusStream.connected) {
      return;
    }

    if (isTerminalDispatchFinalStatus(terminalDispatch.status)) {
      return;
    }

    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      await refreshTerminalDispatchStatus(terminalDispatch.dispatchId).catch(() => undefined);
    };

    void poll();
    const timerId = window.setInterval(() => {
      void poll();
    }, TERMINAL_DISPATCH_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timerId);
    };
  }, [refreshTerminalDispatchStatus, sellerStatusStream.connected, terminalDispatch?.dispatchId, terminalDispatch?.status]);

  useEffect(() => {
    if (!showWizard || step === 0 || terminalDispatch || !assignForm.performanceId || !seatSelectionEnabled) {
      return;
    }

    const timerId = window.setInterval(() => {
      void loadSeatsForPerformance(assignForm.performanceId, {
        showLoading: false,
        syncSelection: true
      }).catch(() => undefined);
    }, 5000);

    return () => window.clearInterval(timerId);
  }, [assignForm.performanceId, loadSeatsForPerformance, seatSelectionEnabled, showWizard, step, terminalDispatch]);

  const selectedSeatIdSet = useMemo(() => new Set(seatIds), [seatIds]);

  const updateSelectedSeatIds = useCallback((updater: (current: string[]) => string[]) => {
    setAssignForm(prev => {
      const current = parseSeatIds(prev.seatIdsInput);
      const next = [...new Set(updater(current))];
      return { ...prev, seatIdsInput: next.join(', ') };
    });
  }, []);

  const toggleSeat = useCallback((id: string) => {
    updateSelectedSeatIds(current =>
      current.includes(id) ? current.filter(s => s !== id) : [...current, id]
    );
  }, [updateSelectedSeatIds]);

  const sections = useMemo(() => [...new Set(seats.map(s => s.sectionName))].sort(naturalSort), [seats]);
  useEffect(() => { if (activeSection !== 'All' && !sections.includes(activeSection)) setActiveSection('All'); }, [activeSection, sections]);

  const visibleSeats = useMemo(
    () => seats.filter(s => activeSection === 'All' || s.sectionName === activeSection),
    [activeSection, seats]
  );

  const seatById = useMemo(() => new Map(seats.map(s => [s.id, s])), [seats]);
  const hasAccessibleSelection = useMemo(() => seatIds.some(id => Boolean(seatById.get(id)?.isAccessible)), [seatById, seatIds]);

  const selectedMappedSeats = useMemo(
    () => seatIds.map(id => seatById.get(id)).filter((s): s is Seat => Boolean(s))
      .sort((a, b) => naturalSort(a.sectionName, b.sectionName) || naturalSort(a.row, b.row) || a.number - b.number),
    [seatById, seatIds]
  );

  const selectedUnknownSeatIds = useMemo(() => seatIds.filter(id => !seatById.has(id)), [seatById, seatIds]);

  const selectedTerminalDevice = useMemo(
    () => terminalDevices.find((device) => device.deviceId === selectedTerminalDeviceId) || null,
    [selectedTerminalDeviceId, terminalDevices]
  );
  const dispatchInlineStatus = useMemo<{
    title: string;
    detail: string;
    tone: 'danger' | 'success' | 'neutral';
  }>(() => {
    const streamEntry = sellerStatusStream.sellerPayload.sellerEntry;
    // Only trust seller stream-derived status when the stream is currently connected.
    // When disconnected, the stream payload can be stale and must not override polled dispatch status.
    if (sellerStatusStream.connected && streamEntry) {
      if (streamEntry.uiState === 'WAITING_FOR_PAYMENT') {
        const ahead = streamEntry.position && streamEntry.position > 0 ? streamEntry.position - 1 : null;
        return {
          title: 'Not your turn',
          detail: ahead === null ? 'Phone is currently in use. Stay in line.' : `${ahead} ahead. Phone is currently in use.`,
          tone: 'danger'
        };
      }
      if (streamEntry.uiState === 'ACTIVE_PAYMENT') {
        return { title: 'Ready to pay', detail: 'Phone is ready now. Indicate to pay.', tone: 'success' };
      }
      if (streamEntry.uiState === 'PAYMENT_SUCCESS') {
        return { title: 'Payment approved', detail: 'Checkout completed successfully.', tone: 'success' };
      }
      if (streamEntry.uiState === 'PAYMENT_FAILED') {
        return { title: 'Payment failed', detail: streamEntry.failureReason || 'Terminal payment failed.', tone: 'danger' };
      }
      if (streamEntry.uiState === 'CANCELED') {
        return { title: 'Canceled', detail: 'This sale was canceled before payment completed.', tone: 'neutral' };
      }
    }

    if (!terminalDispatch) {
      return { title: 'Dispatch pending', detail: 'Waiting for terminal confirmation.', tone: 'neutral' };
    }

    if (terminalDispatch.status === 'PENDING' || terminalDispatch.status === 'DELIVERED') {
      return { title: 'Not your turn', detail: 'Sent to terminal. Waiting for phone availability.', tone: 'danger' };
    }
    if (terminalDispatch.status === 'PROCESSING') {
      return { title: 'Ready to pay', detail: 'Phone is collecting payment now. Indicate to pay.', tone: 'success' };
    }
    if (terminalDispatch.status === 'SUCCEEDED') {
      return { title: 'Payment approved', detail: 'Checkout completed successfully.', tone: 'success' };
    }
    if (terminalDispatch.status === 'FAILED') {
      return { title: 'Payment failed', detail: terminalDispatch.failureReason || 'Terminal payment failed.', tone: 'danger' };
    }
    if (terminalDispatch.status === 'EXPIRED') {
      return { title: 'Dispatch expired', detail: 'Payment window expired before completion.', tone: 'danger' };
    }
    return { title: 'Dispatch canceled', detail: 'This sale was canceled before payment completed.', tone: 'neutral' };
  }, [sellerStatusStream.connected, sellerStatusStream.sellerPayload.sellerEntry, terminalDispatch]);
  const dispatchInlineStatusClasses = useMemo(() => {
    if (dispatchInlineStatus.tone === 'success') {
      return {
        container: 'border-emerald-300 bg-emerald-50',
        kicker: 'text-emerald-700',
        title: 'text-emerald-900',
        detail: 'text-emerald-800'
      };
    }
    if (dispatchInlineStatus.tone === 'danger') {
      return {
        container: 'border-red-300 bg-red-50',
        kicker: 'text-red-700',
        title: 'text-red-900',
        detail: 'text-red-800'
      };
    }
    return {
      container: 'border-slate-200 bg-slate-50',
      kicker: 'text-slate-500',
      title: 'text-slate-900',
      detail: 'text-slate-600'
    };
  }, [dispatchInlineStatus.tone]);
  const selectedTicketOptions = useMemo<CashierTicketOption[]>(() => {
    if (!selectedPerformance) return [];
    if (selectedPerformance.pricingTiers.length === 0) return [];
    const options: CashierTicketOption[] = selectedPerformance.pricingTiers
      .filter((tier) => !selectedPerformance.isFundraiser || !(tier.id === TEACHER_TICKET_OPTION_ID || isTeacherTicketName(tier.name)))
      .map((tier) => ({
        id: tier.id,
        name: tier.name,
        priceCents: tier.priceCents,
      }));

    const hasTeacherOption = options.some((option) => option.id === TEACHER_TICKET_OPTION_ID || isTeacherTicketName(option.name));
    if (!selectedPerformance.isFundraiser && selectedPerformance.staffCompsEnabled && !hasTeacherOption) {
      options.push({
        id: TEACHER_TICKET_OPTION_ID,
        name: 'RTMSD STAFF',
        priceCents: 0,
        isSynthetic: true,
      });
    }

    const hasStudentOption = options.some((option) => option.id === STUDENT_SHOW_TICKET_OPTION_ID || isStudentInShowTicketName(option.name));
    if (selectedPerformance.studentCompTicketsEnabled && !hasStudentOption) {
      options.push({
        id: STUDENT_SHOW_TICKET_OPTION_ID,
        name: 'Student in Show',
        priceCents: 0,
        isSynthetic: true,
      });
    }

    return options;
  }, [selectedPerformance]);
  const primaryTicketTier = selectedTicketOptions[0] || null;
  const primaryStandardTicketTier = useMemo(
    () => selectedTicketOptions.find((option) => !option.isSynthetic) || primaryTicketTier,
    [primaryTicketTier, selectedTicketOptions]
  );

  useEffect(() => {
    if (selectionIds.length === 0) { setTicketSelectionBySeatId({}); return; }
    const defaultTierId = selectedTicketOptions[0]?.id || '';
    setTicketSelectionBySeatId(prev => {
      const next: Record<string, string> = {};
      selectionIds.forEach(seatId => {
        const cur = prev[seatId];
        const valid = Boolean(cur && selectedTicketOptions.some(t => t.id === cur));
        if (valid) { next[seatId] = cur; return; }
        if (defaultTierId) next[seatId] = defaultTierId;
      });
      return next;
    });
  }, [selectionIds, selectedTicketOptions]);

  const missingTicketTypeCount = useMemo(
    () => selectionIds.filter(id => !ticketSelectionBySeatId[id]).length,
    [selectionIds, ticketSelectionBySeatId]
  );

  const selectedLines = useMemo<CashierSelectionLine[]>(() => {
    if (seatSelectionEnabled) {
      return selectedMappedSeats.map((seat) => ({
        id: seat.id,
        label: `${seat.sectionName} · Row ${seat.row} · #${seat.number}`,
        sectionName: seat.sectionName,
        row: seat.row,
        number: seat.number,
        seatPriceCents: Math.max(0, seat.price)
      }));
    }
    return selectionIds.map((lineId, index) => ({
      id: lineId,
      label: `General Admission Ticket ${index + 1}`,
      sectionName: 'General Admission',
      row: 'GA',
      number: index + 1,
      seatPriceCents: Math.max(0, primaryStandardTicketTier?.priceCents || 0)
    }));
  }, [primaryStandardTicketTier, seatSelectionEnabled, selectedMappedSeats, selectionIds]);

  const selectedSeatsWithTier = useMemo(
    () => selectedLines.map((line) => ({
      line,
      tier: selectedTicketOptions.find(t => t.id === ticketSelectionBySeatId[line.id]) || null
    })),
    [selectedLines, selectedTicketOptions, ticketSelectionBySeatId]
  );

  const teacherSelectedSeatIds = useMemo(
    () =>
      selectedSeatsWithTier
        .filter((item) => item.tier && (item.tier.id === TEACHER_TICKET_OPTION_ID || isTeacherTicketName(item.tier.name)))
        .map((item) => item.line.id),
    [selectedSeatsWithTier]
  );
  const studentInShowSelectedSeatIds = useMemo(
    () =>
      selectedSeatsWithTier
        .filter((item) => item.tier && (item.tier.id === STUDENT_SHOW_TICKET_OPTION_ID || isStudentInShowTicketName(item.tier.name)))
        .map((item) => item.line.id),
    [selectedSeatsWithTier]
  );
  const hasTeacherCompSelection = teacherSelectedSeatIds.length > 0;
  const hasStudentInShowCompSelection = studentInShowSelectedSeatIds.length > 0;
  const hasMixedCompSelection = hasTeacherCompSelection && hasStudentInShowCompSelection;

  const selectedSeatsWithPricing = useMemo(() => {
    let priced = selectedSeatsWithTier.map((item) => {
      const isTeacherTicket = Boolean(item.tier && (item.tier.id === TEACHER_TICKET_OPTION_ID || isTeacherTicketName(item.tier.name)));
      const isStudentTicket = Boolean(item.tier && (item.tier.id === STUDENT_SHOW_TICKET_OPTION_ID || isStudentInShowTicketName(item.tier.name)));
      const basePriceCents = item.tier
        ? Math.max(0, item.tier.isSynthetic ? item.line.seatPriceCents : item.tier.priceCents)
        : 0;
      return {
        line: item.line,
        tier: item.tier,
        basePriceCents,
        finalPriceCents: basePriceCents,
        lineLabel: item.tier?.name || 'Unassigned',
        isTeacherTicket,
        isStudentTicket,
      };
    });

    if (hasTeacherCompSelection && !hasStudentInShowCompSelection) {
      const teacherSeats = priced.filter((item) => item.isTeacherTicket);
      const complimentarySeatIds = pickComplimentarySeatIds(
        teacherSeats.map((item) => ({
          id: item.line.id,
          sectionName: item.line.sectionName,
          row: item.line.row,
          number: item.line.number,
          basePriceCents: item.basePriceCents
        })),
        Math.min(MAX_TEACHER_COMP_TICKETS, teacherSeats.length)
      );
      priced = priced.map((item) =>
        item.isTeacherTicket && complimentarySeatIds.has(item.line.id)
          ? { ...item, finalPriceCents: 0, lineLabel: 'Teacher Comp' }
          : item
      );
    }

    if (hasStudentInShowCompSelection && !hasTeacherCompSelection) {
      const studentSeats = priced.filter((item) => item.isStudentTicket);
      const complimentarySeatIds = pickComplimentarySeatIds(
        studentSeats.map((item) => ({
          id: item.line.id,
          sectionName: item.line.sectionName,
          row: item.line.row,
          number: item.line.number,
          basePriceCents: item.basePriceCents
        })),
        Math.min(MAX_STUDENT_COMP_TICKETS, studentSeats.length)
      );
      priced = priced.map((item) =>
        item.isStudentTicket && complimentarySeatIds.has(item.line.id)
          ? { ...item, finalPriceCents: 0, lineLabel: 'Student Comp' }
          : item
      );
    }

    return priced;
  }, [hasStudentInShowCompSelection, hasTeacherCompSelection, selectedSeatsWithTier]);

  const selectedTierSubtotalCents = useMemo(
    () => selectedSeatsWithPricing.reduce((sum, item) => sum + item.finalPriceCents, 0),
    [selectedSeatsWithPricing]
  );

  const isComplimentaryDoorCheckout = assignForm.source === 'DOOR' && selectedTierSubtotalCents === 0;

  const selectedTierBreakdown = useMemo(() => {
    const counts = new Map<string, { name: string; priceCents: number; count: number }>();
    selectedSeatsWithPricing.forEach(item => {
      const key = `${item.lineLabel}:${item.finalPriceCents}`;
      const ex = counts.get(key);
      if (ex) { ex.count += 1; return; }
      counts.set(key, { name: item.lineLabel, priceCents: item.finalPriceCents, count: 1 });
    });
    return [...counts.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
  }, [selectedSeatsWithPricing]);

  const formatTicketOptionLabel = useCallback((tier: CashierTicketOption) => {
    if (tier.id === TEACHER_TICKET_OPTION_ID || isTeacherTicketName(tier.name)) {
      return `${tier.name} · first ${MAX_TEACHER_COMP_TICKETS} free`;
    }
    if (tier.id === STUDENT_SHOW_TICKET_OPTION_ID || isStudentInShowTicketName(tier.name)) {
      return `${tier.name} · first ${MAX_STUDENT_COMP_TICKETS} free`;
    }
    return `${tier.name} · $${(tier.priceCents / 100).toFixed(2)}`;
  }, []);

  // ── wizard step content ────────────────────────────────────────────────────

  const wizardSteps = [

    /* ── STEP 0: Performance ── */
    <div key="show" className="space-y-5">
      <div>
        <FieldLabel>Performance</FieldLabel>
        <select
          value={assignForm.performanceId}
          onChange={e => {
            const nextPerformanceId = e.target.value;
            setAssignForm({ ...assignForm, performanceId: nextPerformanceId });
            writeCashierDefaultPerformanceId(nextPerformanceId);
          }}
          className={baseSelect}
        >
          {performances.map(p => (
            <option key={p.id} value={p.id}>
              {p.title}
              {p.isFundraiser ? ' [Fundraiser]' : ''}
              {' — '}
              {new Date(p.startsAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </option>
          ))}
        </select>
      </div>

      <div>
        <FieldLabel>Order type</FieldLabel>
        <div className="grid grid-cols-2 gap-3">
          {(['DOOR', 'COMP'] as const).map(src => (
            <button
              key={src}
              type="button"
              onClick={() => setAssignForm({ ...assignForm, source: src })}
              className={`group relative overflow-hidden rounded-2xl border-2 px-5 py-4 text-left transition-all ${
                assignForm.source === src
                  ? 'border-rose-600 bg-rose-50'
                  : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <div className={`mb-1 text-sm font-bold ${assignForm.source === src ? 'text-rose-700' : 'text-slate-700'}`}>
                {src === 'DOOR' ? 'Door Sale' : 'Comp'}
              </div>
              <div className={`text-xs ${assignForm.source === src ? 'text-rose-500' : 'text-slate-400'}`}>
                {src === 'DOOR' ? 'Paid in-person checkout' : 'Complimentary ticket'}
              </div>
              {assignForm.source === src && (
                <div className="absolute right-3 top-3">
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-rose-600">
                    <Check className="h-3 w-3 text-white" />
                  </div>
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {selectedTicketOptions.length > 0 ? (
        <Card className="p-4">
          <FieldLabel>Pricing tiers</FieldLabel>
          <div className="flex flex-wrap gap-2 mt-2">
            {selectedTicketOptions.map(option => (
              <span key={option.id} className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700">
                {formatTicketOptionLabel(option)}
              </span>
            ))}
          </div>
        </Card>
      ) : (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
          No pricing tiers found. Add pricing tiers in Performances before cashier checkout.
        </div>
      )}
    </div>,

    /* ── STEP 1: Seats ── */
    <div key="seats" className="space-y-4">
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <FieldLabel>{seatSelectionEnabled ? 'Selected seats' : 'Ticket quantity'}</FieldLabel>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                if (!assignForm.performanceId) { setError('Choose a performance first.'); return; }
                setSeatPickerOpen(true); setSeatPickerError(null);
              }}
              disabled={!seatSelectionEnabled}
              className="inline-flex items-center gap-1.5 rounded-full bg-rose-600 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-rose-700"
            >
              <MapPin className="h-3.5 w-3.5" /> Open seat map
            </button>
            {seatSelectionEnabled && seatIds.length > 0 && (
              <button
                type="button"
                onClick={() => setAssignForm({ ...assignForm, seatIdsInput: '' })}
                className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-slate-50"
              >
                <X className="h-3.5 w-3.5" /> Clear all
              </button>
            )}
          </div>
        </div>
        {seatSelectionEnabled ? (
          <input
            value={assignForm.seatIdsInput}
            onChange={e => setAssignForm({ ...assignForm, seatIdsInput: e.target.value })}
            placeholder="Paste seat IDs: A1, A2, B3…"
            className={baseInput}
          />
        ) : (
          <input
            type="number"
            min={1}
            max={50}
            value={assignForm.gaQuantityInput}
            onChange={e => setAssignForm({ ...assignForm, gaQuantityInput: e.target.value.replace(/[^\d]/g, '') })}
            placeholder="Enter ticket quantity"
            className={baseInput}
          />
        )}
        {seatSelectionEnabled && seatIds.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {seatIds.map(id => (
              <button
                key={id}
                type="button"
                onClick={() => toggleSeat(id)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-sans font-semibold text-slate-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
              >
                {id} <X className="h-3 w-3" />
              </button>
            ))}
          </div>
        )}
      </div>

      <Card>
        {[
          { label: 'Performance', value: selectedPerformance?.title ?? '—' },
          { label: 'Type', value: assignForm.source === 'DOOR' ? 'Door Sale' : 'Comp' },
          {
            label: seatSelectionEnabled ? 'Seats selected' : 'Tickets selected',
            value: selectionIds.length > 0
              ? <span className="font-bold text-slate-900">{selectionIds.length} {seatSelectionEnabled ? 'seat' : 'ticket'}{selectionIds.length !== 1 ? 's' : ''}</span>
              : <span className="font-semibold text-amber-600">{seatSelectionEnabled ? 'None selected' : 'No tickets entered'}</span>
          },
        ].map(({ label, value }, i, arr) => (
          <div key={label} className={`flex items-center justify-between px-5 py-3.5 text-sm ${i < arr.length - 1 ? 'border-b border-slate-100' : ''}`}>
            <span className="text-slate-400">{label}</span>
            <span className="text-right font-semibold text-slate-700">{value}</span>
          </div>
        ))}
      </Card>
    </div>,

    /* ── STEP 2: Checkout ── */
    <div key="tickets" className="space-y-5">
      {!selectionIds.length ? (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
          {seatSelectionEnabled ? 'Go back and select at least one seat.' : 'Go back and enter at least one GA ticket.'}
        </div>
      ) : selectedTicketOptions.length === 0 ? (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
          No pricing tiers configured for this performance.
        </div>
      ) : (
        <>
          {/* Quick apply */}
          <div>
            <FieldLabel>Quick-apply to all {seatSelectionEnabled ? 'seats' : 'tickets'}</FieldLabel>
            <div className="flex flex-wrap gap-2">
              {selectedTicketOptions.map(tier => (
                <button
                  key={tier.id}
                  type="button"
                  onClick={() => {
                    setTicketSelectionBySeatId(prev => {
                      const next = { ...prev };
                      selectionIds.forEach(id => { next[id] = tier.id; });
                      return next;
                    });
                  }}
                  className={`rounded-xl border-2 px-4 py-2 text-sm font-semibold transition ${
                    tier.id === primaryTicketTier?.id
                      ? 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {formatTicketOptionLabel(tier)}
                </button>
              ))}
            </div>
          </div>

          {/* Per-seat type selection */}
          <Card className="divide-y divide-slate-100 overflow-hidden">
            {selectedLines.map(line => (
              <div key={line.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-800">
                    {line.label}
                  </p>
                  <p className="text-xs font-sans text-slate-400">{line.id}</p>
                </div>
                <select
                  value={ticketSelectionBySeatId[line.id] || ''}
                  onChange={e => setTicketSelectionBySeatId(prev => ({ ...prev, [line.id]: e.target.value }))}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition focus:border-rose-400 focus:outline-none focus:ring-2 focus:ring-rose-100 sm:w-56"
                >
                  <option value="">Select type…</option>
                  {selectedTicketOptions.map(tier => (
                    <option key={tier.id} value={tier.id}>
                      {formatTicketOptionLabel(tier)}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </Card>

          {/* Order summary */}
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between bg-slate-50 px-5 py-3 border-b border-slate-100">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Order summary</p>
              {missingTicketTypeCount > 0
                ? <span className="text-xs font-semibold text-amber-600">{missingTicketTypeCount} {seatSelectionEnabled ? 'seat' : 'ticket'}{missingTicketTypeCount !== 1 ? 's' : ''} unassigned</span>
                : <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600"><Check className="h-3 w-3" /> All assigned</span>
              }
            </div>
            <div className="divide-y divide-slate-50 px-5">
              {selectedTierBreakdown.map(item => (
                <div key={item.name} className="flex items-center justify-between py-3 text-sm">
                  <span className="text-slate-600">{item.name} <span className="text-slate-400">×{item.count}</span></span>
                  <span className="font-semibold text-slate-900">${((item.priceCents * item.count) / 100).toFixed(2)}</span>
                </div>
              ))}
            </div>
            <div className="flex items-end justify-between bg-slate-50 px-5 py-4 border-t border-slate-100">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Total</p>
              <p className="text-3xl font-black tracking-tight text-slate-900">${(selectedTierSubtotalCents / 100).toFixed(2)}</p>
            </div>
            {hasMixedCompSelection && (
              <div className="border-t border-red-100 bg-red-50 px-5 py-3 text-xs font-semibold text-red-700">
                Teacher and Student in Show complimentary tickets cannot be mixed in one order.
              </div>
            )}
          </Card>

          {/* Comp guest + email section */}
          {assignForm.source === 'COMP' && (
            <Card className="overflow-hidden">
              <div className="bg-slate-50 px-5 py-3 border-b border-slate-100">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Guest & delivery</p>
              </div>
              <div className="p-5 space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <input
                    type="text"
                    value={assignForm.customerName}
                    onChange={e => setAssignForm({ ...assignForm, customerName: e.target.value })}
                    placeholder="Guest name (optional)"
                    className={baseInput}
                  />
                  <input
                    type="email"
                    value={assignForm.customerEmail}
                    onChange={e => setAssignForm({ ...assignForm, customerEmail: e.target.value })}
                    placeholder="guest@email.com"
                    className={baseInput}
                  />
                </div>

                <label className="flex cursor-pointer items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setAssignForm(prev => ({ ...prev, sendEmail: !prev.sendEmail }))}
                    className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${assignForm.sendEmail ? 'bg-rose-600' : 'bg-slate-200'}`}
                  >
                    <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${assignForm.sendEmail ? 'translate-x-6' : 'translate-x-1'}`} />
                  </button>
                  <span className="text-sm font-semibold text-slate-700">Send comp tickets by email</span>
                </label>

                {assignForm.sendEmail && !assignForm.customerEmail.trim() && (
                  <p className="text-xs font-semibold text-amber-700">
                    Enter an email address above before assigning this comp order.
                  </p>
                )}
              </div>
            </Card>
          )}

          {/* Payment section — door only */}
          {assignForm.source === 'DOOR' && (
            <Card className="overflow-hidden">
              <div className="bg-slate-50 px-5 py-3 border-b border-slate-100">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Payment & receipt</p>
              </div>
              <div className="p-5 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  {([['STRIPE', 'Card', CreditCard], ['CASH', 'Cash', Banknote]] as const).map(([method, label, Icon]) => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setPaymentMethod(method)}
                      className={`flex items-center justify-center gap-2 rounded-xl border-2 py-3 text-sm font-bold transition ${
                        paymentMethod === method
                          ? 'border-rose-600 bg-rose-50 text-rose-700'
                          : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {label}
                    </button>
                  ))}
                </div>

                {paymentMethod === 'STRIPE' && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                    <div>
                      <FieldLabel>Card checkout path</FieldLabel>
                      <div className="grid grid-cols-2 gap-2">
                        {([
                          ['TERMINAL', 'Send to terminal', CreditCard],
                          ['MANUAL', 'Manual checkout', Hash]
                        ] as const).map(([path, label, Icon]) => (
                          <button
                            key={path}
                            type="button"
                            onClick={() => setStripeChargePath(path)}
                            className={`inline-flex items-center justify-center gap-2 rounded-xl border-2 py-2.5 text-xs font-bold transition ${
                              stripeChargePath === path
                                ? 'border-rose-600 bg-rose-50 text-rose-700'
                                : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                            }`}
                          >
                            <Icon className="h-3.5 w-3.5" />
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {stripeChargePath === 'TERMINAL' ? (
                      <>
                        <div className="flex items-center justify-between gap-2">
                          <FieldLabel>Terminal device</FieldLabel>
                          <button
                            type="button"
                            onClick={() => void loadTerminalDevices()}
                            className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-slate-100"
                          >
                            <RefreshCw className={`h-3 w-3 ${loadingTerminalDevices ? 'animate-spin' : ''}`} />
                            Refresh
                          </button>
                        </div>
                        <select
                          value={selectedTerminalDeviceId}
                          onChange={e => setSelectedTerminalDeviceId(e.target.value)}
                          className={baseSelect}
                        >
                          {!terminalDevices.length && <option value="">No active terminals found</option>}
                          {terminalDevices.map(device => (
                            <option key={device.deviceId} value={device.deviceId}>
                              {device.name}{device.isBusy ? ' (Busy)' : ''}
                            </option>
                          ))}
                        </select>
                        <p className="text-xs text-slate-500">
                          Send card collection to an active phone in Terminal Station mode.
                        </p>
                        {selectedTerminalDevice?.isBusy && (
                          <p className="text-xs font-semibold text-amber-700">
                            Payment in progress now. New entries will join the line.
                          </p>
                        )}
                      </>
                    ) : (
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-xs text-emerald-800">
                        Manual checkout bypasses terminal devices and opens an embedded Stripe card form directly in this browser.
                      </div>
                    )}
                  </div>
                )}

                <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  {loadingCashTonight ? (
                    <span className="text-slate-400">Loading cash total…</span>
                  ) : (
                    <span>
                      Cash collected tonight:{' '}
                      <strong className="text-slate-900">${((cashTonight?.totalCashCents || 0) / 100).toFixed(2)}</strong>
                      <span className="ml-1 text-slate-400">({cashTonight?.saleCount || 0} sale{(cashTonight?.saleCount || 0) !== 1 ? 's' : ''})</span>
                    </span>
                  )}
                </div>

                {hasStudentInShowCompSelection && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <FieldLabel>Student code</FieldLabel>
                    <input
                      type="text"
                      value={studentCode}
                      onChange={e => setStudentCode(e.target.value)}
                      placeholder="Student code on file (e.g. jsmith)"
                      className={baseInput}
                    />
                    <p className="mt-2 text-xs text-slate-500">
                      Student in Show comp seats still require the student code check.
                    </p>
                  </div>
                )}

                <div>
                  <label className="flex cursor-pointer items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setSendReceipt(p => !p)}
                      className={`relative h-6 w-11 flex-shrink-0 rounded-full transition-colors ${sendReceipt ? 'bg-rose-600' : 'bg-slate-200'}`}
                    >
                      <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${sendReceipt ? 'translate-x-6' : 'translate-x-1'}`} />
                    </button>
                    <span className="text-sm font-semibold text-slate-700">Send email receipt</span>
                  </label>
                  <AnimatePresence>
                    {sendReceipt && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <input
                          type="email"
                          value={receiptEmail}
                          onChange={e => setReceiptEmail(e.target.value)}
                          placeholder="customer@email.com"
                          className={baseInput + ' mt-3'}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {inPersonFlowError && (
                  <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    {inPersonFlowError}
                  </div>
                )}
              </div>
            </Card>
          )}
        </>
      )}
    </div>,
  ];

  const canUsePortal = typeof document !== 'undefined';

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-3xl space-y-6">

      {/* Page header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-[1.75rem] font-black tracking-tight text-slate-900" style={{ fontFamily: "var(--font-sans)" }}>Orders</h1>
          <p className="mt-1 text-sm text-slate-400">Search, manage, and process ticket orders.</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-end">
          <Link
            to="/admin/devices"
            className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:text-slate-900 sm:w-auto sm:whitespace-nowrap"
          >
            <ExternalLink className="h-4 w-4" /> Device Control
          </Link>
          <motion.button
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
            onClick={openCashierFlow}
            className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:text-slate-900 sm:w-auto sm:whitespace-nowrap"
          >
            <Plus className="h-4 w-4" /> Legacy Cashier Wizard
          </motion.button>
        </div>
      </div>

      {/* Toast notices */}
      <AnimatePresence>
        {notice && (
          <motion.div
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
          >
            <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
            <span className="flex-1">{notice}</span>
            <button onClick={() => setNotice(null)} className="text-emerald-400 transition hover:text-emerald-600">
              <X className="h-4 w-4" />
            </button>
          </motion.div>
        )}
        {error && !showWizard && (
          <motion.div
            initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="text-red-400 transition hover:text-red-600">
              <X className="h-4 w-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showCashierPerformancePicker && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={`${CHECKOUT_OVERLAY_BASE} z-[1300] items-end justify-center overflow-y-auto p-3 sm:items-center sm:p-5`}
          >
            <motion.div
              initial={{ y: 18, opacity: 0, scale: 0.98 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 18, opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className={`${CHECKOUT_PANEL_BASE} my-auto max-h-[calc(100dvh-2rem)] max-w-lg overflow-hidden rounded-3xl`}
            >
              <div className="border-b border-slate-100 px-5 pb-4 pt-5">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Cashier Setup</p>
                <h2 className="mt-1 text-xl font-black text-slate-900">Choose performance</h2>
                <p className="mt-1 text-sm text-slate-500">This selection will be remembered as your cashier default.</p>
              </div>

              <div className="overflow-y-auto px-5 py-5">
                <FieldLabel>Performance</FieldLabel>
                <select
                  value={cashierPerformanceDraftId}
                  onChange={(e) => setCashierPerformanceDraftId(e.target.value)}
                  className={baseSelect}
                >
                  {performances.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                      {p.isFundraiser ? ' [Fundraiser]' : ''}
                      {' — '}
                      {new Date(p.startsAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-4">
                <button
                  type="button"
                  onClick={() => setShowCashierPerformancePicker(false)}
                  className="inline-flex items-center justify-center rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmCashierPerformanceSelection}
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-rose-600 px-5 py-2 text-sm font-bold text-white transition hover:bg-rose-700"
                >
                  Continue
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {saleRecap && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={`${CHECKOUT_OVERLAY_BASE} z-[2360] overflow-y-auto p-3 sm:p-5`}
          >
            <motion.div
              initial={{ y: 14, opacity: 0, scale: 0.98 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 14, opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className={`${CHECKOUT_PANEL_BASE} my-auto max-h-[calc(100dvh-2rem)] max-w-2xl overflow-hidden rounded-3xl`}
            >
              <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-6 py-5">
                <div>
                  <p className="text-sm font-bold uppercase tracking-widest text-slate-400">Seat write-down</p>
                  <h2 className="mt-1 text-2xl font-black text-slate-900">
                    {saleRecap.seats.length} ticket{saleRecap.seats.length === 1 ? '' : 's'} sold
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {saleRecap.paymentMethod === 'CASH' ? 'Cash' : 'Card'} • ${(saleRecap.expectedAmountCents / 100).toFixed(2)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSaleRecap(null)}
                  className="rounded-full p-1.5 text-slate-300 transition hover:bg-slate-100 hover:text-slate-600"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="max-h-[48dvh] overflow-y-auto px-6 py-5">
                <div className="grid gap-2 sm:grid-cols-2">
                  {saleRecap.seats.map((seat) => (
                    <div key={seat.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5">
                      <p className="text-sm font-bold text-slate-900">
                        {seat.row === 'GA'
                          ? `${seat.sectionName} Ticket ${seat.number}`
                          : `${seat.sectionName} · Row ${seat.row} · Seat ${seat.number}`}
                      </p>
                      <p className="text-xs text-slate-500">{seat.ticketType}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-6 py-4">
                <p className="text-sm font-semibold text-slate-500">
                  Auto-close in <span className="text-slate-900">{saleRecapSecondsLeft}s</span>
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setSaleRecap((prev) =>
                        prev
                          ? { ...prev, expiresAtMs: Math.max(prev.expiresAtMs, Date.now()) + 10000 }
                          : prev
                      )
                    }
                    className="inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-100"
                  >
                    Give me 10 seconds longer
                  </button>
                  <button
                    type="button"
                    onClick={() => setSaleRecap(null)}
                    className="inline-flex items-center justify-center rounded-full bg-slate-900 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-slate-700"
                  >
                    Close
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {manualCheckout && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={`${CHECKOUT_OVERLAY_BASE} z-[2370] overflow-y-auto p-3 sm:p-5`}
          >
            <motion.div
              initial={{ y: 12, opacity: 0, scale: 0.98 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 12, opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className={`${CHECKOUT_PANEL_BASE} my-auto flex max-h-[calc(100dvh-2rem)] max-w-xl flex-col overflow-hidden rounded-3xl`}
            >
              <div className="border-b border-slate-100 px-6 py-5">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Manual checkout</p>
                <h2 className="mt-1 text-2xl font-black text-slate-900">Enter card details</h2>
                <p className="mt-1 text-sm text-slate-500">
                  ${(manualCheckout.expectedAmountCents / 100).toFixed(2)} • {manualCheckout.seatIds.length} ticket{manualCheckout.seatIds.length === 1 ? '' : 's'}
                </p>
              </div>

              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  Card details are collected in Stripe. A successful charge is finalized into this same cashier order flow.
                </div>

                {manualCheckoutError && (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {manualCheckoutError}
                  </div>
                )}

                {manualCapturedPaymentIntentId ? (
                  <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
                    <p>
                      Charge succeeded ({manualCapturedPaymentIntentId}), but final order confirmation needs one more attempt.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        if (!manualCapturedPaymentIntentId) return;
                        void finalizeManualCheckout(manualCapturedPaymentIntentId).catch(() => undefined);
                      }}
                      disabled={manualCheckoutCompleting}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 py-2.5 font-semibold text-white transition hover:bg-amber-700 disabled:opacity-60"
                    >
                      {manualCheckoutCompleting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      Retry finalization
                    </button>
                  </div>
                ) : (
                  <>
                    {manualStripePromise && manualStripeOptions ? (
                      <Elements stripe={manualStripePromise} options={manualStripeOptions} key={manualCheckout.paymentIntentId}>
                        <ManualDispatchChargeForm
                          amountCents={manualCheckout.expectedAmountCents}
                          customerName={manualCheckout.customerName}
                          receiptEmail={manualCheckout.receiptEmail}
                          disabled={manualCheckoutCompleting}
                          onError={setManualCheckoutError}
                          onPaymentConfirmed={finalizeManualCheckout}
                        />
                      </Elements>
                    ) : (
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                        Loading secure Stripe card form…
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-6 py-4">
                <button
                  type="button"
                  onClick={closeManualCheckout}
                  disabled={manualCheckoutCompleting}
                  className="inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={cancelManualSale}
                  disabled={manualCheckoutCompleting}
                  className="inline-flex items-center justify-center rounded-full bg-slate-900 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-slate-700 disabled:opacity-60"
                >
                  Cancel checkout
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {terminalDispatch && !manualCheckout && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={`${CHECKOUT_OVERLAY_BASE} z-[2380] overflow-y-auto p-3 sm:p-5`}
          >
            <motion.div
              initial={{ y: 12, opacity: 0, scale: 0.98 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 12, opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className={`${CHECKOUT_PANEL_BASE} my-auto flex max-h-[calc(100dvh-2rem)] max-w-lg flex-col overflow-hidden rounded-3xl`}
            >
              <div className="border-b border-slate-100 px-6 py-5">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Terminal dispatch</p>
                <h2 className="mt-1 text-2xl font-black text-slate-900">
                  {terminalDispatch.status === 'PENDING' && 'Sent to terminal'}
                  {terminalDispatch.status === 'DELIVERED' && 'Terminal received'}
                  {terminalDispatch.status === 'PROCESSING' && 'Processing payment'}
                  {terminalDispatch.status === 'FAILED' && 'Payment failed'}
                  {terminalDispatch.status === 'SUCCEEDED' && 'Payment approved'}
                  {terminalDispatch.status === 'EXPIRED' && 'Dispatch expired'}
                  {terminalDispatch.status === 'CANCELED' && 'Dispatch canceled'}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {terminalDispatch.targetDeviceName || terminalDispatch.targetDeviceId} • ${((terminalDispatch.expectedAmountCents || 0) / 100).toFixed(2)}
                </p>
                <p className="mt-1 text-xs font-semibold text-slate-400">
                  Live updates: {sellerStatusStream.connected ? 'connected' : `reconnecting (${TERMINAL_DISPATCH_POLL_INTERVAL_MS}ms refresh active)`}
                </p>
              </div>

              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-5 text-sm text-slate-600">
                <p>
                  Attempt {terminalDispatch.attemptCount} · Hold expires {new Date(terminalDispatch.holdExpiresAt).toLocaleTimeString()}
                </p>
                {terminalDispatch.failureReason && (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-red-700">
                    {terminalDispatch.failureReason}
                  </div>
                )}
                {inPersonFlowError && (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-red-700">
                    {inPersonFlowError}
                  </div>
                )}
                <div className={`rounded-xl border px-3.5 py-3 ${dispatchInlineStatusClasses.container}`}>
                  <p className={`text-[11px] font-bold uppercase tracking-widest ${dispatchInlineStatusClasses.kicker}`}>Checkout status</p>
                  <p className={`mt-1 text-base font-bold ${dispatchInlineStatusClasses.title}`}>{dispatchInlineStatus.title}</p>
                  <p className={`mt-1 text-sm ${dispatchInlineStatusClasses.detail}`}>{dispatchInlineStatus.detail}</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-6 py-4">
                {terminalDispatch.status === 'FAILED' && terminalDispatch.canRetry && (
                  <button
                    type="button"
                    onClick={retryTerminalDispatch}
                    disabled={terminalDispatchActionBusy}
                    className="inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
                  >
                    Retry
                  </button>
                )}

                {terminalDispatch.status === 'SUCCEEDED' ? (
                  <button
                    type="button"
                    onClick={() => finalizeSuccessfulTerminalDispatch(terminalDispatch)}
                    className="inline-flex items-center justify-center rounded-full bg-rose-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-rose-700"
                  >
                    Continue
                  </button>
                ) : (
                  <>
                    {terminalDispatch.status !== 'EXPIRED' && terminalDispatch.status !== 'CANCELED' && (
                      <button
                        type="button"
                        onClick={cancelTerminalDispatch}
                        disabled={terminalDispatchActionBusy}
                        className="inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-100 disabled:opacity-60"
                      >
                        Cancel sale
                      </button>
                    )}
                    {(terminalDispatch.status === 'FAILED' || terminalDispatch.status === 'EXPIRED' || terminalDispatch.status === 'CANCELED') && (
                      <button
                        type="button"
                        onClick={() => setTerminalDispatch(null)}
                        className="inline-flex items-center justify-center rounded-full bg-slate-900 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-slate-700"
                      >
                        Close
                      </button>
                    )}
                  </>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Checkout Wizard ── */}
      {canUsePortal ? createPortal(
        <AnimatePresence>
          {showWizard && !seatPickerOpen && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className={`${CHECKOUT_OVERLAY_BASE} z-[2340] overflow-y-auto p-3 sm:p-5`}
            >
              <motion.div
                initial={{ y: 24, opacity: 0, scale: 0.97 }}
                animate={{ y: 0,  opacity: 1, scale: 1    }}
                exit={{    y: 24, opacity: 0, scale: 0.97 }}
                transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                className={`${CHECKOUT_PANEL_BASE} my-auto flex max-h-[calc(100dvh-2rem)] max-w-[540px] flex-col overflow-hidden rounded-3xl`}
              >
              {/* Wizard header */}
              <div className="flex-shrink-0 border-b border-slate-200 bg-gradient-to-b from-slate-50 to-white px-4 pb-3 pt-4">
                <div className="mb-4 flex items-center justify-between">
                  <p className="font-bold text-slate-900" style={{ fontFamily: "var(--font-sans)" }}>Cashier Checkout</p>
                  <button
                    onClick={closeWizard}
                    className="rounded-full p-1.5 text-slate-300 transition hover:bg-slate-100 hover:text-slate-600"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                {/* Step indicator */}
                <div className="flex items-center gap-1">
                  {STEPS.map((s, i) => {
                    const done = i < step, active = i === step;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => goTo(i)}
                        className={`flex flex-1 items-center justify-center gap-1.5 rounded-full py-2 text-xs font-bold transition-all ${
                          active ? 'bg-slate-900 text-white shadow-sm' :
                          done   ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' :
                                   'bg-slate-100/80 text-slate-500 hover:bg-slate-200/80 hover:text-slate-700'
                        }`}
                      >
                        {done
                          ? <Check className="h-3 w-3" />
                          : <s.icon className="h-3 w-3" />
                        }
                        <span className="hidden sm:inline">{s.label}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-3 h-1 w-full rounded-full bg-slate-100 overflow-hidden">
                  <motion.div
                    className="h-full rounded-full bg-slate-900"
                    animate={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
                    transition={{ duration: 0.3, ease: 'easeInOut' }}
                  />
                </div>
              </div>

              {/* Wizard body */}
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={step}
                    initial={{ x: dir * 28, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    exit={{ x: dir * -28, opacity: 0 }}
                    transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                  >
                    {wizardSteps[step]}
                  </motion.div>
                </AnimatePresence>

                <AnimatePresence>
                  {error && showWizard && (
                    <motion.div
                      initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                      className="mt-4 flex items-start gap-2.5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                    >
                      <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                      {error}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Wizard footer */}
              <div className="flex-shrink-0 border-t border-slate-200 bg-slate-50/70 px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => goTo(step - 1)}
                    disabled={step === 0}
                    className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-500 transition hover:bg-slate-50 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <ChevronLeft className="h-4 w-4" /> Back
                  </button>

                  <span className="text-xs font-semibold text-slate-300">{step + 1} / {STEPS.length}</span>

                  {step < STEPS.length - 1 ? (
                    <button
                      type="button"
                      onClick={handleWizardNext}
                      className="inline-flex min-w-[160px] items-center justify-center gap-2 rounded-full bg-slate-900 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-slate-700"
                    >
                      {step === 0 ? 'Choose seats' : 'Set ticket types'}
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  ) : assignForm.source === 'DOOR' ? (
                    <motion.button
                      type="button"
                      onClick={finalizeInPersonSale}
                      disabled={
                        inPersonSubmitting ||
                        (
                          paymentMethod === 'STRIPE' &&
                          !isComplimentaryDoorCheckout &&
                          stripeChargePath === 'TERMINAL' &&
                          !selectedTerminalDeviceId
                        )
                      }
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.97 }}
                      className="inline-flex min-w-[180px] items-center justify-center gap-2 rounded-full bg-rose-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-rose-700 disabled:opacity-60"
                    >
                      <Check className="h-4 w-4" />
                      {inPersonSubmitting
                        ? (paymentMethod === 'STRIPE' && !isComplimentaryDoorCheckout
                          ? (stripeChargePath === 'MANUAL' ? 'Preparing manual checkout…' : 'Sending…')
                          : 'Processing…')
                        : (isComplimentaryDoorCheckout
                          ? `Complete complimentary sale · $${(selectedTierSubtotalCents / 100).toFixed(2)}`
                          : paymentMethod === 'STRIPE'
                            ? `${stripeChargePath === 'MANUAL' ? 'Start manual checkout' : 'Send to Payment Line'} · $${(selectedTierSubtotalCents / 100).toFixed(2)}`
                            : `Collect $${(selectedTierSubtotalCents / 100).toFixed(2)}`)}
                    </motion.button>
                  ) : (
                    <motion.button
                      type="button"
                      onClick={assignOrder}
                      disabled={submitting}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.97 }}
                      className="inline-flex min-w-[160px] items-center justify-center gap-2 rounded-full bg-rose-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-rose-700 disabled:opacity-60"
                    >
                      <Check className="h-4 w-4" />
                      {submitting ? 'Assigning…' : 'Assign comp'}
                    </motion.button>
                  )}
                </div>
              </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      ) : null}

      {/* ── Seat Picker Modal ── */}
      {canUsePortal ? createPortal(
        <AnimatePresence>
          {showWizard && seatPickerOpen && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className={`${CHECKOUT_OVERLAY_BASE} z-[2350] items-start overflow-hidden p-0`}
            >
              <motion.div
                initial={{ scale: 0.96, opacity: 0, y: 16 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.96, opacity: 0, y: 16 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className={`${CHECKOUT_PANEL_BASE} flex h-[100dvh] max-h-[100dvh] max-w-[1120px] flex-col overflow-hidden rounded-none`}
              >
              {/* Seat picker header */}
              <div className="flex-shrink-0 border-b border-slate-200 bg-gradient-to-b from-slate-50 to-white px-4 pb-3 pt-4 sm:px-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold text-slate-900" style={{ fontFamily: "var(--font-sans)" }}>Select seats</p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {selectedPerformance?.title ?? 'No performance selected'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={moveOnFromSeatPicker}
                      className="inline-flex items-center gap-1.5 rounded-full bg-rose-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-rose-700"
                    >
                      Done <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setSeatPickerOpen(false)}
                      className="rounded-full p-1.5 text-slate-300 transition hover:bg-slate-100 hover:text-slate-600"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-3 text-xs text-slate-400">
                  <button
                    type="button"
                    onClick={() => void loadSeatsForPerformance(assignForm.performanceId)}
                    className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1.5 font-semibold text-slate-500 transition hover:bg-slate-50"
                  >
                    <RefreshCw className="h-3.5 w-3.5" /> Refresh
                  </button>
                  <span className="font-semibold text-slate-700">{seatIds.length} seat{seatIds.length !== 1 ? 's' : ''} selected</span>
                </div>
              </div>

              {/* Section tabs */}
              <div className="flex-shrink-0 border-b border-slate-200 bg-slate-50/70 px-4 py-2 sm:px-5">
                <div className="flex flex-wrap gap-1.5">
                  {['All', ...sections].map(section => (
                    <button
                      key={section}
                      type="button"
                      onClick={() => setActiveSection(section)}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                        activeSection === section
                          ? 'bg-slate-900 text-white'
                          : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                      }`}
                    >
                      {section}
                    </button>
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                  {[
                    ['Available', 'bg-white border-2 border-slate-300'],
                    ['Held',      'bg-amber-300'],
                    ['Sold',      'bg-slate-300'],
                    ['Blocked',   'bg-red-300'],
                    ['Selected',  'bg-emerald-500'],
                    ['Accessible','bg-blue-400'],
                    ['Companion', 'bg-cyan-400'],
                  ].map(([label, cls]) => (
                    <span key={label} className="inline-flex items-center gap-1.5 text-xs text-slate-400">
                      <span className={`h-2 w-2 rounded-full ${cls}`} />{label}
                    </span>
                  ))}
                </div>
              </div>

              {seatPickerError && (
                <div className="px-4 pt-3 sm:px-5">
                  <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
                    <AlertCircle className="h-4 w-4 flex-shrink-0" /> {seatPickerError}
                  </div>
                </div>
              )}

              {/* Seat map */}
              <div className="min-h-0 flex-1 px-4 pb-2 pt-2 sm:px-5">
                <div className="mx-auto h-full min-h-[clamp(320px,54vh,680px)] w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-100/70">
                  <SeatMapViewport
                    seats={seats}
                    visibleSeats={visibleSeats}
                    loading={loadingSeats}
                    loadingLabel="Loading seats…"
                    emptyText="No seats for this performance."
                    resetKey={assignForm.performanceId || 'admin-orders-seat-map'}
                    containerClassName="h-full min-h-[clamp(320px,54vh,680px)]"
                    verticalAlign="center"
                    fitViewportPadding={72}
                    controlsClassName="absolute bottom-4 right-4 z-30 flex flex-col gap-2"
                    renderSeat={({ seat, x, y }) => {
                      const isSelected = selectedSeatIdSet.has(seat.id);
                      const isUnavailable = seat.status === 'held' || seat.status === 'sold' || seat.status === 'blocked';
                      const companionOk =
                        !seat.isCompanion || isSelected ||
                        (seat.companionForSeatId ? selectedSeatIdSet.has(seat.companionForSeatId) : hasAccessibleSelection);
                      const selectable = !isUnavailable && companionOk;
                      return (
                        <button
                          key={seat.id}
                          type="button"
                          onClick={() => toggleSeat(seat.id)}
                          disabled={!isSelected && !selectable}
                          style={{ left: `${x}px`, top: `${y}px` }}
                          title={`${seat.id} · ${seat.sectionName} ${seat.row}-${seat.number} · ${seat.status}`}
                          className={[
                            'seat-button absolute flex h-8 w-8 items-center justify-center rounded-t-lg rounded-b-md text-[10px] font-bold transition-all duration-150 md:h-10 md:w-10',
                            isSelected
                              ? 'z-10 scale-110 bg-emerald-500 text-white shadow-lg ring-2 ring-emerald-300'
                              : isUnavailable
                                ? 'cursor-not-allowed bg-slate-200 text-slate-400'
                                : seat.status === 'held'
                                  ? 'border-2 border-amber-300 bg-amber-100 text-amber-700 hover:-translate-y-1 hover:shadow-md'
                                  : seat.isCompanion
                                    ? 'border-2 border-cyan-400 bg-cyan-100 text-cyan-700 hover:-translate-y-1 hover:shadow-md'
                                    : seat.isAccessible
                                      ? 'border-2 border-blue-400 bg-blue-100 text-blue-700 hover:-translate-y-1 hover:shadow-md'
                                      : 'border-2 border-slate-200 bg-white text-slate-600 hover:-translate-y-1 hover:border-rose-400 hover:shadow-md'
                          ].join(' ')}
                        >
                          <div className={`absolute -left-1 bottom-1 h-4 w-1 rounded-full opacity-40 ${isSelected ? 'bg-emerald-600' : seat.isCompanion ? 'bg-cyan-500' : seat.isAccessible ? 'bg-blue-500' : 'bg-slate-300'}`} />
                          <div className={`absolute -right-1 bottom-1 h-4 w-1 rounded-full opacity-40 ${isSelected ? 'bg-emerald-600' : seat.isCompanion ? 'bg-cyan-500' : seat.isAccessible ? 'bg-blue-500' : 'bg-slate-300'}`} />
                          {seat.number}
                        </button>
                      );
                    }}
                  />
                </div>
              </div>

              {/* Seat picker footer */}
              <div className="flex-shrink-0 border-t border-slate-200 bg-slate-50/70 px-4 py-2.5 sm:px-5">
                <div className="mb-3 min-h-[32px]">
                  {selectedMappedSeats.length === 0 && selectedUnknownSeatIds.length === 0 ? (
                    <p className="text-sm text-slate-400">No seats selected yet.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {selectedMappedSeats.map(seat => (
                        <button
                          key={seat.id}
                          type="button"
                          onClick={() => toggleSeat(seat.id)}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-rose-100 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100"
                        >
                          {seat.sectionName} {seat.row}-{seat.number}
                          <X className="h-3 w-3" />
                        </button>
                      ))}
                      {selectedUnknownSeatIds.map(id => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => toggleSeat(id)}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 transition hover:bg-amber-100"
                        >
                          {id} <X className="h-3 w-3" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={moveOnFromSeatPicker}
                    className="inline-flex items-center gap-2 rounded-full bg-rose-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-rose-700"
                  >
                    Confirm seats <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      ) : null}

      {/* ── Search bar ── */}
      <form onSubmit={search} className="flex flex-wrap gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by name, email, or order ID…"
            className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm text-slate-900 placeholder:text-slate-300 transition focus:border-rose-400 focus:outline-none focus:ring-2 focus:ring-rose-100"
          />
        </div>

        <select
          value={status}
          onChange={e => setStatus(e.target.value)}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 transition focus:border-rose-400 focus:outline-none focus:ring-2 focus:ring-rose-100 sm:w-auto"
        >
          <option value="">All statuses</option>
          <option value="PENDING">Pending</option>
          <option value="PAID">Paid</option>
          <option value="REFUNDED">Refunded</option>
          <option value="CANCELED">Canceled</option>
        </select>

        <select
          value={sourceFilter}
          onChange={e => setSourceFilter(e.target.value)}
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 transition focus:border-rose-400 focus:outline-none focus:ring-2 focus:ring-rose-100 sm:w-auto"
        >
          <option value="">All sources</option>
          <option value="ONLINE">Online</option>
          <option value="DOOR">Door</option>
          <option value="COMP">Comp</option>
          <option value="STAFF_FREE">Staff</option>
          <option value="STAFF_COMP">Staff Comp</option>
          <option value="STUDENT_COMP">Student</option>
        </select>

        <div className="flex rounded-xl border border-slate-200 overflow-hidden bg-white">
          {(['active', 'archived', 'all'] as const).map(s => (
            <button
              key={s}
              type="button"
              onClick={() => setScope(s)}
              className={`px-3 py-2 text-xs font-semibold capitalize transition ${
                scope === s ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50'
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        <button className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-rose-700 sm:w-auto">
          <Search className="h-3.5 w-3.5" /> Search
        </button>
      </form>

      {/* ── Orders list ── */}
      {loadingRows ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-400">
          <RefreshCw className="h-4 w-4 animate-spin" /> Loading orders…
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-3xl border border-dashed border-slate-200 py-16 text-center">
          <Users className="h-8 w-8 text-slate-200" />
          <p className="text-sm font-semibold text-slate-400">No orders found</p>
          <p className="text-xs text-slate-300">Try adjusting your search or filters</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((order, idx) => {
            const statusMeta = STATUS_META[order.status] ?? { label: order.status, dot: 'bg-slate-400', text: 'text-slate-600', bg: 'bg-slate-50 ring-slate-200' };
            const sourceMeta = SOURCE_META[order.source] ?? { label: order.source, bg: 'bg-slate-100 ring-slate-200', text: 'text-slate-600' };
            return (
              <motion.div
                key={order.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.025 }}
                className="group flex flex-col gap-3 rounded-2xl border border-slate-100 bg-white p-4 transition hover:border-slate-200 hover:shadow-sm sm:flex-row sm:items-center sm:justify-between"
              >
                {/* Left: info */}
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge label={statusMeta.label} bg={statusMeta.bg} text={statusMeta.text} dot={statusMeta.dot} />
                    <Badge label={sourceMeta.label} bg={sourceMeta.bg} text={sourceMeta.text} />
                    {order.source === 'DOOR' && order.inPersonPaymentMethod && (
                      <Badge
                        label={order.inPersonPaymentMethod === 'CASH' ? 'Cash' : 'Card'}
                        bg={order.inPersonPaymentMethod === 'CASH' ? 'bg-emerald-50 ring-emerald-200' : 'bg-blue-50 ring-blue-200'}
                        text={order.inPersonPaymentMethod === 'CASH' ? 'text-emerald-700' : 'text-blue-700'}
                      />
                    )}
                    <span className="font-sans text-xs text-slate-300">{order.id}</span>
                  </div>
                  <p className="text-sm font-semibold text-slate-800">{order.customerName}</p>
                  <p className="text-xs text-slate-400">{order.email}</p>
                  <p className="text-xs text-slate-400">
                    {order.performanceTitle} · {new Date(order.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                </div>

                {/* Right: amount + link */}
                <div className="flex items-center justify-between gap-6 sm:flex-col sm:items-end sm:justify-start">
                  <div className="sm:text-right">
                    <p className="text-lg font-black tracking-tight text-slate-900">${(order.amountTotal / 100).toFixed(2)}</p>
                    <p className="text-xs text-slate-400">{order.ticketCount} ticket{order.ticketCount !== 1 ? 's' : ''}</p>
                  </div>
                  <Link
                    to={`/admin/orders/${order.id}`}
                    className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-500 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700"
                  >
                    View <ExternalLink className="h-3 w-3" />
                  </Link>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
