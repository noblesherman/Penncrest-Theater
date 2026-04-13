import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe, type StripeElementsOptions } from '@stripe/stripe-js';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronRight,
  MapPin,
  Minus,
  Plus,
  RefreshCw,
  Ticket,
  X,
} from 'lucide-react';

import { adminFetch } from '../../lib/adminAuth';
import { apiFetch } from '../../lib/api';
import { usePaymentLineStatusStream } from '../../hooks/usePaymentLineStatusStream';
import {
  readCashierDefaultPerformanceId,
  writeCashierDefaultPerformanceId,
} from '../../hooks/useCashierDefaultPerformance';

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
  TEACHER_TICKET_OPTION_ID,
} from '../../lib/cashierRules';

import { SeatMapViewport } from '../../components/SeatMapViewport';
import {
  PosHeader,
  PosModeSelector,
  PosPaymentPanel,
  PosPerformanceSelector,
  PosRecapPanel,
  PosSelectedLinesPanel,
  PosShell,
  PosTerminalStatus,
  PosTicketGrid,
  type PosPerformanceOption,
  type PosSaleRecapSeat,
  type PosSelectionLine,
  type PosTerminalDispatch,
  type PosTerminalDevice,
  type PosTicketOption,
} from '../../components/admin/pos';

// ======================== TYPES ========================

type PricingTier = { id: string; name: string; priceCents: number };

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
  id: string;
  sectionName: string;
  row: string;
  number: number;
  x: number;
  y: number;
  price: number;
  status: 'available' | 'held' | 'sold' | 'blocked';
  isAccessible?: boolean;
  isCompanion?: boolean;
  companionForSeatId?: string | null;
};

type AssignForm = {
  performanceId: string;
  source: 'DOOR' | 'COMP';
  customerName: string;
  customerEmail: string;
  seatIdsInput: string;
  gaQuantityInput: string;
  ticketType: string;
  sendEmail: boolean;
};

type InPersonCashTonightSummary = {
  totalCashCents: number;
  saleCount: number;
  nightStartIso: string;
  nightEndIso: string;
  performanceId: string | null;
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

// ======================== CONSTANTS & HELPERS ========================

const TERMINAL_DISPATCH_POLL_INTERVAL_MS = 750;
const TERMINAL_DISPATCH_REFRESH_MIN_INTERVAL_MS = 300;
const FALLBACK_STRIPE_PUBLISHABLE_KEY = (import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '').trim();

function isTerminalDispatchFinalStatus(status: PosTerminalDispatch['status']): boolean {
  return status === 'SUCCEEDED' || status === 'FAILED' || status === 'EXPIRED' || status === 'CANCELED';
}

function normalizeSeat(raw: any): Seat {
  const rawStatus = String(raw?.status || 'available').toLowerCase();
  const status: Seat['status'] = ['available', 'held', 'sold', 'blocked'].includes(rawStatus)
    ? (rawStatus as Seat['status'])
    : 'available';

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

function mapEntryToTerminalDispatch(entry: PaymentLineEntry): PosTerminalDispatch {
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
      priceCents: seat.priceCents,
    })),
  };
}

// ======================== MANUAL STRIPE CHARGE FORM ========================

function ManualDispatchChargeForm({
  amountCents,
  customerName,
  receiptEmail,
  disabled,
  onError,
  onPaymentConfirmed,
}: {
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
    onError(null);

    if (!stripe || !elements) {
      onError('Card form is still loading. Please try again.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await stripe.confirmPayment({
        elements,
        confirmParams: {
          payment_method_data: {
            billing_details: { name: customerName || undefined, email: receiptEmail || undefined },
          },
        },
        redirect: 'if_required',
      });

      if (result.error) throw new Error(result.error.message || 'Card charge failed.');

      const intent = result.paymentIntent;
      if (!intent?.id) throw new Error('Stripe did not return a payment intent id.');
      if (intent.status !== 'succeeded')
        throw new Error(`Payment is ${intent.status}. Charge must be succeeded before finalizing checkout.`);

      await onPaymentConfirmed(intent.id);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Card charge failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="rounded-2xl border border-stone-300 bg-stone-50 p-4">
        <PaymentElement />
      </div>
      <button
        type="submit"
        disabled={disabled || submitting || !stripe || !elements}
        className="w-full inline-flex items-center justify-center gap-2 rounded-2xl bg-red-700 py-3.5 text-sm font-semibold text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Ticket className="h-4 w-4" />}
        Charge ${(amountCents / 100).toFixed(2)}
      </button>
    </form>
  );
}

// ======================== MAIN POS PAGE ========================

