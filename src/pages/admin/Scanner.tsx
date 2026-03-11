import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
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
  checkInGate: string | null;
};

type ScanResponse = {
  outcome: ScanOutcome;
  message: string;
  scannedAt: string;
  ticket?: ScannedTicket;
};

type ScanHistoryItem = ScanResponse & { id: string };

type CheckInSummary = {
  performance: {
    id: string;
    title: string;
    startsAt: string;
    venue: string;
  };
  totalCheckedIn: number;
  totalAdmittable: number;
  gateBreakdown: Array<{ gate: string; count: number }>;
  recent: Array<{
    id: string;
    publicId: string;
    checkedInAt: string | null;
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

type DetectedBarcodeLike = { rawValue?: string };
type BarcodeDetectorLike = {
  detect: (source: HTMLVideoElement) => Promise<DetectedBarcodeLike[]>;
};
type BarcodeDetectorCtorLike = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

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

const outcomeStyles: Record<ScanOutcome, string> = {
  VALID: 'bg-green-50 border-green-300 text-green-900',
  ALREADY_CHECKED_IN: 'bg-amber-50 border-amber-300 text-amber-900',
  WRONG_PERFORMANCE: 'bg-orange-50 border-orange-300 text-orange-900',
  NOT_ADMITTED: 'bg-red-50 border-red-300 text-red-900',
  INVALID_QR: 'bg-red-50 border-red-300 text-red-900',
  NOT_FOUND: 'bg-red-50 border-red-300 text-red-900'
};

export default function AdminScannerPage() {
  const [performances, setPerformances] = useState<PerformanceRow[]>([]);
  const [performanceId, setPerformanceId] = useState('');
  const [gate, setGate] = useState('Main Entrance');
  const [manualValue, setManualValue] = useState('');
  const [cameraSupported, setCameraSupported] = useState(false);
  const [cameraRunning, setCameraRunning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [undoBusyTicketId, setUndoBusyTicketId] = useState<string | null>(null);
  const [summary, setSummary] = useState<CheckInSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ScanResponse | null>(null);
  const [history, setHistory] = useState<ScanHistoryItem[]>([]);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const intervalRef = useRef<number | null>(null);
  const scanBusyRef = useRef(false);
  const lastScannedRef = useRef<{ value: string; at: number } | null>(null);

  const selectedPerformance = useMemo(
    () => performances.find((performance) => performance.id === performanceId),
    [performances, performanceId]
  );

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

  const pushHistory = (result: ScanResponse) => {
    setHistory((current) => [{ ...result, id: makeClientId() }, ...current].slice(0, 20));
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

  const submitScan = async (scannedValue: string) => {
    if (!performanceId) return;

    scanBusyRef.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const result = await adminFetch<ScanResponse>('/api/admin/check-in/scan', {
        method: 'POST',
        body: JSON.stringify({
          performanceId,
          scannedValue,
          gate: gate.trim() || undefined
        })
      });
      setLastResult(result);
      pushHistory(result);
      await loadSummary(performanceId);
    } catch (err) {
      const fallback: ScanResponse = {
        outcome: 'INVALID_QR',
        message: err instanceof Error ? err.message : 'Scan failed',
        scannedAt: new Date().toISOString()
      };
      setLastResult(fallback);
      pushHistory(fallback);
    } finally {
      setBusy(false);
      scanBusyRef.current = false;
    }
  };

  const undoCheckIn = async (ticket: ScannedTicket) => {
    if (!performanceId) return;

    setUndoBusyTicketId(ticket.id);
    setNotice(null);
    try {
      const result = await adminFetch<UndoResponse>('/api/admin/check-in/undo', {
        method: 'POST',
        body: JSON.stringify({
          performanceId,
          ticketId: ticket.id
        })
      });

      if (!result.success) {
        setNotice({ kind: 'error', text: result.message });
      } else {
        setNotice({ kind: 'success', text: result.message });
      }

      if (result.ticket) {
        patchTicketInHistory(result.ticket);
      }

      await loadSummary(performanceId);
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Failed to undo check-in' });
    } finally {
      setUndoBusyTicketId(null);
    }
  };

  const startCamera = async () => {
    setCameraError(null);
    if (cameraRunning) return;

    const detectorCtor = getDetectorConstructor();
    if (!detectorCtor || !navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera scanning is not supported on this browser. Use manual entry below.');
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
            if (last && last.value === raw && now - last.at < 1800) return;

            lastScannedRef.current = { value: raw, at: now };
            void submitScan(raw);
          })
          .catch(() => {
            // Ignore frame-level decoding errors and keep scanning.
          });
      }, 300);
    } catch (err) {
      stopCamera();
      setCameraError(err instanceof Error ? err.message : 'Unable to access camera');
    }
  };

  useEffect(() => {
    setCameraSupported(Boolean(getDetectorConstructor() && navigator.mediaDevices?.getUserMedia));

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

    return () => {
      stopCamera();
    };
  }, []);

  useEffect(() => {
    if (!performanceId) {
      setSummary(null);
      return;
    }

    setLastResult(null);
    setHistory([]);
    setNotice(null);
    void loadSummary(performanceId);

    const handle = window.setInterval(() => {
      void loadSummary(performanceId);
    }, 5000);

    return () => {
      window.clearInterval(handle);
    };
  }, [performanceId]);

  const submitManual = (event: FormEvent) => {
    event.preventDefault();
    const value = manualValue.trim();
    if (!value || busy || !performanceId) return;
    setManualValue('');
    void submitScan(value);
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-black text-stone-900 mb-1">Ticket Scanner</h1>
        <p className="text-sm text-stone-600">Scan QR codes at the door, view live counts by gate, and undo accidental check-ins.</p>
      </div>

      {notice ? (
        <div className={`border rounded-xl px-3 py-2 text-sm ${notice.kind === 'success' ? 'border-green-300 bg-green-50 text-green-900' : 'border-red-300 bg-red-50 text-red-900'}`}>
          {notice.text}
        </div>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <select
          value={performanceId}
          onChange={(event) => setPerformanceId(event.target.value)}
          className="border border-stone-300 rounded-xl px-3 py-2"
        >
          {performances.map((performance) => (
            <option key={performance.id} value={performance.id}>
              {performance.title} - {new Date(performance.startsAt).toLocaleString()}
            </option>
          ))}
        </select>
        <input
          value={gate}
          onChange={(event) => setGate(event.target.value)}
          className="border border-stone-300 rounded-xl px-3 py-2"
          placeholder="Gate label (e.g. Main Entrance)"
        />
      </div>

      <section className="border border-stone-200 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-bold text-stone-900">Live Check-In Status</h2>
          <button type="button" onClick={() => void loadSummary()} className="text-xs px-3 py-1 rounded-lg border border-stone-300 text-stone-700">Refresh</button>
        </div>

        {summary ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <StatCard label="Checked In" value={`${summary.totalCheckedIn}`} />
              <StatCard label="Admittable Tickets" value={`${summary.totalAdmittable}`} />
              <StatCard label="Progress" value={`${checkInPct}%`} />
            </div>

            <div>
              <div className="text-xs font-semibold text-stone-500 mb-2">By Gate</div>
              <div className="flex flex-wrap gap-2">
                {summary.gateBreakdown.length === 0 ? <span className="text-xs text-stone-500">No check-ins yet.</span> : null}
                {summary.gateBreakdown.map((item) => (
                  <span key={item.gate} className="text-xs rounded-full border border-stone-300 px-3 py-1 bg-stone-50">
                    {item.gate}: {item.count}
                  </span>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="text-sm text-stone-500">Loading summary...</div>
        )}

        {summaryError ? <div className="text-xs text-red-600">{summaryError}</div> : null}
      </section>

      <div className="border border-stone-200 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm text-stone-600">
            {selectedPerformance ? `Scanning for ${selectedPerformance.title}` : 'Select a performance to scan'}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                if (cameraRunning) {
                  stopCamera();
                } else {
                  void startCamera();
                }
              }}
              className="px-3 py-2 rounded-lg text-sm font-bold bg-stone-900 text-white"
            >
              {cameraRunning ? 'Stop Camera' : 'Start Camera'}
            </button>
          </div>
        </div>

        <div className="rounded-xl overflow-hidden border border-stone-300 bg-black">
          <video ref={videoRef} className="w-full h-[260px] object-cover" playsInline muted />
        </div>

        {!cameraSupported ? <div className="text-xs text-amber-700">Camera API not supported here. Use manual scan input below.</div> : null}
        {cameraError ? <div className="text-xs text-red-600">{cameraError}</div> : null}
      </div>

      <form onSubmit={submitManual} className="border border-stone-200 rounded-2xl p-4 space-y-3">
        <div className="text-sm font-semibold text-stone-800">Manual Scan Entry</div>
        <input
          value={manualValue}
          onChange={(event) => setManualValue(event.target.value)}
          className="w-full border border-stone-300 rounded-xl px-3 py-2"
          placeholder="Paste QR payload, ticket URL, or public ticket id"
        />
        <button disabled={busy || !performanceId} className="bg-stone-900 disabled:bg-stone-400 text-white px-4 py-2 rounded-xl font-bold">
          {busy ? 'Scanning...' : 'Submit Scan'}
        </button>
      </form>

      {lastResult ? (
        <div className={`border rounded-2xl p-4 ${outcomeStyles[lastResult.outcome]}`}>
          <div className="font-black text-lg">{lastResult.outcome.replaceAll('_', ' ')}</div>
          <div className="text-sm">{lastResult.message}</div>
          {lastResult.ticket ? (
            <div className="text-xs mt-2 space-y-2">
              <div>
                Ticket {lastResult.ticket.publicId} • {lastResult.ticket.seat.sectionName} {lastResult.ticket.seat.row}-{lastResult.ticket.seat.number} •{' '}
                {lastResult.ticket.holder.customerName}
                {lastResult.ticket.checkedInAt ? ` • Checked in ${new Date(lastResult.ticket.checkedInAt).toLocaleString()}` : ''}
              </div>
              {lastResult.ticket.checkedInAt ? (
                <button
                  type="button"
                  className="text-xs px-2 py-1 rounded-md border border-amber-500 text-amber-900 bg-amber-100 disabled:opacity-60"
                  disabled={undoBusyTicketId === lastResult.ticket.id}
                  onClick={() => {
                    void undoCheckIn(lastResult.ticket!);
                  }}
                >
                  {undoBusyTicketId === lastResult.ticket.id ? 'Undoing...' : 'Undo Check-In'}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <section className="border border-stone-200 rounded-2xl p-4">
        <h2 className="font-bold text-stone-900 mb-3">Recent Scans (This Device)</h2>
        <div className="space-y-2">
          {history.map((item) => (
            <div key={item.id} className="border border-stone-200 rounded-xl p-3 text-sm">
              <div className="font-semibold text-stone-900">{item.outcome.replaceAll('_', ' ')}</div>
              <div className="text-xs text-stone-500">{new Date(item.scannedAt).toLocaleString()}</div>
              <div className="text-xs text-stone-700">{item.message}</div>
              {item.ticket ? (
                <div className="text-xs text-stone-600 mt-1 flex items-center justify-between gap-2">
                  <span>
                    {item.ticket.publicId} • {item.ticket.seat.sectionName} {item.ticket.seat.row}-{item.ticket.seat.number}
                    {item.ticket.checkedInAt ? ` • In at ${new Date(item.ticket.checkedInAt).toLocaleTimeString()}` : ''}
                  </span>
                  {item.ticket.checkedInAt ? (
                    <button
                      type="button"
                      className="text-xs px-2 py-1 rounded-md border border-amber-400 text-amber-800 bg-amber-50 disabled:opacity-60"
                      disabled={undoBusyTicketId === item.ticket.id}
                      onClick={() => {
                        void undoCheckIn(item.ticket!);
                      }}
                    >
                      {undoBusyTicketId === item.ticket.id ? 'Undoing...' : 'Undo'}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
          {history.length === 0 ? <div className="text-sm text-stone-500">No scans yet.</div> : null}
        </div>
      </section>

      <section className="border border-stone-200 rounded-2xl p-4">
        <h2 className="font-bold text-stone-900 mb-3">Recent Check-Ins (All Gates)</h2>
        <div className="space-y-2">
          {summary?.recent.length ? (
            summary.recent.map((item) => (
              <div key={item.id} className="border border-stone-200 rounded-xl p-3 text-sm flex items-center justify-between gap-2">
                <div>
                  <div className="font-semibold text-stone-900">{item.publicId} • {item.holder.customerName}</div>
                  <div className="text-xs text-stone-500">
                    {item.seat.sectionName} {item.seat.row}-{item.seat.number} • {item.checkInGate} • {item.checkedInAt ? new Date(item.checkedInAt).toLocaleString() : ''}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="text-sm text-stone-500">No checked-in tickets yet.</div>
          )}
        </div>
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-stone-200 rounded-xl p-3">
      <div className="text-xs uppercase tracking-wide text-stone-500">{label}</div>
      <div className="text-2xl font-black text-stone-900">{value}</div>
    </div>
  );
}

