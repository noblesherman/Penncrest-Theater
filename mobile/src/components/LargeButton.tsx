/*
Handoff note for Mr. Smith:
- File: `mobile/src/components/LargeButton.tsx`
- What this is: Shared React Native component.
- What it does: Provides reusable UI pieces used across multiple screens.
- Connections: Imported by screen modules and sometimes runtime/device context.
- Main content type: Presentation with light interaction behavior.
- Safe edits here: Styling and microcopy changes preserving component contracts.
- Be careful with: Prop/state contract edits that affect many screens.
- Useful context: Use this layer for consistent visual updates across the mobile app.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { ActivityIndicator, Pressable, StyleSheet, Text, ViewStyle } from 'react-native';

type Props = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'secondary';
  style?: ViewStyle;
};

export function LargeButton({ label, onPress, disabled, loading, variant = 'primary', style }: Props) {
  const isDisabled = Boolean(disabled || loading);

  return (
    <Pressable
      style={({ pressed }) => [
        styles.button,
        variant === 'secondary' ? styles.secondary : styles.primary,
        (pressed || isDisabled) && styles.pressed,
        style
      ]}
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: Boolean(loading) }}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'secondary' ? '#0F172A' : '#FFFFFF'} />
      ) : (
        <Text style={[styles.label, variant === 'secondary' ? styles.secondaryLabel : styles.primaryLabel]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: '100%',
    minHeight: 62,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginBottom: 14
  },
  primary: {
    backgroundColor: '#0EA5E9'
  },
  secondary: {
    backgroundColor: '#E2E8F0'
  },
  label: {
    fontSize: 22,
    fontWeight: '700'
  },
  primaryLabel: {
    color: '#FFFFFF'
  },
  secondaryLabel: {
    color: '#0F172A'
  },
  pressed: {
    opacity: 0.75
  }
});
