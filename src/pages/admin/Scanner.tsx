import { FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminFetch, getAdminToken } from '../../lib/adminAuth';
import { createAdminQrScanner, detectQrCameraSupport } from '../../lib/adminQrScanner';
import { apiUrl } from '../../lib/api';

type PerformanceRow = { id: string; title: string; startsAt: string; isArchived?: boolean };
type ScanOutcome = 'VALID' | 'ALREADY_CHECKED_IN' | 'WRONG_PERFORMANCE' | 'NOT_ADMITTED' | 'INVALID_QR' | 'NOT_FOUND';
type ReasonCode = 'DUPLICATE_SCAN' | 'VIP_OVERRIDE' | 'PAYMENT_EXCEPTION' | 'INVALID_TICKET' | 'SAFETY_CONCERN' | 'MANUAL_CORRECTION' | 'OTHER';

type ScannedTicket = {
  id: string; publicId: string; performanceId: string; performanceTitle: string;
  startsAt: string; venue: string;
  seat: { sectionName: string; row: string; number: number };
  holder: { customerName: string; customerEmail: string };
  order: { id: string; status: string };
  checkedInAt: string | null; checkedInBy: string | null; checkInGate: string | null;
  admissionDecision: 'FORCE_ADMIT' | 'DENY' | null; admissionReason: string | null;
};
type ScanResponse = { outcome: ScanOutcome; message: string; scannedAt: string; ticket?: ScannedTicket };
type ScanHistoryItem = ScanResponse & { id: string };
type ScannerSession = { sessionId: string; sessionToken: string; performanceId: string; staffName: string; gate: string; deviceLabel: string | null; createdAt: string };
type CheckInSummary = {
  performance: { id: string; title: string; startsAt: string; venue: string };
  totalCheckedIn: number; totalAdmittable: number; deniedCount: number; forceAdmitCount: number;
  gateBreakdown: Array<{ gate: string; count: number }>;
  activeSessions: Array<{ id: string; staffName: string; gate: string; deviceLabel: string | null; startedAt: string; lastSeenAt: string }>;
  recent: Array<{ id: string; publicId: string; checkedInAt: string | null; checkedInBy: string | null; checkInGate: string; seat: { sectionName: string; row: string; number: number }; holder: { customerName: string; customerEmail: string } }>;
};
type UndoResponse = { success: boolean; message: string; ticket?: ScannedTicket };
type LookupResult = ScannedTicket & { ticketStatus: string; ticketType: string; createdAt: string };
type TimelineResponse = { page: number; pageSize: number; total: number; rows: Array<{ id: string; action: string; actor: string; entityId: string; createdAt: string; metadata: unknown }> };
type AnalyticsResponse = {
  performance: { id: string; title: string; startsAt: string; venue: string };
  totals: { totalAdmittable: number; totalCheckedIn: number; noShowEstimate: number; checkInRate: number };
  attempts: { duplicateAttempts: number; invalidQrAttempts: number; notFoundAttempts: number; wrongPerformanceAttempts: number; notAdmittedAttempts: number; fraudAttemptEstimate: number };
  supervisorDecisions: { forceAdmitCount: number; denyCount: number };
  peakPerMinute: number; byGate: Array<{ gate: string; count: number }>; timeline: Array<{ minute: string; count: number }>;
};
type OfflineQueueItem = { id: string; performanceId: string; sessionToken: string; scannedValue: string; clientScanId: string; queuedAt: string };

const SESSION_STORAGE_KEY = 'theater_scanner_sessions_v1';
const OFFLINE_QUEUE_KEY = 'theater_scanner_queue_v1';

const reasonOptions: Array<{ value: ReasonCode; label: string }> = [
  { value: 'DUPLICATE_SCAN', label: 'Duplicate scan' }, { value: 'VIP_OVERRIDE', label: 'VIP override' },
  { value: 'PAYMENT_EXCEPTION', label: 'Payment exception' }, { value: 'INVALID_TICKET', label: 'Invalid ticket' },
  { value: 'SAFETY_CONCERN', label: 'Safety concern' }, { value: 'MANUAL_CORRECTION', label: 'Manual correction' },
  { value: 'OTHER', label: 'Other' },
];

const outcomeConfig: Record<ScanOutcome, { label: string; icon: string; pill: string; card: string; text: string }> = {
  VALID:              { label: 'Admitted',   icon: '✓', pill: 'bg-emerald-500/15 text-emerald-400 ring-emerald-500/30', card: 'bg-emerald-950/60 ring-1 ring-emerald-700', text: 'text-emerald-300' },
  ALREADY_CHECKED_IN: { label: 'Already In', icon: '!', pill: 'bg-amber-500/15 text-amber-400 ring-amber-500/30',     card: 'bg-amber-950/60 ring-1 ring-amber-700',     text: 'text-amber-300'   },
  WRONG_PERFORMANCE:  { label: 'Wrong Show', icon: '✕', pill: 'bg-orange-500/15 text-orange-400 ring-orange-500/30', card: 'bg-orange-950/60 ring-1 ring-orange-700',   text: 'text-orange-300'  },
  NOT_ADMITTED:       { label: 'Denied',     icon: '✕', pill: 'bg-red-500/15 text-red-400 ring-red-500/30',           card: 'bg-red-950/60 ring-1 ring-red-700',         text: 'text-red-300'     },
  INVALID_QR:         { label: 'Invalid QR', icon: '✕', pill: 'bg-red-500/15 text-red-400 ring-red-500/30',           card: 'bg-red-950/60 ring-1 ring-red-700',         text: 'text-red-300'     },
  NOT_FOUND:          { label: 'Not Found',  icon: '✕', pill: 'bg-red-500/15 text-red-400 ring-red-500/30',           card: 'bg-red-950/60 ring-1 ring-red-700',         text: 'text-red-300'     },
};

