import { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { TransformWrapper, TransformComponent, ReactZoomPanPinchContentRef } from 'react-zoom-pan-pinch';
import { ChevronLeft, ShoppingCart, X, Minus, Plus, RefreshCw, Search, Users } from 'lucide-react';
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

const naturalSort = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
const SEAT_X_STEP = 40;
const MAX_ADJACENT_X_GAP = SEAT_X_STEP * 1.5;
const MAP_PADDING_X = 120;
const MAP_PADDING_TOP = 180;
const MAP_PADDING_BOTTOM = 140;

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
  const clientTokenRef = useRef<string>(getClientToken());
  const holdTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [seats, setSeats] = useState<Seat[]>([]);
  const [selectedSeatIds, setSelectedSeatIds] = useState<string[]>([]);
  const [heldByMeSeatIds, setHeldByMeSeatIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [activeSection, setActiveSection] = useState<string>('All');
  const [adjacentCount, setAdjacentCount] = useState(2);
  const [lastRefreshed, setLastRefreshed] = useState(Date.now());
  const [holdToken, setHoldToken] = useState('');
  const [holdError, setHoldError] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');

  const fetchSeats = useCallback(async () => {
    if (!performanceId) return;

    try {
      const data = await apiFetch<Seat[] | { seats: Seat[] }>(`/api/performances/${performanceId}/seats`);
      const seatList = Array.isArray(data) ? data : data.seats;
      setSeats(seatList);
      setLastRefreshed(Date.now());
    } catch (err) {
      console.error('Failed to fetch seats', err);
    } finally {
      setLoading(false);
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

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastRefreshed > 10000) {
        void fetchSeats();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    const interval = setInterval(() => void fetchSeats(), 30000);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(interval);
    };
  }, [fetchSeats, lastRefreshed]);

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

  const handleCheckout = async () => {
    if (!performanceId) return;
    if (selectedSeatIds.length === 0) {
      alert('Select at least one seat.');
      return;
    }

    if (!customerName.trim() || !customerEmail.trim()) {
      alert('Enter your name and email before checkout.');
      return;
    }

    setProcessing(true);
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
          holdToken: holdResult.holdToken,
          clientToken: clientTokenRef.current,
          customerEmail: customerEmail.trim(),
          customerName: customerName.trim()
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
      alert(message);
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
  const selectedSeats = useMemo(() => seats.filter((seat) => selectedSeatIds.includes(seat.id)), [seats, selectedSeatIds]);
  const totalAmount = useMemo(() => selectedSeats.reduce((sum, seat) => sum + seat.price, 0), [selectedSeats]);
  const visibleSeats = useMemo(
    () => seats.filter((seat) => activeSection === 'All' || seat.sectionName === activeSection),
    [seats, activeSection]
  );
  const seatById = useMemo(() => new Map(seats.map((seat) => [seat.id, seat])), [seats]);
  const hasAccessibleSelection = useMemo(
    () => selectedSeatIds.some((seatId) => seatById.get(seatId)?.isAccessible),
    [selectedSeatIds, seatById]
  );
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

  return (
    <div className="h-screen flex flex-col bg-stone-50 overflow-hidden font-sans">
      <div className="bg-white border-b border-stone-200 px-4 py-3 flex justify-between items-center z-20 shadow-sm shrink-0">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(-1)} className="flex items-center text-stone-600 hover:text-stone-900 font-bold transition-colors">
            <ChevronLeft className="w-5 h-5 mr-1" /> Back
          </button>
          <div className="h-6 w-px bg-stone-200 hidden md:block" />
          <h1 className="font-bold text-stone-900 hidden md:block">Select Seats</h1>
        </div>

        <div className="flex gap-4 text-xs md:text-sm font-medium overflow-x-auto no-scrollbar">
          <div className="flex items-center gap-2 whitespace-nowrap"><div className="w-3 h-3 md:w-4 md:h-4 rounded-full bg-white border-2 border-stone-300" /> Available</div>
          <div className="flex items-center gap-2 whitespace-nowrap"><div className="w-3 h-3 md:w-4 md:h-4 rounded-full bg-blue-500" /> Accessible</div>
          <div className="flex items-center gap-2 whitespace-nowrap"><div className="w-3 h-3 md:w-4 md:h-4 rounded-full bg-cyan-400" /> Companion</div>
          <div className="flex items-center gap-2 whitespace-nowrap"><div className="w-3 h-3 md:w-4 md:h-4 rounded-full bg-green-500 shadow-sm" /> Selected</div>
          <div className="flex items-center gap-2 whitespace-nowrap"><div className="w-3 h-3 md:w-4 md:h-4 rounded-full bg-orange-300" /> Held</div>
          <div className="flex items-center gap-2 whitespace-nowrap"><div className="w-3 h-3 md:w-4 md:h-4 rounded-full bg-stone-300" /> Sold/Blocked</div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden relative">
        <div className="hidden lg:flex flex-col w-80 bg-white border-r border-stone-200 z-10 shrink-0">
          <div className="p-6 border-b border-stone-200">
            <h2 className="font-bold text-lg mb-4">Find Seats</h2>
            <div className="flex gap-2 mb-4">
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
                className="bg-stone-900 text-white p-2 rounded-lg hover:bg-stone-800 transition-colors"
                title="Find adjacent seats"
              >
                <Search className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-2">Sections</div>
              <button
                onClick={() => setActiveSection('All')}
                className={`w-full text-left px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeSection === 'All' ? 'bg-yellow-100 text-yellow-900' : 'hover:bg-stone-50 text-stone-600'}`}
              >
                All Sections
              </button>
              {sections.map((section) => (
                <button
                  key={section}
                  onClick={() => setActiveSection(section)}
                  className={`w-full text-left px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeSection === section ? 'bg-yellow-100 text-yellow-900' : 'hover:bg-stone-50 text-stone-600'}`}
                >
                  {section}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            <div>
              <div className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-4">Selected Seats</div>
              {selectedSeats.length === 0 ? (
                <div className="text-stone-400 text-sm italic text-center py-8">No seats selected</div>
              ) : (
                <div className="space-y-3">
                  {selectedSeats.map((seat) => (
                    <div key={seat.id} className="flex justify-between items-center bg-stone-50 p-3 rounded-xl border border-stone-100">
                      <div>
                        <div className="font-bold text-sm text-stone-900">{seat.sectionName}</div>
                        <div className="text-xs text-stone-500">Row {seat.row} • Seat {seat.number}</div>
                        {seat.isAccessible && <div className="text-[11px] text-blue-700">Accessible</div>}
                        {seat.isCompanion && <div className="text-[11px] text-cyan-700">Companion</div>}
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="font-bold text-sm">${(seat.price / 100).toFixed(2)}</div>
                        <button onClick={() => handleSeatClick(seat)} className="text-stone-400 hover:text-red-500 transition-colors">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-stone-50 p-4 rounded-xl border border-stone-200">
              <div className="text-xs font-bold text-stone-500 uppercase tracking-wider mb-2">Contact</div>
              <input
                value={customerName}
                onChange={(event) => setCustomerName(event.target.value)}
                placeholder="Full name"
                className="w-full rounded-lg border border-stone-300 px-3 py-2 mb-2 text-sm"
              />
              <input
                type="email"
                value={customerEmail}
                onChange={(event) => setCustomerEmail(event.target.value)}
                placeholder="Email"
                className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
              />
            </div>

            {holdError && <div className="text-sm text-red-600">{holdError}</div>}
          </div>

          <div className="p-6 border-t border-stone-200 bg-stone-50">
            <div className="flex justify-between items-end mb-4">
              <div className="text-stone-500 text-sm">Total</div>
              <div className="text-3xl font-black text-stone-900">${(totalAmount / 100).toFixed(2)}</div>
            </div>
            <button
              onClick={handleCheckout}
              disabled={selectedSeats.length === 0 || processing}
              className="w-full bg-stone-900 text-white py-4 rounded-xl font-bold text-lg hover:bg-yellow-400 hover:text-stone-900 transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {processing ? 'Processing...' : <>Checkout <ShoppingCart className="w-5 h-5" /></>}
            </button>
          </div>
        </div>

        <div className="flex-1 relative bg-stone-100 overflow-hidden">
          {loading && (
            <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/80 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-4">
                <RefreshCw className="w-8 h-8 animate-spin text-yellow-500" />
                <div className="font-bold text-stone-600">Loading seating chart...</div>
              </div>
            </div>
          )}

          <div className="lg:hidden absolute top-4 left-4 right-4 z-30 flex gap-2 overflow-x-auto no-scrollbar pb-2">
            <button
              onClick={() => setActiveSection('All')}
              className={`px-4 py-2 rounded-full text-xs font-bold shadow-md whitespace-nowrap ${activeSection === 'All' ? 'bg-stone-900 text-white' : 'bg-white text-stone-600'}`}
            >
              All
            </button>
            {sections.map((section) => (
              <button
                key={section}
                onClick={() => setActiveSection(section)}
                className={`px-4 py-2 rounded-full text-xs font-bold shadow-md whitespace-nowrap ${activeSection === section ? 'bg-stone-900 text-white' : 'bg-white text-stone-600'}`}
              >
                {section}
              </button>
            ))}
          </div>

          <div className="absolute bottom-24 lg:bottom-8 right-4 lg:right-8 z-30 flex flex-col gap-2">
            <button onClick={() => transformComponentRef.current?.zoomIn()} className="bg-white p-3 rounded-full shadow-lg text-stone-600 hover:text-stone-900 hover:bg-stone-50 transition-colors">
              <Plus className="w-5 h-5" />
            </button>
            <button onClick={() => transformComponentRef.current?.zoomOut()} className="bg-white p-3 rounded-full shadow-lg text-stone-600 hover:text-stone-900 hover:bg-stone-50 transition-colors">
              <Minus className="w-5 h-5" />
            </button>
            <button onClick={() => transformComponentRef.current?.resetTransform()} className="bg-white p-3 rounded-full shadow-lg text-stone-600 hover:text-stone-900 hover:bg-stone-50 transition-colors" title="Reset View">
              <RefreshCw className="w-5 h-5" />
            </button>
          </div>

          <TransformWrapper ref={transformComponentRef} initialScale={1} minScale={0.5} maxScale={3} centerOnInit wheel={{ step: 0.1 }}>
            <TransformComponent wrapperClass="!w-full !h-full" contentClass="!w-full !h-full">
              <div className="min-w-[1000px] min-h-[900px] w-full h-full flex items-center justify-center p-12 md:p-20">
                <div className="relative" style={{ width: `${mapBounds.width}px`, height: `${mapBounds.height}px` }}>
                  <div
                    className="absolute left-1/2 -translate-x-1/2 top-8 h-16 bg-stone-200 rounded-b-[120px] flex items-center justify-center shadow-inner border border-stone-300"
                    style={{ width: `${stageWidth}px` }}
                  >
                    <span className="text-stone-500 font-black uppercase tracking-[0.35em] text-sm">Stage</span>
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
                          'absolute w-8 h-8 md:w-10 md:h-10 rounded-t-lg rounded-b-md flex items-center justify-center text-[10px] font-bold transition-all duration-200 group',
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
        </div>
      </div>

      <AnimatePresence>
        {selectedSeats.length > 0 && (
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="lg:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-stone-200 shadow-[0_-10px_40px_rgba(0,0,0,0.1)] p-4 z-40 rounded-t-3xl"
          >
            {holdError && <div className="text-xs text-red-600 mb-2">{holdError}</div>}
            <div className="flex justify-between items-center mb-4">
              <div>
                <div className="text-xs text-stone-500 font-bold uppercase">Total</div>
                <div className="text-3xl font-black text-stone-900">${(totalAmount / 100).toFixed(2)}</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-stone-500 font-bold uppercase">{selectedSeats.length} Seats</div>
                <button onClick={() => setSelectedSeatIds([])} className="text-xs text-red-500 font-bold underline">
                  Clear
                </button>
              </div>
            </div>
            <input
              value={customerName}
              onChange={(event) => setCustomerName(event.target.value)}
              placeholder="Full name"
              className="w-full rounded-lg border border-stone-300 px-3 py-2 mb-2 text-sm"
            />
            <input
              type="email"
              value={customerEmail}
              onChange={(event) => setCustomerEmail(event.target.value)}
              placeholder="Email"
              className="w-full rounded-lg border border-stone-300 px-3 py-2 mb-3 text-sm"
            />
            <button
              onClick={handleCheckout}
              disabled={processing}
              className="w-full bg-stone-900 text-white py-4 rounded-xl font-bold text-lg hover:bg-yellow-400 hover:text-stone-900 transition-all shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {processing ? 'Processing...' : 'Checkout'}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
