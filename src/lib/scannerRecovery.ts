export type PersistedScannerSession = {
  sessionId: string;
  sessionToken: string;
  performanceId: string;
  staffName: string;
  gate: string;
  deviceLabel: string | null;
  createdAt: string;
};

export type OfflineScannerQueueItem = {
  id: string;
  performanceId: string;
  sessionToken: string;
  scannedValue: string;
  clientScanId: string;
  queuedAt: string;
};

const SESSION_STORAGE_KEY = 'theater_scanner_sessions_v1';
const OFFLINE_QUEUE_KEY = 'theater_scanner_queue_v1';

function parseJsonSafe<T>(value: string | null, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function makeScannerClientId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function isScannerNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }

  const message = err.message.toLowerCase();
  return message.includes('failed to fetch') || message.includes('network') || message.includes('load failed');
}

export function readStoredScannerSessions(): Record<string, PersistedScannerSession> {
  return parseJsonSafe(
    typeof window === 'undefined' ? null : window.localStorage.getItem(SESSION_STORAGE_KEY),
    {} as Record<string, PersistedScannerSession>
  );
}

export function writeStoredScannerSessions(
  sessions: Record<string, PersistedScannerSession>
): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessions));
}

export function persistScannerSessionForPerformance(
  performanceId: string,
  session: PersistedScannerSession | null
): void {
  const sessions = readStoredScannerSessions();
  if (session) {
    sessions[performanceId] = session;
  } else {
    delete sessions[performanceId];
  }
  writeStoredScannerSessions(sessions);
}

export function readOfflineScannerQueue(): OfflineScannerQueueItem[] {
  return parseJsonSafe(
    typeof window === 'undefined' ? null : window.localStorage.getItem(OFFLINE_QUEUE_KEY),
    [] as OfflineScannerQueueItem[]
  );
}

export function writeOfflineScannerQueue(items: OfflineScannerQueueItem[]): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(items));
}

export function enqueueOfflineScannerItem(
  item: Omit<OfflineScannerQueueItem, 'id' | 'queuedAt'>
): OfflineScannerQueueItem[] {
  const nextItem: OfflineScannerQueueItem = {
    id: makeScannerClientId(),
    queuedAt: new Date().toISOString(),
    ...item
  };
  const nextQueue = [...readOfflineScannerQueue(), nextItem];
  writeOfflineScannerQueue(nextQueue);
  return nextQueue;
}
