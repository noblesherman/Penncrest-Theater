import { useEffect, useMemo, useState, useRef, useCallback, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe, type StripeElementsOptions } from '@stripe/stripe-js';
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  CreditCard,
  Mail,
  Phone,
  Search,
  Ticket,
  User,
  Users,
  X
} from 'lucide-react';
import { SeatMapViewport } from '../components/SeatMapViewport';
import EventRegistrationCheckoutForm from '../components/EventRegistrationCheckoutForm';
import { apiFetch } from '../lib/api';
import { getClientToken } from '../lib/clientToken';
import { buildCheckoutThankYouPath, rememberOrderAccessToken } from '../lib/orderAccess';
import type { EventRegistrationPublicFormResponse, EventRegistrationSubmissionPayload } from '../lib/eventRegistrationForm';

interface Seat {
  id: string;
  row: string;
  number: number;
  x: number;
  y: number;
  status: 'available' | 'sold' | 'held' | 'blocked';
  isAccessible?: boolean;
  isCompanion?: boolean;
  companionForSeatId?: string | null;
  sectionName: string;
  price: number;
}

interface HoldResponse {
  holdToken: string;
  expiresAt: string;
  heldSeatIds: string[];
}

type PricingTier = {
  id: string;
  name: string;
  priceCents: number;
};

type PerformanceDetails = {
  id: string;
  title: string;
  isFundraiser?: boolean;
  pricingTiers: PricingTier[];
  studentCompTicketsEnabled?: boolean;
  seatSelectionEnabled?: boolean;
  registrationFormRequired?: boolean;
};

type CheckoutStep = 1 | 2 | 3 | 4 | 5;

type TicketOption = {
  id: string;
  label: string;
  priceCents: number;
  tierId?: string;
};

type SelectedSeatPricing = {
  seat: Seat;
  optionId: string | null;
  optionLabel: string;
  basePrice: number;
  unitPrice: number;
  isTeacherTicket: boolean;
  isStudentInShowTicket: boolean;
  isTeacherComplimentary: boolean;
  isStudentComplimentary: boolean;
};

type DirectCheckoutResponse = {
  url?: string;
  orderId?: string;
  orderAccessToken?: string;
  clientSecret?: string;
  publishableKey?: string;
  mode?: 'PAID' | 'TEACHER_COMP' | 'STUDENT_COMP';
};

type QueuedCheckoutResponse = {
  status: 'QUEUED';
  queueId: string;
  position: number;
  estimatedWaitSeconds: number;
  refreshAfterMs: number;
};

type CheckoutResponse = DirectCheckoutResponse | QueuedCheckoutResponse;

type QueueStatusResponse =
  | {
      status: 'WAITING';
      queueId: string;
      position: number;
      estimatedWaitSeconds: number;
      refreshAfterMs: number;
    }
  | {
      status: 'READY';
      queueId: string;
      orderId: string;
      orderAccessToken: string;
      clientSecret?: string;
      publishableKey?: string;
      mode: 'PAID' | 'TEACHER_COMP' | 'STUDENT_COMP';
    }
  | {
      status: 'FAILED' | 'EXPIRED';
      queueId: string;
      reason: string;
      message: string;
    };

type CheckoutQueueState = {
  queueId: string;
  holdToken: string;
  position: number;
  estimatedWaitSeconds: number;
  refreshAfterMs: number;
};

type PendingStripePayment = {
  clientSecret: string;
  publishableKey: string;
  orderId: string;
  orderAccessToken?: string;
};

const CHECKOUT_STEPS: Array<{ id: CheckoutStep; label: string }> = [
  { id: 1, label: 'Pick Seats' },
  { id: 2, label: 'Ticket Types' },
  { id: 3, label: 'Contact Info' },
  { id: 4, label: 'Questionnaire' },
  { id: 5, label: 'Checkout' }
];

const TEACHER_TICKET_OPTION_ID = 'teacher-comp';
const STUDENT_SHOW_TICKET_OPTION_ID = 'student-show-comp';
const MAX_TEACHER_COMP_TICKETS = 2;
const MAX_STUDENT_COMP_TICKETS = 2;
const naturalSort = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
const SEAT_X_STEP = 40;
const MAX_ADJACENT_X_GAP = SEAT_X_STEP * 1.5;
const FALLBACK_STRIPE_PUBLISHABLE_KEY = (import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '').trim();
const SEAT_POLL_BASE_INTERVAL_MS = 45_000;
const SEAT_POLL_JITTER_MS = 5_000;
const CHECKOUT_QUEUE_VISIBILITY_THRESHOLD = 5;

function getSeatPollDelayMs(): number {
  return SEAT_POLL_BASE_INTERVAL_MS + Math.floor(Math.random() * SEAT_POLL_JITTER_MS);
}


function getChildName(registrationForm: any, registrationPayload: any, index: number): string | null {
  if (!registrationForm || !registrationPayload || !registrationPayload.sections) return null;
  const sectionsData = registrationPayload.sections;
  for (const s of registrationForm.definition.sections) {
    if (s.hidden || s.type === 'single') continue;
    const nameF = s.fields.find((f: any) => f.label.toLowerCase().includes('first name') || f.label.toLowerCase().includes('camper name') || f.label.toLowerCase().includes('name'));
    if (nameF) {
      const records = (sectionsData[s.id] as any[]) || [];
      const r = records[index] || {};
      if (r[nameF.id] && String(r[nameF.id]).trim()) {
        return String(r[nameF.id]).trim().split(' ')[0];
      }
    }
  }
  return null;
}

function stringArrayEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function isQueuedCheckoutResponse(response: CheckoutResponse): response is QueuedCheckoutResponse {
  return (response as QueuedCheckoutResponse).status === 'QUEUED';
}

function formatWaitEstimate(seconds: number): string {
  if (seconds <= 0) return 'Less than a minute';
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes <= 0) return `${Math.max(1, remainder)} sec`;
  if (remainder === 0) return `${minutes} min`;
  return `${minutes}m ${remainder}s`;
}

function isFirstCamperLabel(label: string): boolean {
  return /\b1st\s*camper\b/i.test(label.trim());
}

function InlineStripePaymentForm({
  disabled,
  onError,
  onSuccess
}: {
  disabled: boolean;
  onError: (message: string) => void;
  onSuccess: () => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [confirming, setConfirming] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onError('');

    if (!stripe || !elements) {
      onError('Payment form is still loading. Please try again.');
      return;
    }

    setConfirming(true);
    const result = await stripe.confirmPayment({
      elements,
      redirect: 'if_required'
    });
    setConfirming(false);

    if (result.error) {
      onError(result.error.message || 'Payment could not be completed.');
      return;
    }

    const status = result.paymentIntent?.status;
    if (status === 'succeeded' || status === 'processing' || status === 'requires_capture') {
      onSuccess();
      return;
    }

    onError(`Payment did not complete. Current status: ${status || 'unknown'}.`);
  };

  return (
    <form onSubmit={handleSubmit} className="mt-5 space-y-4">
      <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
        <PaymentElement />
      </div>
      <button
        type="submit"
        disabled={disabled || confirming || !stripe || !elements}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-red-700 px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-red-800 transition-colors"
      >
        <CreditCard className="w-4 h-4" />
        {confirming ? 'Processing payment...' : 'Pay now'}
      </button>
    </form>
  );
}

const buildSeatGrid = (seats: Seat[]) => {
  const grid: Record<string, Record<string, Seat[]>> = {};

  seats.forEach((seat) => {
    if (!grid[seat.sectionName]) grid[seat.sectionName] = {};
    if (!grid[seat.sectionName][seat.row]) grid[seat.sectionName][seat.row] = [];
    grid[seat.sectionName][seat.row].push(seat);
  });

  Object.keys(grid).forEach((section) => {
    Object.keys(grid[section]).forEach((row) => {
      grid[section][row].sort((a, b) => {
        if (a.x !== b.x) return a.x - b.x;
        return a.number - b.number;
      });
    });
  });

  return grid;
};

function pickComplimentarySeatIds(items: Array<{ seat: Seat; basePrice: number }>, quantity: number): Set<string> {
  if (quantity <= 0) return new Set();

  const rankedSeats = [...items]
    .sort((a, b) => {
      if (a.basePrice !== b.basePrice) return b.basePrice - a.basePrice;
      if (a.seat.sectionName !== b.seat.sectionName) return a.seat.sectionName.localeCompare(b.seat.sectionName);
      if (a.seat.row !== b.seat.row) return naturalSort(a.seat.row, b.seat.row);
      return a.seat.number - b.seat.number;
    });

  return new Set(rankedSeats.slice(0, quantity).map((item) => item.seat.id));
}

function isTeacherTicketLabel(label: string): boolean {
  const normalized = label.trim().toLowerCase();
  return normalized.includes('teacher') || (normalized.includes('rtmsd') && normalized.includes('staff'));
}

