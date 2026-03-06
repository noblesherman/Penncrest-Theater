import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { TransformWrapper, TransformComponent, ReactZoomPanPinchContentRef } from 'react-zoom-pan-pinch';
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  CreditCard,
  Mail,
  Minus,
  Plus,
  RefreshCw,
  Search,
  Ticket,
  User,
  Users,
  X
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { getClientToken } from '../lib/clientToken';

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
  unitPrice: number;
};

const CHECKOUT_STEPS: Array<{ id: CheckoutStep; label: string }> = [
  { id: 1, label: 'Pick Seats' },
  { id: 2, label: 'Ticket Types' },
  { id: 3, label: 'Checkout' }
];

const naturalSort = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
const SEAT_X_STEP = 40;
const MAX_ADJACENT_X_GAP = SEAT_X_STEP * 1.5;
const MAP_PADDING_X = 120;
const MAP_PADDING_TOP = 200;
const MAP_PADDING_BOTTOM = 140;
const FIT_VIEWPORT_PADDING = 96;
const MAP_FRAME_PADDING = 40;

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

export default function Booking() {
  const { performanceId } = useParams();
  const navigate = useNavigate();
  const transformComponentRef = useRef<ReactZoomPanPinchContentRef>(null);
  const mapViewportRef = useRef<HTMLDivElement | null>(null);
  const hasInitialFitRef = useRef(false);
  const clientTokenRef = useRef<string>(getClientToken());
  const holdTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  const [isPanning, setIsPanning] = useState(false);
  const [currentStep, setCurrentStep] = useState<CheckoutStep>(1);

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
    return pricingTiers.map((tier) => ({
      id: tier.id,
      label: tier.name,
      priceCents: tier.priceCents,
      tierId: tier.id
    }));
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

    const effectiveCustomerName = customerName.trim();
    const effectiveCustomerEmail = customerEmail.trim().toLowerCase();

    if (!effectiveCustomerName || !effectiveCustomerEmail) {
      setStepError('Enter your name and email before checkout.');
      setCurrentStep(3);
      return;
    }

    const tierCountMap = new Map<string, number>();
    selectedSeatIds.forEach((seatId) => {
      const optionId = ticketOptionBySeatId[seatId];
      const option = ticketOptions.find((item) => item.id === optionId);
      if (!option?.tierId) return;
      tierCountMap.set(option.tierId, (tierCountMap.get(option.tierId) || 0) + 1);
    });

    const ticketSelections = [...tierCountMap.entries()].map(([tierId, count]) => ({ tierId, count }));

    setProcessing(true);
    setStepError(null);

    try {
      const holdResult = await syncHolds(selectedSeatIds);
      if (!holdResult || holdResult.heldSeatIds.length !== selectedSeatIds.length) {
        throw new Error('Unable to lock selected seats. Please try again.');
      }

      const checkout = await apiFetch<{ url?: string; orderId?: string }>('/api/checkout', {
        method: 'POST',
        body: JSON.stringify({
          performanceId,
          checkoutMode: 'PAID',
          seatIds: holdResult.heldSeatIds,
          ticketSelections: ticketSelections.length > 0 ? ticketSelections : undefined,
          holdToken: holdResult.holdToken,
          clientToken: clientTokenRef.current,
          customerEmail: effectiveCustomerEmail,
          customerName: effectiveCustomerName
        })
      });

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

  const selectedSeatsWithPricing = useMemo<SelectedSeatPricing[]>(() => {
    return selectedSeats.map((seat) => {
      const selectedOptionId = ticketOptionBySeatId[seat.id] || null;
      const option = selectedOptionId ? ticketOptionById.get(selectedOptionId) : undefined;

      return {
        seat,
        optionId: selectedOptionId,
        optionLabel: option?.label || 'Standard',
        unitPrice: option?.priceCents ?? seat.price
      };
    });
  }, [selectedSeats, ticketOptionBySeatId, ticketOptionById]);

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

  const mapBounds = useMemo(() => {
    if (seats.length === 0) {
      return {
        minX: 0,
        maxX: 1000,
        minY: 0,
        maxY: 1000,
        width: 1200,
        height: 1320
      };
    }

    const minX = Math.min(...seats.map((seat) => seat.x));
    const maxX = Math.max(...seats.map((seat) => seat.x));
    const minY = Math.min(...seats.map((seat) => seat.y));
    const maxY = Math.max(...seats.map((seat) => seat.y));
    const width = maxX - minX + MAP_PADDING_X * 2;
    const height = maxY - minY + MAP_PADDING_TOP + MAP_PADDING_BOTTOM;

    return { minX, maxX, minY, maxY, width, height };
  }, [seats]);

  const mapContent = useMemo(
    () => ({
      width: mapBounds.width + MAP_FRAME_PADDING * 2,
      height: mapBounds.height + MAP_FRAME_PADDING * 2
    }),
    [mapBounds.height, mapBounds.width]
  );

  const rowAnchors = useMemo(() => {
    const rows = new Map<string, { minX: number; maxX: number; y: number }>();

    visibleSeats.forEach((seat) => {
      const existing = rows.get(seat.row);
      if (!existing) {
        rows.set(seat.row, { minX: seat.x, maxX: seat.x, y: seat.y });
        return;
      }
      existing.minX = Math.min(existing.minX, seat.x);
      existing.maxX = Math.max(existing.maxX, seat.x);
      existing.y = Math.min(existing.y, seat.y);
    });

    return [...rows.entries()]
      .sort(([a], [b]) => naturalSort(a, b))
      .map(([row, value]) => ({ row, ...value }));
  }, [visibleSeats]);

  const stageWidth = useMemo(() => Math.min(960, Math.max(560, Math.round(mapBounds.width * 0.6))), [mapBounds.width]);
  const stageCenterX = useMemo(() => ((mapBounds.maxX + mapBounds.minX) / 2) - mapBounds.minX + MAP_PADDING_X, [mapBounds]);
  const stageGuideTop = MAP_PADDING_TOP - 16;

  const fitMapToViewport = useCallback(
    (animationTime = 220) => {
      const transform = transformComponentRef.current;
      const wrapperWidth = transform?.instance.wrapperComponent?.clientWidth ?? mapViewportRef.current?.clientWidth ?? 0;
      const wrapperHeight = transform?.instance.wrapperComponent?.clientHeight ?? mapViewportRef.current?.clientHeight ?? 0;
      if (!transform || wrapperWidth <= 0 || wrapperHeight <= 0) return;

      const availableWidth = Math.max(200, wrapperWidth - FIT_VIEWPORT_PADDING);
      const availableHeight = Math.max(200, wrapperHeight - FIT_VIEWPORT_PADDING);
      const fitScale = Math.min(availableWidth / mapContent.width, availableHeight / mapContent.height, 1);
      const clampedScale = Math.max(0.2, fitScale);
      const positionX = (wrapperWidth - mapContent.width * clampedScale) / 2;
      const positionY = (wrapperHeight - mapContent.height * clampedScale) / 2;
      transform.setTransform(positionX, positionY, clampedScale, animationTime, 'easeOut');
    },
    [mapContent.height, mapContent.width]
  );

  useEffect(() => {
    hasInitialFitRef.current = false;
  }, [performanceId]);

  useEffect(() => {
    if (loading || seats.length === 0 || hasInitialFitRef.current) return;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const frameId = requestAnimationFrame(() => {
      fitMapToViewport(0);
      timeoutId = setTimeout(() => fitMapToViewport(0), 90);
      hasInitialFitRef.current = true;
    });
    return () => {
      cancelAnimationFrame(frameId);
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [fitMapToViewport, loading, seats.length]);

  useEffect(() => {
    const onResize = () => {
      if (!hasInitialFitRef.current) return;
      fitMapToViewport(180);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [fitMapToViewport]);

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

    setStepError(null);
    setCurrentStep(3);
  };

  const progressPercent = ((currentStep - 1) / (CHECKOUT_STEPS.length - 1)) * 100;

  return (
    <div className="h-screen bg-stone-50 overflow-hidden flex flex-col font-sans">
      <div className="shrink-0 border-b border-stone-200 bg-white">
        <div className="px-4 md:px-6 py-3 flex items-center justify-between gap-4">
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1 text-sm md:text-base font-bold text-stone-700 hover:text-stone-900"
          >
            <ChevronLeft className="w-4 h-4" /> Back
          </button>
          <div className="text-xs md:text-sm font-semibold text-stone-700 truncate">{performanceTitle}</div>
        </div>

        <div className="h-1 bg-stone-200">
          <motion.div
            className="h-1 bg-yellow-500"
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
                  isCurrent ? 'text-stone-900' : isComplete ? 'text-yellow-700' : 'text-stone-400'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    isCurrent ? 'bg-stone-900' : isComplete ? 'bg-yellow-500' : 'bg-stone-300'
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
                <aside className="hidden xl:flex w-[360px] shrink-0 border-r border-stone-200 bg-white flex-col min-h-0">
                  <div className="p-5 border-b border-stone-200">
                    <h2 className="font-bold text-stone-900 mb-4">Find Nearby Seats</h2>
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
                        className="bg-stone-900 text-white p-2 rounded-lg hover:bg-stone-800"
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
                          activeSection === 'All' ? 'bg-yellow-100 text-yellow-900' : 'hover:bg-stone-50 text-stone-600'
                        }`}
                      >
                        All Sections
                      </button>
                      {sections.map((section) => (
                        <button
                          key={section}
                          onClick={() => setActiveSection(section)}
                          className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium ${
                            activeSection === section ? 'bg-yellow-100 text-yellow-900' : 'hover:bg-stone-50 text-stone-600'
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
                        <div key={item.seat.id} className="rounded-xl border border-stone-200 bg-stone-50 p-3">
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

                  <div className="p-5 border-t border-stone-200 bg-stone-50">
                    <div className="flex items-end justify-between">
                      <div className="text-sm text-stone-600">Total</div>
                      <div className="text-2xl font-black text-stone-900">${(totalAmount / 100).toFixed(2)}</div>
                    </div>
                    <button
                      onClick={goToStepTwo}
                      disabled={!canContinueToTypes}
                      className="mt-4 w-full bg-stone-900 text-white rounded-xl py-3 font-bold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-stone-800 inline-flex items-center justify-center gap-2"
                    >
                      Continue <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </aside>

                <div ref={mapViewportRef} className="flex-1 relative bg-stone-100 overflow-hidden">
                  {loading && (
                    <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/80 backdrop-blur-sm">
                      <div className="flex flex-col items-center gap-4">
                        <RefreshCw className="w-8 h-8 animate-spin text-yellow-500" />
                        <div className="font-bold text-stone-600">Loading seating chart...</div>
                      </div>
                    </div>
                  )}

                  <div className="absolute top-4 left-4 right-4 z-30 flex gap-2 overflow-x-auto no-scrollbar pb-2 xl:hidden">
                    <button
                      onClick={() => setActiveSection('All')}
                      className={`px-4 py-2 rounded-full text-xs font-bold shadow-md whitespace-nowrap ${
                        activeSection === 'All' ? 'bg-stone-900 text-white' : 'bg-white text-stone-600'
                      }`}
                    >
                      All
                    </button>
                    {sections.map((section) => (
                      <button
                        key={section}
                        onClick={() => setActiveSection(section)}
                        className={`px-4 py-2 rounded-full text-xs font-bold shadow-md whitespace-nowrap ${
                          activeSection === section ? 'bg-stone-900 text-white' : 'bg-white text-stone-600'
                        }`}
                      >
                        {section}
                      </button>
                    ))}
                  </div>

                  <div className="absolute bottom-24 xl:bottom-8 right-4 xl:right-8 z-30 flex flex-col gap-2">
                    <button
                      onClick={() => transformComponentRef.current?.zoomIn(0.5)}
                      className="map-control-btn bg-white p-3 rounded-full shadow-lg text-stone-600 hover:text-stone-900"
                    >
                      <Plus className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => transformComponentRef.current?.zoomOut(0.5)}
                      className="map-control-btn bg-white p-3 rounded-full shadow-lg text-stone-600 hover:text-stone-900"
                    >
                      <Minus className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => fitMapToViewport(220)}
                      className="map-control-btn bg-white p-3 rounded-full shadow-lg text-stone-600 hover:text-stone-900"
                      title="Reset View"
                    >
                      <RefreshCw className="w-5 h-5" />
                    </button>
                  </div>

                  <TransformWrapper
                    ref={transformComponentRef}
                    initialScale={0.7}
                    minScale={0.2}
                    maxScale={8}
                    centerOnInit={false}
                    centerZoomedOut={false}
                    disablePadding
                    smooth
                    limitToBounds={false}
                    wheel={{
                      step: 0.16,
                      touchPadDisabled: false,
                      excluded: ['input', 'textarea', 'select']
                    }}
                    pinch={{ step: 6 }}
                    panning={{
                      allowLeftClickPan: true,
                      lockAxisX: false,
                      lockAxisY: false,
                      velocityDisabled: false,
                      excluded: ['button', 'input', 'textarea', 'select', 'a', 'seat-button', 'map-control-btn']
                    }}
                    doubleClick={{
                      mode: 'zoomIn',
                      step: 1.25,
                      animationTime: 180
                    }}
                    alignmentAnimation={{ disabled: true }}
                    velocityAnimation={{
                      sensitivity: 1.1,
                      animationTime: 280,
                      equalToMove: true
                    }}
                    onPanningStart={() => setIsPanning(true)}
                    onPanningStop={() => setIsPanning(false)}
                  >
                    <TransformComponent wrapperClass={`!w-full !h-full ${isPanning ? 'cursor-grabbing' : 'cursor-grab'}`} contentClass="!w-auto !h-auto">
                      <div className="relative" style={{ width: `${mapContent.width}px`, height: `${mapContent.height}px` }}>
                        <div
                          className="absolute"
                          style={{
                            left: `${MAP_FRAME_PADDING}px`,
                            top: `${MAP_FRAME_PADDING}px`,
                            width: `${mapBounds.width}px`,
                            height: `${mapBounds.height}px`
                          }}
                        >
                          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-stone-50 via-stone-50 to-stone-100/80 rounded-3xl" />

                          <div
                            className="pointer-events-none absolute w-px bg-gradient-to-b from-stone-300/70 via-stone-300/25 to-transparent"
                            style={{
                              left: `${stageCenterX}px`,
                              top: `${stageGuideTop}px`,
                              height: `${Math.max(0, mapBounds.height - stageGuideTop - 60)}px`
                            }}
                          />

                          <div
                            className="pointer-events-none absolute -translate-x-1/2 top-7"
                            style={{ left: `${stageCenterX}px`, width: `${stageWidth}px` }}
                          >
                            <div className="relative w-full">
                              <div className="absolute left-8 right-8 -bottom-3 h-5 rounded-full bg-amber-900/25 blur-sm" />
                              <div className="relative h-16 rounded-b-[120px] border border-amber-700/40 bg-gradient-to-b from-amber-100 via-amber-200 to-amber-300 shadow-[0_10px_24px_rgba(120,80,24,0.35)] flex items-center justify-center">
                                <div className="absolute top-2 left-8 right-8 h-2 rounded-full bg-white/35" />
                                <span className="text-amber-900/80 font-black uppercase tracking-[0.35em] text-sm">Stage</span>
                              </div>
                              <div className="mx-auto mt-1 h-1.5 w-[70%] rounded-full bg-stone-300/80" />
                            </div>
                          </div>

                          {rowAnchors.map((anchor) => {
                            const y = anchor.y - mapBounds.minY + MAP_PADDING_TOP + 12;
                            const left = anchor.minX - mapBounds.minX + MAP_PADDING_X - 28;
                            const right = anchor.maxX - mapBounds.minX + MAP_PADDING_X + 44;

                            return (
                              <div key={anchor.row}>
                                <div className="absolute text-xs font-bold text-stone-400" style={{ left: `${left}px`, top: `${y}px` }}>
                                  {anchor.row}
                                </div>
                                <div className="absolute text-xs font-bold text-stone-400" style={{ left: `${right}px`, top: `${y}px` }}>
                                  {anchor.row}
                                </div>
                              </div>
                            );
                          })}

                          {visibleSeats.map((seat) => {
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
                            const x = seat.x - mapBounds.minX + MAP_PADDING_X;
                            const y = seat.y - mapBounds.minY + MAP_PADDING_TOP;

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
                                            : 'bg-white border-2 border-stone-200 text-stone-600 hover:border-blue-400 hover:shadow-md hover:-translate-y-1'
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
                          })}
                        </div>
                      </div>
                    </TransformComponent>
                  </TransformWrapper>

                  <div className="xl:hidden absolute left-0 right-0 bottom-0 z-40 bg-white border-t border-stone-200 px-4 py-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs font-bold uppercase text-stone-500 tracking-wider">
                          {selectedSeats.length} Seats Selected
                        </div>
                        <div className="text-xl font-black text-stone-900">${(totalAmount / 100).toFixed(2)}</div>
                      </div>
                      <button
                        onClick={goToStepTwo}
                        disabled={!canContinueToTypes}
                        className="bg-stone-900 text-white rounded-xl px-4 py-3 font-bold disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
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
                </div>

                {selectedSeatsWithPricing.length === 0 ? (
                  <div className="rounded-2xl border border-stone-200 bg-white p-8 text-center text-stone-500">
                    You have no seats selected yet.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                                {option.label} - ${(option.priceCents / 100).toFixed(2)}
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

                <div className="mt-8 rounded-2xl border border-stone-200 bg-white p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <div>
                    <div className="text-xs uppercase tracking-wider font-bold text-stone-500">Order total</div>
                    <div className="text-3xl font-black text-stone-900">${(totalAmount / 100).toFixed(2)}</div>
                    {missingTicketTypeCount > 0 && (
                      <div className="text-sm text-red-600 mt-1">
                        {missingTicketTypeCount} seat{missingTicketTypeCount === 1 ? '' : 's'} still need a ticket type.
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setStepError(null);
                        setCurrentStep(1);
                      }}
                      className="rounded-xl border border-stone-300 px-4 py-3 font-bold text-stone-700 hover:bg-stone-100 inline-flex items-center gap-2"
                    >
                      <ArrowLeft className="w-4 h-4" /> Back
                    </button>
                    <button
                      onClick={goToStepThree}
                      disabled={!canContinueToCheckout}
                      className="rounded-xl bg-stone-900 px-5 py-3 font-bold text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-stone-800 inline-flex items-center gap-2"
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
                <div className="rounded-2xl border border-stone-200 bg-white p-5 md:p-6 h-fit">
                  <h2 className="text-2xl md:text-3xl font-black text-stone-900">Contact Information</h2>
                  <p className="text-sm md:text-base text-stone-600 mt-2">
                    We will send tickets and confirmation to this email.
                  </p>

                  <div className="mt-6 space-y-4">
                    <label className="block">
                      <span className="text-xs font-bold uppercase tracking-wider text-stone-500">Full Name</span>
                      <div className="mt-1 relative">
                        <User className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          value={customerName}
                          onChange={(event) => setCustomerName(event.target.value)}
                          placeholder="Jane Doe"
                          className="w-full rounded-xl border border-stone-300 pl-10 pr-3 py-3"
                        />
                      </div>
                    </label>

                    <label className="block">
                      <span className="text-xs font-bold uppercase tracking-wider text-stone-500">Email</span>
                      <div className="mt-1 relative">
                        <Mail className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="email"
                          value={customerEmail}
                          onChange={(event) => setCustomerEmail(event.target.value)}
                          placeholder="name@email.com"
                          className="w-full rounded-xl border border-stone-300 pl-10 pr-3 py-3"
                        />
                      </div>
                    </label>
                  </div>

                  <div className="mt-6 flex items-center gap-2">
                    <button
                      onClick={() => {
                        setStepError(null);
                        setCurrentStep(2);
                      }}
                      className="rounded-xl border border-stone-300 px-4 py-3 font-bold text-stone-700 hover:bg-stone-100 inline-flex items-center gap-2"
                    >
                      <ArrowLeft className="w-4 h-4" /> Back
                    </button>
                    <button
                      onClick={handleCheckout}
                      disabled={processing || selectedSeats.length === 0}
                      className="rounded-xl bg-stone-900 px-5 py-3 font-bold text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-stone-800 inline-flex items-center gap-2"
                    >
                      <CreditCard className="w-4 h-4" />
                      {processing ? 'Processing...' : 'Checkout'}
                    </button>
                  </div>
                </div>

                <div className="rounded-2xl border border-stone-200 bg-white p-5 md:p-6 h-fit">
                  <div className="flex items-center justify-between mb-4">
                    <div className="inline-flex items-center gap-2 text-stone-900 font-black">
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
                    <div className="text-3xl font-black text-stone-900">${(totalAmount / 100).toFixed(2)}</div>
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
