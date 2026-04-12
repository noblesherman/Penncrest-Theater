import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  backToLineMobilePaymentLineEntry,
  cancelMobilePaymentLineEntry,
  completeMobilePaymentLineEntry,
  createTerminalDispatchManualPaymentIntent,
  failMobilePaymentLineEntry,
  fetchMobilePaymentLineSnapshot,
  heartbeatMobilePaymentLine,
  registerTerminalDevice,
  sendTerminalDispatchTelemetry,
  sendTerminalHeartbeat,
  startMobilePaymentLine,
  type PaymentLineEntryState,
  type PaymentLineSession,
  type PaymentLineSnapshot
} from '../api/mobile';
import { useAuth } from '../auth/AuthContext';
import { PaymentModeBadge } from '../components/PaymentModeBadge';
import { TERMINAL_MOCK_MODE } from '../config';
import type { RootStackParamList } from '../navigation/types';
import { stripePaymentSheet } from '../payments/stripePaymentSheet';
import { useTerminal } from '../terminal/terminal';
import { TAP_TO_PAY_DEVICE_LABEL, TAP_TO_PAY_DISPLAY_NAME, TAP_TO_PAY_PERMISSION_HINT } from '../terminal/tapToPay';

type Props = NativeStackScreenProps<RootStackParamList, 'TerminalStation'>;

type DispatchPaymentChoice = 'tap' | 'manual';
type PaymentPath = 'tap' | 'manual' | 'unknown';

type DispatchChoiceEntry = {
  dispatchId: string;
};

