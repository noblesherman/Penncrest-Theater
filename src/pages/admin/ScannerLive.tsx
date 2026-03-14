import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminFetch } from '../../lib/adminAuth';
import { createAdminQrScanner, detectQrCameraSupport } from '../../lib/adminQrScanner';

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
};

type ScanResponse = {
  outcome: ScanOutcome;
  message: string;
  scannedAt: string;
  ticket?: ScannedTicket;
};

type LookupResult = ScannedTicket & {
  ticketStatus: string;
  ticketType: string;
  createdAt: string;
};

type ScannerSession = {
  sessionId: string;
  sessionToken: string;
  performanceId: string;
  staffName: string;
  gate: string;
  deviceLabel: string | null;
  createdAt: string;
};

type FlashTone = 'success' | 'warn' | 'error' | null;

const outcomeConfig: Record<
  ScanOutcome,
  { label: string; icon: string; resultBg: string; resultBorder: string; resultText: string; flashBg: string }
> = {
  VALID:              { label: 'ADMITTED',    icon: '✓', resultBg: 'bg-emerald-950', resultBorder: 'border-emerald-500', resultText: 'text-emerald-300', flashBg: 'bg-emerald-500/40' },
  ALREADY_CHECKED_IN: { label: 'ALREADY IN',  icon: '!', resultBg: 'bg-amber-950',   resultBorder: 'border-amber-500',   resultText: 'text-amber-300',   flashBg: 'bg-amber-400/35'  },
  WRONG_PERFORMANCE:  { label: 'WRONG SHOW',  icon: '✕', resultBg: 'bg-orange-950',  resultBorder: 'border-orange-500',  resultText: 'text-orange-300',  flashBg: 'bg-orange-500/35' },
  NOT_ADMITTED:       { label: 'DENIED',      icon: '✕', resultBg: 'bg-red-950',     resultBorder: 'border-red-500',     resultText: 'text-red-300',     flashBg: 'bg-red-500/40'    },
  INVALID_QR:         { label: 'INVALID QR',  icon: '✕', resultBg: 'bg-red-950',     resultBorder: 'border-red-500',     resultText: 'text-red-300',     flashBg: 'bg-red-500/40'    },
  NOT_FOUND:          { label: 'NOT FOUND',   icon: '✕', resultBg: 'bg-red-950',     resultBorder: 'border-red-500',     resultText: 'text-red-300',     flashBg: 'bg-red-500/40'    },
};

function makeClientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function flashForOutcome(outcome: ScanOutcome): FlashTone {
  if (outcome === 'VALID') return 'success';
  if (outcome === 'ALREADY_CHECKED_IN' || outcome === 'WRONG_PERFORMANCE') return 'warn';
  return 'error';
}

