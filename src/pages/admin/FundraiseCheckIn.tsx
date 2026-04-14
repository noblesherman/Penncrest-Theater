import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle2, CreditCard, ExternalLink, QrCode, RefreshCw, Search } from 'lucide-react';
import { adminFetch } from '../../lib/adminAuth';
import { toQrCodeDataUrl } from '../../lib/qrCode';
import {
  persistScannerSessionForPerformance,
  readStoredScannerSessions,
  type PersistedScannerSession
} from '../../lib/scannerRecovery';
import { writeCashierDefaultPerformanceId } from '../../hooks/useCashierDefaultPerformance';

type FundraiseEvent = {
  id: string;
  title: string;
  startsAt: string;
  isFundraiser?: boolean;
};

type TicketRow = {
  seatId: string | null;
  attendeeName: string | null;
  ticketType: string | null;
  isComplimentary: boolean;
  price: number;
  seatLabel: string;
  ticketId: string | null;
  ticketPublicId: string | null;
  checkedInAt: string | null;
  checkedInBy: string | null;
  checkInGate: string | null;
  admissionDecision: 'FORCE_ADMIT' | 'DENY' | null;
  admissionReason: string | null;
};

type AttendeeOrderRow = {
  id: string;
  accessToken: string;
  status: string;
  source: string;
  email: string;
  customerName: string;
  amountTotal: number;
  currency: string;
  createdAt: string;
  orderSeats: TicketRow[];
  registrationSubmission: {
    id: string;
    submittedAt: string;
  } | null;
};

type AttendeeFeed = {
  performance: {
    id: string;
    title: string;
    seatSelectionEnabled: boolean;
  };
  summary: {
    orderCount: number;
    ticketCount: number;
    responseCount: number;
  };
  rows: AttendeeOrderRow[];
};

type ScannerSession = PersistedScannerSession;

type ScanResponse = {
  outcome: 'VALID' | 'ALREADY_CHECKED_IN' | 'WRONG_PERFORMANCE' | 'NOT_ADMITTED' | 'INVALID_QR' | 'NOT_FOUND';
  message: string;
  scannedAt: string;
};

const inputClass =
  'w-full rounded-xl border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-900 outline-none focus:border-stone-500 focus:ring-2 focus:ring-stone-200';

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase()
  }).format(cents / 100);
}