function makeClientId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
function parseJsonSafe<T>(v: string | null, fb: T): T {
  if (!v) return fb;
  try { return JSON.parse(v) as T; } catch { return fb; }
}
function readStoredSessions(): Record<string, ScannerSession> {
  return parseJsonSafe(localStorage.getItem(SESSION_STORAGE_KEY), {} as Record<string, ScannerSession>);
}
function writeStoredSessions(s: Record<string, ScannerSession>) { localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(s)); }
function readOfflineQueue(): OfflineQueueItem[] { return parseJsonSafe(localStorage.getItem(OFFLINE_QUEUE_KEY), [] as OfflineQueueItem[]); }
function writeOfflineQueue(items: OfflineQueueItem[]) { localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(items)); }
function isNetworkError(err: unknown) {
  if (!(err instanceof Error)) return false;
  const m = err.message.toLowerCase();
  return m.includes('failed to fetch') || m.includes('network') || m.includes('load failed');
}
function vibrate(p: number | number[]) { try { navigator.vibrate?.(p); } catch {} }
function beep(ok: boolean) {
  try {
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx(), osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = 'sine'; osc.frequency.value = ok ? 900 : 260; g.gain.value = ok ? 0.08 : 0.12;
    osc.connect(g); g.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + (ok ? 0.08 : 0.15));
    osc.onended = () => ctx.close();
  } catch {}
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">{children}</p>;
}

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl bg-zinc-900 ring-1 ring-zinc-800 ${className}`}>{children}</div>;
}

function Stat({ label, value, red }: { label: string; value: string; red?: boolean }) {
  return (
    <div className="rounded-xl bg-zinc-950 p-3 ring-1 ring-zinc-800">
      <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">{label}</p>
      <p className={`mt-0.5 text-2xl font-bold tabular-nums ${red ? 'text-red-400' : 'text-white'}`}>{value}</p>
    </div>
  );
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
  const [lookupBusyId, setLookupBusyId] = useState<string | null>(null);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [summary, setSummary] = useState<CheckInSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<TimelineResponse | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [lastResult, setLastResult] = useState<ScanResponse | null>(null);
  const [history, setHistory] = useState<ScanHistoryItem[]>([]);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [offlineQueue, setOfflineQueue] = useState<OfflineQueueItem[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [realtimeOk, setRealtimeOk] = useState(false);
  const [exportingCsv, setExportingCsv] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hwInputRef = useRef<HTMLInputElement | null>(null);
  const scannerRef = useRef<ReturnType<typeof createAdminQrScanner> | null>(null);
  const scanBusy = useRef(false);
  const lastScanned = useRef<{ value: string; at: number } | null>(null);
  const hwBuf = useRef('');
  const hwTimer = useRef<number | null>(null);

  const selectedPerf = useMemo(() => performances.find(p => p.id === performanceId), [performances, performanceId]);
  const sessionReady = Boolean(scannerSession?.performanceId === performanceId);
  const pct = summary?.totalAdmittable ? Math.min(100, Math.round(summary.totalCheckedIn / summary.totalAdmittable * 100)) : 0;

  const stopCamera = () => {
    scannerRef.current?.stop();
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraRunning(false);
  };

  const loadSummary = async (pid = performanceId) => {
    if (!pid) { setSummary(null); return; }
    try { const d = await adminFetch<CheckInSummary>(`/api/admin/check-in/summary?performanceId=${pid}`); setSummary(d); setSummaryError(null); }
    catch (e) { setSummaryError(e instanceof Error ? e.message : 'Failed'); }
  };
  const loadTimeline = async (pid = performanceId) => {
    if (!pid) return;
    try { setTimeline(await adminFetch<TimelineResponse>(`/api/admin/check-in/timeline?performanceId=${pid}&page=1&pageSize=100`)); } catch {}
  };
  const loadAnalytics = async (pid = performanceId) => {
    if (!pid) return;
    try { setAnalytics(await adminFetch<AnalyticsResponse>(`/api/admin/check-in/analytics?performanceId=${pid}`)); } catch {}
  };
  const reloadAll = (pid = performanceId) => Promise.all([loadSummary(pid), loadTimeline(pid), loadAnalytics(pid)]);

  const sendScanRequest = (params: { scannedValue: string; clientScanId?: string; offlineQueuedAt?: string; performanceIdOverride?: string; sessionTokenOverride?: string }) => {
    if (!sessionReady && !params.sessionTokenOverride) throw new Error('No session');
    return adminFetch<ScanResponse>('/api/admin/check-in/scan', {
      method: 'POST',
      body: JSON.stringify({ performanceId: params.performanceIdOverride ?? performanceId, sessionToken: params.sessionTokenOverride ?? scannerSession!.sessionToken, scannedValue: params.scannedValue, clientScanId: params.clientScanId ?? makeClientId(), offlineQueuedAt: params.offlineQueuedAt }),
    });
  };

  const enqueueOffline = (item: Omit<OfflineQueueItem, 'id' | 'queuedAt'>) => {
    const q: OfflineQueueItem = { id: makeClientId(), queuedAt: new Date().toISOString(), ...item };
    const next = [...readOfflineQueue(), q]; writeOfflineQueue(next); setOfflineQueue(next);
    setNotice({ kind: 'err', text: `Offline — queued (${next.length} pending)` });
  };

  const submitScan = async (val: string) => {
    if (!performanceId || !sessionReady) { setNotice({ kind: 'err', text: 'Start a session first.' }); return; }
    scanBusy.current = true; setBusy(true); setNotice(null);
    const cid = makeClientId();
    try {
      if (!navigator.onLine) { enqueueOffline({ performanceId, sessionToken: scannerSession!.sessionToken, scannedValue: val, clientScanId: cid }); return; }
      const r = await sendScanRequest({ scannedValue: val, clientScanId: cid });
      setLastResult(r);
      setHistory(h => [{ ...r, id: makeClientId() }, ...h].slice(0, 30));
      if (r.ticket) setLookupRows(rows => rows.map(row => row.id === r.ticket!.id ? { ...row, ...r.ticket! } : row));
      vibrate(r.outcome === 'VALID' ? 50 : [80, 30, 80]); beep(r.outcome === 'VALID');
      await reloadAll();
    } catch (err) {
      if (isNetworkError(err)) enqueueOffline({ performanceId, sessionToken: scannerSession!.sessionToken, scannedValue: val, clientScanId: cid });
      else {
        const fb: ScanResponse = { outcome: 'INVALID_QR', message: err instanceof Error ? err.message : 'Scan failed', scannedAt: new Date().toISOString() };
        setLastResult(fb); setHistory(h => [{ ...fb, id: makeClientId() }, ...h].slice(0, 30));
        vibrate([80, 30, 80]); beep(false);
      }
    } finally { setBusy(false); scanBusy.current = false; }
  };

  const syncOfflineQueue = async () => {
    if (isSyncing) return;
    const q = readOfflineQueue(); if (!q.length) return;
    setIsSyncing(true);
    try {
      const stored = readStoredSessions(); const remaining: OfflineQueueItem[] = []; let blocked: string | null = null;
      for (let i = 0; i < q.length; i++) {
        const item = q[i];
        const tok = (item.performanceId === performanceId && scannerSession?.performanceId === item.performanceId ? scannerSession.sessionToken : stored[item.performanceId]?.sessionToken) ?? item.sessionToken;
        try {
          const r = await sendScanRequest({ scannedValue: item.scannedValue, clientScanId: item.clientScanId, offlineQueuedAt: item.queuedAt, performanceIdOverride: item.performanceId, sessionTokenOverride: tok });
          setLastResult(r); setHistory(h => [{ ...r, id: makeClientId() }, ...h].slice(0, 30));
          vibrate(r.outcome === 'VALID' ? 50 : [80, 30, 80]); beep(r.outcome === 'VALID');
        } catch (err) {
          if (isNetworkError(err)) { remaining.push(item, ...q.slice(i + 1)); break; }
          const m = err instanceof Error ? err.message.toLowerCase() : '';
          if (m.includes('session is not active') || m.includes('unauthorized') || m.includes('forbidden')) { remaining.push(item, ...q.slice(i + 1)); blocked = 'Sync paused — start a session first.'; break; }
        }
      }
      writeOfflineQueue(remaining); setOfflineQueue(remaining);
      if (!remaining.length) setNotice({ kind: 'ok', text: 'Offline queue synced.' });
      else setNotice({ kind: 'err', text: blocked ?? `${remaining.length} scan(s) still queued.` });
      await reloadAll();
    } finally { setIsSyncing(false); }
  };

  const persistSession = (s: ScannerSession | null) => {
    const all = readStoredSessions();
    if (!s) delete all[performanceId]; else all[s.performanceId] = s;
    writeStoredSessions(all);
  };

  const startSession = async (e: FormEvent) => {
    e.preventDefault(); if (!performanceId) return;
    try {
      const s = await adminFetch<ScannerSession>('/api/admin/check-in/session/start', { method: 'POST', body: JSON.stringify({ performanceId, staffName: sessionDraft.staffName.trim(), gate: sessionDraft.gate.trim(), deviceLabel: sessionDraft.deviceLabel.trim() || undefined }) });
      setScannerSession(s); setSessionDraft(d => ({ ...d, gate: s.gate })); persistSession(s);
      setNotice({ kind: 'ok', text: `Session started — ${s.staffName} @ ${s.gate}` });
      await reloadAll();
    } catch (err) { setNotice({ kind: 'err', text: err instanceof Error ? err.message : 'Failed' }); }
  };

  const endSession = async () => {
    if (!scannerSession) return;
    try {
      await adminFetch('/api/admin/check-in/session/end', { method: 'POST', body: JSON.stringify({ sessionToken: scannerSession.sessionToken }) });
      setScannerSession(null); persistSession(null); setNotice({ kind: 'ok', text: 'Session ended.' });
    } catch (err) { setNotice({ kind: 'err', text: err instanceof Error ? err.message : 'Failed' }); }
  };

  const startCamera = async () => {
    setCameraError(null);
    if (cameraRunning) return;
    if (!sessionReady) { setCameraError('Start a session first.'); return; }
    if (!cameraSupported) { setCameraError('Camera unsupported on this browser.'); return; }
    try { await (screen as any).orientation?.lock?.('portrait').catch(() => {}); } catch {}
    try {
      const video = videoRef.current;
      if (!video) throw new Error('Video element missing');
      if (!scannerRef.current) {
        scannerRef.current = createAdminQrScanner({
          video,
          onDecode: val => {
            if (scanBusy.current) return;
            const now = Date.now(), last = lastScanned.current;
            if (last && last.value === val && now - last.at < 1500) return;
            lastScanned.current = { value: val, at: now };
            void submitScan(val);
          },
        });
      }
      await scannerRef.current.start();
      setCameraRunning(true);
    } catch (err) { stopCamera(); setCameraError(err instanceof Error ? err.message : 'Camera error'); }
  };

  const searchLookup = async (e: FormEvent) => {
    e.preventDefault(); if (!performanceId || !lookupQuery.trim()) return;
    try { setLookupRows(await adminFetch<LookupResult[]>(`/api/admin/check-in/lookup?performanceId=${performanceId}&q=${encodeURIComponent(lookupQuery.trim())}&limit=40`)); }
    catch (err) { setNotice({ kind: 'err', text: err instanceof Error ? err.message : 'Lookup failed' }); }
  };

  const undoCheckIn = async (ticket: ScannedTicket) => {
    if (!sessionReady) return; setActionBusyId(ticket.id); setNotice(null);
    try {
      const r = await adminFetch<UndoResponse>('/api/admin/check-in/undo', { method: 'POST', body: JSON.stringify({ performanceId, sessionToken: scannerSession!.sessionToken, ticketId: ticket.id, reasonCode, notes: reasonNotes.trim() || undefined }) });
      setNotice({ kind: r.success ? 'ok' : 'err', text: r.message });
      if (r.ticket) {
        setLastResult(c => c?.ticket?.id === ticket.id ? { ...c, ticket: r.ticket! } : c);
        setHistory(h => h.map(row => row.ticket?.id === ticket.id ? { ...row, ticket: r.ticket! } : row));
        setLookupRows(rows => rows.map(row => row.id === ticket.id ? { ...row, ...r.ticket! } : row));
      }
      await reloadAll();
    } catch (err) { setNotice({ kind: 'err', text: err instanceof Error ? err.message : 'Failed' }); }
    finally { setActionBusyId(null); }
  };

  const applyDecision = async (ticket: LookupResult, decision: 'FORCE_ADMIT' | 'DENY') => {
    if (!sessionReady) { setNotice({ kind: 'err', text: 'Start a session first.' }); return; }
    setActionBusyId(ticket.id); setNotice(null);
    try {
      const r = await adminFetch<{ success: boolean; message: string; ticket?: ScannedTicket }>('/api/admin/check-in/force-decision', { method: 'POST', body: JSON.stringify({ performanceId, sessionToken: scannerSession!.sessionToken, ticketId: ticket.id, decision, reasonCode, notes: reasonNotes.trim() || undefined }) });
      setNotice({ kind: 'ok', text: r.message });
      if (r.ticket) {
        setLastResult(c => c?.ticket?.id === ticket.id ? { ...c, ticket: r.ticket! } : c);
        setLookupRows(rows => rows.map(row => row.id === ticket.id ? { ...row, ...r.ticket! } : row));
      }
      await reloadAll();
    } catch (err) { setNotice({ kind: 'err', text: err instanceof Error ? err.message : 'Failed' }); }
    finally { setActionBusyId(null); }
  };

  const checkInFromLookup = async (ticket: LookupResult) => {
    if (busy || lookupBusyId) return;
    setLookupBusyId(ticket.id);
    try { await submitScan(ticket.publicId); } finally { setLookupBusyId(null); }
  };

  const exportCsv = async () => {
    if (!performanceId || exportingCsv) return;
    const token = getAdminToken();
    if (!token) { setNotice({ kind: 'err', text: 'Session expired.' }); return; }
    setExportingCsv(true); setNotice(null);
    try {
      const res = await fetch(apiUrl(`/api/admin/check-in/analytics.csv?performanceId=${encodeURIComponent(performanceId)}`), { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) { const b = await res.json().catch(() => null) as any; throw new Error(b?.error ?? `Export failed (${res.status})`); }
      const blob = await res.blob(); const disp = res.headers.get('content-disposition') ?? '';
      const nm = disp.match(/filename="([^"]+)"/i)?.[1] ?? `checkin-${performanceId}.csv`;
      const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = nm;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      setNotice({ kind: 'ok', text: 'CSV downloaded.' });
    } catch (err) { setNotice({ kind: 'err', text: err instanceof Error ? err.message : 'Export failed' }); }
    finally { setExportingCsv(false); }
  };

  useEffect(() => {
    setOfflineQueue(readOfflineQueue());
    let cancelled = false;
    detectQrCameraSupport().then(ok => { if (!cancelled) setCameraSupported(ok); });
    adminFetch<PerformanceRow[]>('/api/admin/performances?scope=active')
      .then(rows => { const a = rows.filter(r => !r.isArchived); setPerformances(a); if (a.length) setPerformanceId(a[0].id); })
      .catch(err => setCameraError(err instanceof Error ? err.message : 'Failed to load'));
    const onOnline = () => syncOfflineQueue();
    window.addEventListener('online', onOnline);
    return () => { cancelled = true; stopCamera(); scannerRef.current?.destroy(); scannerRef.current = null; window.removeEventListener('online', onOnline); };
  }, []);

  useEffect(() => {
    if (!performanceId) return;
    const stored = readStoredSessions()[performanceId];
    setScannerSession(stored ?? null);
    if (stored) setSessionDraft(d => ({ ...d, staffName: stored.staffName, gate: stored.gate }));
    setLastResult(null); setHistory([]); setLookupRows([]); setLookupQuery(''); setNotice(null);
    reloadAll(performanceId);
  }, [performanceId]);

  useEffect(() => {
    const token = getAdminToken();
    if (!token || !performanceId || !sessionReady) { setRealtimeOk(false); return; }
    const src = new EventSource(apiUrl(`/api/admin/check-in/events?performanceId=${encodeURIComponent(performanceId)}&token=${encodeURIComponent(token)}`));
    src.onopen = () => setRealtimeOk(true); src.onerror = () => setRealtimeOk(false);
    src.addEventListener('checkin', () => reloadAll(performanceId));
    src.addEventListener('decision', () => reloadAll(performanceId));
    src.addEventListener('session', () => loadSummary(performanceId));
    return () => { src.close(); setRealtimeOk(false); };
  }, [performanceId, sessionReady]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!sessionReady) return;
      const t = e.target as HTMLElement | null;
      if (t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.getAttribute('contenteditable') === 'true') return;
      if (e.key === 'Enter') {
        const v = hwBuf.current.trim(); hwBuf.current = '';
        if (hwTimer.current) { clearTimeout(hwTimer.current); hwTimer.current = null; }
        if (v) submitScan(v); return;
      }
      if (e.key.length === 1) {
        hwBuf.current += e.key;
        if (hwTimer.current) clearTimeout(hwTimer.current);
        hwTimer.current = window.setTimeout(() => { hwBuf.current = ''; hwTimer.current = null; }, 250);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sessionReady]);

  const submitManual = (e: FormEvent) => {
    e.preventDefault(); const v = manualValue.trim(); if (!v || busy) return;
    setManualValue(''); submitScan(v);
  };

  return (
    <div className="w-full space-y-4 pb-16" style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }}>

      {/* Page header — no sticky, no conflicts */}
      <div className="flex items-start justify-between gap-3 pt-1">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-zinc-100">Ticket Scanner</h1>
          {selectedPerf && (
            <p className="mt-0.5 max-w-[200px] truncate text-xs text-zinc-500 sm:max-w-none">
              {selectedPerf.title} · {new Date(selectedPerf.startsAt).toLocaleString()}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-0.5">
          <span className={`h-2 w-2 rounded-full ${realtimeOk ? 'bg-emerald-400' : 'bg-zinc-600'}`} title={realtimeOk ? 'Realtime connected' : 'Realtime off'} />
          <span className={`h-2 w-2 rounded-full ${navigator.onLine ? 'bg-emerald-400' : 'bg-red-400'}`} title={navigator.onLine ? 'Online' : 'Offline'} />
          {offlineQueue.length > 0 && (
            <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-black">{offlineQueue.length}</span>
          )}
          <Link to="/admin/scanner/live" className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-300 ring-1 ring-zinc-700 hover:bg-zinc-700">
            Full Screen
          </Link>
        </div>
      </div>

      {/* Notice */}
      {notice && (
        <div className={`rounded-xl px-4 py-3 text-sm font-medium ring-1 ${notice.kind === 'ok' ? 'bg-emerald-950 text-emerald-300 ring-emerald-800' : 'bg-red-950 text-red-300 ring-red-800'}`}>
          {notice.text}
        </div>
      )}

      {/* ── SESSION SETUP ── */}
      <Card>
        <div className="p-4 space-y-2.5">
          <SectionLabel>Session Setup</SectionLabel>

          <select
            value={performanceId}
            onChange={e => setPerformanceId(e.target.value)}
            className="w-full rounded-xl bg-zinc-800 px-4 py-3 text-sm text-zinc-100 ring-1 ring-zinc-700 focus:outline-none focus:ring-red-600"
          >
            {performances.map(p => <option key={p.id} value={p.id}>{p.title} — {new Date(p.startsAt).toLocaleString()}</option>)}
          </select>

          {sessionReady ? (
            <div className="flex items-center justify-between gap-3 rounded-xl bg-emerald-950 px-4 py-3 ring-1 ring-emerald-800">
              <div>
                <p className="text-sm font-bold text-emerald-300">{scannerSession!.staffName} · {scannerSession!.gate}</p>
                <p className="text-xs text-emerald-700">Since {new Date(scannerSession!.createdAt).toLocaleTimeString()}</p>
              </div>
              <button onClick={endSession} className="shrink-0 rounded-lg bg-red-950 px-3 py-2 text-xs font-semibold text-red-400 ring-1 ring-red-800 active:bg-red-900">
                End Session
              </button>
            </div>
          ) : (
            <form onSubmit={startSession} className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input value={sessionDraft.staffName} onChange={e => setSessionDraft({ ...sessionDraft, staffName: e.target.value })} placeholder="Your name" required className="rounded-xl bg-zinc-800 px-3 py-3 text-sm text-zinc-100 placeholder-zinc-600 ring-1 ring-zinc-700 focus:outline-none focus:ring-red-600" />
                <input value={sessionDraft.gate} onChange={e => setSessionDraft({ ...sessionDraft, gate: e.target.value })} placeholder="Gate" required className="rounded-xl bg-zinc-800 px-3 py-3 text-sm text-zinc-100 placeholder-zinc-600 ring-1 ring-zinc-700 focus:outline-none focus:ring-red-600" />
              </div>
              <input value={sessionDraft.deviceLabel} onChange={e => setSessionDraft({ ...sessionDraft, deviceLabel: e.target.value })} placeholder="Device label (optional)" className="w-full rounded-xl bg-zinc-800 px-3 py-3 text-sm text-zinc-100 placeholder-zinc-600 ring-1 ring-zinc-700 focus:outline-none focus:ring-red-600" />
              <button type="submit" className="w-full rounded-xl bg-red-600 py-3.5 text-sm font-bold text-white active:bg-red-700">
                Start Session
              </button>
            </form>
          )}

          {offlineQueue.length > 0 && (
            <button onClick={() => syncOfflineQueue()} disabled={isSyncing} className="w-full rounded-xl bg-amber-950 py-3 text-sm font-semibold text-amber-300 ring-1 ring-amber-800 disabled:opacity-60 active:bg-amber-900">
              {isSyncing ? 'Syncing…' : `Sync Offline Queue (${offlineQueue.length})`}
            </button>
          )}
        </div>
      </Card>

      {/* ── CAMERA ── */}
      <Card className="overflow-hidden">
        <div className="relative bg-black">
          <video ref={videoRef} className="h-60 w-full object-cover sm:h-72" playsInline muted />
          {!cameraRunning && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
              <svg className="h-9 w-9 text-zinc-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
              </svg>
              <span className="text-xs text-zinc-600">Camera off</span>
            </div>
          )}
          {cameraRunning && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="relative h-40 w-40">
                <span className="absolute left-0 top-0 h-7 w-7 border-l-2 border-t-2 border-red-500" />
                <span className="absolute right-0 top-0 h-7 w-7 border-r-2 border-t-2 border-red-500" />
                <span className="absolute bottom-0 left-0 h-7 w-7 border-b-2 border-l-2 border-red-500" />
                <span className="absolute bottom-0 right-0 h-7 w-7 border-b-2 border-r-2 border-red-500" />
              </div>
            </div>
          )}
        </div>
        <div className="p-3 space-y-2">
          <button onClick={() => cameraRunning ? stopCamera() : startCamera()} disabled={!sessionReady} className={`w-full rounded-xl py-3.5 text-sm font-bold transition-transform disabled:opacity-50 active:scale-[0.99] ${cameraRunning ? 'bg-zinc-800 text-zinc-300 ring-1 ring-zinc-700' : 'bg-red-600 text-white'}`}>
            {cameraRunning ? 'Stop Camera' : 'Start Camera'}
          </button>
          {(cameraError || (!cameraSupported && !cameraRunning)) && (
            <p className="px-1 text-xs text-amber-400">{cameraError ?? 'Camera unsupported — use manual input.'}</p>
          )}
        </div>
      </Card>

      {/* ── LAST SCAN RESULT ── */}
      {lastResult ? (() => {
        const cfg = outcomeConfig[lastResult.outcome];
        return (
          <div className={`rounded-2xl p-4 ${cfg.card}`}>
            <div className="flex items-start gap-3">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base font-bold ring-1 ${cfg.pill}`}>{cfg.icon}</span>
              <div className="min-w-0 flex-1">
                <p className={`text-[10px] font-bold uppercase tracking-widest ${cfg.text}`}>{cfg.label}</p>
                <p className="mt-0.5 text-sm text-zinc-200">{lastResult.message}</p>
                {lastResult.ticket && (
                  <div className="mt-2 space-y-0.5 text-xs text-zinc-400">
                    <p className="font-semibold text-zinc-100">{lastResult.ticket.holder.customerName}</p>
                    <p>{lastResult.ticket.holder.customerEmail}</p>
                    <p>{lastResult.ticket.seat.sectionName} · Row {lastResult.ticket.seat.row} · Seat {lastResult.ticket.seat.number}</p>
                  </div>
                )}
                {lastResult.ticket?.checkedInAt && (
                  <button disabled={actionBusyId === lastResult.ticket.id || !sessionReady} onClick={() => undoCheckIn(lastResult.ticket!)} className="mt-3 rounded-lg bg-amber-950 px-3 py-2 text-xs font-semibold text-amber-300 ring-1 ring-amber-800 disabled:opacity-50 active:bg-amber-900">
                    {actionBusyId === lastResult.ticket.id ? 'Undoing…' : 'Undo Check-In'}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })() : (
        <Card>
          <div className="flex items-center gap-3 px-4 py-4">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-800 ring-1 ring-zinc-700">
              <svg className="h-4 w-4 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="10" /><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01" /></svg>
            </span>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">Latest Scan</p>
              <p className="text-sm font-medium text-zinc-400">Ready to scan</p>
            </div>
          </div>
        </Card>
      )}

      {/* ── MANUAL INPUT ── */}
      <Card>
        <div className="p-4 space-y-2.5">
          <SectionLabel>Manual / Hardware Input</SectionLabel>
          <form onSubmit={submitManual} className="flex gap-2">
            <input ref={hwInputRef} value={manualValue} onChange={e => setManualValue(e.target.value)} placeholder="QR payload, ticket URL, or ID" className="min-w-0 flex-1 rounded-xl bg-zinc-800 px-4 py-3 text-sm text-zinc-100 placeholder-zinc-600 ring-1 ring-zinc-700 focus:outline-none focus:ring-red-600" />
            <button disabled={busy || !sessionReady} className="shrink-0 rounded-xl bg-zinc-800 px-4 py-3 text-sm font-semibold text-zinc-300 ring-1 ring-zinc-700 disabled:opacity-50 active:bg-zinc-700">
              {busy ? '…' : 'Go'}
            </button>
          </form>
        </div>
      </Card>

      {/* ── LIVE STATUS ── */}
      <Card>
        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <SectionLabel>Live Status</SectionLabel>
            <button onClick={() => reloadAll()} className="-mt-2.5 rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-400 ring-1 ring-zinc-700 hover:bg-zinc-700">
              Refresh
            </button>
          </div>
          {summary ? (
            <>
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Checked In" value={String(summary.totalCheckedIn)} />
                <Stat label="Admittable" value={String(summary.totalAdmittable)} />
                <Stat label="Rate" value={`${pct}%`} red />
              </div>
              <div>
                <div className="mb-1.5 flex justify-between text-xs text-zinc-600">
                  <span>Progress</span><span>{pct}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                  <div className="h-full rounded-full bg-red-600 transition-all duration-500" style={{ width: `${pct}%` }} />
                </div>
              </div>
            </>
          ) : (
            <p className="text-sm text-zinc-600">{summaryError ?? 'Loading…'}</p>
          )}
        </div>
      </Card>

      {/* ── FALLBACK / GUEST LOOKUP ── */}
      <Card>
        <div className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-red-500">Fallback Check-In</p>
              <h3 className="text-sm font-bold text-zinc-100">Search by name or email</h3>
            </div>
            {lookupRows.length > 0 && (
              <span className="mt-0.5 rounded-full bg-zinc-800 px-2.5 py-0.5 text-xs font-semibold text-zinc-400 ring-1 ring-zinc-700">{lookupRows.length}</span>
            )}
          </div>
          <form onSubmit={searchLookup} className="flex gap-2">
            <input value={lookupQuery} onChange={e => setLookupQuery(e.target.value)} placeholder="Name, email, seat, order ID…" className="min-w-0 flex-1 rounded-xl bg-zinc-800 px-4 py-3 text-sm text-zinc-100 placeholder-zinc-600 ring-1 ring-zinc-700 focus:outline-none focus:ring-red-600" />
            <button disabled={!performanceId} className="shrink-0 rounded-xl bg-red-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50 active:bg-red-700">Search</button>
          </form>
          <div className="grid grid-cols-2 gap-2">
            <select value={reasonCode} onChange={e => setReasonCode(e.target.value as ReasonCode)} className="rounded-xl bg-zinc-800 px-3 py-2.5 text-xs text-zinc-300 ring-1 ring-zinc-700 focus:outline-none">
              {reasonOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <input value={reasonNotes} onChange={e => setReasonNotes(e.target.value)} placeholder="Reason notes" className="rounded-xl bg-zinc-800 px-3 py-2.5 text-xs text-zinc-300 placeholder-zinc-600 ring-1 ring-zinc-700 focus:outline-none" />
          </div>
        </div>

        <div className="max-h-[420px] divide-y divide-zinc-800 overflow-auto">
          {lookupRows.map(ticket => {
            const ci = Boolean(ticket.checkedInAt), denied = ticket.admissionDecision === 'DENY';
            const lBusy = lookupBusyId === ticket.id, aBusy = actionBusyId === ticket.id;
            return (
              <div key={ticket.id} className="px-4 py-4 space-y-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-zinc-100">{ticket.holder.customerName}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${ci ? 'bg-emerald-900 text-emerald-300' : denied ? 'bg-red-900 text-red-300' : 'bg-amber-900 text-amber-300'}`}>
                      {ci ? 'In' : denied ? 'Denied' : 'Ready'}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-zinc-500">{ticket.holder.customerEmail}</p>
                  <p className="text-xs text-zinc-600">{ticket.seat.sectionName} · R{ticket.seat.row}–{ticket.seat.number} · #{ticket.publicId}</p>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <button onClick={() => checkInFromLookup(ticket)} disabled={!sessionReady || ci || busy || Boolean(lookupBusyId) || aBusy} className="rounded-lg bg-red-600 py-2.5 text-xs font-bold text-white disabled:opacity-50 active:bg-red-700">
                    {lBusy ? '…' : ci ? 'Checked In' : 'Check In'}
                  </button>
                  <button onClick={() => undoCheckIn(ticket)} disabled={aBusy || busy || Boolean(lookupBusyId) || !sessionReady || !ci} className="rounded-lg bg-amber-950 py-2.5 text-xs font-semibold text-amber-300 ring-1 ring-amber-800 disabled:opacity-50 active:bg-amber-900">
                    {aBusy ? '…' : 'Undo'}
                  </button>
                  <button onClick={() => applyDecision(ticket, 'FORCE_ADMIT')} disabled={aBusy || busy || Boolean(lookupBusyId) || !sessionReady} className="rounded-lg bg-emerald-950 py-2.5 text-xs font-semibold text-emerald-300 ring-1 ring-emerald-800 disabled:opacity-50 active:bg-emerald-900">
                    Force Admit
                  </button>
                  <button onClick={() => applyDecision(ticket, 'DENY')} disabled={aBusy || busy || Boolean(lookupBusyId) || !sessionReady} className="rounded-lg bg-red-950 py-2.5 text-xs font-semibold text-red-400 ring-1 ring-red-900 disabled:opacity-50 active:bg-red-900">
                    Deny
                  </button>
                </div>
              </div>
            );
          })}
          {!lookupRows.length && (
            <div className="px-4 py-8 text-center text-sm text-zinc-600">
              {lookupQuery.trim() ? 'No guests found.' : 'Search results appear here.'}
            </div>
          )}
        </div>
      </Card>

      {/* ── RECENT SCANS ── */}
      <Card>
        <div className="px-4 pt-4 pb-2">
          <SectionLabel>Recent Scans · This Device</SectionLabel>
        </div>
        <div className="max-h-64 divide-y divide-zinc-800 overflow-auto">
          {history.map(item => {
            const cfg = outcomeConfig[item.outcome];
            return (
              <div key={item.id} className="flex items-center gap-3 px-4 py-3">
                <span className={`shrink-0 text-base font-bold ${cfg.text}`}>{cfg.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className={`text-xs font-bold uppercase tracking-wide ${cfg.text}`}>{cfg.label}</p>
                  {item.ticket && <p className="truncate text-xs text-zinc-500">{item.ticket.holder.customerName} · {item.ticket.seat.sectionName} {item.ticket.seat.row}–{item.ticket.seat.number}</p>}
                </div>
                <p className="shrink-0 text-xs text-zinc-700">{new Date(item.scannedAt).toLocaleTimeString()}</p>
              </div>
            );
          })}
          {!history.length && <p className="px-4 py-6 text-center text-sm text-zinc-700">No scans yet.</p>}
        </div>
      </Card>

      {/* ── ADVANCED ── */}
      <details className="rounded-2xl bg-zinc-900 ring-1 ring-zinc-800 overflow-hidden">
        <summary className="flex cursor-pointer select-none items-center justify-between px-4 py-4">
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Advanced</span>
          <svg className="h-4 w-4 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
        </summary>
        <div className="space-y-5 border-t border-zinc-800 p-4">
          {summary && (
            <div>
              <SectionLabel>Detailed Status</SectionLabel>
              <div className="grid grid-cols-3 gap-2 mb-3">
                <Stat label="Denied" value={String(summary.deniedCount)} />
                <Stat label="Force Admit" value={String(summary.forceAdmitCount)} />
                <Stat label="Sessions" value={String(summary.activeSessions.length)} />
              </div>
              {summary.gateBreakdown.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {summary.gateBreakdown.map(g => <span key={g.gate} className="rounded-full bg-zinc-800 px-3 py-1 text-xs text-zinc-400 ring-1 ring-zinc-700">{g.gate}: {g.count}</span>)}
                </div>
              )}
            </div>
          )}
          <div>
            <SectionLabel>Undo / Force Timeline</SectionLabel>
            <div className="max-h-48 divide-y divide-zinc-800 overflow-auto rounded-xl bg-zinc-950 ring-1 ring-zinc-800">
              {timeline?.rows.map(row => (
                <div key={row.id} className="px-3 py-2.5 text-xs">
                  <p className="font-semibold text-zinc-300">{row.action}</p>
                  <p className="text-zinc-600">{row.actor} · {new Date(row.createdAt).toLocaleString()}</p>
                </div>
              ))}
              {(!timeline || !timeline.rows.length) && <p className="py-4 text-center text-xs text-zinc-700">No events yet.</p>}
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between">
              <SectionLabel>Post-Show Analytics</SectionLabel>
              {performanceId && (
                <button onClick={exportCsv} disabled={exportingCsv} className="-mt-2.5 rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-semibold text-zinc-400 ring-1 ring-zinc-700 disabled:opacity-50 hover:bg-zinc-700">
                  {exportingCsv ? 'Exporting…' : 'Export CSV'}
                </button>
              )}
            </div>
            {analytics ? (
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                  <Stat label="No-show" value={String(analytics.totals.noShowEstimate)} />
                  <Stat label="Peak/min" value={String(analytics.peakPerMinute)} />
                  <Stat label="Fraud" value={String(analytics.attempts.fraudAttemptEstimate)} />
                  <Stat label="Dupes" value={String(analytics.attempts.duplicateAttempts)} />
                  <Stat label="Rate" value={`${analytics.totals.checkInRate}%`} red />
                </div>
                <p className="rounded-xl bg-zinc-950 px-3 py-2 text-xs text-zinc-600 ring-1 ring-zinc-800">
                  Invalid QR: {analytics.attempts.invalidQrAttempts} · Not found: {analytics.attempts.notFoundAttempts} · Wrong show: {analytics.attempts.wrongPerformanceAttempts} · Not admitted: {analytics.attempts.notAdmittedAttempts}
                </p>
              </div>
            ) : <p className="text-xs text-zinc-700">Loading analytics…</p>}
          </div>
        </div>
      </details>

    </div>
  );
}
