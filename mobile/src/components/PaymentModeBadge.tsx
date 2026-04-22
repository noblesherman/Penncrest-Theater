/*
Handoff note for Mr. Smith:
- File: `mobile/src/components/PaymentModeBadge.tsx`
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
import { TERMINAL_MOCK_MODE } from '../config';

type PaymentModeBadgeProps = {
  compact?: boolean;
};

export function PaymentModeBadge({ compact = false }: PaymentModeBadgeProps) {
  const isDemo = TERMINAL_MOCK_MODE;

  return (
    <View style={[styles.badge, isDemo ? styles.badgeDemo : styles.badgeLive, compact && styles.badgeCompact]}>
      <Text style={[styles.badgeText, compact && styles.badgeTextCompact]}>{isDemo ? 'DEMO' : 'LIVE'}</Text>
      <Text style={[styles.badgeMeta, compact && styles.badgeMetaCompact]}>
        {isDemo ? 'No real Tap to Pay charge' : 'Real Tap to Pay charges enabled'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  badgeCompact: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    gap: 6
  },
  badgeLive: {
    backgroundColor: 'rgba(22,163,74,0.2)',
    borderColor: 'rgba(134,239,172,0.9)'
  },
  badgeDemo: {
    backgroundColor: 'rgba(180,83,9,0.23)',
    borderColor: 'rgba(253,186,116,0.95)'
  },
  badgeText: {
    fontSize: 11,
    fontFamily: 'Arial',
    letterSpacing: 1,
    fontWeight: '700',
    color: '#f8fafc'
  },
  badgeTextCompact: {
    fontSize: 10
  },
  badgeMeta: {
    fontSize: 11,
    fontFamily: 'Georgia',
    color: 'rgba(248,250,252,0.9)'
  },
  badgeMetaCompact: {
    fontSize: 10
  }
});