export default function AdminFundraiseCheckInPage() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<FundraiseEvent[]>([]);
  const [performanceId, setPerformanceId] = useState('');
  const [rows, setRows] = useState<AttendeeOrderRow[]>([]);
  const [summary, setSummary] = useState<AttendeeFeed['summary'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [scannerSession, setScannerSession] = useState<ScannerSession | null>(null);
  const [sessionDraft, setSessionDraft] = useState({
    staffName: '',
    gate: 'Fundraiser Check-In',
    deviceLabel: ''
  });
  const [sessionBusy, setSessionBusy] = useState(false);
  const [checkInBusyTicketId, setCheckInBusyTicketId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [qrOrderId, setQrOrderId] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrLink, setQrLink] = useState('');
  const [qrBusy, setQrBusy] = useState(false);

  const sessionReady = Boolean(scannerSession && scannerSession.performanceId === performanceId);

  async function loadEvents() {
    const items = await adminFetch<FundraiseEvent[]>('/api/admin/performances?scope=active&kind=fundraise');
    setEvents(items);
    if (items.length === 0) {
      setPerformanceId('');
      return;
    }

    setPerformanceId((current) => {
      if (items.some((item) => item.id === current)) return current;
      return items[0].id;
    });
  }

  async function loadRows(nextPerformanceId: string) {
    if (!nextPerformanceId) {
      setRows([]);
      setSummary(null);
      return;
    }

    const data = await adminFetch<AttendeeFeed>(
      `/api/admin/fundraising/events/${encodeURIComponent(nextPerformanceId)}/attendees`
    );
    setRows(Array.isArray(data.rows) ? data.rows : []);
    setSummary(data.summary || null);
  }

  async function loadAll(nextPerformanceId: string, showSpinner = true) {
    if (showSpinner) setRefreshing(true);
    setError(null);
    try {
      await loadRows(nextPerformanceId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load fundraiser attendee roster');
      setRows([]);
      setSummary(null);
    } finally {
      if (showSpinner) setRefreshing(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        await loadEvents();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load fundraiser events');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!performanceId) return;
    setNotice(null);
    void loadAll(performanceId, true);

    const stored = readStoredScannerSessions()[performanceId];
    setScannerSession(stored || null);
  }, [performanceId]);

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;

    return rows.filter((row) => {
      if (
        row.customerName.toLowerCase().includes(needle) ||
        row.email.toLowerCase().includes(needle) ||
        row.id.toLowerCase().includes(needle)
      ) {
        return true;
      }

      return row.orderSeats.some((seat) =>
        [seat.attendeeName || '', seat.seatLabel, seat.ticketPublicId || ''].some((value) =>
          value.toLowerCase().includes(needle)
        )
      );
    });
  }, [rows, search]);

  const flattenSeatCount = useMemo(
    () => filteredRows.reduce((sum, row) => sum + row.orderSeats.length, 0),
    [filteredRows]
  );

  async function startScannerSession(event: FormEvent) {
    event.preventDefault();
    if (!performanceId) return;
    setSessionBusy(true);
    setNotice(null);
    try {
      const nextSession = await adminFetch<ScannerSession>('/api/admin/check-in/session/start', {
        method: 'POST',
        body: JSON.stringify({
          performanceId,
          staffName: sessionDraft.staffName.trim(),
          gate: sessionDraft.gate.trim(),
          deviceLabel: sessionDraft.deviceLabel.trim() || undefined
        })
      });
      setScannerSession(nextSession);
      persistScannerSessionForPerformance(nextSession.performanceId, nextSession);
      setNotice({ kind: 'ok', text: 'Check-in session started.' });
    } catch (err) {
      setNotice({ kind: 'err', text: err instanceof Error ? err.message : 'Failed to start session' });
    } finally {
      setSessionBusy(false);
    }
  }

  async function endScannerSession() {
    if (!scannerSession) return;
    setSessionBusy(true);
    setNotice(null);
    try {
      await adminFetch('/api/admin/check-in/session/end', {
        method: 'POST',
        body: JSON.stringify({ sessionToken: scannerSession.sessionToken })
      });
      persistScannerSessionForPerformance(scannerSession.performanceId, null);
      setScannerSession(null);
      setNotice({ kind: 'ok', text: 'Check-in session ended.' });
    } catch (err) {
      setNotice({ kind: 'err', text: err instanceof Error ? err.message : 'Failed to end session' });
    } finally {
      setSessionBusy(false);
    }
  }

  async function checkInByTicketPublicId(ticket: TicketRow) {
    if (!ticket.ticketPublicId || !scannerSession || !sessionReady || !performanceId) return;
    setCheckInBusyTicketId(ticket.ticketId || ticket.ticketPublicId);
    setNotice(null);

    try {
      const result = await adminFetch<ScanResponse>('/api/admin/check-in/scan', {
        method: 'POST',
        body: JSON.stringify({
          performanceId,
          sessionToken: scannerSession.sessionToken,
          scannedValue: ticket.ticketPublicId,
          clientScanId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
        })
      });
      setNotice({
        kind: result.outcome === 'VALID' || result.outcome === 'ALREADY_CHECKED_IN' ? 'ok' : 'err',
        text: result.message
      });
      await loadAll(performanceId, false);
    } catch (err) {
      setNotice({ kind: 'err', text: err instanceof Error ? err.message : 'Check-in failed' });
    } finally {
      setCheckInBusyTicketId(null);
    }
  }

  function openCashierFallback() {
    if (!performanceId) return;
    writeCashierDefaultPerformanceId(performanceId);
    navigate('/admin/orders');
  }

  function openCashierForOrder(row: AttendeeOrderRow) {
    if (!performanceId) return;
    writeCashierDefaultPerformanceId(performanceId);
    const params = new URLSearchParams({
      cashier: '1',
      performanceId,
      customerName: row.customerName,
      customerEmail: row.email,
      sourceOrderId: row.id
    });
    navigate(`/admin/orders?${params.toString()}`);
  }

  async function showQuestionnaireQr(order: AttendeeOrderRow) {
    setQrOrderId(order.id);
    setQrBusy(true);
    setQrDataUrl(null);

    const link = `${window.location.origin}/fundraising/questionnaire?orderId=${encodeURIComponent(order.id)}&token=${encodeURIComponent(order.accessToken)}`;
    setQrLink(link);

    try {
      const dataUrl = await toQrCodeDataUrl(link, 320);
      setQrDataUrl(dataUrl);
    } catch {
      setQrDataUrl(null);
    } finally {
      setQrBusy(false);
    }
  }

  useEffect(() => {
    if (!sessionDraft.staffName && scannerSession?.staffName) {
      setSessionDraft((current) => ({ ...current, staffName: scannerSession.staffName }));
    }
  }, [scannerSession?.staffName, sessionDraft.staffName]);

  return (
    <div className="min-h-screen bg-stone-50 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-7xl space-y-6">
        <header className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-stone-500">Fundraise</p>
              <h1 className="mt-1 text-2xl font-black text-stone-900">Fundraiser Check-In</h1>
              <p className="mt-1 text-sm text-stone-500">
                Check in paid guests, issue questionnaire QR links, and jump to full cashier checkout for walk-ups.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void loadAll(performanceId, true)}
                disabled={!performanceId || refreshing}
                className="inline-flex items-center gap-2 rounded-xl border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-700 transition hover:bg-stone-100 disabled:opacity-60"
              >
                <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh
              </button>
              <button
                type="button"
                onClick={openCashierFallback}
                disabled={!performanceId}
                className="inline-flex items-center gap-2 rounded-xl bg-stone-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-stone-800 disabled:opacity-60"
              >
                <CreditCard className="h-4 w-4" />
                Buy Ticket (Cashier)
              </button>
            </div>
          </div>
        </header>

        <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm xl:col-span-2">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <label className="block md:col-span-2">
                <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-stone-500">Fundraiser Event</span>
                <select
                  value={performanceId}
                  onChange={(event) => setPerformanceId(event.target.value)}
                  className={inputClass}
                  disabled={loading || events.length === 0}
                >
                  {events.map((event) => (
                    <option key={event.id} value={event.id}>
                      {event.title} - {new Date(event.startsAt).toLocaleString()}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-stone-500">Search Roster</span>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Buyer, attendee, ticket ID"
                    className={`${inputClass} pl-9`}
                  />
                </div>
              </label>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-stone-500">Orders</p>
                <p className="mt-1 text-2xl font-black text-stone-900">{summary?.orderCount ?? rows.length}</p>
              </div>
              <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-stone-500">Tickets</p>
                <p className="mt-1 text-2xl font-black text-stone-900">{summary?.ticketCount ?? flattenSeatCount}</p>
              </div>
              <div className="rounded-xl border border-stone-200 bg-stone-50 p-3">
                <p className="text-xs font-bold uppercase tracking-wide text-stone-500">Questionnaires</p>
                <p className="mt-1 text-2xl font-black text-stone-900">{summary?.responseCount ?? 0}</p>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-bold uppercase tracking-widest text-stone-500">Check-In Session</p>
            {!sessionReady ? (
              <form className="mt-3 space-y-3" onSubmit={startScannerSession}>
                <input
                  value={sessionDraft.staffName}
                  onChange={(event) => setSessionDraft((current) => ({ ...current, staffName: event.target.value }))}
                  placeholder="Staff name"
                  className={inputClass}
                  required
                />
                <input
                  value={sessionDraft.gate}
                  onChange={(event) => setSessionDraft((current) => ({ ...current, gate: event.target.value }))}
                  placeholder="Gate"
                  className={inputClass}
                  required
                />
                <input
                  value={sessionDraft.deviceLabel}
                  onChange={(event) => setSessionDraft((current) => ({ ...current, deviceLabel: event.target.value }))}
                  placeholder="Device label (optional)"
                  className={inputClass}
                />
                <button
                  type="submit"
                  disabled={sessionBusy || !performanceId}
                  className="inline-flex w-full items-center justify-center rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-stone-800 disabled:opacity-60"
                >
                  {sessionBusy ? 'Starting...' : 'Start Session'}
                </button>
              </form>
            ) : (
              <div className="mt-3 space-y-3">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                  <p className="text-sm font-bold text-emerald-800">{scannerSession?.staffName} - {scannerSession?.gate}</p>
                  <p className="mt-1 text-xs text-emerald-700">Session started {scannerSession ? new Date(scannerSession.createdAt).toLocaleTimeString() : ''}</p>
                </div>
                <button
                  type="button"
                  disabled={sessionBusy}
                  onClick={() => void endScannerSession()}
                  className="inline-flex w-full items-center justify-center rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 transition hover:bg-stone-100 disabled:opacity-60"
                >
                  {sessionBusy ? 'Ending...' : 'End Session'}
                </button>
                <Link
                  to="/admin/scanner"
                  className="inline-flex w-full items-center justify-center rounded-xl border border-stone-300 bg-white px-4 py-2.5 text-sm font-semibold text-stone-700 transition hover:bg-stone-100"
                >
                  Open Full Scanner
                </Link>
              </div>
            )}
          </div>
        </section>

        {notice ? (
          <div
            className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm font-semibold ${
              notice.kind === 'ok'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-red-200 bg-red-50 text-red-700'
            }`}
          >
            {notice.kind === 'ok' ? <CheckCircle2 className="mt-0.5 h-4 w-4" /> : <AlertCircle className="mt-0.5 h-4 w-4" />}
            <span>{notice.text}</span>
          </div>
        ) : null}

        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>
        ) : null}

        <section className="space-y-4">
          {loading ? <p className="text-sm text-stone-500">Loading fundraiser events...</p> : null}

          {!loading && filteredRows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-10 text-center text-sm text-stone-500">
              No matching attendees found.
            </div>
          ) : null}

          {filteredRows.map((row) => (
            <article key={row.id} className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="flex flex-col gap-3 border-b border-stone-100 pb-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-base font-black text-stone-900">{row.customerName}</p>
                  <p className="text-sm text-stone-500">{row.email}</p>
                  <p className="mt-1 text-xs text-stone-400">
                    Order {row.id.slice(0, 10)} - {formatMoney(row.amountTotal, row.currency)} - {new Date(row.createdAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void showQuestionnaireQr(row)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-stone-700 transition hover:bg-stone-100"
                  >
                    <QrCode className="h-3.5 w-3.5" />
                    Questionnaire QR
                  </button>
                  <a
                    href={`/fundraising/questionnaire?orderId=${encodeURIComponent(row.id)}&token=${encodeURIComponent(row.accessToken)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-stone-700 transition hover:bg-stone-100"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open Form
                  </a>
                  <button
                    type="button"
                    onClick={() => openCashierForOrder(row)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 py-2 text-xs font-semibold text-stone-700 transition hover:bg-stone-100"
                  >
                    <CreditCard className="h-3.5 w-3.5" />
                    Convert to Walk-Up Sale
                  </button>
                  <span
                    className={`inline-flex items-center rounded-lg px-3 py-2 text-xs font-bold ${
                      row.registrationSubmission ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {row.registrationSubmission ? 'Questionnaire submitted' : 'Questionnaire pending'}
                  </span>
                </div>
              </div>

              <div className="mt-4 space-y-2">
                {row.orderSeats.map((seat, seatIndex) => {
                  const busy = checkInBusyTicketId === (seat.ticketId || seat.ticketPublicId || `${row.id}-${seatIndex}`);
                  const checkedIn = Boolean(seat.checkedInAt);

                  return (
                    <div key={`${row.id}-${seat.ticketId || seatIndex}`} className="rounded-xl border border-stone-200 bg-stone-50 p-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-sm font-bold text-stone-900">
                            {seat.attendeeName || row.customerName} - {seat.seatLabel}
                          </p>
                          <p className="text-xs text-stone-500">
                            Ticket {seat.ticketPublicId || 'N/A'}
                            {seat.ticketType ? ` - ${seat.ticketType}` : ''}
                            {seat.isComplimentary ? ' - Complimentary' : ''}
                          </p>
                          {checkedIn ? (
                            <p className="mt-1 text-xs font-semibold text-emerald-700">
                              Checked in {new Date(seat.checkedInAt as string).toLocaleString()}
                              {seat.checkInGate ? ` at ${seat.checkInGate}` : ''}
                            </p>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          disabled={!seat.ticketPublicId || !sessionReady || checkedIn || busy}
                          onClick={() => void checkInByTicketPublicId(seat)}
                          className="inline-flex items-center justify-center rounded-lg bg-stone-900 px-3 py-2 text-xs font-bold text-white transition hover:bg-stone-800 disabled:opacity-60"
                        >
                          {busy ? 'Checking...' : checkedIn ? 'Checked In' : 'Check In'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </article>
          ))}
        </section>
      </div>

      {qrOrderId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <h2 className="text-lg font-black text-stone-900">Questionnaire QR</h2>
            <p className="mt-1 text-sm text-stone-500">Order {qrOrderId.slice(0, 10)}</p>

            <div className="mt-4 flex min-h-[220px] items-center justify-center rounded-xl border border-stone-200 bg-stone-50 p-4">
              {qrBusy ? (
                <p className="text-sm text-stone-500">Generating QR...</p>
              ) : qrDataUrl ? (
                <img src={qrDataUrl} alt="Questionnaire QR code" className="h-56 w-56 rounded bg-white p-2" />
              ) : (
                <p className="text-sm text-red-600">Could not generate QR code.</p>
              )}
            </div>

            <div className="mt-4">
              <p className="mb-1 text-xs font-bold uppercase tracking-wide text-stone-500">Link</p>
              <textarea readOnly value={qrLink} className={`${inputClass} min-h-[72px] resize-none`} />
            </div>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setQrOrderId(null);
                  setQrDataUrl(null);
                  setQrLink('');
                }}
                className="inline-flex flex-1 items-center justify-center rounded-xl border border-stone-300 bg-white px-4 py-2 text-sm font-semibold text-stone-700 transition hover:bg-stone-100"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => void navigator.clipboard.writeText(qrLink)}
                className="inline-flex flex-1 items-center justify-center rounded-xl bg-stone-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-stone-800"
              >
                Copy Link
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
