import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { useDeviceRuntime } from '../device/DeviceRuntimeProvider';

type AdminEscapeModalProps = {
  visible: boolean;
  onClose: () => void;
  onUnlocked?: () => void;
};

export function AdminEscapeModal({ visible, onClose, onUnlocked }: AdminEscapeModalProps) {
  const { unlockWithPin } = useDeviceRuntime();
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      return;
    }

    setPin('');
    setSubmitting(false);
    setError(null);
  }, [visible]);

  const submit = async () => {
    if (!pin.trim()) {
      setError('Enter your admin PIN');
      return;
    }

    setSubmitting(true);
    setError(null);

    const result = await unlockWithPin(pin.trim());
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error || 'Invalid PIN');
      return;
    }

    onClose();
    onUnlocked?.();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Admin Unlock</Text>
          <Text style={styles.subtitle}>Enter the admin escape PIN to open maintenance controls.</Text>

          <TextInput
            style={styles.input}
            value={pin}
            onChangeText={setPin}
            keyboardType="number-pad"
            secureTextEntry
            placeholder="PIN"
            placeholderTextColor="rgba(245,240,232,0.35)"
            autoFocus
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.actions}>
            <Pressable style={[styles.button, styles.buttonSecondary]} onPress={onClose} disabled={submitting}>
              <Text style={styles.buttonSecondaryText}>Cancel</Text>
            </Pressable>
            <Pressable style={[styles.button, styles.buttonPrimary]} onPress={() => void submit()} disabled={submitting}>
              {submitting ? <ActivityIndicator color="#f5f0e8" /> : <Text style={styles.buttonPrimaryText}>Unlock</Text>}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(10,5,5,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#1a0505',
    borderColor: 'rgba(201,168,76,0.35)',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 20,
    gap: 10
  },
  title: {
    color: '#f5f0e8',
    fontSize: 22,
    fontFamily: 'Georgia',
    fontWeight: '700'
  },
  subtitle: {
    color: 'rgba(245,240,232,0.6)',
    fontSize: 13,
    lineHeight: 18
  },
  input: {
    marginTop: 6,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: 'rgba(201,168,76,0.3)',
    paddingHorizontal: 14,
    paddingVertical: 13,
    color: '#f5f0e8',
    fontSize: 18,
    letterSpacing: 6
  },
  error: {
    color: '#fda4af',
    fontSize: 12
  },
  actions: {
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10
  },
  button: {
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minWidth: 92,
    alignItems: 'center',
    justifyContent: 'center'
  },
  buttonSecondary: {
    borderColor: 'rgba(201,168,76,0.3)',
    borderWidth: 1,
    backgroundColor: 'transparent'
  },
  buttonPrimary: {
    backgroundColor: '#8b1a1a'
  },
  buttonSecondaryText: {
    color: 'rgba(245,240,232,0.75)',
    fontWeight: '600'
  },
  buttonPrimaryText: {
    color: '#f5f0e8',
    fontWeight: '700'
  }
});
