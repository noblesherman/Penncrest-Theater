import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminFetch, getAdminToken } from '../../lib/adminAuth';
import { createAdminQrScanner, detectQrCameraSupport } from '../../lib/adminQrScanner';
import { apiUrl } from '../../lib/api';

type PerformanceRow = {
  id: string;
  title: string;
  startsAt: string;
  isArchived?: boolean;
};

type ScanOutcome =
  | 'VALID'
  | 'ALREADY_CHECKED_IN'
  | 'WRONG_PERFORMANCE'
  | 'NOT_ADMITTED'
  | 'INVALID_QR'
  | 'NOT_FOUND';

type ReasonCode =
  | 'DUPLICATE_SCAN'
  | 'VIP_OVERRIDE'
  | 'PAYMENT_EXCEPTION'
  | 'INVALID_TICKET'
  | 'SAFETY_CONCERN'
  | 'MANUAL_CORRECTION'
  | 'OTHER';

type ScannedTicket = {
  id: string;
  publicId: string;
  performanceId: string;
  performanceTitle: string;
  startsAt: string;
  venue: string;
  seat: {
    sectionName: string;
    row: string;
    number: number;
  };
  holder: {
    customerName: string;
    customerEmail: string;
  };
  order: {
    id: string;
    status: string;
  };
  checkedInAt: string | null;
  checkedInBy: string | null;
  checkInGate: string | null;
  admissionDecision: 'FORCE_ADMIT' | 'DENY' | null;
  admissionReason: string | null;
};

type ScanResponse = {
  outcome: ScanOutcome;
  message: string;
  scannedAt: string;
  ticket?: ScannedTicket;
};

type ScanHistoryItem = ScanResponse & { id: string };

type ScannerSession = {
  sessionId: string;
  sessionToken: string;
  performanceId: string;
  staffName: string;
  gate: string;
  deviceLabel: string | null;
  createdAt: string;
};

type CheckInSummary = {
  performance: {
    id: string;
    title: string;
    startsAt: string;
    venue: string;
  };
  totalCheckedIn: number;
  totalAdmittable: number;
  deniedCount: number;
  forceAdmitCount: number;
  gateBreakdown: Array<{ gate: string; count: number }>;
  activeSessions: Array<{
    id: string;
    staffName: string;
    gate: string;
    deviceLabel: string | null;
    startedAt: string;
    lastSeenAt: string;
  }>;
  recent: Array<{
    id: string;
    publicId: string;
    checkedInAt: string | null;
    checkedInBy: string | null;
    checkInGate: string;
    seat: {
      sectionName: string;
      row: string;
      number: number;
    };
    holder: {
      customerName: string;
      customerEmail: string;
    };
  }>;
};

type UndoResponse = {
  success: boolean;
  message: string;
  ticket?: ScannedTicket;
};

type LookupResult = ScannedTicket & {
  ticketStatus: string;
  ticketType: string;
  createdAt: string;
};

type TimelineResponse = {
  page: number;
  pageSize: number;
  total: number;
  rows: Array<{
    id: string;
    action: string;
    actor: string;
    entityId: string;
    createdAt: string;
    metadata: unknown;
  }>;
};

type AnalyticsResponse = {
  performance: {
    id: string;
    title: string;
    startsAt: string;
    venue: string;
  };
  totals: {
    totalAdmittable: number;
    totalCheckedIn: number;
    noShowEstimate: number;
    checkInRate: number;
  };
  attempts: {
    duplicateAttempts: number;
    invalidQrAttempts: number;
    notFoundAttempts: number;
    wrongPerformanceAttempts: number;
    notAdmittedAttempts: number;
    fraudAttemptEstimate: number;
  };
  supervisorDecisions: {
    forceAdmitCount: number;
    denyCount: number;
  };
  peakPerMinute: number;
  byGate: Array<{ gate: string; count: number }>;
  timeline: Array<{ minute: string; count: number }>;
};

type OfflineQueueItem = {
  id: string;
  performanceId: string;
  sessionToken: string;
  scannedValue: string;
  clientScanId: string;
  queuedAt: string;
};

const SESSION_STORAGE_KEY = 'theater_scanner_sessions_v1';
const OFFLINE_QUEUE_KEY = 'theater_scanner_queue_v1';
const reasonOptions: Array<{ value: ReasonCode; label: string }> = [
  { value: 'DUPLICATE_SCAN', label: 'Duplicate scan' },
  { value: 'VIP_OVERRIDE', label: 'VIP override' },
  { value: 'PAYMENT_EXCEPTION', label: 'Payment exception' },
  { value: 'INVALID_TICKET', label: 'Invalid ticket' },
  { value: 'SAFETY_CONCERN', label: 'Safety concern' },
  { value: 'MANUAL_CORRECTION', label: 'Manual correction' },
  { value: 'OTHER', label: 'Other' }
];

const outcomeConfig: Record<ScanOutcome, { bg: string; border: string; text: string; label: string; icon: string }> = {
  VALID:              { bg: 'bg-emerald-950', border: 'border-emerald-500', text: 'text-emerald-300', label: 'ADMITTED', icon: '✓' },
  ALREADY_CHECKED_IN: { bg: 'bg-amber-950',   border: 'border-amber-500',   text: 'text-amber-300',   label: 'ALREADY IN',  icon: '!' },
  WRONG_PERFORMANCE:  { bg: 'bg-orange-950',  border: 'border-orange-500',  text: 'text-orange-300',  label: 'WRONG SHOW',  icon: '✕' },
  NOT_ADMITTED:       { bg: 'bg-red-950',     border: 'border-red-500',     text: 'text-red-300',     label: 'DENIED',      icon: '✕' },
  INVALID_QR:         { bg: 'bg-red-950',     border: 'border-red-500',     text: 'text-red-300',     label: 'INVALID QR',  icon: '✕' },
  NOT_FOUND:          { bg: 'bg-red-950',     border: 'border-red-500',     text: 'text-red-300',     label: 'NOT FOUND',   icon: '✕' },
};

function makeClientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function parseJsonSafe<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function readStoredSessions(): Record<string, ScannerSession> {
  return parseJsonSafe<Record<string, ScannerSession>>(localStorage.getItem(SESSION_STORAGE_KEY), {});
}

function writeStoredSessions(sessions: Record<string, ScannerSession>): void {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessions));
}

function readOfflineQueue(): OfflineQueueItem[] {
  return parseJsonSafe<OfflineQueueItem[]>(localStorage.getItem(OFFLINE_QUEUE_KEY), []);
}

function writeOfflineQueue(items: OfflineQueueItem[]): void {
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(items));
}

function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes('failed to fetch') || msg.includes('network') || msg.includes('load failed');
}

function vibrate(pattern: number | number[]) {
  try { navigator.vibrate?.(pattern); } catch { }
}

function beep(success: boolean) {
  try {
    const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = success ? 900 : 260;
    gain.gain.value = success ? 0.08 : 0.12;
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + (success ? 0.08 : 0.15));
    oscillator.onended = () => { void ctx.close(); };
  } catch { }
}

export default function AdminScannerPage() {
  const [performances, setPerformances] = useState<PerformanceRow[]>([]);
  const [performanceId, setPerformanceId] = useState('');
  const [sessionDraft, setSessionDraft] = useState({ staffName: '', gate: 'Main Entrance', deviceLabel: '' });
  const [scannerSession, setScannerSession] = useState<ScannerSession | null>(null);
  const [manualValue, setManualValue] = useState('');
  const [lookupQuery, setLookupQuery] = useState('');
  const [lookupRows, setLookupRows] = useState<LookupResult[]>([]);
  const [reasonCode, setReasonCode] = useState<ReasonCode>('MANUAL_CORRECTION');
  const [reasonNotes, setReasonNotes] = useState('');
  const [cameraSupported, setCameraSupported] = useState(false);
  const [cameraRunning, setCameraRunning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lookupBusyTicketId, setLookupBusyTicketId] = useState<string | null>(null);
  const [undoBusyTicketId, setUndoBusyTicketId] = useState<string | null>(null);
  const [summary, setSummary] = useState<CheckInSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<TimelineResponse | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [lastResult, setLastResult] = useState<ScanResponse | null>(null);
  const [history, setHistory] = useState<ScanHistoryItem[]>([]);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [offlineQueue, setOfflineQueue] = useState<OfflineQueueItem[]>([]);
  const [isSyncingOffline, setIsSyncingOffline] = useState(false);
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);
  const [isExportingCsv, setIsExportingCsv] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hardwareInputRef = useRef<HTMLInputElement | null>(null);
  const scannerRef = useRef<ReturnType<typeof createAdminQrScanner> | null>(null);
  const scanBusyRef = useRef(false);
  const lastScannedRef = useRef<{ value: string; at: number } | null>(null);
  const hardwareBufferRef = useRef('');
  const hardwareClearTimerRef = useRef<number | null>(null);

  const selectedPerformance = useMemo(
    () => performances.find((p) => p.id === performanceId),
    [performances, performanceId]
  );

  const sessionReady = Boolean(scannerSession && scannerSession.performanceId === performanceId);
  const checkInPct = summary && summary.totalAdmittable > 0
    ? Math.min(100, Math.round((summary.totalCheckedIn / summary.totalAdmittable) * 100))
    : 0;

  const stopCamera = () => {
    scannerRef.current?.stop();
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraRunning(false);
  };

  const loadSummary = async (pid = performanceId) => {
    if (!pid) { setSummary(null); return; }
    try {
      const next = await adminFetch<CheckInSummary>(`/api/admin/check-in/summary?performanceId=${pid}`);
      setSummary(next); setSummaryError(null);
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : 'Failed to load check-in summary');
    }
  };

  const loadTimeline = async (pid = performanceId) => {
    if (!pid) { setTimeline(null); return; }
    try {
      const next = await adminFetch<TimelineResponse>(`/api/admin/check-in/timeline?performanceId=${pid}&page=1&pageSize=100`);
      setTimeline(next);
    } catch { }
  };

  const loadAnalytics = async (pid = performanceId) => {
    if (!pid) { setAnalytics(null); return; }
    try {
      const next = await adminFetch<AnalyticsResponse>(`/api/admin/check-in/analytics?performanceId=${pid}`);
      setAnalytics(next);
    } catch { }
  };

  const pushHistory = (result: ScanResponse) => {
    setHistory((c) => [{ ...result, id: makeClientId() }, ...c].slice(0, 30));
  };

  const patchTicketInHistory = (ticket: ScannedTicket) => {
    setLastResult((c) => (!c?.ticket || c.ticket.id !== ticket.id) ? c : { ...c, ticket });
    setHistory((c) => c.map((row) => (!row.ticket || row.ticket.id !== ticket.id) ? row : { ...row, ticket }));
  };

  const patchLookupTicket = (ticket: ScannedTicket) => {
    setLookupRows((rows) => rows.map((row) => row.id === ticket.id ? { ...row, ...ticket } : row));
  };

  const applyFeedback = (outcome: ScanOutcome) => {
    const success = outcome === 'VALID';
    vibrate(success ? 50 : [80, 30, 80]);
    beep(success);
  };

  const persistSession = (session: ScannerSession | null) => {
    const sessions = readStoredSessions();
    if (!session) delete sessions[performanceId];
    else sessions[session.performanceId] = session;
    writeStoredSessions(sessions);
  };

  const enqueueOfflineScan = (item: Omit<OfflineQueueItem, 'id' | 'queuedAt'>) => {
    const queueItem: OfflineQueueItem = { id: makeClientId(), queuedAt: new Date().toISOString(), ...item };
    const next = [...readOfflineQueue(), queueItem];
    writeOfflineQueue(next);
    setOfflineQueue(next);
    setNotice({ kind: 'error', text: `Offline: queued scan (${next.length} pending).` });
  };

  const sendScanRequest = async (params: {
    scannedValue: string; clientScanId?: string; offlineQueuedAt?: string;
    performanceIdOverride?: string; sessionTokenOverride?: string;
  }) => {
    if (!sessionReady && !params.sessionTokenOverride) throw new Error('Start a scanner session before scanning.');
    return adminFetch<ScanResponse>('/api/admin/check-in/scan', {
      method: 'POST',
      body: JSON.stringify({
        performanceId: params.performanceIdOverride || performanceId,
        sessionToken: params.sessionTokenOverride || scannerSession!.sessionToken,
        scannedValue: params.scannedValue,
        clientScanId: params.clientScanId || makeClientId(),
        offlineQueuedAt: params.offlineQueuedAt
      })
    });
  };

  const submitScan = async (scannedValue: string) => {
    if (!performanceId || !sessionReady) { setNotice({ kind: 'error', text: 'Start a scanner session first.' }); return; }
    scanBusyRef.current = true;
    setBusy(true);
    setNotice(null);
    const clientScanId = makeClientId();
    try {
      if (!navigator.onLine) { enqueueOfflineScan({ performanceId, sessionToken: scannerSession!.sessionToken, scannedValue, clientScanId }); return; }
      const result = await sendScanRequest({ scannedValue, clientScanId });
      setLastResult(result);
      pushHistory(result);
      if (result.ticket) patchLookupTicket(result.ticket);
      applyFeedback(result.outcome);
      await Promise.all([loadSummary(), loadTimeline(), loadAnalytics()]);
    } catch (err) {
      if (isNetworkError(err)) {
        enqueueOfflineScan({ performanceId, sessionToken: scannerSession!.sessionToken, scannedValue, clientScanId });
      } else {
        const fallback: ScanResponse = { outcome: 'INVALID_QR', message: err instanceof Error ? err.message : 'Scan failed', scannedAt: new Date().toISOString() };
        setLastResult(fallback); pushHistory(fallback); applyFeedback(fallback.outcome);
      }
    } finally {
      setBusy(false); scanBusyRef.current = false;
    }
  };

  const syncOfflineQueue = async () => {
    if (isSyncingOffline) return;
    const currentQueue = readOfflineQueue();
    if (currentQueue.length === 0) return;
    setIsSyncingOffline(true);
    try {
      const storedSessions = readStoredSessions();
      const remaining: OfflineQueueItem[] = [];
      let blockedMessage: string | null = null;
      for (let i = 0; i < currentQueue.length; i++) {
        const item = currentQueue[i];
        const fallbackToken = (item.performanceId === performanceId && scannerSession?.performanceId === item.performanceId ? scannerSession.sessionToken : storedSessions[item.performanceId]?.sessionToken) || item.sessionToken;
        try {
          const result = await sendScanRequest({ scannedValue: item.scannedValue, clientScanId: item.clientScanId, offlineQueuedAt: item.queuedAt, performanceIdOverride: item.performanceId, sessionTokenOverride: fallbackToken });
          setLastResult(result); pushHistory(result); applyFeedback(result.outcome);
        } catch (err) {
          if (isNetworkError(err)) { remaining.push(item, ...currentQueue.slice(i + 1)); break; }
          const msg = err instanceof Error ? err.message.toLowerCase() : '';
          if (msg.includes('session is not active') || msg.includes('unauthorized') || msg.includes('forbidden')) {
            remaining.push(item, ...currentQueue.slice(i + 1));
            blockedMessage = 'Offline sync paused: start an active scanner session and try again.'; break;
          }
        }
      }
      writeOfflineQueue(remaining); setOfflineQueue(remaining);
      if (remaining.length === 0) setNotice({ kind: 'success', text: 'Offline queue synced.' });
      else if (blockedMessage) setNotice({ kind: 'error', text: blockedMessage });
      else setNotice({ kind: 'error', text: `${remaining.length} scan(s) still queued.` });
      await Promise.all([loadSummary(), loadTimeline(), loadAnalytics()]);
    } finally { setIsSyncingOffline(false); }
  };

  const startSession = async (e: FormEvent) => {
    e.preventDefault();
    if (!performanceId) return;
    try {
      const session = await adminFetch<ScannerSession>('/api/admin/check-in/session/start', {
        method: 'POST',
        body: JSON.stringify({ performanceId, staffName: sessionDraft.staffName.trim(), gate: sessionDraft.gate.trim(), deviceLabel: sessionDraft.deviceLabel.trim() || undefined })
      });
      setScannerSession(session);
      setSessionDraft((c) => ({ ...c, gate: session.gate }));
      persistSession(session);
      setNotice({ kind: 'success', text: `Session started for ${session.staffName} (${session.gate}).` });
      await Promise.all([loadSummary(), loadTimeline(), loadAnalytics()]);
    } catch (err) { setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Failed to start session' }); }
  };

  const endSession = async () => {
    if (!scannerSession) return;
    try {
      await adminFetch('/api/admin/check-in/session/end', { method: 'POST', body: JSON.stringify({ sessionToken: scannerSession.sessionToken }) });
      setScannerSession(null); persistSession(null);
      setNotice({ kind: 'success', text: 'Scanner session ended.' });
    } catch (err) { setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Failed to end session' }); }
  };

  const undoCheckIn = async (ticket: ScannedTicket) => {
    if (!performanceId || !sessionReady) return;
    setUndoBusyTicketId(ticket.id); setNotice(null);
    try {
      const result = await adminFetch<UndoResponse>('/api/admin/check-in/undo', {
        method: 'POST',
        body: JSON.stringify({ performanceId, sessionToken: scannerSession!.sessionToken, ticketId: ticket.id, reasonCode, notes: reasonNotes.trim() || undefined })
      });
      setNotice({ kind: result.success ? 'success' : 'error', text: result.message });
      if (result.ticket) { patchTicketInHistory(result.ticket); patchLookupTicket(result.ticket); }
      await Promise.all([loadSummary(), loadTimeline(), loadAnalytics()]);
    } catch (err) { setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Failed to undo check-in' }); }
    finally { setUndoBusyTicketId(null); }
  };

  const applySupervisorDecision = async (ticket: LookupResult, decision: 'FORCE_ADMIT' | 'DENY') => {
    if (!performanceId || !sessionReady) { setNotice({ kind: 'error', text: 'Start a scanner session first.' }); return; }
    setUndoBusyTicketId(ticket.id); setNotice(null);
    try {
      const result = await adminFetch<{ success: boolean; message: string; ticket?: ScannedTicket }>('/api/admin/check-in/force-decision', {
        method: 'POST',
        body: JSON.stringify({ performanceId, sessionToken: scannerSession!.sessionToken, ticketId: ticket.id, decision, reasonCode, notes: reasonNotes.trim() || undefined })
      });
      setNotice({ kind: 'success', text: result.message });
      if (result.ticket) { patchTicketInHistory(result.ticket); patchLookupTicket(result.ticket); }
      await Promise.all([loadSummary(), loadTimeline(), loadAnalytics()]);
    } catch (err) { setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Failed to apply decision' }); }
    finally { setUndoBusyTicketId(null); }
  };

  const checkInLookupTicket = async (ticket: LookupResult) => {
    if (busy || lookupBusyTicketId) return;
    setLookupBusyTicketId(ticket.id);
    try { await submitScan(ticket.publicId); } finally { setLookupBusyTicketId(null); }
  };

  const searchLookup = async (e: FormEvent) => {
    e.preventDefault();
    if (!performanceId || !lookupQuery.trim()) return;
    try {
      const rows = await adminFetch<LookupResult[]>(`/api/admin/check-in/lookup?performanceId=${performanceId}&q=${encodeURIComponent(lookupQuery.trim())}&limit=40`);
      setLookupRows(rows);
    } catch (err) { setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Lookup failed' }); }
  };

  const exportAnalyticsCsv = async () => {
    if (!performanceId || isExportingCsv) return;
    const token = getAdminToken();
    if (!token) { setNotice({ kind: 'error', text: 'Admin session expired. Log in again.' }); return; }
    setIsExportingCsv(true); setNotice(null);
    try {
      const response = await fetch(apiUrl(`/api/admin/check-in/analytics.csv?performanceId=${encodeURIComponent(performanceId)}`), { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) {
        const ct = response.headers.get('content-type') || '';
        let message = `CSV export failed (${response.status})`;
        if (ct.includes('application/json')) { const b = (await response.json().catch(() => null)) as { error?: string } | null; if (b?.error) message = b.error; }
        throw new Error(message);
      }
      const blob = await response.blob();
      const disp = response.headers.get('content-disposition') || '';
      const nm = disp.match(/filename="([^"]+)"/i);
      const filename = nm?.[1] || `checkin-analytics-${performanceId}.csv`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      setNotice({ kind: 'success', text: 'Analytics CSV downloaded.' });
    } catch (err) { setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Failed to export CSV' }); }
    finally { setIsExportingCsv(false); }
  };

  const startCamera = async () => {
    setCameraError(null);
    if (cameraRunning) return;
    if (!sessionReady) { setCameraError('Start a scanner session first.'); return; }
    if (!cameraSupported) { setCameraError('Camera scanning is not supported on this browser.'); return; }
    try {
      const orientation = (screen as any).orientation;
      await orientation?.lock?.('portrait').catch(() => Promise.resolve());
    } catch { }
    try {
      const video = videoRef.current;
      if (!video) throw new Error('Camera preview failed to initialize');
      if (!scannerRef.current) {
        scannerRef.current = createAdminQrScanner({
          video,
          onDecode: (val) => {
            if (scanBusyRef.current) return;
            const now = Date.now(); const last = lastScannedRef.current;
            if (last && last.value === val && now - last.at < 1500) return;
            lastScannedRef.current = { value: val, at: now };
            void submitScan(val);
          }
        });
      }
      await scannerRef.current.start();
      setCameraRunning(true);
    } catch (err) { stopCamera(); setCameraError(err instanceof Error ? err.message : 'Unable to access camera'); }
  };

  useEffect(() => {
    setOfflineQueue(readOfflineQueue());
    let cancelled = false;
    void detectQrCameraSupport().then((supported) => { if (!cancelled) setCameraSupported(supported); });
    adminFetch<PerformanceRow[]>('/api/admin/performances?scope=active')
      .then((rows) => {
        const active = rows.filter((r) => !r.isArchived);
        setPerformances(active);
        if (active.length > 0) setPerformanceId(active[0].id);
      })
      .catch((err) => { setCameraError(err instanceof Error ? err.message : 'Failed to load performances'); });
    const onlineHandler = () => { void syncOfflineQueue(); };
    window.addEventListener('online', onlineHandler);
    return () => { cancelled = true; stopCamera(); scannerRef.current?.destroy(); scannerRef.current = null; window.removeEventListener('online', onlineHandler); };
  }, []);

  useEffect(() => {
    if (!performanceId) return;
    const stored = readStoredSessions()[performanceId];
    setScannerSession(stored || null);
    if (stored) setSessionDraft((c) => ({ ...c, staffName: stored.staffName, gate: stored.gate }));
    setLastResult(null); setHistory([]); setLookupRows([]); setLookupQuery(''); setNotice(null);
    void Promise.all([loadSummary(performanceId), loadTimeline(performanceId), loadAnalytics(performanceId)]);
  }, [performanceId]);

  useEffect(() => {
    const token = getAdminToken();
    if (!token || !performanceId || !sessionReady) { setIsRealtimeConnected(false); return; }
    const source = new EventSource(apiUrl(`/api/admin/check-in/events?performanceId=${encodeURIComponent(performanceId)}&token=${encodeURIComponent(token)}`));
    source.onopen = () => setIsRealtimeConnected(true);
    source.onerror = () => setIsRealtimeConnected(false);
    source.addEventListener('checkin', () => { void Promise.all([loadSummary(performanceId), loadTimeline(performanceId), loadAnalytics(performanceId)]); });
    source.addEventListener('decision', () => { void Promise.all([loadSummary(performanceId), loadTimeline(performanceId), loadAnalytics(performanceId)]); });
    source.addEventListener('session', () => { void loadSummary(performanceId); });
    return () => { source.close(); setIsRealtimeConnected(false); };
  }, [performanceId, sessionReady]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!sessionReady) return;
      const target = e.target as HTMLElement | null;
      const editable = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.getAttribute('contenteditable') === 'true';
      if (editable) return;
      if (e.key === 'Enter') {
        const value = hardwareBufferRef.current.trim();
        hardwareBufferRef.current = '';
        if (hardwareClearTimerRef.current) { window.clearTimeout(hardwareClearTimerRef.current); hardwareClearTimerRef.current = null; }
        if (value) void submitScan(value);
        return;
      }
      if (e.key.length === 1) {
        hardwareBufferRef.current += e.key;
        if (hardwareClearTimerRef.current) window.clearTimeout(hardwareClearTimerRef.current);
        hardwareClearTimerRef.current = window.setTimeout(() => { hardwareBufferRef.current = ''; hardwareClearTimerRef.current = null; }, 250);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sessionReady]);

  const submitManual = (e: FormEvent) => {
    e.preventDefault();
    const value = manualValue.trim();
    if (!value || busy) return;
    setManualValue('');
    void submitScan(value);
  };

  // ─── RENDER ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100" style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      {/* Top bar */}
      <div className="sticky top-0 z-30 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur-sm">
        <div className="mx-auto max-w-2xl px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate text-base font-bold tracking-tight text-zinc-100">Ticket Scanner</h1>
              {selectedPerformance && (
                <p className="truncate text-xs text-zinc-500">{selectedPerformance.title} · {new Date(selectedPerformance.startsAt).toLocaleString()}</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {/* Status dots */}
              <span className={`h-2 w-2 rounded-full ${isRealtimeConnected ? 'bg-emerald-400' : 'bg-amber-400'}`} title={isRealtimeConnected ? 'Realtime connected' : 'Realtime disconnected'} />
              <span className={`h-2 w-2 rounded-full ${navigator.onLine ? 'bg-emerald-400' : 'bg-red-400'}`} title={navigator.onLine ? 'Online' : 'Offline'} />
              {offlineQueue.length > 0 && (
                <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-black">{offlineQueue.length}</span>
              )}
              <Link
                to="/admin/scanner/live"
                className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-300 active:bg-zinc-700"
              >
                Full Screen
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-2xl space-y-4 px-4 py-4 pb-12">

        {/* Notice banner */}
        {notice && (
          <div className={`rounded-xl border px-4 py-3 text-sm font-medium ${notice.kind === 'success' ? 'border-emerald-700 bg-emerald-950 text-emerald-300' : 'border-red-700 bg-red-950 text-red-300'}`}>
            {notice.text}
          </div>
        )}

        {/* ── PERFORMANCE + SESSION ── */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 overflow-hidden">
          <div className="border-b border-zinc-800 px-4 py-3">
            <span className="text-xs font-bold uppercase tracking-widest text-zinc-500">Session Setup</span>
          </div>
          <div className="space-y-3 p-4">
            <select
              value={performanceId}
              onChange={(e) => setPerformanceId(e.target.value)}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm text-zinc-100 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
            >
              {performances.map((p) => (
                <option key={p.id} value={p.id}>{p.title} — {new Date(p.startsAt).toLocaleString()}</option>
              ))}
            </select>

            {!sessionReady ? (
              <form onSubmit={startSession} className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={sessionDraft.staffName}
                    onChange={(e) => setSessionDraft({ ...sessionDraft, staffName: e.target.value })}
                    placeholder="Your name"
                    className="rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm text-zinc-100 placeholder-zinc-500 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                    required
                  />
                  <input
                    value={sessionDraft.gate}
                    onChange={(e) => setSessionDraft({ ...sessionDraft, gate: e.target.value })}
                    placeholder="Gate"
                    className="rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm text-zinc-100 placeholder-zinc-500 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                    required
                  />
                </div>
                <input
                  value={sessionDraft.deviceLabel}
                  onChange={(e) => setSessionDraft({ ...sessionDraft, deviceLabel: e.target.value })}
                  placeholder="Device label (optional)"
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm text-zinc-100 placeholder-zinc-500 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                />
                <button className="w-full rounded-xl bg-red-600 px-4 py-3.5 text-sm font-bold text-white active:bg-red-700">
                  Start Session
                </button>
              </form>
            ) : (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-800 bg-emerald-950 px-4 py-3">
                <div>
                  <div className="text-sm font-bold text-emerald-300">{scannerSession!.staffName} · {scannerSession!.gate}</div>
                  <div className="text-xs text-emerald-600">Since {new Date(scannerSession!.createdAt).toLocaleTimeString()}</div>
                </div>
                <button
                  type="button"
                  onClick={endSession}
                  className="shrink-0 rounded-lg border border-red-700 bg-red-950 px-3 py-2 text-xs font-semibold text-red-400 active:bg-red-900"
                >
                  End Session
                </button>
              </div>
            )}

            {/* Offline queue sync */}
            {offlineQueue.length > 0 && (
              <button
                type="button"
                onClick={() => void syncOfflineQueue()}
                disabled={isSyncingOffline}
                className="w-full rounded-xl border border-amber-700 bg-amber-950 px-4 py-3 text-sm font-semibold text-amber-300 disabled:opacity-60 active:bg-amber-900"
              >
                {isSyncingOffline ? 'Syncing…' : `Sync Offline Queue (${offlineQueue.length} pending)`}
              </button>
            )}
          </div>
        </section>

        {/* ── CAMERA VIEWFINDER ── */}
        <section className="overflow-hidden rounded-2xl border border-zinc-800 bg-black">
          <div className="relative">
            <video ref={videoRef} className="h-64 w-full object-cover sm:h-80" playsInline muted />
            {!cameraRunning && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70">
                <svg className="h-10 w-10 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75zM6.75 16.5h.75v.75h-.75v-.75zM16.5 6.75h.75v.75h-.75v-.75zM13.5 13.5h.75v.75h-.75v-.75zM13.5 19.5h.75v.75h-.75v-.75zM19.5 13.5h.75v.75h-.75v-.75zM19.5 19.5h.75v.75h-.75v-.75zM16.5 16.5h.75v.75h-.75v-.75z" />
                </svg>
                <span className="text-xs text-zinc-500">Camera off</span>
              </div>
            )}
            {/* corner guides when running */}
            {cameraRunning && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="relative h-44 w-44">
                  <span className="absolute left-0 top-0 h-6 w-6 border-l-2 border-t-2 border-red-500" />
                  <span className="absolute right-0 top-0 h-6 w-6 border-r-2 border-t-2 border-red-500" />
                  <span className="absolute bottom-0 left-0 h-6 w-6 border-b-2 border-l-2 border-red-500" />
                  <span className="absolute bottom-0 right-0 h-6 w-6 border-b-2 border-r-2 border-red-500" />
                </div>
              </div>
            )}
          </div>
          <div className="flex gap-2 border-t border-zinc-800 p-3">
            <button
              type="button"
              onClick={() => { if (cameraRunning) stopCamera(); else void startCamera(); }}
              disabled={!sessionReady}
              className={`flex-1 rounded-xl py-3.5 text-sm font-bold disabled:opacity-50 active:scale-[0.98] ${cameraRunning ? 'border border-zinc-600 bg-zinc-800 text-zinc-300' : 'bg-red-600 text-white'}`}
            >
              {cameraRunning ? 'Stop Camera' : 'Start Camera'}
            </button>
          </div>
          {(cameraError || !cameraSupported) && (
            <div className="border-t border-zinc-800 px-4 py-2 text-xs text-amber-400">
              {cameraError || 'Camera scanning unsupported on this browser.'}
            </div>
          )}
        </section>

        {/* ── LAST SCAN RESULT ── */}
        {lastResult ? (
          <section className={`rounded-2xl border p-4 ${outcomeConfig[lastResult.outcome].border} ${outcomeConfig[lastResult.outcome].bg}`}>
            <div className="flex items-start gap-3">
              <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-lg font-bold ${outcomeConfig[lastResult.outcome].text} border ${outcomeConfig[lastResult.outcome].border}`}>
                {outcomeConfig[lastResult.outcome].icon}
              </span>
              <div className="min-w-0 flex-1">
                <div className={`text-sm font-bold uppercase tracking-widest ${outcomeConfig[lastResult.outcome].text}`}>
                  {outcomeConfig[lastResult.outcome].label}
                </div>
                <div className="mt-0.5 text-sm text-zinc-300">{lastResult.message}</div>
                {lastResult.ticket && (
                  <div className="mt-2 space-y-0.5 text-xs text-zinc-400">
                    <div className="font-semibold text-zinc-200">{lastResult.ticket.holder.customerName}</div>
                    <div>{lastResult.ticket.holder.customerEmail}</div>
                    <div>{lastResult.ticket.seat.sectionName} · Row {lastResult.ticket.seat.row} · Seat {lastResult.ticket.seat.number}</div>
                  </div>
                )}
                {lastResult.ticket?.checkedInAt && (
                  <button
                    type="button"
                    disabled={undoBusyTicketId === lastResult.ticket.id || !sessionReady}
                    onClick={() => { void undoCheckIn(lastResult.ticket!); }}
                    className="mt-3 rounded-lg border border-amber-600 bg-amber-950 px-3 py-2 text-xs font-semibold text-amber-300 disabled:opacity-60 active:bg-amber-900"
                  >
                    {undoBusyTicketId === lastResult.ticket.id ? 'Undoing…' : 'Undo Check-In'}
                  </button>
                )}
              </div>
            </div>
          </section>
        ) : (
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-700 text-zinc-500">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
              </span>
              <div>
                <div className="text-xs font-bold uppercase tracking-widest text-zinc-500">Latest Scan</div>
                <div className="text-sm font-semibold text-zinc-400">Ready to scan</div>
              </div>
            </div>
          </section>
        )}

        {/* ── MANUAL / HARDWARE INPUT ── */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 overflow-hidden">
          <div className="border-b border-zinc-800 px-4 py-3">
            <span className="text-xs font-bold uppercase tracking-widest text-zinc-500">Manual / Hardware Input</span>
          </div>
          <form onSubmit={submitManual} className="flex gap-2 p-3">
            <input
              ref={hardwareInputRef}
              value={manualValue}
              onChange={(e) => setManualValue(e.target.value)}
              className="min-w-0 flex-1 rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm text-zinc-100 placeholder-zinc-500 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
              placeholder="QR payload, ticket URL, or ID"
            />
            <button
              disabled={busy || !sessionReady}
              className="shrink-0 rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm font-semibold text-zinc-300 disabled:opacity-50 active:bg-zinc-700"
            >
              {busy ? '…' : 'Submit'}
            </button>
          </form>
        </section>

        {/* ── LIVE STATUS ── */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 overflow-hidden">
          <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
            <span className="text-xs font-bold uppercase tracking-widest text-zinc-500">Live Status</span>
            <button
              type="button"
              onClick={() => void Promise.all([loadSummary(), loadTimeline(), loadAnalytics()])}
              className="rounded-lg border border-zinc-700 px-3 py-1 text-xs font-semibold text-zinc-400 active:bg-zinc-800"
            >
              Refresh
            </button>
          </div>
          {summary ? (
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <StatCard label="Checked In" value={String(summary.totalCheckedIn)} />
                <StatCard label="Admittable" value={String(summary.totalAdmittable)} />
                <StatCard label="Rate" value={`${checkInPct}%`} accent />
              </div>
              {/* Progress bar */}
              <div>
                <div className="mb-1.5 flex justify-between text-xs text-zinc-500">
                  <span>Check-in progress</span>
                  <span>{checkInPct}%</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
                  <div className="h-full rounded-full bg-red-600 transition-all" style={{ width: `${checkInPct}%` }} />
                </div>
              </div>
            </div>
          ) : (
            <div className="p-4 text-sm text-zinc-500">{summaryError || 'Loading…'}</div>
          )}
        </section>

        {/* ── FALLBACK SEARCH ── */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 overflow-hidden">
          <div className="border-b border-zinc-800 px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <span className="text-xs font-bold uppercase tracking-widest text-red-500">Fallback Check-In</span>
                <h3 className="mt-0.5 text-sm font-bold text-zinc-100">Search by name or email</h3>
              </div>
              {lookupRows.length > 0 && (
                <span className="rounded-full border border-zinc-700 bg-zinc-800 px-2.5 py-0.5 text-xs font-semibold text-zinc-400">
                  {lookupRows.length} match{lookupRows.length !== 1 ? 'es' : ''}
                </span>
              )}
            </div>
          </div>

          <div className="space-y-3 p-4">
            <form onSubmit={searchLookup} className="flex gap-2">
              <input
                value={lookupQuery}
                onChange={(e) => setLookupQuery(e.target.value)}
                placeholder="Name, email, seat, order ID…"
                className="min-w-0 flex-1 rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm text-zinc-100 placeholder-zinc-500 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
              />
              <button
                disabled={!performanceId}
                className="shrink-0 rounded-xl bg-red-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50 active:bg-red-700"
              >
                Search
              </button>
            </form>

            <div className="grid grid-cols-2 gap-2">
              <select
                value={reasonCode}
                onChange={(e) => setReasonCode(e.target.value as ReasonCode)}
                className="rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-xs text-zinc-300 focus:border-red-500 focus:outline-none"
              >
                {reasonOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <input
                value={reasonNotes}
                onChange={(e) => setReasonNotes(e.target.value)}
                placeholder="Notes (optional)"
                className="rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-xs text-zinc-300 placeholder-zinc-500 focus:border-red-500 focus:outline-none"
              />
            </div>

            <div className="max-h-96 space-y-2 overflow-auto">
              {lookupRows.map((ticket) => {
                const checkedIn = Boolean(ticket.checkedInAt);
                const denied = ticket.admissionDecision === 'DENY';
                const lBusy = lookupBusyTicketId === ticket.id;
                const aBusy = undoBusyTicketId === ticket.id;
                return (
                  <div key={ticket.id} className="rounded-2xl border border-zinc-700 bg-zinc-800 p-4">
                    <div className="mb-3 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-zinc-100">{ticket.holder.customerName}</span>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${checkedIn ? 'bg-emerald-900 text-emerald-300' : denied ? 'bg-red-900 text-red-300' : 'bg-amber-900 text-amber-300'}`}>
                            {checkedIn ? 'In' : denied ? 'Denied' : 'Ready'}
                          </span>
                        </div>
                        <div className="mt-0.5 text-xs text-zinc-500">{ticket.holder.customerEmail}</div>
                        <div className="mt-0.5 text-xs text-zinc-600">
                          {ticket.seat.sectionName} · R{ticket.seat.row}-{ticket.seat.number} · #{ticket.publicId}
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5 sm:flex sm:flex-wrap">
                      <button type="button" onClick={() => void checkInLookupTicket(ticket)}
                        disabled={!sessionReady || checkedIn || busy || Boolean(lookupBusyTicketId) || aBusy}
                        className="rounded-lg bg-red-600 px-3 py-2.5 text-xs font-bold text-white disabled:opacity-50 active:bg-red-700">
                        {lBusy ? '…' : checkedIn ? 'Checked In' : 'Check In'}
                      </button>
                      <button type="button" onClick={() => void undoCheckIn(ticket)}
                        disabled={aBusy || busy || Boolean(lookupBusyTicketId) || !sessionReady || !checkedIn}
                        className="rounded-lg border border-amber-700 bg-amber-950 px-3 py-2.5 text-xs font-semibold text-amber-300 disabled:opacity-50 active:bg-amber-900">
                        {aBusy ? '…' : 'Undo'}
                      </button>
                      <button type="button" onClick={() => void applySupervisorDecision(ticket, 'FORCE_ADMIT')}
                        disabled={aBusy || busy || Boolean(lookupBusyTicketId) || !sessionReady}
                        className="rounded-lg border border-emerald-700 bg-emerald-950 px-3 py-2.5 text-xs font-semibold text-emerald-300 disabled:opacity-50 active:bg-emerald-900">
                        Force Admit
                      </button>
                      <button type="button" onClick={() => void applySupervisorDecision(ticket, 'DENY')}
                        disabled={aBusy || busy || Boolean(lookupBusyTicketId) || !sessionReady}
                        className="rounded-lg border border-red-800 bg-red-950 px-3 py-2.5 text-xs font-semibold text-red-400 disabled:opacity-50 active:bg-red-900">
                        Deny
                      </button>
                    </div>
                  </div>
                );
              })}
              {lookupRows.length === 0 && (
                <div className="rounded-xl border border-dashed border-zinc-700 px-4 py-8 text-center text-sm text-zinc-600">
                  {lookupQuery.trim() ? 'No matching guests found.' : 'Search results appear here.'}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ── RECENT SCANS ── */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 overflow-hidden">
          <div className="border-b border-zinc-800 px-4 py-3">
            <span className="text-xs font-bold uppercase tracking-widest text-zinc-500">Recent Scans · This Device</span>
          </div>
          <div className="max-h-72 space-y-1.5 overflow-auto p-3">
            {history.map((item) => {
              const cfg = outcomeConfig[item.outcome];
              return (
                <div key={item.id} className={`flex items-start gap-3 rounded-xl border p-3 ${cfg.border} ${cfg.bg}`}>
                  <span className={`mt-0.5 text-lg font-bold leading-none ${cfg.text}`}>{cfg.icon}</span>
                  <div className="min-w-0 flex-1">
                    <div className={`text-xs font-bold uppercase tracking-wide ${cfg.text}`}>{cfg.label}</div>
                    {item.ticket && (
                      <div className="truncate text-xs text-zinc-400">{item.ticket.holder.customerName} · {item.ticket.seat.sectionName} {item.ticket.seat.row}-{item.ticket.seat.number}</div>
                    )}
                    <div className="text-xs text-zinc-600">{new Date(item.scannedAt).toLocaleTimeString()}</div>
                  </div>
                </div>
              );
            })}
            {history.length === 0 && <div className="py-6 text-center text-sm text-zinc-600">No scans yet.</div>}
          </div>
        </section>

        {/* ── ADVANCED (collapsed) ── */}
        <details className="rounded-2xl border border-zinc-800 bg-zinc-900 overflow-hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-4">
            <span className="text-xs font-bold uppercase tracking-widest text-zinc-500">Advanced</span>
            <svg className="h-4 w-4 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
          </summary>

          <div className="space-y-4 border-t border-zinc-800 p-4">
            {/* Detailed status */}
            {summary && (
              <div>
                <div className="mb-2 text-xs font-bold uppercase tracking-widest text-zinc-500">Detailed Status</div>
                <div className="grid grid-cols-3 gap-2">
                  <StatCard label="Denied" value={String(summary.deniedCount)} />
                  <StatCard label="Force Admit" value={String(summary.forceAdmitCount)} />
                  <StatCard label="Sessions" value={String(summary.activeSessions.length)} />
                </div>
                {summary.gateBreakdown.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {summary.gateBreakdown.map((g) => (
                      <span key={g.gate} className="rounded-full border border-zinc-700 bg-zinc-800 px-3 py-1 text-xs text-zinc-400">
                        {g.gate}: {g.count}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Timeline */}
            <div>
              <div className="mb-2 text-xs font-bold uppercase tracking-widest text-zinc-500">Undo / Force Timeline</div>
              <div className="max-h-56 space-y-1.5 overflow-auto rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                {timeline?.rows.map((row) => (
                  <div key={row.id} className="rounded-lg border border-zinc-800 p-2.5 text-xs">
                    <div className="font-semibold text-zinc-300">{row.action}</div>
                    <div className="text-zinc-600">{row.actor} · {new Date(row.createdAt).toLocaleString()}</div>
                  </div>
                ))}
                {(!timeline || timeline.rows.length === 0) && <div className="py-4 text-center text-xs text-zinc-600">No timeline events yet.</div>}
              </div>
            </div>

            {/* Analytics */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <div className="text-xs font-bold uppercase tracking-widest text-zinc-500">Post-Show Analytics</div>
                {performanceId && (
                  <button
                    type="button"
                    onClick={() => void exportAnalyticsCsv()}
                    disabled={isExportingCsv}
                    className="rounded-lg border border-zinc-700 px-3 py-1 text-xs font-semibold text-zinc-400 disabled:opacity-50 active:bg-zinc-800"
                  >
                    {isExportingCsv ? 'Exporting…' : 'Export CSV'}
                  </button>
                )}
              </div>
              {analytics ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                    <StatCard label="No-show" value={String(analytics.totals.noShowEstimate)} />
                    <StatCard label="Peak/min" value={String(analytics.peakPerMinute)} />
                    <StatCard label="Fraud Est." value={String(analytics.attempts.fraudAttemptEstimate)} />
                    <StatCard label="Dupes" value={String(analytics.attempts.duplicateAttempts)} />
                    <StatCard label="Rate" value={`${analytics.totals.checkInRate}%`} />
                  </div>
                  <div className="rounded-xl border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs text-zinc-500">
                    Invalid QR: {analytics.attempts.invalidQrAttempts} · Not found: {analytics.attempts.notFoundAttempts} · Wrong show: {analytics.attempts.wrongPerformanceAttempts} · Not admitted: {analytics.attempts.notAdmittedAttempts}
                  </div>
                </div>
              ) : (
                <div className="text-xs text-zinc-600">Loading analytics…</div>
              )}
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${accent ? 'border-red-800 bg-red-950' : 'border-zinc-800 bg-zinc-950'}`}>
      <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{label}</div>
      <div className={`mt-0.5 text-2xl font-bold tabular-nums ${accent ? 'text-red-400' : 'text-zinc-100'}`}>{value}</div>
    </div>
  );
}