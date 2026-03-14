import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
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
import { apiFetch, apiUrl } from '../lib/api';
import { getClientToken } from '../lib/clientToken';
import { clearStaffToken, consumeStaffTokenFromUrlHash, getStaffToken, setStaffToken, staffFetch } from '../lib/staffAuth';

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
  pricingTiers: PricingTier[];
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

type StaffUser = {
  id: string;
  email: string;
  name: string;
  verifiedStaff: boolean;
  staffVerifyMethod: 'OAUTH_GOOGLE' | 'OAUTH_MICROSOFT' | 'REDEEM_CODE' | null;
  staffVerifiedAt: string | null;
};

type BookingDraft = {
  performanceId: string;
  selectedSeatIds: string[];
  ticketOptionBySeatId: Record<string, string>;
  teacherSeatIds?: string[];
  teacherPromoCode?: string;
  customerName: string;
  customerEmail: string;
  currentStep: CheckoutStep;
};

const CHECKOUT_STEPS: Array<{ id: CheckoutStep; label: string }> = [
  { id: 1, label: 'Pick Seats' },
  { id: 2, label: 'Ticket Types' },
  { id: 3, label: 'Checkout' }
];

const BOOKING_OAUTH_DRAFT_KEY = 'theater_booking_oauth_draft';
const TEACHER_TICKET_OPTION_ID = 'teacher-comp';
const STUDENT_SHOW_TICKET_OPTION_ID = 'student-show-comp';
const MAX_TEACHER_COMP_TICKETS = 2;
const MAX_STUDENT_COMP_TICKETS = 2;
const naturalSort = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
const SEAT_X_STEP = 40;
const MAX_ADJACENT_X_GAP = SEAT_X_STEP * 1.5;

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

function oauthErrorMessage(errorParam: string | null): string | null {
  if (!errorParam) return null;
  if (errorParam === 'oauth_failed') return 'Google sign in failed. Please try again.';
  if (errorParam === 'access_denied') return 'Google sign in was cancelled.';
  return decodeURIComponent(errorParam).replace(/\+/g, ' ');
}

