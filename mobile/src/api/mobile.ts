import { apiRequest } from './client';

export type PerformanceSummary = {
  id: string;
  title: string;
  startsAt: string;
  venue: string;
  salesOpen: boolean;
};

export type PerformanceDetail = {
  id: string;
  title: string;
  startsAt: string;
  pricingTiers: Array<{
    id: string;
    name: string;
    priceCents: number;
  }>;
};

export type CreatePaymentIntentResponse = {
  paymentIntentId: string;
  clientSecret: string;
  amountTotalCents: number;
  currency: string;
  performance: {
    id: string;
    title: string;
    startsAt: string;
  };
  ticketType: {
    id: string;
    name: string;
    unitPriceCents: number;
  };
  quantity: number;
  holdToken: string;
  holdExpiresAt: string;
  seats: Array<{
    id: string;
    label: string;
    sectionName: string;
    row: string;
    number: number;
    priceCents: number;
  }>;
};

export type PaymentCompleteResponse = {
  success?: boolean;
  alreadyCompleted?: boolean;
  mockApproved?: boolean;
  orderId?: string;
  paymentIntentId?: string;
  amountReceivedCents?: number;
  currency?: string;
  ticketsIssued?: number;
  seats?: Array<{ id: string; label: string }>;
  order?: {
    id: string;
    status: string;
    amountTotal: number;
    performanceId: string;
    performanceTitle: string;
  };
};

export type ScanValidateResponse = {
  status: 'valid' | 'already_used' | 'invalid';
  message: string;
  ticket?: {
    id: string;
    publicId: string;
    performanceTitle?: string;
    seat?: string;
    checkedInAt?: string;
  };
};

export type AdminScannerPerformance = {
  id: string;
  title: string;
  startsAt: string;
  isArchived?: boolean;
};

export type AdminScannerSession = {
  sessionId: string;
  sessionToken: string;
  performanceId: string;
  staffName: string;
  gate: string;
  deviceLabel: string | null;
  createdAt: string;
};

export type AdminScannerOutcome =
  | 'VALID'
  | 'ALREADY_CHECKED_IN'
  | 'WRONG_PERFORMANCE'
  | 'NOT_ADMITTED'
  | 'INVALID_QR'
  | 'NOT_FOUND';

export type AdminScannedTicket = {
  id: string;
  publicId: string;
  performanceId: string;
  performanceTitle: string;
  startsAt: string;
  venue: string;
  seat: {
    sectionName: string;
    row: string;
    number: number;
  };
  holder: {
    customerName: string;
    customerEmail: string;
  };
  order: {
    id: string;
    status: string;
  };
  checkedInAt: string | null;
  checkedInBy: string | null;
  checkInGate: string | null;
  admissionDecision: 'FORCE_ADMIT' | 'DENY' | null;
  admissionReason: string | null;
};

export type AdminScannerScanResponse = {
  outcome: AdminScannerOutcome;
  message: string;
  scannedAt: string;
  ticket?: AdminScannedTicket;
};

export type AdminScannerLookupResult = AdminScannedTicket & {
  ticketStatus: string;
  ticketType: string;
  createdAt: string;
};

export type TerminalDeviceSession = {
  deviceId: string;
  terminalName: string;
  lastHeartbeatAt: string;
};

export type TerminalIncomingDispatch = {
  dispatchId: string;
  status: 'DELIVERED' | 'PENDING' | 'PROCESSING' | 'FAILED' | 'SUCCEEDED' | 'EXPIRED' | 'CANCELED';
  paymentIntentId: string;
  paymentIntentClientSecret: string;
  expectedAmountCents: number;
  currency: string;
  holdExpiresAt: string;
  performanceId: string;
  performanceTitle: string;
  seats: Array<{
    id: string;
    label: string;
    ticketType: string;
    priceCents: number;
  }>;
};

export type TerminalManualPaymentIntent = {
  paymentIntentId: string;
  clientSecret: string;
  publishableKey: string;
};

export type MobileStartupPreflight = {
  status: 'ok' | 'degraded';
  apiReachable: boolean;
  requiredRoutes: {
    terminalConnectionToken: boolean;
    terminalDeviceRegister: boolean;
    terminalDispatchNext: boolean;
    terminalDispatchStatus: boolean;
    terminalDispatchComplete: boolean;
    terminalDispatchTelemetry: boolean;
    dispatchRetry: boolean;
    dispatchCancel: boolean;
  };
  stripe: {
    terminalSecretKeyConfigured: boolean;
    publishableKeyConfigured: boolean;
  };
};

