import type { PropsWithChildren } from 'react';
import { useCallback } from 'react';
import { Platform } from 'react-native';
import { fetchTerminalConnectionToken } from '../api/mobile';
import { useAuth } from '../auth/AuthContext';
import { TAP_TO_PAY_DISPLAY_NAME, TAP_TO_PAY_PLATFORM, type TapToPayPlatform } from './tapToPay';

type TerminalState = {
  platform: TapToPayPlatform;
  tapToPayDisplayName: string;
  isAvailable: boolean;
  isInitialized?: boolean;
  getIsInitialized?: () => boolean;
  initialize: () => Promise<{ error?: { message?: string } }>;
  requestRequiredPermissions: () => Promise<{ error?: { message?: string } }>;
  discoverReaders: (params: { discoveryMethod: 'tapToPay'; simulated?: boolean }) => Promise<{ error?: { message?: string } }>;
  easyConnect?: (params: {
    discoveryMethod: 'tapToPay';
    simulated?: boolean;
    locationId: string;
    autoReconnectOnUnexpectedDisconnect?: boolean;
  }) => Promise<{ reader?: unknown; error?: { message?: string } }>;
  connectReader: (params: {
    discoveryMethod: 'tapToPay';
    reader: unknown;
    locationId: string;
    autoReconnectOnUnexpectedDisconnect?: boolean;
  }) => Promise<{ reader?: unknown; error?: { message?: string } }>;
  getConnectedReader?: () => Promise<unknown>;
  getLocations: (params: { limit?: number }) => Promise<{ locations?: Array<{ id: string; displayName?: string }>; error?: { message?: string } }>;
  retrievePaymentIntent: (clientSecret: string) => Promise<{ paymentIntent?: unknown; error?: { message?: string } }>;
  collectPaymentMethod: (params: { paymentIntent: unknown }) => Promise<{ paymentIntent?: unknown; error?: { message?: string } }>;
  confirmPaymentIntent: (params: { paymentIntent: unknown }) => Promise<{ paymentIntent?: unknown; error?: { message?: string } }>;
  discoveredReaders: unknown[];
  connectedReader?: unknown | null;
};

type TerminalSdkState = Omit<TerminalState, 'isAvailable' | 'platform' | 'tapToPayDisplayName' | 'requestRequiredPermissions'>;

type StripeTerminalRuntimeModule = {
  StripeTerminalProvider: React.ComponentType<{
    children: React.ReactElement | React.ReactElement[];
    tokenProvider: () => Promise<string>;
    logLevel?: 'none' | 'verbose' | 'error' | 'warning';
  }>;
  useStripeTerminal: () => TerminalSdkState;
  requestNeededAndroidPermissions?: () => Promise<{ error: Record<string, string> | null }>;
};

let stripeTerminalModule: StripeTerminalRuntimeModule | null = null;

try {
  stripeTerminalModule = require('@stripe/stripe-terminal-react-native') as StripeTerminalRuntimeModule;
} catch {
  stripeTerminalModule = null;
}

function unavailableError(message: string) {
  return { error: { message } };
}

const fallbackTerminalState: TerminalState = {
  platform: TAP_TO_PAY_PLATFORM,
  tapToPayDisplayName: TAP_TO_PAY_DISPLAY_NAME,
  isAvailable: false,
  initialize: async () => unavailableError('Stripe Terminal native module is unavailable in this app build.'),
  requestRequiredPermissions: async () => ({}),
  discoverReaders: async () => unavailableError('Stripe Terminal native module is unavailable in this app build.'),
  connectReader: async () => unavailableError('Stripe Terminal native module is unavailable in this app build.'),
  getLocations: async () => unavailableError('Stripe Terminal native module is unavailable in this app build.'),
  retrievePaymentIntent: async () => unavailableError('Stripe Terminal native module is unavailable in this app build.'),
  collectPaymentMethod: async () => unavailableError('Stripe Terminal native module is unavailable in this app build.'),
  confirmPaymentIntent: async () => unavailableError('Stripe Terminal native module is unavailable in this app build.'),
  discoveredReaders: [],
  connectedReader: null
};

export function TerminalProvider({ children }: PropsWithChildren) {
  const { token } = useAuth();

  const tokenProvider = useCallback(async () => {
    if (!token) {
      throw new Error('Not authenticated');
    }

    return fetchTerminalConnectionToken(token);
  }, [token]);

  if (!stripeTerminalModule?.StripeTerminalProvider) {
    return <>{children}</>;
  }

  const Provider = stripeTerminalModule.StripeTerminalProvider;
  const logLevel: 'none' | 'verbose' | 'error' | 'warning' = __DEV__ ? 'verbose' : 'error';
  return (
    <Provider tokenProvider={tokenProvider} logLevel={logLevel}>
      {children as React.ReactElement}
    </Provider>
  );
}

export function useTerminal(): TerminalState {
  if (!stripeTerminalModule?.useStripeTerminal) {
    return fallbackTerminalState;
  }

  const terminal = stripeTerminalModule.useStripeTerminal();

  const requestRequiredPermissions = async () => {
    if (Platform.OS !== 'android' || !stripeTerminalModule?.requestNeededAndroidPermissions) {
      return {};
    }

    const result = await stripeTerminalModule.requestNeededAndroidPermissions();
    if (!result.error) {
      return {};
    }

    const deniedPermissions = Object.keys(result.error)
      .map((permission) => permission.split('.').pop() || permission)
      .join(', ');

    return {
      error: {
        message: deniedPermissions
          ? `Required Android permissions were denied: ${deniedPermissions}.`
          : 'Required Android permissions were denied.'
      }
    };
  };

  return {
    platform: TAP_TO_PAY_PLATFORM,
    tapToPayDisplayName: TAP_TO_PAY_DISPLAY_NAME,
    ...terminal,
    isAvailable: true,
    requestRequiredPermissions
  };
}
