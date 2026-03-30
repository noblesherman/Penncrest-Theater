import { FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminFetch, getAdminToken } from '../../lib/adminAuth';
import { createAdminQrScanner, detectQrCameraSupport } from '../../lib/adminQrScanner';
import { apiUrl } from '../../lib/api';
import {
  enqueueOfflineScannerItem,
  isScannerNetworkError,
  makeScannerClientId,
  persistScannerSessionForPerformance,
  readOfflineScannerQueue,
  readStoredScannerSessions,
  type OfflineScannerQueueItem,
  writeOfflineScannerQueue
} from '../../lib/scannerRecovery';

type PerformanceRow = { id: string; title: string; startsAt: string; isArchived?: boolean; isFundraiser?: boolean };
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

const reasonOptions: Array<{ value: ReasonCode; label: string }> = [
  { value: 'DUPLICATE_SCAN', label: 'Duplicate scan' }, { value: 'VIP_OVERRIDE', label: 'VIP override' },
  { value: 'PAYMENT_EXCEPTION', label: 'Payment exception' }, { value: 'INVALID_TICKET', label: 'Invalid ticket' },
  { value: 'SAFETY_CONCERN', label: 'Safety concern' }, { value: 'MANUAL_CORRECTION', label: 'Manual correction' },
  { value: 'OTHER', label: 'Other' },
];

