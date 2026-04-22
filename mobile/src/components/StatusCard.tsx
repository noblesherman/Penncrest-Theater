/*
Handoff note for Mr. Smith:
- File: `mobile/src/components/StatusCard.tsx`
- What this is: Shared React Native component.
- What it does: Provides reusable UI pieces used across multiple screens.
- Connections: Imported by screen modules and sometimes runtime/device context.
- Main content type: Presentation with light interaction behavior.
- Safe edits here: Styling and microcopy changes preserving component contracts.
- Be careful with: Prop/state contract edits that affect many screens.
- Useful context: Use this layer for consistent visual updates across the mobile app.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

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
