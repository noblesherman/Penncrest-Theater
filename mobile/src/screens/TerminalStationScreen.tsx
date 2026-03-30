import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  cancelTerminalDispatch,
  completeTerminalDispatch,
  createTerminalDispatchManualPaymentIntent,
  fetchTerminalDispatchAdminState,
  fetchNextTerminalDispatch,
  registerTerminalDevice,
  sendTerminalHeartbeat,
  sendTerminalDispatchTelemetry,
  retryTerminalDispatch,
  updateTerminalDispatchStatus,
  type TerminalIncomingDispatch
} from '../api/mobile';
import { useAuth } from '../auth/AuthContext';
import { PaymentModeBadge } from '../components/PaymentModeBadge';
import { TERMINAL_MOCK_MODE } from '../config';
import type { RootStackParamList } from '../navigation/types';
import {
  clearTerminalDispatchRecovery,
  loadTerminalDispatchRecovery,
  saveTerminalDispatchRecovery
} from '../payments/paymentRecovery';
import { stripePaymentSheet } from '../payments/stripePaymentSheet';
import { useTerminal } from '../terminal/terminal';

type Props = NativeStackScreenProps<RootStackParamList, 'TerminalStation'>;

type DispatchPaymentChoice = 'tap' | 'manual';
type PaymentPath = 'tap' | 'manual' | 'unknown';

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

