/*
Handoff note for Mr. Smith:
- File: `mobile/src/screens/styles.ts`
- What this is: React Native screen module.
- What it does: Implements one full mobile screen and its workflow logic.
- Connections: Registered through navigator and connected to mobile api/device/payment helpers.
- Main content type: Screen layout + user flow logic + visible operator text.
- Safe edits here: UI copy tweaks and presentational layout polish.
- Be careful with: Navigation params, async state flow, and payment/scan side effects.
- Useful context: If terminal workflows feel off, these screen files are key investigation points.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { StyleSheet } from 'react-native';

export const screenStyles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F8FAFC'
  },
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 18
  },
  title: {
    fontSize: 30,
    fontWeight: '800',
    color: '#0F172A',
    marginBottom: 12
  },
  subtitle: {
    fontSize: 17,
    color: '#334155',
    marginBottom: 16
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
    marginBottom: 14
  },
  label: {
    fontSize: 16,
    color: '#0F172A',
    fontWeight: '600',
    marginBottom: 8
  },
  value: {
    fontSize: 17,
    color: '#1E293B'
  },
  input: {
    width: '100%',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 19,
    marginBottom: 12
  },
  error: {
    color: '#B91C1C',
    fontSize: 16,
    marginBottom: 12
  },
  smallAction: {
    color: '#0369A1',
    fontSize: 16,
    fontWeight: '600'
  }
});