const outcomeConfig: Record<ScanOutcome, { label: string; icon: string; card: string; text: string; badge: string }> = {
  VALID:              { label: 'Admitted',    icon: '✓', card: 'border-emerald-200 bg-emerald-50',  text: 'text-emerald-700', badge: 'bg-emerald-100 text-emerald-700 ring-emerald-200' },
  ALREADY_CHECKED_IN: { label: 'Already In',  icon: '!', card: 'border-amber-200 bg-amber-50',      text: 'text-amber-700',   badge: 'bg-amber-100 text-amber-700 ring-amber-200'       },
  WRONG_PERFORMANCE:  { label: 'Wrong Show',  icon: '✕', card: 'border-orange-200 bg-orange-50',    text: 'text-orange-700',  badge: 'bg-orange-100 text-orange-700 ring-orange-200'    },
  NOT_ADMITTED:       { label: 'Denied',      icon: '✕', card: 'border-rose-200 bg-rose-50',        text: 'text-rose-700',    badge: 'bg-rose-100 text-rose-700 ring-rose-200'          },
  INVALID_QR:         { label: 'Invalid QR',  icon: '✕', card: 'border-rose-200 bg-rose-50',        text: 'text-rose-700',    badge: 'bg-rose-100 text-rose-700 ring-rose-200'          },
  NOT_FOUND:          { label: 'Not Found',   icon: '✕', card: 'border-rose-200 bg-rose-50',        text: 'text-rose-700',    badge: 'bg-rose-100 text-rose-700 ring-rose-200'          },
};

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
  return <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-stone-400">{children}</p>;
}

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-stone-100 bg-white shadow-sm ${className}`}>{children}</div>;
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-xl border border-stone-100 bg-stone-50 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-400">{label}</p>
      <p className={`mt-0.5 text-2xl font-bold tabular-nums ${highlight ? 'text-rose-700' : 'text-stone-900'}`}
        style={{ fontFamily: "var(--font-sans)" }}>
        {value}
      </p>
    </div>
  );
}

const inputCls = 'w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 outline-none transition focus:border-stone-400 focus:ring-2 focus:ring-stone-100 placeholder:text-stone-400';
const selectCls = 'w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm text-stone-900 outline-none transition focus:border-stone-400 focus:ring-2 focus:ring-stone-100 cursor-pointer';

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
  const [offlineQueue, setOfflineQueue] = useState<OfflineScannerQueueItem[]>([]);
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
      body: JSON.stringify({ performanceId: params.performanceIdOverride ?? performanceId, sessionToken: params.sessionTokenOverride ?? scannerSession!.sessionToken, scannedValue: params.scannedValue, clientScanId: params.clientScanId ?? makeScannerClientId(), offlineQueuedAt: params.offlineQueuedAt }),
    });
  };

  const enqueueOffline = (item: Omit<OfflineScannerQueueItem, 'id' | 'queuedAt'>) => {
    const next = enqueueOfflineScannerItem(item);
    setNotice({ kind: 'err', text: `Offline — queued (${next.length} pending)` });
    setOfflineQueue(next);
  };

  const submitScan = async (val: string) => {
    if (!performanceId || !sessionReady) { setNotice({ kind: 'err', text: 'Start a session first.' }); return; }
    scanBusy.current = true; setBusy(true); setNotice(null);
    const cid = makeScannerClientId();
    try {
      if (!navigator.onLine) { enqueueOffline({ performanceId, sessionToken: scannerSession!.sessionToken, scannedValue: val, clientScanId: cid }); return; }
      const r = await sendScanRequest({ scannedValue: val, clientScanId: cid });
      setLastResult(r);
      setHistory(h => [{ ...r, id: makeScannerClientId() }, ...h].slice(0, 30));
      if (r.ticket) setLookupRows(rows => rows.map(row => row.id === r.ticket!.id ? { ...row, ...r.ticket! } : row));
      vibrate(r.outcome === 'VALID' ? 50 : [80, 30, 80]); beep(r.outcome === 'VALID');
      await reloadAll();
    } catch (err) {
      if (isScannerNetworkError(err)) enqueueOffline({ performanceId, sessionToken: scannerSession!.sessionToken, scannedValue: val, clientScanId: cid });
      else {
        const fb: ScanResponse = { outcome: 'INVALID_QR', message: err instanceof Error ? err.message : 'Scan failed', scannedAt: new Date().toISOString() };
        setLastResult(fb); setHistory(h => [{ ...fb, id: makeScannerClientId() }, ...h].slice(0, 30));
        vibrate([80, 30, 80]); beep(false);
      }
    } finally { setBusy(false); scanBusy.current = false; }
  };

  const syncOfflineQueue = async () => {
    if (isSyncing) return;
    const q = readOfflineScannerQueue(); if (!q.length) return;
    setIsSyncing(true);
    try {
      const stored = readStoredScannerSessions(); const remaining: OfflineScannerQueueItem[] = []; let blocked: string | null = null;
      for (let i = 0; i < q.length; i++) {
        const item = q[i];
        const tok = (item.performanceId === performanceId && scannerSession?.performanceId === item.performanceId ? scannerSession.sessionToken : stored[item.performanceId]?.sessionToken) ?? item.sessionToken;
        try {
          const r = await sendScanRequest({ scannedValue: item.scannedValue, clientScanId: item.clientScanId, offlineQueuedAt: item.queuedAt, performanceIdOverride: item.performanceId, sessionTokenOverride: tok });
          setLastResult(r); setHistory(h => [{ ...r, id: makeScannerClientId() }, ...h].slice(0, 30));
          vibrate(r.outcome === 'VALID' ? 50 : [80, 30, 80]); beep(r.outcome === 'VALID');
        } catch (err) {
          if (isScannerNetworkError(err)) { remaining.push(item, ...q.slice(i + 1)); break; }
          const m = err instanceof Error ? err.message.toLowerCase() : '';
          if (m.includes('session is not active') || m.includes('unauthorized') || m.includes('forbidden')) { remaining.push(item, ...q.slice(i + 1)); blocked = 'Sync paused — start a session first.'; break; }
        }
      }
      writeOfflineScannerQueue(remaining); setOfflineQueue(remaining);
      if (!remaining.length) setNotice({ kind: 'ok', text: 'Offline queue synced.' });
      else setNotice({ kind: 'err', text: blocked ?? `${remaining.length} scan(s) still queued.` });
      await reloadAll();
    } finally { setIsSyncing(false); }
  };

  const persistSession = (s: ScannerSession | null) => {
    persistScannerSessionForPerformance(s?.performanceId || performanceId, s);
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
    setOfflineQueue(readOfflineScannerQueue());
    let cancelled = false;
    detectQrCameraSupport().then(ok => { if (!cancelled) setCameraSupported(ok); });
    adminFetch<PerformanceRow[]>('/api/admin/performances?scope=active&kind=all')
      .then(rows => { const a = rows.filter(r => !r.isArchived); setPerformances(a); if (a.length) setPerformanceId(a[0].id); })
      .catch(err => setCameraError(err instanceof Error ? err.message : 'Failed to load'));
    const onOnline = () => syncOfflineQueue();
    window.addEventListener('online', onOnline);
    return () => { cancelled = true; stopCamera(); scannerRef.current?.destroy(); scannerRef.current = null; window.removeEventListener('online', onOnline); };
  }, []);

  useEffect(() => {
    if (!performanceId) return;
    const stored = readStoredScannerSessions()[performanceId];
    setScannerSession(stored ?? null);
    if (stored) setSessionDraft(d => ({ ...d, staffName: stored.staffName, gate: stored.gate }));
    setLastResult(null); setHistory([]); setLookupRows([]); setLookupQuery(''); setNotice(null);
    reloadAll(performanceId);
  }, [performanceId]);

  useEffect(() => {
    if (!performanceId || !sessionReady) { setRealtimeOk(false); return; }

    let cancelled = false;
    let src: EventSource | null = null;

    const connect = async () => {
      try {
        const { token } = await adminFetch<{ token: string }>(
          `/api/admin/check-in/events/token?performanceId=${encodeURIComponent(performanceId)}`
        );
        if (cancelled) return;

        src = new EventSource(
          apiUrl(
            `/api/admin/check-in/events?performanceId=${encodeURIComponent(performanceId)}&token=${encodeURIComponent(token)}`
          )
        );
        src.onopen = () => setRealtimeOk(true);
        src.onerror = () => setRealtimeOk(false);
        src.addEventListener('checkin', () => reloadAll(performanceId));
        src.addEventListener('decision', () => reloadAll(performanceId));
        src.addEventListener('session', () => loadSummary(performanceId));
      } catch {
        if (!cancelled) {
          setRealtimeOk(false);
        }
      }
    };

    void connect();

    return () => {
      cancelled = true;
      src?.close();
      setRealtimeOk(false);
    };
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
    <div className="mx-auto max-w-2xl space-y-4 pb-16">

      {/* ── Header ── */}
      <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-widest text-stone-400">Admin</p>
          <h1
            className="text-3xl font-bold text-stone-900"
            style={{ fontFamily: "var(--font-sans)", letterSpacing: '-0.02em' }}
          >
            Ticket Scanner
          </h1>
          {selectedPerf && (
            <p className="mt-0.5 truncate text-sm text-stone-500">
              {selectedPerf.title} · {new Date(selectedPerf.startsAt).toLocaleString()}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end sm:pt-2">
          <span title={realtimeOk ? 'Realtime connected' : 'Realtime off'} className={`h-2 w-2 rounded-full ${realtimeOk ? 'bg-emerald-400' : 'bg-stone-300'}`} />
          <span title={navigator.onLine ? 'Online' : 'Offline'} className={`h-2 w-2 rounded-full ${navigator.onLine ? 'bg-emerald-400' : 'bg-rose-400'}`} />
          {offlineQueue.length > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-amber-200">
              {offlineQueue.length}
            </span>
          )}
          <Link
            to="/admin/scanner/live"
            className="rounded-xl border border-stone-200 bg-white px-3 py-1.5 text-xs font-semibold text-stone-600 shadow-sm transition hover:border-stone-300 hover:text-stone-900"
          >
            Full Screen
          </Link>
        </div>
      </div>

      {/* ── Notice ── */}
      {notice && (
        <div className={`flex items-start gap-2 rounded-2xl px-4 py-3 text-sm font-medium ${notice.kind === 'ok' ? 'border border-emerald-100 bg-emerald-50 text-emerald-700' : 'border border-rose-100 bg-rose-50 text-rose-700'}`}>
          <svg className="mt-0.5 h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            {notice.kind === 'ok'
              ? <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              : <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />}
          </svg>
          {notice.text}
        </div>
      )}

      {/* ── SESSION SETUP ── */}
      <Card>
        <div className="p-5 space-y-3">
          <SectionLabel>Session Setup</SectionLabel>

          <select value={performanceId} onChange={e => setPerformanceId(e.target.value)} className={selectCls}>
            {performances.map(p => (
              <option key={p.id} value={p.id}>
                {p.title}
                {p.isFundraiser ? ' [Fundraiser]' : ''}
                {' — '}
                {new Date(p.startsAt).toLocaleString()}
              </option>
            ))}
          </select>

          {sessionReady ? (
            <div className="flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-bold text-emerald-800">{scannerSession!.staffName} · {scannerSession!.gate}</p>
                <p className="text-xs text-emerald-600">Since {new Date(scannerSession!.createdAt).toLocaleTimeString()}</p>
              </div>
              <button
                onClick={endSession}
                className="shrink-0 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-100"
              >
                End Session
              </button>
            </div>
          ) : (
            <form onSubmit={startSession} className="space-y-2.5">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <input value={sessionDraft.staffName} onChange={e => setSessionDraft({ ...sessionDraft, staffName: e.target.value })} placeholder="Your name" required className={inputCls} />
                <input value={sessionDraft.gate} onChange={e => setSessionDraft({ ...sessionDraft, gate: e.target.value })} placeholder="Gate" required className={inputCls} />
              </div>
              <input value={sessionDraft.deviceLabel} onChange={e => setSessionDraft({ ...sessionDraft, deviceLabel: e.target.value })} placeholder="Device label (optional)" className={inputCls} />
              <button type="submit" className="w-full rounded-xl bg-stone-900 py-3 text-sm font-bold text-white transition hover:bg-stone-700">
                Start Session
              </button>
            </form>
          )}

          {offlineQueue.length > 0 && (
            <button
              onClick={() => syncOfflineQueue()}
              disabled={isSyncing}
              className="w-full rounded-xl border border-amber-200 bg-amber-50 py-2.5 text-sm font-semibold text-amber-700 transition hover:bg-amber-100 disabled:opacity-60"
            >
              {isSyncing ? 'Syncing…' : `Sync Offline Queue (${offlineQueue.length})`}
            </button>
          )}
        </div>
      </Card>

      {/* ── CAMERA ── */}
      <Card className="overflow-hidden">
        <div className="relative bg-stone-900">
          <video ref={videoRef} className="h-60 w-full object-cover sm:h-72" playsInline muted />
          {!cameraRunning && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
              <svg className="h-9 w-9 text-stone-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
              </svg>
              <span className="text-xs text-stone-500">Camera off</span>
            </div>
          )}
          {cameraRunning && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="relative h-40 w-40">
                <span className="absolute left-0 top-0 h-7 w-7 border-l-2 border-t-2 border-white/70" />
                <span className="absolute right-0 top-0 h-7 w-7 border-r-2 border-t-2 border-white/70" />
                <span className="absolute bottom-0 left-0 h-7 w-7 border-b-2 border-l-2 border-white/70" />
                <span className="absolute bottom-0 right-0 h-7 w-7 border-b-2 border-r-2 border-white/70" />
              </div>
            </div>
          )}
        </div>
        <div className="p-4 space-y-2">
          <button
            onClick={() => cameraRunning ? stopCamera() : startCamera()}
            disabled={!sessionReady}
            className={`w-full rounded-xl py-3 text-sm font-bold transition disabled:opacity-50 ${cameraRunning ? 'border border-stone-200 bg-stone-50 text-stone-700 hover:bg-white' : 'bg-stone-900 text-white hover:bg-stone-700'}`}
          >
            {cameraRunning ? 'Stop Camera' : 'Start Camera'}
          </button>
          {(cameraError || (!cameraSupported && !cameraRunning)) && (
            <p className="px-1 text-xs text-amber-600">{cameraError ?? 'Camera unsupported — use manual input.'}</p>
          )}
        </div>
      </Card>

      {/* ── LAST SCAN RESULT ── */}
      {lastResult ? (() => {
        const cfg = outcomeConfig[lastResult.outcome];
        return (
          <div className={`rounded-2xl border p-4 ${cfg.card}`}>
            <div className="flex items-start gap-3">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base font-bold ring-1 ${cfg.badge}`}>
                {cfg.icon}
              </span>
              <div className="min-w-0 flex-1">
                <p className={`text-[10px] font-bold uppercase tracking-widest ${cfg.text}`}>{cfg.label}</p>
                <p className="mt-0.5 text-sm text-stone-700">{lastResult.message}</p>
                {lastResult.ticket && (
                  <div className="mt-2 space-y-0.5 text-xs text-stone-500">
                    <p className="font-semibold text-stone-800">{lastResult.ticket.holder.customerName}</p>
                    <p>{lastResult.ticket.holder.customerEmail}</p>
                    <p>{lastResult.ticket.seat.sectionName} · Row {lastResult.ticket.seat.row} · Seat {lastResult.ticket.seat.number}</p>
                  </div>
                )}
                {lastResult.ticket?.checkedInAt && (
                  <button
                    disabled={actionBusyId === lastResult.ticket.id || !sessionReady}
                    onClick={() => undoCheckIn(lastResult.ticket!)}
                    className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 transition hover:bg-amber-100 disabled:opacity-50"
                  >
                    {actionBusyId === lastResult.ticket.id ? 'Undoing…' : 'Undo Check-In'}
                  </button>
                )}
              </div>
            </div>
          </div>
        );
      })() : (
        <Card>
          <div className="flex items-center gap-3 px-5 py-4">
            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-stone-100 bg-stone-50">
              <svg className="h-4 w-4 text-stone-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <circle cx="12" cy="12" r="10" /><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01" />
              </svg>
            </span>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-400">Latest Scan</p>
              <p className="text-sm text-stone-400">Ready to scan</p>
            </div>
          </div>
        </Card>
      )}

      {/* ── MANUAL INPUT ── */}
      <Card>
        <div className="p-5 space-y-3">
          <SectionLabel>Manual / Hardware Input</SectionLabel>
          <form onSubmit={submitManual} className="flex flex-col gap-2 sm:flex-row">
            <input
              ref={hwInputRef}
              value={manualValue}
              onChange={e => setManualValue(e.target.value)}
              placeholder="QR payload, ticket URL, or ID"
              className={`${inputCls} flex-1`}
            />
            <button
              disabled={busy || !sessionReady}
              className="shrink-0 rounded-xl border border-stone-200 bg-stone-50 px-4 py-2.5 text-sm font-semibold text-stone-700 transition hover:bg-white disabled:opacity-50"
            >
              {busy ? '…' : 'Go'}
            </button>
          </form>
        </div>
      </Card>

      {/* ── LIVE STATUS ── */}
      <Card>
        <div className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <SectionLabel>Live Status</SectionLabel>
            <button
              onClick={() => reloadAll()}
              className="-mt-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs font-semibold text-stone-500 transition hover:bg-white hover:text-stone-800"
            >
              Refresh
            </button>
          </div>
          {summary ? (
            <>
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Checked In" value={String(summary.totalCheckedIn)} />
                <Stat label="Admittable" value={String(summary.totalAdmittable)} />
                <Stat label="Rate" value={`${pct}%`} highlight />
              </div>
              <div>
                <div className="mb-1.5 flex justify-between text-xs text-stone-400">
                  <span>Progress</span><span>{pct}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-100">
                  <div className="h-full rounded-full bg-stone-900 transition-all duration-500" style={{ width: `${pct}%` }} />
                </div>
              </div>
            </>
          ) : (
            <p className="text-sm text-stone-400">{summaryError ?? 'Loading…'}</p>
          )}
        </div>
      </Card>

      {/* ── FALLBACK / GUEST LOOKUP ── */}
      <Card>
        <div className="p-5 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-rose-600">Fallback Check-In</p>
              <p className="text-sm font-semibold text-stone-900">Search by name or email</p>
            </div>
            {lookupRows.length > 0 && (
              <span className="mt-0.5 rounded-full border border-stone-200 bg-stone-50 px-2.5 py-0.5 text-xs font-semibold text-stone-500">
                {lookupRows.length}
              </span>
            )}
          </div>
          <form onSubmit={searchLookup} className="flex flex-col gap-2 sm:flex-row">
            <input
              value={lookupQuery}
              onChange={e => setLookupQuery(e.target.value)}
              placeholder="Name, email, seat, order ID…"
              className={`${inputCls} flex-1`}
            />
            <button
              disabled={!performanceId}
              className="shrink-0 rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-stone-700 disabled:opacity-50"
            >
              Search
            </button>
          </form>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <select value={reasonCode} onChange={e => setReasonCode(e.target.value as ReasonCode)} className={selectCls}>
              {reasonOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <input value={reasonNotes} onChange={e => setReasonNotes(e.target.value)} placeholder="Reason notes" className={inputCls} />
          </div>
        </div>

        <div className="max-h-[420px] divide-y divide-stone-100 overflow-auto">
          {lookupRows.map(ticket => {
            const ci = Boolean(ticket.checkedInAt), denied = ticket.admissionDecision === 'DENY';
            const lBusy = lookupBusyId === ticket.id, aBusy = actionBusyId === ticket.id;
            return (
              <div key={ticket.id} className="px-5 py-4 space-y-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-stone-900">{ticket.holder.customerName}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ring-1 ${ci ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : denied ? 'bg-rose-50 text-rose-700 ring-rose-200' : 'bg-amber-50 text-amber-700 ring-amber-200'}`}>
                      {ci ? 'Checked In' : denied ? 'Denied' : 'Ready'}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-stone-400">{ticket.holder.customerEmail}</p>
                  <p className="text-xs text-stone-400">{ticket.seat.sectionName} · R{ticket.seat.row}–{ticket.seat.number} · #{ticket.publicId}</p>
                </div>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  <button onClick={() => checkInFromLookup(ticket)} disabled={!sessionReady || ci || busy || Boolean(lookupBusyId) || aBusy} className="rounded-xl bg-stone-900 py-2.5 text-xs font-bold text-white transition hover:bg-stone-700 disabled:opacity-50">
                    {lBusy ? '…' : ci ? 'Checked In' : 'Check In'}
                  </button>
                  <button onClick={() => undoCheckIn(ticket)} disabled={aBusy || busy || Boolean(lookupBusyId) || !sessionReady || !ci} className="rounded-xl border border-amber-200 bg-amber-50 py-2.5 text-xs font-semibold text-amber-700 transition hover:bg-amber-100 disabled:opacity-50">
                    {aBusy ? '…' : 'Undo'}
                  </button>
                  <button onClick={() => applyDecision(ticket, 'FORCE_ADMIT')} disabled={aBusy || busy || Boolean(lookupBusyId) || !sessionReady} className="rounded-xl border border-emerald-200 bg-emerald-50 py-2.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50">
                    Force Admit
                  </button>
                  <button onClick={() => applyDecision(ticket, 'DENY')} disabled={aBusy || busy || Boolean(lookupBusyId) || !sessionReady} className="rounded-xl border border-rose-200 bg-rose-50 py-2.5 text-xs font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-50">
                    Deny
                  </button>
                </div>
              </div>
            );
          })}
          {!lookupRows.length && (
            <div className="px-5 py-8 text-center text-sm text-stone-400">
              {lookupQuery.trim() ? 'No guests found.' : 'Search results appear here.'}
            </div>
          )}
        </div>
      </Card>

      {/* ── RECENT SCANS ── */}
      <Card>
        <div className="border-b border-stone-100 px-5 py-4">
          <SectionLabel>Recent Scans · This Device</SectionLabel>
        </div>
        <div className="max-h-64 divide-y divide-stone-50 overflow-auto">
          {history.map(item => {
            const cfg = outcomeConfig[item.outcome];
            return (
              <div key={item.id} className="flex items-center gap-3 px-5 py-3">
                <span className={`shrink-0 text-sm font-bold ${cfg.text}`}>{cfg.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className={`text-[10px] font-bold uppercase tracking-wide ${cfg.text}`}>{cfg.label}</p>
                  {item.ticket && (
                    <p className="truncate text-xs text-stone-400">
                      {item.ticket.holder.customerName} · {item.ticket.seat.sectionName} {item.ticket.seat.row}–{item.ticket.seat.number}
                    </p>
                  )}
                </div>
                <p className="shrink-0 text-xs text-stone-300">{new Date(item.scannedAt).toLocaleTimeString()}</p>
              </div>
            );
          })}
          {!history.length && <p className="px-5 py-6 text-center text-sm text-stone-400">No scans yet.</p>}
        </div>
      </Card>

      {/* ── ADVANCED ── */}
      <details className="overflow-hidden rounded-2xl border border-stone-100 bg-white shadow-sm">
        <summary className="flex cursor-pointer select-none items-center justify-between px-5 py-4">
          <SectionLabel>Advanced</SectionLabel>
          <svg className="h-4 w-4 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </summary>

        <div className="space-y-5 border-t border-stone-100 p-5">
          {summary && (
            <div>
              <SectionLabel>Detailed Status</SectionLabel>
              <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Stat label="Denied" value={String(summary.deniedCount)} />
                <Stat label="Force Admit" value={String(summary.forceAdmitCount)} />
                <Stat label="Sessions" value={String(summary.activeSessions.length)} />
              </div>
              {summary.gateBreakdown.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {summary.gateBreakdown.map(g => (
                    <span key={g.gate} className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-xs text-stone-500">
                      {g.gate}: {g.count}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          <div>
            <SectionLabel>Undo / Force Timeline</SectionLabel>
            <div className="max-h-48 divide-y divide-stone-100 overflow-auto rounded-xl border border-stone-100 bg-stone-50">
              {timeline?.rows.map(row => (
                <div key={row.id} className="px-3 py-2.5 text-xs">
                  <p className="font-semibold text-stone-700">{row.action}</p>
                  <p className="text-stone-400">{row.actor} · {new Date(row.createdAt).toLocaleString()}</p>
                </div>
              ))}
              {(!timeline || !timeline.rows.length) && (
                <p className="py-4 text-center text-xs text-stone-400">No events yet.</p>
              )}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <SectionLabel>Post-Show Analytics</SectionLabel>
              {performanceId && (
                <button
                  onClick={exportCsv}
                  disabled={exportingCsv}
                  className="-mt-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-1.5 text-xs font-semibold text-stone-500 transition hover:bg-white disabled:opacity-50"
                >
                  {exportingCsv ? 'Exporting…' : 'Export CSV'}
                </button>
              )}
            </div>
            {analytics ? (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                  <Stat label="No-show" value={String(analytics.totals.noShowEstimate)} />
                  <Stat label="Peak/min" value={String(analytics.peakPerMinute)} />
                  <Stat label="Fraud" value={String(analytics.attempts.fraudAttemptEstimate)} />
                  <Stat label="Dupes" value={String(analytics.attempts.duplicateAttempts)} />
                  <Stat label="Rate" value={`${analytics.totals.checkInRate}%`} highlight />
                </div>
                <p className="rounded-xl border border-stone-100 bg-stone-50 px-3 py-2 text-xs text-stone-400">
                  Invalid QR: {analytics.attempts.invalidQrAttempts} · Not found: {analytics.attempts.notFoundAttempts} · Wrong show: {analytics.attempts.wrongPerformanceAttempts} · Not admitted: {analytics.attempts.notAdmittedAttempts}
                </p>
              </div>
            ) : (
              <p className="text-xs text-stone-400">Loading analytics…</p>
            )}
          </div>
        </div>
      </details>

    </div>
  );
}