export default function Booking() {
  const { performanceId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const clientTokenRef = useRef<string>(getClientToken());
  const holdTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTeacherRestoreSeatIdsRef = useRef<string[] | null>(null);

  const [performanceTitle, setPerformanceTitle] = useState('Ticket Checkout');
  const [pricingTiers, setPricingTiers] = useState<PricingTier[]>([]);
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
  const [studentSchoolEmail, setStudentSchoolEmail] = useState('');
  const [currentStep, setCurrentStep] = useState<CheckoutStep>(1);
  const [staffUser, setStaffUser] = useState<StaffUser | null>(null);
  const [staffAuthLoading, setStaffAuthLoading] = useState(false);
  const [teacherPromoCode, setTeacherPromoCode] = useState('');

  const syncStaffUser = useCallback(async () => {
    const token = getStaffToken();
    if (!token) {
      setStaffUser(null);
      setStaffAuthLoading(false);
      return;
    }

    setStaffAuthLoading(true);
    try {
      const me = await staffFetch<{ user: StaffUser }>('/auth/staff/me');
      setStaffUser(me.user);
    } catch {
      clearStaffToken();
      setStaffUser(null);
    } finally {
      setStaffAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    const oauthToken = consumeStaffTokenFromUrlHash() || searchParams.get('authToken');
    const oauthError = oauthErrorMessage(searchParams.get('error'));
    const teacherCheckoutParam = searchParams.get('teacherCheckout') === '1';

    if (oauthToken) {
      setStaffToken(oauthToken);
    }
    if (teacherCheckoutParam) {
      setCurrentStep(3);
    }

    const draftRaw = sessionStorage.getItem(BOOKING_OAUTH_DRAFT_KEY);
    if (draftRaw) {
      try {
        const draft = JSON.parse(draftRaw) as BookingDraft;
        if (
          performanceId &&
          draft.performanceId === performanceId &&
          Array.isArray(draft.selectedSeatIds) &&
          typeof draft.ticketOptionBySeatId === 'object'
        ) {
          setSelectedSeatIds(draft.selectedSeatIds);
          setTicketOptionBySeatId(draft.ticketOptionBySeatId || {});
          pendingTeacherRestoreSeatIdsRef.current = Array.isArray(draft.teacherSeatIds)
            ? draft.teacherSeatIds.filter((seatId) => typeof seatId === 'string')
            : null;
          setCustomerName(draft.customerName || '');
          setCustomerEmail(draft.customerEmail || '');
          setTeacherPromoCode(draft.teacherPromoCode || '');
          setCurrentStep(draft.currentStep || 3);
        }
      } catch {
        // ignore invalid draft payloads
      } finally {
        sessionStorage.removeItem(BOOKING_OAUTH_DRAFT_KEY);
      }
    }

    if (oauthToken || oauthError || teacherCheckoutParam) {
      const next = new URLSearchParams(searchParams);
      next.delete('authToken');
      next.delete('error');
      next.delete('teacherCheckout');
      setSearchParams(next, { replace: true });
      if (oauthError) {
        setStepError(oauthError);
        setCurrentStep(3);
      }
    }

    if (oauthToken || getStaffToken()) {
      void syncStaffUser();
    }
  }, []);

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
      setPricingTiers(details.pricingTiers || []);
    } catch (err) {
      console.error('Failed to fetch performance details', err);
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
    const tierOptions = pricingTiers.map((tier) => ({
      id: tier.id,
      label: tier.name,
      priceCents: tier.priceCents,
      tierId: tier.id
    }));

    const hasTeacherOption = tierOptions.some((option) => option.label.trim().toLowerCase().includes('teacher'));
    if (!hasTeacherOption) {
      tierOptions.push({
        id: TEACHER_TICKET_OPTION_ID,
        label: 'Teacher',
        priceCents: 0
      });
    }

    const hasStudentInShowOption = tierOptions.some((option) =>
      option.label.trim().toLowerCase().includes('student in show')
    );
    if (!hasStudentInShowOption) {
      tierOptions.push({
        id: STUDENT_SHOW_TICKET_OPTION_ID,
        label: 'Student in Show',
        priceCents: 0
      });
    }

    return tierOptions;
  }, [pricingTiers]);

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

  const handleSeatClick = (seat: Seat) => {
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
    setTicketOptionBySeatId((prev) => ({
      ...prev,
      [seatId]: optionId
    }));
  };

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

    try {
      const holdResult = await syncHolds(selectedSeatIds);
      if (!holdResult || holdResult.heldSeatIds.length !== selectedSeatIds.length) {
        throw new Error('Unable to lock selected seats. Please try again.');
      }

      let checkout: { url?: string; orderId?: string };

      if (isTeacherCheckout) {
        const staffToken = getStaffToken();
        if (!staffToken) {
          throw new Error('Teacher checkout requires Google sign in first.');
        }
        if (!staffUser?.verifiedStaff) {
          throw new Error('Teacher checkout requires a verified staff account.');
        }
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

        checkout = await apiFetch<{ url?: string; orderId?: string }>('/api/checkout', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${staffToken}`
          },
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
        const normalizedStudentSchoolEmail = studentSchoolEmail.trim().toLowerCase();

        if (!effectiveCustomerName || !effectiveCustomerEmail) {
          setStepError('Enter your name and personal email before checkout.');
          setCurrentStep(3);
          return;
        }
        if (!normalizedStudentSchoolEmail) {
          setStepError('Enter your school email for student verification before checkout.');
          setCurrentStep(3);
          return;
        }
        if (effectiveCustomerEmail === normalizedStudentSchoolEmail) {
          setStepError('Use a personal email for ticket delivery that is different from your school email.');
          setCurrentStep(3);
          return;
        }

        checkout = await apiFetch<{ url?: string; orderId?: string }>('/api/checkout', {
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
            studentSchoolEmail: normalizedStudentSchoolEmail
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

        checkout = await apiFetch<{ url?: string; orderId?: string }>('/api/checkout', {
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

      if (checkout.url) {
        window.location.href = checkout.url;
        return;
      }

      if (checkout.orderId) {
        navigate(`/confirmation?orderId=${checkout.orderId}`);
        return;
      }

      throw new Error('Checkout response missing redirect URL.');
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
    () =>
      new Set(ticketOptions.filter((option) => option.label.trim().toLowerCase().includes('teacher')).map((option) => option.id)),
    [ticketOptions]
  );
  const studentInShowOptionIds = useMemo(
    () =>
      new Set(
        ticketOptions
          .filter((option) => option.label.trim().toLowerCase().includes('student in show'))
          .map((option) => option.id)
      ),
    [ticketOptions]
  );
  const primaryTeacherOptionId = useMemo(() => {
    const teacherOption = ticketOptions.find((option) => teacherOptionIds.has(option.id));
    return teacherOption?.id || null;
  }, [teacherOptionIds, ticketOptions]);

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
  const isTeacherCheckout =
    hasTeacherCompSelection || (!hasStudentInShowCompSelection && (Boolean(staffUser?.verifiedStaff) || Boolean(getStaffToken())));
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

  useEffect(() => {
    if (!staffUser?.verifiedStaff) return;
    if (customerName.trim()) return;
    setCustomerName(staffUser.name || '');
  }, [customerName, staffUser]);

  useEffect(() => {
    const pendingTeacherSeatIds = pendingTeacherRestoreSeatIdsRef.current;
    if (!pendingTeacherSeatIds || pendingTeacherSeatIds.length === 0) return;
    if (!primaryTeacherOptionId || selectedSeatIds.length === 0) return;

    const selectedSeatIdSet = new Set(selectedSeatIds);
    setTicketOptionBySeatId((prev) => {
      const next = { ...prev };
      pendingTeacherSeatIds.forEach((seatId) => {
        if (selectedSeatIdSet.has(seatId)) {
          next[seatId] = primaryTeacherOptionId;
        }
      });
      return next;
    });

    pendingTeacherRestoreSeatIdsRef.current = null;
  }, [primaryTeacherOptionId, selectedSeatIds]);

  const startTeacherOAuth = useCallback(() => {
    if (!performanceId) return;

    const draft: BookingDraft = {
      performanceId,
      selectedSeatIds,
      ticketOptionBySeatId,
      teacherSeatIds: teacherSelectedSeatIds,
      teacherPromoCode,
      customerName,
      customerEmail,
      currentStep: 3
    };
    sessionStorage.setItem(BOOKING_OAUTH_DRAFT_KEY, JSON.stringify(draft));

    const oauthUrl = apiUrl(
      `/auth/google/start?${new URLSearchParams({
        returnTo: `/booking/${performanceId}?teacherCheckout=1`
      }).toString()}`
    );
    window.location.href = oauthUrl;
  }, [performanceId, selectedSeatIds, ticketOptionBySeatId, teacherSelectedSeatIds, teacherPromoCode, customerName, customerEmail]);

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

    if (isTeacherCheckout) {
      void syncStaffUser();
    }

    setStepError(null);
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
                        Teacher complimentary checkout requires Google OAuth, a verified staff account, and a teacher promo code. Enter a personal email for delivery.
                      </p>

                      <div className="mt-6 rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm text-stone-700">
                        Teacher seats selected: <span className="font-bold">{teacherSelectedSeatIds.length}</span>.
                        Complimentary this order: <span className="font-bold">{teacherCompAppliedCount}</span> of {MAX_TEACHER_COMP_TICKETS}.
                      </div>

                      <div className="mt-4 rounded-xl border border-stone-200 bg-stone-50 p-4">
                        {staffAuthLoading ? (
                          <div className="text-sm text-stone-600">Checking teacher sign-in...</div>
                        ) : staffUser?.verifiedStaff ? (
                          <div className="text-sm text-stone-700">
                            Signed in as <span className="font-semibold">{staffUser.name}</span> ({staffUser.email}) via{' '}
                            <span className="font-semibold">{staffUser.staffVerifyMethod || 'Unknown method'}</span>.
                          </div>
                        ) : (
                          <div className="text-sm text-stone-700">
                            You are not signed in as a verified teacher yet.
                          </div>
                        )}
                      </div>

                      <div className="mt-6 space-y-4">
                        <label className="block">
                          <span className="text-xs font-semibold uppercase tracking-[0.15em] text-red-600">Full Name</span>
                          <div className="mt-1 relative">
                            <User className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                            <input
                              value={customerName}
                              onChange={(event) => setCustomerName(event.target.value)}
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
                            setCurrentStep(2);
                          }}
                          className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-stone-300 px-4 py-3 font-bold text-stone-700 hover:bg-stone-100 sm:w-auto"
                        >
                          <ArrowLeft className="w-4 h-4" /> Back
                        </button>

                        {!staffUser?.verifiedStaff ? (
                          <>
                            <button
                              onClick={startTeacherOAuth}
                              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-red-700 px-5 py-3 font-semibold text-white hover:bg-red-800 transition-colors sm:w-auto"
                            >
                              Sign In with Google
                            </button>
                            <button
                              onClick={() => void syncStaffUser()}
                              className="w-full rounded-xl border border-stone-300 px-4 py-3 font-bold text-stone-700 hover:bg-stone-100 sm:w-auto"
                            >
                              I Signed In, Refresh
                            </button>
                          </>
                        ) : (
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
                    </>
                  ) : (
                    <>
                      <h2 className="text-2xl md:text-3xl font-bold text-stone-900" style={{ fontFamily: 'Georgia, serif' }}>
                        {isStudentInShowCheckout ? 'Student in Show Checkout' : 'Contact Information'}
                      </h2>
                      <p className="text-sm md:text-base text-stone-600 mt-2">
                        {isStudentInShowCheckout
                          ? 'Use your school email for verification, then a personal email for ticket delivery.'
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
                              placeholder={isStudentInShowCheckout ? 'Personal email for ticket delivery' : 'name@email.com'}
                              className="w-full rounded-xl border border-stone-300 pl-10 pr-3 py-3 focus:border-red-400 focus:ring-2 focus:ring-red-100 outline-none"
                            />
                          </div>
                          {isStudentInShowCheckout ? (
                            <div className="mt-1 text-xs text-stone-500">
                              Tickets are sent to your personal email, not your school email.
                            </div>
                          ) : null}
                        </label>

                        {isStudentInShowCheckout && (
                          <label className="block">
                            <span className="text-xs font-semibold uppercase tracking-[0.15em] text-red-600">School Email</span>
                            <div className="mt-1 relative">
                              <Ticket className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                              <input
                                type="email"
                                value={studentSchoolEmail}
                                onChange={(event) => setStudentSchoolEmail(event.target.value)}
                                placeholder="School email on file"
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
                            setCurrentStep(2);
                          }}
                          className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-stone-300 px-4 py-3 font-bold text-stone-700 hover:bg-stone-100 sm:w-auto"
                        >
                          <ArrowLeft className="w-4 h-4" /> Back
                        </button>
                        <button
                          onClick={handleCheckout}
                          disabled={processing || selectedSeats.length === 0}
                          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-red-700 px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 hover:bg-red-800 transition-colors sm:w-auto"
                        >
                          <CreditCard className="w-4 h-4" />
                          {processing ? 'Processing...' : 'Checkout'}
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
