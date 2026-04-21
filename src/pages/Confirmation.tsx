import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Calendar, MapPin, Ticket, Search, ChevronLeft, ChevronRight, CheckCircle2 } from 'lucide-react';
import { format } from 'date-fns';
import { apiFetch } from '../lib/api';
import { getRememberedOrderAccessToken, rememberOrderAccessToken } from '../lib/orderAccess';
import { toQrCodeDataUrl } from '../lib/qrCode';

type OrderResponse = {
  order: {
    id: string;
    status: 'PENDING' | 'PAID' | 'FINALIZATION_FAILED' | 'REFUNDED' | 'CANCELED';
    source: 'ONLINE' | 'DOOR' | 'COMP' | 'STAFF_FREE' | 'STAFF_COMP' | 'FAMILY_FREE' | 'STUDENT_COMP';
    email: string;
    customerName: string;
    amountTotal: number;
    currency: string;
    createdAt: string;
    refundStatus?: string | null;
    refundRequestedAt?: string | null;
  };
  performance: {
    id: string;
    title: string;
    showTitle: string;
    startsAt: string;
    venue: string;
    isGeneralAdmission?: boolean;
  };
  tickets: Array<{
    id?: string | null;
    publicId?: string | null;
    seatId?: string | null;
    sectionName: string;
    row: string;
    number: number;
    isGeneralAdmission?: boolean;
    price: number;
    ticketType?: string | null;
    isComplimentary?: boolean;
    attendeeName?: string | null;
    qrPayload?: string | null;
    checkedInAt?: string | null;
    checkedInBy?: string | null;
  }>;
};

const VISIBLE_REFRESH_DELAY_MS = 20_000;
const HIDDEN_REFRESH_DELAY_MS = 60_000;

function getTicketKey(ticket: OrderResponse['tickets'][number], index: number): string {
  return ticket.id || ticket.publicId || ticket.seatId || `ticket-${index}`;
}

