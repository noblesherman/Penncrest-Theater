import { StyleSheet, Text, View } from 'react-native';

type StatusType = 'valid' | 'already_used' | 'invalid' | 'idle';

type Props = {
  status: StatusType;
  message: string;
};

const statusStyles: Record<StatusType, { bg: string; text: string; border: string }> = {
  valid: { bg: '#DCFCE7', text: '#14532D', border: '#86EFAC' },
  already_used: { bg: '#FEF9C3', text: '#713F12', border: '#FDE047' },
  invalid: { bg: '#FEE2E2', text: '#7F1D1D', border: '#FCA5A5' },
  idle: { bg: '#E2E8F0', text: '#1E293B', border: '#CBD5E1' }
};

export function StatusCard({ status, message }: Props) {
  const palette = statusStyles[status];

  return (
    <View style={[styles.card, { backgroundColor: palette.bg, borderColor: palette.border }]}>
      <Text style={[styles.message, { color: palette.text }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    borderWidth: 2,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 16
  },
  message: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center'
  }
});
