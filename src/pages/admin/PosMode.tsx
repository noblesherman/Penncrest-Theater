/*
Handoff note for Mr. Smith:
- File: `src/pages/admin/PosMode.tsx`
- What this is: Admin route page.
- What it does: Runs one full admin screen with data loading and operator actions.
- Connections: Wired from `src/App.tsx`; depends on admin auth helpers and backend admin routes.
- Main content type: Business logic + admin UI + visible wording.
- Safe edits here: Table labels, section copy, and presentational layout.
- Be careful with: Request/response contracts, auth checks, and state transitions tied to backend behavior.
- Useful context: Operationally sensitive area: UI polish is safe, contract changes need extra care.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
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
  ShoppingCart,
  CreditCard,
  Banknote,
  LogOut,
  ArrowRight,
} from 'lucide-react';

import { adminFetch } from '../../lib/adminAuth';
import { apiFetch } from '../../lib/api';
import { usePaymentLineStatusStream } from '../../hooks/usePaymentLineStatusStream';
import {
  readCashierDefaultPerformanceId,
  writeCashierDefaultPerformanceId,
} from '../../hooks/useCashierDefaultPerformance';

import type { PaymentLineEntry } from '../../lib/paymentLineTypes';
import { getPaymentLineUiError } from '../../lib/paymentLineErrors';
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
  type PosPerformanceOption,
  type PosSaleRecapSeat,
  type PosSelectionLine,
  type PosTerminalDispatch,
  type PosTerminalDevice,
  type PosTicketOption,
  PosStepper,
  PosButton,
  PosInput,
  PosSelect,
  PosCard,
  PosAlert,
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

    const options: PosTicketOption[] = selectedPerformance.pricingTiers
      .filter((tier) => !selectedPerformance.isFundraiser || !(tier.id === TEACHER_TICKET_OPTION_ID || isTeacherTicketName(tier.name)))
      .map((tier) => ({
        id: tier.id,
        name: tier.name,
        priceCents: tier.priceCents,
      }));

    const hasTeacher = options.some((o) => o.id === TEACHER_TICKET_OPTION_ID || isTeacherTicketName(o.name));
    if (!selectedPerformance.isFundraiser && selectedPerformance.staffCompsEnabled && !hasTeacher) {
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
      const items = await adminFetch<Array<any>>('/api/admin/performances?scope=active&kind=standard');

      const mapped = items
        .filter((item) => !item.isArchived && !item.isFundraiser)
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
      setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to load performances');
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
      setSeatPickerError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to load seats');
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
      const msg = err instanceof Error ? err.message : 'We could not start manual card checkout';
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
      const msg = err instanceof Error ? err.message : 'We could not finalize successful manual charge.';
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
      setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to assign seats');
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
          setInPersonFlowError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to start manual checkout');
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
        const { message, refreshTerminalDevices } = getPaymentLineUiError(
          err,
          'We hit a small backstage snag while trying to send sale to payment line.'
        );
        setInPersonFlowError(message);
        if (refreshTerminalDevices) {
          void loadTerminalDevices();
        }
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
      setInPersonFlowError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to finalize in-person sale');
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
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 to-stone-50">
        <motion.div className="flex flex-col items-center gap-4" animate={{ scale: [0.95, 1, 0.95] }} transition={{ duration: 2, repeat: Infinity }}>
          <div className="h-12 w-12 rounded-full border-4 border-stone-200 border-t-blue-600 animate-spin" />
          <p className="text-sm text-stone-600 font-medium">Loading POS System...</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-stone-50 via-blue-50 to-stone-50">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-3xl font-black text-stone-900">POS System</h1>
              <p className="text-sm text-stone-600 mt-1">Fast in-person checkout</p>
            </div>
            <PosButton
              variant="secondary"
              onClick={() => navigate('/admin')}
              icon={LogOut}
            >
              Exit POS
            </PosButton>
          </div>

          {/* Alerts */}
          <div className="space-y-3">
            {error && <PosAlert variant="error" message={error} dismissible onDismiss={() => setError(null)} />}
            {notice && <PosAlert variant="success" message={notice} dismissible onDismiss={() => setNotice(null)} />}
          </div>
        </motion.div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Main Workflow */}
          <div className="lg:col-span-2 space-y-6">
            {/* Step 1: Select Performance */}
            <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 }}>
              <PosCard title="1. Select Performance" highlighted={!selectedPerformance}>
                <div className="space-y-4">
                  <PosSelect
                    label="Performance"
                    value={assignForm.performanceId}
                    options={performances.map((p) => ({ value: p.id, label: `${p.title} - ${new Date(p.startsAt).toLocaleString()}` }))}
                    onChange={(e) => {
                      setAssignForm({ ...assignForm, performanceId: e.target.value, seatIdsInput: '', gaQuantityInput: '1' });
                      setTicketSelectionBySeatId({});
                    }}
                    placeholderText="Choose a performance..."
                    icon={<Ticket className="h-5 w-5" />}
                  />
                  {selectedPerformance && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <p className="text-sm font-semibold text-stone-900">Ticket Options:</p>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {selectedTicketOptions.map((opt) => (
                          <span key={opt.id} className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-xs font-medium border border-blue-200">
                            {opt.name} <span className="text-blue-600 font-bold">${(opt.priceCents / 100).toFixed(2)}</span>
                          </span>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </div>
              </PosCard>
            </motion.div>

            {/* Sale Type */}
            {selectedPerformance && (
              <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 }}>
                <PosCard title="Sale Type">
                  <div className="flex gap-3">
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => setAssignForm({ ...assignForm, source: 'DOOR' })}
                      className={`flex-1 rounded-lg border-2 p-4 text-center transition-all ${
                        assignForm.source === 'DOOR'
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-stone-200 bg-stone-50 hover:border-stone-300'
                      }`}
                    >
                      <CreditCard className="h-6 w-6 mx-auto mb-2 text-blue-600" />
                      <p className="font-semibold text-stone-900">Door Sale</p>
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => setAssignForm({ ...assignForm, source: 'COMP' })}
                      className={`flex-1 rounded-lg border-2 p-4 text-center transition-all ${
                        assignForm.source === 'COMP'
                          ? 'border-emerald-500 bg-emerald-50'
                          : 'border-stone-200 bg-stone-50 hover:border-stone-300'
                      }`}
                    >
                      <Ticket className="h-6 w-6 mx-auto mb-2 text-emerald-600" />
                      <p className="font-semibold text-stone-900">Comp Ticket</p>
                    </motion.button>
                  </div>
                </PosCard>
              </motion.div>
            )}

            {/* Step 2: Build Order */}
            {selectedPerformance && (
              <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }}>
                <PosCard title="2. Build Order">
                  <div className="space-y-4">
                    {seatSelectionEnabled ? (
                      <div className="space-y-3">
                        <PosInput
                          label="Seat IDs"
                          value={assignForm.seatIdsInput}
                          onChange={(e) => setAssignForm({ ...assignForm, seatIdsInput: e.target.value })}
                          placeholder="E.g., A12, A13, A14 or A12-A14"
                          icon={<MapPin className="h-5 w-5" />}
                          helperText={`${seatIds.length} seat${seatIds.length !== 1 ? 's' : ''} selected`}
                        />
                        <PosButton
                          variant="secondary"
                          fullWidth
                          onClick={() => setSeatPickerOpen(!seatPickerOpen)}
                          icon={seatPickerOpen ? X : MapPin}
                        >
                          {seatPickerOpen ? 'Hide Seat Map' : 'Open Seat Map'}
                        </PosButton>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <p className="text-sm font-semibold text-stone-700">Quantity</p>
                        <div className="flex items-center gap-3">
                          <PosButton
                            variant="secondary"
                            size="lg"
                            onClick={() => setAssignForm({ ...assignForm, gaQuantityInput: String(Math.max(0, gaTicketQuantity - 1)) })}
                            icon={Minus}
                          >
                            Decrease
                          </PosButton>
                          <div className="flex-1 rounded-lg border-2 border-stone-200 bg-stone-50 py-3 text-center text-3xl font-black text-stone-900">
                            {gaTicketQuantity}
                          </div>
                          <PosButton
                            variant="secondary"
                            size="lg"
                            onClick={() => setAssignForm({ ...assignForm, gaQuantityInput: String(Math.min(50, gaTicketQuantity + 1)) })}
                            icon={Plus}
                          >
                            Increase
                          </PosButton>
                        </div>
                      </div>
                    )}
                  </div>
                </PosCard>
              </motion.div>
            )}

            {/* Seat Picker Modal */}
            <AnimatePresence>
              {seatPickerOpen && assignForm.performanceId && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
                >
                  <motion.div
                    initial={{ scale: 0.95, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.95, opacity: 0 }}
                    className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto border-2 border-stone-200"
                  >
                    <div className="sticky top-0 bg-white border-b-2 border-stone-200 p-4 flex items-center justify-between">
                      <div>
                        <h2 className="text-xl font-bold">Select Seats</h2>
                        <p className="text-sm text-stone-600">{seatIds.length} seat{seatIds.length !== 1 ? 's' : ''} selected</p>
                      </div>
                      <PosButton variant="ghost" onClick={() => setSeatPickerOpen(false)} icon={X}>Close</PosButton>
                    </div>

                    {loadingSeats ? (
                      <div className="p-12 text-center">
                        <motion.div className="inline-block" animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity }}>
                          <div className="h-8 w-8 rounded-full border-4 border-stone-300 border-t-blue-600" />
                        </motion.div>
                        <p className="mt-3 text-sm text-stone-600">Loading seat map...</p>
                      </div>
                    ) : (
                      <div className="p-4 space-y-4">
                        <div className="flex flex-wrap gap-2">
                          {['All', ...sections].map((section) => (
                            <motion.button
                              key={section}
                              whileHover={{ scale: 1.05 }}
                              whileTap={{ scale: 0.95 }}
                              onClick={() => setActiveSection(section)}
                              className={`rounded-full px-4 py-2 text-sm font-semibold transition-all ${
                                activeSection === section
                                  ? 'bg-blue-600 text-white shadow-lg'
                                  : 'bg-stone-200 text-stone-700 hover:bg-stone-300'
                              }`}
                            >
                              {section}
                            </motion.button>
                          ))}
                        </div>
                        <div className="grid grid-cols-auto gap-2 p-4 bg-stone-50 rounded-lg border-2 border-stone-200 max-h-96 overflow-y-auto">
                          {visibleSeats.map((seat) => {
                            const isSelected = selectedSeatIdSet.has(seat.id);
                            const isAvailable = seat.status === 'available';

                            return (
                              <motion.button
                                key={seat.id}
                                whileHover={isAvailable ? { scale: 1.1 } : {}}
                                whileTap={isAvailable ? { scale: 0.9 } : {}}
                                onClick={() => {
                                  if (!isAvailable) return;
                                  const newInput = isSelected
                                    ? assignForm.seatIdsInput
                                        .split(/[,\s]+/)
                                        .filter((s) => s !== seat.id)
                                        .join(', ')
                                    : (assignForm.seatIdsInput.trim() ? assignForm.seatIdsInput + ', ' : '') + seat.id;
                                  setAssignForm({ ...assignForm, seatIdsInput: newInput });
                                }}
                                disabled={!isAvailable && !isSelected}
                                className={`p-2 rounded-lg font-semibold text-xs transition-all ${
                                  isSelected
                                    ? 'bg-blue-600 text-white shadow-lg scale-110'
                                    : isAvailable
                                      ? 'bg-emerald-100 text-emerald-900 hover:bg-emerald-200'
                                      : 'bg-stone-200 text-stone-500 cursor-not-allowed opacity-50'
                                }`}
                              >
                                {seat.row}
                                {seat.number}
                              </motion.button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="border-t-2 border-stone-200 bg-stone-50 p-4 flex gap-2 justify-end">
                      <PosButton variant="secondary" onClick={() => setSeatPickerOpen(false)}>Cancel</PosButton>
                      <PosButton variant="primary" onClick={() => setSeatPickerOpen(false)} icon={Check}>Confirm</PosButton>
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Step 3: Ticket Types */}
            {selectionIds.length > 0 && (
              <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.25 }}>
                <PosCard title="3. Assign Ticket Types" highlighted={missingTicketTypeCount > 0}>
                  <div className="space-y-3 max-h-64 overflow-y-auto">
                    {selectedLines.map((line) => (
                      <div key={line.id} className="flex items-center gap-3 rounded-lg border-2 border-stone-200 p-3 bg-stone-50 hover:border-blue-300 transition-all">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-stone-900">{line.label}</p>
                          <p className="text-xs text-stone-600">${(line.seatPriceCents / 100).toFixed(2)}</p>
                        </div>
                        <select
                          value={ticketSelectionBySeatId[line.id] || ''}
                          onChange={(e) =>
                            setTicketSelectionBySeatId({
                              ...ticketSelectionBySeatId,
                              [line.id]: e.target.value,
                            })
                          }
                          className="rounded-lg border-2 border-stone-200 bg-white px-3 py-2 text-sm font-semibold transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                        >
                          <option value="">Select...</option>
                          {selectedTicketOptions.map((opt) => (
                            <option key={opt.id} value={opt.id}>
                              {opt.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                  {missingTicketTypeCount > 0 && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-3 rounded-lg bg-amber-50 border-2 border-amber-200 p-3">
                      <p className="text-xs font-semibold text-amber-900 flex items-center gap-2">
                        <AlertCircle className="h-4 w-4" />
                        Assign ticket types to all items ({missingTicketTypeCount} remaining)
                      </p>
                    </motion.div>
                  )}
                </PosCard>
              </motion.div>
            )}
          </div>

          {/* Right Column - Order Summary */}
          <div>
            <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 }} className="sticky top-6">
              <PosCard highlighted title="Order Summary">
                <div className="space-y-6">
                  {/* Performance */}
                  {selectedPerformance && (
                    <div>
                      <p className="text-xs font-semibold text-stone-600 uppercase">Performance</p>
                      <p className="mt-1 font-semibold text-stone-900">{selectedPerformance.title}</p>
                      <p className="text-xs text-stone-600 mt-0.5">{new Date(selectedPerformance.startsAt).toLocaleString()}</p>
                    </div>
                  )}

                  {/* Total */}
                  <div className="border-t-2 border-stone-200 pt-4">
                    <div className="flex items-center justify-between">
                      <span className="text-lg font-black text-stone-900">Total</span>
                      <span className="text-2xl font-black text-blue-600">${(selectedTierSubtotalCents / 100).toFixed(2)}</span>
                    </div>
                  </div>

                  {/* Items */}
                  {selectionIds.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-stone-600 uppercase mb-2">Items ({selectionIds.length})</p>
                      <div className="space-y-1">
                        {selectedTierBreakdown.map((item) => (
                          <div key={`${item.name}-${item.priceCents}`} className="flex items-center justify-between py-1 border-b border-stone-200">
                            <span className="text-sm text-stone-700">{item.name} ×{item.count}</span>
                            <span className="text-sm font-semibold text-stone-900">${((item.priceCents * item.count) / 100).toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Cash Collected */}
                  {assignForm.source === 'DOOR' && cashTonight && (
                    <div className="bg-emerald-50 border-2 border-emerald-200 rounded-lg p-3">
                      <p className="text-xs font-semibold text-emerald-900">Cash collected tonight</p>
                      <p className="text-xl font-black text-emerald-600 mt-1">${(cashTonight.totalCashCents / 100).toFixed(2)}</p>
                      <p className="text-xs text-emerald-800 mt-1">{cashTonight.saleCount} sale{cashTonight.saleCount !== 1 ? 's' : ''}</p>
                    </div>
                  )}

                  {/* Checkout Button */}
                  <PosButton
                    variant={missingTicketTypeCount === 0 && selectionIds.length > 0 ? 'success' : 'secondary'}
                    size="lg"
                    fullWidth
                    isLoading={inPersonSubmitting}
                    onClick={() => {
                      if (assignForm.source === 'COMP') void assignOrder();
                      else void finalizeInPersonSale();
                    }}
                    disabled={missingTicketTypeCount > 0 || selectionIds.length === 0}
                    icon={ShoppingCart}
                  >
                    Complete Sale
                  </PosButton>

                  {/* Payment Method */}
                  {selectionIds.length > 0 && assignForm.source === 'DOOR' && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-stone-600 uppercase">Payment</p>
                      <div className="flex gap-2">
                        <motion.button
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => setPaymentMethod('STRIPE')}
                          className={`flex-1 rounded-lg border-2 p-2 text-center transition-all ${
                            paymentMethod === 'STRIPE'
                              ? 'border-blue-500 bg-blue-50'
                              : 'border-stone-200 bg-stone-50 hover:border-stone-300'
                          }`}
                        >
                          <CreditCard className="h-4 w-4 mx-auto mb-1" />
                          <p className="text-xs font-semibold">Card</p>
                        </motion.button>
                        <motion.button
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => setPaymentMethod('CASH')}
                          className={`flex-1 rounded-lg border-2 p-2 text-center transition-all ${
                            paymentMethod === 'CASH'
                              ? 'border-emerald-500 bg-emerald-50'
                              : 'border-stone-200 bg-stone-50 hover:border-stone-300'
                          }`}
                        >
                          <Banknote className="h-4 w-4 mx-auto mb-1" />
                          <p className="text-xs font-semibold">Cash</p>
                        </motion.button>
                      </div>
                    </div>
                  )}
                </div>
              </PosCard>
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
}
