import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminFetch } from '../../lib/adminAuth';

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

type ScannerSession = {
  sessionId: string;
  sessionToken: string;
  performanceId: string;
  staffName: string;
  gate: string;
  deviceLabel: string | null;
  createdAt: string;
};

type DetectedBarcodeLike = { rawValue?: string };
type BarcodeDetectorLike = {
  detect: (source: HTMLVideoElement) => Promise<DetectedBarcodeLike[]>;
};
type BarcodeDetectorCtorLike = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

type FlashTone = 'success' | 'warn' | 'error' | null;

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
  const [manualValue, setManualValue] = useState('');
  const [cameraSupported, setCameraSupported] = useState(false);
  const [cameraRunning, setCameraRunning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [lastResult, setLastResult] = useState<ScanResponse | null>(null);
  const [flashTone, setFlashTone] = useState<FlashTone>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const intervalRef = useRef<number | null>(null);
  const scanBusyRef = useRef(false);
  const lastScannedRef = useRef<{ value: string; at: number } | null>(null);
  const hardwareBufferRef = useRef('');
  const hardwareClearTimerRef = useRef<number | null>(null);
  const flashTimerRef = useRef<number | null>(null);

  const selectedPerformance = useMemo(
    () => performances.find((performance) => performance.id === performanceId) || null,
    [performances, performanceId]
  );
  const sessionReady = Boolean(scannerSession && scannerSession.performanceId === performanceId);

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

  const setFlash = (tone: FlashTone) => {
    if (flashTimerRef.current) {
      window.clearTimeout(flashTimerRef.current);
    }
    setFlashTone(tone);
    flashTimerRef.current = window.setTimeout(() => {
      setFlashTone(null);
      flashTimerRef.current = null;
    }, 1000);
  };

  const submitScan = async (scannedValue: string) => {
    if (!sessionReady || !performanceId) {
      setNotice({ kind: 'error', text: 'Start a scanner session first.' });
      return;
    }

    setBusy(true);
    scanBusyRef.current = true;
    setNotice(null);

    try {
      const result = await adminFetch<ScanResponse>('/api/admin/check-in/scan', {
        method: 'POST',
        body: JSON.stringify({
          performanceId,
          sessionToken: scannerSession!.sessionToken,
          scannedValue,
          clientScanId: makeClientId()
        })
      });

      setLastResult(result);
      setFlash(flashForOutcome(result.outcome));
    } catch (err) {
      const fallback: ScanResponse = {
        outcome: 'INVALID_QR',
        message: err instanceof Error ? err.message : 'Scan failed',
        scannedAt: new Date().toISOString()
      };
      setLastResult(fallback);
      setFlash('error');
    } finally {
      setBusy(false);
      scanBusyRef.current = false;
      setManualValue('');
    }
  };

  const startCamera = async () => {
    setCameraError(null);
    if (!sessionReady) {
      setCameraError('Start a scanner session first.');
      return;
    }
    if (cameraRunning) return;

    const detectorCtor = getDetectorConstructor();
    if (!detectorCtor || !navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera scanning is not supported on this browser.');
      return;
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
        throw new Error('Camera preview failed to initialize.');
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
            // Ignore detector errors on individual frames.
          });
      }, 250);
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
        body: JSON.stringify({
          performanceId,
          staffName: sessionDraft.staffName.trim(),
          gate: sessionDraft.gate.trim(),
          deviceLabel: sessionDraft.deviceLabel.trim() || undefined
        })
      });
      setScannerSession(session);
      setNotice({ kind: 'success', text: `Session started for ${session.staffName} (${session.gate}).` });
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
      setNotice({ kind: 'success', text: 'Scanner session ended.' });
      stopCamera();
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Failed to end session' });
    }
  };

  useEffect(() => {
    setCameraSupported(Boolean(getDetectorConstructor() && navigator.mediaDevices?.getUserMedia));
    adminFetch<PerformanceRow[]>('/api/admin/performances?scope=active')
      .then((rows) => {
        const active = rows.filter((row) => !row.isArchived);
        setPerformances(active);
        if (active.length > 0) setPerformanceId(active[0].id);
      })
      .catch((err) => {
        setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Failed to load performances' });
      });

    return () => {
      stopCamera();
      if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
      if (hardwareClearTimerRef.current) window.clearTimeout(hardwareClearTimerRef.current);
    };
  }, []);

  useEffect(() => {
    setLastResult(null);
    setNotice(null);
    setScannerSession((current) => (current?.performanceId === performanceId ? current : null));
    stopCamera();
  }, [performanceId]);

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
        if (value) void submitScan(value);
        return;
      }

      if (event.key.length === 1) {
        hardwareBufferRef.current += event.key;
        if (hardwareClearTimerRef.current) window.clearTimeout(hardwareClearTimerRef.current);
        hardwareClearTimerRef.current = window.setTimeout(() => {
          hardwareBufferRef.current = '';
          hardwareClearTimerRef.current = null;
        }, 250);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sessionReady, scannerSession, performanceId]);

  const overlayClass =
    flashTone === 'success'
      ? 'bg-green-500/35'
      : flashTone === 'warn'
        ? 'bg-amber-400/30'
        : flashTone === 'error'
          ? 'bg-red-500/35'
          : 'bg-transparent';

  const resultToneClass =
    lastResult?.outcome === 'VALID'
      ? 'border-green-300 bg-green-50 text-green-900'
      : lastResult?.outcome === 'ALREADY_CHECKED_IN' || lastResult?.outcome === 'WRONG_PERFORMANCE'
        ? 'border-amber-300 bg-amber-50 text-amber-900'
        : 'border-red-300 bg-red-50 text-red-900';

  return (
    <div className="fixed inset-0 z-50 bg-black">
      <video ref={videoRef} className="absolute inset-0 h-full w-full object-cover" playsInline muted />
      <div className="pointer-events-none absolute inset-0 bg-black/35" />
      <div className={`pointer-events-none absolute inset-0 transition-opacity duration-150 ${overlayClass}`} />

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
        <div className="h-[min(58vw,440px)] w-[min(58vw,440px)] rounded-[28px] border-4 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.25)]" />
      </div>

      <header className="absolute inset-x-0 top-0 z-20 p-4 md:p-5">
        <div className="mx-auto w-full max-w-7xl rounded-2xl border border-stone-200 bg-white/95 p-4 text-stone-900 shadow-sm backdrop-blur">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <Link to="/admin/scanner" className="text-xs font-semibold text-stone-700 hover:text-stone-900">Back to scanner console</Link>
            <div className="text-xs text-stone-500">
              {selectedPerformance ? `${selectedPerformance.title} • ${new Date(selectedPerformance.startsAt).toLocaleString()}` : 'Select performance'}
            </div>
          </div>

          <div className="grid gap-2 md:grid-cols-[1.2fr_1fr_1fr_auto]">
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

            {!sessionReady ? (
              <>
                <input
                  value={sessionDraft.staffName}
                  onChange={(event) => setSessionDraft({ ...sessionDraft, staffName: event.target.value })}
                  placeholder="Staff name"
                  className="rounded-xl border border-stone-300 px-3 py-2 text-sm"
                />
                <input
                  value={sessionDraft.gate}
                  onChange={(event) => setSessionDraft({ ...sessionDraft, gate: event.target.value })}
                  placeholder="Gate"
                  className="rounded-xl border border-stone-300 px-3 py-2 text-sm"
                />
                <button
                  onClick={(event) => {
                    event.preventDefault();
                    void startSession();
                  }}
                  className="rounded-xl bg-red-700 px-4 py-2 text-sm font-bold text-white"
                >
                  Start Session
                </button>
              </>
            ) : (
              <>
                <div className="rounded-xl border border-stone-300 bg-stone-50 px-3 py-2 text-sm">
                  {scannerSession.staffName} @ {scannerSession.gate}
                </div>
                <button
                  onClick={() => {
                    void endSession();
                  }}
                  className="rounded-xl border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700"
                >
                  End Session
                </button>
              </>
            )}
          </div>

          {notice ? (
            <div
              className={`mt-3 rounded-xl border px-3 py-2 text-xs ${
                notice.kind === 'success'
                  ? 'border-green-300 bg-green-50 text-green-900'
                  : 'border-red-300 bg-red-50 text-red-900'
              }`}
            >
              {notice.text}
            </div>
          ) : null}
        </div>
      </header>

      <footer className="absolute inset-x-0 bottom-0 z-20 p-4 md:p-5">
        <div className="mx-auto grid w-full max-w-7xl gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
          <div className={`rounded-2xl border p-4 ${lastResult ? resultToneClass : 'border-stone-200 bg-white/95 text-stone-900'} shadow-sm backdrop-blur`}>
            <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">Latest Scan</div>
            <div className="mt-1 text-xl font-bold">{lastResult ? lastResult.outcome.replaceAll('_', ' ') : 'Ready to scan'}</div>
            <div className="text-sm">{lastResult ? lastResult.message : 'Aim at QR code to begin scanning.'}</div>
            {lastResult?.ticket ? (
              <div className="mt-2 text-xs">
                {lastResult.ticket.holder.customerName} ({lastResult.ticket.holder.customerEmail}) • {lastResult.ticket.seat.sectionName}{' '}
                {lastResult.ticket.seat.row}-{lastResult.ticket.seat.number} • Ticket {lastResult.ticket.publicId}
              </div>
            ) : null}
          </div>

          <div className="space-y-2 rounded-2xl border border-stone-200 bg-white/95 p-3 shadow-sm backdrop-blur">
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
                disabled={!sessionReady}
                className="rounded-xl bg-red-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
              >
                {cameraRunning ? 'Stop Camera' : 'Start Camera'}
              </button>
              <button
                type="button"
                onClick={() => {
                  const root = document.documentElement;
                  if (!document.fullscreenElement) {
                    void root.requestFullscreen?.();
                  } else {
                    void document.exitFullscreen?.();
                  }
                }}
                className="rounded-xl border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700"
              >
                Browser Fullscreen
              </button>
            </div>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                const value = manualValue.trim();
                if (!value || busy) return;
                void submitScan(value);
              }}
              className="flex flex-col gap-2 sm:flex-row"
            >
              <input
                value={manualValue}
                onChange={(event) => setManualValue(event.target.value)}
                placeholder="Manual or hardware scanner input"
                className="w-full rounded-xl border border-stone-300 px-3 py-2 text-sm sm:w-[320px]"
              />
              <button
                disabled={!sessionReady || busy}
                className="w-full rounded-xl border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-700 disabled:opacity-60 sm:w-auto"
              >
                {busy ? 'Scanning...' : 'Submit'}
              </button>
            </form>

            {!cameraSupported ? <div className="text-xs text-amber-700">Camera scanning is unsupported on this browser.</div> : null}
            {cameraError ? <div className="text-xs text-red-700">{cameraError}</div> : null}
          </div>
        </div>
      </footer>
    </div>
  );
}