const DEVICE_ID_KEY = 'theater.mobile.terminal.deviceId';
const TERMINAL_NAME_KEY = 'theater.mobile.terminal.name';
const DEFAULT_TERMINAL_NAME = 'Box Office Terminal';
const STRIPE_PAYMENT_SHEET_RETURN_URL = 'theatermobile://stripe-redirect';
const AUTO_TAP_TO_PAY_SECONDS = 5;
const AUTO_TAP_TO_PAY_DELAY_MS = AUTO_TAP_TO_PAY_SECONDS * 1000;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateDeviceId(): string {
  return `terminal_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function mapPaymentPathToTelemetry(path: PaymentPath): 'TAP_TO_PAY' | 'MANUAL' | 'UNKNOWN' {
  if (path === 'tap') return 'TAP_TO_PAY';
  if (path === 'manual') return 'MANUAL';
  return 'UNKNOWN';
}

function formatSellerLabel(entry: PaymentLineEntryState | null): string {
  if (!entry) return 'No active seller';
  if (entry.sellerStationName && entry.sellerStationName.trim()) return entry.sellerStationName.trim();
  if (entry.sellerClientSessionId && entry.sellerClientSessionId.trim()) {
    return `Seller ${entry.sellerClientSessionId.slice(0, 8)}`;
  }
  if (entry.sellerAdminId && entry.sellerAdminId.trim()) return `Seller ${entry.sellerAdminId.slice(0, 8)}`;
  return 'Seller';
}

export function TerminalStationScreen(_props: Props) {
  const { token } = useAuth();
  const terminal = useTerminal();
  const isTerminalMockMode = TERMINAL_MOCK_MODE;

  const [deviceId, setDeviceId] = useState<string>('');
  const [terminalName, setTerminalName] = useState<string>(DEFAULT_TERMINAL_NAME);
  const [savedTerminalName, setSavedTerminalName] = useState<string>(DEFAULT_TERMINAL_NAME);
  const [registering, setRegistering] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [startingPayment, setStartingPayment] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Waiting to register terminal station...');
  const [error, setError] = useState<string | null>(null);
  const [heartbeatError, setHeartbeatError] = useState<string | null>(null);
  const [lineSnapshot, setLineSnapshot] = useState<PaymentLineSnapshot | null>(null);
  const [lineSession, setLineSession] = useState<PaymentLineSession | null>(null);
  const [lastOrderId, setLastOrderId] = useState<string | null>(null);
  const [lastFailedDispatchId, setLastFailedDispatchId] = useState<string | null>(null);
  const [lastFailureReason, setLastFailureReason] = useState<string | null>(null);
  const [lastFailurePath, setLastFailurePath] = useState<PaymentPath>('unknown');
  const [operatorBusy, setOperatorBusy] = useState(false);
  const [dispatchChoiceDispatchId, setDispatchChoiceDispatchId] = useState<string | null>(null);
  const [dispatchChoiceSecondsRemaining, setDispatchChoiceSecondsRemaining] = useState<number>(0);
  const [clockNowMs, setClockNowMs] = useState(() => Date.now());

  const terminalInitPromiseRef = useRef<Promise<void> | null>(null);
  const terminalInitializedRef = useRef(false);
  const readerConnectedRef = useRef(false);
  const dispatchChoiceResolverRef = useRef<((choice: DispatchPaymentChoice) => void) | null>(null);
  const dispatchChoiceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dispatchChoiceIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const canceledDispatchIdRef = useRef<string | null>(null);
  const processingEntryIdRef = useRef<string | null>(null);
  const lineSessionRef = useRef<PaymentLineSession | null>(null);

  useEffect(() => {
    lineSessionRef.current = lineSession;
  }, [lineSession]);

  const canSaveName = useMemo(
    () => terminalName.trim().length > 0 && terminalName.trim() !== savedTerminalName && !registering,
    [registering, savedTerminalName, terminalName]
  );

  const activeLineEntry = useMemo(() => {
    if (!lineSnapshot) return null;

    if (lineSession?.activeEntryId) {
      const activeBySession = lineSnapshot.entries.find((entry) => entry.entryId === lineSession.activeEntryId);
      if (activeBySession) return activeBySession;
    }

    if (lineSnapshot.nowServingEntryId) {
      return lineSnapshot.entries.find((entry) => entry.entryId === lineSnapshot.nowServingEntryId) || null;
    }

    return lineSnapshot.entries.find((entry) => entry.uiState === 'ACTIVE_PAYMENT') || null;
  }, [lineSession?.activeEntryId, lineSnapshot]);

  const nextUpEntry = useMemo(() => {
    if (!lineSnapshot?.nextUpEntryId) return null;
    return lineSnapshot.entries.find((entry) => entry.entryId === lineSnapshot.nextUpEntryId) || null;
  }, [lineSnapshot]);

  const activeTimeoutAtIso = lineSession?.activeTimeoutAt || activeLineEntry?.activeTimeoutAt || null;
  const activeSecondsRemaining = useMemo(() => {
    if (!activeTimeoutAtIso) return null;
    const remainingMs = new Date(activeTimeoutAtIso).getTime() - clockNowMs;
    return Math.max(0, Math.ceil(remainingMs / 1000));
  }, [activeTimeoutAtIso, clockNowMs]);

  const activeSellerLabel = useMemo(() => formatSellerLabel(activeLineEntry), [activeLineEntry]);
  const nextSellerLabel = useMemo(() => formatSellerLabel(nextUpEntry), [nextUpEntry]);

  useEffect(() => {
    const id = setInterval(() => {
      setClockNowMs(Date.now());
    }, 1_000);

    return () => clearInterval(id);
  }, []);

  const clearDispatchChoicePrompt = useCallback(() => {
    if (dispatchChoiceTimeoutRef.current) {
      clearTimeout(dispatchChoiceTimeoutRef.current);
      dispatchChoiceTimeoutRef.current = null;
    }
    if (dispatchChoiceIntervalRef.current) {
      clearInterval(dispatchChoiceIntervalRef.current);
      dispatchChoiceIntervalRef.current = null;
    }
    setDispatchChoiceDispatchId(null);
    setDispatchChoiceSecondsRemaining(0);
  }, []);

  const settleDispatchChoice = useCallback(
    (choice: DispatchPaymentChoice) => {
      const resolver = dispatchChoiceResolverRef.current;
      dispatchChoiceResolverRef.current = null;
      clearDispatchChoicePrompt();
      if (resolver) {
        resolver(choice);
      }
    },
    [clearDispatchChoicePrompt]
  );

  const waitForDispatchChoice = useCallback(
    async (entry: DispatchChoiceEntry): Promise<DispatchPaymentChoice> =>
      new Promise((resolve) => {
        settleDispatchChoice('tap');

        dispatchChoiceResolverRef.current = resolve;
        setDispatchChoiceDispatchId(entry.dispatchId);
        setDispatchChoiceSecondsRemaining(AUTO_TAP_TO_PAY_SECONDS);

        dispatchChoiceIntervalRef.current = setInterval(() => {
          setDispatchChoiceSecondsRemaining((prev) => {
            if (prev <= 1) {
              return 1;
            }
            return prev - 1;
          });
        }, 1000);

        dispatchChoiceTimeoutRef.current = setTimeout(() => {
          settleDispatchChoice('tap');
        }, AUTO_TAP_TO_PAY_DELAY_MS);
      }),
    [settleDispatchChoice]
  );

  const reportTelemetry = useCallback(
    async (params: {
      dispatchId: string;
      paymentIntentId: string;
      stage: string;
      paymentMethod?: 'TAP_TO_PAY' | 'MANUAL' | 'UNKNOWN';
      failureReason?: string;
      metadata?: Record<string, unknown>;
    }) => {
      if (!token || !deviceId) {
        return;
      }

      await sendTerminalDispatchTelemetry(token, {
        dispatchId: params.dispatchId,
        deviceId,
        paymentIntentId: params.paymentIntentId,
        stage: params.stage,
        paymentMethod: params.paymentMethod,
        failureReason: params.failureReason,
        metadata: params.metadata
      }).catch(() => undefined);
    },
    [deviceId, token]
  );

  useEffect(() => {
    const loadDeviceSettings = async () => {
      const storedDeviceId = (await AsyncStorage.getItem(DEVICE_ID_KEY))?.trim();
      const storedName = (await AsyncStorage.getItem(TERMINAL_NAME_KEY))?.trim();

      const resolvedDeviceId = storedDeviceId || generateDeviceId();
      const resolvedName = storedName || DEFAULT_TERMINAL_NAME;

      if (!storedDeviceId) {
        await AsyncStorage.setItem(DEVICE_ID_KEY, resolvedDeviceId);
      }
      if (!storedName) {
        await AsyncStorage.setItem(TERMINAL_NAME_KEY, resolvedName);
      }

      setDeviceId(resolvedDeviceId);
      setTerminalName(resolvedName);
      setSavedTerminalName(resolvedName);
    };

    loadDeviceSettings().catch((err) => {
      setError(err instanceof Error ? err.message : 'Failed to load terminal settings');
    });
  }, []);

  useEffect(() => {
    readerConnectedRef.current = Boolean(terminal.connectedReader);
    if (terminal.getIsInitialized?.() || terminal.isInitialized) {
      terminalInitializedRef.current = true;
    }
  }, [terminal.connectedReader, terminal.getIsInitialized, terminal.isInitialized]);

  const refreshLineSnapshot = useCallback(async () => {
    if (!token || !deviceId) {
      return;
    }

    const snapshot = await fetchMobilePaymentLineSnapshot(token, deviceId);
    setLineSnapshot(snapshot);
  }, [deviceId, token]);

  const ensureTerminalInitialized = useCallback(async () => {
    if (terminalInitializedRef.current || terminal.getIsInitialized?.() || terminal.isInitialized) {
      terminalInitializedRef.current = true;
      return;
    }

    if (terminalInitPromiseRef.current) {
      await terminalInitPromiseRef.current;
      return;
    }

    terminalInitPromiseRef.current = (async () => {
      const initResult = await terminal.initialize();
      if (initResult.error) {
        throw new Error(initResult.error.message || 'Terminal initialization failed');
      }
      terminalInitializedRef.current = true;
    })();

    try {
      await terminalInitPromiseRef.current;
    } finally {
      terminalInitPromiseRef.current = null;
    }
  }, [terminal]);

  const ensurePlatformPermissions = useCallback(async () => {
    const result = await terminal.requestRequiredPermissions();
    if (result.error) {
      throw new Error(result.error.message || 'Required Tap to Pay permissions were denied');
    }
  }, [terminal]);

  const ensureConnectedReader = useCallback(async () => {
    if (!terminal.isAvailable) {
      throw new Error('Stripe Terminal is unavailable in this app build.');
    }

    await ensurePlatformPermissions();
    await ensureTerminalInitialized();

    if (terminal.connectedReader) {
      return;
    }

    if (terminal.getConnectedReader) {
      try {
        const reader = await terminal.getConnectedReader();
        if (reader) {
          readerConnectedRef.current = true;
          return;
        }
        readerConnectedRef.current = false;
      } catch {
      }
    }

    const locationsResult = await terminal.getLocations({ limit: 1 });
    if (locationsResult.error) {
      throw new Error(locationsResult.error.message || 'Unable to load Stripe locations');
    }

    const locationId = locationsResult.locations?.[0]?.id;
    if (!locationId) {
      throw new Error('No Stripe Terminal location available');
    }

    if (terminal.easyConnect) {
      const easyConnectResult = await terminal.easyConnect({
        discoveryMethod: 'tapToPay',
        simulated: false,
        locationId,
        autoReconnectOnUnexpectedDisconnect: true
      });
      if (easyConnectResult.error) {
        throw new Error(easyConnectResult.error.message || 'Unable to connect Tap to Pay');
      }
      readerConnectedRef.current = true;
      return;
    }

    const discoverResult = await terminal.discoverReaders({
      discoveryMethod: 'tapToPay',
      simulated: false
    });
    if (discoverResult.error) {
      throw new Error(discoverResult.error.message || 'Tap to Pay discovery failed');
    }

    const reader = terminal.discoveredReaders[0];
    if (!reader) {
      throw new Error('No Tap to Pay reader found');
    }

    const connectResult = await terminal.connectReader({
      discoveryMethod: 'tapToPay',
      reader,
      locationId,
      autoReconnectOnUnexpectedDisconnect: true
    });
    if (connectResult.error) {
      throw new Error(connectResult.error.message || 'Unable to connect Tap to Pay');
    }
    readerConnectedRef.current = true;
  }, [ensurePlatformPermissions, ensureTerminalInitialized, terminal]);

  const collectManualPaymentWithPaymentSheet = useCallback(
    async (entry: PaymentLineEntryState): Promise<string | null> => {
      if (!token || !deviceId) {
        throw new Error('Terminal context missing for manual payment');
      }
      if (!stripePaymentSheet.isAvailable) {
        throw new Error('Secure manual card entry is unavailable in this app build.');
      }

      const manualIntent = await createTerminalDispatchManualPaymentIntent(token, {
        dispatchId: entry.entryId,
        deviceId
      });

      await stripePaymentSheet.initStripe({
        publishableKey: manualIntent.publishableKey
      });

      const initResult = await stripePaymentSheet.initPaymentSheet({
        merchantDisplayName: 'Penncrest Theater',
        paymentIntentClientSecret: manualIntent.clientSecret,
        allowsDelayedPaymentMethods: false,
        returnURL: STRIPE_PAYMENT_SHEET_RETURN_URL
      });
      if (initResult.error) {
        throw new Error(initResult.error.message || 'Unable to initialize secure card entry');
      }

      const paymentSheetResult = await stripePaymentSheet.presentPaymentSheet();
      if (paymentSheetResult.error) {
        const code = String(paymentSheetResult.error.code || '').toLowerCase();
        if (code === 'canceled' || code === 'cancelled') {
          return null;
        }
        throw new Error(paymentSheetResult.error.message || 'Manual payment failed');
      }

      return manualIntent.paymentIntentId;
    },
    [deviceId, token]
  );

  const runMockTapToPayAnimation = useCallback(async () => {
    const steps = [
      `Tap to Pay demo: Hold card near ${TAP_TO_PAY_DEVICE_LABEL}...`,
      'Tap to Pay demo: Reading card...',
      'Tap to Pay demo: Verifying card...',
      'Tap to Pay demo: Authorizing...',
      'Tap to Pay demo: Approved.'
    ];
    for (const step of steps) {
      setStatusMessage(step);
      await wait(700);
    }
  }, []);

  const processPaymentEntry = useCallback(
    async (entry: PaymentLineEntryState) => {
      if (!token || !deviceId) {
        return;
      }

      let paymentPath: PaymentPath = 'unknown';
      let paymentIntentId = entry.paymentIntentId || '';

      const throwIfCanceled = () => {
        if (canceledDispatchIdRef.current === entry.entryId) {
          throw new Error('Dispatch canceled by operator');
        }
      };

      setProcessing(true);
      setError(null);
      setHeartbeatError(null);
      setLastFailedDispatchId(null);
      setLastFailureReason(null);
      setLastFailurePath('unknown');
      setStatusMessage(
        `Now serving ${formatSellerLabel(entry)} · ${entry.performanceTitle} (${entry.seatCount} seat${entry.seatCount === 1 ? '' : 's'})`
      );

      await reportTelemetry({
        dispatchId: entry.entryId,
        paymentIntentId: paymentIntentId || 'unknown',
        stage: 'dispatch_received',
        paymentMethod: 'UNKNOWN',
        metadata: { dispatchStatus: entry.status }
      });

      try {
        if (!entry.paymentIntentClientSecret) {
          throw new Error('Payment intent client secret is missing.');
        }
        if (!paymentIntentId) {
          throw new Error('Payment intent is missing.');
        }

        throwIfCanceled();

        setStatusMessage(
          `Choose payment method. Tap to Pay starts automatically in ${AUTO_TAP_TO_PAY_SECONDS} seconds if no selection is made.`
        );
        paymentPath = await waitForDispatchChoice({ dispatchId: entry.entryId });

        throwIfCanceled();

        if (paymentPath === 'manual') {
          if (!stripePaymentSheet.isAvailable) {
            throw new Error('Manual card entry is unavailable in this app build.');
          }

          await reportTelemetry({
            dispatchId: entry.entryId,
            paymentIntentId,
            stage: 'manual_payment_sheet_open',
            paymentMethod: 'MANUAL'
          });

          setStatusMessage('Opening secure manual card entry...');
          const manualPaymentIntentId = await collectManualPaymentWithPaymentSheet(entry);
          if (!manualPaymentIntentId) {
            throw new Error('Manual card entry canceled');
          }
          paymentIntentId = manualPaymentIntentId;

          throwIfCanceled();

          await reportTelemetry({
            dispatchId: entry.entryId,
            paymentIntentId,
            stage: 'manual_payment_confirmed',
            paymentMethod: 'MANUAL'
          });

          setStatusMessage('Finalizing manual payment...');
          const completion = await completeMobilePaymentLineEntry(token, {
            entryId: entry.entryId,
            deviceId,
            paymentIntentId
          });

          setLastOrderId(completion.orderId || null);
          setStatusMessage('Manual payment approved and order finalized.');
          setLineSession(null);
          await refreshLineSnapshot().catch(() => undefined);
          await reportTelemetry({
            dispatchId: entry.entryId,
            paymentIntentId,
            stage: 'dispatch_completed',
            paymentMethod: 'MANUAL'
          });
          return;
        }

        paymentPath = 'tap';
        await reportTelemetry({
          dispatchId: entry.entryId,
          paymentIntentId,
          stage: 'tap_to_pay_selected',
          paymentMethod: 'TAP_TO_PAY'
        });

        if (isTerminalMockMode) {
          await reportTelemetry({
            dispatchId: entry.entryId,
            paymentIntentId,
            stage: 'tap_to_pay_mock_mode',
            paymentMethod: 'TAP_TO_PAY'
          });
          await runMockTapToPayAnimation();
          const completion = await completeMobilePaymentLineEntry(token, {
            entryId: entry.entryId,
            deviceId,
            mockApproved: true
          });
          setLastOrderId(completion.orderId || null);
          setStatusMessage('Mock payment approved and order finalized.');
          setLineSession(null);
          await refreshLineSnapshot().catch(() => undefined);
          await reportTelemetry({
            dispatchId: entry.entryId,
            paymentIntentId,
            stage: 'dispatch_completed',
            paymentMethod: 'TAP_TO_PAY',
            metadata: { mockApproved: true }
          });
          return;
        }

        setStatusMessage('Connecting Tap to Pay...');
        await reportTelemetry({
          dispatchId: entry.entryId,
          paymentIntentId,
          stage: 'tap_to_pay_connecting',
          paymentMethod: 'TAP_TO_PAY'
        });

        await ensureConnectedReader();

        throwIfCanceled();

        setStatusMessage('Loading payment intent...');
        const retrieved = await terminal.retrievePaymentIntent(entry.paymentIntentClientSecret);
        if (retrieved.error || !retrieved.paymentIntent) {
          throw new Error(retrieved.error?.message || 'Unable to retrieve payment intent');
        }

        throwIfCanceled();

        setStatusMessage('Present card for payment...');
        await reportTelemetry({
          dispatchId: entry.entryId,
          paymentIntentId,
          stage: 'tap_to_pay_collecting',
          paymentMethod: 'TAP_TO_PAY'
        });
        const collected = await terminal.collectPaymentMethod({ paymentIntent: retrieved.paymentIntent });
        if (collected.error || !collected.paymentIntent) {
          throw new Error(collected.error?.message || 'Payment collection failed');
        }

        throwIfCanceled();

        setStatusMessage('Confirming payment...');
        await reportTelemetry({
          dispatchId: entry.entryId,
          paymentIntentId,
          stage: 'tap_to_pay_confirming',
          paymentMethod: 'TAP_TO_PAY'
        });
        const confirmed = await terminal.confirmPaymentIntent({ paymentIntent: collected.paymentIntent });
        if (confirmed.error) {
          throw new Error(confirmed.error.message || 'Payment confirmation failed');
        }

        throwIfCanceled();

        setStatusMessage('Finalizing order...');
        await reportTelemetry({
          dispatchId: entry.entryId,
          paymentIntentId,
          stage: 'dispatch_finalizing',
          paymentMethod: 'TAP_TO_PAY'
        });
        const completion = await completeMobilePaymentLineEntry(token, {
          entryId: entry.entryId,
          deviceId
        });

        setLastOrderId(completion.orderId || null);
        setStatusMessage('Payment approved and order finalized.');
        setLineSession(null);
        await refreshLineSnapshot().catch(() => undefined);
        await reportTelemetry({
          dispatchId: entry.entryId,
          paymentIntentId,
          stage: 'dispatch_completed',
          paymentMethod: 'TAP_TO_PAY'
        });
      } catch (err) {
        const rawMessage = err instanceof Error ? err.message : 'Terminal payment failed';
        const wasCanceled = canceledDispatchIdRef.current === entry.entryId || /canceled by operator/i.test(rawMessage);

        if (wasCanceled) {
          setError(null);
          setStatusMessage('Dispatch canceled by operator.');
          setLineSession(null);
          await refreshLineSnapshot().catch(() => undefined);
          await reportTelemetry({
            dispatchId: entry.entryId,
            paymentIntentId: paymentIntentId || 'unknown',
            stage: 'dispatch_canceled_by_operator',
            paymentMethod: mapPaymentPathToTelemetry(paymentPath),
            failureReason: rawMessage
          });
          return;
        }

        const failureMessageBase =
          paymentPath === 'manual'
            ? `Manual card entry failed: ${rawMessage}`
            : paymentPath === 'tap'
              ? `Tap to Pay failed: ${rawMessage}`
              : rawMessage;

        setError(failureMessageBase);
        setStatusMessage(failureMessageBase);
        setLastFailedDispatchId(entry.entryId);
        setLastFailureReason(failureMessageBase);
        setLastFailurePath(paymentPath);

        await reportTelemetry({
          dispatchId: entry.entryId,
          paymentIntentId: paymentIntentId || 'unknown',
          stage: 'dispatch_failed',
          paymentMethod: mapPaymentPathToTelemetry(paymentPath),
          failureReason: failureMessageBase
        });

        await failMobilePaymentLineEntry(token, {
          entryId: entry.entryId,
          deviceId,
          failureReason: failureMessageBase
        }).catch(() => undefined);

        setLineSession(null);
        await refreshLineSnapshot().catch(() => undefined);
      } finally {
        clearDispatchChoicePrompt();
        if (canceledDispatchIdRef.current === entry.entryId) {
          canceledDispatchIdRef.current = null;
        }
        setProcessing(false);
      }
    },
    [
      clearDispatchChoicePrompt,
      collectManualPaymentWithPaymentSheet,
      deviceId,
      ensureConnectedReader,
      isTerminalMockMode,
      refreshLineSnapshot,
      reportTelemetry,
      runMockTapToPayAnimation,
      terminal,
      token,
      waitForDispatchChoice
    ]
  );

  const processPaymentEntryRef = useRef(processPaymentEntry);

  useEffect(() => {
    processPaymentEntryRef.current = processPaymentEntry;
  }, [processPaymentEntry]);

  useEffect(
    () => () => {
      settleDispatchChoice('tap');
    },
    [settleDispatchChoice]
  );

  const registerAndPersist = useCallback(async () => {
    if (!token || !deviceId) {
      return;
    }

    const name = terminalName.trim();
    if (!name) {
      setError('Terminal name is required');
      return;
    }

    setRegistering(true);
    setError(null);
    try {
      await registerTerminalDevice(token, {
        deviceId,
        terminalName: name
      });
      await AsyncStorage.setItem(TERMINAL_NAME_KEY, name);
      setSavedTerminalName(name);
      setStatusMessage('Terminal station registered. Ready to load payment line.');
      await refreshLineSnapshot().catch(() => undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to register terminal station');
    } finally {
      setRegistering(false);
    }
  }, [deviceId, refreshLineSnapshot, terminalName, token]);

  const startNextPayment = useCallback(async () => {
    if (!token || !deviceId) {
      return;
    }

    setStartingPayment(true);
    setError(null);
    setHeartbeatError(null);

    try {
      const response = await startMobilePaymentLine(token, { deviceId });
      setLineSnapshot(response.snapshot);
      setLineSession(response.session);

      if (response.session) {
        setStatusMessage(`Started payment line session for ${formatSellerLabel(response.snapshot.entries.find((entry) => entry.entryId === response.session?.activeEntryId) || null)}.`);
      } else {
        setStatusMessage('No waiting payments in line.');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to start payment line';
      setError(message);
      setStatusMessage(message);
    } finally {
      setStartingPayment(false);
    }
  }, [deviceId, token]);

  const retryFailedEntryFromOperator = useCallback(async () => {
    if (!token || !deviceId || !lastFailedDispatchId) {
      return;
    }

    setOperatorBusy(true);
    setError(null);

    try {
      await backToLineMobilePaymentLineEntry(token, {
        entryId: lastFailedDispatchId,
        deviceId
      });
      setLastFailedDispatchId(null);
      setLastFailureReason(null);
      setLastFailurePath('unknown');
      setStatusMessage(`Entry ${lastFailedDispatchId} moved to the back of the line.`);
      await refreshLineSnapshot().catch(() => undefined);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to move entry to back of line';
      setError(message);
      setStatusMessage(message);
    } finally {
      setOperatorBusy(false);
    }
  }, [deviceId, lastFailedDispatchId, refreshLineSnapshot, token]);

  const cancelDispatchFromOperator = useCallback(async () => {
    if (!token || !deviceId) {
      return;
    }

    const dispatchId = activeLineEntry?.entryId || lastFailedDispatchId;
    if (!dispatchId) {
      return;
    }

    setOperatorBusy(true);
    setError(null);
    canceledDispatchIdRef.current = dispatchId;
    settleDispatchChoice('tap');

    try {
      await cancelMobilePaymentLineEntry(token, {
        entryId: dispatchId,
        deviceId
      });
      setLineSession(null);
      setLastFailedDispatchId(null);
      setLastFailureReason(null);
      setLastFailurePath('unknown');
      setStatusMessage(`Entry ${dispatchId} canceled.`);
      await refreshLineSnapshot().catch(() => undefined);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to cancel entry';
      setError(message);
      setStatusMessage(message);
      canceledDispatchIdRef.current = null;
    } finally {
      setOperatorBusy(false);
    }
  }, [activeLineEntry?.entryId, deviceId, lastFailedDispatchId, refreshLineSnapshot, settleDispatchChoice, token]);

  useEffect(() => {
    if (!token || !deviceId || !savedTerminalName) {
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        await registerTerminalDevice(token, {
          deviceId,
          terminalName: savedTerminalName
        });

        if (!cancelled) {
          setStatusMessage('Terminal station online. Ready for payment line.');
          await refreshLineSnapshot().catch(() => undefined);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Terminal station stopped');
          setStatusMessage('Terminal station offline. Tap Save Name to retry registration.');
        }
      }
    };

    void run();

    const heartbeatTimer = setInterval(() => {
      void sendTerminalHeartbeat(token, deviceId).catch(() => undefined);
    }, 15_000);

    return () => {
      cancelled = true;
      clearInterval(heartbeatTimer);
    };
  }, [deviceId, refreshLineSnapshot, savedTerminalName, token]);

  useFocusEffect(
    useCallback(() => {
      if (token && deviceId) {
        void refreshLineSnapshot().catch(() => undefined);
      }

      return () => undefined;
    }, [deviceId, refreshLineSnapshot, token])
  );

  useEffect(() => {
    if (!token || !deviceId || !lineSession?.sessionId) {
      return;
    }

    let cancelled = false;
    const intervalMs = Math.max(5, lineSession.heartbeatIntervalSeconds || 15) * 1000;

    const heartbeat = async () => {
      const currentSession = lineSessionRef.current;
      if (!currentSession) {
        return;
      }

      try {
        const response = await heartbeatMobilePaymentLine(token, {
          deviceId,
          session: {
            sessionId: currentSession.sessionId,
            queueKey: currentSession.queueKey,
            activeEntryId: currentSession.activeEntryId
          }
        });

        if (cancelled) {
          return;
        }

        setLineSnapshot(response.snapshot);
        setLineSession(response.session);
        setHeartbeatError(null);
      } catch (err) {
        if (cancelled) {
          return;
        }

        setHeartbeatError(err instanceof Error ? err.message : 'Payment line heartbeat failed');
      }
    };

    const timer = setInterval(() => {
      void heartbeat();
    }, intervalMs);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [deviceId, lineSession?.heartbeatIntervalSeconds, lineSession?.sessionId, token]);

  useEffect(() => {
    if (!lineSession || !activeLineEntry || activeLineEntry.uiState !== 'ACTIVE_PAYMENT') {
      return;
    }

    if (processing || processingEntryIdRef.current === activeLineEntry.entryId) {
      return;
    }

    processingEntryIdRef.current = activeLineEntry.entryId;

    void processPaymentEntryRef.current(activeLineEntry).finally(() => {
      if (processingEntryIdRef.current === activeLineEntry.entryId) {
        processingEntryIdRef.current = null;
      }
    });
  }, [activeLineEntry, lineSession, processing]);

  const isDispatchChoiceVisible = Boolean(
    activeLineEntry && dispatchChoiceDispatchId === activeLineEntry.entryId && activeLineEntry.uiState === 'ACTIVE_PAYMENT'
  );
  const isManualPaymentAvailable = stripePaymentSheet.isAvailable;

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.brandTag}>Penncrest Theater</Text>
          <Text style={styles.title}>Terminal{`\n`}<Text style={styles.titleAccent}>Station</Text></Text>
          <Text style={styles.subtitle}>This device runs payment-line sessions and defaults to {TAP_TO_PAY_DISPLAY_NAME} after 5 seconds.</Text>
          <PaymentModeBadge />
          <View style={styles.divider} />
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {heartbeatError ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>Heartbeat: {heartbeatError}</Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.label}>Device</Text>
          <Text style={styles.valueMono}>{deviceId || 'Loading...'}</Text>

          <Text style={[styles.label, { marginTop: 14 }]}>Terminal Name</Text>
          <TextInput
            style={styles.input}
            value={terminalName}
            onChangeText={setTerminalName}
            placeholder="Front Desk Terminal"
            placeholderTextColor="rgba(245,240,232,0.25)"
          />

          <Pressable
            style={[styles.button, (!canSaveName || registering) && styles.buttonDisabled]}
            disabled={!canSaveName || registering}
            onPress={registerAndPersist}
          >
            {registering ? <ActivityIndicator size="small" color="#f5d98b" /> : <Text style={styles.buttonLabel}>Save Name</Text>}
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Payment Line</Text>
          <View style={styles.metricGrid}>
            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>Active Seller</Text>
              <Text style={styles.metricValue}>{activeSellerLabel}</Text>
            </View>
            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>Amount</Text>
              <Text style={styles.metricValue}>${((activeLineEntry?.expectedAmountCents || 0) / 100).toFixed(2)}</Text>
            </View>
            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>Remaining</Text>
              <Text style={styles.metricValue}>{activeSecondsRemaining == null ? '—' : `${activeSecondsRemaining}s`}</Text>
            </View>
            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>Waiting</Text>
              <Text style={styles.metricValue}>{lineSnapshot?.waitingCount ?? 0}</Text>
            </View>
            <View style={styles.metricItemWide}>
              <Text style={styles.metricLabel}>Next Up Seller</Text>
              <Text style={styles.metricValue}>{nextSellerLabel}</Text>
            </View>
          </View>
          <Pressable
            style={[styles.button, (startingPayment || processing) && styles.buttonDisabled]}
            disabled={startingPayment || processing}
            onPress={() => void startNextPayment()}
          >
            {startingPayment ? (
              <ActivityIndicator size="small" color="#f5d98b" />
            ) : (
              <Text style={styles.buttonLabel}>{lineSession ? 'Refresh Active Session' : 'Start Next Payment'}</Text>
            )}
          </Pressable>
          {lineSession ? (
            <Text style={styles.recoveryText}>Heartbeat every {lineSession.heartbeatIntervalSeconds}s · Session {lineSession.sessionId.slice(0, 10)}</Text>
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Status</Text>
          <Text style={styles.value}>{statusMessage}</Text>
          {TAP_TO_PAY_PERMISSION_HINT ? <Text style={styles.recoveryText}>{TAP_TO_PAY_PERMISSION_HINT}</Text> : null}
          {processing ? <ActivityIndicator size="small" color="#c9a84c" style={{ marginTop: 10 }} /> : null}
          {activeLineEntry ? (
            <View style={styles.dispatchBox}>
              <Text style={styles.dispatchTitle}>{activeLineEntry.performanceTitle}</Text>
              <Text style={styles.dispatchMeta}>
                ${(activeLineEntry.expectedAmountCents / 100).toFixed(2)} · {activeLineEntry.seats.length} seat
                {activeLineEntry.seats.length === 1 ? '' : 's'}
              </Text>
              <Text style={styles.dispatchMeta}>{activeLineEntry.seats.map((seat) => seat.label).join(', ')}</Text>
              <Text style={styles.dispatchMeta}>Entry ID: {activeLineEntry.entryId}</Text>
              <Text style={styles.dispatchMeta}>Payment Intent: {activeLineEntry.paymentIntentId || 'Unavailable'}</Text>
              <Text style={styles.dispatchMeta}>Queue Position: {activeLineEntry.position || '—'}</Text>
            </View>
          ) : null}
          {lastOrderId ? <Text style={styles.successText}>Last completed order: {lastOrderId}</Text> : null}
        </View>

        {(activeLineEntry || lastFailedDispatchId) ? (
          <View style={styles.card}>
            <Text style={styles.label}>Operator Controls</Text>
            {lastFailedDispatchId ? (
              <View style={styles.failureBox}>
                <Text style={styles.failureTitle}>Last failure ({lastFailurePath === 'manual' ? 'Manual Card Entry' : lastFailurePath === 'tap' ? 'Tap to Pay' : 'Unknown'})</Text>
                <Text style={styles.failureText}>{lastFailureReason || 'Terminal payment failed.'}</Text>
                <Text style={styles.failureText}>Entry ID: {lastFailedDispatchId}</Text>
              </View>
            ) : null}
            <View style={styles.actionRow}>
              <Pressable
                style={[
                  styles.actionButton,
                  styles.secondaryActionButton,
                  (operatorBusy || (!activeLineEntry && !lastFailedDispatchId)) && styles.actionButtonDisabled
                ]}
                onPress={() => void cancelDispatchFromOperator()}
                disabled={operatorBusy || (!activeLineEntry && !lastFailedDispatchId)}
              >
                <Text style={styles.secondaryActionLabel}>{operatorBusy ? 'Working...' : 'Cancel Entry'}</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.actionButton,
                  styles.primaryActionButton,
                  (operatorBusy || !lastFailedDispatchId) && styles.actionButtonDisabled
                ]}
                onPress={() => void retryFailedEntryFromOperator()}
                disabled={operatorBusy || !lastFailedDispatchId}
              >
                <Text style={styles.primaryActionLabel}>{operatorBusy ? 'Working...' : 'Back To Line'}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {isDispatchChoiceVisible ? (
          <View style={styles.card}>
            <Text style={styles.label}>Payment Method</Text>
            <Text style={styles.value}>Tap to Pay will auto-start in {dispatchChoiceSecondsRemaining}s.</Text>
            {!isManualPaymentAvailable ? (
              <Text style={styles.availabilityHint}>Manual payment is unavailable in this build. Tap to Pay will be used.</Text>
            ) : null}
            <View style={styles.actionRow}>
              <Pressable
                style={[styles.actionButton, styles.secondaryActionButton, !isManualPaymentAvailable && styles.actionButtonDisabled]}
                onPress={() => settleDispatchChoice('manual')}
                disabled={!isManualPaymentAvailable}
              >
                <Text style={styles.secondaryActionLabel}>{isManualPaymentAvailable ? 'Manual Payment' : 'Manual Unavailable'}</Text>
              </Pressable>
              <Pressable style={[styles.actionButton, styles.primaryActionButton]} onPress={() => settleDispatchChoice('tap')}>
                <Text style={styles.primaryActionLabel}>Tap to Pay</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#1a0505'
  },
  scroll: {
    flex: 1
  },
  scrollContent: {
    paddingHorizontal: 28,
    paddingTop: 36,
    paddingBottom: 32
  },
  header: {
    marginBottom: 8
  },
  brandTag: {
    fontSize: 10,
    letterSpacing: 2.5,
    textTransform: 'uppercase',
    color: '#c9a84c',
    fontFamily: 'Georgia',
    marginBottom: 10
  },
  title: {
    fontSize: 42,
    fontWeight: '700',
    color: '#f5f0e8',
    fontFamily: 'Georgia',
    lineHeight: 46,
    marginBottom: 8
  },
  titleAccent: {
    color: '#c9a84c',
    fontStyle: 'italic'
  },
  subtitle: {
    fontSize: 13,
    color: 'rgba(245,240,232,0.4)',
    fontFamily: 'Georgia',
    marginBottom: 24
  },
  divider: {
    width: 32,
    height: 2,
    backgroundColor: '#c9a84c',
    opacity: 0.7,
    marginBottom: 24
  },
  errorBox: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(220,38,38,0.5)',
    backgroundColor: 'rgba(153,27,27,0.2)',
    padding: 12,
    marginBottom: 12
  },
  errorText: {
    color: '#fecaca',
    fontFamily: 'Georgia'
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(201,168,76,0.25)',
    padding: 14,
    marginBottom: 14
  },
  label: {
    fontSize: 9,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: '#c9a84c',
    fontFamily: 'Arial',
    opacity: 0.85,
    marginBottom: 8
  },
  value: {
    fontFamily: 'Georgia',
    color: '#f5f0e8',
    fontSize: 14,
    lineHeight: 20
  },
  recoveryText: {
    marginTop: 8,
    color: '#f5d98b',
    fontFamily: 'Georgia',
    fontSize: 12,
    lineHeight: 18
  },
  valueMono: {
    fontFamily: 'Courier',
    color: '#f5f0e8',
    fontSize: 12
  },
  input: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(201,168,76,0.2)',
    backgroundColor: 'rgba(245,240,232,0.04)',
    color: '#f5f0e8',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: 'Georgia'
  },
  button: {
    marginTop: 12,
    borderRadius: 999,
    backgroundColor: '#8b1a1a',
    borderWidth: 1,
    borderColor: '#c9a84c',
    paddingVertical: 11,
    alignItems: 'center'
  },
  buttonDisabled: {
    opacity: 0.55
  },
  buttonLabel: {
    color: '#f5f0e8',
    fontFamily: 'Georgia',
    fontWeight: '700',
    fontSize: 15
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  metricItem: {
    width: '48%',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(201,168,76,0.2)',
    backgroundColor: 'rgba(245,240,232,0.05)',
    padding: 9
  },
  metricItemWide: {
    width: '100%',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(201,168,76,0.2)',
    backgroundColor: 'rgba(245,240,232,0.05)',
    padding: 9
  },
  metricLabel: {
    color: 'rgba(245,240,232,0.6)',
    fontFamily: 'Arial',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 1.1,
    marginBottom: 4
  },
  metricValue: {
    color: '#f5f0e8',
    fontFamily: 'Georgia',
    fontSize: 13,
    fontWeight: '700'
  },
  dispatchBox: {
    marginTop: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(201,168,76,0.3)',
    backgroundColor: 'rgba(245,240,232,0.06)',
    padding: 10,
    gap: 4
  },
  dispatchTitle: {
    color: '#f5f0e8',
    fontFamily: 'Georgia',
    fontSize: 14,
    fontWeight: '700'
  },
  dispatchMeta: {
    color: 'rgba(245,240,232,0.75)',
    fontFamily: 'Georgia',
    fontSize: 12
  },
  successText: {
    marginTop: 10,
    color: '#86efac',
    fontFamily: 'Georgia',
    fontSize: 12
  },
  failureBox: {
    marginTop: 4,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(254,202,202,0.45)',
    backgroundColor: 'rgba(153,27,27,0.22)',
    padding: 10,
    marginBottom: 8
  },
  failureTitle: {
    color: '#fecaca',
    fontFamily: 'Georgia',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 4
  },
  failureText: {
    color: 'rgba(254,226,226,0.92)',
    fontFamily: 'Georgia',
    fontSize: 12,
    lineHeight: 18
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12
  },
  actionButton: {
    flex: 1,
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center'
  },
  primaryActionButton: {
    borderColor: '#c9a84c',
    backgroundColor: '#8b1a1a'
  },
  secondaryActionButton: {
    borderColor: 'rgba(201,168,76,0.4)',
    backgroundColor: 'rgba(245,240,232,0.07)'
  },
  primaryActionLabel: {
    color: '#f5f0e8',
    fontFamily: 'Georgia',
    fontWeight: '700'
  },
  secondaryActionLabel: {
    color: '#f5f0e8',
    fontFamily: 'Georgia',
    fontWeight: '600'
  },
  actionButtonDisabled: {
    opacity: 0.45
  },
  availabilityHint: {
    marginTop: 6,
    color: 'rgba(254,202,202,0.9)',
    fontFamily: 'Georgia',
    fontSize: 12
  }
});
