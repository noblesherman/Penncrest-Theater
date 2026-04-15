import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { CreatePaymentIntentResponse } from '../api/mobile';
import { useAuth } from '../auth/AuthContext';
import { AdminEscapeModal } from '../components/AdminEscapeModal';
import type { RootStackParamList } from '../navigation/types';
import { clearPendingSale, loadPendingSale } from '../payments/paymentRecovery';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

type ActionButtonProps = {
  icon: string;
  label: string;
  sublabel?: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
};

function ActionButton({ icon, label, sublabel, onPress, variant = 'primary' }: ActionButtonProps) {
  const isPrimary = variant === 'primary';
  return (
    <TouchableOpacity
      style={[styles.actionBtn, isPrimary ? styles.actionBtnPrimary : styles.actionBtnSecondary]}
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={sublabel ? `${label}. ${sublabel}` : label}
    >
      <View style={[styles.btnIcon, isPrimary ? styles.btnIconPrimary : styles.btnIconSecondary]}>
        <Text style={styles.btnIconText}>{icon}</Text>
      </View>
      <View style={styles.btnTextGroup}>
        <Text style={[styles.btnLabel, !isPrimary && styles.btnLabelSecondary]}>{label}</Text>
        {sublabel && <Text style={styles.btnSublabel}>{sublabel}</Text>}
      </View>
      {isPrimary && <Text style={styles.btnArrow}>›</Text>}
    </TouchableOpacity>
  );
}

export function HomeScreen({ navigation }: Props) {
  const { logout } = useAuth();
  const [pendingSale, setPendingSale] = useState<CreatePaymentIntentResponse | null>(null);
  const [showAdminModal, setShowAdminModal] = useState(false);

  const onLogout = async () => {
    try {
      await logout();
    } catch {
      Alert.alert('Logout failed', 'Please close and reopen the app.');
    }
  };

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void loadPendingSale()
        .then((sale) => {
          if (!cancelled) setPendingSale(sale);
        })
        .catch(() => {
          if (!cancelled) setPendingSale(null);
        });
      return () => { cancelled = true; };
    }, [])
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={styles.title}>Box Office</Text>
          <Text style={styles.subtitle}>Penncrest Theater</Text>
        </View>

        <View style={styles.actions}>
          <ActionButton
            icon="📷"
            label="Scan Tickets"
            sublabel="Scan QR codes at the door"
            onPress={() => navigation.navigate('ScanTickets')}
          />
          <ActionButton
            icon="🎭"
            label="Sell Tickets"
            sublabel="Process walk-up sales"
            onPress={() => navigation.navigate('SellTickets')}
          />
          {pendingSale ? (
            <ActionButton
              icon="⏯"
              label="Resume Payment"
              sublabel={`Intent: ${pendingSale.paymentIntentId}`}
              onPress={() => navigation.navigate('TapToPay', { sale: pendingSale })}
            />
          ) : null}
          <ActionButton
            icon="📲"
            label="Terminal Station"
            sublabel="Wait for web cashier dispatches"
            onPress={() => navigation.navigate('TerminalStation')}
          />
        </View>

        <View style={styles.secondaryActions}>
          <ActionButton
            icon="🛡"
            label="Legal & Support"
            sublabel="Privacy, terms, and support contact"
            onPress={() => navigation.navigate('Legal')}
            variant="secondary"
          />
          {pendingSale ? (
            <ActionButton
              icon="✕"
              label="Clear Pending Payment"
              sublabel="Remove stale in-progress sale"
              onPress={() => {
                void clearPendingSale()
                  .then(() => setPendingSale(null))
                  .catch(() => Alert.alert('We could not clear payment', 'Please try again.'));
              }}
              variant="secondary"
            />
          ) : null}
          <ActionButton
            icon="↩"
            label="Log Out"
            onPress={onLogout}
            variant="secondary"
          />
          <ActionButton
            icon="🔓"
            label="Admin Unlock"
            sublabel="Open maintenance controls"
            onPress={() => setShowAdminModal(true)}
            variant="secondary"
          />
        </View>
      </ScrollView>
      <AdminEscapeModal
        visible={showAdminModal}
        onClose={() => setShowAdminModal(false)}
        onUnlocked={() => navigation.navigate('Maintenance')}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#1a0505',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 40,
  },

  header: {
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#f5f0e8',
    fontFamily: 'Georgia',
  },
  subtitle: {
    fontSize: 13,
    color: 'rgba(245,240,232,0.35)',
    fontFamily: 'Georgia',
    marginTop: 2,
  },

  actions: {
    marginBottom: 6,
  },
  secondaryActions: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(201,168,76,0.15)',
    paddingTop: 10,
    marginTop: 6,
  },

  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 14,
    marginBottom: 8,
    gap: 12,
  },
  actionBtnPrimary: {
    backgroundColor: '#8b1a1a',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(201,168,76,0.5)',
  },
  actionBtnSecondary: {
    backgroundColor: 'transparent',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(201,168,76,0.18)',
  },
  btnIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  btnIconPrimary: {
    backgroundColor: 'rgba(245,217,139,0.1)',
  },
  btnIconSecondary: {
    backgroundColor: 'rgba(245,240,232,0.05)',
  },
  btnIconText: {
    fontSize: 16,
  },
  btnTextGroup: {
    flex: 1,
    minWidth: 0,
  },
  btnLabel: {
    fontFamily: 'Georgia',
    fontSize: 16,
    fontWeight: '600',
    color: '#f5f0e8',
  },
  btnLabelSecondary: {
    fontSize: 14,
    fontWeight: '400',
    color: 'rgba(245,240,232,0.4)',
  },
  btnSublabel: {
    fontSize: 11,
    color: 'rgba(201,168,76,0.6)',
    marginTop: 1,
    flexShrink: 1,
  },
  btnArrow: {
    fontSize: 20,
    color: '#c9a84c',
    opacity: 0.4,
    flexShrink: 0,
  },
});
