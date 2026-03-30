import type { PropsWithChildren } from 'react';
import { useCallback } from 'react';
import { fetchTerminalConnectionToken } from '../api/mobile';
import { useAuth } from '../auth/AuthContext';

type TerminalState = {
  isAvailable: boolean;
  isInitialized?: boolean;
  getIsInitialized?: () => boolean;
  initialize: () => Promise<{ error?: { message?: string } }>;
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

type StripeTerminalRuntimeModule = {
  StripeTerminalProvider: React.ComponentType<{
    children: React.ReactElement | React.ReactElement[];
    tokenProvider: () => Promise<string>;
    logLevel?: 'none' | 'verbose' | 'error' | 'warning';
  }>;
  useStripeTerminal: () => Omit<TerminalState, 'isAvailable'>;
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
  isAvailable: false,
  initialize: async () => unavailableError('Stripe Terminal native module is unavailable in this app build.'),
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
  return {
    ...terminal,
    isAvailable: true
  };
}