export default function AdminPosModePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // ======================== STATE ========================

  const [performances, setPerformances] = useState<Performance[]>([]);
  const [loadingSetup, setLoadingSetup] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Seat picker
  const [seatPickerOpen, setSeatPickerOpen] = useState(false);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [loadingSeats, setLoadingSeats] = useState(false);
  const [seatPickerError, setSeatPickerError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<string>('All');

  // Main form
  const [assignForm, setAssignForm] = useState<AssignForm>({
    performanceId: '',
    source: 'DOOR',
    customerName: '',
    customerEmail: '',
    seatIdsInput: '',
    gaQuantityInput: '1',
    ticketType: '',
    sendEmail: false,
  });

  const [ticketSelectionBySeatId, setTicketSelectionBySeatId] = useState<Record<string, string>>({});

  // In-person sale flow
  const [inPersonFlowError, setInPersonFlowError] = useState<string | null>(null);
  const [inPersonSubmitting, setInPersonSubmitting] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'STRIPE' | 'CASH'>('STRIPE');
  const [stripeChargePath, setStripeChargePath] = useState<'TERMINAL' | 'MANUAL'>('TERMINAL');
  const [receiptEmail, setReceiptEmail] = useState('');
  const [sendReceipt, setSendReceipt] = useState(false);
  const [studentCode, setStudentCode] = useState('');

  // Terminal devices
  const [terminalDevices, setTerminalDevices] = useState<PosTerminalDevice[]>([]);
  const [loadingTerminalDevices, setLoadingTerminalDevices] = useState(false);
  const [selectedTerminalDeviceId, setSelectedTerminalDeviceId] = useState('');
  const [terminalDispatch, setTerminalDispatch] = useState<PosTerminalDispatch | null>(null);
  const [terminalDispatchActionBusy, setTerminalDispatchActionBusy] = useState(false);

  // Manual Stripe checkout
  const [manualCheckout, setManualCheckout] = useState<ManualCheckoutSession | null>(null);
  const [manualCheckoutError, setManualCheckoutError] = useState<string | null>(null);
  const [manualCheckoutLoading, setManualCheckoutLoading] = useState(false);
  const [manualCheckoutCompleting, setManualCheckoutCompleting] = useState(false);
  const [manualCapturedPaymentIntentId, setManualCapturedPaymentIntentId] = useState<string | null>(null);

  // Cash summary & sale recap
  const [cashTonight, setCashTonight] = useState<InPersonCashTonightSummary | null>(null);
  const [loadingCashTonight, setLoadingCashTonight] = useState(false);
  const [saleRecap, setSaleRecap] = useState<InPersonSaleRecap | null>(null);
  const [saleRecapSecondsLeft, setSaleRecapSecondsLeft] = useState(0);

  // Refs
  const selectedSeatIdsRef = useRef<string[]>([]);
  const terminalDispatchRefreshInFlightRef = useRef(false);
  const terminalDispatchRefreshLastAtRef = useRef(0);
  const terminalDispatchRefreshLastIdRef = useRef<string | null>(null);

  const manualStripePromise = useMemo(() => {
    if (!manualCheckout?.publishableKey) return null;
    return loadStripe(manualCheckout.publishableKey);
  }, [manualCheckout?.publishableKey]);

  const manualStripeOptions = useMemo<StripeElementsOptions | null>(() => {
    if (!manualCheckout?.clientSecret) return null;
    return { clientSecret: manualCheckout.clientSecret, appearance: { theme: 'stripe' } };
  }, [manualCheckout?.clientSecret]);

  // ======================== DERIVED VALUES ========================

  const selectedPerformance = performances.find((p) => p.id === assignForm.performanceId);
  const seatSelectionEnabled = selectedPerformance?.seatSelectionEnabled !== false;

  const seatIds = useMemo(() => parseSeatIds(assignForm.seatIdsInput), [assignForm.seatIdsInput]);
  const gaTicketQuantity = useMemo(() => {
    const parsed = Number.parseInt(assignForm.gaQuantityInput, 10);
    return Number.isFinite(parsed) ? Math.max(0, Math.min(parsed, 50)) : 0;
  }, [assignForm.gaQuantityInput]);

  const selectionIds = useMemo(
    () => (seatSelectionEnabled ? seatIds : buildGeneralAdmissionLineIds(gaTicketQuantity)),
    [seatSelectionEnabled, seatIds, gaTicketQuantity]
  );

  const selectedSeatIdSet = useMemo(() => new Set(seatIds), [seatIds]);
  const seatById = useMemo(() => new Map(seats.map((s) => [s.id, s])), [seats]);

  const selectedMappedSeats = useMemo(
    () =>
      seatIds
        .map((id) => seatById.get(id))
        .filter((seat): seat is Seat => Boolean(seat))
        .sort((a, b) => naturalSort(a.sectionName, b.sectionName) || naturalSort(a.row, b.row) || a.number - b.number),
    [seatById, seatIds]
  );

  const selectedUnknownSeatIds = useMemo(() => seatIds.filter((id) => !seatById.has(id)), [seatById, seatIds]);
  const sections = useMemo(() => [...new Set(seats.map((s) => s.sectionName))].sort(naturalSort), [seats]);
  const visibleSeats = useMemo(
    () => seats.filter((s) => activeSection === 'All' || s.sectionName === activeSection),
    [activeSection, seats]
  );

  const selectedTicketOptions = useMemo<PosTicketOption[]>(() => {
    if (!selectedPerformance?.pricingTiers?.length) return [];

    const options: PosTicketOption[] = selectedPerformance.pricingTiers.map((tier) => ({
      id: tier.id,
      name: tier.name,
      priceCents: tier.priceCents,
    }));

    const hasTeacher = options.some((o) => o.id === TEACHER_TICKET_OPTION_ID || isTeacherTicketName(o.name));
    if (selectedPerformance.staffCompsEnabled && !hasTeacher) {
      options.push({ id: TEACHER_TICKET_OPTION_ID, name: 'RTMSD STAFF', priceCents: 0, isSynthetic: true });
    }

    const hasStudent = options.some((o) => o.id === STUDENT_SHOW_TICKET_OPTION_ID || isStudentInShowTicketName(o.name));
    if (selectedPerformance.studentCompTicketsEnabled && !hasStudent) {
      options.push({ id: STUDENT_SHOW_TICKET_OPTION_ID, name: 'Student in Show', priceCents: 0, isSynthetic: true });
    }

    return options;
  }, [selectedPerformance]);

  const primaryStandardTicketTier = useMemo(
    () => selectedTicketOptions.find((o) => !o.isSynthetic) || selectedTicketOptions[0] || null,
    [selectedTicketOptions]
  );

  const selectedLines = useMemo<PosSelectionLine[]>(() => {
    if (seatSelectionEnabled) {
      return selectedMappedSeats.map((seat) => ({
        id: seat.id,
        label: `${seat.sectionName} · Row ${seat.row} · #${seat.number}`,
        sectionName: seat.sectionName,
        row: seat.row,
        number: seat.number,
        seatPriceCents: Math.max(0, seat.price),
      }));
    }

    return selectionIds.map((lineId, index) => ({
      id: lineId,
      label: `General Admission Ticket ${index + 1}`,
      sectionName: 'General Admission',
      row: 'GA',
      number: index + 1,
      seatPriceCents: Math.max(0, primaryStandardTicketTier?.priceCents || 0),
    }));
  }, [seatSelectionEnabled, selectedMappedSeats, selectionIds, primaryStandardTicketTier]);

  const selectedSeatsWithTier = useMemo(
    () =>
      selectedLines.map((line) => ({
        line,
        tier: selectedTicketOptions.find((option) => option.id === ticketSelectionBySeatId[line.id]) || null,
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
      const basePriceCents = item.tier ? Math.max(0, item.tier.isSynthetic ? item.line.seatPriceCents : item.tier.priceCents) : 0;

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

    // Teacher comp logic
    if (hasTeacherCompSelection && !hasStudentInShowCompSelection) {
      const teacherSeats = priced.filter((item) => item.isTeacherTicket);
      const complimentarySeatIds = pickComplimentarySeatIds(
        teacherSeats.map((item) => ({
          id: item.line.id,
          sectionName: item.line.sectionName,
          row: item.line.row,
          number: item.line.number,
          basePriceCents: item.basePriceCents,
        })),
        Math.min(MAX_TEACHER_COMP_TICKETS, teacherSeats.length)
      );

      priced = priced.map((item) =>
        item.isTeacherTicket && complimentarySeatIds.has(item.line.id)
          ? { ...item, finalPriceCents: 0, lineLabel: 'Teacher Comp' }
          : item
      );
    }

    // Student comp logic
    if (hasStudentInShowCompSelection && !hasTeacherCompSelection) {
      const studentSeats = priced.filter((item) => item.isStudentTicket);
      const complimentarySeatIds = pickComplimentarySeatIds(
        studentSeats.map((item) => ({
          id: item.line.id,
          sectionName: item.line.sectionName,
          row: item.line.row,
          number: item.line.number,
          basePriceCents: item.basePriceCents,
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
  }, [selectedSeatsWithTier, hasTeacherCompSelection, hasStudentInShowCompSelection]);

  const selectedTierSubtotalCents = useMemo(
    () => selectedSeatsWithPricing.reduce((sum, item) => sum + item.finalPriceCents, 0),
    [selectedSeatsWithPricing]
  );

  const isComplimentaryDoorCheckout = assignForm.source === 'DOOR' && selectedTierSubtotalCents === 0;

  const selectedTierBreakdown = useMemo(() => {
    const counts = new Map<string, { name: string; priceCents: number; count: number }>();
    selectedSeatsWithPricing.forEach((item) => {
      const key = `${item.lineLabel}:${item.finalPriceCents}`;
      const existing = counts.get(key);
      if (existing) {
        existing.count += 1;
        return;
      }
      counts.set(key, { name: item.lineLabel, priceCents: item.finalPriceCents, count: 1 });
    });
    return [...counts.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
  }, [selectedSeatsWithPricing]);

  const missingTicketTypeCount = useMemo(
    () => selectionIds.filter((id) => !ticketSelectionBySeatId[id]).length,
    [selectionIds, ticketSelectionBySeatId]
  );

  const selectedTerminalDevice = useMemo(
    () => terminalDevices.find((d) => d.deviceId === selectedTerminalDeviceId) || null,
    [terminalDevices, selectedTerminalDeviceId]
  );

  const performanceOptions = useMemo<PosPerformanceOption[]>(
    () =>
      performances.map((p) => ({
        id: p.id,
        title: p.title,
        startsAt: p.startsAt,
        isFundraiser: p.isFundraiser,
      })),
    [performances]
  );

  const formatTicketOptionLabel = useCallback((tier: PosTicketOption) => {
    if (tier.id === TEACHER_TICKET_OPTION_ID || isTeacherTicketName(tier.name)) {
      return `${tier.name} · first ${MAX_TEACHER_COMP_TICKETS} free`;
    }
    if (tier.id === STUDENT_SHOW_TICKET_OPTION_ID || isStudentInShowTicketName(tier.name)) {
      return `${tier.name} · first ${MAX_STUDENT_COMP_TICKETS} free`;
    }
    return `${tier.name} · $${(tier.priceCents / 100).toFixed(2)}`;
  }, []);

  const submitLabel = useMemo(() => {
    if (assignForm.source === 'COMP') return inPersonSubmitting ? 'Assigning comp…' : 'Assign comp tickets';

    if (inPersonSubmitting) {
      if (paymentMethod === 'STRIPE' && !isComplimentaryDoorCheckout) {
        return stripeChargePath === 'MANUAL' ? 'Preparing manual checkout…' : 'Sending to terminal…';
      }
      return 'Processing sale…';
    }

    if (isComplimentaryDoorCheckout) return 'Complete complimentary sale';
    if (paymentMethod === 'STRIPE') {
      return stripeChargePath === 'MANUAL' ? 'Start manual checkout' : 'Send to terminal';
    }
    return 'Collect cash';
  }, [assignForm.source, inPersonSubmitting, isComplimentaryDoorCheckout, paymentMethod, stripeChargePath]);

  const submitDisabled = useMemo(() => {
    if (!assignForm.performanceId || selectionIds.length === 0 || missingTicketTypeCount > 0) return true;
    if (assignForm.source === 'DOOR' && paymentMethod === 'STRIPE' && !isComplimentaryDoorCheckout && stripeChargePath === 'TERMINAL' && !selectedTerminalDeviceId) {
      return true;
    }
    return inPersonSubmitting;
  }, [assignForm.performanceId, selectionIds.length, missingTicketTypeCount, assignForm.source, paymentMethod, isComplimentaryDoorCheckout, stripeChargePath, selectedTerminalDeviceId, inPersonSubmitting]);

  // ======================== SELLER STATUS ========================

  const sellerStatusStream = usePaymentLineStatusStream({
    queueKey: terminalDispatch?.targetDeviceId || null,
    sellerEntryId: terminalDispatch?.dispatchId || null,
    enabled: Boolean(terminalDispatch?.targetDeviceId),
  });

  const dispatchInlineStatus = useMemo(() => {
    const streamEntry = sellerStatusStream.sellerPayload.sellerEntry;

    if (sellerStatusStream.connected && streamEntry) {
      if (streamEntry.uiState === 'WAITING_FOR_PAYMENT') {
        const ahead = streamEntry.position && streamEntry.position > 0 ? streamEntry.position - 1 : null;
        return {
          title: 'Not your turn',
          detail: ahead === null ? 'Phone is currently in use. Stay in line.' : `${ahead} ahead. Phone is currently in use.`,
          tone: 'danger' as const,
        };
      }
      if (streamEntry.uiState === 'ACTIVE_PAYMENT') return { title: 'Ready to pay', detail: 'Phone is ready now. Indicate to pay.', tone: 'success' as const };
      if (streamEntry.uiState === 'PAYMENT_SUCCESS') return { title: 'Payment approved', detail: 'Checkout completed successfully.', tone: 'success' as const };
      if (streamEntry.uiState === 'PAYMENT_FAILED') return { title: 'Payment failed', detail: streamEntry.failureReason || 'Terminal payment failed.', tone: 'danger' as const };
      if (streamEntry.uiState === 'CANCELED') return { title: 'Canceled', detail: 'This sale was canceled before payment completed.', tone: 'neutral' as const };
    }

    if (!terminalDispatch) return { title: 'Dispatch pending', detail: 'Waiting for terminal confirmation.', tone: 'neutral' as const };

    if (terminalDispatch.status === 'PENDING' || terminalDispatch.status === 'DELIVERED')
      return { title: 'Not your turn', detail: 'Sent to terminal. Waiting for phone availability.', tone: 'danger' as const };
    if (terminalDispatch.status === 'PROCESSING')
      return { title: 'Ready to pay', detail: 'Phone is collecting payment now. Indicate to pay.', tone: 'success' as const };
    if (terminalDispatch.status === 'SUCCEEDED') return { title: 'Payment approved', detail: 'Checkout completed successfully.', tone: 'success' as const };
    if (terminalDispatch.status === 'FAILED') return { title: 'Payment failed', detail: terminalDispatch.failureReason || 'Terminal payment failed.', tone: 'danger' as const };
    if (terminalDispatch.status === 'EXPIRED') return { title: 'Dispatch expired', detail: 'Payment window expired before completion.', tone: 'danger' as const };

    return { title: 'Dispatch canceled', detail: 'This sale was canceled before payment completed.', tone: 'neutral' as const };
  }, [sellerStatusStream, terminalDispatch]);

  // ======================== DATA LOADING ========================

  const loadPerformances = useCallback(async () => {
    setLoadingSetup(true);
    setError(null);
    try {
      const items = await adminFetch<Array<any>>('/api/admin/performances?scope=active&kind=all');

      const mapped = items
        .filter((item) => !item.isArchived)
        .map((item) => ({
          id: item.id,
          title: item.title,
          startsAt: item.startsAt,
          isFundraiser: Boolean(item.isFundraiser),
          pricingTiers: item.pricingTiers || [],
          staffCompsEnabled: Boolean(item.staffCompsEnabled),
          studentCompTicketsEnabled: Boolean(item.studentCompTicketsEnabled),
          seatSelectionEnabled: item.seatSelectionEnabled !== false,
        }));

      setPerformances(mapped);

      if (mapped.length > 0) {
        const requested = searchParams.get('performanceId') || '';
        const stored = readCashierDefaultPerformanceId();
        const fallback = mapped[0].id;

        const nextId =
          mapped.some((p) => p.id === assignForm.performanceId)
            ? assignForm.performanceId
            : mapped.some((p) => p.id === requested)
              ? requested
              : mapped.some((p) => p.id === stored)
                ? stored
                : fallback;

        setAssignForm((prev) => ({ ...prev, performanceId: nextId }));
        writeCashierDefaultPerformanceId(nextId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load performances');
    } finally {
      setLoadingSetup(false);
    }
  }, [assignForm.performanceId, searchParams]);

  const loadSeatsForPerformance = useCallback(async (performanceId: string, options: { showLoading?: boolean; syncSelection?: boolean } = {}) => {
    if (!performanceId) return;
    const { showLoading = true, syncSelection = true } = options;
    if (showLoading) setLoadingSeats(true);

    try {
      let rawSeats: any[] = [];
      try {
        rawSeats = await adminFetch<any[]>(`/api/admin/performances/${performanceId}/seats`);
      } catch (err) {
        if (!(err instanceof Error && err.message.toLowerCase().includes('not found'))) throw err;
        const publicData = await apiFetch<any[] | { seats: any[] }>(`/api/performances/${performanceId}/seats`);
        rawSeats = Array.isArray(publicData) ? publicData : publicData.seats;
      }

      const normalized = rawSeats.map(normalizeSeat);
      setSeats(normalized);
      setSeatPickerError(null);

      const currentIds = selectedSeatIdsRef.current;
      if (syncSelection && currentIds.length > 0) {
        const unavailable = new Set(normalized.filter((s) => s.status !== 'available').map((s) => s.id));
        const removed = currentIds.filter((id) => unavailable.has(id));

        if (removed.length > 0) {
          setAssignForm((prev) => ({
            ...prev,
            seatIdsInput: parseSeatIds(prev.seatIdsInput).filter((id) => !unavailable.has(id)).join(', '),
          }));

          setTicketSelectionBySeatId((prev) => {
            const next = { ...prev };
            removed.forEach((id) => delete next[id]);
            return next;
          });

          setError(
            removed.length === 1
              ? 'A selected seat is no longer available. The seating chart was refreshed.'
              : `${removed.length} selected seats are no longer available. The seating chart was refreshed.`
          );
        }
      }
    } catch (err) {
      setSeatPickerError(err instanceof Error ? err.message : 'Failed to load seats');
    } finally {
      if (showLoading) setLoadingSeats(false);
    }
  }, []);

  const loadCashTonight = useCallback(async (performanceId: string) => {
    if (!performanceId) {
      setCashTonight(null);
      return;
    }
    setLoadingCashTonight(true);
    try {
      const params = new URLSearchParams({ performanceId });
      const summary = await adminFetch<InPersonCashTonightSummary>(`/api/admin/orders/in-person/cash-tonight?${params}`);
      setCashTonight(summary);
    } catch {
      setCashTonight(null);
    } finally {
      setLoadingCashTonight(false);
    }
  }, []);

  const loadTerminalDevices = useCallback(async () => {
    setLoadingTerminalDevices(true);
    try {
      const { devices } = await adminFetch<{ devices: PosTerminalDevice[] }>('/api/admin/orders/in-person/terminal/devices');
      setTerminalDevices(devices);
      setSelectedTerminalDeviceId((prev) => (prev && devices.some((d) => d.deviceId === prev)) ? prev : devices[0]?.deviceId || '');
    } catch {
      setTerminalDevices([]);
      setSelectedTerminalDeviceId('');
    } finally {
      setLoadingTerminalDevices(false);
    }
  }, []);

  // ======================== ACTIONS ========================

  const closeManualCheckout = useCallback(() => {
    setManualCheckout(null);
    setManualCheckoutError(null);
    setManualCapturedPaymentIntentId(null);
    setManualCheckoutLoading(false);
    setManualCheckoutCompleting(false);
  }, []);

  const resetInPersonFlow = useCallback(() => {
    setInPersonFlowError(null);
    setInPersonSubmitting(false);
    setPaymentMethod('STRIPE');
    setStripeChargePath('TERMINAL');
    setReceiptEmail('');
    setSendReceipt(false);
    setStudentCode('');
    setTerminalDevices([]);
    setSelectedTerminalDeviceId('');
    setTerminalDispatch(null);
    setTerminalDispatchActionBusy(false);
    closeManualCheckout();
    setCashTonight(null);
  }, [closeManualCheckout]);

  const startNewSale = useCallback(() => {
    setAssignForm((prev) => ({
      ...prev,
      customerName: '',
      customerEmail: '',
      seatIdsInput: '',
      gaQuantityInput: '1',
      ticketType: '',
      sendEmail: false,
    }));
    setTicketSelectionBySeatId({});
    resetInPersonFlow();
    setError(null);
    setNotice(null);
    if (assignForm.performanceId) {
      void loadSeatsForPerformance(assignForm.performanceId, { showLoading: false, syncSelection: false });
    }
  }, [assignForm.performanceId, loadSeatsForPerformance, resetInPersonFlow]);

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
      const intent = await adminFetch<ManualInPersonPaymentIntent>('/api/admin/orders/in-person/manual-intent', {
        method: 'POST',
        body: JSON.stringify({
          performanceId: params.performanceId,
          seatIds: params.seatIds,
          ticketSelectionBySeatId: params.ticketSelectionBySeatId,
          customerName: params.customerName,
          receiptEmail: params.receiptEmail || undefined,
          sendReceipt: params.sendReceipt,
          studentCode: params.studentCode,
        }),
      });

      const publishableKey = (intent.publishableKey || FALLBACK_STRIPE_PUBLISHABLE_KEY).trim();
      if (!publishableKey) throw new Error('Stripe publishable key is not configured for manual checkout.');

      setManualCheckout({
        ...params,
        paymentIntentId: intent.paymentIntentId,
        clientSecret: intent.clientSecret,
        publishableKey,
        expectedAmountCents: intent.expectedAmountCents,
        currency: intent.currency,
      });
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to start manual card checkout';
      setManualCheckoutError(msg);
      setInPersonFlowError(msg);
      return false;
    } finally {
      setManualCheckoutLoading(false);
    }
  }, []);

  const finalizeManualCheckout = async (paymentIntentId: string) => {
    if (!manualCheckout) throw new Error('Manual checkout session is missing.');

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
      }>('/api/admin/orders/in-person/manual-complete', {
        method: 'POST',
        body: JSON.stringify({
          performanceId: manualCheckout.performanceId,
          seatIds: manualCheckout.seatIds,
          ticketSelectionBySeatId: manualCheckout.ticketSelectionBySeatId,
          customerName: manualCheckout.customerName,
          receiptEmail: manualCheckout.receiptEmail || undefined,
          sendReceipt: manualCheckout.sendReceipt,
          studentCode: manualCheckout.studentCode,
          paymentIntentId,
        }),
      });

      setManualCheckout(null);
      setManualCapturedPaymentIntentId(null);

      setSaleRecap({
        expectedAmountCents: result.expectedAmountCents,
        paymentMethod: result.paymentMethod,
        seats: result.seats,
        expiresAtMs: Date.now() + 10000,
      });

      startNewSale();
      setNotice(`Stripe sale completed — ${result.seats.length} ${seatSelectionEnabled ? 'seat' : 'ticket'}${result.seats.length === 1 ? '' : 's'} · $${(result.expectedAmountCents / 100).toFixed(2)}`);
      void loadSeatsForPerformance(manualCheckout.performanceId, { showLoading: false, syncSelection: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to finalize successful manual charge.';
      setManualCheckoutError(msg);
      setInPersonFlowError(msg);
      throw err;
    } finally {
      setManualCheckoutCompleting(false);
    }
  };

  const assignOrder = async () => {
    setError(null);
    setNotice(null);

    if (!assignForm.performanceId || selectionIds.length === 0) {
      setError(seatSelectionEnabled ? 'Choose a performance and provide at least one seat ID.' : 'Choose a performance and enter at least one GA ticket.');
      return;
    }
    if (assignForm.source !== 'COMP') {
      setError('Door sales must use the in-person finalize flow.');
      return;
    }
    if (assignForm.sendEmail && !assignForm.customerEmail.trim()) {
      setError('Enter an email address to send comp tickets.');
      return;
    }
    if (missingTicketTypeCount > 0) {
      setError(`Choose a ticket type for every selected ${seatSelectionEnabled ? 'seat' : 'ticket'} before assigning checkout.`);
      return;
    }

    const ticketTypeBySeatId = Object.fromEntries(selectionIds.map((id) => [id, ticketSelectionBySeatId[id] || 'Comp']));
    const fallbackName = assignForm.customerName.trim() || 'Comp Guest';
    const fallbackEmail = assignForm.customerEmail.trim().toLowerCase() || `comp+${Date.now()}@boxoffice.local`;

    setInPersonSubmitting(true);
    try {
      await adminFetch('/api/admin/orders/assign', {
        method: 'POST',
        body: JSON.stringify({
          performanceId: assignForm.performanceId,
          seatIds: selectionIds,
          customerName: fallbackName,
          customerEmail: fallbackEmail,
          ticketTypeBySeatId,
          priceBySeatId: Object.fromEntries(selectionIds.map((id) => [id, 0])),
          source: assignForm.source,
          sendEmail: Boolean(assignForm.sendEmail && assignForm.customerEmail.trim()),
        }),
      });

      setNotice(`Assigned ${selectionIds.length} ${seatSelectionEnabled ? 'seat' : 'ticket'}${selectionIds.length === 1 ? '' : 's'} successfully.`);
      startNewSale();
      void loadSeatsForPerformance(assignForm.performanceId, { showLoading: false, syncSelection: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assign seats');
    } finally {
      setInPersonSubmitting(false);
    }
  };

  const finalizeInPersonSale = async () => {
    setError(null);
    setNotice(null);
    setInPersonFlowError(null);

    if (!assignForm.performanceId || selectionIds.length === 0) {
      setError(seatSelectionEnabled ? 'Choose a performance and provide at least one seat ID.' : 'Choose a performance and enter at least one GA ticket.');
      return;
    }
    if (selectedTicketOptions.length === 0) {
      setError('No ticket pricing tiers are configured for this performance.');
      return;
    }
    if (missingTicketTypeCount > 0) {
      setError(`Choose a ticket type for every selected ${seatSelectionEnabled ? 'seat' : 'ticket'} before completing checkout.`);
      return;
    }
    if (hasMixedCompSelection) {
      setInPersonFlowError('Teacher and Student in Show complimentary tickets cannot be mixed in one order.');
      return;
    }

    const normalizedStudentCode = studentCode.trim().toLowerCase().replace(/\s+/g, '');
    if (hasStudentInShowCompSelection && !normalizedStudentCode) {
      setInPersonFlowError('Student code is required when Student in Show tickets are selected.');
      return;
    }

    const normalizedReceiptEmail = receiptEmail.trim().toLowerCase();
    if (sendReceipt && !normalizedReceiptEmail) {
      setInPersonFlowError('Enter an email address before sending a receipt.');
      return;
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
            studentCode: hasStudentInShowCompSelection ? normalizedStudentCode : undefined,
          });
        } catch (err) {
          setInPersonFlowError(err instanceof Error ? err.message : 'Failed to start manual checkout');
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
        const dispatch = await adminFetch<PosTerminalDispatch>('/api/admin/payment-line/enqueue', {
          method: 'POST',
          body: JSON.stringify({
            performanceId: assignForm.performanceId,
            seatIds: selectionIds,
            ticketSelectionBySeatId,
            receiptEmail: normalizedReceiptEmail || undefined,
            sendReceipt,
            customerName: assignForm.customerName.trim() || undefined,
            studentCode: hasStudentInShowCompSelection ? normalizedStudentCode : undefined,
            deviceId: selectedTerminalDeviceId,
          }),
        });
        setTerminalDispatch(dispatch);
      } catch (err) {
        setInPersonFlowError(err instanceof Error ? err.message : 'Failed to send sale to payment line');
      } finally {
        setInPersonSubmitting(false);
      }
      return;
    }

    // Cash sale
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
          ticketSelectionBySeatId,
          paymentMethod: effectivePaymentMethod,
          receiptEmail: normalizedReceiptEmail || undefined,
          sendReceipt,
          customerName: assignForm.customerName.trim() || undefined,
          studentCode: hasStudentInShowCompSelection ? normalizedStudentCode : undefined,
        }),
      });

      setSaleRecap({
        expectedAmountCents: result.expectedAmountCents,
        paymentMethod: result.paymentMethod,
        seats: result.seats,
        expiresAtMs: Date.now() + 10000,
      });

      setNotice(`${result.paymentMethod === 'CASH' ? 'Cash' : 'Stripe'} sale completed — ${selectionIds.length} ${seatSelectionEnabled ? 'seat' : 'ticket'}${selectionIds.length === 1 ? '' : 's'} · $${(result.expectedAmountCents / 100).toFixed(2)}`);
      startNewSale();
      void loadSeatsForPerformance(assignForm.performanceId, { showLoading: false, syncSelection: false });
    } catch (err) {
      setInPersonFlowError(err instanceof Error ? err.message : 'Failed to finalize in-person sale');
    } finally {
      setInPersonSubmitting(false);
    }
  };

  const handlePrimarySubmit = () => {
    if (assignForm.source === 'COMP') {
      void assignOrder();
    } else {
      void finalizeInPersonSale();
    }
  };

  // Terminal dispatch helpers
  const applyTerminalDispatchStatus = useCallback((dispatch: PosTerminalDispatch) => {
    setTerminalDispatch((prev) => {
      if (!prev || prev.dispatchId !== dispatch.dispatchId) return dispatch;
      if (
        prev.status === dispatch.status &&
        prev.failureReason === dispatch.failureReason &&
        prev.holdExpiresAt === dispatch.holdExpiresAt &&
        prev.holdActive === dispatch.holdActive &&
        prev.canRetry === dispatch.canRetry &&
        prev.attemptCount === dispatch.attemptCount &&
        prev.finalOrderId === dispatch.finalOrderId
      ) {
        return prev;
      }
      return dispatch;
    });
  }, []);

  const refreshTerminalDispatchStatus = useCallback(async (dispatchId: string, force = false) => {
    if (!dispatchId || terminalDispatchRefreshInFlightRef.current) return;

    const now = Date.now();
    const isSame = terminalDispatchRefreshLastIdRef.current === dispatchId;
    if (!force && isSame && now - terminalDispatchRefreshLastAtRef.current < TERMINAL_DISPATCH_REFRESH_MIN_INTERVAL_MS) {
      return;
    }

    terminalDispatchRefreshInFlightRef.current = true;
    terminalDispatchRefreshLastAtRef.current = now;
    terminalDispatchRefreshLastIdRef.current = dispatchId;

    try {
      const dispatch = await adminFetch<PosTerminalDispatch>(`/api/admin/payment-line/entry/${encodeURIComponent(dispatchId)}`);
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
      const dispatch = await adminFetch<PosTerminalDispatch>(`/api/admin/payment-line/entry/${encodeURIComponent(terminalDispatch.dispatchId)}/retry-now`, { method: 'POST' });
      applyTerminalDispatchStatus(dispatch);
    } catch (err) {
      setInPersonFlowError(err instanceof Error ? err.message : 'Retry failed');
      await refreshTerminalDispatchStatus(terminalDispatch.dispatchId, true).catch(() => {});
    } finally {
      setTerminalDispatchActionBusy(false);
    }
  }, [terminalDispatch, applyTerminalDispatchStatus, refreshTerminalDispatchStatus]);

  const cancelTerminalDispatch = useCallback(async () => {
    if (!terminalDispatch) return;
    setTerminalDispatchActionBusy(true);
    try {
      const dispatch = await adminFetch<PosTerminalDispatch>(`/api/admin/payment-line/entry/${encodeURIComponent(terminalDispatch.dispatchId)}/cancel`, { method: 'POST' });
      setTerminalDispatch(dispatch.status === 'CANCELED' ? null : dispatch);
    } catch (err) {
      setInPersonFlowError(err instanceof Error ? err.message : 'Cancel failed');
    } finally {
      setTerminalDispatchActionBusy(false);
    }
  }, [terminalDispatch]);

  const finalizeSuccessfulTerminalDispatch = useCallback((dispatch: PosTerminalDispatch) => {
    const isGeneralAdmissionDispatch = dispatch.seats.every((seat) => seat.row === 'GA');
    setSaleRecap({
      expectedAmountCents: dispatch.expectedAmountCents,
      paymentMethod: 'STRIPE',
      seats: dispatch.seats,
      expiresAtMs: Date.now() + 10000,
    });

    startNewSale();
    setNotice(`Stripe sale completed — ${dispatch.seatCount} ${isGeneralAdmissionDispatch ? 'ticket' : 'seat'}${dispatch.seatCount === 1 ? '' : 's'} · $${(dispatch.expectedAmountCents / 100).toFixed(2)}`);
    setTerminalDispatch(null);
    if (assignForm.performanceId) {
      void loadSeatsForPerformance(assignForm.performanceId, { showLoading: false, syncSelection: false });
    }
  }, [assignForm.performanceId, loadSeatsForPerformance, startNewSale]);

  // ======================== EFFECTS ========================

  useEffect(() => {
    void loadPerformances();
  }, [loadPerformances]);

  useEffect(() => {
    selectedSeatIdsRef.current = seatIds;
  }, [seatIds]);

  useEffect(() => {
    if (assignForm.performanceId) {
      void loadSeatsForPerformance(assignForm.performanceId, { showLoading: false, syncSelection: false });
    } else {
      setSeats([]);
    }
  }, [assignForm.performanceId, loadSeatsForPerformance]);

  useEffect(() => {
    if (assignForm.source === 'DOOR' && assignForm.performanceId) {
      void loadCashTonight(assignForm.performanceId);
    } else {
      setCashTonight(null);
    }
  }, [assignForm.source, assignForm.performanceId, loadCashTonight]);

  useEffect(() => {
    if (assignForm.source === 'DOOR' && paymentMethod === 'STRIPE' && stripeChargePath === 'TERMINAL') {
      void loadTerminalDevices();
    }
  }, [assignForm.source, paymentMethod, stripeChargePath, loadTerminalDevices]);

  // Terminal dispatch polling & streaming
  useEffect(() => {
    if (!terminalDispatch?.dispatchId || !terminalDispatch.status || !sellerStatusStream.snapshot) return;

    const nextEntry = sellerStatusStream.snapshot.entries.find((e) => e.entryId === terminalDispatch.dispatchId);
    if (!nextEntry) {
      if (!sellerStatusStream.connected || isTerminalDispatchFinalStatus(terminalDispatch.status)) return;
      void refreshTerminalDispatchStatus(terminalDispatch.dispatchId).catch(() => {});
      return;
    }

    applyTerminalDispatchStatus(mapEntryToTerminalDispatch(nextEntry));
  }, [sellerStatusStream, terminalDispatch, applyTerminalDispatchStatus, refreshTerminalDispatchStatus]);

  useEffect(() => {
    if (!terminalDispatch?.dispatchId || sellerStatusStream.connected || isTerminalDispatchFinalStatus(terminalDispatch.status)) return;

    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      await refreshTerminalDispatchStatus(terminalDispatch.dispatchId).catch(() => {});
    };

    void poll();
    const timer = setInterval(poll, TERMINAL_DISPATCH_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [terminalDispatch, sellerStatusStream.connected, refreshTerminalDispatchStatus]);

  useEffect(() => {
    if (!assignForm.performanceId || terminalDispatch || !seatSelectionEnabled) return;

    const timer = setInterval(() => {
      void loadSeatsForPerformance(assignForm.performanceId, { showLoading: false, syncSelection: true });
    }, 5000);

    return () => clearInterval(timer);
  }, [assignForm.performanceId, terminalDispatch, seatSelectionEnabled, loadSeatsForPerformance]);

  useEffect(() => {
    if (selectionIds.length === 0) {
      setTicketSelectionBySeatId({});
      return;
    }

    const defaultTierId = selectedTicketOptions[0]?.id || '';
    setTicketSelectionBySeatId((prev) => {
      const next: Record<string, string> = {};
      selectionIds.forEach((id) => {
        const current = prev[id];
        const isValid = Boolean(current && selectedTicketOptions.some((t) => t.id === current));
        next[id] = isValid ? current : defaultTierId;
      });
      return next;
    });
  }, [selectionIds, selectedTicketOptions]);

  useEffect(() => {
    if (!saleRecap) {
      setSaleRecapSecondsLeft(0);
      return;
    }

    const update = () => {
      const seconds = Math.max(0, Math.ceil((saleRecap.expiresAtMs - Date.now()) / 1000));
      setSaleRecapSecondsLeft(seconds);
      if (seconds <= 0) setSaleRecap(null);
    };

    update();
    const id = setInterval(update, 250);
    return () => clearInterval(id);
  }, [saleRecap]);

  useEffect(() => {
    if (activeSection !== 'All' && !sections.includes(activeSection)) {
      setActiveSection('All');
    }
  }, [activeSection, sections]);

  // ======================== UI HELPERS ========================

  const updateSelectedSeatIds = useCallback((updater: (current: string[]) => string[]) => {
    setAssignForm((prev) => {
      const current = parseSeatIds(prev.seatIdsInput);
      const next = [...new Set(updater(current))];
      return { ...prev, seatIdsInput: next.join(', ') };
    });
  }, []);

  const toggleSeat = useCallback((id: string) => {
    updateSelectedSeatIds((current) => (current.includes(id) ? current.filter((s) => s !== id) : [...current, id]));
  }, [updateSelectedSeatIds]);

  // ======================== RENDER ========================

  if (loadingSetup && performances.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-50 text-stone-900">
        <div className="flex items-center gap-3 text-sm text-stone-600">
          <RefreshCw className="h-4 w-4 animate-spin" /> Loading POS…
        </div>
      </div>
    );
  }

  return (
    <>
      <PosShell
        header={
          <PosHeader
            performanceTitle={selectedPerformance?.title || 'Choose a performance'}
            performanceDate={selectedPerformance ? new Date(selectedPerformance.startsAt).toLocaleString() : ''}
            source={assignForm.source}
            lineCount={selectionIds.length}
            totalCents={selectedTierSubtotalCents}
            onExit={() => navigate('/admin/orders')}
            onStartOver={startNewSale}
          />
        }
        left={
          <div className="flex h-full min-h-0 flex-col gap-4">
            <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-red-600">Step 1 · Build Order</p>
              <p className="text-sm text-stone-600">Choose performance, select seats or quantity, then assign ticket types.</p>
            </div>

            <AnimatePresence>
              {(notice || error) && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className={`rounded-2xl border px-4 py-3 text-sm ${notice ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="flex items-start gap-2">
                      {notice ? <CheckCircle2 className="mt-0.5 h-4 w-4" /> : <AlertCircle className="mt-0.5 h-4 w-4" />}
                      {notice || error}
                    </span>
                    <button type="button" onClick={() => { setNotice(null); setError(null); }} className="rounded-md p-1 hover:bg-stone-100">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            <PosPerformanceSelector
              performances={performanceOptions}
              value={assignForm.performanceId}
              onChange={(performanceId) => {
                writeCashierDefaultPerformanceId(performanceId);
                setAssignForm((prev) => ({ ...prev, performanceId, seatIdsInput: '', gaQuantityInput: '1', customerName: '', customerEmail: '', sendEmail: false }));
                setTicketSelectionBySeatId({});
                resetInPersonFlow();
                setError(null);
                setNotice(null);
              }}
            />

            <PosModeSelector value={assignForm.source} onChange={(source) => { setAssignForm((prev) => ({ ...prev, source })); resetInPersonFlow(); }} />

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <button
                type="button"
                onClick={() => { if (assignForm.performanceId) { setSeatPickerOpen(true); setSeatPickerError(null); } else setError('Choose a performance first.'); }}
                disabled={!seatSelectionEnabled}
                className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-left text-sm font-bold text-stone-800 transition hover:bg-stone-100 disabled:opacity-40"
              >
                <MapPin className="mb-2 h-5 w-5 text-red-600" />
                Open Seat Map
              </button>

              <button type="button" onClick={() => { setAssignForm((prev) => ({ ...prev, seatIdsInput: '', gaQuantityInput: '1' })); setTicketSelectionBySeatId({}); }} className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-left text-sm font-bold text-stone-800 transition hover:bg-stone-100">
                <X className="mb-2 h-5 w-5 text-red-600" />
                Clear Cart
              </button>

              <button type="button" onClick={startNewSale} className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-left text-sm font-bold text-stone-800 transition hover:bg-stone-100">
                <RefreshCw className="mb-2 h-5 w-5 text-red-600" />
                Start New Sale
              </button>

              <Link to="/admin/orders" className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-left text-sm font-bold text-stone-800 transition hover:bg-stone-100">
                <ChevronRight className="mb-2 h-5 w-5 text-red-600" />
                Back to Orders
              </Link>
            </div>

            {seatSelectionEnabled ? (
              <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-red-600">Selected Seats</p>
                  <p className="text-sm font-semibold text-stone-700">{seatIds.length}</p>
                </div>
                <div className="mt-2 flex max-h-[110px] flex-wrap gap-2 overflow-y-auto">
                  {selectedMappedSeats.length === 0 && selectedUnknownSeatIds.length === 0 ? (
                    <p className="text-sm text-stone-500">No seats selected yet.</p>
                  ) : (
                    <>
                      {selectedMappedSeats.map((seat) => (
                        <button key={seat.id} type="button" onClick={() => toggleSeat(seat.id)} className="inline-flex items-center gap-1 rounded-xl border border-stone-300 bg-stone-50 px-2.5 py-1.5 text-xs font-semibold text-stone-700 transition hover:border-red-300">
                          {seat.sectionName} {seat.row}-{seat.number} <X className="h-3 w-3" />
                        </button>
                      ))}
                      {selectedUnknownSeatIds.map((id) => (
                        <button key={id} type="button" onClick={() => toggleSeat(id)} className="inline-flex items-center gap-1 rounded-xl border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-800">
                          {id} <X className="h-3 w-3" />
                        </button>
                      ))}
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-red-600">General Admission Quantity</p>
                <div className="mt-2 flex items-center gap-3">
                  <button type="button" onClick={() => setAssignForm((prev) => ({ ...prev, gaQuantityInput: String(Math.max(0, gaTicketQuantity - 1)) }))} className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-stone-300 bg-white text-stone-700">
                    <Minus className="h-5 w-5" />
                  </button>
                  <div className="flex-1 rounded-2xl border border-stone-300 bg-stone-50 px-4 py-3 text-center text-2xl font-black text-stone-900">
                    {gaTicketQuantity}
                  </div>
                  <button type="button" onClick={() => setAssignForm((prev) => ({ ...prev, gaQuantityInput: String(Math.min(50, gaTicketQuantity + 1)) }))} className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-stone-300 bg-white text-stone-700">
                    <Plus className="h-5 w-5" />
                  </button>
                </div>
              </div>
            )}

            <PosTicketGrid
              options={selectedTicketOptions}
              selectedOptionId={selectedTicketOptions[0]?.id || null}
              onApplyToAll={(ticketTypeId) => {
                setTicketSelectionBySeatId((prev) => {
                  const next = { ...prev };
                  selectionIds.forEach((id) => { next[id] = ticketTypeId; });
                  return next;
                });
              }}
              formatLabel={formatTicketOptionLabel}
            />
          </div>
        }
        right={
          <div className="flex h-full min-h-0 flex-col">
            <PosSelectedLinesPanel
              lines={selectedLines}
              seatSelectionEnabled={seatSelectionEnabled}
              ticketOptions={selectedTicketOptions}
              ticketSelectionByLineId={ticketSelectionBySeatId}
              onTicketChange={(lineId, ticketTypeId) => setTicketSelectionBySeatId((prev) => ({ ...prev, [lineId]: ticketTypeId }))}
              onRemoveLine={(lineId) => {
                if (seatSelectionEnabled) {
                  updateSelectedSeatIds((current) => current.filter((seatId) => seatId !== lineId));
                } else {
                  setAssignForm((prev) => ({ ...prev, gaQuantityInput: String(Math.max(0, gaTicketQuantity - 1)) }));
                }
              }}
              onClearAll={() => {
                if (seatSelectionEnabled) setAssignForm((prev) => ({ ...prev, seatIdsInput: '' }));
                else setAssignForm((prev) => ({ ...prev, gaQuantityInput: '0' }));
                setTicketSelectionBySeatId({});
              }}
              missingTicketTypeCount={missingTicketTypeCount}
              formatTicketOptionLabel={formatTicketOptionLabel}
            />

            <div className="mt-4 rounded-2xl border border-stone-200 bg-white px-4 py-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-red-600">Order Summary</p>
                <p className="text-2xl font-black text-stone-900">${(selectedTierSubtotalCents / 100).toFixed(2)}</p>
              </div>
              <div className="mt-2 space-y-1">
                {selectedTierBreakdown.map((item) => (
                  <div key={`${item.name}-${item.priceCents}`} className="flex justify-between text-sm text-stone-700">
                    <span>{item.name} ×{item.count}</span>
                    <span>${((item.priceCents * item.count) / 100).toFixed(2)}</span>
                  </div>
                ))}
                {!selectedTierBreakdown.length && <p className="text-sm text-stone-500">No items in this sale.</p>}
              </div>
              {hasMixedCompSelection && (
                <p className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                  Teacher and Student in Show complimentary tickets cannot be mixed in one order.
                </p>
              )}
            </div>

            {terminalDispatch && (
              <div className="mt-4">
                <PosTerminalStatus
                  dispatch={terminalDispatch}
                  inlineTitle={dispatchInlineStatus.title}
                  inlineDetail={dispatchInlineStatus.detail}
                  tone={dispatchInlineStatus.tone}
                  streamConnected={sellerStatusStream.connected}
                  actionBusy={terminalDispatchActionBusy}
                  onRetry={() => void retryTerminalDispatch()}
                  onCancel={() => void cancelTerminalDispatch()}
                  onAcknowledgeSuccess={() => finalizeSuccessfulTerminalDispatch(terminalDispatch)}
                  onClose={() => setTerminalDispatch(null)}
                />
              </div>
            )}

            <PosPaymentPanel
              source={assignForm.source}
              totalCents={selectedTierSubtotalCents}
              customerName={assignForm.customerName}
              customerEmail={assignForm.customerEmail}
              sendCompEmail={assignForm.sendEmail}
              onCustomerNameChange={(value) => setAssignForm((prev) => ({ ...prev, customerName: value }))}
              onCustomerEmailChange={(value) => {
                setAssignForm((prev) => ({ ...prev, customerEmail: value }));
                if (assignForm.source === 'DOOR') setReceiptEmail(value);
              }}
              onToggleSendCompEmail={() => setAssignForm((prev) => ({ ...prev, sendEmail: !prev.sendEmail }))}
              paymentMethod={paymentMethod}
              stripeChargePath={stripeChargePath}
              isComplimentaryDoorCheckout={isComplimentaryDoorCheckout}
              onPaymentMethodChange={setPaymentMethod}
              onStripeChargePathChange={setStripeChargePath}
              terminalDevices={terminalDevices}
              selectedTerminalDeviceId={selectedTerminalDeviceId}
              selectedTerminalBusy={Boolean(selectedTerminalDevice?.isBusy)}
              loadingTerminalDevices={loadingTerminalDevices}
              onSelectedTerminalDeviceIdChange={setSelectedTerminalDeviceId}
              onRefreshTerminalDevices={() => void loadTerminalDevices()}
              sendReceipt={sendReceipt}
              receiptEmail={receiptEmail}
              onToggleSendReceipt={() => setSendReceipt((prev) => !prev)}
              onReceiptEmailChange={setReceiptEmail}
              showStudentCode={hasStudentInShowCompSelection}
              studentCode={studentCode}
              onStudentCodeChange={setStudentCode}
              cashTonightLabel={
                loadingCashTonight
                  ? 'Loading cash total…'
                  : `Cash collected tonight: $${((cashTonight?.totalCashCents || 0) / 100).toFixed(2)} (${cashTonight?.saleCount || 0} sale${(cashTonight?.saleCount || 0) !== 1 ? 's' : ''})`
              }
              flowError={inPersonFlowError}
              submitDisabled={submitDisabled}
              submitting={inPersonSubmitting || manualCheckoutLoading}
              submitLabel={submitLabel}
              onSubmit={handlePrimarySubmit}
            />
          </div>
        }
      />

      {/* Sale Recap */}
      <PosRecapPanel
        open={Boolean(saleRecap)}
        paymentMethod={saleRecap?.paymentMethod || 'CASH'}
        expectedAmountCents={saleRecap?.expectedAmountCents || 0}
        seats={(saleRecap?.seats || []) as PosSaleRecapSeat[]}
        secondsLeft={saleRecapSecondsLeft}
        onClose={() => setSaleRecap(null)}
        onExtend={() => setSaleRecap((prev) => prev ? { ...prev, expiresAtMs: Math.max(prev.expiresAtMs, Date.now()) + 10000 } : prev)}
      />

      {/* Manual Stripe Checkout Modal */}
      <AnimatePresence>
        {manualCheckout && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[115] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
            <motion.div initial={{ y: 12, opacity: 0, scale: 0.98 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ y: 12, opacity: 0, scale: 0.98 }} className="w-full max-w-xl rounded-3xl border border-stone-200 bg-white text-stone-900 shadow-2xl">
              <div className="border-b border-stone-200 px-6 py-5">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-red-600">Manual checkout</p>
                <h2 className="mt-1 text-2xl font-black" style={{ fontFamily: 'Georgia, serif' }}>Enter card details</h2>
                <p className="mt-1 text-sm text-stone-500">
                  ${(manualCheckout.expectedAmountCents / 100).toFixed(2)} · {manualCheckout.seatIds.length} ticket{manualCheckout.seatIds.length === 1 ? '' : 's'}
                </p>
              </div>

              <div className="space-y-4 px-6 py-5">
                {manualCheckoutError && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{manualCheckoutError}</div>}

                {manualCapturedPaymentIntentId ? (
                  <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-4 text-sm text-amber-900">
                    <p>Charge succeeded ({manualCapturedPaymentIntentId}), but final order confirmation needs one more attempt.</p>
                    <button type="button" onClick={() => { if (manualCapturedPaymentIntentId) void finalizeManualCheckout(manualCapturedPaymentIntentId); }} disabled={manualCheckoutCompleting} className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 py-2.5 font-semibold text-white transition hover:bg-amber-700 disabled:opacity-60">
                      {manualCheckoutCompleting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      Retry finalization
                    </button>
                  </div>
                ) : manualStripePromise && manualStripeOptions ? (
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
                  <div className="rounded-xl border border-stone-300 bg-stone-50 px-4 py-3 text-sm text-stone-600">Loading secure Stripe card form…</div>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-stone-200 px-6 py-4">
                <button type="button" onClick={closeManualCheckout} disabled={manualCheckoutCompleting} className="inline-flex items-center justify-center rounded-full border border-stone-300 bg-white px-4 py-2.5 text-sm font-bold text-stone-700 transition hover:bg-stone-100 disabled:opacity-60">
                  Close
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Seat Map Modal */}
      <AnimatePresence>
        {seatPickerOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[105] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-4">
            <motion.div initial={{ scale: 0.96, opacity: 0, y: 16 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.96, opacity: 0, y: 16 }} className="flex h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-stone-200 bg-stone-50 text-stone-900 shadow-2xl sm:h-auto sm:max-h-[90dvh] sm:max-w-6xl sm:rounded-3xl">
              <div className="flex-shrink-0 border-b border-stone-200 px-5 pb-4 pt-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-bold">Select seats</p>
                    <p className="mt-0.5 text-xs text-stone-500">{selectedPerformance?.title ?? 'No performance selected'}</p>
                  </div>
                  <button type="button" onClick={() => setSeatPickerOpen(false)} className="rounded-full p-1.5 text-stone-500 transition hover:bg-stone-100 hover:text-stone-900">
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <div className="mt-3 flex items-center gap-3 text-xs text-stone-500">
                  <button type="button" onClick={() => void loadSeatsForPerformance(assignForm.performanceId)} className="inline-flex items-center gap-1 rounded-full border border-stone-300 bg-white px-3 py-1.5 font-semibold text-stone-700 transition hover:bg-stone-100">
                    <RefreshCw className="h-3.5 w-3.5" /> Refresh
                  </button>
                  <span className="font-semibold text-stone-700">{seatIds.length} seat{seatIds.length !== 1 ? 's' : ''} selected</span>
                </div>
              </div>

              <div className="flex-shrink-0 border-b border-stone-200 px-5 py-3">
                <div className="flex flex-wrap gap-1.5">
                  {['All', ...sections].map((section) => (
                    <button key={section} type="button" onClick={() => setActiveSection(section)} className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${activeSection === section ? 'bg-red-700 text-white' : 'bg-stone-200 text-stone-700 hover:bg-stone-300'}`}>
                      {section}
                    </button>
                  ))}
                </div>
              </div>

              {seatPickerError && (
                <div className="px-5 pt-3">
                  <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
                    <AlertCircle className="h-4 w-4 flex-shrink-0" /> {seatPickerError}
                  </div>
                </div>
              )}

              <div className="min-h-0 flex-1 px-5 pb-2 pt-3">
                <div className="h-full overflow-hidden rounded-2xl border border-stone-200 bg-white">
                  <SeatMapViewport
                    seats={seats}
                    visibleSeats={visibleSeats}
                    loading={loadingSeats}
                    loadingLabel="Loading seats…"
                    emptyText="No seats for this performance."
                    resetKey={assignForm.performanceId || 'admin-pos-seat-map'}
                    containerClassName="h-[420px] sm:h-full"
                    verticalAlign="top"
                    controlsClassName="absolute bottom-4 right-4 z-30 flex flex-col gap-2"
                    renderSeat={({ seat, x, y }) => {
                      const isSelected = selectedSeatIdSet.has(seat.id);
                      const isUnavailable = seat.status !== 'available';
                      const companionOk = !seat.isCompanion || isSelected || (seat.companionForSeatId ? selectedSeatIdSet.has(seat.companionForSeatId) : true);
                      const selectable = !isUnavailable && companionOk;

                      return (
                        <button
                          key={seat.id}
                          type="button"
                          onClick={() => toggleSeat(seat.id)}
                          disabled={!isSelected && !selectable}
                          style={{ left: `${x}px`, top: `${y}px` }}
                          className={[
                            'seat-button absolute flex h-8 w-8 items-center justify-center rounded-t-lg rounded-b-md text-[10px] font-bold transition-all duration-150 md:h-10 md:w-10',
                            isSelected
                              ? 'z-10 scale-110 bg-emerald-500 text-white shadow-lg ring-2 ring-emerald-300'
                              : isUnavailable
                                ? 'cursor-not-allowed bg-stone-300 text-stone-500'
                                : seat.isCompanion
                                  ? 'border-2 border-cyan-400 bg-cyan-100 text-cyan-900 hover:-translate-y-1 hover:shadow-md'
                                  : seat.isAccessible
                                    ? 'border-2 border-blue-400 bg-blue-100 text-blue-900 hover:-translate-y-1 hover:shadow-md'
                                    : 'border-2 border-stone-200 bg-white text-stone-700 hover:-translate-y-1 hover:border-red-400 hover:shadow-md',
                          ].join(' ')}
                        >
                          {seat.number}
                        </button>
                      );
                    }}
                  />
                </div>
              </div>

              <div className="flex-shrink-0 border-t border-stone-200 px-5 py-4">
                <div className="mb-3 min-h-[32px]">
                  {selectedMappedSeats.length === 0 && selectedUnknownSeatIds.length === 0 ? (
                    <p className="text-sm text-stone-500">No seats selected yet.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {selectedMappedSeats.map((seat) => (
                        <button key={seat.id} type="button" onClick={() => toggleSeat(seat.id)} className="inline-flex items-center gap-1.5 rounded-xl border border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold text-stone-700 transition hover:border-red-300">
                          {seat.sectionName} {seat.row}-{seat.number} <X className="h-3 w-3" />
                        </button>
                      ))}
                      {selectedUnknownSeatIds.map((id) => (
                        <button key={id} type="button" onClick={() => toggleSeat(id)} className="inline-flex items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 transition hover:bg-amber-100">
                          {id} <X className="h-3 w-3" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex justify-end">
                  <button type="button" onClick={() => setSeatPickerOpen(false)} className="inline-flex items-center gap-2 rounded-full bg-red-700 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-red-800">
                    Confirm seats <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}