export type TerminalDispatchAdminState = {
  dispatchId: string;
  status: 'DELIVERED' | 'PENDING' | 'PROCESSING' | 'FAILED' | 'SUCCEEDED' | 'EXPIRED' | 'CANCELED';
  failureReason: string | null;
  holdExpiresAt: string;
  holdActive: boolean;
  canRetry: boolean;
  expectedAmountCents: number;
  currency: string;
  attemptCount: number;
  finalOrderId: string | null;
  targetDeviceId: string;
  targetDeviceName: string | null;
  seatCount: number;
  seats: Array<{
    id: string;
    sectionName: string;
    row: string;
    number: number;
    ticketType: string;
    priceCents: number;
  }>;
};

export async function getPerformances(token: string): Promise<PerformanceSummary[]> {
  return apiRequest<PerformanceSummary[]>('/api/performances', { token });
}

export async function getStartupPreflight(): Promise<MobileStartupPreflight> {
  return apiRequest<MobileStartupPreflight>('/api/mobile/preflight');
}

export async function getPerformanceDetails(token: string, performanceId: string): Promise<PerformanceDetail> {
  return apiRequest<PerformanceDetail>(`/api/performances/${encodeURIComponent(performanceId)}`, { token });
}

export async function createPaymentIntent(
  token: string,
  payload: {
    performanceId: string;
    pricingTierId: string;
    quantity: number;
    customerName?: string;
    receiptEmail?: string;
  }
): Promise<CreatePaymentIntentResponse> {
  return apiRequest<CreatePaymentIntentResponse>('/api/mobile/create-payment-intent', {
    method: 'POST',
    token,
    body: payload
  });
}

export async function completePayment(
  token: string,
  paymentIntentId: string,
  options?: { mockApproved?: boolean }
): Promise<PaymentCompleteResponse> {
  return apiRequest<PaymentCompleteResponse>('/api/mobile/payment/complete', {
    method: 'POST',
    token,
    body: { paymentIntentId, mockApproved: options?.mockApproved }
  });
}

export async function fetchTerminalConnectionToken(token: string): Promise<string> {
  const result = await apiRequest<{ secret: string }>('/api/mobile/terminal/connection-token', {
    method: 'POST',
    token
  });
  return result.secret;
}

export async function validateScan(
  token: string,
  payload: {
    scannedCode: string;
    performanceId?: string;
    gate?: string;
  }
): Promise<ScanValidateResponse> {
  return apiRequest<ScanValidateResponse>('/api/mobile/scan/validate', {
    method: 'POST',
    token,
    body: payload
  });
}

export async function fetchAdminScannerPerformances(token: string): Promise<AdminScannerPerformance[]> {
  return apiRequest<AdminScannerPerformance[]>('/api/admin/performances?scope=active', { token });
}

export async function startAdminScannerSession(
  token: string,
  payload: { performanceId: string; staffName: string; gate: string; deviceLabel?: string }
): Promise<AdminScannerSession> {
  return apiRequest<AdminScannerSession>('/api/admin/check-in/session/start', {
    method: 'POST',
    token,
    body: payload
  });
}

export async function endAdminScannerSession(token: string, sessionToken: string): Promise<{ success: boolean }> {
  return apiRequest<{ success: boolean }>('/api/admin/check-in/session/end', {
    method: 'POST',
    token,
    body: { sessionToken }
  });
}

export async function submitAdminScannerScan(
  token: string,
  payload: {
    performanceId: string;
    sessionToken: string;
    scannedValue: string;
    clientScanId: string;
    offlineQueuedAt?: string;
  }
): Promise<AdminScannerScanResponse> {
  return apiRequest<AdminScannerScanResponse>('/api/admin/check-in/scan', {
    method: 'POST',
    token,
    body: payload
  });
}

export async function lookupAdminScannerTickets(
  token: string,
  payload: { performanceId: string; query: string; limit?: number }
): Promise<AdminScannerLookupResult[]> {
  const q = encodeURIComponent(payload.query.trim());
  const limit = payload.limit ?? 8;
  return apiRequest<AdminScannerLookupResult[]>(
    `/api/admin/check-in/lookup?performanceId=${encodeURIComponent(payload.performanceId)}&q=${q}&limit=${limit}`,
    { token }
  );
}