export default function Confirmation() {
  const [searchParams] = useSearchParams();
  const orderId = searchParams.get('orderId');
  const tokenFromUrl = searchParams.get('token');
  const [orderData, setOrderData] = useState<OrderResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qrByTicketKey, setQrByTicketKey] = useState<Record<string, string>>({});
  const [activeTicketIndex, setActiveTicketIndex] = useState(0);
  const [isVisible, setIsVisible] = useState(() =>
    typeof document === 'undefined' ? true : document.visibilityState === 'visible'
  );
  const carouselRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onVisibilityChange = () => setIsVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  useEffect(() => {
    if (!orderId) { setError('Missing order ID in URL.'); return; }
    const orderAccessToken = tokenFromUrl || getRememberedOrderAccessToken(orderId);
    if (!orderAccessToken) {
      setError('This confirmation link is incomplete. Use Order Lookup to retrieve your tickets.');
      return;
    }
    rememberOrderAccessToken(orderId, orderAccessToken);
    let cancelled = false;
    let hasLoadedOnce = false;
    const fetchOrder = async (initialLoad = false) => {
      try {
        const result = await apiFetch<OrderResponse>(`/api/orders/${orderId}?token=${encodeURIComponent(orderAccessToken)}`);
        if (cancelled) return;
        setOrderData(result);
        setError(null);
        hasLoadedOnce = true;
      } catch (err) {
        if (cancelled) return;
        if (!hasLoadedOnce || initialLoad)
          setError(err instanceof Error ? err.message : 'We hit a small backstage snag while trying to load order confirmation');
      }
    };
    void fetchOrder(true);
    const interval = window.setInterval(() => void fetchOrder(), isVisible ? VISIBLE_REFRESH_DELAY_MS : HIDDEN_REFRESH_DELAY_MS);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, [orderId, tokenFromUrl, isVisible]);

  useEffect(() => { setQrByTicketKey({}); }, [orderId]);

  useEffect(() => {
    if (!orderData) return;
    let cancelled = false;
    const missingTickets = orderData.tickets
      .map((ticket, index) => ({ key: getTicketKey(ticket, index), qrPayload: ticket.qrPayload }))
      .filter((ticket) => Boolean(ticket.qrPayload) && !qrByTicketKey[ticket.key]);
    if (missingTickets.length === 0) return;
    void Promise.all(
      missingTickets.map(async (ticket) => {
        const imageUrl = await toQrCodeDataUrl(ticket.qrPayload as string, 320);
        return [ticket.key, imageUrl] as const;
      })
    ).then((entries) => {
      if (cancelled) return;
      setQrByTicketKey((current) => {
        const next = { ...current };
        for (const [key, imageUrl] of entries) next[key] = imageUrl;
        return next;
      });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [orderData, qrByTicketKey]);

  useEffect(() => {
    if (!orderData) { setActiveTicketIndex(0); return; }
    setActiveTicketIndex((current) => Math.min(current, Math.max(0, orderData.tickets.length - 1)));
  }, [orderData]);

  const totalLabel = useMemo(() => {
    if (!orderData) return '$0.00';
    return `$${(orderData.order.amountTotal / 100).toFixed(2)}`;
  }, [orderData]);

  const goToTicket = (index: number) => {
    const container = carouselRef.current;
    if (!container || !orderData || orderData.tickets.length === 0) return;
    const totalTickets = orderData.tickets.length;
    const clampedIndex = Math.max(0, Math.min(totalTickets - 1, index));
    const nextChild = container.children.item(clampedIndex) as HTMLElement | null;
    if (nextChild) nextChild.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
    setActiveTicketIndex(clampedIndex);
  };

  if (error) {
    return (
      <div style={styles.page}>
        <div style={{ ...styles.errorCard }}>
          <p style={{ color: '#b45309', fontFamily: 'Georgia, serif', fontSize: 16 }}>{error}</p>
        </div>
      </div>
    );
  }

  if (!orderData) {
    return (
      <div style={styles.page}>
        <div style={styles.loadingWrap}>
          <div style={styles.loadingDot} />
          <span style={styles.loadingText}>Loading your tickets…</span>
        </div>
      </div>
    );
  }

  const pending = orderData.order.status === 'PENDING';
  const finalizationFailed = orderData.order.status === 'FINALIZATION_FAILED';
  const totalTickets = orderData.tickets.length;
  const perf = orderData.performance;

  return (
    <div style={styles.page}>
      <style>{css}</style>

      {/* ── Header ───────────────────────────────────────────── */}
      <header style={styles.header}>
        <div style={styles.headerInner}>
          <p style={styles.orderLabel}>Order #{orderData.order.id.slice(0, 8).toUpperCase()}</p>
          <h1 style={styles.showTitle}>{perf.showTitle}</h1>
          <div style={styles.metaRow}>
            <span style={styles.metaChip}>
              <Calendar size={13} strokeWidth={2} />
              {format(new Date(perf.startsAt), 'EEE, MMM d · h:mm a')}
            </span>
            <span style={styles.metaDot} />
            <span style={styles.metaChip}>
              <MapPin size={13} strokeWidth={2} />
              {perf.venue}
            </span>
          </div>
        </div>
      </header>

      {/* ── Alerts ───────────────────────────────────────────── */}
      {pending && (
        <div style={styles.alertYellow}>
          Payment is still being confirmed — this page refreshes automatically.
        </div>
      )}
      {finalizationFailed && (
        <div style={styles.alertRed}>
          We received payment but couldn't complete ticket issuance. A refund
          {orderData.order.refundStatus ? ` (${orderData.order.refundStatus})` : ' '}
          has been requested automatically. Please don't repurchase until staff confirms recovery.
        </div>
      )}

      {/* ── Ticket Carousel ───────────────────────────────────── */}
      <div style={styles.carouselWrap}>
        {/* prev/next arrows */}
        <button
          className="nav-arrow"
          style={{ ...styles.navArrow, left: 0 }}
          onClick={() => goToTicket(activeTicketIndex - 1)}
          disabled={activeTicketIndex <= 0 || totalTickets <= 1}
          aria-label="Previous ticket"
        >
          <ChevronLeft size={18} strokeWidth={2.5} />
        </button>
        <button
          className="nav-arrow"
          style={{ ...styles.navArrow, right: 0 }}
          onClick={() => goToTicket(activeTicketIndex + 1)}
          disabled={activeTicketIndex >= totalTickets - 1 || totalTickets <= 1}
          aria-label="Next ticket"
        >
          <ChevronRight size={18} strokeWidth={2.5} />
        </button>

        {/* scroll track */}
        <div
          ref={carouselRef}
          style={styles.track}
          onScroll={(e) => {
            const c = e.currentTarget;
            if (!c.clientWidth || totalTickets === 0) return;
            const index = Math.round(c.scrollLeft / c.clientWidth);
            setActiveTicketIndex(Math.max(0, Math.min(totalTickets - 1, index)));
          }}
          aria-label="Ticket wallet"
        >
          {orderData.tickets.map((ticket, index) => {
            const isGA = ticket.isGeneralAdmission || perf.isGeneralAdmission;
            const ticketKey = getTicketKey(ticket, index);
            const qrImageUrl = qrByTicketKey[ticketKey];
            const checkedIn = Boolean(ticket.checkedInAt);

            return (
              <article key={ticketKey} style={styles.slide}>
                <div style={styles.ticketCard} className="ticket-card">

                  {/* ── Checked-in badge ── */}
                  {checkedIn && (
                    <div style={styles.checkedBadge}>
                      <CheckCircle2 size={14} strokeWidth={2.5} color="#059669" />
                      <span>Checked in · {format(new Date(ticket.checkedInAt!), 'MMM d, h:mm a')}</span>
                    </div>
                  )}

                  {/* ── Ticket number pill ── */}
                  <div style={styles.ticketCounter}>
                    {index + 1} / {totalTickets}
                  </div>

                  {/* ── Seat block ── */}
                  {isGA ? (
                    <div style={styles.seatBlock}>
                      <span style={styles.seatLabel}>General Admission</span>
                      <span style={styles.seatSub}>Ticket #{ticket.number || index + 1}</span>
                    </div>
                  ) : (
                    <div style={styles.seatBlock}>
                      <span style={styles.seatSection}>{ticket.sectionName}</span>
                      <div style={styles.seatRowNum}>
                        <div style={styles.seatDetail}>
                          <span style={styles.seatDetailLabel}>Row</span>
                          <span style={styles.seatDetailValue}>{ticket.row}</span>
                        </div>
                        <div style={styles.seatDivider} />
                        <div style={styles.seatDetail}>
                          <span style={styles.seatDetailLabel}>Seat</span>
                          <span style={styles.seatDetailValue}>{ticket.number}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ── Meta pills ── */}
                  <div style={styles.pillRow}>
                    {ticket.ticketType && <span style={styles.pill}>{ticket.ticketType}</span>}
                    {ticket.isComplimentary && <span style={{ ...styles.pill, ...styles.pillGreen }}>Complimentary</span>}
                    {ticket.attendeeName && <span style={styles.pill}>{ticket.attendeeName}</span>}
                  </div>

                  {/* ── Perforated divider ── */}
                  <div style={styles.perfDivider}>
                    <div style={styles.perfCircleL} />
                    <div style={styles.perfLine} />
                    <div style={styles.perfCircleR} />
                  </div>

                  {/* ── QR code ── */}
                  <div style={styles.qrWrap}>
                    {qrImageUrl ? (
                      <img
                        src={qrImageUrl}
                        alt="Ticket QR code"
                        style={styles.qrImg}
                      />
                    ) : (
                      <div style={styles.qrPlaceholder}>
                        <span style={{ fontSize: 13, color: '#a8a29e' }}>
                          {ticket.qrPayload ? 'Generating QR…' : 'QR pending'}
                        </span>
                      </div>
                    )}
                    <p style={styles.qrHint}>Present at the door</p>
                  </div>

                  {/* ── Single ticket link ── */}
                  {ticket.publicId && !finalizationFailed && (
                    <div style={styles.singleLink}>
                      <Link to={`/tickets/${ticket.publicId}`} style={styles.singleLinkAnchor}>
                        <Ticket size={12} strokeWidth={2} />
                        Open single ticket
                      </Link>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>

      {/* ── Dots ──────────────────────────────────────────────── */}
      {totalTickets > 1 && (
        <div style={styles.dots}>
          {orderData.tickets.map((ticket, index) => {
            const ticketKey = getTicketKey(ticket, index);
            const isActive = activeTicketIndex === index;
            return (
              <button
                key={`${ticketKey}-dot`}
                onClick={() => goToTicket(index)}
                style={{
                  ...styles.dot,
                  ...(isActive ? styles.dotActive : styles.dotInactive),
                }}
                aria-label={`Go to ticket ${index + 1}`}
                aria-current={isActive ? 'true' : undefined}
              />
            );
          })}
        </div>
      )}

      {/* ── Summary strip ─────────────────────────────────────── */}
      <div style={styles.summaryStrip}>
        <span style={styles.summaryLabel}>{totalTickets} ticket{totalTickets !== 1 ? 's' : ''}</span>
        <span style={styles.summaryDot} />
        <span style={styles.summaryTotal}>{totalLabel}</span>
      </div>

      {/* ── Footer actions ────────────────────────────────────── */}
      <div style={styles.actions}>
        <Link to="/orders/lookup" style={styles.btnSecondary} className="btn-secondary">
          <Search size={15} strokeWidth={2} />
          Find Another Order
        </Link>
        <Link to="/" style={styles.btnPrimary} className="btn-primary">
          Return Home
        </Link>
      </div>
    </div>
  );
}

/* ─────────────────── Styles ─────────────────────────────────── */

const WARM_BG = '#faf7f4';
const STONE_900 = '#1c1917';
const STONE_600 = '#57534e';
const STONE_300 = '#d6d3d1';
const STONE_100 = '#f5f5f4';
const AMBER = '#b45309';

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: WARM_BG,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    paddingBottom: 48,
    fontFamily: "'DM Sans', 'Helvetica Neue', Arial, sans-serif",
  },

  /* Header */
  header: {
    width: '100%',
    background: STONE_900,
    paddingTop: 48,
    paddingBottom: 36,
    textAlign: 'center',
  },
  headerInner: {
    maxWidth: 480,
    margin: '0 auto',
    padding: '0 24px',
  },
  orderLabel: {
    fontFamily: "'DM Mono', 'Courier New', monospace",
    fontSize: 11,
    letterSpacing: '0.14em',
    color: '#a8a29e',
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  showTitle: {
    fontFamily: "'Playfair Display', Georgia, serif",
    fontSize: 'clamp(26px, 6vw, 38px)',
    fontWeight: 800,
    color: '#fafaf9',
    margin: '0 0 16px',
    lineHeight: 1.15,
    letterSpacing: '-0.01em',
  },
  metaRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    flexWrap: 'wrap',
  },
  metaChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    fontSize: 13,
    color: '#a8a29e',
  },
  metaDot: {
    width: 3,
    height: 3,
    borderRadius: '50%',
    background: '#57534e',
  },

  /* Alerts */
  alertYellow: {
    width: '100%',
    maxWidth: 480,
    margin: '16px auto 0',
    padding: '12px 18px',
    background: '#fef3c7',
    borderTop: '3px solid #d97706',
    fontSize: 13,
    color: '#92400e',
    textAlign: 'center',
    lineHeight: 1.5,
  },
  alertRed: {
    width: '100%',
    maxWidth: 480,
    margin: '16px auto 0',
    padding: '12px 18px',
    background: '#fee2e2',
    borderTop: '3px solid #dc2626',
    fontSize: 13,
    color: '#991b1b',
    textAlign: 'center',
    lineHeight: 1.5,
  },

  /* Carousel */
  carouselWrap: {
    position: 'relative',
    width: '100%',
    maxWidth: 420,
    marginTop: 28,
  },
  navArrow: {
    position: 'absolute',
    top: '50%',
    transform: 'translateY(-50%)',
    zIndex: 10,
    width: 36,
    height: 36,
    borderRadius: '50%',
    background: '#fff',
    border: `1px solid ${STONE_300}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: STONE_900,
    cursor: 'pointer',
    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
    transition: 'opacity 0.15s',
  },
  track: {
    display: 'flex',
    overflowX: 'auto',
    scrollSnapType: 'x mandatory',
    scrollBehavior: 'smooth',
    WebkitOverflowScrolling: 'touch',
    scrollbarWidth: 'none' as const,
    padding: '0 44px',
    gap: 0,
  },

  /* Slide / ticket card */
  slide: {
    minWidth: '100%',
    scrollSnapAlign: 'start',
    padding: '4px 0 8px',
    boxSizing: 'border-box' as const,
  },
  ticketCard: {
    position: 'relative',
    background: '#fff',
    borderRadius: 20,
    boxShadow: '0 4px 24px rgba(0,0,0,0.10), 0 1px 4px rgba(0,0,0,0.06)',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },

  /* Checked-in badge */
  checkedBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    background: '#ecfdf5',
    borderBottom: '1px solid #a7f3d0',
    padding: '9px 18px',
    fontSize: 12,
    fontWeight: 600,
    color: '#065f46',
    letterSpacing: '0.01em',
  },

  /* Ticket counter */
  ticketCounter: {
    position: 'absolute',
    top: 14,
    right: 16,
    fontFamily: "'DM Mono', monospace",
    fontSize: 11,
    color: STONE_600,
    letterSpacing: '0.06em',
  },

  /* Seat */
  seatBlock: {
    padding: '22px 24px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  seatLabel: {
    fontFamily: "'Playfair Display', Georgia, serif",
    fontSize: 26,
    fontWeight: 800,
    color: STONE_900,
    lineHeight: 1.1,
  },
  seatSub: {
    fontSize: 13,
    color: STONE_600,
    fontVariantNumeric: 'tabular-nums',
  },
  seatSection: {
    fontFamily: "'Playfair Display', Georgia, serif",
    fontSize: 22,
    fontWeight: 800,
    color: STONE_900,
    lineHeight: 1.1,
    textTransform: 'uppercase',
    letterSpacing: '0.01em',
  },
  seatRowNum: {
    display: 'inline-flex',
    alignItems: 'stretch',
    gap: 0,
    background: STONE_100,
    borderRadius: 10,
    overflow: 'hidden',
    alignSelf: 'flex-start',
  },
  seatDetail: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '8px 20px',
    gap: 2,
  },
  seatDetailLabel: {
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.12em',
    color: STONE_600,
    textTransform: 'uppercase' as const,
  },
  seatDetailValue: {
    fontSize: 22,
    fontWeight: 800,
    color: STONE_900,
    fontVariantNumeric: 'tabular-nums',
    lineHeight: 1,
    fontFamily: "'Playfair Display', Georgia, serif",
  },
  seatDivider: {
    width: 1,
    background: STONE_300,
    margin: '8px 0',
  },

  /* Pills */
  pillRow: {
    display: 'flex',
    gap: 6,
    flexWrap: 'wrap' as const,
    padding: '0 24px 16px',
  },
  pill: {
    fontSize: 11,
    fontWeight: 600,
    padding: '4px 10px',
    borderRadius: 20,
    background: STONE_100,
    color: STONE_600,
    letterSpacing: '0.04em',
    textTransform: 'uppercase' as const,
  },
  pillGreen: {
    background: '#ecfdf5',
    color: '#065f46',
  },

  /* Perforated divider */
  perfDivider: {
    display: 'flex',
    alignItems: 'center',
    margin: '0 -1px',
    position: 'relative',
  },
  perfCircleL: {
    width: 20,
    height: 20,
    borderRadius: '50%',
    background: WARM_BG,
    border: `1px solid ${STONE_300}`,
    flexShrink: 0,
    marginLeft: -10,
    zIndex: 1,
  },
  perfCircleR: {
    width: 20,
    height: 20,
    borderRadius: '50%',
    background: WARM_BG,
    border: `1px solid ${STONE_300}`,
    flexShrink: 0,
    marginRight: -10,
    zIndex: 1,
  },
  perfLine: {
    flex: 1,
    height: 1,
    borderTop: `2px dashed ${STONE_300}`,
  },

  /* QR */
  qrWrap: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '20px 28px 18px',
    gap: 10,
  },
  qrImg: {
    width: '100%',
    maxWidth: 220,
    borderRadius: 12,
    display: 'block',
  },
  qrPlaceholder: {
    width: '100%',
    maxWidth: 220,
    aspectRatio: '1',
    borderRadius: 12,
    background: STONE_100,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: `1px dashed ${STONE_300}`,
  },
  qrHint: {
    fontSize: 11,
    color: '#a8a29e',
    letterSpacing: '0.06em',
    textTransform: 'uppercase' as const,
    fontWeight: 500,
  },

  /* Single ticket link */
  singleLink: {
    borderTop: `1px solid ${STONE_100}`,
    padding: '10px 24px 14px',
    textAlign: 'center',
  },
  singleLinkAnchor: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    fontSize: 12,
    color: STONE_600,
    textDecoration: 'none',
    letterSpacing: '0.03em',
  },

  /* Dots */
  dots: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: 14,
  },
  dot: {
    height: 6,
    borderRadius: 3,
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    transition: 'all 0.25s ease',
  },
  dotActive: {
    width: 20,
    background: STONE_900,
  },
  dotInactive: {
    width: 6,
    background: STONE_300,
  },

  /* Summary */
  summaryStrip: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginTop: 18,
    fontSize: 13,
    color: STONE_600,
  },
  summaryLabel: {},
  summaryDot: {
    width: 3,
    height: 3,
    borderRadius: '50%',
    background: STONE_300,
  },
  summaryTotal: {
    fontWeight: 700,
    color: STONE_900,
    fontVariantNumeric: 'tabular-nums',
  },

  /* Actions */
  actions: {
    display: 'flex',
    gap: 10,
    marginTop: 24,
    width: '100%',
    maxWidth: 420,
    padding: '0 44px',
    boxSizing: 'border-box' as const,
  },
  btnSecondary: {
    flex: 1,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '11px 0',
    borderRadius: 12,
    border: `1.5px solid ${STONE_300}`,
    background: '#fff',
    color: STONE_900,
    fontSize: 13,
    fontWeight: 600,
    textDecoration: 'none',
    transition: 'background 0.15s',
    letterSpacing: '0.01em',
  },
  btnPrimary: {
    flex: 1,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '11px 0',
    borderRadius: 12,
    background: STONE_900,
    color: '#fafaf9',
    fontSize: 13,
    fontWeight: 600,
    textDecoration: 'none',
    transition: 'background 0.15s',
    letterSpacing: '0.01em',
  },

  /* Loading / error */
  loadingWrap: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 14,
    marginTop: '40vh',
  },
  loadingDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: STONE_900,
    animation: 'pulse 1s ease-in-out infinite',
  },
  loadingText: {
    fontSize: 14,
    color: STONE_600,
    letterSpacing: '0.04em',
  },
  errorCard: {
    maxWidth: 400,
    margin: '40vh auto 0',
    padding: '20px 24px',
    background: '#fff',
    borderRadius: 16,
    border: `1px solid #fde68a`,
    textAlign: 'center',
  },
};

const css = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;600;700&family=Playfair+Display:wght@700;800;900&display=swap');

  .nav-arrow:disabled { opacity: 0.25; cursor: default; }
  .nav-arrow:not(:disabled):hover { background: #f5f5f4 !important; }
  .btn-secondary:hover { background: #f5f5f4 !important; }
  .btn-primary:hover { background: #292524 !important; }
  .ticket-card .single-link-anchor:hover { color: #1c1917; }

  [style*="scrollbar-width: none"]::-webkit-scrollbar { display: none; }

  @keyframes pulse {
    0%, 100% { transform: scale(1); opacity: 1; }
    50% { transform: scale(1.4); opacity: 0.5; }
  }
`;