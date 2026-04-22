/*
Handoff note for Mr. Smith:
- File: `mobile/src/screens/ScanScreen.tsx`
- What this is: React Native screen module.
- What it does: Implements one full mobile screen and its workflow logic.
- Connections: Registered through navigator and connected to mobile api/device/payment helpers.
- Main content type: Screen layout + user flow logic + visible operator text.
- Safe edits here: UI copy tweaks and presentational layout polish.
- Be careful with: Navigation params, async state flow, and payment/scan side effects.
- Useful context: If terminal workflows feel off, these screen files are key investigation points.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  Vibration,
  View,
  useWindowDimensions
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  endAdminScannerSession,
  fetchAdminScannerPerformances,
  lookupAdminScannerTickets,
  startAdminScannerSession,
  submitAdminScannerScan,
  type AdminScannerLookupResult,
  type AdminScannerOutcome,
  type AdminScannerPerformance,
  type AdminScannerScanResponse,
  type AdminScannerSession
} from '../api/mobile';
import { useAuth } from '../auth/AuthContext';
import {
  enqueueOfflineScannerItem,
  isScannerNetworkError,
  makeScannerClientId,
  persistScannerSessionForPerformance,
  readOfflineScannerQueue,
  readStoredScannerSessions,
  writeOfflineScannerQueue,
  type OfflineScannerQueueItem
} from '../lib/scannerRecovery';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'ScanTickets'>;

type FlashTone = 'success' | 'warn' | 'error' | null;

type Notice = {
  kind: 'success' | 'error';
  text: string;
};

const outcomeConfig: Record<
  AdminScannerOutcome,
  { label: string; icon: string; resultBg: string; resultBorder: string; resultText: string }
> = {
  VALID: {
    label: 'ADMITTED',
    icon: '✓',
    resultBg: '#052e1a',
    resultBorder: '#22c55e',
    resultText: '#86efac'
  },
  ALREADY_CHECKED_IN: {
    label: 'ALREADY IN',
    icon: '!',
    resultBg: '#451a03',
    resultBorder: '#f59e0b',
    resultText: '#fcd34d'
  },
  WRONG_PERFORMANCE: {
    label: 'WRONG SHOW',
    icon: '✕',
    resultBg: '#431407',
    resultBorder: '#f97316',
    resultText: '#fdba74'
  },
  NOT_ADMITTED: {
    label: 'DENIED',
    icon: '✕',
    resultBg: '#450a0a',
    resultBorder: '#ef4444',
    resultText: '#fca5a5'
  },
  INVALID_QR: {
    label: 'INVALID QR',
    icon: '✕',
    resultBg: '#450a0a',
    resultBorder: '#ef4444',
    resultText: '#fca5a5'
  },
  NOT_FOUND: {
    label: 'NOT FOUND',
    icon: '✕',
    resultBg: '#450a0a',
    resultBorder: '#ef4444',
    resultText: '#fca5a5'
  }
};

function flashForOutcome(outcome: AdminScannerOutcome): FlashTone {
  if (outcome === 'VALID') return 'success';
  if (outcome === 'ALREADY_CHECKED_IN' || outcome === 'WRONG_PERFORMANCE') return 'warn';
  return 'error';
}

function formatStartsAt(startsAt: string): string {
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) {
    return startsAt;
  }
  return date.toLocaleString();
}

export function ScanScreen({ navigation }: Props) {
  const { token } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const [performances, setPerformances] = useState<AdminScannerPerformance[]>([]);
  const [performanceId, setPerformanceId] = useState('');
  const [sessionDraft, setSessionDraft] = useState({
    staffName: '',
    gate: 'Main Entrance',
    deviceLabel: 'iPhone Scanner'
  });
  const [scannerSession, setScannerSession] = useState<AdminScannerSession | null>(null);
  const [cameraRunning, setCameraRunning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [lastResult, setLastResult] = useState<AdminScannerScanResponse | null>(null);
  const [flashTone, setFlashTone] = useState<FlashTone>(null);
  const [showLookup, setShowLookup] = useState(false);
  const [lookupQuery, setLookupQuery] = useState('');
  const [lookupRows, setLookupRows] = useState<AdminScannerLookupResult[]>([]);
  const [lookupBusyTicketId, setLookupBusyTicketId] = useState<string | null>(null);
  const [lookupSearched, setLookupSearched] = useState(false);
  const [showSessionPanel, setShowSessionPanel] = useState(false);
  const [offlineQueue, setOfflineQueue] = useState<OfflineScannerQueueItem[]>([]);
  const [isSyncingQueue, setIsSyncingQueue] = useState(false);

  const lastScannedRef = useRef<{ value: string; at: number } | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanLineAnim = useRef(new Animated.Value(0)).current;

  const frameSize = Math.min(width * 0.72, 320);
  const sessionReady = Boolean(scannerSession && scannerSession.performanceId === performanceId);
  const selectedPerformance = useMemo(
    () => performances.find((perf) => perf.id === performanceId) || null,
    [performances, performanceId]
  );
  const cfg = lastResult ? outcomeConfig[lastResult.outcome] : null;

  const stopCamera = useCallback(() => {
    setCameraRunning(false);
    lastScannedRef.current = null;
  }, []);

  const setFlash = useCallback((tone: FlashTone) => {
    if (flashTimerRef.current) {
      clearTimeout(flashTimerRef.current);
    }
    setFlashTone(tone);
    flashTimerRef.current = setTimeout(() => {
      setFlashTone(null);
      flashTimerRef.current = null;
    }, 900);
  }, []);

  const enqueueOffline = useCallback(
    async (scannedValue: string, clientScanId: string) => {
      if (!sessionReady || !scannerSession || !performanceId) {
        return;
      }
      const next = await enqueueOfflineScannerItem({
        performanceId,
        sessionToken: scannerSession.sessionToken,
        scannedValue,
        clientScanId
      });
      setOfflineQueue(next);
      setNotice({
        kind: 'error',
        text: `Offline. Queued ${next.length} scan${next.length === 1 ? '' : 's'}.`
      });
      setFlash('warn');
    },
    [performanceId, scannerSession, sessionReady, setFlash]
  );

  const submitScan = useCallback(
    async (scannedValue: string): Promise<AdminScannerScanResponse | null> => {
      if (!token || !sessionReady || !scannerSession || !performanceId) {
        setNotice({ kind: 'error', text: 'Start a scanner session first.' });
        return null;
      }

      const clientScanId = makeScannerClientId();
      setBusy(true);
      setNotice(null);
      try {
        const result = await submitAdminScannerScan(token, {
          performanceId,
          sessionToken: scannerSession.sessionToken,
          scannedValue,
          clientScanId
        });

        setLastResult(result);
        setFlash(flashForOutcome(result.outcome));
        setLookupRows((rows) => rows.map((row) => (row.id === result.ticket?.id ? { ...row, ...result.ticket } : row)));
        Vibration.vibrate(result.outcome === 'VALID' ? 50 : [80, 30, 80]);
        return result;
      } catch (err) {
        if (isScannerNetworkError(err)) {
          await enqueueOffline(scannedValue, clientScanId);
          return null;
        }

        const fallback: AdminScannerScanResponse = {
          outcome: 'INVALID_QR',
          message: err instanceof Error ? err.message : 'Scan failed',
          scannedAt: new Date().toISOString()
        };
        setLastResult(fallback);
        setFlash('error');
        Vibration.vibrate([80, 30, 80]);
        return fallback;
      } finally {
        setBusy(false);
      }
    },
    [enqueueOffline, performanceId, scannerSession, sessionReady, setFlash, token]
  );

  const syncOfflineQueue = useCallback(async () => {
    if (!token || isSyncingQueue) {
      return;
    }

    const queued = await readOfflineScannerQueue();
    if (queued.length === 0) {
      setOfflineQueue([]);
      return;
    }

    setIsSyncingQueue(true);
    try {
      const storedSessions = await readStoredScannerSessions();
      const remaining: OfflineScannerQueueItem[] = [];
      let blockedMessage: string | null = null;

      for (let index = 0; index < queued.length; index += 1) {
        const item = queued[index];
        const sessionToken =
          (item.performanceId === performanceId && scannerSession?.performanceId === item.performanceId
            ? scannerSession.sessionToken
            : storedSessions[item.performanceId]?.sessionToken) || item.sessionToken;

        try {
          const result = await submitAdminScannerScan(token, {
            performanceId: item.performanceId,
            sessionToken,
            scannedValue: item.scannedValue,
            clientScanId: item.clientScanId,
            offlineQueuedAt: item.queuedAt
          });
          setLastResult(result);
          setFlash(flashForOutcome(result.outcome));
          setLookupRows((rows) => rows.map((row) => (row.id === result.ticket?.id ? { ...row, ...result.ticket } : row)));
        } catch (err) {
          if (isScannerNetworkError(err)) {
            remaining.push(item, ...queued.slice(index + 1));
            break;
          }

          const message = err instanceof Error ? err.message.toLowerCase() : '';
          if (
            message.includes('session is not active') ||
            message.includes('unauthorized') ||
            message.includes('forbidden')
          ) {
            remaining.push(item, ...queued.slice(index + 1));
            blockedMessage = 'Queue sync paused. Start a scanner session for this performance.';
            break;
          }
        }
      }

      await writeOfflineScannerQueue(remaining);
      setOfflineQueue(remaining);
      setNotice({
        kind: remaining.length === 0 ? 'success' : 'error',
        text:
          remaining.length === 0
            ? 'Queued scans synced.'
            : blockedMessage || `${remaining.length} queued scan${remaining.length === 1 ? '' : 's'} still pending.`
      });
    } finally {
      setIsSyncingQueue(false);
    }
  }, [isSyncingQueue, performanceId, scannerSession, setFlash, token]);

  const startSession = useCallback(async () => {
    if (!token || !performanceId) {
      return;
    }
    if (!sessionDraft.staffName.trim() || !sessionDraft.gate.trim()) {
      setNotice({ kind: 'error', text: 'Staff name and gate are required.' });
      return;
    }

    try {
      const session = await startAdminScannerSession(token, {
        performanceId,
        staffName: sessionDraft.staffName.trim(),
        gate: sessionDraft.gate.trim(),
        deviceLabel: sessionDraft.deviceLabel.trim() || undefined
      });

      setScannerSession(session);
      setSessionDraft((draft) => ({ ...draft, gate: session.gate }));
      await persistScannerSessionForPerformance(session.performanceId, session);
      setNotice({ kind: 'success', text: `Session started for ${session.staffName} (${session.gate}).` });
      setShowSessionPanel(false);
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'We hit a small backstage snag while trying to start session' });
    }
  }, [performanceId, sessionDraft.deviceLabel, sessionDraft.gate, sessionDraft.staffName, token]);

  const endSession = useCallback(async () => {
    if (!token || !scannerSession) {
      return;
    }

    try {
      await endAdminScannerSession(token, scannerSession.sessionToken);
      await persistScannerSessionForPerformance(scannerSession.performanceId, null);
      setScannerSession(null);
      setNotice({ kind: 'success', text: 'Scanner session ended.' });
      stopCamera();
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'We hit a small backstage snag while trying to end session' });
    }
  }, [scannerSession, stopCamera, token]);

  const searchLookup = useCallback(async () => {
    if (!token || !performanceId || !lookupQuery.trim()) {
      return;
    }

    setLookupSearched(true);
    setNotice(null);
    try {
      const rows = await lookupAdminScannerTickets(token, {
        performanceId,
        query: lookupQuery,
        limit: 8
      });
      setLookupRows(rows);
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'Lookup failed' });
    }
  }, [lookupQuery, performanceId, token]);

  const checkInLookupTicket = useCallback(
    async (ticket: AdminScannerLookupResult) => {
      if (busy || lookupBusyTicketId) {
        return;
      }

      setLookupBusyTicketId(ticket.id);
      try {
        const result = await submitScan(ticket.publicId);
        if (result?.outcome === 'VALID') {
          setShowLookup(false);
        }
      } finally {
        setLookupBusyTicketId(null);
      }
    },
    [busy, lookupBusyTicketId, submitScan]
  );

  const handleBarcodeScanned = useCallback(
    ({ data }: BarcodeScanningResult) => {
      if (!cameraRunning || busy) {
        return;
      }

      const value = data.trim();
      if (!value) {
        return;
      }

      const now = Date.now();
      const last = lastScannedRef.current;
      if (last && last.value === value && now - last.at < 1500) {
        return;
      }

      lastScannedRef.current = { value, at: now };
      void submitScan(value);
    },
    [busy, cameraRunning, submitScan]
  );

  const startCamera = useCallback(async () => {
    setCameraError(null);

    if (!sessionReady) {
      setCameraError('Start a scanner session first.');
      return;
    }

    if (!permission?.granted) {
      await requestPermission();
      return;
    }

    setCameraRunning(true);
  }, [permission?.granted, requestPermission, sessionReady]);

  useEffect(() => {
    if (!cameraRunning) {
      scanLineAnim.stopAnimation();
      return;
    }

    scanLineAnim.setValue(0);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scanLineAnim, { toValue: 1, duration: 1400, useNativeDriver: true }),
        Animated.timing(scanLineAnim, { toValue: 0, duration: 1400, useNativeDriver: true })
      ])
    );

    loop.start();
    return () => {
      loop.stop();
      scanLineAnim.setValue(0);
    };
  }, [cameraRunning, scanLineAnim]);

  useEffect(() => {
    let cancelled = false;

    const loadInitialState = async () => {
      if (!token) {
        return;
      }

      try {
        const [queue, rawPerformances, sessions] = await Promise.all([
          readOfflineScannerQueue(),
          fetchAdminScannerPerformances(token),
          readStoredScannerSessions()
        ]);

        if (cancelled) {
          return;
        }

        const activePerformances = rawPerformances.filter((row) => !row.isArchived);
        setOfflineQueue(queue);
        setPerformances(activePerformances);

        if (activePerformances.length === 0) {
          setPerformanceId('');
          setScannerSession(null);
          return;
        }

        const defaultPerformanceId = activePerformances[0].id;
        setPerformanceId(defaultPerformanceId);
        setScannerSession(sessions[defaultPerformanceId] || null);
      } catch (err) {
        if (!cancelled) {
          setNotice({ kind: 'error', text: err instanceof Error ? err.message : 'We hit a small backstage snag while trying to load scanner' });
        }
      }
    };

    void loadInitialState();

    return () => {
      cancelled = true;
      if (flashTimerRef.current) {
        clearTimeout(flashTimerRef.current);
        flashTimerRef.current = null;
      }
      stopCamera();
    };
  }, [stopCamera, token]);

  useEffect(() => {
    setLastResult(null);
    setNotice(null);
    setShowLookup(false);
    setLookupQuery('');
    setLookupRows([]);
    setLookupSearched(false);
    stopCamera();

    let cancelled = false;
    if (!performanceId) {
      setScannerSession(null);
      return;
    }

    void readStoredScannerSessions()
      .then((sessions) => {
        if (cancelled) {
          return;
        }
        setScannerSession((current) => {
          if (current?.performanceId === performanceId) {
            return current;
          }
          return sessions[performanceId] || null;
        });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [performanceId, stopCamera]);

  useFocusEffect(
    useCallback(() => {
      void syncOfflineQueue();
      return undefined;
    }, [syncOfflineQueue])
  );

  useEffect(() => {
    if (offlineQueue.length === 0) {
      return;
    }

    const timer = setInterval(() => {
      void syncOfflineQueue();
    }, 12000);

    return () => clearInterval(timer);
  }, [offlineQueue.length, syncOfflineQueue]);

  const flashColorStyle =
    flashTone === 'success'
      ? styles.flashSuccess
      : flashTone === 'warn'
      ? styles.flashWarn
      : flashTone === 'error'
      ? styles.flashError
      : styles.flashNone;

  const scanLineTranslate = scanLineAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-frameSize / 2 + 14, frameSize / 2 - 14]
  });

  if (!permission) {
    return (
      <View style={styles.loadingRoot}>
        <ActivityIndicator size="large" color="#ef4444" />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.root}>
        <View style={styles.cameraFallback} />
        <View style={styles.dimOverlay} />
        <View style={[styles.permissionPanel, { marginTop: insets.top + 24 }]}> 
          <Text style={styles.permissionLabel}>Camera Access</Text>
          <Text style={styles.permissionBody}>Camera permission is required to scan ticket QR codes.</Text>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => {
              void requestPermission();
            }}
            activeOpacity={0.8}
          >
            <Text style={styles.primaryButtonText}>Enable Camera</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {cameraRunning ? (
        <CameraView
          style={styles.camera}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={handleBarcodeScanned}
          onMountError={(event) => {
            setCameraError(event.message);
            stopCamera();
          }}
        />
      ) : (
        <View style={styles.cameraFallback} />
      )}

      <View style={styles.dimOverlay} pointerEvents="none" />
      <View style={[styles.flashOverlay, flashColorStyle]} pointerEvents="none" />

      <View style={styles.viewfinderWrap} pointerEvents="none">
        <View style={[styles.viewfinderFrame, { width: frameSize, height: frameSize }]}> 
          <View style={[styles.corner, styles.cornerTopLeft]} />
          <View style={[styles.corner, styles.cornerTopRight]} />
          <View style={[styles.corner, styles.cornerBottomLeft]} />
          <View style={[styles.corner, styles.cornerBottomRight]} />
          {cameraRunning ? (
            <Animated.View
              style={[styles.scanLine, { transform: [{ translateY: scanLineTranslate }] }]}
            />
          ) : null}
        </View>
      </View>

      <View style={[styles.topBar, { paddingTop: insets.top + 10 }]}> 
        <View style={styles.topRow}>
          <TouchableOpacity
            style={styles.chipButton}
            onPress={() => navigation.goBack()}
            activeOpacity={0.8}
          >
            <Text style={styles.chipButtonText}>Console</Text>
          </TouchableOpacity>

          <View style={styles.performanceChip}>
            <Text numberOfLines={1} style={styles.performanceChipText}>
              {selectedPerformance ? selectedPerformance.title : 'No active performances'}
            </Text>
          </View>

          <TouchableOpacity
            style={[
              styles.sessionToggle,
              sessionReady ? styles.sessionToggleReady : styles.sessionToggleMissing
            ]}
            onPress={() => setShowSessionPanel((value) => !value)}
            activeOpacity={0.8}
          >
            <Text
              numberOfLines={1}
              style={[styles.sessionToggleText, sessionReady ? styles.sessionToggleTextReady : styles.sessionToggleTextMissing]}
            >
              {sessionReady && scannerSession ? scannerSession.gate : 'Setup'}
            </Text>
          </TouchableOpacity>
        </View>

        {notice ? (
          <View style={[styles.notice, notice.kind === 'success' ? styles.noticeSuccess : styles.noticeError]}>
            <Text style={styles.noticeText}>{notice.text}</Text>
          </View>
        ) : null}

        {(offlineQueue.length > 0 || isSyncingQueue) && (
          <View style={styles.queueNotice}>
            <Text style={styles.queueNoticeText}>
              {isSyncingQueue
                ? `Syncing ${offlineQueue.length} queued scan${offlineQueue.length === 1 ? '' : 's'}...`
                : `${offlineQueue.length} queued scan${offlineQueue.length === 1 ? '' : 's'} waiting for sync.`}
            </Text>
          </View>
        )}

        {showSessionPanel ? (
          <View style={styles.sessionPanel}>
            <Text style={styles.sessionPanelTitle}>Session Setup</Text>

            <Text style={styles.sessionPanelLabel}>Performance</Text>
            <ScrollView style={styles.performanceList} nestedScrollEnabled>
              {performances.map((performance) => {
                const selected = performance.id === performanceId;
                return (
                  <TouchableOpacity
                    key={performance.id}
                    style={[styles.performanceOption, selected && styles.performanceOptionSelected]}
                    onPress={() => setPerformanceId(performance.id)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.performanceOptionTitle, selected && styles.performanceOptionTitleSelected]}>
                      {performance.title}
                    </Text>
                    <Text style={styles.performanceOptionDate}>{formatStartsAt(performance.startsAt)}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {!sessionReady ? (
              <>
                <TextInput
                  value={sessionDraft.staffName}
                  onChangeText={(value) => setSessionDraft((draft) => ({ ...draft, staffName: value }))}
                  placeholder="Your name"
                  placeholderTextColor="#71717a"
                  style={styles.panelInput}
                  autoCapitalize="words"
                />
                <TextInput
                  value={sessionDraft.gate}
                  onChangeText={(value) => setSessionDraft((draft) => ({ ...draft, gate: value }))}
                  placeholder="Gate"
                  placeholderTextColor="#71717a"
                  style={styles.panelInput}
                  autoCapitalize="words"
                />
                <TextInput
                  value={sessionDraft.deviceLabel}
                  onChangeText={(value) => setSessionDraft((draft) => ({ ...draft, deviceLabel: value }))}
                  placeholder="Device label"
                  placeholderTextColor="#71717a"
                  style={styles.panelInput}
                  autoCapitalize="words"
                />
                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={() => {
                    void startSession();
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={styles.primaryButtonText}>Start Session</Text>
                </TouchableOpacity>
              </>
            ) : (
              <View style={styles.sessionReadyCard}>
                <View style={styles.sessionReadyTextWrap}>
                  <Text style={styles.sessionReadyTitle}>{scannerSession?.staffName} · {scannerSession?.gate}</Text>
                  <Text style={styles.sessionReadyMeta}>
                    Since {scannerSession ? new Date(scannerSession.createdAt).toLocaleTimeString() : ''}
                  </Text>
                </View>
                <TouchableOpacity
                  style={styles.endSessionButton}
                  onPress={() => {
                    void endSession();
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={styles.endSessionButtonText}>End</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        ) : null}
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 14 }]}> 
        <View
          style={[
            styles.resultCard,
            cfg
              ? {
                  borderColor: cfg.resultBorder,
                  backgroundColor: cfg.resultBg
                }
              : null
          ]}
        >
          {cfg && lastResult ? (
            <View style={styles.resultRow}>
              <View style={[styles.resultIconWrap, { borderColor: cfg.resultBorder }]}>
                <Text style={[styles.resultIcon, { color: cfg.resultText }]}>{cfg.icon}</Text>
              </View>
              <View style={styles.resultTextWrap}>
                <Text style={[styles.resultLabel, { color: cfg.resultText }]}>{cfg.label}</Text>
                <Text style={styles.resultMessage}>{lastResult.message}</Text>
                {lastResult.ticket ? (
                  <>
                    <Text style={styles.resultDetailStrong}>{lastResult.ticket.holder.customerName}</Text>
                    <Text style={styles.resultDetail}>
                      {lastResult.ticket.seat.sectionName} · Row {lastResult.ticket.seat.row} · Seat {lastResult.ticket.seat.number}
                    </Text>
                    <Text style={styles.resultDetailMuted}>{lastResult.ticket.publicId}</Text>
                  </>
                ) : null}
              </View>
            </View>
          ) : (
            <View style={styles.readyRow}>
              <View style={styles.readyIconWrap}>
                <Text style={styles.readyIcon}>◻</Text>
              </View>
              <View>
                <Text style={styles.readyLabel}>READY TO SCAN</Text>
                <Text style={styles.readySubtext}>Aim camera at a QR code</Text>
              </View>
            </View>
          )}
        </View>

        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.primaryAction, cameraRunning ? styles.secondaryAction : null, !sessionReady ? styles.disabledAction : null]}
            onPress={() => {
              if (cameraRunning) {
                stopCamera();
              } else {
                void startCamera();
              }
            }}
            disabled={!sessionReady}
            activeOpacity={0.8}
          >
            <Text style={[styles.primaryActionText, cameraRunning ? styles.secondaryActionText : null]}>
              {cameraRunning ? 'Stop Camera' : 'Start Camera'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.iconAction, showLookup ? styles.iconActionActive : null]}
            onPress={() => setShowLookup((value) => !value)}
            activeOpacity={0.8}
          >
            <Text style={styles.iconActionText}>⌕</Text>
          </TouchableOpacity>

          {offlineQueue.length > 0 ? (
            <TouchableOpacity
              style={styles.queueAction}
              onPress={() => {
                void syncOfflineQueue();
              }}
              disabled={isSyncingQueue}
              activeOpacity={0.8}
            >
              <Text style={styles.queueActionText}>{isSyncingQueue ? '...' : String(offlineQueue.length)}</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {showLookup ? (
          <View style={styles.lookupPanel}>
            <View style={styles.lookupSearchRow}>
              <TextInput
                value={lookupQuery}
                onChangeText={setLookupQuery}
                placeholder="Search name or email"
                placeholderTextColor="#71717a"
                style={styles.lookupInput}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                onSubmitEditing={() => {
                  void searchLookup();
                }}
              />
              <TouchableOpacity
                style={[styles.lookupButton, (!sessionReady || !lookupQuery.trim()) && styles.disabledAction]}
                onPress={() => {
                  void searchLookup();
                }}
                disabled={!sessionReady || !lookupQuery.trim()}
                activeOpacity={0.8}
              >
                <Text style={styles.lookupButtonText}>Find</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.lookupList} nestedScrollEnabled>
              {lookupRows.map((ticket) => {
                const checkedIn = Boolean(ticket.checkedInAt);
                const checkingIn = lookupBusyTicketId === ticket.id;

                return (
                  <View key={ticket.id} style={styles.lookupCard}>
                    <View style={styles.lookupCardBody}>
                      <View style={styles.lookupCopy}>
                        <Text style={styles.lookupName} numberOfLines={1}>{ticket.holder.customerName}</Text>
                        <Text style={styles.lookupEmail} numberOfLines={1}>{ticket.holder.customerEmail}</Text>
                        <Text style={styles.lookupSeat}>
                          {ticket.seat.sectionName} · {ticket.seat.row}-{ticket.seat.number}
                          {checkedIn ? ` · In at ${ticket.checkInGate || 'gate'}` : ''}
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={styles.lookupCheckinButton}
                        onPress={() => {
                          void checkInLookupTicket(ticket);
                        }}
                        disabled={!sessionReady || busy || checkedIn || Boolean(lookupBusyTicketId)}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.lookupCheckinButtonText}>
                          {checkingIn ? '...' : checkedIn ? 'In' : 'Check In'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}

              {lookupSearched && lookupRows.length === 0 ? (
                <View style={styles.lookupEmptyState}>
                  <Text style={styles.lookupEmptyStateText}>No guests matched this search.</Text>
                </View>
              ) : null}
            </ScrollView>

            <Text style={styles.lookupHint}>
              Search by name or email, then tap Check In.
            </Text>

            {cameraError ? <Text style={styles.cameraErrorText}>{cameraError}</Text> : null}
          </View>
        ) : cameraError ? (
          <View style={styles.cameraErrorInline}>
            <Text style={styles.cameraErrorText}>{cameraError}</Text>
          </View>
        ) : null}

        {busy ? (
          <View style={styles.busyOverlay}>
            <ActivityIndicator size="small" color="#ffffff" />
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000'
  },
  loadingRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000000'
  },
  camera: {
    ...StyleSheet.absoluteFillObject
  },
  cameraFallback: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000'
  },
  dimOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)'
  },
  flashOverlay: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0
  },
  flashNone: {
    backgroundColor: 'transparent'
  },
  flashSuccess: {
    backgroundColor: 'rgba(34,197,94,0.38)',
    opacity: 1
  },
  flashWarn: {
    backgroundColor: 'rgba(245,158,11,0.34)',
    opacity: 1
  },
  flashError: {
    backgroundColor: 'rgba(239,68,68,0.4)',
    opacity: 1
  },
  viewfinderWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center'
  },
  viewfinderFrame: {
    position: 'relative'
  },
  corner: {
    position: 'absolute',
    width: 32,
    height: 32,
    borderColor: '#ffffff',
    borderWidth: 3
  },
  cornerTopLeft: {
    top: 0,
    left: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0
  },
  cornerTopRight: {
    top: 0,
    right: 0,
    borderLeftWidth: 0,
    borderBottomWidth: 0
  },
  cornerBottomLeft: {
    bottom: 0,
    left: 0,
    borderTopWidth: 0,
    borderRightWidth: 0
  },
  cornerBottomRight: {
    bottom: 0,
    right: 0,
    borderTopWidth: 0,
    borderLeftWidth: 0
  },
  scanLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    height: 2,
    backgroundColor: 'rgba(239,68,68,0.84)'
  },
  topBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 20,
    paddingHorizontal: 16
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  chipButton: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 12,
    paddingVertical: 9
  },
  chipButtonText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    fontWeight: '700'
  },
  performanceChip: {
    flex: 1,
    minWidth: 0,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 12,
    paddingVertical: 9
  },
  performanceChipText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center'
  },
  sessionToggle: {
    borderRadius: 12,
    borderWidth: 1,
    minWidth: 74,
    paddingHorizontal: 12,
    paddingVertical: 9,
    alignItems: 'center'
  },
  sessionToggleReady: {
    borderColor: 'rgba(34,197,94,0.5)',
    backgroundColor: 'rgba(6,78,59,0.9)'
  },
  sessionToggleMissing: {
    borderColor: 'rgba(239,68,68,0.5)',
    backgroundColor: 'rgba(127,29,29,0.9)'
  },
  sessionToggleText: {
    fontSize: 12,
    fontWeight: '700'
  },
  sessionToggleTextReady: {
    color: '#86efac'
  },
  sessionToggleTextMissing: {
    color: '#fca5a5'
  },
  notice: {
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  noticeSuccess: {
    borderColor: 'rgba(34,197,94,0.5)',
    backgroundColor: 'rgba(6,78,59,0.9)'
  },
  noticeError: {
    borderColor: 'rgba(239,68,68,0.5)',
    backgroundColor: 'rgba(127,29,29,0.9)'
  },
  noticeText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '500'
  },
  queueNotice: {
    marginTop: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.45)',
    backgroundColor: 'rgba(120,53,15,0.92)',
    paddingHorizontal: 14,
    paddingVertical: 10
  },
  queueNoticeText: {
    color: '#fde68a',
    fontSize: 12
  },
  sessionPanel: {
    marginTop: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    backgroundColor: 'rgba(9,9,11,0.96)',
    padding: 14,
    maxHeight: 420
  },
  sessionPanelTitle: {
    color: '#a1a1aa',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 10
  },
  sessionPanelLabel: {
    color: '#a1a1aa',
    fontSize: 12,
    marginBottom: 6
  },
  performanceList: {
    maxHeight: 132,
    marginBottom: 10
  },
  performanceOption: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#3f3f46',
    backgroundColor: '#27272a',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 6
  },
  performanceOptionSelected: {
    borderColor: '#dc2626',
    backgroundColor: '#450a0a'
  },
  performanceOptionTitle: {
    color: '#f4f4f5',
    fontSize: 12,
    fontWeight: '700'
  },
  performanceOptionTitleSelected: {
    color: '#fecaca'
  },
  performanceOptionDate: {
    color: '#a1a1aa',
    fontSize: 11,
    marginTop: 2
  },
  panelInput: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#3f3f46',
    backgroundColor: '#27272a',
    color: '#fafafa',
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8
  },
  primaryButton: {
    borderRadius: 12,
    backgroundColor: '#dc2626',
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center'
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800'
  },
  sessionReadyCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#166534',
    backgroundColor: '#022c22',
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10
  },
  sessionReadyTextWrap: {
    flex: 1,
    minWidth: 0
  },
  sessionReadyTitle: {
    color: '#86efac',
    fontSize: 13,
    fontWeight: '700'
  },
  sessionReadyMeta: {
    color: '#4ade80',
    fontSize: 11,
    marginTop: 2
  },
  endSessionButton: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#b91c1c',
    backgroundColor: '#450a0a',
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  endSessionButtonText: {
    color: '#fca5a5',
    fontSize: 12,
    fontWeight: '700'
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
    paddingHorizontal: 16,
    paddingTop: 12
  },
  resultCard: {
    marginBottom: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    backgroundColor: 'rgba(0,0,0,0.7)',
    padding: 14
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12
  },
  resultIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0
  },
  resultIcon: {
    fontSize: 20,
    fontWeight: '800'
  },
  resultTextWrap: {
    flex: 1,
    minWidth: 0
  },
  resultLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8
  },
  resultMessage: {
    marginTop: 2,
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700'
  },
  resultDetailStrong: {
    marginTop: 6,
    color: '#e4e4e7',
    fontSize: 12,
    fontWeight: '700'
  },
  resultDetail: {
    marginTop: 2,
    color: '#a1a1aa',
    fontSize: 12
  },
  resultDetailMuted: {
    marginTop: 2,
    color: '#71717a',
    fontSize: 11
  },
  readyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  },
  readyIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  readyIcon: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 18,
    fontWeight: '700'
  },
  readyLabel: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8
  },
  readySubtext: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 14,
    marginTop: 2
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  primaryAction: {
    flex: 1,
    borderRadius: 14,
    backgroundColor: '#dc2626',
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center'
  },
  secondaryAction: {
    borderWidth: 1,
    borderColor: '#52525b',
    backgroundColor: 'rgba(39,39,42,0.95)'
  },
  disabledAction: {
    opacity: 0.5
  },
  primaryActionText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800'
  },
  secondaryActionText: {
    color: '#d4d4d8'
  },
  iconAction: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    backgroundColor: 'rgba(0,0,0,0.6)',
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center'
  },
  iconActionActive: {
    borderColor: 'rgba(255,255,255,0.3)',
    backgroundColor: 'rgba(255,255,255,0.2)'
  },
  iconActionText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 24,
    fontWeight: '600',
    marginTop: -2
  },
  queueAction: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.35)',
    backgroundColor: 'rgba(120,53,15,0.9)',
    minWidth: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10
  },
  queueActionText: {
    color: '#fde68a',
    fontSize: 15,
    fontWeight: '800'
  },
  lookupPanel: {
    marginTop: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    backgroundColor: 'rgba(9,9,11,0.96)',
    padding: 12,
    maxHeight: 300
  },
  lookupSearchRow: {
    flexDirection: 'row',
    gap: 8
  },
  lookupInput: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#3f3f46',
    backgroundColor: '#27272a',
    color: '#fafafa',
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  lookupButton: {
    borderRadius: 12,
    backgroundColor: '#dc2626',
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center'
  },
  lookupButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800'
  },
  lookupList: {
    marginTop: 8,
    maxHeight: 150
  },
  lookupCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#3f3f46',
    backgroundColor: 'rgba(24,24,27,0.95)',
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginBottom: 6
  },
  lookupCardBody: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10
  },
  lookupCopy: {
    flex: 1,
    minWidth: 0
  },
  lookupName: {
    color: '#f4f4f5',
    fontSize: 13,
    fontWeight: '700'
  },
  lookupEmail: {
    color: '#a1a1aa',
    fontSize: 11,
    marginTop: 2
  },
  lookupSeat: {
    color: '#71717a',
    fontSize: 11,
    marginTop: 4
  },
  lookupCheckinButton: {
    borderRadius: 8,
    backgroundColor: '#dc2626',
    paddingHorizontal: 10,
    paddingVertical: 8,
    opacity: 0.95
  },
  lookupCheckinButtonText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800'
  },
  lookupEmptyState: {
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#52525b',
    paddingHorizontal: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center'
  },
  lookupEmptyStateText: {
    color: '#71717a',
    fontSize: 12
  },
  lookupHint: {
    marginTop: 8,
    color: '#71717a',
    fontSize: 11
  },
  cameraErrorInline: {
    marginTop: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.4)',
    backgroundColor: 'rgba(120,53,15,0.9)',
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  cameraErrorText: {
    color: '#fcd34d',
    fontSize: 12
  },
  permissionPanel: {
    marginHorizontal: 20,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    backgroundColor: 'rgba(9,9,11,0.95)',
    padding: 18
  },
  permissionLabel: {
    color: '#f4f4f5',
    fontSize: 24,
    fontWeight: '700'
  },
  permissionBody: {
    marginTop: 10,
    marginBottom: 16,
    color: '#d4d4d8',
    fontSize: 14
  },
  busyOverlay: {
    position: 'absolute',
    right: 18,
    bottom: 18,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 8,
    paddingVertical: 8
  }
});
