import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { adminFetch } from '../../lib/adminAuth';
import { apiFetch } from '../../lib/api';
import { usePaymentLineStatusStream } from '../../hooks/usePaymentLineStatusStream';
import type { PaymentLineEntry } from '../../lib/paymentLineTypes';
import { SeatMapViewport } from '../../components/SeatMapViewport';
import {
  Search, X, Check, ChevronRight, ChevronLeft,
  Hash, Ticket, Plus, ExternalLink, AlertCircle,
  CheckCircle2, RefreshCw, CreditCard, Banknote,
  ArrowRight, MapPin, Tag, Users, Zap, Clock,
  TrendingUp, Filter, MoreHorizontal, Circle
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

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
  id: string; title: string; startsAt: string; isFundraiser?: boolean;
  pricingTiers: PricingTier[];
  staffCompsEnabled?: boolean; studentCompTicketsEnabled?: boolean; seatSelectionEnabled?: boolean;
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
  id: string; label: string; sectionName: string; row: string; number: number; seatPriceCents: number;
};
type InPersonCashTonightSummary = {
  totalCashCents: number; saleCount: number;
  nightStartIso: string; nightEndIso: string; performanceId: string | null;
};
type InPersonFinalizeSeatSummary = {
  id: string; sectionName: string; row: string; number: number; ticketType: string; priceCents: number;
};
type InPersonSaleRecap = {
  expectedAmountCents: number; paymentMethod: 'STRIPE' | 'CASH';
  seats: InPersonFinalizeSeatSummary[]; expiresAtMs: number;
};
type TerminalDevice = {
  deviceId: string; name: string; lastHeartbeatAt: string; isBusy: boolean;
};
type TerminalDispatch = {
  dispatchId: string;
  status: 'PENDING' | 'DELIVERED' | 'PROCESSING' | 'FAILED' | 'SUCCEEDED' | 'EXPIRED' | 'CANCELED';
  failureReason?: string | null; holdExpiresAt: string; holdActive: boolean; canRetry: boolean;
  expectedAmountCents: number; currency: string; attemptCount: number;
  finalOrderId?: string | null; targetDeviceId: string; targetDeviceName?: string | null;
  seatCount: number; seats: InPersonFinalizeSeatSummary[];
};