export function TerminalStationScreen(_props: Props) {
  const { token } = useAuth();
  const terminal = useTerminal();
  const isTerminalMockMode = TERMINAL_MOCK_MODE;

  const [deviceId, setDeviceId] = useState<string>('');
  const [terminalName, setTerminalName] = useState<string>(DEFAULT_TERMINAL_NAME);
  const [savedTerminalName, setSavedTerminalName] = useState<string>(DEFAULT_TERMINAL_NAME);
  const [registering, setRegistering] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Waiting to register terminal station...');
  const [error, setError] = useState<string | null>(null);
  const [activeDispatch, setActiveDispatch] = useState<TerminalIncomingDispatch | null>(null);
  const [lastOrderId, setLastOrderId] = useState<string | null>(null);
  const [lastFailedDispatchId, setLastFailedDispatchId] = useState<string | null>(null);
  const [lastFailureReason, setLastFailureReason] = useState<string | null>(null);
  const [lastFailurePath, setLastFailurePath] = useState<PaymentPath>('unknown');
  const [lastFailureCanRetry, setLastFailureCanRetry] = useState(false);
  const [operatorBusy, setOperatorBusy] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);
  const [dispatchChoiceDispatchId, setDispatchChoiceDispatchId] = useState<string | null>(null);
  const [dispatchChoiceSecondsRemaining, setDispatchChoiceSecondsRemaining] = useState<number>(0);

  const terminalInitPromiseRef = useRef<Promise<void> | null>(null);
  const terminalInitializedRef = useRef(false);
  const readerConnectedRef = useRef(false);
  const dispatchChoiceResolverRef = useRef<((choice: DispatchPaymentChoice) => void) | null>(null);
  const dispatchChoiceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dispatchChoiceIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const canceledDispatchIdRef = useRef<string | null>(null);

  const canSaveName = useMemo(
    () => terminalName.trim().length > 0 && terminalName.trim() !== savedTerminalName && !registering,
    [registering, savedTerminalName, terminalName]
  );
  const isDispatchChoiceVisible = Boolean(activeDispatch && dispatchChoiceDispatchId === activeDispatch.dispatchId);
  const isManualPaymentAvailable = stripePaymentSheet.isAvailable;

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
    async (dispatch: TerminalIncomingDispatch): Promise<DispatchPaymentChoice> =>
      new Promise((resolve) => {
        settleDispatchChoice('tap');

        dispatchChoiceResolverRef.current = resolve;
        setDispatchChoiceDispatchId(dispatch.dispatchId);
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

  const persistRecoveryState = useCallback(
    async (params: {
      dispatchId: string;
      paymentIntentId: string;
      stage: string;
      paymentMethod: PaymentPath;
    }) => {
      if (!deviceId) {
        return;
      }

      await saveTerminalDispatchRecovery({
        dispatchId: params.dispatchId,
        paymentIntentId: params.paymentIntentId,
        deviceId,
        stage: params.stage,
        paymentMethod: params.paymentMethod,
        updatedAt: new Date().toISOString()
      }).catch(() => undefined);
    },
    [deviceId]
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

  useEffect(() => {
    if (!token || !deviceId) {
      return;
    }

    let cancelled = false;

    const loadRecovery = async () => {
      const recovery = await loadTerminalDispatchRecovery();
      if (!recovery || recovery.deviceId !== deviceId) {
        if (recovery && recovery.deviceId !== deviceId) {
          await clearTerminalDispatchRecovery().catch(() => undefined);
        }
        return;
      }

      const dispatchState = await fetchTerminalDispatchAdminState(token, recovery.dispatchId).catch(() => null);
      if (!dispatchState || cancelled) {
        return;
      }

      if (dispatchState.status === 'SUCCEEDED' || dispatchState.status === 'CANCELED' || dispatchState.status === 'EXPIRED') {
        await clearTerminalDispatchRecovery().catch(() => undefined);
        if (dispatchState.status === 'SUCCEEDED') {
          setLastOrderId(dispatchState.finalOrderId || null);
        }
        return;
      }

      if (dispatchState.status === 'FAILED') {
        setLastFailedDispatchId(dispatchState.dispatchId);
        setLastFailureReason(dispatchState.failureReason || 'Terminal dispatch failed');
        setLastFailurePath(recovery.paymentMethod);
        setLastFailureCanRetry(dispatchState.canRetry);
        setRecoveryMessage(`Recovered failed dispatch ${dispatchState.dispatchId}. Review and retry or cancel.`);
        return;
      }

      setRecoveryMessage(
        `Recovered in-progress dispatch ${dispatchState.dispatchId}. Waiting for terminal polling to resume payment.`
      );
    };

    loadRecovery().catch(() => undefined);

    return () => {
      cancelled = true;
    };
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

  const ensureConnectedReader = useCallback(async () => {
    if (!terminal.isAvailable) {
      throw new Error('Stripe Terminal is unavailable in this app build.');
    }

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
        // Ignore and continue with explicit discovery/connection.
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
  }, [ensureTerminalInitialized, terminal]);

  const collectManualPaymentWithPaymentSheet = useCallback(
    async (dispatch: TerminalIncomingDispatch): Promise<string | null> => {
      if (!token || !deviceId) {
        throw new Error('Terminal context missing for manual payment');
      }
      if (!stripePaymentSheet.isAvailable) {
        throw new Error('Secure manual card entry is unavailable in this app build.');
      }

      const manualIntent = await createTerminalDispatchManualPaymentIntent(token, {
        dispatchId: dispatch.dispatchId,
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
      'Tap to Pay demo: Hold card near the top of this iPhone...',
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

  const processDispatch = useCallback(
    async (dispatch: TerminalIncomingDispatch) => {
      if (!token || !deviceId) {
        return;
      }

      let paymentPath: PaymentPath = 'unknown';
      let paymentIntentId = dispatch.paymentIntentId;

      const throwIfCanceled = () => {
        if (canceledDispatchIdRef.current === dispatch.dispatchId) {
          throw new Error('Dispatch canceled by operator');
        }
      };

      const updateRetryState = async () => {
        const state = await fetchTerminalDispatchAdminState(token, dispatch.dispatchId).catch(() => null);
        if (state) {
          setLastFailureCanRetry(state.canRetry);
        }
      };

      setProcessing(true);
      setError(null);
      setRecoveryMessage(null);
      setLastFailedDispatchId(null);
      setLastFailureReason(null);
      setLastFailurePath('unknown');
      setLastFailureCanRetry(false);
      setActiveDispatch(dispatch);
      setStatusMessage(
        `Dispatch received: ${dispatch.performanceTitle} (${dispatch.seats.length} seat${dispatch.seats.length === 1 ? '' : 's'})`
      );

      await persistRecoveryState({
        dispatchId: dispatch.dispatchId,
        paymentIntentId,
        stage: 'dispatch_received',
        paymentMethod: 'unknown'
      });
      await reportTelemetry({
        dispatchId: dispatch.dispatchId,
        paymentIntentId,
        stage: 'dispatch_received',
        paymentMethod: 'UNKNOWN',
        metadata: { dispatchStatus: dispatch.status }
      });

      try {
        const finalizeMockDispatch = async (successMessage: string, stage: string) => {
          await reportTelemetry({
            dispatchId: dispatch.dispatchId,
            paymentIntentId,
            stage,
            paymentMethod: mapPaymentPathToTelemetry(paymentPath)
          });
          await runMockTapToPayAnimation();
          const completion = await completeTerminalDispatch(token, {
            dispatchId: dispatch.dispatchId,
            deviceId,
            mockApproved: true
          });
          setLastOrderId(completion.orderId || null);
          setStatusMessage(successMessage);
          setActiveDispatch(null);
          await clearTerminalDispatchRecovery().catch(() => undefined);
          await reportTelemetry({
            dispatchId: dispatch.dispatchId,
            paymentIntentId,
            stage: 'dispatch_completed',
            paymentMethod: mapPaymentPathToTelemetry(paymentPath),
            metadata: { mockApproved: true }
          });
        };

        throwIfCanceled();
        await updateTerminalDispatchStatus(token, {
          dispatchId: dispatch.dispatchId,
          deviceId,
          status: 'PROCESSING'
        });
        await reportTelemetry({
          dispatchId: dispatch.dispatchId,
          paymentIntentId,
          stage: 'dispatch_marked_processing',
          paymentMethod: 'UNKNOWN'
        });

        const recovery = await loadTerminalDispatchRecovery().catch(() => null);
        if (dispatch.status === 'PROCESSING' && recovery?.dispatchId === dispatch.dispatchId) {
          paymentPath = recovery.paymentMethod;
          setStatusMessage(
            `Resuming dispatch ${dispatch.dispatchId} at stage "${recovery.stage}". Attempting ${
              paymentPath === 'manual' ? 'manual card entry' : 'Tap to Pay'
            }.`
          );
        } else {
          setStatusMessage(
            `Choose payment method. Tap to Pay starts automatically in ${AUTO_TAP_TO_PAY_SECONDS} seconds if no selection is made.`
          );
          paymentPath = await waitForDispatchChoice(dispatch);
        }

        throwIfCanceled();

        if (paymentPath === 'manual') {
          if (!isManualPaymentAvailable) {
            throw new Error('Manual card entry is unavailable in this app build.');
          }

          await persistRecoveryState({
            dispatchId: dispatch.dispatchId,
            paymentIntentId,
            stage: 'manual_payment_sheet_open',
            paymentMethod: 'manual'
          });
          await reportTelemetry({
            dispatchId: dispatch.dispatchId,
            paymentIntentId,
            stage: 'manual_payment_sheet_open',
            paymentMethod: 'MANUAL'
          });

          setStatusMessage('Opening secure manual card entry...');
          const manualPaymentIntentId = await collectManualPaymentWithPaymentSheet(dispatch);
          if (!manualPaymentIntentId) {
            throw new Error('Manual card entry canceled');
          }
          paymentIntentId = manualPaymentIntentId;

          throwIfCanceled();

          await persistRecoveryState({
            dispatchId: dispatch.dispatchId,
            paymentIntentId,
            stage: 'manual_payment_confirmed',
            paymentMethod: 'manual'
          });
          await reportTelemetry({
            dispatchId: dispatch.dispatchId,
            paymentIntentId,
            stage: 'manual_payment_confirmed',
            paymentMethod: 'MANUAL'
          });

          setStatusMessage('Finalizing manual payment...');
          const completion = await completeTerminalDispatch(token, {
            dispatchId: dispatch.dispatchId,
            deviceId,
            paymentIntentId
          });

          setLastOrderId(completion.orderId || null);
          setStatusMessage('Manual payment approved and order finalized.');
          setActiveDispatch(null);
          await clearTerminalDispatchRecovery().catch(() => undefined);
          await reportTelemetry({
            dispatchId: dispatch.dispatchId,
            paymentIntentId,
            stage: 'dispatch_completed',
            paymentMethod: 'MANUAL'
          });
          return;
        }

        paymentPath = 'tap';
        await persistRecoveryState({
          dispatchId: dispatch.dispatchId,
          paymentIntentId,
          stage: 'tap_to_pay_selected',
          paymentMethod: 'tap'
        });
        await reportTelemetry({
          dispatchId: dispatch.dispatchId,
          paymentIntentId,
          stage: 'tap_to_pay_selected',
          paymentMethod: 'TAP_TO_PAY'
        });

        if (isTerminalMockMode) {
          await finalizeMockDispatch('Mock payment approved and order finalized.', 'tap_to_pay_mock_mode');
          return;
        }

        setStatusMessage('Connecting Tap to Pay...');
        await reportTelemetry({
          dispatchId: dispatch.dispatchId,
          paymentIntentId,
          stage: 'tap_to_pay_connecting',
          paymentMethod: 'TAP_TO_PAY'
        });

        await ensureConnectedReader();

        throwIfCanceled();

        setStatusMessage('Loading payment intent...');
        await persistRecoveryState({
          dispatchId: dispatch.dispatchId,
          paymentIntentId,
          stage: 'tap_to_pay_retrieve_intent',
          paymentMethod: 'tap'
        });
        const retrieved = await terminal.retrievePaymentIntent(dispatch.paymentIntentClientSecret);
        if (retrieved.error || !retrieved.paymentIntent) {
          throw new Error(retrieved.error?.message || 'Unable to retrieve payment intent');
        }

        throwIfCanceled();

        setStatusMessage('Present card for payment...');
        await reportTelemetry({
          dispatchId: dispatch.dispatchId,
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
          dispatchId: dispatch.dispatchId,
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
          dispatchId: dispatch.dispatchId,
          paymentIntentId,
          stage: 'dispatch_finalizing',
          paymentMethod: 'TAP_TO_PAY'
        });
        const completion = await completeTerminalDispatch(token, {
          dispatchId: dispatch.dispatchId,
          deviceId
        });

        setLastOrderId(completion.orderId || null);
        setStatusMessage('Payment approved and order finalized.');
        setActiveDispatch(null);
        await clearTerminalDispatchRecovery().catch(() => undefined);
        await reportTelemetry({
          dispatchId: dispatch.dispatchId,
          paymentIntentId,
          stage: 'dispatch_completed',
          paymentMethod: 'TAP_TO_PAY'
        });
      } catch (err) {
        const rawMessage = err instanceof Error ? err.message : 'Terminal dispatch failed';
        const wasCanceled = canceledDispatchIdRef.current === dispatch.dispatchId || /canceled by operator/i.test(rawMessage);

        if (wasCanceled) {
          setError(null);
          setStatusMessage('Dispatch canceled by operator.');
          setActiveDispatch(null);
          await clearTerminalDispatchRecovery().catch(() => undefined);
          await reportTelemetry({
            dispatchId: dispatch.dispatchId,
            paymentIntentId,
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
        setLastFailedDispatchId(dispatch.dispatchId);
        setLastFailureReason(failureMessageBase);
        setLastFailurePath(paymentPath);

        await persistRecoveryState({
          dispatchId: dispatch.dispatchId,
          paymentIntentId,
          stage: 'dispatch_failed',
          paymentMethod: paymentPath
        });
        await reportTelemetry({
          dispatchId: dispatch.dispatchId,
          paymentIntentId,
          stage: 'dispatch_failed',
          paymentMethod: mapPaymentPathToTelemetry(paymentPath),
          failureReason: failureMessageBase
        });

        await updateTerminalDispatchStatus(token, {
          dispatchId: dispatch.dispatchId,
          deviceId,
          status: 'FAILED',
          failureReason: failureMessageBase
        }).catch(() => undefined);
        await updateRetryState();
      } finally {
        clearDispatchChoicePrompt();
        if (canceledDispatchIdRef.current === dispatch.dispatchId) {
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
      isManualPaymentAvailable,
      isTerminalMockMode,
      persistRecoveryState,
      reportTelemetry,
      runMockTapToPayAnimation,
      terminal,
      token,
      waitForDispatchChoice
    ]
  );
  const processDispatchRef = useRef(processDispatch);

  useEffect(() => {
    processDispatchRef.current = processDispatch;
  }, [processDispatch]);

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
      setStatusMessage('Terminal station registered. Waiting for dispatches...');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to register terminal station');
    } finally {
      setRegistering(false);
    }
  }, [deviceId, terminalName, token]);

  const retryDispatchFromOperator = useCallback(async () => {
    if (!token) {
      return;
    }

    const dispatchId = activeDispatch?.dispatchId || lastFailedDispatchId;
    if (!dispatchId) {
      return;
    }

    setOperatorBusy(true);
    setError(null);
    setRecoveryMessage(null);
    try {
      const retried = await retryTerminalDispatch(token, dispatchId);
      setLastFailedDispatchId(null);
      setLastFailureReason(null);
      setLastFailurePath('unknown');
      setLastFailureCanRetry(false);
      setStatusMessage(`Dispatch ${retried.dispatchId} queued for retry. Waiting for terminal pickup...`);
      await reportTelemetry({
        dispatchId: retried.dispatchId,
        paymentIntentId: activeDispatch?.paymentIntentId || 'retry_pending',
        stage: 'operator_retry_requested',
        paymentMethod: 'UNKNOWN'
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to retry dispatch';
      setError(message);
      setStatusMessage(message);
    } finally {
      setOperatorBusy(false);
    }
  }, [activeDispatch?.dispatchId, activeDispatch?.paymentIntentId, lastFailedDispatchId, reportTelemetry, token]);

  const cancelDispatchFromOperator = useCallback(async () => {
    if (!token) {
      return;
    }

    const dispatchId = activeDispatch?.dispatchId || lastFailedDispatchId;
    if (!dispatchId) {
      return;
    }

    setOperatorBusy(true);
    setError(null);
    setRecoveryMessage(null);
    canceledDispatchIdRef.current = dispatchId;
    settleDispatchChoice('tap');

    try {
      await cancelTerminalDispatch(token, dispatchId);
      await clearTerminalDispatchRecovery().catch(() => undefined);
      setActiveDispatch((current) => (current?.dispatchId === dispatchId ? null : current));
      setLastFailedDispatchId(null);
      setLastFailureReason(null);
      setLastFailurePath('unknown');
      setLastFailureCanRetry(false);
      setStatusMessage(`Dispatch ${dispatchId} canceled.`);
      await reportTelemetry({
        dispatchId,
        paymentIntentId: activeDispatch?.paymentIntentId || 'operator_cancel',
        stage: 'operator_cancel_requested',
        paymentMethod: 'UNKNOWN'
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to cancel dispatch';
      setError(message);
      setStatusMessage(message);
      canceledDispatchIdRef.current = null;
    } finally {
      setOperatorBusy(false);
    }
  }, [activeDispatch?.dispatchId, activeDispatch?.paymentIntentId, lastFailedDispatchId, reportTelemetry, settleDispatchChoice, token]);

  useEffect(() => {
    if (!token || !deviceId || !savedTerminalName) {
      return;
    }

    let cancelled = false;

    const run = async () => {
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
      try {
        await registerTerminalDevice(token, {
          deviceId,
          terminalName: savedTerminalName
        });

        setStatusMessage('Terminal station online. Waiting for dispatches...');

        heartbeatTimer = setInterval(() => {
          void sendTerminalHeartbeat(token, deviceId).catch(() => undefined);
        }, 15_000);

        while (!cancelled) {
          try {
            const dispatch = await fetchNextTerminalDispatch(token, {
              deviceId,
              waitMs: 25_000
            });

            if (!dispatch) {
              continue;
            }

            await processDispatchRef.current(dispatch);
          } catch (err) {
            if (cancelled) {
              break;
            }

            setError(err instanceof Error ? err.message : 'Terminal dispatch polling failed');
            await new Promise((resolve) => setTimeout(resolve, 1_500));
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Terminal station stopped');
          setStatusMessage('Terminal station offline. Tap Save Name to retry registration.');
        }
      } finally {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
        }
      }
    };

    run().catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [deviceId, savedTerminalName, token]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.brandTag}>Penncrest Theater</Text>
          <Text style={styles.title}>Terminal{`\n`}<Text style={styles.titleAccent}>Station</Text></Text>
          <Text style={styles.subtitle}>This device waits for dispatches and defaults to Tap to Pay after 5 seconds.</Text>
          <PaymentModeBadge />
          <View style={styles.divider} />
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
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
            placeholder="Front Desk iPhone"
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
          <Text style={styles.label}>Status</Text>
          <Text style={styles.value}>{statusMessage}</Text>
          {recoveryMessage ? <Text style={styles.recoveryText}>{recoveryMessage}</Text> : null}
          {processing ? <ActivityIndicator size="small" color="#c9a84c" style={{ marginTop: 10 }} /> : null}
          {activeDispatch ? (
            <View style={styles.dispatchBox}>
              <Text style={styles.dispatchTitle}>{activeDispatch.performanceTitle}</Text>
              <Text style={styles.dispatchMeta}>
                ${(activeDispatch.expectedAmountCents / 100).toFixed(2)} · {activeDispatch.seats.length} seat
                {activeDispatch.seats.length === 1 ? '' : 's'}
              </Text>
              <Text style={styles.dispatchMeta}>{activeDispatch.seats.map((seat) => seat.label).join(', ')}</Text>
              <Text style={styles.dispatchMeta}>Dispatch ID: {activeDispatch.dispatchId}</Text>
              <Text style={styles.dispatchMeta}>Payment Intent: {activeDispatch.paymentIntentId}</Text>
            </View>
          ) : null}
          {lastOrderId ? <Text style={styles.successText}>Last completed order: {lastOrderId}</Text> : null}
        </View>

        {(activeDispatch || lastFailedDispatchId) ? (
          <View style={styles.card}>
            <Text style={styles.label}>Operator Controls</Text>
            {lastFailedDispatchId ? (
              <View style={styles.failureBox}>
                <Text style={styles.failureTitle}>Last failure ({lastFailurePath === 'manual' ? 'Manual Card Entry' : lastFailurePath === 'tap' ? 'Tap to Pay' : 'Unknown'})</Text>
                <Text style={styles.failureText}>{lastFailureReason || 'Terminal dispatch failed.'}</Text>
                <Text style={styles.failureText}>Dispatch ID: {lastFailedDispatchId}</Text>
                {!lastFailureCanRetry ? (
                  <Text style={styles.failureHint}>Retry unavailable. Hold may be expired or dispatch already finalized.</Text>
                ) : null}
              </View>
            ) : null}
            <View style={styles.actionRow}>
              <Pressable
                style={[
                  styles.actionButton,
                  styles.secondaryActionButton,
                  (operatorBusy || (!activeDispatch && !lastFailedDispatchId)) && styles.actionButtonDisabled
                ]}
                onPress={() => void cancelDispatchFromOperator()}
                disabled={operatorBusy || (!activeDispatch && !lastFailedDispatchId)}
              >
                <Text style={styles.secondaryActionLabel}>{operatorBusy ? 'Working...' : 'Cancel Dispatch'}</Text>
              </Pressable>
              <Pressable
                style={[
                  styles.actionButton,
                  styles.primaryActionButton,
                  (operatorBusy || !lastFailedDispatchId || !lastFailureCanRetry) && styles.actionButtonDisabled
                ]}
                onPress={() => void retryDispatchFromOperator()}
                disabled={operatorBusy || !lastFailedDispatchId || !lastFailureCanRetry}
              >
                <Text style={styles.primaryActionLabel}>{operatorBusy ? 'Working...' : 'Retry Dispatch'}</Text>
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
  failureHint: {
    marginTop: 5,
    color: '#f5d98b',
    fontFamily: 'Arial',
    fontSize: 11
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
