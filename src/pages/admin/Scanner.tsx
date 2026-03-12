import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminFetch, getAdminToken } from '../../lib/adminAuth';
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

type DetectedBarcodeLike = { rawValue?: string };
type BarcodeDetectorLike = {
  detect: (source: HTMLVideoElement) => Promise<DetectedBarcodeLike[]>;
};
type BarcodeDetectorCtorLike = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

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

const outcomeStyles: Record<ScanOutcome, string> = {
  VALID: 'bg-green-50 border-green-300 text-green-900',
  ALREADY_CHECKED_IN: 'bg-amber-50 border-amber-300 text-amber-900',
  WRONG_PERFORMANCE: 'bg-orange-50 border-orange-300 text-orange-900',
  NOT_ADMITTED: 'bg-red-50 border-red-300 text-red-900',
  INVALID_QR: 'bg-red-50 border-red-300 text-red-900',
  NOT_FOUND: 'bg-red-50 border-red-300 text-red-900'
};

function getDetectorConstructor(): BarcodeDetectorCtorLike | null {
  const candidate = (window as Window & { BarcodeDetector?: BarcodeDetectorCtorLike }).BarcodeDetector;
  return candidate || null;
}

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
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Ignore unsupported haptics.
  }
}

function beep(success: boolean) {
  try {
    const AudioCtx = (window as Window & { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
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
    oscillator.onended = () => {
      void ctx.close();
    };
  } catch {
    // Ignore audio failures.
  }
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
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const intervalRef = useRef<number | null>(null);
  const scanBusyRef = useRef(false);
  const lastScannedRef = useRef<{ value: string; at: number } | null>(null);
  const hardwareBufferRef = useRef('');
  const hardwareClearTimerRef = useRef<number | null>(null);

  const selectedPerformance = useMemo(
    () => performances.find((performance) => performance.id === performanceId),
    [performances, performanceId]
  );

  const sessionReady = Boolean(scannerSession && scannerSession.performanceId === performanceId);
  const checkInPct =
    summary && summary.totalAdmittable > 0
      ? Math.min(100, Math.round((summary.totalCheckedIn / summary.totalAdmittable) * 100))
      : 0;

  const stopCamera = () => {
    if (intervalRef.current) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    detectorRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraRunning(false);
  };

  const loadSummary = async (selectedPerformanceId = performanceId) => {
    if (!selectedPerformanceId) {
      setSummary(null);
      return;
    }

    try {
      const next = await adminFetch<CheckInSummary>(`/api/admin/check-in/summary?performanceId=${selectedPerformanceId}`);
      setSummary(next);
      setSummaryError(null);
    } catch (err) {
      setSummaryError(err instanceof Error ? err.message : 'Failed to load check-in summary');
    }
  };

  const loadTimeline = async (selectedPerformanceId = performanceId) => {
    if (!selectedPerformanceId) {
      setTimeline(null);
      return;
    }

    try {
      const next = await adminFetch<TimelineResponse>(
        `/api/admin/check-in/timeline?performanceId=${selectedPerformanceId}&page=1&pageSize=100`
      );
      setTimeline(next);
    } catch {
      // Keep old timeline on transient errors.
    }
  };

  const loadAnalytics = async (selectedPerformanceId = performanceId) => {
    if (!selectedPerformanceId) {
      setAnalytics(null);
      return;
    }

    try {
      const next = await adminFetch<AnalyticsResponse>(`/api/admin/check-in/analytics?performanceId=${selectedPerformanceId}`);
      setAnalytics(next);
    } catch {
      // Keep old analytics on transient errors.
    }
  };

  const pushHistory = (result: ScanResponse) => {
    setHistory((current) => [{ ...result, id: makeClientId() }, ...current].slice(0, 30));
  };

  const patchTicketInHistory = (ticket: ScannedTicket) => {
    setLastResult((current) => {
      if (!current?.ticket || current.ticket.id !== ticket.id) return current;
      return { ...current, ticket };
    });

    setHistory((current) =>
      current.map((row) => {
        if (!row.ticket || row.ticket.id !== ticket.id) return row;
        return { ...row, ticket };
      })
    );
  };

  const applyFeedback = (outcome: ScanOutcome) => {
    const success = outcome === 'VALID';
    vibrate(success ? 50 : [80, 30, 80]);
    beep(success);
  };

  const persistSession = (session: ScannerSession | null) => {
    const sessions = readStoredSessions();
    if (!session) {
      delete sessions[performanceId];
    } else {
      sessions[session.performanceId] = session;
    }
    writeStoredSessions(sessions);
  };

  const enqueueOfflineScan = (item: Omit<OfflineQueueItem, 'id' | 'queuedAt'>) => {
    const queueItem: OfflineQueueItem = {
      id: makeClientId(),
      queuedAt: new Date().toISOString(),
      ...item
    };
    const next = [...readOfflineQueue(), queueItem];
    writeOfflineQueue(next);
    setOfflineQueue(next);
    setNotice({ kind: 'error', text: `Offline: queued scan (${next.length} pending).` });
  };

  const sendScanRequest = async (params: {
    scannedValue: string;
    clientScanId?: string;
    offlineQueuedAt?: string;
    performanceIdOverride?: string;
    sessionTokenOverride?: string;
  }) => {
    if (!sessionReady && !params.sessionTokenOverride) {
      throw new Error('Start a scanner session before scanning.');
    }

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
    if (!performanceId || !sessionReady) {
      setNotice({ kind: 'error', text: 'Start a scanner session first.' });
      return;
    }

    scanBusyRef.current = true;
    setBusy(true);
    setNotice(null);
    const clientScanId = makeClientId();

    try {
      if (!navigator.onLine) {
        enqueueOfflineScan({
          performanceId,
          sessionToken: scannerSession!.sessionToken,
          scannedValue,
          clientScanId
        });
        return;
      }

      const result = await sendScanRequest({ scannedValue, clientScanId });
      setLastResult(result);
      pushHistory(result);
      applyFeedback(result.outcome);
      await Promise.all([loadSummary(), loadTimeline(), loadAnalytics()]);
    } catch (err) {
      if (isNetworkError(err)) {
        enqueueOfflineScan({
          performanceId,
          sessionToken: scannerSession!.sessionToken,
          scannedValue,
          clientScanId
        });
      } else {
        const fallback: ScanResponse = {
          outcome: 'INVALID_QR',
          message: err instanceof Error ? err.message : 'Scan failed',
          scannedAt: new Date().toISOString()
        };
        setLastResult(fallback);
        pushHistory(fallback);
        applyFeedback(fallback.outcome);
      }
    } finally {
      setBusy(false);
      scanBusyRef.current = false;
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

      for (let index = 0; index < currentQueue.length; index += 1) {
        const item = currentQueue[index];
        const fallbackSessionToken =
          (item.performanceId === performanceId && scannerSession?.performanceId === item.performanceId
            ? scannerSession.sessionToken
            : storedSessions[item.performanceId]?.sessionToken) || item.sessionToken;

        try {
          const result = await sendScanRequest({
            scannedValue: item.scannedValue,
            clientScanId: item.clientScanId,
            offlineQueuedAt: item.queuedAt,
            performanceIdOverride: item.performanceId,
            sessionTokenOverride: fallbackSessionToken
          });
          setLastResult(result);
          pushHistory(result);
          applyFeedback(result.outcome);
        } catch (err) {
          if (isNetworkError(err)) {
            remaining.push(item);
            const notProcessed = currentQueue.slice(index + 1);
            remaining.push(...notProcessed);
            break;
          }

          const message = err instanceof Error ? err.message.toLowerCase() : '';
          const sessionOrAuthFailure =
            message.includes('session is not active') ||
            message.includes('unauthorized') ||
            message.includes('forbidden');

          if (sessionOrAuthFailure) {
            remaining.push(item);
            const notProcessed = currentQueue.slice(index + 1);
            remaining.push(...notProcessed);
            blockedMessage = 'Offline sync paused: start an active scanner session and try again.';
            break;
          }

          // Server responded (already checked in, invalid code, etc). Keep moving and drop item.
        }
      }

      writeOfflineQueue(remaining);
      setOfflineQueue(remaining);
      if (remaining.length === 0) {
        setNotice({ kind: 'success', text: 'Offline queue synced.' });
      } else if (blockedMessage) {
        setNotice({ kind: 'error', text: blockedMessage });
      } else {
        setNotice({ kind: 'error', text: `${remaining.length} scan(s) still queued.` });
      }

      await Promise.all([loadSummary(), loadTimeline(), loadAnalytics()]);
    } finally {
      setIsSyncingOffline(false);
    }
  };

  const startSession = async (event: FormEvent) => {
    event.preventDefault();
    if (!performanceId) return;

    try {
      const session = await adminFetch<ScannerSession>('/api/admin/check-in/session/start', {
        method: 'POST',
        body: JSON.stringify({
          performanceId,
          staffName: sessionDraft.staffName.trim(),
          gate: sessionDraft.gate.trim(),
          deviceLabel: sessionDraft.deviceLabel.trim() || undefined
        })
      });
      setScannerSession(session);
      setSessionDraft((current) => ({ ...current, gate: session.gate }));
      persistSession(session);
      setNotice({ kind: 'success', text: `Session started for ${session.staffName} (${session.gate}).` });
      await Promise.all([loadSummary(), loadTimeline(), loadAnalytics()]);
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Failed to start session' });
    }
  };

  const endSession = async () => {
    if (!scannerSession) return;
    try {
      await adminFetch('/api/admin/check-in/session/end', {
        method: 'POST',
        body: JSON.stringify({ sessionToken: scannerSession.sessionToken })
      });
      setScannerSession(null);
      persistSession(null);
      setNotice({ kind: 'success', text: 'Scanner session ended.' });
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Failed to end session' });
    }
  };

  const undoCheckIn = async (ticket: ScannedTicket) => {
    if (!performanceId || !sessionReady) return;
    setUndoBusyTicketId(ticket.id);
    setNotice(null);
    try {
      const result = await adminFetch<UndoResponse>('/api/admin/check-in/undo', {
        method: 'POST',
        body: JSON.stringify({
          performanceId,
          sessionToken: scannerSession!.sessionToken,
          ticketId: ticket.id,
          reasonCode,
          notes: reasonNotes.trim() || undefined
        })
      });

      setNotice({ kind: result.success ? 'success' : 'error', text: result.message });
      if (result.ticket) patchTicketInHistory(result.ticket);
      await Promise.all([loadSummary(), loadTimeline(), loadAnalytics()]);
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Failed to undo check-in' });
    } finally {
      setUndoBusyTicketId(null);
    }
  };

  const applySupervisorDecision = async (ticket: LookupResult, decision: 'FORCE_ADMIT' | 'DENY') => {
    if (!performanceId || !sessionReady) {
      setNotice({ kind: 'error', text: 'Start a scanner session first.' });
      return;
    }
    setUndoBusyTicketId(ticket.id);
    setNotice(null);
    try {
      const result = await adminFetch<{ success: boolean; message: string; ticket?: ScannedTicket }>(
        '/api/admin/check-in/force-decision',
        {
          method: 'POST',
          body: JSON.stringify({
            performanceId,
            sessionToken: scannerSession!.sessionToken,
            ticketId: ticket.id,
            decision,
            reasonCode,
            notes: reasonNotes.trim() || undefined
          })
        }
      );
      setNotice({ kind: 'success', text: result.message });
      if (result.ticket) {
        patchTicketInHistory(result.ticket);
        setLookupRows((rows) => rows.map((row) => (row.id === result.ticket!.id ? { ...row, ...result.ticket } : row)));
      }
      await Promise.all([loadSummary(), loadTimeline(), loadAnalytics()]);
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Failed to apply decision' });
    } finally {
      setUndoBusyTicketId(null);
    }
  };

  const searchLookup = async (event: FormEvent) => {
    event.preventDefault();
    if (!performanceId || !lookupQuery.trim()) return;
    try {
      const rows = await adminFetch<LookupResult[]>(
        `/api/admin/check-in/lookup?performanceId=${performanceId}&q=${encodeURIComponent(lookupQuery.trim())}&limit=40`
      );
      setLookupRows(rows);
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Lookup failed' });
    }
  };

  const exportAnalyticsCsv = async () => {
    if (!performanceId || isExportingCsv) return;
    const token = getAdminToken();
    if (!token) {
      setNotice({ kind: 'error', text: 'Admin session expired. Log in again.' });
      return;
    }

    setIsExportingCsv(true);
    setNotice(null);
    try {
      const response = await fetch(apiUrl(`/api/admin/check-in/analytics.csv?performanceId=${encodeURIComponent(performanceId)}`), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (!response.ok) {
        const contentType = response.headers.get('content-type') || '';
        let message = `CSV export failed (${response.status})`;
        if (contentType.includes('application/json')) {
          const errorBody = (await response.json().catch(() => null)) as { error?: string } | null;
          if (errorBody?.error) message = errorBody.error;
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') || '';
      const nameMatch = disposition.match(/filename="([^"]+)"/i);
      const filename = nameMatch?.[1] || `checkin-analytics-${performanceId}.csv`;
      const objectUrl = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
      setNotice({ kind: 'success', text: 'Analytics CSV downloaded.' });
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Failed to export CSV' });
    } finally {
      setIsExportingCsv(false);
    }
  };

  const startCamera = async () => {
    setCameraError(null);
    if (cameraRunning) return;
    if (!sessionReady) {
      setCameraError('Start a scanner session first.');
      return;
    }

    const detectorCtor = getDetectorConstructor();
    if (!detectorCtor || !navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera scanning is not supported on this browser. Use manual/hardware entry.');
      return;
    }

    try {
      const orientation = (screen as Screen & { orientation?: { lock?: (lockType: string) => Promise<void> } }).orientation;
      await orientation?.lock?.('portrait').catch(() => Promise.resolve());
    } catch {
      // Ignore orientation lock failures.
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' }
        },
        audio: false
      });

      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error('Camera preview failed to initialize');
      }

      video.srcObject = stream;
      await video.play();

      streamRef.current = stream;
      detectorRef.current = new detectorCtor({ formats: ['qr_code'] });
      setCameraRunning(true);

      intervalRef.current = window.setInterval(() => {
        const detector = detectorRef.current;
        const activeVideo = videoRef.current;
        if (!detector || !activeVideo) return;
        if (scanBusyRef.current) return;
        if (activeVideo.readyState < 2) return;

        detector
          .detect(activeVideo)
          .then((codes) => {
            const raw = codes.find((code) => code.rawValue)?.rawValue?.trim();
            if (!raw) return;

            const now = Date.now();
            const last = lastScannedRef.current;
            if (last && last.value === raw && now - last.at < 1500) return;

            lastScannedRef.current = { value: raw, at: now };
            void submitScan(raw);
          })
          .catch(() => {
            // Ignore frame-level decode errors.
          });
      }, 250);
    } catch (err) {
      stopCamera();
      setCameraError(err instanceof Error ? err.message : 'Unable to access camera');
    }
  };

  useEffect(() => {
    setCameraSupported(Boolean(getDetectorConstructor() && navigator.mediaDevices?.getUserMedia));
    setOfflineQueue(readOfflineQueue());

    adminFetch<PerformanceRow[]>('/api/admin/performances?scope=active')
      .then((rows) => {
        const active = rows.filter((row) => !row.isArchived);
        setPerformances(active);
        if (active.length > 0) {
          setPerformanceId(active[0].id);
        }
      })
      .catch((err) => {
        setCameraError(err instanceof Error ? err.message : 'Failed to load performances');
      });

    const onlineHandler = () => {
      void syncOfflineQueue();
    };
    window.addEventListener('online', onlineHandler);

    return () => {
      stopCamera();
      window.removeEventListener('online', onlineHandler);
    };
  }, []);

  useEffect(() => {
    if (!performanceId) return;

    const storedSession = readStoredSessions()[performanceId];
    setScannerSession(storedSession || null);
    if (storedSession) {
      setSessionDraft((current) => ({
        ...current,
        staffName: storedSession.staffName,
        gate: storedSession.gate
      }));
    }

    setLastResult(null);
    setHistory([]);
    setLookupRows([]);
    setLookupQuery('');
    setNotice(null);

    void Promise.all([loadSummary(performanceId), loadTimeline(performanceId), loadAnalytics(performanceId)]);
  }, [performanceId]);

  useEffect(() => {
    const token = getAdminToken();
    if (!token || !performanceId || !sessionReady) {
      setIsRealtimeConnected(false);
      return;
    }

    const streamUrl = apiUrl(
      `/api/admin/check-in/events?performanceId=${encodeURIComponent(performanceId)}&token=${encodeURIComponent(token)}`
    );
    const source = new EventSource(streamUrl);

    source.onopen = () => setIsRealtimeConnected(true);
    source.onerror = () => setIsRealtimeConnected(false);
    source.addEventListener('checkin', () => {
      void Promise.all([loadSummary(performanceId), loadTimeline(performanceId), loadAnalytics(performanceId)]);
    });
    source.addEventListener('decision', () => {
      void Promise.all([loadSummary(performanceId), loadTimeline(performanceId), loadAnalytics(performanceId)]);
    });
    source.addEventListener('session', () => {
      void loadSummary(performanceId);
    });

    return () => {
      source.close();
      setIsRealtimeConnected(false);
    };
  }, [performanceId, sessionReady]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!sessionReady) return;

      const target = event.target as HTMLElement | null;
      const editable =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.getAttribute('contenteditable') === 'true';
      if (editable) return;

      if (event.key === 'Enter') {
        const value = hardwareBufferRef.current.trim();
        hardwareBufferRef.current = '';
        if (hardwareClearTimerRef.current) {
          window.clearTimeout(hardwareClearTimerRef.current);
          hardwareClearTimerRef.current = null;
        }
        if (value) {
          void submitScan(value);
        }
        return;
      }

      if (event.key.length === 1) {
        hardwareBufferRef.current += event.key;
        if (hardwareClearTimerRef.current) {
          window.clearTimeout(hardwareClearTimerRef.current);
        }
        hardwareClearTimerRef.current = window.setTimeout(() => {
          hardwareBufferRef.current = '';
          hardwareClearTimerRef.current = null;
        }, 250);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sessionReady]);

  const submitManual = (event: FormEvent) => {
    event.preventDefault();
    const value = manualValue.trim();
    if (!value || busy) return;
    setManualValue('');
    void submitScan(value);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">Ticket Scanner Console</h1>
          <p className="text-sm text-stone-600">Simple check-in mode. Keep this page focused on scanning and use Advanced Settings only when needed.</p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Link
            to="/admin/scanner/live"
            className="w-full rounded-xl border border-stone-300 bg-white px-4 py-2 text-center text-sm font-semibold text-stone-700 hover:bg-stone-50 sm:w-auto"
          >
            Open Full-Screen Scanner
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <span
          className={`rounded-full border px-3 py-1 ${isRealtimeConnected ? 'border-green-300 bg-green-50 text-green-900' : 'border-amber-300 bg-amber-50 text-amber-900'}`}
        >
          Realtime: {isRealtimeConnected ? 'Connected' : 'Disconnected'}
        </span>
        <span
          className={`rounded-full border px-3 py-1 ${navigator.onLine ? 'border-green-300 bg-green-50 text-green-900' : 'border-red-300 bg-red-50 text-red-900'}`}
        >
          Network: {navigator.onLine ? 'Online' : 'Offline'}
        </span>
        <span className="rounded-full border border-stone-300 bg-stone-50 px-3 py-1 text-stone-700">
          Offline Queue: {offlineQueue.length}
        </span>
      </div>

      {notice ? (
        <div className={`rounded-xl border px-3 py-2 text-sm ${notice.kind === 'success' ? 'border-green-300 bg-green-50 text-green-900' : 'border-red-300 bg-red-50 text-red-900'}`}>
          {notice.text}
        </div>
      ) : null}

      <div className="space-y-6">
        <section className="space-y-4 rounded-2xl border border-stone-200 p-4">
          <h2 className="font-bold text-stone-900">Session Setup</h2>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <select
              value={performanceId}
              onChange={(event) => setPerformanceId(event.target.value)}
              className="rounded-xl border border-stone-300 px-3 py-2 text-sm"
            >
              {performances.map((performance) => (
                <option key={performance.id} value={performance.id}>
                  {performance.title} - {new Date(performance.startsAt).toLocaleString()}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void syncOfflineQueue()}
              className="rounded-xl border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700 disabled:opacity-60"
              disabled={isSyncingOffline || offlineQueue.length === 0}
            >
              {isSyncingOffline ? 'Syncing Offline Queue...' : `Sync Offline Queue (${offlineQueue.length})`}
            </button>
          </div>

          {!sessionReady ? (
            <form onSubmit={startSession} className="grid grid-cols-1 gap-3 md:grid-cols-4">
              <input
                value={sessionDraft.staffName}
                onChange={(event) => setSessionDraft({ ...sessionDraft, staffName: event.target.value })}
                placeholder="Staff name"
                className="rounded-xl border border-stone-300 px-3 py-2 text-sm"
                required
              />
              <input
                value={sessionDraft.gate}
                onChange={(event) => setSessionDraft({ ...sessionDraft, gate: event.target.value })}
                placeholder="Gate"
                className="rounded-xl border border-stone-300 px-3 py-2 text-sm"
                required
              />
              <input
                value={sessionDraft.deviceLabel}
                onChange={(event) => setSessionDraft({ ...sessionDraft, deviceLabel: event.target.value })}
                placeholder="Device label (optional)"
                className="rounded-xl border border-stone-300 px-3 py-2 text-sm"
              />
              <button className="rounded-xl bg-red-700 px-4 py-2 text-sm font-bold text-white">Start Session</button>
            </form>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-green-300 bg-green-50 p-3">
              <div className="text-sm text-green-900">
                <div className="font-bold">{scannerSession.staffName} @ {scannerSession.gate}</div>
                <div>Started {new Date(scannerSession.createdAt).toLocaleString()}</div>
              </div>
              <button
                type="button"
                onClick={endSession}
                className="rounded-lg border border-red-300 px-3 py-2 text-sm font-semibold text-red-700"
              >
                End Session
              </button>
            </div>
          )}

          <div>
            <div className="mb-2 text-sm text-stone-600">
              {selectedPerformance ? `Scanning for ${selectedPerformance.title}` : 'Select a performance to scan'}
            </div>
            <div className="rounded-xl overflow-hidden border border-stone-300 bg-black">
              <video ref={videoRef} className="h-[280px] w-full object-cover" playsInline muted />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                if (cameraRunning) {
                  stopCamera();
                } else {
                  void startCamera();
                }
              }}
              className="rounded-xl bg-red-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
              disabled={!sessionReady}
            >
              {cameraRunning ? 'Stop Camera' : 'Start Camera'}
            </button>
            {!cameraSupported ? <span className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Camera unsupported on this browser.</span> : null}
            {cameraError ? <span className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{cameraError}</span> : null}
          </div>

          <form onSubmit={submitManual} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
            <input
              ref={hardwareInputRef}
              value={manualValue}
              onChange={(event) => setManualValue(event.target.value)}
              className="w-full rounded-xl border border-stone-300 px-3 py-2 text-sm"
              placeholder="Paste QR payload, ticket URL, ticket ID, or hardware scanner input"
            />
            <button
              disabled={busy || !sessionReady}
              className="rounded-xl border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700 disabled:opacity-60"
            >
              {busy ? 'Scanning...' : 'Submit'}
            </button>
          </form>
        </section>

        <div className="space-y-4">
          <section className="space-y-3 rounded-2xl border border-stone-200 p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-bold text-stone-900">Live Status</h2>
              <button
                type="button"
                onClick={() => void Promise.all([loadSummary(), loadTimeline(), loadAnalytics()])}
                className="rounded-lg border border-stone-300 px-3 py-1 text-xs font-semibold text-stone-700"
              >
                Refresh
              </button>
            </div>

            {summary ? (
              <>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                  <StatCard label="Checked In" value={`${summary.totalCheckedIn}`} />
                  <StatCard label="Admittable" value={`${summary.totalAdmittable}`} />
                  <StatCard label="Progress" value={`${checkInPct}%`} />
                </div>
              </>
            ) : (
              <div className="text-sm text-stone-500">Loading summary...</div>
            )}

            {summaryError ? <div className="text-xs text-red-600">{summaryError}</div> : null}
          </section>

          {lastResult ? (
            <section className={`space-y-2 rounded-2xl border p-4 ${outcomeStyles[lastResult.outcome]}`}>
              <h2 className="font-bold">{lastResult.outcome.replaceAll('_', ' ')}</h2>
              <div className="text-sm">{lastResult.message}</div>
              {lastResult.ticket ? (
                <div className="space-y-1 text-xs">
                  <div>
                    Ticket {lastResult.ticket.publicId} • {lastResult.ticket.seat.sectionName} {lastResult.ticket.seat.row}-{lastResult.ticket.seat.number}
                  </div>
                  <div>{lastResult.ticket.holder.customerName} ({lastResult.ticket.holder.customerEmail})</div>
                  {lastResult.ticket.checkedInAt ? (
                    <button
                      type="button"
                      className="rounded-md border border-amber-500 bg-amber-100 px-2 py-1 text-xs text-amber-900 disabled:opacity-60"
                      disabled={undoBusyTicketId === lastResult.ticket.id || !sessionReady}
                      onClick={() => {
                        void undoCheckIn(lastResult.ticket!);
                      }}
                    >
                      {undoBusyTicketId === lastResult.ticket.id ? 'Undoing...' : 'Undo Check-In'}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}

          <section className="rounded-2xl border border-stone-200 p-4">
            <h2 className="mb-3 font-bold text-stone-900">Recent Scans (This Device)</h2>
            <div className="max-h-[320px] space-y-2 overflow-auto">
              {history.map((item) => (
                <div key={item.id} className="rounded-xl border border-stone-200 p-3 text-sm">
                  <div className="font-semibold text-stone-900">{item.outcome.replaceAll('_', ' ')}</div>
                  <div className="text-xs text-stone-500">{new Date(item.scannedAt).toLocaleString()}</div>
                  <div className="text-xs text-stone-700">{item.message}</div>
                  {item.ticket ? (
                    <div className="mt-1 text-xs text-stone-600">
                      {item.ticket.publicId} • {item.ticket.seat.sectionName} {item.ticket.seat.row}-{item.ticket.seat.number}
                    </div>
                  ) : null}
                </div>
              ))}
              {history.length === 0 ? <div className="text-sm text-stone-500">No scans yet.</div> : null}
            </div>
          </section>
        </div>
      </div>

      <details className="rounded-2xl border border-stone-200 bg-white p-4">
        <summary className="cursor-pointer list-none text-sm font-semibold text-stone-700">
          Advanced Settings
        </summary>

        <div className="mt-4 space-y-6">
          <section className="space-y-3 rounded-2xl border border-stone-200 p-4">
            <h2 className="font-bold text-stone-900">Detailed Status</h2>
            {summary ? (
              <>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                  <StatCard label="Denied" value={`${summary.deniedCount}`} />
                  <StatCard label="Force Admit" value={`${summary.forceAdmitCount}`} />
                  <StatCard label="Sessions" value={`${summary.activeSessions.length}`} />
                </div>
                <div>
                  <div className="mb-2 text-xs font-semibold text-stone-500">Gate Breakdown</div>
                  <div className="flex flex-wrap gap-2">
                    {summary.gateBreakdown.length === 0 ? <span className="text-xs text-stone-500">No check-ins yet.</span> : null}
                    {summary.gateBreakdown.map((item) => (
                      <span key={item.gate} className="rounded-full border border-stone-300 bg-stone-50 px-3 py-1 text-xs">
                        {item.gate}: {item.count}
                      </span>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="text-sm text-stone-500">Loading detailed status...</div>
            )}
          </section>

          <section className="space-y-3 rounded-2xl border border-stone-200 p-4">
            <h2 className="font-bold text-stone-900">Supervisor Controls</h2>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <select value={reasonCode} onChange={(event) => setReasonCode(event.target.value as ReasonCode)} className="rounded-xl border border-stone-300 px-3 py-2 text-sm">
                {reasonOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <input
                value={reasonNotes}
                onChange={(event) => setReasonNotes(event.target.value)}
                placeholder="Reason notes (optional)"
                className="rounded-xl border border-stone-300 px-3 py-2 text-sm"
              />
            </div>

            <form onSubmit={searchLookup} className="flex flex-col gap-2 sm:flex-row">
              <input
                value={lookupQuery}
                onChange={(event) => setLookupQuery(event.target.value)}
                placeholder="Lookup by name, seat, order id, ticket id/public id"
                className="flex-1 rounded-xl border border-stone-300 px-3 py-2 text-sm"
              />
              <button className="w-full rounded-xl border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700 sm:w-auto">Search</button>
            </form>

            <div className="max-h-[340px] space-y-2 overflow-auto">
              {lookupRows.map((ticket) => (
                <div key={ticket.id} className="rounded-xl border border-stone-200 p-3 text-sm">
                  <div className="font-semibold text-stone-900">{ticket.publicId} • {ticket.holder.customerName}</div>
                  <div className="text-xs text-stone-500">
                    {ticket.seat.sectionName} {ticket.seat.row}-{ticket.seat.number} • Order {ticket.order.id} ({ticket.order.status}) • {ticket.checkedInBy || 'Not checked in'}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        void applySupervisorDecision(ticket, 'FORCE_ADMIT');
                      }}
                      disabled={undoBusyTicketId === ticket.id || !sessionReady}
                      className="rounded border border-green-400 bg-green-50 px-2 py-1 text-xs text-green-800 disabled:opacity-60"
                    >
                      Force Admit
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void applySupervisorDecision(ticket, 'DENY');
                      }}
                      disabled={undoBusyTicketId === ticket.id || !sessionReady}
                      className="rounded border border-red-400 bg-red-50 px-2 py-1 text-xs text-red-800 disabled:opacity-60"
                    >
                      Deny
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void undoCheckIn(ticket);
                      }}
                      disabled={undoBusyTicketId === ticket.id || !sessionReady}
                      className="rounded border border-amber-400 bg-amber-50 px-2 py-1 text-xs text-amber-800 disabled:opacity-60"
                    >
                      Undo Check-In
                    </button>
                  </div>
                </div>
              ))}
              {lookupRows.length === 0 ? <div className="text-sm text-stone-500">Search results will appear here.</div> : null}
            </div>
          </section>

          <div className="grid gap-6 xl:grid-cols-2">
            <section className="rounded-2xl border border-stone-200 p-4">
              <h2 className="mb-3 font-bold text-stone-900">Undo / Force Timeline</h2>
              <div className="max-h-[280px] space-y-2 overflow-auto">
                {timeline?.rows.map((row) => (
                  <div key={row.id} className="rounded-xl border border-stone-200 p-3 text-sm">
                    <div className="font-semibold text-stone-900">{row.action}</div>
                    <div className="text-xs text-stone-500">{row.actor} • {new Date(row.createdAt).toLocaleString()}</div>
                    <div className="text-xs text-stone-500">Entity: {row.entityId}</div>
                  </div>
                ))}
                {!timeline || timeline.rows.length === 0 ? <div className="text-sm text-stone-500">No timeline events yet.</div> : null}
              </div>
            </section>

            <section className="space-y-3 rounded-2xl border border-stone-200 p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-bold text-stone-900">Post-Show Analytics</h2>
                {performanceId ? (
                  <button
                    type="button"
                    onClick={() => {
                      void exportAnalyticsCsv();
                    }}
                    disabled={isExportingCsv}
                    className="rounded-lg border border-stone-300 px-3 py-1 text-xs font-semibold text-stone-700"
                  >
                    {isExportingCsv ? 'Exporting...' : 'Export CSV'}
                  </button>
                ) : null}
              </div>

              {analytics ? (
                <>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                    <StatCard label="No-show Est." value={`${analytics.totals.noShowEstimate}`} />
                    <StatCard label="Peak / min" value={`${analytics.peakPerMinute}`} />
                    <StatCard label="Fraud Est." value={`${analytics.attempts.fraudAttemptEstimate}`} />
                    <StatCard label="Duplicates" value={`${analytics.attempts.duplicateAttempts}`} />
                    <StatCard label="Rate" value={`${analytics.totals.checkInRate}%`} />
                  </div>
                  <div className="text-xs text-stone-500">
                    Invalid QR: {analytics.attempts.invalidQrAttempts} • Not found: {analytics.attempts.notFoundAttempts} • Wrong performance: {analytics.attempts.wrongPerformanceAttempts} • Not admitted: {analytics.attempts.notAdmittedAttempts}
                  </div>
                </>
              ) : (
                <div className="text-sm text-stone-500">Loading analytics...</div>
              )}
            </section>
          </div>
        </div>
      </details>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-stone-200 rounded-xl p-3">
      <div className="text-xs uppercase tracking-wide text-stone-500">{label}</div>
      <div className="text-2xl font-bold text-stone-900">{value}</div>
    </div>
  );
}
