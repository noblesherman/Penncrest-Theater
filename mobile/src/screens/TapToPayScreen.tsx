import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { completePayment } from '../api/mobile';
import { useAuth } from '../auth/AuthContext';
import { LargeButton } from '../components/LargeButton';
import { PaymentModeBadge } from '../components/PaymentModeBadge';
import { StatusCard } from '../components/StatusCard';
import { TERMINAL_MOCK_MODE } from '../config';
import type { RootStackParamList } from '../navigation/types';
import { clearPendingSale, savePendingSale } from '../payments/paymentRecovery';
import { useTerminal } from '../terminal/terminal';
import { screenStyles } from './styles';

type Props = NativeStackScreenProps<RootStackParamList, 'TapToPay'>;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function TapToPayScreen({ navigation, route }: Props) {
  const { token } = useAuth();
  const { sale } = route.params;
  const terminal = useTerminal();
  const isTerminalMockMode = TERMINAL_MOCK_MODE;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('Ready to initialize terminal');
  const [didInitialize, setDidInitialize] = useState(false);
  const terminalInitPromiseRef = useRef<Promise<void> | null>(null);
  const terminalInitializedRef = useRef(false);

  const readerCount = terminal.discoveredReaders.length;
  const hasConnectedReader = Boolean(terminal.connectedReader);

  const ensureTerminalInitialized = async () => {
    if (terminalInitializedRef.current || terminal.getIsInitialized?.() || terminal.isInitialized) {
      terminalInitializedRef.current = true;
      return;
    }

    if (terminalInitPromiseRef.current) {
      await terminalInitPromiseRef.current;
      return;
    }

    terminalInitPromiseRef.current = (async () => {
      const result = await terminal.initialize();
      if (result.error) {
        throw new Error(result.error.message || 'Terminal initialization failed');
      }
      terminalInitializedRef.current = true;
    })();

    try {
      await terminalInitPromiseRef.current;
    } finally {
      terminalInitPromiseRef.current = null;
    }
  };

  useEffect(() => {
    if (didInitialize) return;
    setDidInitialize(true);

    const initializeTerminal = async () => {
      if (isTerminalMockMode) {
        setStatusMessage('Terminal mock mode enabled. Payments finalize without Apple Tap to Pay.');
        return;
      }

      if (!terminal.isAvailable) {
        setStatusMessage('Stripe Terminal is unavailable in this app build. Tap to Pay cannot start.');
        return;
      }

      await ensureTerminalInitialized();
      setStatusMessage('Terminal initialized');
    };

    initializeTerminal().catch((err) => {
      setStatusMessage(err instanceof Error ? err.message : 'Terminal initialization failed');
    });
  }, [didInitialize, isTerminalMockMode, terminal]);

  useEffect(() => {
    void savePendingSale(sale).catch(() => undefined);
  }, [sale]);

  const totalLabel = useMemo(() => `$${(sale.amountTotalCents / 100).toFixed(2)}`, [sale.amountTotalCents]);

  const discoverTapToPay = async () => {
    setError(null);
    setBusy(true);
    try {
      setStatusMessage('Discovering Tap to Pay reader...');
      const result = await terminal.discoverReaders({
        discoveryMethod: 'tapToPay',
        simulated: false
      });

      if (result.error) {
        throw new Error(result.error.message || 'Reader discovery failed');
      }

      setStatusMessage(`Discovery complete (${terminal.discoveredReaders.length} reader(s))`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reader discovery failed');
    } finally {
      setBusy(false);
    }
  };

  const connectTapToPayReader = async () => {
    setError(null);
    setBusy(true);

    try {
      await ensureTerminalInitialized();
      if (terminal.connectedReader) {
        setStatusMessage('Tap to Pay connected');
        return;
      }

      const reader = terminal.discoveredReaders[0];
      setStatusMessage('Fetching Stripe location...');
      const locationsResult = await terminal.getLocations({ limit: 1 });
      if (locationsResult.error) {
        throw new Error(locationsResult.error.message || 'Unable to fetch Stripe locations');
      }

      const locationId = locationsResult.locations?.[0]?.id;
      if (!locationId) {
        throw new Error('No Stripe Terminal location available. Configure one in Stripe Dashboard.');
      }

      if (terminal.easyConnect) {
        setStatusMessage('Connecting to Tap to Pay...');
        const easyConnectResult = await terminal.easyConnect({
          discoveryMethod: 'tapToPay',
          simulated: false,
          locationId,
          autoReconnectOnUnexpectedDisconnect: true
        });
        if (easyConnectResult.error) {
          throw new Error(easyConnectResult.error.message || 'Could not connect reader');
        }
        setStatusMessage('Tap to Pay connected');
        return;
      }

      if (!reader) {
        throw new Error('No Tap to Pay reader found. Run discovery first.');
      }

      setStatusMessage('Connecting to Tap to Pay...');
      const connectResult = await terminal.connectReader({
        discoveryMethod: 'tapToPay',
        reader,
        locationId,
        autoReconnectOnUnexpectedDisconnect: true
      });

      if (connectResult.error) {
        throw new Error(connectResult.error.message || 'Could not connect reader');
      }

      setStatusMessage('Tap to Pay connected');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setBusy(false);
    }
  };

  const ensureConnectedReader = async () => {
    if (!terminal.isAvailable) {
      throw new Error('Stripe Terminal is unavailable in this app build.');
    }

    await ensureTerminalInitialized();
    if (terminal.connectedReader) {
      return;
    }

    const locationsResult = await terminal.getLocations({ limit: 1 });
    if (locationsResult.error) {
      throw new Error(locationsResult.error.message || 'Unable to fetch Stripe locations');
    }

    const locationId = locationsResult.locations?.[0]?.id;
    if (!locationId) {
      throw new Error('No Stripe Terminal location available. Configure one in Stripe Dashboard.');
    }

    if (terminal.easyConnect) {
      const easyConnectResult = await terminal.easyConnect({
        discoveryMethod: 'tapToPay',
        simulated: false,
        locationId,
        autoReconnectOnUnexpectedDisconnect: true
      });
      if (easyConnectResult.error) {
        throw new Error(easyConnectResult.error.message || 'Could not connect reader');
      }
      return;
    }

    const reader = terminal.discoveredReaders[0];
    if (!reader) {
      const discoverResult = await terminal.discoverReaders({
        discoveryMethod: 'tapToPay',
        simulated: false
      });
      if (discoverResult.error) {
        throw new Error(discoverResult.error.message || 'Reader discovery failed');
      }
    }

    const resolvedReader = terminal.discoveredReaders[0];
    if (!resolvedReader) {
      throw new Error('No Tap to Pay reader found');
    }

    const connectResult = await terminal.connectReader({
      discoveryMethod: 'tapToPay',
      reader: resolvedReader,
      locationId,
      autoReconnectOnUnexpectedDisconnect: true
    });
    if (connectResult.error) {
      throw new Error(connectResult.error.message || 'Could not connect reader');
    }
  };

  const collectAndConfirmPayment = async () => {
    if (!token) return;

    setError(null);
    setBusy(true);

    const runMockTapToPayAnimation = async () => {
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
    };

    const finalizeMockPayment = async () => {
      await runMockTapToPayAnimation();
      const completion = await completePayment(token, sale.paymentIntentId, { mockApproved: true });
      if (!completion.success && !completion.alreadyCompleted) {
        throw new Error('Mock payment completed but backend finalization failed');
      }
      await clearPendingSale().catch(() => undefined);
      navigation.replace('Success', { orderId: completion.orderId || completion.order?.id });
    };

    try {
      if (isTerminalMockMode) {
        await finalizeMockPayment();
        return;
      }

      setStatusMessage('Connecting Tap to Pay...');
      await ensureConnectedReader();

      setStatusMessage('Loading payment intent...');
      const retrieved = await terminal.retrievePaymentIntent(sale.clientSecret);
      if (retrieved.error || !retrieved.paymentIntent) {
        throw new Error(retrieved.error?.message || 'Unable to retrieve payment intent');
      }

      setStatusMessage('Present card or tap device...');
      const collected = await terminal.collectPaymentMethod({ paymentIntent: retrieved.paymentIntent });
      if (collected.error || !collected.paymentIntent) {
        throw new Error(collected.error?.message || 'Payment method collection failed');
      }

      setStatusMessage('Confirming payment...');
      const confirmed = await terminal.confirmPaymentIntent({ paymentIntent: collected.paymentIntent });
      if (confirmed.error) {
        throw new Error(confirmed.error.message || 'Payment confirmation failed');
      }

      setStatusMessage('Finalizing ticket order...');
      const completion = await completePayment(token, sale.paymentIntentId);

      if (!completion.success && !completion.alreadyCompleted) {
        throw new Error('Payment completed but backend finalization failed');
      }

      await clearPendingSale().catch(() => undefined);
      navigation.replace('Success', { orderId: completion.orderId || completion.order?.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={screenStyles.safeArea}>
      <View style={screenStyles.container}>
        <Text style={screenStyles.title}>Tap to Pay</Text>
        <Text style={screenStyles.subtitle}>Total: {totalLabel}</Text>
        <PaymentModeBadge compact />

        <StatusCard status={error ? 'invalid' : 'idle'} message={error || statusMessage} />

        <View style={screenStyles.card}>
          <Text style={screenStyles.label}>Sale Summary</Text>
          <Text style={screenStyles.value}>{sale.performance.title}</Text>
          <Text style={screenStyles.value}>
            {sale.ticketType.name} x {sale.quantity}
          </Text>
          <Text style={screenStyles.value}>Seats: {sale.seats.map((seat) => seat.label).join(', ')}</Text>
          <Text style={screenStyles.value}>Payment Intent: {sale.paymentIntentId}</Text>
        </View>

        {!terminal.isAvailable ? (
          <View style={screenStyles.card}>
            <Text style={screenStyles.label}>Requirements</Text>
            <Text style={screenStyles.value}>Tap to Pay is not available in this build.</Text>
            <Text style={screenStyles.value}>Use the App Store or production-distributed build with Stripe Terminal enabled.</Text>
          </View>
        ) : null}
        {isTerminalMockMode ? (
          <View style={screenStyles.card}>
            <Text style={screenStyles.label}>Demo Mode</Text>
            <Text style={screenStyles.value}>Terminal mock mode is ON. Real Tap to Pay is bypassed.</Text>
          </View>
        ) : null}

        <View style={screenStyles.card}>
          <Text style={screenStyles.label}>Reader</Text>
          <Text style={screenStyles.value}>Discovered: {readerCount}</Text>
          <Text style={screenStyles.value}>Connected: {hasConnectedReader ? 'Yes' : 'No'}</Text>
        </View>

        {busy ? <ActivityIndicator size="large" color="#0EA5E9" style={{ marginBottom: 12 }} /> : null}

        <LargeButton label="1. Discover Reader" onPress={discoverTapToPay} disabled={busy || !terminal.isAvailable || isTerminalMockMode} />
        <LargeButton label="2. Connect Reader" onPress={connectTapToPayReader} disabled={busy || !terminal.isAvailable || isTerminalMockMode} />
        <LargeButton
          label="3. Collect + Confirm"
          onPress={collectAndConfirmPayment}
          disabled={busy || (!terminal.isAvailable && !isTerminalMockMode)}
        />
      </View>
    </SafeAreaView>
  );
}