function mapEntryToTerminalDispatch(entry: PaymentLineEntry): TerminalDispatch {
  return {
    dispatchId: entry.entryId, status: entry.status,
    failureReason: entry.failureReason, holdExpiresAt: entry.holdExpiresAt,
    holdActive: entry.holdActive, canRetry: entry.canRetry,
    expectedAmountCents: entry.expectedAmountCents, currency: entry.currency,
    attemptCount: entry.attemptCount, finalOrderId: entry.finalOrderId,
    targetDeviceId: entry.targetDeviceId, targetDeviceName: entry.targetDeviceName,
    seatCount: entry.seatCount,
    seats: entry.seats.map((s) => ({
      id: s.id, sectionName: s.sectionName, row: s.row,
      number: s.number, ticketType: s.ticketType, priceCents: s.priceCents
    }))
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const TEACHER_TICKET_OPTION_ID = 'teacher-comp';
const STUDENT_SHOW_TICKET_OPTION_ID = 'student-show-comp';
const MAX_TEACHER_COMP_TICKETS = 2;
const MAX_STUDENT_COMP_TICKETS = 2;
const CASHIER_DEFAULT_PERFORMANCE_STORAGE_KEY = 'theater_cashier_default_performance_v1';

const STEPS = [
  { id: 'show',    label: 'Performance', icon: Ticket },
  { id: 'seats',   label: 'Seats',       icon: MapPin },
  { id: 'tickets', label: 'Checkout',    icon: Tag },
];

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const naturalSort = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

const parseSeatIds = (input: string) =>
  [...new Set(input.split(',').map(v => v.trim()).filter((v): v is string => Boolean(v)))];

const buildGeneralAdmissionLineIds = (quantity: number) =>
  Array.from({ length: Math.max(0, Math.min(quantity, 50)) }, (_, i) => `ga-${i + 1}`);

const readCashierDefaultPerformanceId = (): string => {
  if (typeof window === 'undefined') return '';
  try { return window.localStorage.getItem(CASHIER_DEFAULT_PERFORMANCE_STORAGE_KEY) || ''; }
  catch { return ''; }
};

const writeCashierDefaultPerformanceId = (performanceId: string): void => {
  if (typeof window === 'undefined') return;
  try {
    if (!performanceId) { window.localStorage.removeItem(CASHIER_DEFAULT_PERFORMANCE_STORAGE_KEY); return; }
    window.localStorage.setItem(CASHIER_DEFAULT_PERFORMANCE_STORAGE_KEY, performanceId);
  } catch { /* ignore */ }
};

const isTeacherTicketName = (name: string) => {
  const n = name.trim().toLowerCase();
  return n.includes('teacher') || (n.includes('rtmsd') && n.includes('staff'));
};
const isStudentInShowTicketName = (name: string) =>
  name.trim().toLowerCase().includes('student in show');

function pickComplimentarySeatIds(
  seats: Array<{ id: string; sectionName: string; row: string; number: number; basePriceCents: number }>,
  quantity: number
): Set<string> {
  if (quantity <= 0) return new Set();
  const ranked = [...seats].sort((a, b) => {
    if (a.basePriceCents !== b.basePriceCents) return b.basePriceCents - a.basePriceCents;
    if (a.sectionName !== b.sectionName) return naturalSort(a.sectionName, b.sectionName);
    if (a.row !== b.row) return naturalSort(a.row, b.row);
    return a.number - b.number;
  });
  return new Set(ranked.slice(0, quantity).map(s => s.id));
}

function normalizeSeat(raw: any): Seat {
  const rawStatus = String(raw?.status || 'available').toLowerCase();
  const status: Seat['status'] = ['available', 'held', 'sold', 'blocked'].includes(rawStatus)
    ? (rawStatus as Seat['status']) : 'available';
  const sectionOffset = raw?.sectionName === 'LEFT' ? 0 : raw?.sectionName === 'CENTER' ? 700 : 1400;
  const rowCode = String(raw?.row || 'A').charCodeAt(0) || 65;
  return {
    id: String(raw?.id || ''), sectionName: String(raw?.sectionName || 'Unknown'),
    row: String(raw?.row || ''), number: Number(raw?.number || 0),
    x: Number.isFinite(Number(raw?.x)) ? Number(raw.x) : sectionOffset + Number(raw?.number || 0) * 36,
    y: Number.isFinite(Number(raw?.y)) ? Number(raw.y) : (rowCode - 65) * 40,
    price: Number(raw?.price || 0), status,
    isAccessible: Boolean(raw?.isAccessible), isCompanion: Boolean(raw?.isCompanion),
    companionForSeatId: raw?.companionForSeatId ?? null,
  };
}

const fmtDollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

// ─────────────────────────────────────────────────────────────────────────────
// STATUS / SOURCE METADATA
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  PAID:     { label: 'Paid',     color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200' },
  PENDING:  { label: 'Pending',  color: 'text-amber-700',   bg: 'bg-amber-50 border-amber-200'     },
  REFUNDED: { label: 'Refunded', color: 'text-slate-500',   bg: 'bg-slate-50 border-slate-200'     },
  CANCELED: { label: 'Canceled', color: 'text-red-600',     bg: 'bg-red-50 border-red-200'         },
};

const SOURCE_META: Record<string, { label: string; color: string }> = {
  ONLINE:       { label: 'Online',  color: 'text-blue-700'   },
  DOOR:         { label: 'Door',    color: 'text-violet-700' },
  COMP:         { label: 'Comp',    color: 'text-slate-500'  },
  STAFF_FREE:   { label: 'Staff',   color: 'text-amber-700'  },
  STAFF_COMP:   { label: 'Staff',   color: 'text-amber-700'  },
  FAMILY_FREE:  { label: 'Family',  color: 'text-pink-700'   },
  STUDENT_COMP: { label: 'Student', color: 'text-indigo-700' },
};

// ─────────────────────────────────────────────────────────────────────────────
// SMALL COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: string }) {
  const m = STATUS_META[status] ?? { label: status, color: 'text-slate-500', bg: 'bg-slate-50 border-slate-200' };
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-bold tracking-wide uppercase ${m.color} ${m.bg}`}>
      {m.label}
    </span>
  );
}

function SourceTag({ source }: { source: string }) {
  const m = SOURCE_META[source] ?? { label: source, color: 'text-slate-500' };
  return <span className={`text-[11px] font-semibold uppercase tracking-wide ${m.color}`}>{m.label}</span>;
}

function Label({ children }: { children: ReactNode }) {
  return <p className="mb-1.5 text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">{children}</p>;
}

function Alert({ type, children }: { type: 'error' | 'warn' | 'info'; children: ReactNode }) {
  const styles = {
    error: 'border-red-200 bg-red-50 text-red-700',
    warn: 'border-amber-200 bg-amber-50 text-amber-800',
    info: 'border-blue-200 bg-blue-50 text-blue-800',
  }[type];
  const icons = { error: AlertCircle, warn: AlertCircle, info: AlertCircle };
  const Icon = icons[type];
  return (
    <div className={`flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm ${styles}`}>
      <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <span>{children}</span>
    </div>
  );
}

// ── Input styles ─────────────────────────────────────────────────────────────
const inp = 'w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-300 transition focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-200';
const sel = inp + ' cursor-pointer';

// ── Toggle ────────────────────────────────────────────────────────────────────
function Toggle({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-3">
      <button
        type="button"
        onClick={onToggle}
        className={`relative h-5 w-9 flex-shrink-0 rounded-full transition-colors ${on ? 'bg-slate-900' : 'bg-slate-200'}`}
        role="switch"
        aria-checked={on}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </button>
      <span className="text-sm text-slate-700">{label}</span>
    </label>
  );
}

// ── Btn ────────────────────────────────────────────────────────────────────
function Btn({
  onClick, disabled, children, variant = 'primary', size = 'md', className = '', type = 'button'
}: {
  onClick?: () => void; disabled?: boolean; children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg'; className?: string; type?: 'button' | 'submit';
}) {
  const variantCls = {
    primary:   'bg-slate-900 text-white hover:bg-slate-700 disabled:bg-slate-300',
    secondary: 'bg-white border border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50',
    ghost:     'text-slate-500 hover:bg-slate-100 hover:text-slate-800',
    danger:    'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300',
  }[variant];
  const sizeCls = { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2.5 text-sm', lg: 'px-6 py-3 text-sm' }[size];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${variantCls} ${sizeCls} ${className}`}
    >
      {children}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function AdminOrdersPage() {
  // ── Core data state ────────────────────────────────────────────────────────
  const [rows,          setRows]          = useState<Order[]>([]);
  const [query,         setQuery]         = useState('');
  const [status,        setStatus]        = useState('');
  const [sourceFilter,  setSourceFilter]  = useState('');
  const [scope,         setScope]         = useState<'active' | 'archived' | 'all'>('active');
  const [performances,  setPerformances]  = useState<Performance[]>([]);
  const [loadingRows,   setLoadingRows]   = useState(false);
  const [submitting,    setSubmitting]    = useState(false);
  const [error,         setError]         = useState<string | null>(null);
  const [notice,        setNotice]        = useState<string | null>(null);

  // ── Wizard state ────────────────────────────────────────────────────────────
  const [showWizard,    setShowWizard]    = useState(false);
  const [step,          setStep]          = useState(0);
  const [dir,           setDir]           = useState<1 | -1>(1);
  const [showPerfPicker, setShowPerfPicker] = useState(false);
  const [perfPickerDraftId, setPerfPickerDraftId] = useState('');

  // ── Seat picker state ───────────────────────────────────────────────────────
  const didAutoOpenSeatPickerRef = useRef(false);
  const selectedSeatIdsRef = useRef<string[]>([]);
  const [seatPickerOpen,  setSeatPickerOpen]  = useState(false);
  const [seats,           setSeats]           = useState<Seat[]>([]);
  const [loadingSeats,    setLoadingSeats]    = useState(false);
  const [seatPickerError, setSeatPickerError] = useState<string | null>(null);
  const [activeSection,   setActiveSection]   = useState('All');
  const [ticketSelectionBySeatId, setTicketSelectionBySeatId] = useState<Record<string, string>>({});

  // ── In-person / payment state ───────────────────────────────────────────────
  const [inPersonFlowError,   setInPersonFlowError]   = useState<string | null>(null);
  const [inPersonSubmitting,  setInPersonSubmitting]  = useState(false);
  const [paymentMethod,       setPaymentMethod]       = useState<'STRIPE' | 'CASH'>('STRIPE');
  const [receiptEmail,        setReceiptEmail]        = useState('');
  const [sendReceipt,         setSendReceipt]         = useState(false);
  const [studentCode,         setStudentCode]         = useState('');
  const [terminalDevices,     setTerminalDevices]     = useState<TerminalDevice[]>([]);
  const [loadingTerminals,    setLoadingTerminals]    = useState(false);
  const [selectedTerminalId,  setSelectedTerminalId]  = useState('');
  const [terminalDispatch,    setTerminalDispatch]    = useState<TerminalDispatch | null>(null);
  const [dispatchBusy,        setDispatchBusy]        = useState(false);
  const [cashTonight,         setCashTonight]         = useState<InPersonCashTonightSummary | null>(null);
  const [loadingCashTonight,  setLoadingCashTonight]  = useState(false);
  const [saleRecap,           setSaleRecap]           = useState<InPersonSaleRecap | null>(null);
  const [saleRecapSecsLeft,   setSaleRecapSecsLeft]   = useState(0);

  const [assignForm, setAssignForm] = useState<AssignForm>({
    performanceId: '', source: 'DOOR',
    customerName: '', customerEmail: '',
    seatIdsInput: '', gaQuantityInput: '1', ticketType: '', sendEmail: false,
  });

  // ── Seller status stream ────────────────────────────────────────────────────
  const sellerStatusStream = usePaymentLineStatusStream({
    queueKey: terminalDispatch?.targetDeviceId || null,
    sellerEntryId: terminalDispatch?.dispatchId || null,
    enabled: Boolean(terminalDispatch?.targetDeviceId)
  });

  // ─────────────────────────────────────────────────────────────────────────
  // DATA LOADING
  // ─────────────────────────────────────────────────────────────────────────

  const load = async () => {
    setLoadingRows(true); setError(null);
    try {
      const p = new URLSearchParams();
      if (query.trim()) p.set('q', query.trim());
      if (status) p.set('status', status);
      if (sourceFilter) p.set('source', sourceFilter);
      p.set('scope', scope);
      setRows(await adminFetch<Order[]>(`/api/admin/orders?${p.toString()}`));
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load orders'); }
    finally { setLoadingRows(false); }
  };

  const loadPerformances = async () => {
    try {
      const items = await adminFetch<Array<{
        id: string; title: string; startsAt: string;
        isArchived?: boolean; isFundraiser?: boolean;
        pricingTiers?: PricingTier[];
        staffCompsEnabled?: boolean; studentCompTicketsEnabled?: boolean; seatSelectionEnabled?: boolean;
      }>>('/api/admin/performances?scope=active&kind=all');
      const mapped = items.filter(i => !i.isArchived).map(i => ({
        id: i.id, title: i.title, startsAt: i.startsAt,
        isFundraiser: Boolean(i.isFundraiser),
        pricingTiers: i.pricingTiers || [],
        staffCompsEnabled: Boolean(i.staffCompsEnabled),
        studentCompTicketsEnabled: Boolean(i.studentCompTicketsEnabled),
        seatSelectionEnabled: i.seatSelectionEnabled !== false,
      }));
      setPerformances(mapped);
      if (mapped.length > 0) {
        const stored = readCashierDefaultPerformanceId();
        setAssignForm(prev => {
          const next =
            mapped.some(r => r.id === prev.performanceId) ? prev.performanceId
            : mapped.some(r => r.id === stored) ? stored
            : mapped[0].id;
          return { ...prev, performanceId: next };
        });
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to load performances'); }
  };

  const loadCashTonight = useCallback(async (performanceId: string) => {
    if (!performanceId) { setCashTonight(null); return; }
    setLoadingCashTonight(true);
    try {
      const p = new URLSearchParams({ performanceId });
      setCashTonight(await adminFetch<InPersonCashTonightSummary>(`/api/admin/orders/in-person/cash-tonight?${p.toString()}`));
    } catch { setCashTonight(null); }
    finally { setLoadingCashTonight(false); }
  }, []);

  const loadTerminalDevices = useCallback(async () => {
    setLoadingTerminals(true);
    try {
      const payload = await adminFetch<{ devices: TerminalDevice[] }>('/api/admin/orders/in-person/terminal/devices');
      setTerminalDevices(payload.devices);
      setSelectedTerminalId(prev => {
        if (prev && payload.devices.some(d => d.deviceId === prev)) return prev;
        return payload.devices[0]?.deviceId || '';
      });
    } catch {
      setTerminalDevices([]); setSelectedTerminalId('');
    } finally { setLoadingTerminals(false); }
  }, []);

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
        const unavailable = new Set(nextSeats.filter(s => s.status !== 'available').map(s => s.id));
        const removed = currentSeatIds.filter(id => unavailable.has(id));
        if (removed.length > 0) {
          setAssignForm(prev => ({
            ...prev,
            seatIdsInput: parseSeatIds(prev.seatIdsInput).filter(id => !unavailable.has(id)).join(', ')
          }));
          setTicketSelectionBySeatId(prev => {
            const next = { ...prev };
            removed.forEach(id => { delete next[id]; });
            return next;
          });
          setError(removed.length === 1
            ? 'A selected seat is no longer available — seating chart refreshed.'
            : `${removed.length} selected seats are no longer available — seating chart refreshed.`
          );
        }
      }
    } catch (e) {
      setSeatPickerError(e instanceof Error ? e.message : 'Failed to load seats');
    } finally {
      if (showLoading) setLoadingSeats(false);
    }
  }, []);

  // ── Effects ─────────────────────────────────────────────────────────────────
  useEffect(() => { void Promise.all([load(), loadPerformances()]); }, []);
  useEffect(() => { void load(); }, [scope]);
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
    if (!showWizard || assignForm.source !== 'DOOR' || paymentMethod !== 'STRIPE' || step !== 2) return;
    void loadTerminalDevices();
  }, [assignForm.source, loadTerminalDevices, paymentMethod, showWizard, step]);
  useEffect(() => { if (!showWizard || step !== 1 || !seatSelectionEnabled) setSeatPickerOpen(false); }, [seatSelectionEnabled, showWizard, step]);
  useEffect(() => {
    if (!showWizard || step !== 1 || !seatSelectionEnabled) { didAutoOpenSeatPickerRef.current = false; return; }
    if (didAutoOpenSeatPickerRef.current || seatPickerOpen || seatIds.length > 0) return;
    didAutoOpenSeatPickerRef.current = true;
    setSeatPickerOpen(true);
  }, [seatIds.length, seatPickerOpen, seatSelectionEnabled, showWizard, step]);
  useEffect(() => { selectedSeatIdsRef.current = seatIds; }, [seatIds]);
  useEffect(() => {
    if (!showWizard || step === 0 || terminalDispatch || !assignForm.performanceId || !seatSelectionEnabled) return;
    const id = window.setInterval(() => {
      void loadSeatsForPerformance(assignForm.performanceId, { showLoading: false, syncSelection: true }).catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(id);
  }, [assignForm.performanceId, loadSeatsForPerformance, seatSelectionEnabled, showWizard, step, terminalDispatch]);

  // ── Terminal dispatch stream sync ─────────────────────────────────────────
  const applyTerminalDispatchStatus = useCallback((dispatch: TerminalDispatch) => {
    setTerminalDispatch(dispatch);
  }, []);
  const refreshTerminalDispatchStatus = useCallback(async (dispatchId: string) => {
    const dispatch = await adminFetch<TerminalDispatch>(`/api/admin/payment-line/entry/${encodeURIComponent(dispatchId)}`);
    applyTerminalDispatchStatus(dispatch);
  }, [applyTerminalDispatchStatus]);

  useEffect(() => {
    if (!terminalDispatch || !sellerStatusStream.snapshot) return;
    const entry = sellerStatusStream.snapshot.entries.find(e => e.entryId === terminalDispatch.dispatchId);
    if (!entry) {
      const terminal = ['SUCCEEDED','FAILED','EXPIRED','CANCELED'].includes(terminalDispatch.status);
      if (!terminal) void refreshTerminalDispatchStatus(terminalDispatch.dispatchId).catch(() => undefined);
      return;
    }
    applyTerminalDispatchStatus(mapEntryToTerminalDispatch(entry));
  }, [applyTerminalDispatchStatus, refreshTerminalDispatchStatus, sellerStatusStream.snapshot, terminalDispatch]);

  useEffect(() => {
    if (!terminalDispatch || sellerStatusStream.connected) return;
    const terminal = ['SUCCEEDED','FAILED','EXPIRED','CANCELED'].includes(terminalDispatch.status);
    if (terminal) return;
    let cancelled = false;
    const poll = async () => { if (cancelled) return; await refreshTerminalDispatchStatus(terminalDispatch.dispatchId).catch(() => undefined); };
    void poll();
    const id = window.setInterval(() => void poll(), 500);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [refreshTerminalDispatchStatus, sellerStatusStream.connected, terminalDispatch]);

  // ── Sale recap countdown ──────────────────────────────────────────────────
  useEffect(() => {
    if (!saleRecap) { setSaleRecapSecsLeft(0); return; }
    const tick = () => {
      const left = Math.max(0, Math.ceil((saleRecap.expiresAtMs - Date.now()) / 1000));
      setSaleRecapSecsLeft(left);
      if (left <= 0) setSaleRecap(null);
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [saleRecap]);

  // ─────────────────────────────────────────────────────────────────────────
  // DERIVED STATE
  // ─────────────────────────────────────────────────────────────────────────

  const seatIds = useMemo(() => parseSeatIds(assignForm.seatIdsInput), [assignForm.seatIdsInput]);
  const gaTicketQuantity = useMemo(() => {
    const p = Number.parseInt(assignForm.gaQuantityInput, 10);
    return Number.isFinite(p) ? Math.max(0, Math.min(p, 50)) : 0;
  }, [assignForm.gaQuantityInput]);

  const selectedPerformance = performances.find(p => p.id === assignForm.performanceId);
  const seatSelectionEnabled = selectedPerformance?.seatSelectionEnabled !== false;
  const selectionIds = useMemo(
    () => seatSelectionEnabled ? seatIds : buildGeneralAdmissionLineIds(gaTicketQuantity),
    [gaTicketQuantity, seatIds, seatSelectionEnabled]
  );

  const selectedSeatIdSet = useMemo(() => new Set(seatIds), [seatIds]);
  const sections = useMemo(() => [...new Set(seats.map(s => s.sectionName))].sort(naturalSort), [seats]);
  const visibleSeats = useMemo(() => seats.filter(s => activeSection === 'All' || s.sectionName === activeSection), [activeSection, seats]);
  const seatById = useMemo(() => new Map(seats.map(s => [s.id, s])), [seats]);
  const hasAccessibleSelection = useMemo(() => seatIds.some(id => Boolean(seatById.get(id)?.isAccessible)), [seatById, seatIds]);
  const selectedMappedSeats = useMemo(
    () => seatIds.map(id => seatById.get(id)).filter((s): s is Seat => Boolean(s))
      .sort((a, b) => naturalSort(a.sectionName, b.sectionName) || naturalSort(a.row, b.row) || a.number - b.number),
    [seatById, seatIds]
  );
  const selectedUnknownSeatIds = useMemo(() => seatIds.filter(id => !seatById.has(id)), [seatById, seatIds]);
  const selectedTerminalDevice = useMemo(() => terminalDevices.find(d => d.deviceId === selectedTerminalId) || null, [selectedTerminalId, terminalDevices]);

  const selectedTicketOptions = useMemo<CashierTicketOption[]>(() => {
    if (!selectedPerformance || !selectedPerformance.pricingTiers.length) return [];
    const options: CashierTicketOption[] = selectedPerformance.pricingTiers.map(t => ({ id: t.id, name: t.name, priceCents: t.priceCents }));
    if (selectedPerformance.staffCompsEnabled && !options.some(o => o.id === TEACHER_TICKET_OPTION_ID || isTeacherTicketName(o.name))) {
      options.push({ id: TEACHER_TICKET_OPTION_ID, name: 'RTMSD STAFF', priceCents: 0, isSynthetic: true });
    }
    if (selectedPerformance.studentCompTicketsEnabled && !options.some(o => o.id === STUDENT_SHOW_TICKET_OPTION_ID || isStudentInShowTicketName(o.name))) {
      options.push({ id: STUDENT_SHOW_TICKET_OPTION_ID, name: 'Student in Show', priceCents: 0, isSynthetic: true });
    }
    return options;
  }, [selectedPerformance]);

  const primaryTicketTier = selectedTicketOptions[0] || null;
  const primaryStandardTicketTier = useMemo(
    () => selectedTicketOptions.find(o => !o.isSynthetic) || primaryTicketTier,
    [primaryTicketTier, selectedTicketOptions]
  );

  useEffect(() => {
    if (selectionIds.length === 0) { setTicketSelectionBySeatId({}); return; }
    const defaultId = selectedTicketOptions[0]?.id || '';
    setTicketSelectionBySeatId(prev => {
      const next: Record<string, string> = {};
      selectionIds.forEach(id => {
        const cur = prev[id];
        const valid = Boolean(cur && selectedTicketOptions.some(t => t.id === cur));
        next[id] = valid ? cur : defaultId;
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
      return selectedMappedSeats.map(s => ({
        id: s.id, label: `${s.sectionName} · Row ${s.row} · #${s.number}`,
        sectionName: s.sectionName, row: s.row, number: s.number, seatPriceCents: Math.max(0, s.price)
      }));
    }
    return selectionIds.map((id, i) => ({
      id, label: `General Admission #${i + 1}`,
      sectionName: 'General Admission', row: 'GA', number: i + 1,
      seatPriceCents: Math.max(0, primaryStandardTicketTier?.priceCents || 0)
    }));
  }, [primaryStandardTicketTier, seatSelectionEnabled, selectedMappedSeats, selectionIds]);

  const selectedSeatsWithTier = useMemo(
    () => selectedLines.map(line => ({
      line,
      tier: selectedTicketOptions.find(t => t.id === ticketSelectionBySeatId[line.id]) || null
    })),
    [selectedLines, selectedTicketOptions, ticketSelectionBySeatId]
  );

  const teacherSelectedSeatIds = useMemo(
    () => selectedSeatsWithTier.filter(item => item.tier && (item.tier.id === TEACHER_TICKET_OPTION_ID || isTeacherTicketName(item.tier.name))).map(i => i.line.id),
    [selectedSeatsWithTier]
  );
  const studentInShowSelectedSeatIds = useMemo(
    () => selectedSeatsWithTier.filter(item => item.tier && (item.tier.id === STUDENT_SHOW_TICKET_OPTION_ID || isStudentInShowTicketName(item.tier.name))).map(i => i.line.id),
    [selectedSeatsWithTier]
  );
  const hasTeacherCompSelection = teacherSelectedSeatIds.length > 0;
  const hasStudentInShowCompSelection = studentInShowSelectedSeatIds.length > 0;
  const hasMixedCompSelection = hasTeacherCompSelection && hasStudentInShowCompSelection;

  const selectedSeatsWithPricing = useMemo(() => {
    let priced = selectedSeatsWithTier.map(item => {
      const isTeacher = Boolean(item.tier && (item.tier.id === TEACHER_TICKET_OPTION_ID || isTeacherTicketName(item.tier.name)));
      const isStudent = Boolean(item.tier && (item.tier.id === STUDENT_SHOW_TICKET_OPTION_ID || isStudentInShowTicketName(item.tier.name)));
      const base = item.tier ? Math.max(0, item.tier.isSynthetic ? item.line.seatPriceCents : item.tier.priceCents) : 0;
      return { line: item.line, tier: item.tier, basePriceCents: base, finalPriceCents: base, lineLabel: item.tier?.name || 'Unassigned', isTeacher, isStudent };
    });
    if (hasTeacherCompSelection && !hasStudentInShowCompSelection) {
      const compIds = pickComplimentarySeatIds(
        priced.filter(i => i.isTeacher).map(i => ({ id: i.line.id, sectionName: i.line.sectionName, row: i.line.row, number: i.line.number, basePriceCents: i.basePriceCents })),
        Math.min(MAX_TEACHER_COMP_TICKETS, teacherSelectedSeatIds.length)
      );
      priced = priced.map(i => i.isTeacher && compIds.has(i.line.id) ? { ...i, finalPriceCents: 0, lineLabel: 'Teacher Comp' } : i);
    }
    if (hasStudentInShowCompSelection && !hasTeacherCompSelection) {
      const compIds = pickComplimentarySeatIds(
        priced.filter(i => i.isStudent).map(i => ({ id: i.line.id, sectionName: i.line.sectionName, row: i.line.row, number: i.line.number, basePriceCents: i.basePriceCents })),
        Math.min(MAX_STUDENT_COMP_TICKETS, studentInShowSelectedSeatIds.length)
      );
      priced = priced.map(i => i.isStudent && compIds.has(i.line.id) ? { ...i, finalPriceCents: 0, lineLabel: 'Student Comp' } : i);
    }
    return priced;
  }, [hasStudentInShowCompSelection, hasTeacherCompSelection, selectedSeatsWithTier, studentInShowSelectedSeatIds.length, teacherSelectedSeatIds.length]);

  const subtotalCents = useMemo(() => selectedSeatsWithPricing.reduce((s, i) => s + i.finalPriceCents, 0), [selectedSeatsWithPricing]);

  const tierBreakdown = useMemo(() => {
    const counts = new Map<string, { name: string; priceCents: number; count: number }>();
    selectedSeatsWithPricing.forEach(item => {
      const key = `${item.lineLabel}:${item.finalPriceCents}`;
      const ex = counts.get(key);
      if (ex) { ex.count += 1; return; }
      counts.set(key, { name: item.lineLabel, priceCents: item.finalPriceCents, count: 1 });
    });
    return [...counts.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
  }, [selectedSeatsWithPricing]);

  const fmtTierOption = useCallback((tier: CashierTicketOption) => {
    if (tier.id === TEACHER_TICKET_OPTION_ID || isTeacherTicketName(tier.name))
      return `${tier.name} — first ${MAX_TEACHER_COMP_TICKETS} free`;
    if (tier.id === STUDENT_SHOW_TICKET_OPTION_ID || isStudentInShowTicketName(tier.name))
      return `${tier.name} — first ${MAX_STUDENT_COMP_TICKETS} free`;
    return `${tier.name} — ${fmtDollars(tier.priceCents)}`;
  }, []);

  // ── Dispatch inline status ────────────────────────────────────────────────
  const dispatchStatus = useMemo<{ title: string; detail: string; tone: 'success' | 'danger' | 'neutral' }>(() => {
    const entry = sellerStatusStream.sellerPayload.sellerEntry;
    if (sellerStatusStream.connected && entry) {
      if (entry.uiState === 'WAITING_FOR_PAYMENT') {
        const ahead = entry.position && entry.position > 0 ? entry.position - 1 : null;
        return { title: 'Queued', detail: ahead === null ? 'Phone is busy — stay in line.' : `${ahead} ahead of you.`, tone: 'neutral' };
      }
      if (entry.uiState === 'ACTIVE_PAYMENT') return { title: 'Ready to pay', detail: 'Phone is live. Indicate to customer.', tone: 'success' };
      if (entry.uiState === 'PAYMENT_SUCCESS') return { title: 'Approved', detail: 'Payment completed successfully.', tone: 'success' };
      if (entry.uiState === 'PAYMENT_FAILED') return { title: 'Failed', detail: entry.failureReason || 'Terminal payment failed.', tone: 'danger' };
      if (entry.uiState === 'CANCELED') return { title: 'Canceled', detail: 'Sale was canceled before payment.', tone: 'neutral' };
    }
    if (!terminalDispatch) return { title: 'Pending', detail: 'Waiting for terminal confirmation.', tone: 'neutral' };
    if (terminalDispatch.status === 'PENDING' || terminalDispatch.status === 'DELIVERED') return { title: 'Queued', detail: 'Sent — waiting for phone availability.', tone: 'neutral' };
    if (terminalDispatch.status === 'PROCESSING') return { title: 'Ready to pay', detail: 'Phone is collecting payment.', tone: 'success' };
    if (terminalDispatch.status === 'SUCCEEDED') return { title: 'Approved', detail: 'Payment completed successfully.', tone: 'success' };
    if (terminalDispatch.status === 'FAILED') return { title: 'Failed', detail: terminalDispatch.failureReason || 'Terminal payment failed.', tone: 'danger' };
    if (terminalDispatch.status === 'EXPIRED') return { title: 'Expired', detail: 'Payment window closed before completion.', tone: 'danger' };
    return { title: 'Canceled', detail: 'Sale was canceled before payment.', tone: 'neutral' };
  }, [sellerStatusStream.connected, sellerStatusStream.sellerPayload.sellerEntry, terminalDispatch]);

  // ─────────────────────────────────────────────────────────────────────────
  // ACTIONS
  // ─────────────────────────────────────────────────────────────────────────

  const search = (e: FormEvent) => { e.preventDefault(); void load(); };

  const goTo = (next: number) => { setDir(next > step ? 1 : -1); setStep(next); setError(null); };

  const resetInPersonFlow = () => {
    setInPersonFlowError(null); setInPersonSubmitting(false);
    setPaymentMethod('STRIPE'); setReceiptEmail(''); setSendReceipt(false); setStudentCode('');
    setTerminalDevices([]); setLoadingTerminals(false); setSelectedTerminalId('');
    setTerminalDispatch(null); setDispatchBusy(false);
    setCashTonight(null); setLoadingCashTonight(false);
  };

  const closeWizard = () => {
    setShowWizard(false); setStep(0); setError(null);
    setSeatPickerOpen(false); setSeatPickerError(null);
    setTicketSelectionBySeatId({}); resetInPersonFlow();
  };

  const startCashierLoop = (performanceId: string) => {
    if (!performanceId) { setError('No active performances available.'); return; }
    writeCashierDefaultPerformanceId(performanceId);
    didAutoOpenSeatPickerRef.current = false;
    setAssignForm(prev => ({ ...prev, performanceId, customerName: '', customerEmail: '', seatIdsInput: '', gaQuantityInput: '1', ticketType: '', sendEmail: false }));
    setTicketSelectionBySeatId({});
    resetInPersonFlow();
    setShowPerfPicker(false); setSeatPickerError(null); setSeatPickerOpen(false);
    setShowWizard(true); setDir(1); setStep(0); setError(null);
    void loadSeatsForPerformance(performanceId, { showLoading: false, syncSelection: false });
  };

  const openCashierFlow = () => {
    if (!performances.length) { setError('No active performances available.'); return; }
    const stored = readCashierDefaultPerformanceId();
    const next =
      performances.some(p => p.id === assignForm.performanceId) ? assignForm.performanceId
      : performances.some(p => p.id === stored) ? stored
      : performances[0]?.id || '';
    setPerfPickerDraftId(next);
    if (next) { startCashierLoop(next); return; }
    setShowPerfPicker(true); setError(null);
  };

  const handleWizardNext = () => {
    if (step === 0) { goTo(1); return; }
    if (step === 1) {
      if (selectionIds.length === 0) {
        setError(seatSelectionEnabled ? 'Select at least one seat to continue.' : 'Enter at least one GA ticket to continue.');
        if (seatSelectionEnabled) setSeatPickerOpen(true);
        return;
      }
      goTo(2);
    }
  };

  const moveOnFromSeatPicker = () => {
    if (step === 1) {
      if (seatIds.length === 0) { setSeatPickerError('Select at least one seat before continuing.'); return; }
      setSeatPickerOpen(false); goTo(2); return;
    }
    setSeatPickerOpen(false);
  };

  const toggleSeat = useCallback((id: string) => {
    setAssignForm(prev => {
      const current = parseSeatIds(prev.seatIdsInput);
      const next = current.includes(id) ? current.filter(s => s !== id) : [...current, id];
      return { ...prev, seatIdsInput: [...new Set(next)].join(', ') };
    });
  }, []);

  const assignOrder = async () => {
    setError(null); setNotice(null);
    if (!assignForm.performanceId || selectionIds.length === 0) {
      setError(seatSelectionEnabled ? 'Choose a performance and at least one seat.' : 'Choose a performance and enter ticket count.');
      return;
    }
    if (assignForm.source !== 'COMP') { setError('Door sales must use the in-person finalize flow.'); return; }
    if (assignForm.sendEmail && !assignForm.customerEmail.trim()) { setError('Enter an email to send comp tickets.'); return; }
    if (missingTicketTypeCount > 0) { setError('Assign a ticket type to every seat before continuing.'); return; }
    const ticketTypeBySeatId = Object.fromEntries(selectionIds.map(id => [id, ticketSelectionBySeatId[id] || 'Comp']));
    const priceBySeatId = Object.fromEntries(selectionIds.map(id => [id, 0]));
    setSubmitting(true);
    try {
      await adminFetch('/api/admin/orders/assign', {
        method: 'POST',
        body: JSON.stringify({
          performanceId: assignForm.performanceId,
          seatIds: selectionIds,
          customerName: assignForm.customerName.trim() || 'Comp Guest',
          customerEmail: assignForm.customerEmail.trim().toLowerCase() || `comp+${Date.now()}@boxoffice.local`,
          ticketTypeBySeatId, priceBySeatId, source: assignForm.source,
          sendEmail: Boolean(assignForm.sendEmail && assignForm.customerEmail.trim())
        }),
      });
      setNotice(`Assigned ${selectionIds.length} ${seatSelectionEnabled ? 'seat' : 'ticket'}${selectionIds.length !== 1 ? 's' : ''} successfully.`);
      startCashierLoop(assignForm.performanceId);
      void load(); void loadSeatsForPerformance(assignForm.performanceId, { showLoading: false, syncSelection: false });
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to assign seats'); }
    finally { setSubmitting(false); }
  };

  const finalizeInPersonSale = async () => {
    setError(null); setNotice(null); setInPersonFlowError(null);
    if (!assignForm.performanceId || selectionIds.length === 0) {
      setError(seatSelectionEnabled ? 'Choose a performance and at least one seat.' : 'Choose a performance and enter ticket count.');
      return;
    }
    if (!selectedTicketOptions.length) { setError('No pricing tiers configured for this performance.'); return; }
    if (missingTicketTypeCount > 0) { setError('Assign a ticket type to every seat before checkout.'); return; }
    if (hasMixedCompSelection) { setInPersonFlowError('Teacher and Student in Show comps cannot be mixed in one order.'); return; }
    const normalizedCode = studentCode.trim().toLowerCase().replace(/\s+/g, '');
    if (hasStudentInShowCompSelection && !normalizedCode) { setInPersonFlowError('Student code is required for Student in Show tickets.'); return; }
    const normalizedEmail = receiptEmail.trim().toLowerCase();
    if (sendReceipt && !normalizedEmail) { setInPersonFlowError('Enter an email address to send receipt.'); return; }

    if (paymentMethod === 'STRIPE') {
      if (!selectedTerminalId) { setInPersonFlowError('Select a payment terminal before sending card payment.'); return; }
      setInPersonSubmitting(true);
      try {
        const dispatch = await adminFetch<TerminalDispatch>('/api/admin/payment-line/enqueue', {
          method: 'POST',
          body: JSON.stringify({
            performanceId: assignForm.performanceId, seatIds: selectionIds,
            ticketSelectionBySeatId, receiptEmail: normalizedEmail || undefined,
            sendReceipt, customerName: assignForm.customerName.trim() || undefined,
            studentCode: hasStudentInShowCompSelection ? normalizedCode : undefined,
            deviceId: selectedTerminalId
          })
        });
        setTerminalDispatch(dispatch);
      } catch (e) { setInPersonFlowError(e instanceof Error ? e.message : 'Failed to send to payment line'); }
      finally { setInPersonSubmitting(false); }
      return;
    }

    setInPersonSubmitting(true);
    try {
      const result = await adminFetch<{ expectedAmountCents: number; paymentMethod: 'STRIPE'|'CASH'; seats: InPersonFinalizeSeatSummary[] }>(
        '/api/admin/orders/in-person/finalize',
        { method: 'POST', body: JSON.stringify({
          performanceId: assignForm.performanceId, seatIds: selectionIds,
          ticketSelectionBySeatId, paymentMethod,
          receiptEmail: normalizedEmail || undefined, sendReceipt,
          customerName: assignForm.customerName.trim() || undefined,
          studentCode: hasStudentInShowCompSelection ? normalizedCode : undefined
        })}
      );
      setSaleRecap({ expectedAmountCents: result.expectedAmountCents, paymentMethod: result.paymentMethod, seats: result.seats, expiresAtMs: Date.now() + 10000 });
      setNotice(`${paymentMethod === 'CASH' ? 'Cash' : 'Card'} sale — ${selectionIds.length} ${seatSelectionEnabled ? 'seat' : 'ticket'}${selectionIds.length !== 1 ? 's' : ''} · ${fmtDollars(result.expectedAmountCents)}`);
      startCashierLoop(assignForm.performanceId);
      void load();
    } catch (e) { setInPersonFlowError(e instanceof Error ? e.message : 'Failed to finalize sale'); }
    finally { setInPersonSubmitting(false); }
  };

  const finalizeSuccessfulTerminalDispatch = (dispatch: TerminalDispatch) => {
    setSaleRecap({ expectedAmountCents: dispatch.expectedAmountCents, paymentMethod: 'STRIPE', seats: dispatch.seats, expiresAtMs: Date.now() + 10000 });
    setNotice(`Card sale — ${dispatch.seatCount} seat${dispatch.seatCount !== 1 ? 's' : ''} · ${fmtDollars(dispatch.expectedAmountCents)}`);
    setTerminalDispatch(null);
    startCashierLoop(assignForm.performanceId);
    void load(); void loadSeatsForPerformance(assignForm.performanceId, { showLoading: false, syncSelection: false });
  };

  const retryTerminalDispatch = useCallback(async () => {
    if (!terminalDispatch) return;
    setDispatchBusy(true); setInPersonFlowError(null);
    try {
      const d = await adminFetch<TerminalDispatch>(`/api/admin/payment-line/entry/${encodeURIComponent(terminalDispatch.dispatchId)}/retry-now`, { method: 'POST' });
      applyTerminalDispatchStatus(d);
    } catch (e) {
      setInPersonFlowError(e instanceof Error ? e.message : 'Retry failed');
      await refreshTerminalDispatchStatus(terminalDispatch.dispatchId).catch(() => undefined);
    } finally { setDispatchBusy(false); }
  }, [applyTerminalDispatchStatus, refreshTerminalDispatchStatus, terminalDispatch]);

  const cancelTerminalDispatch = useCallback(async () => {
    if (!terminalDispatch) return;
    setDispatchBusy(true);
    try {
      const d = await adminFetch<TerminalDispatch>(`/api/admin/payment-line/entry/${encodeURIComponent(terminalDispatch.dispatchId)}/cancel`, { method: 'POST' });
      setTerminalDispatch(d.status === 'CANCELED' ? null : d);
    } catch (e) { setInPersonFlowError(e instanceof Error ? e.message : 'Cancel failed'); }
    finally { setDispatchBusy(false); }
  }, [terminalDispatch]);

  // ─────────────────────────────────────────────────────────────────────────
  // WIZARD STEP CONTENT
  // ─────────────────────────────────────────────────────────────────────────

  const wizardSteps = [

    /* ─── STEP 0: Performance ─── */
    <div key="show" className="space-y-6">
      <div>
        <Label>Performance</Label>
        <select
          value={assignForm.performanceId}
          onChange={e => { setAssignForm({ ...assignForm, performanceId: e.target.value }); writeCashierDefaultPerformanceId(e.target.value); }}
          className={sel}
        >
          {performances.map(p => (
            <option key={p.id} value={p.id}>
              {p.title}{p.isFundraiser ? ' [Fundraiser]' : ''} — {fmtDate(p.startsAt)}
            </option>
          ))}
        </select>
      </div>

      <div>
        <Label>Order type</Label>
        <div className="grid grid-cols-2 gap-2">
          {(['DOOR', 'COMP'] as const).map(src => (
            <button
              key={src}
              type="button"
              onClick={() => setAssignForm({ ...assignForm, source: src })}
              className={`rounded-lg border-2 px-4 py-3 text-left transition ${
                assignForm.source === src ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <div className={`text-sm font-bold ${assignForm.source === src ? 'text-white' : 'text-slate-800'}`}>
                {src === 'DOOR' ? '🎟 Door Sale' : '🎁 Comp'}
              </div>
              <div className={`mt-0.5 text-xs ${assignForm.source === src ? 'text-slate-300' : 'text-slate-400'}`}>
                {src === 'DOOR' ? 'Paid in-person checkout' : 'Complimentary — no charge'}
              </div>
            </button>
          ))}
        </div>
      </div>

      {selectedTicketOptions.length > 0 ? (
        <div>
          <Label>Available pricing</Label>
          <div className="flex flex-wrap gap-2">
            {selectedTicketOptions.map(opt => (
              <span key={opt.id} className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">
                {fmtTierOption(opt)}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <Alert type="warn">No pricing tiers configured. Add them in Performances before checkout.</Alert>
      )}
    </div>,

    /* ─── STEP 1: Seats ─── */
    <div key="seats" className="space-y-4">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <Label>{seatSelectionEnabled ? 'Seat selection' : 'Ticket quantity'}</Label>
          <div className="flex gap-2">
            {seatSelectionEnabled && (
              <Btn
                size="sm" variant="primary"
                onClick={() => { if (!assignForm.performanceId) { setError('Choose a performance first.'); return; } setSeatPickerOpen(true); setSeatPickerError(null); }}
              >
                <MapPin className="h-3 w-3" /> Open map
              </Btn>
            )}
            {seatSelectionEnabled && seatIds.length > 0 && (
              <Btn size="sm" variant="ghost" onClick={() => setAssignForm({ ...assignForm, seatIdsInput: '' })}>
                <X className="h-3 w-3" /> Clear
              </Btn>
            )}
          </div>
        </div>

        {seatSelectionEnabled ? (
          <input
            value={assignForm.seatIdsInput}
            onChange={e => setAssignForm({ ...assignForm, seatIdsInput: e.target.value })}
            placeholder="Paste seat IDs: A1, A2, B3…"
            className={inp}
          />
        ) : (
          <input
            type="number" min={1} max={50}
            value={assignForm.gaQuantityInput}
            onChange={e => setAssignForm({ ...assignForm, gaQuantityInput: e.target.value.replace(/[^\d]/g, '') })}
            placeholder="Ticket quantity"
            className={inp}
          />
        )}

        {seatSelectionEnabled && seatIds.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {seatIds.map(id => (
              <button
                key={id}
                type="button"
                onClick={() => toggleSeat(id)}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-mono font-medium text-slate-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
              >
                {id} <X className="h-3 w-3" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Summary card */}
      <div className="rounded-xl border border-slate-200 overflow-hidden">
        {[
          { label: 'Performance', value: selectedPerformance?.title ?? '—' },
          { label: 'Type', value: assignForm.source === 'DOOR' ? 'Door Sale' : 'Comp' },
          {
            label: seatSelectionEnabled ? 'Seats' : 'Tickets',
            value: selectionIds.length > 0
              ? <span className="font-bold text-slate-900">{selectionIds.length} selected</span>
              : <span className="text-amber-600">None selected</span>
          },
        ].map(({ label, value }, i, arr) => (
          <div key={label} className={`flex items-center justify-between px-4 py-3 text-sm ${i < arr.length - 1 ? 'border-b border-slate-100' : ''}`}>
            <span className="text-slate-400">{label}</span>
            <span className="text-right font-medium text-slate-700">{value}</span>
          </div>
        ))}
      </div>
    </div>,

    /* ─── STEP 2: Checkout ─── */
    <div key="tickets" className="space-y-5">
      {!selectionIds.length ? (
        <Alert type="warn">{seatSelectionEnabled ? 'Go back and select at least one seat.' : 'Go back and enter ticket quantity.'}</Alert>
      ) : !selectedTicketOptions.length ? (
        <Alert type="warn">No pricing tiers configured for this performance.</Alert>
      ) : (
        <>
          {/* Quick apply */}
          <div>
            <Label>Quick-assign all</Label>
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
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:border-slate-900 hover:bg-slate-900 hover:text-white"
                >
                  {fmtTierOption(tier)}
                </button>
              ))}
            </div>
          </div>

          {/* Per-seat assignment */}
          <div className="rounded-xl border border-slate-200 overflow-hidden">
            {selectedLines.map((line, i) => (
              <div
                key={line.id}
                className={`flex items-center justify-between gap-3 px-4 py-2.5 ${i < selectedLines.length - 1 ? 'border-b border-slate-100' : ''}`}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{line.label}</p>
                  <p className="text-[11px] font-mono text-slate-400">{line.id}</p>
                </div>
                <select
                  value={ticketSelectionBySeatId[line.id] || ''}
                  onChange={e => setTicketSelectionBySeatId(prev => ({ ...prev, [line.id]: e.target.value }))}
                  className="min-w-[160px] rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:border-slate-900 focus:outline-none"
                >
                  <option value="">Select type…</option>
                  {selectedTicketOptions.map(t => <option key={t.id} value={t.id}>{fmtTierOption(t)}</option>)}
                </select>
              </div>
            ))}
          </div>

          {/* Order summary */}
          <div className="rounded-xl border border-slate-200 overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-2.5">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Summary</span>
              {missingTicketTypeCount > 0
                ? <span className="text-xs font-medium text-amber-600">{missingTicketTypeCount} unassigned</span>
                : <span className="flex items-center gap-1 text-xs font-medium text-emerald-600"><Check className="h-3 w-3" /> All set</span>
              }
            </div>
            <div className="divide-y divide-slate-50 px-4">
              {tierBreakdown.map(item => (
                <div key={item.name} className="flex items-center justify-between py-2.5 text-sm">
                  <span className="text-slate-600">{item.name} <span className="text-slate-400">×{item.count}</span></span>
                  <span className="font-semibold">{fmtDollars(item.priceCents * item.count)}</span>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-4 py-3">
              <span className="text-xs font-black uppercase tracking-widest text-slate-400">Total</span>
              <span className="text-2xl font-black tracking-tight text-slate-900">{fmtDollars(subtotalCents)}</span>
            </div>
            {hasMixedCompSelection && (
              <div className="border-t border-red-100 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-700">
                ⚠️ Teacher and Student comps cannot be mixed in one order.
              </div>
            )}
          </div>

          {/* Comp section */}
          {assignForm.source === 'COMP' && (
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="border-b border-slate-100 bg-slate-50 px-4 py-2.5">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Guest & delivery</span>
              </div>
              <div className="space-y-4 p-4">
                <div className="grid grid-cols-2 gap-3">
                  <input type="text" value={assignForm.customerName} onChange={e => setAssignForm({ ...assignForm, customerName: e.target.value })} placeholder="Guest name (optional)" className={inp} />
                  <input type="email" value={assignForm.customerEmail} onChange={e => setAssignForm({ ...assignForm, customerEmail: e.target.value })} placeholder="guest@email.com" className={inp} />
                </div>
                <Toggle on={assignForm.sendEmail} onToggle={() => setAssignForm(p => ({ ...p, sendEmail: !p.sendEmail }))} label="Send confirmation email" />
                {assignForm.sendEmail && !assignForm.customerEmail.trim() && (
                  <p className="text-xs text-amber-700">Enter an email above to enable delivery.</p>
                )}
              </div>
            </div>
          )}

          {/* Door payment section */}
          {assignForm.source === 'DOOR' && (
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="border-b border-slate-100 bg-slate-50 px-4 py-2.5">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Payment & receipt</span>
              </div>
              <div className="space-y-4 p-4">
                {/* Payment method toggle */}
                <div className="grid grid-cols-2 gap-2">
                  {([['STRIPE', '💳 Card'], ['CASH', '💵 Cash']] as const).map(([m, label]) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setPaymentMethod(m)}
                      className={`rounded-lg border-2 py-2.5 text-sm font-semibold transition ${paymentMethod === m ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {paymentMethod === 'STRIPE' && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <Label>Terminal</Label>
                      <Btn size="sm" variant="ghost" onClick={() => void loadTerminalDevices()}>
                        <RefreshCw className={`h-3 w-3 ${loadingTerminals ? 'animate-spin' : ''}`} /> Refresh
                      </Btn>
                    </div>
                    <select value={selectedTerminalId} onChange={e => setSelectedTerminalId(e.target.value)} className={sel}>
                      {!terminalDevices.length && <option value="">No terminals found</option>}
                      {terminalDevices.map(d => (
                        <option key={d.deviceId} value={d.deviceId}>{d.name}{d.isBusy ? ' (Busy)' : ''}</option>
                      ))}
                    </select>
                    {selectedTerminalDevice?.isBusy && (
                      <p className="text-xs text-amber-700">Terminal is busy — new entries will queue.</p>
                    )}
                  </div>
                )}

                {/* Cash tonight */}
                <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
                  {loadingCashTonight
                    ? <span className="text-slate-400">Loading cash total…</span>
                    : <span className="text-slate-600">Cash tonight: <strong className="text-slate-900">{fmtDollars(cashTonight?.totalCashCents || 0)}</strong> <span className="text-slate-400">({cashTonight?.saleCount || 0} sale{cashTonight?.saleCount !== 1 ? 's' : ''})</span></span>
                  }
                </div>

                {hasStudentInShowCompSelection && (
                  <div>
                    <Label>Student code</Label>
                    <input type="text" value={studentCode} onChange={e => setStudentCode(e.target.value)} placeholder="e.g. jsmith" className={inp} />
                    <p className="mt-1 text-xs text-slate-400">Required for Student in Show comp tickets.</p>
                  </div>
                )}

                <div className="space-y-2">
                  <Toggle on={sendReceipt} onToggle={() => setSendReceipt(p => !p)} label="Send email receipt" />
                  <AnimatePresence>
                    {sendReceipt && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                        <input type="email" value={receiptEmail} onChange={e => setReceiptEmail(e.target.value)} placeholder="customer@email.com" className={inp} />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {inPersonFlowError && <Alert type="error">{inPersonFlowError}</Alert>}
              </div>
            </div>
          )}
        </>
      )}
    </div>,
  ];

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-4xl space-y-5 font-['DM_Sans',system-ui,sans-serif]">

      {/* ── Page header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">Orders</h1>
          <p className="text-sm text-slate-400">Search, manage, and process ticket orders.</p>
        </div>
        <div className="flex gap-2">
          <Link
            to="/admin/devices"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Devices
          </Link>
          <motion.button
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
            onClick={openCashierFlow}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
          >
            <Plus className="h-4 w-4" /> Cashier checkout
          </motion.button>
        </div>
      </div>

      {/* ── Global notices ── */}
      <AnimatePresence>
        {notice && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
          >
            <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
            <span className="flex-1">{notice}</span>
            <button onClick={() => setNotice(null)} className="text-emerald-400 hover:text-emerald-600"><X className="h-4 w-4" /></button>
          </motion.div>
        )}
        {error && !showWizard && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="flex items-center gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600"><X className="h-4 w-4" /></button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Filters + search ── */}
      <form onSubmit={search} className="flex flex-wrap gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-300" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Name, email, or order ID…"
            className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-3.5 text-sm placeholder:text-slate-300 transition focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-200"
          />
        </div>
        <select value={status} onChange={e => setStatus(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-slate-900 focus:outline-none">
          <option value="">All statuses</option>
          <option value="PAID">Paid</option>
          <option value="PENDING">Pending</option>
          <option value="REFUNDED">Refunded</option>
          <option value="CANCELED">Canceled</option>
        </select>
        <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-slate-900 focus:outline-none">
          <option value="">All sources</option>
          <option value="ONLINE">Online</option>
          <option value="DOOR">Door</option>
          <option value="COMP">Comp</option>
          <option value="STAFF_FREE">Staff</option>
          <option value="STUDENT_COMP">Student</option>
        </select>
        <div className="flex rounded-lg border border-slate-200 overflow-hidden bg-white">
          {(['active', 'archived', 'all'] as const).map(s => (
            <button
              key={s}
              type="button"
              onClick={() => setScope(s)}
              className={`px-3 py-2 text-xs font-medium capitalize transition ${scope === s ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
            >
              {s}
            </button>
          ))}
        </div>
        <Btn type="submit" variant="primary" size="md">
          <Search className="h-3.5 w-3.5" /> Search
        </Btn>
      </form>

      {/* ── Orders table ── */}
      {loadingRows ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
          <RefreshCw className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-slate-200 py-16 text-center">
          <Users className="h-8 w-8 text-slate-200" />
          <p className="text-sm font-semibold text-slate-400">No orders found</p>
          <p className="text-xs text-slate-300">Try adjusting your filters</p>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_auto_auto_auto_80px] gap-4 border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-slate-400">
            <span>Customer</span>
            <span className="hidden sm:block">Performance</span>
            <span>Source</span>
            <span>Status</span>
            <span className="text-right">Amount</span>
          </div>
          {/* Rows */}
          <div className="divide-y divide-slate-100">
            {rows.map((order, idx) => (
              <motion.div
                key={order.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: idx * 0.015 }}
                className="group grid grid-cols-[1fr_auto_auto_auto_80px] items-center gap-4 px-4 py-3 transition hover:bg-slate-50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{order.customerName}</p>
                  <p className="truncate text-xs text-slate-400">{order.email}</p>
                  <p className="font-mono text-[10px] text-slate-300">{order.id}</p>
                </div>
                <div className="hidden min-w-0 sm:block">
                  <p className="max-w-[180px] truncate text-xs font-medium text-slate-600">{order.performanceTitle}</p>
                  <p className="text-xs text-slate-400">{fmtDate(order.createdAt)}</p>
                </div>
                <div className="flex flex-col items-start gap-1">
                  <SourceTag source={order.source} />
                  {order.source === 'DOOR' && order.inPersonPaymentMethod && (
                    <span className="text-[10px] font-medium text-slate-400">{order.inPersonPaymentMethod === 'CASH' ? '💵 Cash' : '💳 Card'}</span>
                  )}
                </div>
                <StatusPill status={order.status} />
                <div className="text-right">
                  <p className="text-sm font-black text-slate-900">{fmtDollars(order.amountTotal)}</p>
                  <p className="text-xs text-slate-400">{order.ticketCount} tkt{order.ticketCount !== 1 ? 's' : ''}</p>
                </div>
                {/* invisible expand — whole row is hoverable, View link appears */}
                <Link
                  to={`/admin/orders/${order.id}`}
                  className="absolute inset-0 opacity-0"
                  aria-label={`View order ${order.id}`}
                />
              </motion.div>
            ))}
          </div>
          <div className="border-t border-slate-100 bg-slate-50 px-4 py-2.5 text-xs text-slate-400">
            {rows.length} order{rows.length !== 1 ? 's' : ''}
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────
          MODALS
      ───────────────────────────────────────────────────────────────────── */}

      {/* ── Performance picker ── */}
      <AnimatePresence>
        {showPerfPicker && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          >
            <motion.div initial={{ scale: 0.97, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.97, opacity: 0 }}
              className="w-full max-w-sm rounded-2xl bg-white shadow-2xl border border-slate-200"
            >
              <div className="border-b border-slate-100 px-5 py-4">
                <p className="text-xs font-black uppercase tracking-widest text-slate-400">Cashier setup</p>
                <h2 className="mt-1 text-lg font-black text-slate-900">Choose performance</h2>
              </div>
              <div className="p-5">
                <Label>Performance</Label>
                <select value={perfPickerDraftId} onChange={e => setPerfPickerDraftId(e.target.value)} className={sel}>
                  {performances.map(p => (
                    <option key={p.id} value={p.id}>{p.title}{p.isFundraiser ? ' [Fundraiser]' : ''} — {fmtDate(p.startsAt)}</option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
                <Btn variant="secondary" onClick={() => setShowPerfPicker(false)}>Cancel</Btn>
                <Btn variant="primary" onClick={() => {
                  const id = performances.some(p => p.id === perfPickerDraftId) ? perfPickerDraftId : performances[0]?.id || '';
                  if (!id) { setError('No active performances.'); setShowPerfPicker(false); return; }
                  startCashierLoop(id);
                }}>
                  Continue <ArrowRight className="h-3.5 w-3.5" />
                </Btn>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Sale recap ── */}
      <AnimatePresence>
        {saleRecap && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4"
          >
            <motion.div initial={{ scale: 0.97, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.97, opacity: 0 }}
              className="w-full max-w-xl rounded-2xl bg-white shadow-2xl border border-slate-200"
            >
              <div className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
                <div>
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100">
                      <Check className="h-4 w-4 text-emerald-700" />
                    </div>
                    <div>
                      <p className="font-black text-slate-900">{saleRecap.seats.length} ticket{saleRecap.seats.length !== 1 ? 's' : ''} sold</p>
                      <p className="text-sm text-slate-500">{saleRecap.paymentMethod === 'CASH' ? 'Cash' : 'Card'} · {fmtDollars(saleRecap.expectedAmountCents)}</p>
                    </div>
                  </div>
                </div>
                <button onClick={() => setSaleRecap(null)} className="text-slate-300 hover:text-slate-600"><X className="h-5 w-5" /></button>
              </div>
              <div className="max-h-[42dvh] overflow-y-auto px-6 py-4">
                <div className="grid gap-2 sm:grid-cols-2">
                  {saleRecap.seats.map(seat => (
                    <div key={seat.id} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                      <p className="text-sm font-semibold text-slate-900">
                        {seat.row === 'GA' ? `GA Ticket ${seat.number}` : `${seat.sectionName} · Row ${seat.row} · #${seat.number}`}
                      </p>
                      <p className="text-xs text-slate-500">{seat.ticketType} · {fmtDollars(seat.priceCents)}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between border-t border-slate-100 px-6 py-3">
                <p className="text-sm text-slate-400">Closes in <span className="font-semibold text-slate-700">{saleRecapSecsLeft}s</span></p>
                <div className="flex gap-2">
                  <Btn variant="secondary" size="sm" onClick={() => setSaleRecap(p => p ? { ...p, expiresAtMs: Math.max(p.expiresAtMs, Date.now()) + 10000 } : p)}>+10s</Btn>
                  <Btn variant="primary" size="sm" onClick={() => setSaleRecap(null)}>Close</Btn>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Terminal dispatch ── */}
      <AnimatePresence>
        {terminalDispatch && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4"
          >
            <motion.div initial={{ scale: 0.97, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.97, opacity: 0 }}
              className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-slate-200"
            >
              <div className="border-b border-slate-100 px-6 py-5">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Terminal</p>
                <h2 className="mt-1 text-xl font-black text-slate-900">
                  {terminalDispatch.status === 'PENDING' && 'Queued'}
                  {terminalDispatch.status === 'DELIVERED' && 'Delivered'}
                  {terminalDispatch.status === 'PROCESSING' && 'Processing payment'}
                  {terminalDispatch.status === 'FAILED' && 'Payment failed'}
                  {terminalDispatch.status === 'SUCCEEDED' && 'Payment approved ✓'}
                  {terminalDispatch.status === 'EXPIRED' && 'Expired'}
                  {terminalDispatch.status === 'CANCELED' && 'Canceled'}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {terminalDispatch.targetDeviceName || terminalDispatch.targetDeviceId} · {fmtDollars(terminalDispatch.expectedAmountCents)}
                </p>
                <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-400">
                  <span className={`h-1.5 w-1.5 rounded-full ${sellerStatusStream.connected ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                  {sellerStatusStream.connected ? 'Live' : 'Polling'}
                </p>
              </div>

              <div className="space-y-3 px-6 py-4">
                {/* Status card */}
                <div className={`rounded-xl border px-4 py-3 ${
                  dispatchStatus.tone === 'success' ? 'border-emerald-200 bg-emerald-50'
                  : dispatchStatus.tone === 'danger' ? 'border-red-200 bg-red-50'
                  : 'border-slate-200 bg-slate-50'
                }`}>
                  <p className={`text-xs font-black uppercase tracking-widest ${dispatchStatus.tone === 'success' ? 'text-emerald-600' : dispatchStatus.tone === 'danger' ? 'text-red-600' : 'text-slate-400'}`}>
                    Status
                  </p>
                  <p className={`mt-1 font-bold ${dispatchStatus.tone === 'success' ? 'text-emerald-900' : dispatchStatus.tone === 'danger' ? 'text-red-900' : 'text-slate-800'}`}>
                    {dispatchStatus.title}
                  </p>
                  <p className={`text-sm ${dispatchStatus.tone === 'success' ? 'text-emerald-700' : dispatchStatus.tone === 'danger' ? 'text-red-700' : 'text-slate-600'}`}>
                    {dispatchStatus.detail}
                  </p>
                </div>

                <p className="text-xs text-slate-400">
                  Attempt {terminalDispatch.attemptCount} · Hold expires {new Date(terminalDispatch.holdExpiresAt).toLocaleTimeString()}
                </p>
                {terminalDispatch.failureReason && <Alert type="error">{terminalDispatch.failureReason}</Alert>}
                {inPersonFlowError && <Alert type="error">{inPersonFlowError}</Alert>}
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
                {terminalDispatch.status === 'FAILED' && terminalDispatch.canRetry && (
                  <Btn variant="secondary" onClick={retryTerminalDispatch} disabled={dispatchBusy}>Retry</Btn>
                )}
                {terminalDispatch.status === 'SUCCEEDED' ? (
                  <Btn variant="primary" onClick={() => finalizeSuccessfulTerminalDispatch(terminalDispatch)}>
                    Continue <ArrowRight className="h-3.5 w-3.5" />
                  </Btn>
                ) : (
                  <>
                    {!['EXPIRED', 'CANCELED'].includes(terminalDispatch.status) && (
                      <Btn variant="secondary" onClick={cancelTerminalDispatch} disabled={dispatchBusy}>Cancel sale</Btn>
                    )}
                    {['FAILED', 'EXPIRED', 'CANCELED'].includes(terminalDispatch.status) && (
                      <Btn variant="primary" onClick={() => setTerminalDispatch(null)}>Close</Btn>
                    )}
                  </>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Checkout Wizard ── */}
      <AnimatePresence>
        {showWizard && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
          >
            <motion.div
              initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="flex h-[100dvh] w-full flex-col bg-white shadow-2xl sm:h-auto sm:max-h-[92dvh] sm:max-w-xl sm:rounded-2xl sm:overflow-hidden"
            >
              {/* Header */}
              <div className="flex-shrink-0 border-b border-slate-100 px-5 py-4">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Cashier</p>
                    <p className="font-bold text-slate-900">{STEPS[step].label}</p>
                  </div>
                  <button onClick={closeWizard} className="rounded-lg p-1.5 text-slate-300 hover:bg-slate-100 hover:text-slate-600">
                    <X className="h-5 w-5" />
                  </button>
                </div>
                {/* Step indicator */}
                <div className="flex gap-1.5">
                  {STEPS.map((s, i) => {
                    const done = i < step; const active = i === step;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => goTo(i)}
                        className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-semibold transition ${
                          active ? 'bg-slate-900 text-white' : done ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400 hover:text-slate-600'
                        }`}
                      >
                        {done ? <Check className="h-3 w-3" /> : <s.icon className="h-3 w-3" />}
                        <span className="hidden sm:inline">{s.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Body */}
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={step}
                    initial={{ x: dir * 24, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: dir * -24, opacity: 0 }}
                    transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                  >
                    {wizardSteps[step]}
                  </motion.div>
                </AnimatePresence>
                <AnimatePresence>
                  {error && showWizard && (
                    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-4">
                      <Alert type="error">{error}</Alert>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Footer */}
              <div className="flex-shrink-0 border-t border-slate-100 px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                  <Btn variant="secondary" onClick={() => goTo(step - 1)} disabled={step === 0}>
                    <ChevronLeft className="h-4 w-4" /> Back
                  </Btn>
                  <span className="text-xs text-slate-300 font-mono">{step + 1}/{STEPS.length}</span>
                  {step < STEPS.length - 1 ? (
                    <Btn variant="primary" onClick={handleWizardNext}>
                      {step === 0 ? 'Choose seats' : 'Checkout'}
                      <ArrowRight className="h-4 w-4" />
                    </Btn>
                  ) : assignForm.source === 'DOOR' ? (
                    <motion.button
                      type="button"
                      onClick={finalizeInPersonSale}
                      disabled={inPersonSubmitting || (paymentMethod === 'STRIPE' && !selectedTerminalId)}
                      whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                      className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50"
                    >
                      <Check className="h-4 w-4" />
                      {inPersonSubmitting
                        ? (paymentMethod === 'STRIPE' ? 'Sending…' : 'Processing…')
                        : paymentMethod === 'STRIPE'
                          ? `Send · ${fmtDollars(subtotalCents)}`
                          : `Collect · ${fmtDollars(subtotalCents)}`}
                    </motion.button>
                  ) : (
                    <motion.button
                      type="button"
                      onClick={assignOrder}
                      disabled={submitting}
                      whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                      className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50"
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
      </AnimatePresence>

      {/* ── Seat Picker Modal ── */}
      <AnimatePresence>
        {showWizard && seatPickerOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 sm:items-center sm:p-4"
          >
            <motion.div
              initial={{ scale: 0.97, opacity: 0, y: 12 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.97, opacity: 0, y: 12 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="flex h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:h-auto sm:max-h-[90dvh] sm:max-w-5xl sm:rounded-2xl"
            >
              {/* Header */}
              <div className="flex-shrink-0 border-b border-slate-100 px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold text-slate-900">Select seats</p>
                    <p className="text-xs text-slate-400">{selectedPerformance?.title ?? '—'} · {seatIds.length} selected</p>
                  </div>
                  <div className="flex gap-2">
                    <Btn size="sm" variant="primary" onClick={moveOnFromSeatPicker}>Done <ChevronRight className="h-3.5 w-3.5" /></Btn>
                    <button onClick={() => setSeatPickerOpen(false)} className="rounded-lg p-1.5 text-slate-300 hover:bg-slate-100 hover:text-slate-600"><X className="h-5 w-5" /></button>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <Btn size="sm" variant="ghost" onClick={() => void loadSeatsForPerformance(assignForm.performanceId)}>
                    <RefreshCw className={`h-3.5 w-3.5 ${loadingSeats ? 'animate-spin' : ''}`} /> Refresh
                  </Btn>
                  {seatPickerError && <p className="text-xs text-red-600">{seatPickerError}</p>}
                </div>
              </div>

              {/* Section tabs */}
              <div className="flex-shrink-0 border-b border-slate-100 px-5 py-2.5">
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {['All', ...sections].map(sec => (
                    <button
                      key={sec}
                      type="button"
                      onClick={() => setActiveSection(sec)}
                      className={`rounded-md px-3 py-1 text-xs font-medium transition ${activeSection === sec ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                    >
                      {sec}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {[
                    ['Available', 'bg-white border border-slate-300'],
                    ['Held', 'bg-amber-300'], ['Sold', 'bg-slate-300'], ['Blocked', 'bg-red-300'],
                    ['Selected', 'bg-emerald-500'], ['Accessible', 'bg-blue-400'], ['Companion', 'bg-cyan-400'],
                  ].map(([label, cls]) => (
                    <span key={label} className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                      <span className={`h-2 w-2 rounded-sm ${cls}`} />{label}
                    </span>
                  ))}
                </div>
              </div>

              {/* Map */}
              <div className="min-h-0 flex-1 px-5 py-3">
                <div className="h-full overflow-hidden rounded-xl border border-slate-100">
                  <SeatMapViewport
                    seats={seats} visibleSeats={visibleSeats}
                    loading={loadingSeats} loadingLabel="Loading…" emptyText="No seats."
                    resetKey={assignForm.performanceId || 'seat-map'}
                    containerClassName="h-[420px] sm:h-full"
                    verticalAlign="top"
                    controlsClassName="absolute bottom-4 right-4 z-30 flex flex-col gap-2"
                    renderSeat={({ seat, x, y }) => {
                      const isSelected = selectedSeatIdSet.has(seat.id);
                      const unavailable = seat.status === 'held' || seat.status === 'sold' || seat.status === 'blocked';
                      const companionOk = !seat.isCompanion || isSelected || (seat.companionForSeatId ? selectedSeatIdSet.has(seat.companionForSeatId) : hasAccessibleSelection);
                      const selectable = !unavailable && companionOk;
                      return (
                        <button
                          key={seat.id}
                          type="button"
                          onClick={() => toggleSeat(seat.id)}
                          disabled={!isSelected && !selectable}
                          style={{ left: `${x}px`, top: `${y}px` }}
                          title={`${seat.id} · ${seat.sectionName} ${seat.row}-${seat.number} · ${seat.status}`}
                          className={[
                            'seat-button absolute flex h-8 w-8 items-center justify-center rounded-t-lg rounded-b-md text-[10px] font-bold transition-all md:h-10 md:w-10',
                            isSelected ? 'z-10 scale-110 bg-emerald-500 text-white shadow-lg ring-2 ring-emerald-300'
                            : unavailable ? 'cursor-not-allowed bg-slate-200 text-slate-400'
                            : seat.isCompanion ? 'border-2 border-cyan-400 bg-cyan-100 text-cyan-700 hover:-translate-y-1 hover:shadow-md'
                            : seat.isAccessible ? 'border-2 border-blue-400 bg-blue-100 text-blue-700 hover:-translate-y-1 hover:shadow-md'
                            : 'border-2 border-slate-200 bg-white text-slate-600 hover:-translate-y-1 hover:border-slate-900 hover:shadow-md'
                          ].join(' ')}
                        >
                          <div className={`absolute -left-0.5 bottom-1 h-3.5 w-0.5 rounded-full opacity-40 ${isSelected ? 'bg-emerald-600' : seat.isCompanion ? 'bg-cyan-500' : seat.isAccessible ? 'bg-blue-500' : 'bg-slate-300'}`} />
                          <div className={`absolute -right-0.5 bottom-1 h-3.5 w-0.5 rounded-full opacity-40 ${isSelected ? 'bg-emerald-600' : seat.isCompanion ? 'bg-cyan-500' : seat.isAccessible ? 'bg-blue-500' : 'bg-slate-300'}`} />
                          {seat.number}
                        </button>
                      );
                    }}
                  />
                </div>
              </div>

              {/* Footer */}
              <div className="flex-shrink-0 border-t border-slate-100 px-5 py-3">
                <div className="mb-3 flex flex-wrap gap-2 min-h-[32px]">
                  {selectedMappedSeats.length === 0 && selectedUnknownSeatIds.length === 0
                    ? <p className="text-sm text-slate-400">No seats selected yet.</p>
                    : <>
                        {selectedMappedSeats.map(seat => (
                          <button key={seat.id} type="button" onClick={() => toggleSeat(seat.id)}
                            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-mono text-slate-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700"
                          >
                            {seat.sectionName} {seat.row}-{seat.number} <X className="h-2.5 w-2.5" />
                          </button>
                        ))}
                        {selectedUnknownSeatIds.map(id => (
                          <button key={id} type="button" onClick={() => toggleSeat(id)}
                            className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-mono text-amber-700 transition hover:bg-amber-100"
                          >
                            {id} <X className="h-2.5 w-2.5" />
                          </button>
                        ))}
                      </>
                  }
                </div>
                <div className="flex justify-end">
                  <Btn variant="primary" onClick={moveOnFromSeatPicker}>
                    Confirm {seatIds.length > 0 ? `${seatIds.length} seat${seatIds.length !== 1 ? 's' : ''}` : 'seats'} <ChevronRight className="h-4 w-4" />
                  </Btn>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}