export async function registerTerminalDevice(
  token: string,
  payload: { deviceId: string; terminalName: string }
): Promise<TerminalDeviceSession> {
  return apiRequest<TerminalDeviceSession>('/api/mobile/terminal/device/register', {
    method: 'POST',
    token,
    body: payload
  });
}

export async function sendTerminalHeartbeat(token: string, deviceId: string): Promise<void> {
  await apiRequest<{ ok: boolean }>('/api/mobile/terminal/device/heartbeat', {
    method: 'POST',
    token,
    body: { deviceId }
  });
}

export async function fetchNextTerminalDispatch(
  token: string,
  payload: { deviceId: string; waitMs?: number }
): Promise<TerminalIncomingDispatch | null> {
  const response = await apiRequest<{ dispatch: TerminalIncomingDispatch | null }>('/api/mobile/terminal/dispatch/next', {
    method: 'POST',
    token,
    body: payload
  });
  return response.dispatch;
}

export async function updateTerminalDispatchStatus(
  token: string,
  payload: {
    dispatchId: string;
    deviceId: string;
    status: 'PROCESSING' | 'FAILED';
    failureReason?: string;
  }
): Promise<void> {
  await apiRequest<{ status: string }>(`/api/mobile/terminal/dispatch/${encodeURIComponent(payload.dispatchId)}/status`, {
    method: 'POST',
    token,
    body: {
      deviceId: payload.deviceId,
      status: payload.status,
      failureReason: payload.failureReason
    }
  });
}

export async function completeTerminalDispatch(
  token: string,
  payload: { dispatchId: string; deviceId: string; mockApproved?: boolean; paymentIntentId?: string }
): Promise<{ success: boolean; alreadyCompleted?: boolean; orderId?: string; mockApproved?: boolean }> {
  return apiRequest<{ success: boolean; alreadyCompleted?: boolean; orderId?: string; mockApproved?: boolean }>(
    `/api/mobile/terminal/dispatch/${encodeURIComponent(payload.dispatchId)}/complete`,
    {
      method: 'POST',
      token,
      body: { deviceId: payload.deviceId, mockApproved: payload.mockApproved, paymentIntentId: payload.paymentIntentId }
    }
  );
}

export async function createTerminalDispatchManualPaymentIntent(
  token: string,
  payload: { dispatchId: string; deviceId: string }
): Promise<TerminalManualPaymentIntent> {
  return apiRequest<TerminalManualPaymentIntent>(
    `/api/mobile/terminal/dispatch/${encodeURIComponent(payload.dispatchId)}/manual-payment-intent`,
    {
      method: 'POST',
      token,
      body: { deviceId: payload.deviceId }
    }
  );
}

export async function retryTerminalDispatch(token: string, dispatchId: string): Promise<TerminalDispatchAdminState> {
  return apiRequest<TerminalDispatchAdminState>(`/api/admin/orders/in-person/terminal/dispatch/${encodeURIComponent(dispatchId)}/retry`, {
    method: 'POST',
    token
  });
}

export async function cancelTerminalDispatch(token: string, dispatchId: string): Promise<TerminalDispatchAdminState> {
  return apiRequest<TerminalDispatchAdminState>(`/api/admin/orders/in-person/terminal/dispatch/${encodeURIComponent(dispatchId)}/cancel`, {
    method: 'POST',
    token
  });
}

export async function fetchTerminalDispatchAdminState(token: string, dispatchId: string): Promise<TerminalDispatchAdminState> {
  return apiRequest<TerminalDispatchAdminState>(`/api/admin/orders/in-person/terminal/dispatch/${encodeURIComponent(dispatchId)}`, {
    token
  });
}

export async function sendTerminalDispatchTelemetry(
  token: string,
  payload: {
    dispatchId: string;
    deviceId: string;
    stage: string;
    paymentMethod?: 'TAP_TO_PAY' | 'MANUAL' | 'UNKNOWN';
    paymentIntentId?: string;
    failureReason?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await apiRequest<{ ok: boolean }>(`/api/mobile/terminal/dispatch/${encodeURIComponent(payload.dispatchId)}/telemetry`, {
    method: 'POST',
    token,
    body: {
      deviceId: payload.deviceId,
      stage: payload.stage,
      paymentMethod: payload.paymentMethod,
      paymentIntentId: payload.paymentIntentId,
      failureReason: payload.failureReason,
      metadata: payload.metadata
    }
  });
}