export default function AdminScannerLivePage() {
  const [performances, setPerformances] = useState<PerformanceRow[]>([]);
  const [performanceId, setPerformanceId] = useState('');
  const [sessionDraft, setSessionDraft] = useState({ staffName: '', gate: 'Main Entrance', deviceLabel: '' });
  const [scannerSession, setScannerSession] = useState<ScannerSession | null>(null);
  const [cameraSupported, setCameraSupported] = useState(false);
  const [cameraRunning, setCameraRunning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [lastResult, setLastResult] = useState<ScanResponse | null>(null);
  const [flashTone, setFlashTone] = useState<FlashTone>(null);
  const [showLookup, setShowLookup] = useState(false);
  const [lookupQuery, setLookupQuery] = useState('');
  const [lookupRows, setLookupRows] = useState<LookupResult[]>([]);
  const [lookupBusyTicketId, setLookupBusyTicketId] = useState<string | null>(null);
  const [lookupSearched, setLookupSearched] = useState(false);
  const [showSessionPanel, setShowSessionPanel] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerRef = useRef<ReturnType<typeof createAdminQrScanner> | null>(null);
  const scanBusyRef = useRef(false);
  const lastScannedRef = useRef<{ value: string; at: number } | null>(null);
  const hardwareBufferRef = useRef('');
  const hardwareClearTimerRef = useRef<number | null>(null);
  const flashTimerRef = useRef<number | null>(null);
  const lookupInputRef = useRef<HTMLInputElement | null>(null);

  const selectedPerformance = useMemo(
    () => performances.find((p) => p.id === performanceId) || null,
    [performances, performanceId]
  );
  const sessionReady = Boolean(scannerSession && scannerSession.performanceId === performanceId);

  const stopCamera = () => {
    scannerRef.current?.stop();
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraRunning(false);
  };

  const setFlash = (tone: FlashTone) => {
    if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
    setFlashTone(tone);
    flashTimerRef.current = window.setTimeout(() => {
      setFlashTone(null);
      flashTimerRef.current = null;
    }, 900);
  };

  const submitScan = async (scannedValue: string) => {
    if (!sessionReady || !performanceId) {
      setNotice({ kind: 'error', text: 'Start a scanner session first.' });
      return null;
    }
    setBusy(true);
    scanBusyRef.current = true;
    setNotice(null);
    try {
      const result = await adminFetch<ScanResponse>('/api/admin/check-in/scan', {
        method: 'POST',
        body: JSON.stringify({ performanceId, sessionToken: scannerSession!.sessionToken, scannedValue, clientScanId: makeClientId() })
      });
      setLastResult(result);
      setFlash(flashForOutcome(result.outcome));
      setLookupRows((rows) => rows.map((row) => (row.id === result.ticket?.id ? { ...row, ...result.ticket } : row)));
      return result;
    } catch (err) {
      const fallback: ScanResponse = { outcome: 'INVALID_QR', message: err instanceof Error ? err.message : 'Scan failed', scannedAt: new Date().toISOString() };
      setLastResult(fallback);
      setFlash('error');
      return fallback;
    } finally {
      setBusy(false);
      scanBusyRef.current = false;
    }
  };

  const startCamera = async () => {
    setCameraError(null);
    if (!sessionReady) { setCameraError('Start a scanner session first.'); return; }
    if (cameraRunning) return;
    if (!cameraSupported) { setCameraError('Camera scanning is not supported on this browser.'); return; }
    try {
      const video = videoRef.current;
      if (!video) throw new Error('Camera preview failed to initialize.');
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
    } catch (err) {
      stopCamera();
      setCameraError(err instanceof Error ? err.message : 'Unable to access camera');
    }
  };

  const startSession = async () => {
    if (!performanceId) return;
    if (!sessionDraft.staffName.trim() || !sessionDraft.gate.trim()) {
      setNotice({ kind: 'error', text: 'Staff name and gate are required.' });
      return;
    }
    try {
      const session = await adminFetch<ScannerSession>('/api/admin/check-in/session/start', {
        method: 'POST',
        body: JSON.stringify({ performanceId, staffName: sessionDraft.staffName.trim(), gate: sessionDraft.gate.trim(), deviceLabel: sessionDraft.deviceLabel.trim() || undefined })
      });
      setScannerSession(session);
      setNotice({ kind: 'success', text: `Session started for ${session.staffName} (${session.gate}).` });
      setShowSessionPanel(false);
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Failed to start session' });
    }
  };

  const endSession = async () => {
    if (!scannerSession) return;
    try {
      await adminFetch('/api/admin/check-in/session/end', { method: 'POST', body: JSON.stringify({ sessionToken: scannerSession.sessionToken }) });
      setScannerSession(null);
      setNotice({ kind: 'success', text: 'Scanner session ended.' });
      stopCamera();
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Failed to end session' });
    }
  };

  useEffect(() => {
    let cancelled = false;
    void detectQrCameraSupport().then((supported) => { if (!cancelled) setCameraSupported(supported); });
    adminFetch<PerformanceRow[]>('/api/admin/performances?scope=active')
      .then((rows) => {
        const active = rows.filter((r) => !r.isArchived);
        setPerformances(active);
        if (active.length > 0) setPerformanceId(active[0].id);
      })
      .catch((err) => { setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Failed to load performances' }); });
    return () => {
      cancelled = true;
      stopCamera();
      scannerRef.current?.destroy();
      scannerRef.current = null;
      if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
      if (hardwareClearTimerRef.current) window.clearTimeout(hardwareClearTimerRef.current);
    };
  }, []);

  useEffect(() => {
    setLastResult(null); setNotice(null);
    setShowLookup(false);
    setLookupQuery('');
    setLookupRows([]);
    setLookupSearched(false);
    setScannerSession((c) => (c?.performanceId === performanceId ? c : null));
    stopCamera();
  }, [performanceId]);

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
  }, [sessionReady, scannerSession, performanceId]);

  // Auto-focus lookup input when panel opens
  useEffect(() => {
    if (showLookup) setTimeout(() => lookupInputRef.current?.focus(), 50);
  }, [showLookup]);

  const searchLookup = async () => {
    if (!performanceId || !lookupQuery.trim()) return;
    setLookupSearched(true);
    setNotice(null);
    try {
      const rows = await adminFetch<LookupResult[]>(
        `/api/admin/check-in/lookup?performanceId=${performanceId}&q=${encodeURIComponent(lookupQuery.trim())}&limit=8`
      );
      setLookupRows(rows);
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Lookup failed' });
    }
  };

  const checkInLookupTicket = async (ticket: LookupResult) => {
    if (busy || lookupBusyTicketId) return;
    setLookupBusyTicketId(ticket.id);
    try {
      const result = await submitScan(ticket.publicId);
      if (result?.outcome === 'VALID') {
        setShowLookup(false);
      }
    } finally {
      setLookupBusyTicketId(null);
    }
  };

  const cfg = lastResult ? outcomeConfig[lastResult.outcome] : null;

  // Flash overlay color
  const flashBg = flashTone === 'success'
    ? 'bg-emerald-500/40'
    : flashTone === 'warn'
    ? 'bg-amber-400/35'
    : flashTone === 'error'
    ? 'bg-red-500/40'
    : 'bg-transparent';

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black" style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }}>

      {/* ── CAMERA ── */}
      <video ref={videoRef} className="absolute inset-0 h-full w-full object-cover" playsInline muted />

      {/* Dim overlay */}
      <div className="pointer-events-none absolute inset-0 bg-black/50" />

      {/* Flash overlay */}
      <div className={`pointer-events-none absolute inset-0 transition-opacity duration-200 ${flashBg} ${flashTone ? 'opacity-100' : 'opacity-0'}`} />

      {/* ── VIEWFINDER ── */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        {/* Darken outside the box */}
        <div className="relative" style={{ width: 'min(72vw, 320px)', height: 'min(72vw, 320px)' }}>
          {/* corner brackets */}
          <span className="absolute left-0 top-0 h-8 w-8 border-l-[3px] border-t-[3px] border-white" style={{ borderRadius: '2px 0 0 0' }} />
          <span className="absolute right-0 top-0 h-8 w-8 border-r-[3px] border-t-[3px] border-white" style={{ borderRadius: '0 2px 0 0' }} />
          <span className="absolute bottom-0 left-0 h-8 w-8 border-b-[3px] border-l-[3px] border-white" style={{ borderRadius: '0 0 0 2px' }} />
          <span className="absolute bottom-0 right-0 h-8 w-8 border-b-[3px] border-r-[3px] border-white" style={{ borderRadius: '0 0 2px 0' }} />
          {/* scan line animation when camera running */}
          {cameraRunning && (
            <span
              className="absolute left-0 right-0 h-[2px] bg-red-500/80"
              style={{ animation: 'scanline 2s ease-in-out infinite', top: '50%' }}
            />
          )}
        </div>
      </div>

      {/* Scanline keyframe */}
      <style>{`
        @keyframes scanline {
          0%   { transform: translateY(-100px); opacity: 0.9; }
          50%  { opacity: 1; }
          100% { transform: translateY(100px); opacity: 0.9; }
        }
      `}</style>

      {/* ── TOP BAR ── */}
      <header className="absolute inset-x-0 top-0 z-20">
        <div className="flex items-center justify-between gap-2 px-4 py-4">
          {/* Back link */}
          <Link
            to="/admin/scanner"
            className="flex items-center gap-1.5 rounded-xl border border-white/20 bg-black/60 px-3 py-2 text-xs font-semibold text-white/80 backdrop-blur-sm active:bg-black/80"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Console
          </Link>

          {/* Show title */}
          <div className="min-w-0 flex-1 text-center">
            {selectedPerformance ? (
              <div className="truncate rounded-xl border border-white/15 bg-black/60 px-3 py-2 text-xs font-semibold text-white/80 backdrop-blur-sm">
                {selectedPerformance.title}
              </div>
            ) : (
              <select
                value={performanceId}
                onChange={(e) => setPerformanceId(e.target.value)}
                className="w-full rounded-xl border border-white/20 bg-black/70 px-3 py-2 text-xs text-white backdrop-blur-sm"
              >
                {performances.map((p) => (
                  <option key={p.id} value={p.id}>{p.title}</option>
                ))}
              </select>
            )}
          </div>

          {/* Session status / toggle */}
          <button
            type="button"
            onClick={() => setShowSessionPanel((v) => !v)}
            className={`shrink-0 rounded-xl border px-3 py-2 text-xs font-bold backdrop-blur-sm active:scale-95 ${sessionReady ? 'border-emerald-500/50 bg-emerald-950/80 text-emerald-300' : 'border-red-500/50 bg-red-950/80 text-red-300'}`}
          >
            {sessionReady ? `${scannerSession!.gate}` : 'Setup'}
          </button>
        </div>

        {/* Notice */}
        {notice && (
          <div className={`mx-4 mb-2 rounded-xl border px-4 py-2.5 text-xs font-medium backdrop-blur-sm ${notice.kind === 'success' ? 'border-emerald-600/50 bg-emerald-950/90 text-emerald-300' : 'border-red-600/50 bg-red-950/90 text-red-300'}`}>
            {notice.text}
          </div>
        )}

        {/* Session setup panel (slides down) */}
        {showSessionPanel && (
          <div className="mx-4 mb-2 rounded-2xl border border-white/15 bg-zinc-950/95 p-4 shadow-xl backdrop-blur-md">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-widest text-zinc-400">Session Setup</span>
              <button
                type="button"
                onClick={() => setShowSessionPanel(false)}
                className="text-zinc-500 active:text-zinc-300"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            <select
              value={performanceId}
              onChange={(e) => setPerformanceId(e.target.value)}
              className="mb-3 w-full rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-100 focus:border-red-500 focus:outline-none"
            >
              {performances.map((p) => (
                <option key={p.id} value={p.id}>{p.title} — {new Date(p.startsAt).toLocaleString()}</option>
              ))}
            </select>

            {!sessionReady ? (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={sessionDraft.staffName}
                    onChange={(e) => setSessionDraft({ ...sessionDraft, staffName: e.target.value })}
                    placeholder="Your name"
                    className="rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:border-red-500 focus:outline-none"
                  />
                  <input
                    value={sessionDraft.gate}
                    onChange={(e) => setSessionDraft({ ...sessionDraft, gate: e.target.value })}
                    placeholder="Gate"
                    className="rounded-xl border border-zinc-700 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:border-red-500 focus:outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void startSession()}
                  className="w-full rounded-xl bg-red-600 py-3 text-sm font-bold text-white active:bg-red-700"
                >
                  Start Session
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-800 bg-emerald-950 px-4 py-3">
                <div>
                  <div className="text-sm font-bold text-emerald-300">{scannerSession!.staffName} · {scannerSession!.gate}</div>
                  <div className="text-xs text-emerald-600">Since {new Date(scannerSession!.createdAt).toLocaleTimeString()}</div>
                </div>
                <button
                  type="button"
                  onClick={() => void endSession()}
                  className="shrink-0 rounded-lg border border-red-700 bg-red-950 px-3 py-2 text-xs font-semibold text-red-400 active:bg-red-900"
                >
                  End
                </button>
              </div>
            )}
          </div>
        )}
      </header>

      {/* ── BOTTOM ── */}
      <footer className="absolute inset-x-0 bottom-0 z-20 px-4 pb-8 pt-4">

        {/* Last result card */}
        <div className={`mb-3 rounded-2xl border p-4 backdrop-blur-sm transition-all ${cfg ? `${cfg.resultBg} ${cfg.resultBorder}` : 'border-white/15 bg-black/70'}`}>
          {cfg ? (
            <div className="flex items-start gap-3">
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-xl font-bold ${cfg.resultBorder} ${cfg.resultText}`}>
                {cfg.icon}
              </span>
              <div className="min-w-0 flex-1">
                <div className={`text-xs font-bold uppercase tracking-widest ${cfg.resultText}`}>{cfg.label}</div>
                <div className="mt-0.5 text-sm font-semibold text-white">{lastResult!.message}</div>
                {lastResult!.ticket && (
                  <div className="mt-1.5 space-y-0.5 text-xs text-zinc-400">
                    <div className="font-semibold text-zinc-200">{lastResult!.ticket.holder.customerName}</div>
                    <div>{lastResult!.ticket.seat.sectionName} · Row {lastResult!.ticket.seat.row} · Seat {lastResult!.ticket.seat.number}</div>
                    <div className="text-zinc-500">{lastResult!.ticket.publicId}</div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20 text-white/40">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
                </svg>
              </span>
              <div>
                <div className="text-xs font-bold uppercase tracking-widest text-white/40">Ready to Scan</div>
                <div className="text-sm text-white/60">Aim camera at a QR code</div>
              </div>
            </div>
          )}
        </div>

        {/* Action row */}
        <div className="flex gap-2">
          {/* Camera toggle — primary CTA */}
          <button
            type="button"
            onClick={() => { if (cameraRunning) stopCamera(); else void startCamera(); }}
            disabled={!sessionReady}
            className={`flex-1 rounded-2xl py-4 text-sm font-bold disabled:opacity-50 active:scale-[0.98] transition-transform ${cameraRunning ? 'border border-zinc-600 bg-zinc-800/90 text-zinc-300' : 'bg-red-600 text-white'}`}
          >
            {cameraRunning ? 'Stop Camera' : 'Start Camera'}
          </button>

          {/* Manual entry toggle */}
          <button
            type="button"
            onClick={() => setShowLookup((v) => !v)}
            className={`rounded-2xl border px-4 py-4 text-sm font-semibold transition-transform active:scale-[0.98] ${showLookup ? 'border-white/30 bg-white/20 text-white' : 'border-white/15 bg-black/60 text-white/70'} backdrop-blur-sm`}
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35m1.85-5.15a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </button>

          {/* Fullscreen toggle */}
          <button
            type="button"
            onClick={() => {
              if (!document.fullscreenElement) void document.documentElement.requestFullscreen?.();
              else void document.exitFullscreen?.();
            }}
            className="rounded-2xl border border-white/15 bg-black/60 px-4 py-4 text-sm font-semibold text-white/70 backdrop-blur-sm active:scale-[0.98] transition-transform"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
          </button>
        </div>

        {/* Compact lookup (expands) */}
        {showLookup && (
          <div className="mt-2 rounded-2xl border border-white/15 bg-zinc-950/95 p-3 backdrop-blur-md">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void searchLookup();
              }}
              className="flex gap-2"
            >
              <input
                ref={lookupInputRef}
                value={lookupQuery}
                onChange={(e) => setLookupQuery(e.target.value)}
                placeholder="Search name or email"
                className="min-w-0 flex-1 rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-3 text-sm text-zinc-100 placeholder-zinc-500 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
              />
              <button
                disabled={!sessionReady || !lookupQuery.trim()}
                className="shrink-0 rounded-xl bg-red-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-50 active:bg-red-700"
              >
                Find
              </button>
            </form>

            <div className="mt-2 max-h-52 space-y-2 overflow-auto">
              {lookupRows.map((ticket) => {
                const checkedIn = Boolean(ticket.checkedInAt);
                const checkingIn = lookupBusyTicketId === ticket.id;

                return (
                  <div key={ticket.id} className="rounded-xl border border-zinc-800 bg-zinc-900/90 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-zinc-100">{ticket.holder.customerName}</div>
                        <div className="truncate text-xs text-zinc-400">{ticket.holder.customerEmail}</div>
                        <div className="mt-1 text-[11px] text-zinc-500">
                          {ticket.seat.sectionName} · {ticket.seat.row}-{ticket.seat.number}
                          {checkedIn ? ` · In at ${ticket.checkInGate || 'gate'}` : ''}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          void checkInLookupTicket(ticket);
                        }}
                        disabled={!sessionReady || busy || checkedIn || Boolean(lookupBusyTicketId)}
                        className="shrink-0 rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                      >
                        {checkingIn ? '...' : checkedIn ? 'In' : 'Check In'}
                      </button>
                    </div>
                  </div>
                );
              })}

              {lookupSearched && lookupRows.length === 0 ? (
                <div className="rounded-xl border border-dashed border-zinc-700 px-3 py-4 text-center text-xs text-zinc-500">
                  No guests matched this search.
                </div>
              ) : null}
            </div>

            <div className="mt-2 text-[11px] text-zinc-500">
              Search a guest by name or email and tap <span className="font-semibold text-zinc-300">Check In</span>.
            </div>

            {(cameraError || !cameraSupported) && (
              <div className="mt-2 text-xs text-amber-400">
                {cameraError || 'Camera scanning unsupported on this browser — use guest lookup.'}
              </div>
            )}
          </div>
        )}
      </footer>
    </div>
  );
}
