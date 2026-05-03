export type PaymentLineUiError = {
  message: string;
  refreshTerminalDevices: boolean;
};

export function getPaymentLineUiError(
  err: unknown,
  fallback = 'We hit a small backstage snag while trying to start card checkout.'
): PaymentLineUiError {
  const rawMessage = err instanceof Error ? err.message.trim() : '';
  const message = rawMessage || fallback;
  const normalized = message.toLowerCase();

  if (
    normalized.includes('selected terminal is currently busy with another sale') ||
    normalized.includes('another payment is already active in this queue')
  ) {
    return {
      message: 'Selected payment phone is busy with another sale. Pick another active phone or wait a moment.',
      refreshTerminalDevices: true
    };
  }

  if (
    normalized.includes('selected terminal is offline') ||
    normalized.includes('terminal device not found') ||
    normalized.includes('terminal device is not registered')
  ) {
    return {
      message: 'Selected payment phone is no longer active. Refresh devices and choose another phone.',
      refreshTerminalDevices: true
    };
  }

  if (
    normalized.includes('this terminal dispatch has expired') ||
    normalized.includes('seat hold expired')
  ) {
    return {
      message: 'This payment request expired before the phone picked it up. Start the sale again.',
      refreshTerminalDevices: false
    };
  }

  return {
    message,
    refreshTerminalDevices: false
  };
}