export default function Booking() {
  const { performanceId } = useParams();
  const navigate = useNavigate();
  const clientTokenRef = useRef<string>(getClientToken());
  const holdTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [performanceTitle, setPerformanceTitle] = useState('Ticket Checkout');
  const [pricingTiers, setPricingTiers] = useState<PricingTier[]>([]);
  const [isFundraiser, setIsFundraiser] = useState(false);
  const [studentCompTicketsEnabled, setStudentCompTicketsEnabled] = useState(false);
  const [seatSelectionEnabled, setSeatSelectionEnabled] = useState(true);
  const [ticketOptionBySeatId, setTicketOptionBySeatId] = useState<Record<string, string>>({});

  const [seats, setSeats] = useState<Seat[]>([]);
  const [selectedSeatIds, setSelectedSeatIds] = useState<string[]>([]);
  const [heldByMeSeatIds, setHeldByMeSeatIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [activeSection, setActiveSection] = useState<string>('All');
  const [adjacentCount, setAdjacentCount] = useState(2);
  const [holdToken, setHoldToken] = useState('');
  const [holdError, setHoldError] = useState<string | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [studentCode, setStudentCode] = useState('');
  const [autoSeatCount, setAutoSeatCount] = useState(2);
  const [currentStep, setCurrentStep] = useState<CheckoutStep>(1);
  const [teacherPromoCode, setTeacherPromoCode] = useState('');
  const [pendingStripePayment, setPendingStripePayment] = useState<PendingStripePayment | null>(null);
  const [checkoutQueue, setCheckoutQueue] = useState<CheckoutQueueState | null>(null);
  const [registrationForm, setRegistrationForm] = useState<Extract<EventRegistrationPublicFormResponse, { enabled: true }> | null>(null);
  const [registrationPayload, setRegistrationPayload] = useState<EventRegistrationSubmissionPayload | null>(null);
  const [registrationValid, setRegistrationValid] = useState(true);

  const fetchSeats = useCallback(async () => {
    if (!performanceId) return;

    try {
      const data = await apiFetch<Seat[] | { seats: Seat[] }>(`/api/performances/${performanceId}/seats`);
      const seatList = Array.isArray(data) ? data : data.seats;
      setSeats(seatList);
    } catch (err) {
      console.error('We hit a small backstage snag while trying to fetch seats', err);
    } finally {
      setLoading(false);
    }
  }, [performanceId]);

  const fetchPerformanceDetails = useCallback(async () => {
    if (!performanceId) return;

    try {
      const details = await apiFetch<PerformanceDetails>(`/api/performances/${performanceId}`);
      setPerformanceTitle(details.title || 'Ticket Checkout');
      setIsFundraiser(Boolean(details.isFundraiser));
      setPricingTiers(details.pricingTiers || []);
      setStudentCompTicketsEnabled(Boolean(details.studentCompTicketsEnabled));
      setSeatSelectionEnabled(details.seatSelectionEnabled !== false);
    } catch (err) {
      console.error('We hit a small backstage snag while trying to fetch performance details', err);
      setIsFundraiser(false);
      setPricingTiers([]);
      setStudentCompTicketsEnabled(false);
      setSeatSelectionEnabled(true);
    }
  }, [performanceId]);

  const fetchRegistrationForm = useCallback(async () => {
    if (!performanceId) return;

    try {
      const response = await apiFetch<EventRegistrationPublicFormResponse>(`/api/performances/${performanceId}/registration-form`);
      if (response.enabled) {
        setRegistrationForm(response);
        return;
      }
      setRegistrationForm(null);
    } catch (err) {
      console.error('We hit a small backstage snag while trying to fetch registration form', err);
      setRegistrationForm(null);
    }
  }, [performanceId]);

  const syncHolds = useCallback(
    async (seatIds: string[]): Promise<HoldResponse | null> => {
      if (!performanceId) return null;

      try {
        const result = await apiFetch<HoldResponse>('/api/hold', {
          method: 'POST',
          body: JSON.stringify({
            performanceId,
            seatIds,
            clientToken: clientTokenRef.current
          })
        });

        setHoldToken(result.holdToken);
        setHeldByMeSeatIds(result.heldSeatIds);
        setHoldError(null);

        if (result.heldSeatIds.length !== seatIds.length) {
          setSelectedSeatIds(result.heldSeatIds);
        }

        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'We hit a small backstage snag while trying to update seat hold';
        setHoldError(message);
        await fetchSeats();
        return null;
      }
    },
    [fetchSeats, performanceId]
  );

  useEffect(() => {
    void fetchSeats();
    void fetchPerformanceDetails();
    void fetchRegistrationForm();

    let stopped = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleSeatRefresh = () => {
      if (stopped) return;

      pollTimer = setTimeout(() => {
        if (document.visibilityState === 'visible') {
          void fetchSeats();
        }

        scheduleSeatRefresh();
      }, getSeatPollDelayMs());
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void fetchSeats();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    scheduleSeatRefresh();

    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [fetchPerformanceDetails, fetchRegistrationForm, fetchSeats]);

  useEffect(() => {
    if (selectedSeatIds.length === 0 && !holdToken) return;

    if (holdTimeoutRef.current) clearTimeout(holdTimeoutRef.current);
    holdTimeoutRef.current = setTimeout(() => {
      void syncHolds(selectedSeatIds);
    }, 350);

    return () => {
      if (holdTimeoutRef.current) clearTimeout(holdTimeoutRef.current);
    };
  }, [selectedSeatIds, holdToken, syncHolds]);

  useEffect(() => {
    return () => {
      if (!performanceId) return;
      void apiFetch('/api/hold', {
        method: 'POST',
        body: JSON.stringify({
          performanceId,
          seatIds: [],
          clientToken: clientTokenRef.current
        })
      }).catch(() => undefined);
    };
  }, [performanceId]);

  const ticketOptions = useMemo<TicketOption[]>(() => {
    if (pricingTiers.length === 0) return [];
    const tierOptions: TicketOption[] = pricingTiers
      .filter((tier) => !isFundraiser || !(tier.id === TEACHER_TICKET_OPTION_ID || isTeacherTicketLabel(tier.name)))
      .map((tier) => ({
        id: tier.id,
        label: tier.name,
        priceCents: tier.priceCents,
        tierId: tier.id
      }));

    const hasTeacherOption = tierOptions.some((option) => option.id === TEACHER_TICKET_OPTION_ID || isTeacherTicketLabel(option.label));
    if (!isFundraiser && !hasTeacherOption) {
      tierOptions.push({
        id: TEACHER_TICKET_OPTION_ID,
        label: 'RTMSD STAFF',
        priceCents: 0
      });
    }

    const hasStudentInShowOption = tierOptions.some((option) => option.id === STUDENT_SHOW_TICKET_OPTION_ID);
    if (studentCompTicketsEnabled && !hasStudentInShowOption) {
      tierOptions.push({
        id: STUDENT_SHOW_TICKET_OPTION_ID,
        label: 'Student in Show',
        priceCents: 0
      });
    }

    return tierOptions;
  }, [isFundraiser, pricingTiers, studentCompTicketsEnabled]);

  const firstCamperOptionId = useMemo(
    () => ticketOptions.find((option) => isFirstCamperLabel(option.label))?.id || null,
    [ticketOptions]
  );
  const fallbackNonFirstCamperOptionId = useMemo(
    () => ticketOptions.find((option) => !isFirstCamperLabel(option.label))?.id || null,
    [ticketOptions]
  );

  useEffect(() => {
    if (selectedSeatIds.length === 0) {
      setTicketOptionBySeatId({});
      return;
    }

    if (ticketOptions.length === 0) return;

    const validOptionIds = new Set(ticketOptions.map((option) => option.id));
    const defaultOptionId = ticketOptions[0]?.id;

    setTicketOptionBySeatId((prev) => {
      const next: Record<string, string> = {};
      let firstCamperUsed = false;
      selectedSeatIds.forEach((seatId) => {
        const prevOptionId = prev[seatId];
        if (prevOptionId && validOptionIds.has(prevOptionId)) {
          if (firstCamperOptionId && prevOptionId === firstCamperOptionId) {
            if (firstCamperUsed) {
              next[seatId] = fallbackNonFirstCamperOptionId || defaultOptionId || prevOptionId;
              return;
            }
            firstCamperUsed = true;
          }
          next[seatId] = prevOptionId;
          return;
        }
        if (defaultOptionId) {
          if (firstCamperOptionId && defaultOptionId === firstCamperOptionId && firstCamperUsed) {
            next[seatId] = fallbackNonFirstCamperOptionId || defaultOptionId;
            return;
          }
          next[seatId] = defaultOptionId;
          if (firstCamperOptionId && defaultOptionId === firstCamperOptionId) {
            firstCamperUsed = true;
          }
        }
      });
      return next;
    });
  }, [fallbackNonFirstCamperOptionId, firstCamperOptionId, selectedSeatIds, ticketOptions]);

  useEffect(() => {
    if (selectedSeatIds.length > 0) return;
    if (currentStep === 1) return;
    setCurrentStep(1);
  }, [currentStep, selectedSeatIds.length]);

  useEffect(() => {
    if (currentStep === 5) return;
    if (!pendingStripePayment) return;
    setPendingStripePayment(null);
  }, [currentStep, pendingStripePayment]);

  useEffect(() => {
    if (currentStep === 5) return;
    if (!checkoutQueue) return;
    setCheckoutQueue(null);
  }, [checkoutQueue, currentStep]);

  useEffect(() => {
    setRegistrationPayload(null);
    setRegistrationValid(!registrationForm);
  }, [registrationForm?.versionId, registrationForm]);

  const handleSeatClick = (seat: Seat) => {
    if (!seatSelectionEnabled) {
      return;
    }

    if (pendingStripePayment) {
      setPendingStripePayment(null);
    }
    if (checkoutQueue) {
      setCheckoutQueue(null);
    }

    const isSelected = selectedSeatIds.includes(seat.id);
    const heldByMe = heldByMeSeatIds.includes(seat.id);
    if (!isSelected && seat.status !== 'available' && !heldByMe) return;

    if (!isSelected && seat.isCompanion) {
      const companionAccessibleSelected = seat.companionForSeatId
        ? selectedSeatIds.includes(seat.companionForSeatId)
        : seats.some((candidate) => candidate.isAccessible && selectedSeatIds.includes(candidate.id));

      if (!companionAccessibleSelected) {
        alert('This companion seat requires selecting the paired accessible seat first.');
        return;
      }
    }

    setSelectedSeatIds((prev) => {
      if (prev.includes(seat.id)) {
        return prev.filter((id) => id !== seat.id);
      }
      return [...prev, seat.id];
    });
  };

  const handleSeatOptionChange = (seatId: string, optionId: string) => {
    if (pendingStripePayment) {
      setPendingStripePayment(null);
    }
    if (checkoutQueue) {
      setCheckoutQueue(null);
    }

    setTicketOptionBySeatId((prev) => {
      if (!firstCamperOptionId || optionId !== firstCamperOptionId) {
        return {
          ...prev,
          [seatId]: optionId
        };
      }

      const anotherSeatAlreadyHasFirstCamper = selectedSeatIds.some(
        (selectedSeatId) => selectedSeatId !== seatId && prev[selectedSeatId] === firstCamperOptionId
      );

      return {
        ...prev,
        [seatId]: anotherSeatAlreadyHasFirstCamper ? fallbackNonFirstCamperOptionId || optionId : optionId
      };
    });
  };

  const resetPendingPayment = useCallback(() => {
    setPendingStripePayment(null);
  }, []);

  const stripePromise = useMemo(() => {
    if (!pendingStripePayment?.publishableKey) return null;
    return loadStripe(pendingStripePayment.publishableKey);
  }, [pendingStripePayment?.publishableKey]);

  const stripeElementsOptions = useMemo<StripeElementsOptions | null>(() => {
    if (!pendingStripePayment) return null;
    return {
      clientSecret: pendingStripePayment.clientSecret,
      appearance: {
        theme: 'stripe'
      }
    };
  }, [pendingStripePayment]);

  const finalizeEmbeddedPayment = useCallback(() => {
    if (!pendingStripePayment?.orderId) {
      setStepError('Missing order details for confirmation.');
      return;
    }

    rememberOrderAccessToken(pendingStripePayment.orderId, pendingStripePayment.orderAccessToken);
    navigate(buildCheckoutThankYouPath(pendingStripePayment.orderId, pendingStripePayment.orderAccessToken));
  }, [navigate, pendingStripePayment]);

  useEffect(() => {
    if (!checkoutQueue) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const scheduleNext = (delayMs: number) => {
      if (cancelled) return;
      timer = setTimeout(() => {
        void pollQueueStatus();
      }, Math.max(500, delayMs));
    };

    const pollQueueStatus = async () => {
      try {
        const status = await apiFetch<QueueStatusResponse>(
          `/api/checkout/queue/${encodeURIComponent(checkoutQueue.queueId)}?holdToken=${encodeURIComponent(checkoutQueue.holdToken)}&clientToken=${encodeURIComponent(clientTokenRef.current)}`
        );

        if (cancelled) return;

        if (status.status === 'WAITING') {
          setCheckoutQueue((prev) =>
            prev && prev.queueId === status.queueId
              ? {
                  ...prev,
                  position: status.position,
                  estimatedWaitSeconds: status.estimatedWaitSeconds,
                  refreshAfterMs: status.refreshAfterMs
                }
              : prev
          );
          scheduleNext(status.refreshAfterMs);
          return;
        }

        if (status.status === 'READY') {
          setCheckoutQueue(null);
          setProcessing(false);

          if (status.clientSecret && status.orderId) {
            const publishableKey = (status.publishableKey || FALLBACK_STRIPE_PUBLISHABLE_KEY || '').trim();
            if (!publishableKey) {
              throw new Error('Stripe publishable key is not configured.');
            }

            rememberOrderAccessToken(status.orderId, status.orderAccessToken);
            setPendingStripePayment({
              clientSecret: status.clientSecret,
              publishableKey,
              orderId: status.orderId,
              orderAccessToken: status.orderAccessToken
            });
            return;
          }

          if (status.orderId) {
            rememberOrderAccessToken(status.orderId, status.orderAccessToken);
            navigate(buildCheckoutThankYouPath(status.orderId, status.orderAccessToken));
            return;
          }

          throw new Error('Queued checkout completed without order details.');
        }

        setCheckoutQueue(null);
        setPendingStripePayment(null);
        setProcessing(false);
        setStepError(status.message || 'Checkout could not be completed.');
        setCurrentStep(1);
        setSelectedSeatIds([]);
        setHeldByMeSeatIds([]);
        setHoldToken('');
        await fetchSeats();
      } catch (err) {
        if (cancelled) return;
        setStepError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to refresh checkout queue status');
        scheduleNext(Math.max(2500, checkoutQueue.refreshAfterMs));
      }
    };

    void pollQueueStatus();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [checkoutQueue, fetchSeats, navigate]);

  const handleCheckout = async () => {
    if (!performanceId) return;
    if (selectedSeatIds.length === 0) {
      setStepError(`Select at least one ${checkoutUnitLabel} before checkout.`);
      setCurrentStep(1);
      return;
    }

    if (ticketOptions.length > 0 && selectedSeatIds.some((seatId) => !ticketOptionBySeatId[seatId])) {
      setStepError(`Select a ticket type for every ${checkoutUnitLabel} before checkout.`);
      setCurrentStep(2);
      return;
    }

    const tierCountMap = new Map<string, number>();
    const ticketSelectionBySeatId: Record<string, string> = {};
    selectedSeatIds.forEach((seatId) => {
      const optionId = ticketOptionBySeatId[seatId];
      if (!optionId) return;
      const option = ticketOptions.find((item) => item.id === optionId);
      const selectionId = option?.tierId || optionId;
      ticketSelectionBySeatId[seatId] = selectionId;
      tierCountMap.set(selectionId, (tierCountMap.get(selectionId) || 0) + 1);
    });

    const ticketSelections = [...tierCountMap.entries()].map(([tierId, count]) => ({ tierId, count }));

    if (hasMixedCompSelection) {
      setStepError('Teacher and Student in Show complimentary tickets cannot be mixed in one checkout.');
      setCurrentStep(2);
      return;
    }

    if (registrationRequired && (!registrationValid || !registrationPayload)) {
      setStepError('Complete the registration form before checkout.');
      setCurrentStep(4);
      return;
    }

    setProcessing(true);
    setStepError(null);
    setPendingStripePayment(null);
    setCheckoutQueue(null);

    try {
      const holdResult = await syncHolds(selectedSeatIds);
      if (!holdResult || holdResult.heldSeatIds.length !== selectedSeatIds.length) {
        throw new Error('We could not lock selected seats. Please try again.');
      }

      let checkout: CheckoutResponse;

      if (isTeacherCheckout) {
        const effectiveCustomerName = customerName.trim();
        const effectiveCustomerEmail = customerEmail.trim().toLowerCase();
        const effectiveCustomerPhone = customerPhone.trim();
        if (!effectiveCustomerName || !effectiveCustomerEmail) {
          setStepError('Enter your name and personal email before checkout.');
          setCurrentStep(3);
          return;
        }
        if (!effectiveCustomerPhone) {
          setStepError('Enter a phone number before checkout.');
          setCurrentStep(3);
          return;
        }
        if (effectiveCustomerEmail.endsWith('@rtmsd.org')) {
          setStepError('Use a personal email for ticket delivery (not @rtmsd.org).');
          setCurrentStep(3);
          return;
        }
        const normalizedTeacherPromoCode = teacherPromoCode.trim();
        if (!normalizedTeacherPromoCode) {
          setStepError('Enter the teacher promo code before checkout.');
          setCurrentStep(3);
          return;
        }

        checkout = await apiFetch<CheckoutResponse>('/api/checkout', {
          method: 'POST',
          body: JSON.stringify({
            performanceId,
            checkoutMode: 'TEACHER_COMP',
            seatIds: holdResult.heldSeatIds,
            ticketSelections: ticketSelections.length > 0 ? ticketSelections : undefined,
            ticketSelectionBySeatId,
            holdToken: holdResult.holdToken,
            clientToken: clientTokenRef.current,
            customerEmail: effectiveCustomerEmail,
            customerName: effectiveCustomerName,
            customerPhone: effectiveCustomerPhone,
            teacherPromoCode: normalizedTeacherPromoCode,
            registrationSubmission: registrationRequired ? registrationPayload : undefined
          })
        });
      } else if (isStudentInShowCheckout) {
        const effectiveCustomerName = customerName.trim();
        const effectiveCustomerEmail = customerEmail.trim().toLowerCase();
        const effectiveCustomerPhone = customerPhone.trim();
        const normalizedStudentCode = studentCode.trim().toLowerCase().replace(/\s+/g, '');

        if (!effectiveCustomerName || !effectiveCustomerEmail) {
          setStepError('Enter your name and personal email before checkout.');
          setCurrentStep(3);
          return;
        }
        if (!effectiveCustomerPhone) {
          setStepError('Enter a phone number before checkout.');
          setCurrentStep(3);
          return;
        }
        if (!normalizedStudentCode) {
          setStepError('Enter your student code for verification before checkout.');
          setCurrentStep(3);
          return;
        }

        checkout = await apiFetch<CheckoutResponse>('/api/checkout', {
          method: 'POST',
          body: JSON.stringify({
            performanceId,
            checkoutMode: 'STUDENT_COMP',
            seatIds: holdResult.heldSeatIds,
            ticketSelections: ticketSelections.length > 0 ? ticketSelections : undefined,
            ticketSelectionBySeatId,
            holdToken: holdResult.holdToken,
            clientToken: clientTokenRef.current,
            customerEmail: effectiveCustomerEmail,
            customerName: effectiveCustomerName,
            customerPhone: effectiveCustomerPhone,
            studentCode: normalizedStudentCode,
            registrationSubmission: registrationRequired ? registrationPayload : undefined
          })
        });
      } else {
        const effectiveCustomerName = customerName.trim();
        const effectiveCustomerEmail = customerEmail.trim().toLowerCase();
        const effectiveCustomerPhone = customerPhone.trim();

        if (!effectiveCustomerName || !effectiveCustomerEmail) {
          setStepError('Enter your name and email before checkout.');
          setCurrentStep(3);
          return;
        }
        if (!effectiveCustomerPhone) {
          setStepError('Enter a phone number before checkout.');
          setCurrentStep(3);
          return;
        }

        checkout = await apiFetch<CheckoutResponse>('/api/checkout', {
          method: 'POST',
          body: JSON.stringify({
            performanceId,
            checkoutMode: 'PAID',
            seatIds: holdResult.heldSeatIds,
            ticketSelections: ticketSelections.length > 0 ? ticketSelections : undefined,
            ticketSelectionBySeatId,
            holdToken: holdResult.holdToken,
            clientToken: clientTokenRef.current,
            customerEmail: effectiveCustomerEmail,
            customerName: effectiveCustomerName,
            customerPhone: effectiveCustomerPhone,
            registrationSubmission: registrationRequired ? registrationPayload : undefined
          })
        });
      }

      if (isQueuedCheckoutResponse(checkout)) {
        setCheckoutQueue({
          queueId: checkout.queueId,
          holdToken: holdResult.holdToken,
          position: checkout.position,
          estimatedWaitSeconds: checkout.estimatedWaitSeconds,
          refreshAfterMs: checkout.refreshAfterMs
        });
        return;
      }

      if (checkout.clientSecret && checkout.orderId) {
        const publishableKey = (checkout.publishableKey || FALLBACK_STRIPE_PUBLISHABLE_KEY || '').trim();
        if (!publishableKey) {
          throw new Error('Stripe publishable key is not configured.');
        }

        rememberOrderAccessToken(checkout.orderId, checkout.orderAccessToken);
        setPendingStripePayment({
          clientSecret: checkout.clientSecret,
          publishableKey,
          orderId: checkout.orderId,
          orderAccessToken: checkout.orderAccessToken
        });
        return;
      }

      if (checkout.orderId) {
        rememberOrderAccessToken(checkout.orderId, checkout.orderAccessToken);
        navigate(buildCheckoutThankYouPath(checkout.orderId, checkout.orderAccessToken));
        return;
      }

      throw new Error('Checkout response missing payment details.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Checkout failed';
      setStepError(message);
      setCheckoutQueue(null);
      await fetchSeats();
    } finally {
      setProcessing(false);
    }
  };

  const findAdjacentSeats = () => {
    const grid = buildSeatGrid(seats);
    let bestSeats: Seat[] = [];

    for (const sectionName of Object.keys(grid)) {
      const rows = grid[sectionName];
      for (const rowLabel of Object.keys(rows).sort(naturalSort)) {
        const rowSeats = rows[rowLabel];
        let currentBlock: Seat[] = [];
        let previousAvailableSeat: Seat | null = null;

        for (const seat of rowSeats) {
          const canUse = seat.status === 'available' || heldByMeSeatIds.includes(seat.id) || selectedSeatIds.includes(seat.id);
          if (seat.isCompanion && !selectedSeatIds.includes(seat.id)) {
            continue;
          }
          if (canUse) {
            const hasLargeGap =
              previousAvailableSeat !== null && seat.x - previousAvailableSeat.x > MAX_ADJACENT_X_GAP;

            if (hasLargeGap) {
              currentBlock = [seat];
            } else {
              currentBlock.push(seat);
            }

            previousAvailableSeat = seat;
            if (currentBlock.length === adjacentCount) {
              bestSeats = currentBlock;
              break;
            }
          } else {
            currentBlock = [];
            previousAvailableSeat = null;
          }
        }
        if (bestSeats.length > 0) break;
      }
      if (bestSeats.length > 0) break;
    }

    if (bestSeats.length > 0) {
      setSelectedSeatIds((prev) => {
        const next = new Set(prev);
        bestSeats.forEach((seat) => next.add(seat.id));
        return [...next];
      });
    } else {
      alert(`Could not find ${adjacentCount} adjacent seats.`);
    }
  };

  const seatGrid = useMemo(() => buildSeatGrid(seats), [seats]);
  const sections = useMemo(() => Object.keys(seatGrid), [seatGrid]);
  const autoAssignableSeatIds = useMemo(
    () =>
      seats
        .filter((seat) => {
          if (seat.isCompanion) return false;
          if (selectedSeatIds.includes(seat.id)) return seat.status !== 'sold' && seat.status !== 'blocked';
          if (heldByMeSeatIds.includes(seat.id)) return true;
          return seat.status === 'available';
        })
        .sort((a, b) => {
          if (a.sectionName !== b.sectionName) return a.sectionName.localeCompare(b.sectionName);
          if (a.row !== b.row) return naturalSort(a.row, b.row);
          return a.number - b.number;
        })
        .map((seat) => seat.id),
    [heldByMeSeatIds, seats, selectedSeatIds]
  );

  useEffect(() => {
    if (seatSelectionEnabled) return;

    const maxSelectable = autoAssignableSeatIds.length;
    const nextCount = Math.max(0, Math.min(autoSeatCount, maxSelectable));
    if (nextCount !== autoSeatCount) {
      setAutoSeatCount(nextCount);
      return;
    }

    const desiredSeatIds = autoAssignableSeatIds.slice(0, nextCount);
    setSelectedSeatIds((prev) => (stringArrayEqual(prev, desiredSeatIds) ? prev : desiredSeatIds));
  }, [autoAssignableSeatIds, autoSeatCount, seatSelectionEnabled]);

  const selectedSeats = useMemo(
    () =>
      seats
        .filter((seat) => selectedSeatIds.includes(seat.id))
        .sort((a, b) => {
          if (a.sectionName !== b.sectionName) return a.sectionName.localeCompare(b.sectionName);
          if (a.row !== b.row) return naturalSort(a.row, b.row);
          return a.number - b.number;
        }),
    [seats, selectedSeatIds]
  );

  const visibleSeats = useMemo(
    () => seats.filter((seat) => activeSection === 'All' || seat.sectionName === activeSection),
    [seats, activeSection]
  );

  const seatById = useMemo(() => new Map(seats.map((seat) => [seat.id, seat])), [seats]);
  const hasAccessibleSelection = useMemo(
    () => selectedSeatIds.some((seatId) => seatById.get(seatId)?.isAccessible),
    [selectedSeatIds, seatById]
  );

  const ticketOptionById = useMemo(() => new Map(ticketOptions.map((option) => [option.id, option])), [ticketOptions]);
  const teacherOptionIds = useMemo(
    () => new Set(ticketOptions.filter((option) => option.id === TEACHER_TICKET_OPTION_ID || isTeacherTicketLabel(option.label)).map((option) => option.id)),
    [ticketOptions]
  );
  const studentInShowOptionIds = useMemo(
    () => new Set(studentCompTicketsEnabled ? [STUDENT_SHOW_TICKET_OPTION_ID] : []),
    [studentCompTicketsEnabled]
  );

  const selectedSeatsWithBasePricing = useMemo(() => {
    return selectedSeats.map((seat) => {
      const selectedOptionId = ticketOptionBySeatId[seat.id] || null;
      const option = selectedOptionId ? ticketOptionById.get(selectedOptionId) : undefined;
      const isTeacherTicket = selectedOptionId ? teacherOptionIds.has(selectedOptionId) : false;
      const isStudentInShowTicket = selectedOptionId ? studentInShowOptionIds.has(selectedOptionId) : false;
      const basePrice =
        selectedOptionId === TEACHER_TICKET_OPTION_ID || selectedOptionId === STUDENT_SHOW_TICKET_OPTION_ID
          ? seat.price
          : option?.priceCents ?? seat.price;

      return {
        seat,
        optionId: selectedOptionId,
        optionLabel: option?.label || 'Standard',
        basePrice,
        isTeacherTicket,
        isStudentInShowTicket
      };
    });
  }, [selectedSeats, ticketOptionBySeatId, ticketOptionById, teacherOptionIds, studentInShowOptionIds]);

  const teacherSelectedSeatIds = useMemo(
    () => selectedSeatIds.filter((seatId) => teacherOptionIds.has(ticketOptionBySeatId[seatId] || '')),
    [selectedSeatIds, teacherOptionIds, ticketOptionBySeatId]
  );
  const studentInShowSelectedSeatIds = useMemo(
    () => selectedSeatIds.filter((seatId) => studentInShowOptionIds.has(ticketOptionBySeatId[seatId] || '')),
    [selectedSeatIds, studentInShowOptionIds, ticketOptionBySeatId]
  );

  const hasTeacherCompSelection = teacherSelectedSeatIds.length > 0;
  const hasStudentInShowCompSelection = studentInShowSelectedSeatIds.length > 0;
  const hasMixedCompSelection = hasTeacherCompSelection && hasStudentInShowCompSelection;
  const isTeacherCheckout = hasTeacherCompSelection;
  const isStudentInShowCheckout = hasStudentInShowCompSelection;

  const teacherCompCandidates = useMemo(() => {
    if (!isTeacherCheckout) return [];
    if (hasTeacherCompSelection) {
      return selectedSeatsWithBasePricing.filter((item) => item.isTeacherTicket);
    }
    return selectedSeatsWithBasePricing;
  }, [isTeacherCheckout, hasTeacherCompSelection, selectedSeatsWithBasePricing]);

  const complimentaryTeacherSeatIds = useMemo(
    () =>
      pickComplimentarySeatIds(
        teacherCompCandidates,
        Math.min(MAX_TEACHER_COMP_TICKETS, teacherCompCandidates.length)
      ),
    [teacherCompCandidates]
  );

  const studentCompCandidates = useMemo(() => {
    if (!isStudentInShowCheckout) return [];
    return selectedSeatsWithBasePricing.filter((item) => item.isStudentInShowTicket);
  }, [isStudentInShowCheckout, selectedSeatsWithBasePricing]);

  const complimentaryStudentSeatIds = useMemo(
    () =>
      pickComplimentarySeatIds(
        studentCompCandidates,
        Math.min(MAX_STUDENT_COMP_TICKETS, studentCompCandidates.length)
      ),
    [studentCompCandidates]
  );

  const selectedSeatsWithPricing = useMemo<SelectedSeatPricing[]>(
    () =>
      selectedSeatsWithBasePricing.map((item) => {
        const isTeacherComplimentary = complimentaryTeacherSeatIds.has(item.seat.id);
        const isStudentComplimentary = complimentaryStudentSeatIds.has(item.seat.id);
        return {
          ...item,
          isTeacherComplimentary,
          isStudentComplimentary,
          unitPrice: isTeacherComplimentary || isStudentComplimentary ? 0 : item.basePrice
        };
      }),
    [complimentaryStudentSeatIds, complimentaryTeacherSeatIds, selectedSeatsWithBasePricing]
  );

  const totalAmount = useMemo(
    () => selectedSeatsWithPricing.reduce((sum, item) => sum + item.unitPrice, 0),
    [selectedSeatsWithPricing]
  );

  const missingTicketTypeCount = useMemo(() => {
    if (ticketOptions.length === 0) return 0;
    return selectedSeatIds.filter((seatId) => {
      const selectedOptionId = ticketOptionBySeatId[seatId];
      return !selectedOptionId || !ticketOptionById.has(selectedOptionId);
    }).length;
  }, [ticketOptionById, ticketOptionBySeatId, ticketOptions.length, selectedSeatIds]);

  const teacherCompAppliedCount = complimentaryTeacherSeatIds.size;
  const studentCompAppliedCount = complimentaryStudentSeatIds.size;
  const checkoutUnitLabel = seatSelectionEnabled ? 'seat' : 'ticket';
  const registrationRequired = Boolean(registrationForm);

  const canContinueToTypes = selectedSeats.length > 0;
  const canContinueToCheckout = selectedSeats.length > 0 && missingTicketTypeCount === 0;
  const canSubmitCheckout = selectedSeats.length > 0 && (!registrationRequired || registrationValid);
  const showCheckoutQueuePanel = Boolean(
    checkoutQueue && checkoutQueue.position >= CHECKOUT_QUEUE_VISIBILITY_THRESHOLD
  );
  const showPreparingCheckoutPanel = Boolean(checkoutQueue) && !showCheckoutQueuePanel;

  const goToStepTwo = () => {
    if (!canContinueToTypes) {
      setStepError(`Pick at least one ${checkoutUnitLabel} before moving to ticket types.`);
      return;
    }
    setStepError(null);
    setCurrentStep(2);
  };

  const goToStepThree = () => {
    if (!canContinueToCheckout) {
      setStepError(`Choose a ticket type for each selected ${checkoutUnitLabel} before continuing.`);
      return;
    }
    if (hasMixedCompSelection) {
      setStepError('Teacher and Student in Show complimentary tickets cannot be mixed in one checkout.');
      return;
    }

    setStepError(null);
    resetPendingPayment();
    setCurrentStep(3);
  };

  const validateContactStep = () => {
    const effectiveCustomerName = customerName.trim();
    const effectiveCustomerEmail = customerEmail.trim().toLowerCase();
    const effectiveCustomerPhone = customerPhone.trim();

    if (!effectiveCustomerName || !effectiveCustomerEmail) {
      setStepError(
        isTeacherCheckout || isStudentInShowCheckout
          ? 'Enter your name and personal email before checkout.'
          : 'Enter your name and email before checkout.'
      );
      setCurrentStep(3);
      return false;
    }

    if (!effectiveCustomerPhone) {
      setStepError('Enter a phone number before checkout.');
      setCurrentStep(3);
      return false;
    }

    if (isTeacherCheckout) {
      if (effectiveCustomerEmail.endsWith('@rtmsd.org')) {
        setStepError('Use a personal email for ticket delivery (not @rtmsd.org).');
        setCurrentStep(3);
        return false;
      }
      if (!teacherPromoCode.trim()) {
        setStepError('Enter the teacher promo code before checkout.');
        setCurrentStep(3);
        return false;
      }
    }

    if (isStudentInShowCheckout) {
      const normalizedStudentCode = studentCode.trim().toLowerCase().replace(/\s+/g, '');
      if (!normalizedStudentCode) {
        setStepError('Enter your student code for verification before checkout.');
        setCurrentStep(3);
        return false;
      }
    }

    return true;
  };

  const submitContactStep = () => {
    if (!validateContactStep()) return;
    setStepError(null);
    resetPendingPayment();
    setCheckoutQueue(null);
    setCurrentStep(registrationRequired ? 4 : 5);
  };

  const checkoutSteps = useMemo(() => {
    let steps = CHECKOUT_STEPS;
    if (!registrationRequired) {
      steps = steps.filter(s => s.id !== 4);
    }
    return steps.map((step) =>
      step.id === 1 ? { ...step, label: seatSelectionEnabled ? 'Pick Seats' : 'Ticket Quantity' } : step
    );
  }, [registrationRequired, seatSelectionEnabled]);

  const progressPercent = ((checkoutSteps.findIndex(s => s.id === currentStep)) / (checkoutSteps.length - 1)) * 100;

  return (
    <div className="h-[100dvh] min-h-[100dvh] bg-stone-50 overflow-hidden flex flex-col" style={{ fontFamily: 'system-ui, sans-serif' }}>
      <div className="shrink-0 border-b border-stone-100 bg-white relative">
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-red-700 via-red-600 to-amber-400" />
        <div className="px-4 md:px-6 py-3 flex items-center justify-between gap-4">
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1 text-sm md:text-base font-semibold text-stone-600 hover:text-red-700 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" /> Back
          </button>
          <div className="text-xs md:text-sm font-semibold text-stone-700 truncate">{performanceTitle}</div>
        </div>

        <div className="h-1 bg-stone-200">
          <motion.div
            className="h-1 bg-red-600"
            initial={false}
            animate={{ width: `${progressPercent}%` }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
          />
        </div>

        <div className="px-4 md:px-6 py-2 flex items-center gap-4 overflow-x-auto no-scrollbar text-[11px] md:text-xs font-bold uppercase tracking-wider">
          {checkoutSteps.map((step) => {
            const isCurrent = step.id === currentStep;
            const isComplete = step.id < currentStep;
            return (
              <div
                key={step.id}
                className={`inline-flex items-center gap-2 whitespace-nowrap ${
                  isCurrent ? 'text-stone-900' : isComplete ? 'text-red-700' : 'text-stone-400'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    isCurrent ? 'bg-stone-900' : isComplete ? 'bg-red-600' : 'bg-stone-300'
                  }`}
                />
                <span>{step.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {stepError && (
        <div className="shrink-0 mx-4 md:mx-6 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {stepError}
        </div>
      )}
      {holdError && (
        <div className="shrink-0 mx-4 md:mx-6 mt-3 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-700">
          {holdError}
        </div>
      )}

      <div className="flex-1 min-h-0 mt-3">
        <AnimatePresence mode="wait">
          {currentStep === 1 && (
            <motion.section
              key="seat-map-step"
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -30 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              className="h-full"
            >
              {seatSelectionEnabled ? (
                <div className="h-full min-h-0 flex flex-col xl:flex-row overflow-hidden">
                <aside className="hidden xl:flex w-[360px] shrink-0 border-r border-stone-100 bg-white flex-col min-h-0">
                  <div className="p-5 border-b border-stone-100">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-red-600 mb-1">
                      {seatSelectionEnabled ? 'Seat Picker' : 'Ticket Quantity'}
                    </p>
                    <h2 className="font-bold text-stone-900 mb-4" style={{ fontFamily: 'Georgia, serif', fontSize: '1.35rem' }}>
                      {seatSelectionEnabled ? 'Find Nearby Seats' : 'General Admission'}
                    </h2>
                    {seatSelectionEnabled ? (
                      <div className="flex gap-2">
                        <div className="flex items-center border border-stone-300 rounded-lg px-3 py-2 flex-1">
                          <Users className="w-4 h-4 text-stone-400 mr-2" />
                          <input
                            type="number"
                            min="1"
                            max="10"
                            value={adjacentCount}
                            onChange={(event) => setAdjacentCount(Math.max(1, Number(event.target.value) || 1))}
                            className="w-full outline-none text-sm font-bold"
                          />
                        </div>
                        <button
                          onClick={findAdjacentSeats}
                          className="bg-red-700 text-white p-2 rounded-lg hover:bg-red-800 transition-colors"
                          title="Find adjacent seats"
                        >
                          <Search className="w-5 h-5" />
                        </button>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-stone-300 bg-white p-3">
                        <label className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">Tickets</label>
                        <div className="mt-2 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setAutoSeatCount((count) => Math.max(0, count - 1))}
                            className="h-9 w-9 rounded-lg border border-stone-300 text-lg font-bold text-stone-700 hover:bg-stone-50"
                          >
                            -
                          </button>
                          <input
                            type="number"
                            min="0"
                            max={autoAssignableSeatIds.length}
                            value={autoSeatCount}
                            onChange={(event) => {
                              const next = Math.max(0, Number(event.target.value) || 0);
                              setAutoSeatCount(Math.min(next, autoAssignableSeatIds.length));
                            }}
                            className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm font-bold outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => setAutoSeatCount((count) => Math.min(autoAssignableSeatIds.length, count + 1))}
                            className="h-9 w-9 rounded-lg border border-stone-300 text-lg font-bold text-stone-700 hover:bg-stone-50"
                          >
                            +
                          </button>
                        </div>
                        <p className="mt-2 text-xs text-stone-500">
                          General admission capacity: {autoAssignableSeatIds.length}
                        </p>
                      </div>
                    )}

                    {seatSelectionEnabled && (
                      <div className="mt-4 space-y-2">
                        <div className="text-xs font-bold text-stone-400 uppercase tracking-wider">Sections</div>
                        <button
                          onClick={() => setActiveSection('All')}
                          className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium ${
                            activeSection === 'All' ? 'bg-red-50 text-red-700 border border-red-100' : 'hover:bg-stone-50 text-stone-600'
                          }`}
                        >
                          All Sections
                        </button>
                        {sections.map((section) => (
                          <button
                            key={section}
                            onClick={() => setActiveSection(section)}
                            className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium ${
                              activeSection === section ? 'bg-red-50 text-red-700 border border-red-100' : 'hover:bg-stone-50 text-stone-600'
                            }`}
                          >
                            {section}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex-1 overflow-y-auto p-5 space-y-3">
                    <div className="text-xs font-bold text-stone-400 uppercase tracking-wider">
                      {seatSelectionEnabled ? 'Selected Seats' : 'Selected Tickets'}
                    </div>
                    {selectedSeatsWithPricing.length === 0 ? (
                      <div className="text-sm text-stone-400 italic">
                        {seatSelectionEnabled ? 'No seats selected yet.' : 'No tickets selected yet.'}
                      </div>
                    ) : (
                      selectedSeatsWithPricing.map((item, index) => (
                        <div key={item.seat.id} className="rounded-xl border border-stone-100 bg-white p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="font-bold text-sm text-stone-900">
                                {seatSelectionEnabled ? item.seat.sectionName : `General Admission Ticket ${index + 1}`}
                              </div>
                              <div className="text-xs text-stone-500">
                                {seatSelectionEnabled ? `Row ${item.seat.row} Seat ${item.seat.number}` : 'No seat assignment'}
                              </div>
                            </div>
                            {seatSelectionEnabled && (
                              <button
                                onClick={() => handleSeatClick(item.seat)}
                                className="text-stone-400 hover:text-red-500"
                                title="Remove seat"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            )}
                          </div>

                          <div className="mt-2 text-xs font-bold text-stone-700">
                            {item.optionLabel} - ${(item.unitPrice / 100).toFixed(2)}
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="p-5 border-t border-stone-100 bg-white">
                    <div className="flex items-end justify-between">
                      <div className="text-sm text-stone-600">Total</div>
                      <div className="text-2xl font-bold text-stone-900">${(totalAmount / 100).toFixed(2)}</div>
                    </div>
                    <button
                      onClick={goToStepTwo}
                      disabled={!canContinueToTypes}
                      className="mt-4 w-full bg-red-700 text-white rounded-xl py-3 font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-red-800 inline-flex items-center justify-center gap-2 transition-colors"
                    >
                      Continue <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </aside>

                <div className="flex-1 relative bg-stone-100 overflow-hidden">
                  <SeatMapViewport
                    seats={seats}
                    visibleSeats={seatSelectionEnabled ? visibleSeats : []}
                    loading={loading}
                    emptyText={
                      seatSelectionEnabled
                        ? 'No seats are currently available in this section.'
                        : 'This performance uses general admission ticketing.'
                    }
                    emptyState={
                      !seatSelectionEnabled ? (
                        <div className="w-full max-w-2xl rounded-3xl border border-red-100 bg-white/95 p-6 text-center shadow-[0_20px_60px_rgba(120,53,15,0.12)] backdrop-blur-sm sm:p-8">
                          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-700">
                            <Ticket className="h-7 w-7" />
                          </div>
                          <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.2em] text-red-700">General Admission</p>
                          <h3 className="mt-2 text-2xl font-black text-stone-900">No seat map for this event</h3>
                          <p className="mt-2 text-sm text-stone-600">
                            Pick your ticket quantity to continue. Seats are assigned at admission.
                          </p>
                          <div className="mt-5 grid grid-cols-2 gap-3 text-left">
                            <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">Available</p>
                              <p className="mt-1 text-2xl font-black text-stone-900">{autoAssignableSeatIds.length}</p>
                            </div>
                            <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
                              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">Selected</p>
                              <p className="mt-1 text-2xl font-black text-stone-900">{selectedSeats.length}</p>
                            </div>
                          </div>
                        </div>
                      ) : undefined
                    }
                    resetKey={performanceId || 'booking-seat-map'}
                    containerClassName="h-full"
                    controlsClassName="absolute bottom-36 right-4 z-30 flex flex-col gap-2 sm:bottom-28 xl:bottom-8 xl:right-8"
                    overlay={
                      seatSelectionEnabled ? (
                        <>
                          <div className="absolute top-4 left-4 right-4 z-30 flex gap-2 overflow-x-auto no-scrollbar pb-2 xl:hidden">
                            <button
                              onClick={() => setActiveSection('All')}
                              className={`px-4 py-2 rounded-full text-xs font-bold shadow-md whitespace-nowrap ${
                                activeSection === 'All' ? 'bg-red-700 text-white' : 'bg-white text-stone-600'
                              }`}
                            >
                              All
                            </button>
                            {sections.map((section) => (
                              <button
                                key={section}
                                onClick={() => setActiveSection(section)}
                                className={`px-4 py-2 rounded-full text-xs font-bold shadow-md whitespace-nowrap ${
                                  activeSection === section ? 'bg-red-700 text-white' : 'bg-white text-stone-600'
                                }`}
                              >
                                {section}
                              </button>
                            ))}
                          </div>

                          <div className="absolute left-4 right-4 top-[4.5rem] z-30 rounded-xl border border-stone-200 bg-white/95 p-2 shadow-sm backdrop-blur xl:hidden">
                            <div className="flex items-center gap-2">
                              <div className="flex min-w-0 flex-1 items-center rounded-lg border border-stone-300 bg-white px-2 py-1.5">
                                <Users className="mr-2 h-4 w-4 shrink-0 text-stone-400" />
                                <input
                                  type="number"
                                  min="1"
                                  max="10"
                                  value={adjacentCount}
                                  onChange={(event) => setAdjacentCount(Math.max(1, Number(event.target.value) || 1))}
                                  className="w-full min-w-0 bg-transparent text-sm font-bold outline-none"
                                />
                              </div>
                              <button
                                onClick={findAdjacentSeats}
                                className="inline-flex items-center gap-1 rounded-lg bg-red-700 px-3 py-2 text-xs font-bold text-white hover:bg-red-800 transition-colors"
                                title="Find adjacent seats"
                              >
                                <Search className="h-4 w-4" />
                                Find
                              </button>
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="absolute left-4 right-4 top-4 z-30 rounded-xl border border-stone-200 bg-white/95 p-3 shadow-sm backdrop-blur xl:hidden">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">Ticket Quantity</p>
                          <div className="mt-2 flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setAutoSeatCount((count) => Math.max(0, count - 1))}
                              className="h-9 w-9 rounded-lg border border-stone-300 text-lg font-bold text-stone-700"
                            >
                              -
                            </button>
                            <input
                              type="number"
                              min="0"
                              max={autoAssignableSeatIds.length}
                              value={autoSeatCount}
                              onChange={(event) => {
                                const next = Math.max(0, Number(event.target.value) || 0);
                                setAutoSeatCount(Math.min(next, autoAssignableSeatIds.length));
                              }}
                              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm font-bold outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => setAutoSeatCount((count) => Math.min(autoAssignableSeatIds.length, count + 1))}
                              className="h-9 w-9 rounded-lg border border-stone-300 text-lg font-bold text-stone-700"
                            >
                              +
                            </button>
                          </div>
                          <p className="mt-2 text-xs text-stone-500">Available: {autoAssignableSeatIds.length}</p>
                        </div>
                      )
                    }
                    renderSeat={({ seat, x, y }) => {
                      const isSelected = selectedSeatIds.includes(seat.id);
                      const heldByMe = heldByMeSeatIds.includes(seat.id);
                      const isAvailable = seat.status === 'available' || heldByMe;
                      const isHeld = seat.status === 'held' && !heldByMe;
                      const isSoldOrBlocked = seat.status === 'sold' || seat.status === 'blocked';
                      const companionRequirementMet =
                        !seat.isCompanion ||
                        isSelected ||
                        (seat.companionForSeatId ? selectedSeatIds.includes(seat.companionForSeatId) : hasAccessibleSelection);
                      const selectable = seatSelectionEnabled && isAvailable && companionRequirementMet;

                      return (
                        <button
                          key={seat.id}
                          onClick={() => handleSeatClick(seat)}
                          disabled={!selectable && !isSelected}
                          style={{ left: `${x}px`, top: `${y}px` }}
                          className={[
                            'seat-button absolute w-8 h-8 md:w-10 md:h-10 rounded-t-lg rounded-b-md flex items-center justify-center text-[10px] font-bold transition-all duration-200 group',
                            isSelected
                              ? 'bg-green-500 text-white shadow-lg scale-110 z-10 ring-2 ring-green-300'
                              : isSoldOrBlocked
                                ? 'bg-stone-200 text-stone-400 cursor-not-allowed'
                                : isHeld
                                  ? 'bg-orange-200 text-orange-400 cursor-not-allowed'
                                  : !seatSelectionEnabled
                                    ? 'bg-white border-2 border-stone-200 text-stone-600'
                                  : seat.isCompanion
                                    ? 'bg-cyan-100 border-2 border-cyan-400 text-cyan-700 hover:border-cyan-500 hover:bg-cyan-50 hover:shadow-md hover:-translate-y-1'
                                    : seat.isAccessible
                                      ? 'bg-blue-100 border-2 border-blue-400 text-blue-700 hover:border-blue-500 hover:bg-blue-50 hover:shadow-md hover:-translate-y-1'
                                      : 'bg-white border-2 border-stone-200 text-stone-600 hover:border-red-400 hover:shadow-md hover:-translate-y-1'
                          ].join(' ')}
                        >
                          <div
                            className={`absolute -left-1 bottom-1 w-1 h-4 rounded-full ${
                              isSelected ? 'bg-green-600' : seat.isCompanion ? 'bg-cyan-500' : seat.isAccessible ? 'bg-blue-500' : 'bg-stone-300'
                            } opacity-50`}
                          />
                          <div
                            className={`absolute -right-1 bottom-1 w-1 h-4 rounded-full ${
                              isSelected ? 'bg-green-600' : seat.isCompanion ? 'bg-cyan-500' : seat.isAccessible ? 'bg-blue-500' : 'bg-stone-300'
                            } opacity-50`}
                          />
                          {seat.number}
                        </button>
                      );
                    }}
                  />

                  <div className="xl:hidden absolute left-0 right-0 bottom-0 z-40 border-t border-stone-200 bg-white px-4 pt-3 pb-3 pb-safe">
                    {selectedSeatsWithPricing.length > 0 ? (
                      <div className="mb-3 flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                        {selectedSeatsWithPricing.map((item, index) => (
                          <button
                            key={item.seat.id}
                            type="button"
                            onClick={() => handleSeatClick(item.seat)}
                            disabled={!seatSelectionEnabled}
                            className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold ${
                              seatSelectionEnabled
                                ? 'border-red-100 bg-red-50 text-red-700'
                                : 'border-stone-200 bg-stone-50 text-stone-700'
                            }`}
                            title={
                              seatSelectionEnabled
                                ? `Remove ${item.seat.sectionName} ${item.seat.row}-${item.seat.number}`
                                : `Ticket ${index + 1}`
                            }
                          >
                            {seatSelectionEnabled ? `${item.seat.sectionName} ${item.seat.row}-${item.seat.number}` : `Ticket ${index + 1}`}
                          </button>
                        ))}
                      </div>
                    ) : null}

                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs font-bold uppercase text-stone-500 tracking-wider">
                          {selectedSeats.length} {seatSelectionEnabled ? 'Seats' : 'Tickets'} Selected
                        </div>
                        <div className="truncate text-xl font-bold text-stone-900">${(totalAmount / 100).toFixed(2)}</div>
                      </div>
                      <button
                        onClick={goToStepTwo}
                        disabled={!canContinueToTypes}
                        className="inline-flex items-center gap-2 rounded-xl bg-red-700 px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-red-800 transition-colors"
                      >
                        Ticket Types <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              ) : (
                <div className="h-full flex items-center justify-center bg-stone-50 overflow-y-auto px-4 py-8 relative">
                  <div className="w-full max-w-lg bg-white rounded-3xl shadow-xl border border-stone-100 p-8 flex flex-col text-center">
                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-700 shadow-sm border border-red-100 mb-6">
                      <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"></path><path d="M13 5v2"></path><path d="M13 17v2"></path><path d="M13 11v2"></path></svg>
                    </div>
                    
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-red-700 mb-2">General Admission</p>
                    <h2 className="text-3xl font-black text-stone-900 mb-3" style={{ fontFamily: 'Georgia, serif' }}>Choose Your Tickets</h2>
                    <p className="text-stone-500 mb-8 text-sm">Select the number of tickets you'd like to reserve. Seating is assigned upon entry.</p>
                    
                    <div className="bg-stone-50 rounded-2xl p-6 border border-stone-200 mb-8 flex flex-col items-center">
                      <div className="text-xs font-bold uppercase tracking-[0.14em] text-stone-500 mb-4">Tickets Needed</div>
                      
                      <div className="flex items-center justify-center gap-6">
                        <button
                          type="button"
                          onClick={() => setAutoSeatCount((count) => Math.max(0, count - 1))}
                          className="h-14 w-14 rounded-full border-2 border-stone-200 bg-white flex items-center justify-center text-3xl font-light text-stone-500 hover:border-stone-300 hover:bg-stone-50 transition-all active:scale-95"
                        >
                          -
                        </button>
                        
                        <div className="w-24 text-center">
                          <input
                            type="number"
                            min="0"
                            max={autoAssignableSeatIds.length}
                            value={autoSeatCount || ''}
                            onChange={(event) => {
                              const next = Math.max(0, Number(event.target.value) || 0);
                              setAutoSeatCount(Math.min(next, autoAssignableSeatIds.length));
                            }}
                            onBlur={(event) => {
                              if (!event.target.value) setAutoSeatCount(0);
                            }}
                            className="w-full text-5xl font-black text-stone-900 text-center bg-transparent outline-none focus:ring-0 p-0"
                          />
                        </div>
                        
                        <button
                          type="button"
                          onClick={() => setAutoSeatCount((count) => Math.min(autoAssignableSeatIds.length, count + 1))}
                          disabled={autoSeatCount >= autoAssignableSeatIds.length}
                          className="h-14 w-14 rounded-full border-2 border-stone-200 bg-white flex items-center justify-center text-3xl font-light text-stone-500 hover:border-stone-300 hover:bg-stone-50 disabled:opacity-30 disabled:hover:border-stone-200 disabled:hover:bg-white disabled:hover:text-stone-500 transition-all active:scale-95"
                        >
                          +
                        </button>
                      </div>
                      <div className="mt-5 text-xs font-semibold text-stone-400 bg-white px-3 py-1.5 rounded-full border border-stone-200 shadow-sm">
                        {autoAssignableSeatIds.length - autoSeatCount} tickets remaining
                      </div>
                    </div>

                    <button
                      onClick={goToStepTwo}
                      disabled={!canContinueToTypes}
                      className="w-full bg-red-700 text-white rounded-xl py-4 text-base font-bold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-red-800 transition-colors active:scale-[0.98] flex items-center justify-center gap-2"
                    >
                      Continue Checkout <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </motion.section>
          )}

          {currentStep === 2 && (
            <motion.section
              key="ticket-type-step"
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -30 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              className="h-full overflow-y-auto px-4 md:px-6 pb-10"
            >
              <div className="max-w-5xl mx-auto">
                <div className="pt-6 md:pt-8 pb-4 md:pb-6">
                  <h2 className="text-2xl md:text-3xl font-black text-stone-900">Choose Ticket Types</h2>
                  <p className="text-sm md:text-base text-stone-600 mt-2">
                    Assign a ticket category for each selected {seatSelectionEnabled ? 'seat' : 'ticket'}.
                  </p>
                  {ticketOptions.some((option) => option.id === TEACHER_TICKET_OPTION_ID) && (
                    <p className="mt-2 inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50/70 px-2.5 py-1 text-xs text-amber-900">
                      <span>RTMSD staff: choose</span>
                      <span className="font-semibold">RTMSD STAFF</span>
                      <span>in the dropdown.</span>
                    </p>
                  )}
                  {hasMixedCompSelection && (
                    <p className="text-xs text-red-600 mt-2">
                      Teacher and Student in Show complimentary seats cannot be checked out together. Pick one comp type per order.
                    </p>
                  )}
                </div>

                {selectedSeatsWithPricing.length === 0 ? (
                  <div className="rounded-2xl border border-stone-200 bg-white p-8 text-center text-stone-500">
                    You have no {seatSelectionEnabled ? 'seats' : 'tickets'} selected yet.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {selectedSeatsWithPricing.map((item, index) => (
                      <div key={item.seat.id} className="rounded-2xl border border-stone-200 bg-white p-4">
                        <div className="flex items-center justify-between gap-2 mb-3">
                          <div>
                            <div className="font-black text-stone-900">
                              {seatSelectionEnabled ? item.seat.sectionName : `Ticket ${index + 1}`}
                            </div>
                            <div className="text-sm text-stone-500">
                              {seatSelectionEnabled ? `Row ${item.seat.row} Seat ${item.seat.number}` : 'General Admission (no seat assignment)'}
                            </div>
                          </div>
                          {seatSelectionEnabled && (
                            <button
                              onClick={() => handleSeatClick(item.seat)}
                              className="inline-flex items-center gap-1 text-xs font-bold text-red-500 hover:text-red-600"
                            >
                              <X className="w-3 h-3" /> Remove
                            </button>
                          )}
                        </div>

                        {ticketOptions.length > 0 ? (
                          <select
                            value={item.optionId || ''}
                            onChange={(event) => handleSeatOptionChange(item.seat.id, event.target.value)}
                            className="w-full rounded-xl border border-stone-300 px-3 py-2 font-medium"
                          >
                            {ticketOptions.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.id === TEACHER_TICKET_OPTION_ID
                                  ? `${option.label} - first ${MAX_TEACHER_COMP_TICKETS} free`
                                  : option.id === STUDENT_SHOW_TICKET_OPTION_ID
                                    ? `${option.label} - first ${MAX_STUDENT_COMP_TICKETS} free`
                                  : `${option.label} - $${(option.priceCents / 100).toFixed(2)}`}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm font-medium text-stone-700">
                            Standard pricing
                          </div>
                        )}

                        <div className="mt-3 text-sm text-stone-600">
                          Current: <span className="font-bold text-stone-900">{item.optionLabel}</span>
                          <span className="font-bold text-stone-900"> (${(item.unitPrice / 100).toFixed(2)})</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-8 flex flex-col gap-4 rounded-2xl border border-stone-200 bg-white p-5 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="text-xs uppercase tracking-wider font-bold text-stone-500">Order total</div>
                    <div className="text-3xl font-black text-stone-900">${(totalAmount / 100).toFixed(2)}</div>
                    {missingTicketTypeCount > 0 && (
                      <div className="text-sm text-red-600 mt-1">
                        {missingTicketTypeCount} {seatSelectionEnabled ? 'seat' : 'ticket'}
                        {missingTicketTypeCount === 1 ? '' : 's'} still need a ticket type.
                      </div>
                    )}
                    {isTeacherCheckout && teacherCompAppliedCount > 0 && (
                      <div className="text-sm text-green-700 mt-1">
                        Teacher complimentary tickets applied: {teacherCompAppliedCount}.
                      </div>
                    )}
                    {isStudentInShowCheckout && studentCompAppliedCount > 0 && (
                      <div className="text-sm text-green-700 mt-1">
                        Student in Show complimentary tickets applied: {studentCompAppliedCount}.
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <button
                      onClick={() => {
                        setStepError(null);
                        setCurrentStep(1);
                      }}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-stone-300 px-4 py-3 font-bold text-stone-700 hover:bg-stone-100 sm:w-auto"
                    >
                      <ArrowLeft className="w-4 h-4" /> Back
                    </button>
                    <button
                      onClick={goToStepThree}
                      disabled={!canContinueToCheckout}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-stone-900 px-5 py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-stone-800 sm:w-auto"
                    >
                      Continue <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </motion.section>
          )}

          {currentStep === 3 && (
            <motion.section
              key="contact-step"
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -30 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              className="h-full overflow-y-auto px-4 md:px-6 pb-10"
            >
              <div className="max-w-6xl mx-auto pt-6 md:pt-8 grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-6">
                <div className="rounded-2xl border border-stone-100 bg-white p-5 md:p-6 h-fit">
                  {isTeacherCheckout ? (
                    <>
                      <h2 className="text-2xl md:text-3xl font-bold text-stone-900" style={{ fontFamily: 'Georgia, serif' }}>Teacher Verification</h2>
                      <p className="text-sm md:text-base text-stone-600 mt-2">
                        Teacher complimentary checkout uses the teacher promo code. Enter your name, personal delivery email, and promo code.
                      </p>

                      <div className="mt-6 rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm text-stone-700">
                        Teacher {seatSelectionEnabled ? 'seats' : 'tickets'} selected: <span className="font-bold">{teacherSelectedSeatIds.length}</span>.
                        Complimentary this order: <span className="font-bold">{teacherCompAppliedCount}</span> of {MAX_TEACHER_COMP_TICKETS}.
                      </div>

                      <div className="mt-6 space-y-4">
                        <label className="block">
                          <span className="text-xs font-semibold uppercase tracking-[0.15em] text-red-600">Full Name</span>
                          <div className="mt-1 relative">
                            <User className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                            <input
                              value={customerName}
                              onChange={(event) => setCustomerName(event.target.value)}
                              disabled={Boolean(pendingStripePayment)}
                              placeholder="Jane Doe"
                              className="w-full rounded-xl border border-stone-300 pl-10 pr-3 py-3 focus:border-red-400 focus:ring-2 focus:ring-red-100 outline-none"
                            />
                          </div>
                        </label>

                        <label className="block">
                          <span className="text-xs font-semibold uppercase tracking-[0.15em] text-red-600">Personal Email</span>
                          <div className="mt-1 relative">
                            <Mail className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                            <input
                              type="email"
                              value={customerEmail}
                              onChange={(event) => setCustomerEmail(event.target.value)}
                              disabled={Boolean(pendingStripePayment)}
                              placeholder="name@email.com"
                              className="w-full rounded-xl border border-stone-300 pl-10 pr-3 py-3 focus:border-red-400 focus:ring-2 focus:ring-red-100 outline-none"
                            />
                          </div>
                          <div className="mt-1 text-xs text-stone-500">Do not use your `@rtmsd.org` email for delivery.</div>
                        </label>

                        <label className="block">
                          <span className="text-xs font-semibold uppercase tracking-[0.15em] text-red-600">Phone Number</span>
                          <div className="mt-1 relative">
                            <Phone className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                            <input
                              type="tel"
                              value={customerPhone}
                              onChange={(event) => setCustomerPhone(event.target.value)}
                              disabled={Boolean(pendingStripePayment)}
                              placeholder="(555) 555-5555"
                              className="w-full rounded-xl border border-stone-300 pl-10 pr-3 py-3 focus:border-red-400 focus:ring-2 focus:ring-red-100 outline-none"
                            />
                          </div>
                        </label>

                        <label className="block">
                          <span className="text-xs font-semibold uppercase tracking-[0.15em] text-red-600">Teacher Promo Code</span>
                          <div className="mt-1 relative">
                            <Ticket className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                            <input
                              value={teacherPromoCode}
                              onChange={(event) => setTeacherPromoCode(event.target.value)}
                              disabled={Boolean(pendingStripePayment)}
                              placeholder="Enter code from theater admin"
                              className="w-full rounded-xl border border-stone-300 pl-10 pr-3 py-3 focus:border-red-400 focus:ring-2 focus:ring-red-100 outline-none"
                            />
                          </div>
                        </label>
                      </div>

                      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                        <button
                          onClick={() => {
                            setStepError(null);
                            resetPendingPayment();
                            setCheckoutQueue(null);
                            setCurrentStep(2);
                          }}
                          className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-stone-300 px-4 py-3 font-bold text-stone-700 hover:bg-stone-100 sm:w-auto"
                        >
                          <ArrowLeft className="w-4 h-4" /> Back
                        </button>
                        <button
                          onClick={submitContactStep}
                          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-stone-900 px-5 py-3 font-semibold text-white hover:bg-stone-800 transition-colors sm:w-auto"
                        >
                          {registrationRequired ? 'Continue to Questionnaire' : 'Continue to Checkout'}
                          <ArrowRight className="w-4 h-4" />
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <h2 className="text-2xl md:text-3xl font-bold text-stone-900" style={{ fontFamily: 'Georgia, serif' }}>
                        {isStudentInShowCheckout ? 'Student in Show Checkout' : 'Contact Information'}
                      </h2>
                      <p className="text-sm md:text-base text-stone-600 mt-2">
                        {isStudentInShowCheckout
                          ? 'Use your student code for verification, then a personal email for ticket delivery.'
                          : 'We will send tickets and confirmation to this email.'}
                      </p>

                      {isStudentInShowCheckout && (
                        <div className="mt-6 rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm text-stone-700">
                          Student in Show {seatSelectionEnabled ? 'seats' : 'tickets'} selected: <span className="font-bold">{studentInShowSelectedSeatIds.length}</span>.
                          Complimentary this order: <span className="font-bold">{studentCompAppliedCount}</span> of {MAX_STUDENT_COMP_TICKETS}.
                        </div>
                      )}

                      <div className="mt-6 space-y-4">
                        <label className="block">
                          <span className="text-xs font-semibold uppercase tracking-[0.15em] text-red-600">Full Name</span>
                          <div className="mt-1 relative">
                            <User className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                            <input
                              value={customerName}
                              onChange={(event) => setCustomerName(event.target.value)}
                              disabled={Boolean(pendingStripePayment)}
                              placeholder="Jane Doe"
                              className="w-full rounded-xl border border-stone-300 pl-10 pr-3 py-3 focus:border-red-400 focus:ring-2 focus:ring-red-100 outline-none"
                            />
                          </div>
                        </label>

                        <label className="block">
                          <span className="text-xs font-semibold uppercase tracking-[0.15em] text-red-600">
                            {isStudentInShowCheckout ? 'Personal Email' : 'Email'}
                          </span>
                          <div className="mt-1 relative">
                            <Mail className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                            <input
                              type="email"
                              value={customerEmail}
                              onChange={(event) => setCustomerEmail(event.target.value)}
                              disabled={Boolean(pendingStripePayment)}
                              placeholder={isStudentInShowCheckout ? 'Personal email for ticket delivery' : 'name@email.com'}
                              className="w-full rounded-xl border border-stone-300 pl-10 pr-3 py-3 focus:border-red-400 focus:ring-2 focus:ring-red-100 outline-none"
                            />
                          </div>
                          {isStudentInShowCheckout ? (
                            <div className="mt-1 text-xs text-stone-500">
                              Tickets are sent to your personal email, not your student code.
                            </div>
                          ) : null}
                        </label>

                        <label className="block">
                          <span className="text-xs font-semibold uppercase tracking-[0.15em] text-red-600">Phone Number</span>
                          <div className="mt-1 relative">
                            <Phone className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                            <input
                              type="tel"
                              value={customerPhone}
                              onChange={(event) => setCustomerPhone(event.target.value)}
                              disabled={Boolean(pendingStripePayment)}
                              placeholder="(555) 555-5555"
                              className="w-full rounded-xl border border-stone-300 pl-10 pr-3 py-3 focus:border-red-400 focus:ring-2 focus:ring-red-100 outline-none"
                            />
                          </div>
                        </label>

                        {isStudentInShowCheckout && (
                          <label className="block">
                            <span className="text-xs font-semibold uppercase tracking-[0.15em] text-red-600">Student Code</span>
                            <div className="mt-1 relative">
                              <Ticket className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                              <input
                                type="text"
                                value={studentCode}
                                onChange={(event) => setStudentCode(event.target.value)}
                                disabled={Boolean(pendingStripePayment)}
                                placeholder="Student code on file (e.g. jsmith)"
                                className="w-full rounded-xl border border-stone-300 pl-10 pr-3 py-3 focus:border-red-400 focus:ring-2 focus:ring-red-100 outline-none"
                              />
                            </div>
                          </label>
                        )}
                      </div>

                      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center">
                        <button
                          onClick={() => {
                            setStepError(null);
                            resetPendingPayment();
                            setCheckoutQueue(null);
                            setCurrentStep(2);
                          }}
                          className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-stone-300 px-4 py-3 font-bold text-stone-700 hover:bg-stone-100 sm:w-auto"
                        >
                          <ArrowLeft className="w-4 h-4" /> Back
                        </button>
                        <button
                          onClick={submitContactStep}
                          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-stone-900 px-5 py-3 font-semibold text-white hover:bg-stone-800 transition-colors sm:w-auto"
                        >
                          {registrationRequired ? 'Continue to Questionnaire' : 'Continue to Checkout'}
                          <ArrowRight className="w-4 h-4" />
                        </button>
                      </div>
                    </>
                  )}
                </div>

                <div className="rounded-2xl border border-stone-100 bg-white p-5 md:p-6 h-fit">
                  <div className="flex items-center justify-between mb-4">
                    <div className="inline-flex items-center gap-2 text-stone-900 font-bold" style={{ fontFamily: 'Georgia, serif' }}>
                      <Ticket className="w-4 h-4" /> Order Summary
                    </div>
                    <div className="text-sm text-stone-500 font-semibold">
                      {selectedSeats.length} {seatSelectionEnabled ? 'seats' : 'tickets'}
                    </div>
                  </div>

                  <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
                    {selectedSeatsWithPricing.map((item, index) => (
                      <div key={item.seat.id} className="rounded-xl border border-stone-200 bg-stone-50 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-bold text-stone-900">
                              {seatSelectionEnabled
                                ? `${item.seat.sectionName} Row ${item.seat.row} Seat ${item.seat.number}`
                                : `General Admission Ticket ${index + 1}`}
                            </div>
                            <div className="text-xs text-stone-500">{item.optionLabel}</div>
                          </div>
                          <div className="font-bold text-stone-900">${(item.unitPrice / 100).toFixed(2)}</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-5 border-t border-stone-200 pt-4 flex items-end justify-between">
                    <div className="text-sm text-stone-500">Total</div>
                    <div className="text-3xl font-bold text-stone-900">${(totalAmount / 100).toFixed(2)}</div>
                  </div>
                </div>
              </div>
            </motion.section>
          )}

          {currentStep === 4 && registrationRequired && (
              <motion.section
                key="questionnaire-step"
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -30 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
                className="h-full flex flex-col px-4 md:px-6 pb-6 pt-6"
              >
                <div className="flex-1 w-full min-h-0 flex flex-col rounded-2xl border border-stone-100 bg-white overflow-hidden shadow-sm max-w-6xl mx-auto">
                  <div className="shrink-0 p-5 md:p-6 border-b border-stone-100 bg-white">
                    <h2 className="text-2xl md:text-3xl font-bold text-stone-900" style={{ fontFamily: 'Georgia, serif' }}>
                      Event Questionnaire
                    </h2>
                    <p className="text-sm md:text-base text-stone-600 mt-2">
                      Complete this form to continue checkout.
                    </p>
                  </div>

                  <div className="flex-1 overflow-y-auto px-5 md:px-8 pb-8 relative min-h-0" id="registration-form-scroll-container">
                    {registrationForm ? (
                      <EventRegistrationCheckoutForm
                        form={registrationForm}
                        ticketQuantity={selectedSeatIds.length}
                        storageKey={`event-registration:${performanceId || 'event'}:${registrationForm.versionId}`}
                        checkoutCustomerName={customerName}
                        disabled={processing}
                        onValidityChange={({ valid, payload }) => {
                          setRegistrationValid(valid);
                          setRegistrationPayload(payload);
                        }}
                        onSubmit={() => setCurrentStep(5)}
                      />
                    ) : null}
                  </div>

                  <div className="shrink-0 p-5 md:p-6 border-t border-stone-100 bg-stone-50 flex flex-col gap-2 sm:flex-row sm:items-center justify-between">
                    <button
                      onClick={() => {
                        setStepError(null);
                        setCurrentStep(3);
                      }}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-stone-300 px-4 py-3 font-bold text-stone-700 hover:bg-white bg-transparent sm:w-auto transition-colors"
                    >
                      <ArrowLeft className="w-4 h-4" /> Back
                    </button>
                  </div>
                </div>
              </motion.section>
            )}

          {currentStep === 5 && (
             <motion.section
              key="checkout-step"
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -30 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              className="h-full overflow-y-auto px-4 md:px-6 pb-10"
            >
              <div className="max-w-6xl mx-auto pt-6 md:pt-8 grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-6">
                <div className="rounded-2xl border border-stone-100 bg-white p-5 md:p-6 h-fit">
                  <AnimatePresence mode="wait" initial={false}>
                    {showCheckoutQueuePanel ? (
                      <motion.div
                        key="queue"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.28, ease: 'easeOut' }}
                      >
                        <div className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-amber-800">
                          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-amber-500" />
                          Checkout Queue
                        </div>
                        <h2 className="mt-4 text-2xl md:text-3xl font-bold text-stone-900" style={{ fontFamily: 'Georgia, serif' }}>
                          You're in line
                        </h2>
                        <p className="text-sm md:text-base text-stone-600 mt-2">
                          Keep this page open while we prepare your payment session.
                        </p>

                        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
                          <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
                            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">Position</p>
                            <p className="mt-1 text-3xl font-black text-stone-900">{checkoutQueue?.position}</p>
                          </div>
                          <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
                            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">Est. Wait</p>
                            <p className="mt-1 text-2xl font-black text-stone-900">{formatWaitEstimate(checkoutQueue?.estimatedWaitSeconds || 0)}</p>
                          </div>
                          <div className="rounded-xl border border-stone-200 bg-stone-50 p-4">
                            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">Refresh</p>
                            <p className="mt-1 text-2xl font-black text-stone-900">{Math.ceil((checkoutQueue?.refreshAfterMs || 0) / 1000)}s</p>
                          </div>
                        </div>

                        <p className="mt-5 text-sm text-stone-600">
                          If your hold expires or checkout cannot be prepared, you’ll be returned to seat selection automatically.
                        </p>
                      </motion.div>
                    ) : showPreparingCheckoutPanel ? (
                      <motion.div
                        key="preparing"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.28, ease: 'easeOut' }}
                      >
                        <h2 className="text-2xl md:text-3xl font-bold text-stone-900" style={{ fontFamily: 'Georgia, serif' }}>
                          Preparing checkout
                        </h2>
                        <p className="text-sm md:text-base text-stone-600 mt-2">
                          Finalizing your payment session. This usually takes just a moment.
                        </p>
                        <div className="mt-6 rounded-xl border border-stone-200 bg-stone-50 p-4">
                          <div className="flex items-center gap-3 text-stone-700">
                            <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-red-600" />
                            <span className="text-sm font-semibold">Almost there...</span>
                          </div>
                        </div>
                      </motion.div>
                    ) : (
                      <motion.div
                        key="checkout"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        transition={{ duration: 0.28, ease: 'easeOut' }}
                      >
                        <h2 className="text-2xl md:text-3xl font-bold text-stone-900" style={{ fontFamily: 'Georgia, serif' }}>
                          Checkout
                        </h2>
                        <p className="text-sm md:text-base text-stone-600 mt-2">
                          Everything looks good. Continue to payment to finish checkout.
                        </p>

                        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center">
                          <button
                            onClick={() => {
                              setStepError(null);
                              resetPendingPayment();
                              setCheckoutQueue(null);
                              setCurrentStep(registrationRequired ? 4 : 3);
                            }}
                            className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-stone-300 px-4 py-3 font-bold text-stone-700 hover:bg-stone-100 sm:w-auto"
                          >
                            <ArrowLeft className="w-4 h-4" /> Back
                          </button>
                          {!pendingStripePayment && (
                            <button
                              onClick={handleCheckout}
                              disabled={processing || !canSubmitCheckout}
                              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-red-700 px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-red-800 transition-colors sm:w-auto"
                            >
                              <CreditCard className="w-4 h-4" />
                              {processing ? 'Processing...' : 'Checkout'}
                            </button>
                          )}
                        </div>

                        {pendingStripePayment && stripePromise && stripeElementsOptions && (
                          <div className="mt-5 rounded-2xl border border-red-100 bg-red-50 p-4">
                            <p className="text-sm font-semibold text-red-900">
                              Payment form ready. Complete payment below to finish checkout.
                            </p>
                            <Elements stripe={stripePromise} options={stripeElementsOptions}>
                              <InlineStripePaymentForm
                                disabled={processing}
                                onError={(message) => setStepError(message || null)}
                                onSuccess={finalizeEmbeddedPayment}
                              />
                            </Elements>
                          </div>
                        )}
                        {pendingStripePayment && (!stripePromise || !stripeElementsOptions) && (
                          <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                            We could not initialize Stripe payment form. Please check Stripe configuration and try again.
                          </div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <div className="rounded-2xl border border-stone-100 bg-white p-5 md:p-6 h-fit">
                  <div className="flex items-center justify-between mb-4">
                    <div className="inline-flex items-center gap-2 text-stone-900 font-bold" style={{ fontFamily: 'Georgia, serif' }}>
                      <Ticket className="w-4 h-4" /> Order Summary
                    </div>
                    <div className="text-sm text-stone-500 font-semibold">
                      {selectedSeats.length} {seatSelectionEnabled ? 'seats' : 'tickets'}
                    </div>
                  </div>

                  <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
                    {selectedSeatsWithPricing.map((item, index) => (
                      <div key={item.seat.id} className="rounded-xl border border-stone-200 bg-stone-50 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-bold text-stone-900">
                              {seatSelectionEnabled
                                ? `${item.seat.sectionName} Row ${item.seat.row} Seat ${item.seat.number}`
                                : `General Admission Ticket ${index + 1}`}
                            </div>
                            <div className="text-xs text-stone-500">{item.optionLabel}</div>
                            
                            {getChildName(registrationForm, registrationPayload, index) ? (
                              <div className="text-xs font-semibold text-blue-700 mt-0.5">
                                • {getChildName(registrationForm, registrationPayload, index)}
                              </div>
                            ) : null}
                          </div>
                          <div className="font-bold text-stone-900">${(item.unitPrice / 100).toFixed(2)}</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-5 border-t border-stone-200 pt-4 flex items-end justify-between">
                    <div className="text-sm text-stone-500">Total</div>
                    <div className="text-3xl font-bold text-stone-900">${(totalAmount / 100).toFixed(2)}</div>
                  </div>
                </div>
              </div>
            </motion.section>
          )}

          </AnimatePresence>
      </div>
    </div>
  );
}
