/*
Handoff note for Mr. Smith:
- File: `mobile/src/screens/SellTicketsScreen.tsx`
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
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createPaymentIntent, getPerformanceDetails, getPerformances, type PerformanceDetail, type PerformanceSummary } from '../api/mobile';
import { useAuth } from '../auth/AuthContext';
import { PaymentModeBadge } from '../components/PaymentModeBadge';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'SellTickets'>;

export function SellTicketsScreen({ navigation }: Props) {
  const { token } = useAuth();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [performances, setPerformances] = useState<PerformanceSummary[]>([]);
  const [selectedPerformanceId, setSelectedPerformanceId] = useState<string | null>(null);

  const [detailLoading, setDetailLoading] = useState(false);
  const [performanceDetail, setPerformanceDetail] = useState<PerformanceDetail | null>(null);
  const [selectedTierId, setSelectedTierId] = useState<string | null>(null);
  const detailRequestIdRef = useRef(0);

  const [quantity, setQuantity] = useState(1);
  const [customerName, setCustomerName] = useState('');
  const [receiptEmail, setReceiptEmail] = useState('');

  useEffect(() => {
    if (!token) return;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const rows = await getPerformances(token);
        const activeRows = rows.filter((row) => row.salesOpen);
        setPerformances(activeRows);
        if (activeRows.length > 0) {
          setSelectedPerformanceId(activeRows[0].id);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'We could not load performances');
      } finally {
        setLoading(false);
      }
    };

    load().catch(() => {
      setLoading(false);
    });
  }, [token]);

  useEffect(() => {
    if (!token || !selectedPerformanceId) return;

    const loadPerformanceDetail = async () => {
      const requestId = ++detailRequestIdRef.current;
      setDetailLoading(true);
      setError(null);
      try {
        const detail = await getPerformanceDetails(token, selectedPerformanceId);
        if (detailRequestIdRef.current !== requestId) return;
        setPerformanceDetail(detail);
        setSelectedTierId(detail.pricingTiers[0]?.id || null);
        setError(null);
      } catch (err) {
        if (detailRequestIdRef.current !== requestId) return;
        setPerformanceDetail(null);
        setSelectedTierId(null);
        const message = err instanceof Error ? err.message : 'We could not load ticket types';
        setError(message === 'Performance not found' || message === 'Not Found' ? 'That performance is no longer available.' : message);
      } finally {
        if (detailRequestIdRef.current !== requestId) return;
        setDetailLoading(false);
      }
    };

    loadPerformanceDetail().catch(() => {
      setDetailLoading(false);
    });

    return () => {
      detailRequestIdRef.current += 1;
    };
  }, [selectedPerformanceId, token]);

  const selectedTier = useMemo(
    () => performanceDetail?.pricingTiers.find((tier) => tier.id === selectedTierId) || null,
    [performanceDetail, selectedTierId]
  );

  const totalCents = (selectedTier?.priceCents || 0) * quantity;

  const onCreatePaymentIntent = async () => {
    if (!token || !selectedPerformanceId || !selectedTierId) return;

    setError(null);
    setSubmitting(true);
    try {
      const sale = await createPaymentIntent(token, {
        performanceId: selectedPerformanceId,
        pricingTierId: selectedTierId,
        quantity,
        customerName: customerName.trim() || undefined,
        receiptEmail: receiptEmail.trim().toLowerCase() || undefined
      });

      navigation.navigate('TapToPay', { sale });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We could not start sale');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={[styles.scrollContent, styles.centered]}>
          <ActivityIndicator size="large" color="#c9a84c" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.brandTag}>Penncrest Theater</Text>
          <Text style={styles.title}>
            Sell{'\n'}
            <Text style={styles.titleAccent}>Tickets</Text>
          </Text>
          <Text style={styles.subtitle}>Choose performance, ticket type, and quantity.</Text>
          <PaymentModeBadge />
          <View style={styles.divider} />
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.label}>Performance</Text>
          {performances.length === 0 ? <Text style={styles.emptyText}>No active performances</Text> : null}

          {performances.map((performance) => {
            const selected = performance.id === selectedPerformanceId;
            return (
              <Pressable
                key={performance.id}
                style={[styles.option, selected && styles.optionSelected]}
                onPress={() => setSelectedPerformanceId(performance.id)}
              >
                <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>{performance.title}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Ticket Type</Text>
          {detailLoading ? <ActivityIndicator color="#c9a84c" /> : null}

          {performanceDetail?.pricingTiers.map((tier) => {
            const selected = tier.id === selectedTierId;
            return (
              <Pressable key={tier.id} style={[styles.option, selected && styles.optionSelected]} onPress={() => setSelectedTierId(tier.id)}>
                <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>
                  {tier.name} - ${(tier.priceCents / 100).toFixed(2)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Quantity</Text>
          <View style={styles.qtyRow}>
            <Pressable style={styles.qtyButton} onPress={() => setQuantity((prev) => Math.max(1, prev - 1))}>
              <Text style={styles.qtyButtonLabel}>-</Text>
            </Pressable>
            <Text style={styles.qtyValue}>{quantity}</Text>
            <Pressable style={styles.qtyButton} onPress={() => setQuantity((prev) => Math.min(20, prev + 1))}>
              <Text style={styles.qtyButtonLabel}>+</Text>
            </Pressable>
          </View>

          <Text style={[styles.label, { marginTop: 12 }]}>Total</Text>
          <Text style={styles.total}>${(totalCents / 100).toFixed(2)}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>Receipt Name (Optional)</Text>
          <TextInput
            style={styles.input}
            value={customerName}
            onChangeText={setCustomerName}
            placeholder="Walk-in Guest"
            placeholderTextColor="rgba(245,240,232,0.25)"
          />

          <Text style={styles.label}>Receipt Email (Optional)</Text>
          <TextInput
            style={[styles.input, { marginBottom: 0 }]}
            value={receiptEmail}
            onChangeText={setReceiptEmail}
            placeholder="customer@email.com"
            placeholderTextColor="rgba(245,240,232,0.25)"
            autoCapitalize="none"
            keyboardType="email-address"
          />
        </View>

        <Pressable
          style={[styles.submitButton, (!selectedPerformanceId || !selectedTierId || detailLoading || submitting) && styles.submitButtonDisabled]}
          onPress={onCreatePaymentIntent}
          disabled={!selectedPerformanceId || !selectedTierId || detailLoading || submitting}
        >
          {submitting ? <ActivityIndicator size="small" color="#f5d98b" /> : <Text style={styles.submitButtonLabel}>Create Payment</Text>}
        </Pressable>
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
  centered: {
    justifyContent: 'center'
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
  emptyText: {
    fontFamily: 'Georgia',
    fontSize: 14,
    color: 'rgba(245,240,232,0.55)',
    marginBottom: 8
  },
  option: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(201,168,76,0.2)',
    marginBottom: 8,
    backgroundColor: 'rgba(245,240,232,0.04)'
  },
  optionSelected: {
    borderColor: '#c9a84c',
    backgroundColor: '#8b1a1a'
  },
  optionLabel: {
    fontFamily: 'Georgia',
    fontSize: 16,
    color: '#f5f0e8',
    fontWeight: '700'
  },
  optionLabelSelected: {
    color: '#f5d98b'
  },
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  qtyButton: {
    width: 68,
    height: 56,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(245,240,232,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(201,168,76,0.25)'
  },
  qtyButtonLabel: {
    fontSize: 28,
    lineHeight: 36,
    color: '#f5d98b',
    fontWeight: '700'
  },
  qtyValue: {
    fontSize: 34,
    fontWeight: '800',
    color: '#f5f0e8',
    fontFamily: 'Georgia'
  },
  total: {
    fontSize: 34,
    fontWeight: '800',
    color: '#f5d98b',
    fontFamily: 'Georgia'
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(201,168,76,0.25)',
    borderRadius: 11,
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: '#f5f0e8',
    fontFamily: 'Arial',
    fontSize: 15,
    marginBottom: 12
  },
  errorBox: {
    backgroundColor: 'rgba(139,26,26,0.35)',
    borderWidth: 1,
    borderColor: 'rgba(201,168,76,0.2)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    marginBottom: 16
  },
  errorText: {
    fontSize: 13,
    color: '#f5d98b',
    fontFamily: 'Arial',
    lineHeight: 18
  },
  submitButton: {
    backgroundColor: '#8b1a1a',
    borderWidth: 1,
    borderColor: '#c9a84c',
    borderRadius: 14,
    paddingVertical: 17,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
    marginTop: 4
  },
  submitButtonDisabled: {
    opacity: 0.45
  },
  submitButtonLabel: {
    fontFamily: 'Georgia',
    fontSize: 17,
    fontWeight: '700',
    color: '#f5d98b',
    letterSpacing: 0.3
  }
});
