import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useDeviceRuntime } from '../device/DeviceRuntimeProvider';
import { setKioskLock } from '../native/deviceControl';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Maintenance'>;

type ActionProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
};

function ActionRow({ label, onPress, disabled }: ActionProps) {
  return (
    <TouchableOpacity
      style={[styles.actionButton, disabled && styles.actionButtonDisabled]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.75}
    >
      <Text style={styles.actionButtonText}>{label}</Text>
    </TouchableOpacity>
  );
}

export function MaintenanceScreen({ navigation }: Props) {
  const {
    state,
    isAdminUnlocked,
    relockNow,
    checkForUpdateNow,
    openWifiSettings,
    openAppSettings,
    setMaintenanceModeLocal,
    setKioskLockedLocal
  } = useDeviceRuntime();

  const [busy, setBusy] = useState(false);

  const ensureUnlocked = () => {
    if (isAdminUnlocked) {
      return true;
    }

    Alert.alert('Unlock required', 'Use Admin Unlock first.');
    return false;
  };

  const runAction = async (action: () => Promise<void>) => {
    if (!ensureUnlocked()) {
      return;
    }

    setBusy(true);
    try {
      await action();
    } catch (error) {
      Alert.alert('Action failed', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  const runUpdateCheck = async () => {
    if (!ensureUnlocked()) {
      return;
    }

    setBusy(true);
    try {
      const result = await checkForUpdateNow();
      if (!result.release) {
        Alert.alert('Update Check', 'No release metadata is currently published.');
      } else if (!result.updateAvailable) {
        Alert.alert('Update Check', 'This device is already on the latest version.');
      } else {
        Alert.alert(
          'Update Triggered',
          result.installResult?.message || `Install mode: ${result.installResult?.mode || 'unknown'}`
        );
      }
    } catch (error) {
      Alert.alert('Update failed', error instanceof Error ? error.message : 'Unable to run update check');
    } finally {
      setBusy(false);
    }
  };

  if (!isAdminUnlocked) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.lockedState}>
          <Text style={styles.title}>Maintenance Locked</Text>
          <Text style={styles.subtitle}>Use Admin Unlock from the home screen to open maintenance controls.</Text>
          <TouchableOpacity style={styles.actionButton} onPress={() => navigation.goBack()}>
            <Text style={styles.actionButtonText}>Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>Maintenance</Text>
          <Text style={styles.subtitle}>Temporary admin window active for local utilities and kiosk controls.</Text>
        </View>

        <View style={styles.stateCard}>
          <Text style={styles.stateTitle}>Device State</Text>
          <Text style={styles.stateLine}>Device ID: {state.deviceId || 'unknown'}</Text>
          <Text style={styles.stateLine}>Maintenance: {state.maintenanceMode ? 'Enabled' : 'Disabled'}</Text>
          <Text style={styles.stateLine}>Kiosk lock: {state.kioskLocked ? 'Locked' : 'Unlocked'}</Text>
          <Text style={styles.stateLine}>Owner active: {state.deviceOwnerActive ? 'Yes' : 'No'}</Text>
          <Text style={styles.stateLine}>Update state: {state.updateState}</Text>
          <Text style={styles.stateLine}>Last command: {state.lastCommandId || 'none'}</Text>
        </View>

        <View style={styles.actionsSection}>
          <ActionRow label="Open Wi-Fi Settings" onPress={() => void runAction(openWifiSettings)} disabled={busy} />
          <ActionRow label="Open App Settings" onPress={() => void runAction(openAppSettings)} disabled={busy} />
          <ActionRow label="Enable Maintenance Mode" onPress={() => void runAction(() => setMaintenanceModeLocal(true))} disabled={busy} />
          <ActionRow label="Disable Maintenance Mode" onPress={() => void runAction(() => setMaintenanceModeLocal(false))} disabled={busy} />
          <ActionRow
            label="Relock Kiosk"
            onPress={() =>
              void runAction(async () => {
                const applied = await setKioskLock(true);
                if (!applied) {
                  throw new Error('Kiosk lock was not enforced. Confirm device owner provisioning is active.');
                }
                await setKioskLockedLocal(true);
              })
            }
            disabled={busy}
          />
          <ActionRow label="Check for Update" onPress={() => void runUpdateCheck()} disabled={busy} />
        </View>

        <TouchableOpacity
          style={[styles.actionButton, styles.exitButton]}
          onPress={() => {
            relockNow();
            navigation.goBack();
          }}
          disabled={busy}
        >
          <Text style={styles.actionButtonText}>Relock and Exit</Text>
        </TouchableOpacity>

        {busy ? (
          <View style={styles.busyRow}>
            <ActivityIndicator color="#c9a84c" />
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
  content: {
    padding: 20,
    gap: 16
  },
  lockedState: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
    gap: 10
  },
  header: {
    gap: 4
  },
  title: {
    color: '#f5f0e8',
    fontSize: 28,
    fontWeight: '700',
    fontFamily: 'Georgia'
  },
  subtitle: {
    color: 'rgba(245,240,232,0.65)',
    fontSize: 13,
    lineHeight: 18
  },
  stateCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(201,168,76,0.35)',
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.03)',
    padding: 14,
    gap: 4
  },
  stateTitle: {
    color: '#c9a84c',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 2
  },
  stateLine: {
    color: 'rgba(245,240,232,0.86)',
    fontSize: 13
  },
  actionsSection: {
    gap: 8
  },
  actionButton: {
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(201,168,76,0.4)',
    backgroundColor: '#8b1a1a',
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: 'center'
  },
  actionButtonDisabled: {
    opacity: 0.6
  },
  actionButtonText: {
    color: '#f5f0e8',
    fontWeight: '600',
    fontSize: 14
  },
  exitButton: {
    marginTop: 8,
    backgroundColor: '#5a5a5a'
  },
  busyRow: {
    marginTop: 8,
    alignItems: 'center'
  }
});
