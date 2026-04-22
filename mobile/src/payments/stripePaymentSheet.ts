/*
Handoff note for Mr. Smith:
- File: `mobile/src/payments/stripePaymentSheet.ts`
- What this is: Mobile payment/terminal integration module.
- What it does: Coordinates Tap to Pay / payment-sheet / terminal-specific operations.
- Connections: Connected to sell-ticket screens and backend payment endpoints.
- Main content type: Payment lifecycle logic and provider integration.
- Safe edits here: Status wording and non-breaking diagnostics.
- Be careful with: Retry/state-machine assumptions in money-moving flows.
- Useful context: If payment behavior drifts, trace ordering here before changing UI.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

type StripePaymentSheetRuntimeModule = {
  initStripe: (params: { publishableKey: string }) => Promise<void>;
  initPaymentSheet: (params: {
    merchantDisplayName: string;
    paymentIntentClientSecret: string;
    allowsDelayedPaymentMethods?: boolean;
    returnURL?: string;
  }) => Promise<{ error?: { message?: string; code?: string } }>;
  presentPaymentSheet: () => Promise<{ error?: { message?: string; code?: string } }>;
  handleURLCallback: (url: string) => Promise<boolean>;
};

let stripePaymentSheetRuntime: StripePaymentSheetRuntimeModule | null = null;

try {
  stripePaymentSheetRuntime = require('@stripe/stripe-react-native') as StripePaymentSheetRuntimeModule;
} catch {
  stripePaymentSheetRuntime = null;
}

export const stripePaymentSheet = {
  isAvailable: Boolean(stripePaymentSheetRuntime),
  initStripe: async (params: { publishableKey: string }) => {
    if (!stripePaymentSheetRuntime?.initStripe) {
      throw new Error('Stripe SDK is unavailable in this app build.');
    }
    await stripePaymentSheetRuntime.initStripe(params);
  },
  initPaymentSheet: async (params: {
    merchantDisplayName: string;
    paymentIntentClientSecret: string;
    allowsDelayedPaymentMethods?: boolean;
    returnURL?: string;
  }) => {
    if (!stripePaymentSheetRuntime?.initPaymentSheet) {
      return {
        error: {
          code: 'unavailable',
          message: 'Stripe SDK is unavailable in this app build.'
        }
      };
    }
    return stripePaymentSheetRuntime.initPaymentSheet(params);
  },
  presentPaymentSheet: async () => {
    if (!stripePaymentSheetRuntime?.presentPaymentSheet) {
      return {
        error: {
          code: 'unavailable',
          message: 'Stripe SDK is unavailable in this app build.'
        }
      };
    }
    return stripePaymentSheetRuntime.presentPaymentSheet();
  },
  handleURLCallback: async (url: string) => {
    if (!stripePaymentSheetRuntime?.handleURLCallback) {
      return false;
    }
    return stripePaymentSheetRuntime.handleURLCallback(url);
  }
};
