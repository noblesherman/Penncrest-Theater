import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError } from '../api/client';
import type { AdminScannerSession } from '../api/mobile';

export type PersistedScannerSession = AdminScannerSession;

export type OfflineScannerQueueItem = {
  id: string;
  performanceId: string;
  sessionToken: string;
  scannedValue: string;
  clientScanId: string;
  queuedAt: string;
};

const SESSION_STORAGE_KEY = 'theater.mobile.scanner.sessions.v1';
const OFFLINE_QUEUE_KEY = 'theater.mobile.scanner.queue.v1';

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
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function isScannerNetworkError(err: unknown): boolean {
  if (err instanceof ApiError) {
    return err.status === 0;
  }
  if (!(err instanceof Error)) {
    return false;
  }
  const message = err.message.toLowerCase();
  return (
    message.includes('network request failed') ||
    message.includes('network') ||
    message.includes('timed out') ||
    message.includes('timeout')
  );
}

export async function readStoredScannerSessions(): Promise<Record<string, PersistedScannerSession>> {
  const raw = await AsyncStorage.getItem(SESSION_STORAGE_KEY);
  return parseJsonSafe(raw, {} as Record<string, PersistedScannerSession>);
}

export async function writeStoredScannerSessions(
  sessions: Record<string, PersistedScannerSession>
): Promise<void> {
  await AsyncStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessions));
}

export async function persistScannerSessionForPerformance(
  performanceId: string,
  session: PersistedScannerSession | null
): Promise<void> {
  const sessions = await readStoredScannerSessions();
  if (session) {
    sessions[performanceId] = session;
  } else {
    delete sessions[performanceId];
  }
  await writeStoredScannerSessions(sessions);
}

export async function readOfflineScannerQueue(): Promise<OfflineScannerQueueItem[]> {
  const raw = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
  return parseJsonSafe(raw, [] as OfflineScannerQueueItem[]);
}

export async function writeOfflineScannerQueue(items: OfflineScannerQueueItem[]): Promise<void> {
  await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(items));
}

export async function enqueueOfflineScannerItem(
  item: Omit<OfflineScannerQueueItem, 'id' | 'queuedAt'>
): Promise<OfflineScannerQueueItem[]> {
  const nextItem: OfflineScannerQueueItem = {
    id: makeScannerClientId(),
    queuedAt: new Date().toISOString(),
    ...item
  };
  const nextQueue = [...(await readOfflineScannerQueue()), nextItem];
  await writeOfflineScannerQueue(nextQueue);
  return nextQueue;
}
