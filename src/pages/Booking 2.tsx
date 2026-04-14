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
  Search,
  Ticket,
  User,
  Users,
  X
} from 'lucide-react';
import { SeatMapViewport } from '../components/SeatMapViewport';
import { apiFetch } from '../lib/api';
import { getClientToken } from '../lib/clientToken';
import { buildConfirmationPath, rememberOrderAccessToken } from '../lib/orderAccess';

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
};

type CheckoutStep = 1 | 2 | 3;

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

type CheckoutResponse = {
  url?: string;
  orderId?: string;
  orderAccessToken?: string;
  clientSecret?: string;
  publishableKey?: string;
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
  { id: 3, label: 'Checkout' }
];

const TEACHER_TICKET_OPTION_ID = 'teacher-comp';
const STUDENT_SHOW_TICKET_OPTION_ID = 'student-show-comp';
const MAX_TEACHER_COMP_TICKETS = 2;
const MAX_STUDENT_COMP_TICKETS = 2;
const naturalSort = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
const SEAT_X_STEP = 40;
const MAX_ADJACENT_X_GAP = SEAT_X_STEP * 1.5;
const FALLBACK_STRIPE_PUBLISHABLE_KEY = (import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '').trim();

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
  const [studentCode, setStudentCode] = useState('');
  const [currentStep, setCurrentStep] = useState<CheckoutStep>(1);
  const [teacherPromoCode, setTeacherPromoCode] = useState('');
  const [pendingStripePayment, setPendingStripePayment] = useState<PendingStripePayment | null>(null);

  const fetchSeats = useCallback(async () => {
    if (!performanceId) return;

    try {
      const data = await apiFetch<Seat[] | { seats: Seat[] }>(`/api/performances/${performanceId}/seats`);
      const seatList = Array.isArray(data) ? data : data.seats;
      setSeats(seatList);
    } catch (err) {
      console.error('Failed to fetch seats', err);
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
    } catch (err) {
      console.error('Failed to fetch performance details', err);
      setIsFundraiser(false);
      setPricingTiers([]);
      setStudentCompTicketsEnabled(false);
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
        const message = err instanceof Error ? err.message : 'Failed to update seat hold';
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

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void fetchSeats();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    const interval = setInterval(() => void fetchSeats(), 30000);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(interval);
    };
  }, [fetchPerformanceDetails, fetchSeats]);

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
    const tierOptions = pricingTiers
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
      selectedSeatIds.forEach((seatId) => {
        const prevOptionId = prev[seatId];
        if (prevOptionId && validOptionIds.has(prevOptionId)) {
          next[seatId] = prevOptionId;
          return;
        }
        if (defaultOptionId) {
          next[seatId] = defaultOptionId;
        }
      });
      return next;
    });
  }, [selectedSeatIds, ticketOptions]);

  useEffect(() => {
    if (selectedSeatIds.length > 0) return;
    if (currentStep === 1) return;
    setCurrentStep(1);
  }, [currentStep, selectedSeatIds.length]);

  useEffect(() => {
    if (currentStep === 3) return;
    if (!pendingStripePayment) return;
    setPendingStripePayment(null);
  }, [currentStep, pendingStripePayment]);

  const handleSeatClick = (seat: Seat) => {
    if (pendingStripePayment) {
      setPendingStripePayment(null);
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

    setTicketOptionBySeatId((prev) => ({
      ...prev,
      [seatId]: optionId
    }));
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
    navigate(buildConfirmationPath(pendingStripePayment.orderId, pendingStripePayment.orderAccessToken));
  }, [navigate, pendingStripePayment]);

  const handleCheckout = async () => {
    if (!performanceId) return;
    if (selectedSeatIds.length === 0) {
      setStepError('Select at least one seat before checkout.');
      setCurrentStep(1);
      return;
    }

    if (ticketOptions.length > 0 && selectedSeatIds.some((seatId) => !ticketOptionBySeatId[seatId])) {
      setStepError('Select a ticket type for every seat before checkout.');
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

    setProcessing(true);
    setStepError(null);
    setPendingStripePayment(null);

    try {
      const holdResult = await syncHolds(selectedSeatIds);
      if (!holdResult || holdResult.heldSeatIds.length !== selectedSeatIds.length) {
        throw new Error('Unable to lock selected seats. Please try again.');
      }

      let checkout: CheckoutResponse;

      if (isTeacherCheckout) {
        const effectiveCustomerName = customerName.trim();
        const effectiveCustomerEmail = customerEmail.trim().toLowerCase();
        if (!effectiveCustomerName || !effectiveCustomerEmail) {
          setStepError('Enter your name and personal email before checkout.');
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
            teacherPromoCode: normalizedTeacherPromoCode
          })
        });
      } else if (isStudentInShowCheckout) {
        const effectiveCustomerName = customerName.trim();
        const effectiveCustomerEmail = customerEmail.trim().toLowerCase();
        const normalizedStudentCode = studentCode.trim().toLowerCase().replace(/\s+/g, '');

        if (!effectiveCustomerName || !effectiveCustomerEmail) {
          setStepError('Enter your name and personal email before checkout.');
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
            studentCode: normalizedStudentCode
          })
        });
      } else {
        const effectiveCustomerName = customerName.trim();
        const effectiveCustomerEmail = customerEmail.trim().toLowerCase();

        if (!effectiveCustomerName || !effectiveCustomerEmail) {
          setStepError('Enter your name and email before checkout.');
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
            customerName: effectiveCustomerName
          })
        });
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
        navigate(buildConfirmationPath(checkout.orderId, checkout.orderAccessToken));
        return;
      }

      throw new Error('Checkout response missing payment details.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Checkout failed';
      setStepError(message);
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

  const canContinueToTypes = selectedSeats.length > 0;
  const canContinueToCheckout = selectedSeats.length > 0 && missingTicketTypeCount === 0;

  const goToStepTwo = () => {
    if (!canContinueToTypes) {
      setStepError('Pick at least one seat before moving to ticket types.');
      return;
    }
    setStepError(null);
    setCurrentStep(2);
  };

  const goToStepThree = () => {
    if (!canContinueToCheckout) {
      setStepError('Choose a ticket type for each selected seat before continuing.');
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

  const progressPercent = ((currentStep - 1) / (CHECKOUT_STEPS.length - 1)) * 100;

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
          {CHECKOUT_STEPS.map((step) => {
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
              <div className="h-full min-h-0 flex flex-col xl:flex-row overflow-hidden">
                <aside className="hidden xl:flex w-[360px] shrink-0 border-r border-stone-100 bg-white flex-col min-h-0">
                  <div className="p-5 border-b border-stone-100">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-red-600 mb-1">Seat Picker</p>
                    <h2 className="font-bold text-stone-900 mb-4" style={{ fontFamily: 'Georgia, serif', fontSize: '1.35rem' }}>Find Nearby Seats</h2>
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
                  </div>

                  <div className="flex-1 overflow-y-auto p-5 space-y-3">
                    <div className="text-xs font-bold text-stone-400 uppercase tracking-wider">Selected Seats</div>
                    {selectedSeatsWithPricing.length === 0 ? (
                      <div className="text-sm text-stone-400 italic">No seats selected yet.</div>
                    ) : (
                      selectedSeatsWithPricing.map((item) => (
                        <div key={item.seat.id} className="rounded-xl border border-stone-100 bg-white p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="font-bold text-sm text-stone-900">{item.seat.sectionName}</div>
                              <div className="text-xs text-stone-500">Row {item.seat.row} Seat {item.seat.number}</div>
                            </div>
                            <button
                              onClick={() => handleSeatClick(item.seat)}
                              className="text-stone-400 hover:text-red-500"
                              title="Remove seat"
                            >
                              <X className="w-4 h-4" />
                            </button>
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
                    visibleSeats={visibleSeats}
                    loading={loading}
                    resetKey={performanceId || 'booking-seat-map'}
                    containerClassName="h-full"
                    controlsClassName="absolute bottom-36 right-4 z-30 flex flex-col gap-2 sm:bottom-28 xl:bottom-8 xl:right-8"
                    overlay={
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
                      const selectable = isAvailable && companionRequirementMet;

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
                        {selectedSeatsWithPricing.map((item) => (
                          <button
                            key={item.seat.id}
                            type="button"
                            onClick={() => handleSeatClick(item.seat)}
                            className="whitespace-nowrap rounded-full border border-red-100 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700"
                            title={`Remove ${item.seat.sectionName} ${item.seat.row}-${item.seat.number}`}
                          >
                            {item.seat.sectionName} {item.seat.row}-{item.seat.number}
                          </button>
                        ))}
                      </div>
                    ) : null}

                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs font-bold uppercase text-stone-500 tracking-wider">
                          {selectedSeats.length} Seats Selected
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
                  <p className="text-sm md:text-base text-stone-600 mt-2">Assign a ticket category for each selected seat.</p>
                  {hasMixedCompSelection && (
                    <p className="text-xs text-red-600 mt-2">
                      Teacher and Student in Show complimentary seats cannot be checked out together. Pick one comp type per order.
                    </p>
                  )}
                </div>

                {selectedSeatsWithPricing.length === 0 ? (
                  <div className="rounded-2xl border border-stone-200 bg-white p-8 text-center text-stone-500">
                    You have no seats selected yet.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {selectedSeatsWithPricing.map((item) => (
                      <div key={item.seat.id} className="rounded-2xl border border-stone-200 bg-white p-4">
                        <div className="flex items-center justify-between gap-2 mb-3">
                          <div>
                            <div className="font-black text-stone-900">{item.seat.sectionName}</div>
                            <div className="text-sm text-stone-500">Row {item.seat.row} Seat {item.seat.number}</div>
                          </div>
                          <button
                            onClick={() => handleSeatClick(item.seat)}
                            className="inline-flex items-center gap-1 text-xs font-bold text-red-500 hover:text-red-600"
                          >
                            <X className="w-3 h-3" /> Remove
                          </button>
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
                        {missingTicketTypeCount} seat{missingTicketTypeCount === 1 ? '' : 's'} still need a ticket type.
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
              key="checkout-step"
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
                        Teacher seats selected: <span className="font-bold">{teacherSelectedSeatIds.length}</span>.
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
                            setCurrentStep(2);
                          }}
                          className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-stone-300 px-4 py-3 font-bold text-stone-700 hover:bg-stone-100 sm:w-auto"
                        >
                          <ArrowLeft className="w-4 h-4" /> Back
                        </button>
                        {!pendingStripePayment && (
                          <button
                            onClick={handleCheckout}
                            disabled={processing || selectedSeats.length === 0}
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
                          Unable to initialize Stripe payment form. Please check Stripe configuration and try again.
                        </div>
                      )}
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
                          Student in Show seats selected: <span className="font-bold">{studentInShowSelectedSeatIds.length}</span>.
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
                            setCurrentStep(2);
                          }}
                          className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-stone-300 px-4 py-3 font-bold text-stone-700 hover:bg-stone-100 sm:w-auto"
                        >
                          <ArrowLeft className="w-4 h-4" /> Back
                        </button>
                        {!pendingStripePayment && (
                          <button
                            onClick={handleCheckout}
                            disabled={processing || selectedSeats.length === 0}
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
                          Unable to initialize Stripe payment form. Please check Stripe configuration and try again.
                        </div>
                      )}
                    </>
                  )}
                </div>

                <div className="rounded-2xl border border-stone-100 bg-white p-5 md:p-6 h-fit">
                  <div className="flex items-center justify-between mb-4">
                    <div className="inline-flex items-center gap-2 text-stone-900 font-bold" style={{ fontFamily: 'Georgia, serif' }}>
                      <Ticket className="w-4 h-4" /> Order Summary
                    </div>
                    <div className="text-sm text-stone-500 font-semibold">{selectedSeats.length} seats</div>
                  </div>

                  <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
                    {selectedSeatsWithPricing.map((item) => (
                      <div key={item.seat.id} className="rounded-xl border border-stone-200 bg-stone-50 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-bold text-stone-900">{item.seat.sectionName} Row {item.seat.row} Seat {item.seat.number}</div>
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
        </AnimatePresence>
      </div>
    </div>
  );
}
