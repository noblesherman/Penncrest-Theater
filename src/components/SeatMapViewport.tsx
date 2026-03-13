import { CSSProperties, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, RefreshCw } from 'lucide-react';
import { TransformComponent, TransformWrapper, ReactZoomPanPinchContentRef } from 'react-zoom-pan-pinch';

const naturalSort = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
const MAP_PADDING_X = 120;
const MAP_PADDING_TOP = 200;
const MAP_PADDING_BOTTOM = 140;
const FIT_VIEWPORT_PADDING = 96;
const MAP_FRAME_PADDING = 40;

export type SeatMapSeat = {
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
};

type SeatRenderProps<T extends SeatMapSeat> = {
  seat: T;
  x: number;
  y: number;
};

type SeatMapViewportProps<T extends SeatMapSeat> = {
  seats: T[];
  visibleSeats?: T[];
  loading?: boolean;
  emptyText?: string;
  loadingLabel?: string;
  resetKey?: string | number;
  overlay?: ReactNode;
  containerClassName?: string;
  controlsClassName?: string;
  viewportStyle?: CSSProperties;
  renderSeat: (props: SeatRenderProps<T>) => ReactNode;
};

export function SeatMapViewport<T extends SeatMapSeat>({
  seats,
  visibleSeats,
  loading = false,
  emptyText = 'No seats available.',
  loadingLabel = 'Loading seating chart...',
  resetKey,
  overlay = null,
  containerClassName = '',
  controlsClassName = 'absolute bottom-4 right-4 z-30 flex flex-col gap-2',
  viewportStyle,
  renderSeat,
}: SeatMapViewportProps<T>) {
  const transformRef = useRef<ReactZoomPanPinchContentRef>(null);
  const mapViewportRef = useRef<HTMLDivElement | null>(null);
  const hasInitialFitRef = useRef(false);
  const [isPanning, setIsPanning] = useState(false);

  const renderedSeats = visibleSeats ?? seats;

  const mapBounds = useMemo(() => {
    if (seats.length === 0) {
      return {
        minX: 0,
        maxX: 1000,
        minY: 0,
        maxY: 1000,
        width: 1200,
        height: 1320,
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
      height: mapBounds.height + MAP_FRAME_PADDING * 2,
    }),
    [mapBounds.height, mapBounds.width]
  );

  const rowAnchors = useMemo(() => {
    const rows = new Map<string, { minX: number; maxX: number; y: number }>();

    renderedSeats.forEach((seat) => {
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
  }, [renderedSeats]);

  const stageWidth = useMemo(() => Math.min(960, Math.max(560, Math.round(mapBounds.width * 0.6))), [mapBounds.width]);
  const stageCenterX = useMemo(() => ((mapBounds.maxX + mapBounds.minX) / 2) - mapBounds.minX + MAP_PADDING_X, [mapBounds]);
  const stageGuideTop = MAP_PADDING_TOP - 16;

  const fitMapToViewport = useCallback(
    (animationTime = 220) => {
      const transform = transformRef.current;
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
  }, [resetKey]);

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

  return (
    <div
      ref={mapViewportRef}
      className={['relative overflow-hidden bg-stone-100', containerClassName].filter(Boolean).join(' ')}
      style={viewportStyle}
    >
      {loading && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4">
            <RefreshCw className="h-8 w-8 animate-spin text-red-600" />
            <div className="font-bold text-stone-600">{loadingLabel}</div>
          </div>
        </div>
      )}

      {overlay}

      {seats.length > 0 && (
        <div className={controlsClassName}>
          <button
            type="button"
            onClick={() => transformRef.current?.zoomIn(0.5)}
            className="map-control-btn rounded-full bg-white p-3 text-stone-600 shadow-lg transition-colors hover:text-red-700"
          >
            <Plus className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => transformRef.current?.zoomOut(0.5)}
            className="map-control-btn rounded-full bg-white p-3 text-stone-600 shadow-lg transition-colors hover:text-red-700"
          >
            <Minus className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => fitMapToViewport(220)}
            className="map-control-btn rounded-full bg-white p-3 text-stone-600 shadow-lg transition-colors hover:text-red-700"
            title="Reset view"
          >
            <RefreshCw className="h-5 w-5" />
          </button>
        </div>
      )}

      {!seats.length && !loading ? (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-stone-400">{emptyText}</div>
      ) : (
        <TransformWrapper
          ref={transformRef}
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
            excluded: ['input', 'textarea', 'select'],
          }}
          pinch={{ step: 6 }}
          panning={{
            allowLeftClickPan: true,
            lockAxisX: false,
            lockAxisY: false,
            velocityDisabled: false,
            excluded: ['button', 'input', 'textarea', 'select', 'a', 'seat-button', 'map-control-btn'],
          }}
          doubleClick={{
            mode: 'zoomIn',
            step: 1.25,
            animationTime: 180,
          }}
          alignmentAnimation={{ disabled: true }}
          velocityAnimation={{
            sensitivity: 1.1,
            animationTime: 280,
            equalToMove: true,
          }}
          onPanningStart={() => setIsPanning(true)}
          onPanningStop={() => setIsPanning(false)}
        >
          <TransformComponent wrapperClass={`!h-full !w-full ${isPanning ? 'cursor-grabbing' : 'cursor-grab'}`} contentClass="!h-auto !w-auto">
            <div className="relative" style={{ width: `${mapContent.width}px`, height: `${mapContent.height}px` }}>
              <div
                className="absolute"
                style={{
                  left: `${MAP_FRAME_PADDING}px`,
                  top: `${MAP_FRAME_PADDING}px`,
                  width: `${mapBounds.width}px`,
                  height: `${mapBounds.height}px`,
                }}
              >
                <div className="pointer-events-none absolute inset-0 rounded-3xl bg-gradient-to-b from-stone-50 via-stone-50 to-stone-100/80" />

                <div
                  className="pointer-events-none absolute w-px bg-gradient-to-b from-stone-300/70 via-stone-300/25 to-transparent"
                  style={{
                    left: `${stageCenterX}px`,
                    top: `${stageGuideTop}px`,
                    height: `${Math.max(0, mapBounds.height - stageGuideTop - 60)}px`,
                  }}
                />

                <div
                  className="pointer-events-none absolute top-7 -translate-x-1/2"
                  style={{ left: `${stageCenterX}px`, width: `${stageWidth}px` }}
                >
                  <div className="relative w-full">
                    <div className="absolute left-8 right-8 -bottom-3 h-5 rounded-full bg-red-900/25 blur-sm" />
                    <div className="relative flex h-16 items-center justify-center rounded-b-[120px] border border-red-700/40 bg-gradient-to-b from-red-100 via-red-200 to-red-300 shadow-[0_10px_24px_rgba(127,29,29,0.35)]">
                      <div className="absolute top-2 left-8 right-8 h-2 rounded-full bg-white/35" />
                      <span className="text-sm font-black uppercase tracking-[0.35em] text-red-900/80">Stage</span>
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

                {renderedSeats.map((seat) => {
                  const x = seat.x - mapBounds.minX + MAP_PADDING_X;
                  const y = seat.y - mapBounds.minY + MAP_PADDING_TOP;
                  return renderSeat({ seat, x, y });
                })}
              </div>
            </div>
          </TransformComponent>
        </TransformWrapper>
      )}
    </div>
  );
}
