/*
Handoff note for Mr. Smith:
- File: `mobile/src/terminal/tapToPay.ts`
- What this is: Mobile payment/terminal integration module.
- What it does: Coordinates Tap to Pay / payment-sheet / terminal-specific operations.
- Connections: Connected to sell-ticket screens and backend payment endpoints.
- Main content type: Payment lifecycle logic and provider integration.
- Safe edits here: Status wording and non-breaking diagnostics.
- Be careful with: Retry/state-machine assumptions in money-moving flows.
- Useful context: If payment behavior drifts, trace ordering here before changing UI.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { Platform } from 'react-native';

export type TapToPayPlatform = 'ios' | 'android' | 'unsupported';

export const TAP_TO_PAY_PLATFORM: TapToPayPlatform =
  Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'unsupported';

export const TAP_TO_PAY_DISPLAY_NAME =
  TAP_TO_PAY_PLATFORM === 'ios'
    ? 'Tap to Pay on iPhone'
    : TAP_TO_PAY_PLATFORM === 'android'
      ? 'Tap to Pay on Android'
      : 'Tap to Pay';

export const TAP_TO_PAY_DEVICE_LABEL =
  TAP_TO_PAY_PLATFORM === 'ios'
    ? 'the top of this iPhone'
    : TAP_TO_PAY_PLATFORM === 'android'
      ? 'the NFC area on this Android device'
      : 'this device';

export const TAP_TO_PAY_BUILD_HINT =
  TAP_TO_PAY_PLATFORM === 'ios'
    ? 'Use a custom iOS build with Stripe Terminal enabled. Expo Go cannot load Tap to Pay.'
    : TAP_TO_PAY_PLATFORM === 'android'
      ? 'Use a custom Android build on a supported NFC phone. Expo Go cannot load Tap to Pay.'
      : 'Use a native build with Stripe Terminal enabled. Expo Go cannot load Tap to Pay.';

export const TAP_TO_PAY_LIVE_SETUP_HINT =
  TAP_TO_PAY_PLATFORM === 'ios'
    ? 'Apple Tap to Pay entitlement provisioning is still required before live iPhone payments can succeed.'
    : TAP_TO_PAY_PLATFORM === 'android'
      ? 'A supported Android NFC device and Stripe Terminal-enabled account are still required for live payments.'
      : 'Supported device and Stripe Terminal account setup are still required for live payments.';

export const TAP_TO_PAY_PERMISSION_HINT =
  TAP_TO_PAY_PLATFORM === 'android'
    ? 'Allow location and nearby device permissions so Stripe Terminal can discover and run Tap to Pay on Android.'
    : null;
