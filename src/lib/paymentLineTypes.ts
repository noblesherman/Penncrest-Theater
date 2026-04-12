export type PaymentLineUiStatus =
  | 'WAITING_FOR_PAYMENT'
  | 'ACTIVE_PAYMENT'
  | 'PAYMENT_SUCCESS'
  | 'PAYMENT_FAILED'
  | 'CANCELED';

export type PaymentLineDispatchStatus =
  | 'PENDING'
  | 'DELIVERED'
  | 'PROCESSING'
  | 'FAILED'
  | 'SUCCEEDED'
  | 'EXPIRED'
  | 'CANCELED';

export type PaymentLineSeatSummary = {
  id: string;
  sectionName: string;
  row: string;
  number: number;
  ticketType: string;
  priceCents: number;
  label: string;
};

export type PaymentLineEntry = {
  entryId: string;
  dispatchId: string;
  queueKey: string;
  performanceId: string;
  performanceTitle: string;
  queueSortAt: string;
  status: PaymentLineDispatchStatus;
  failureReason: string | null;
  holdExpiresAt: string;
  holdActive: boolean;
  canRetry: boolean;
  expectedAmountCents: number;
  currency: string;
  paymentIntentId: string | null;
  paymentIntentClientSecret: string | null;
  attemptCount: number;
  finalOrderId: string | null;
  targetDeviceId: string;
  targetDeviceName: string | null;
  sellerStationName: string | null;
  sellerAdminId: string | null;
  sellerClientSessionId: string | null;
  seatCount: number;
  seats: PaymentLineSeatSummary[];
  position: number | null;
  waitingCount: number;
  nowServingEntryId: string | null;
  processingStartedAt: string | null;
  processingHeartbeatAt: string | null;
  activeTimeoutAt: string | null;
  isYourTurn: boolean;
  isNext: boolean;
  uiState: PaymentLineUiStatus;
  updatedAt: string;
};

export type PaymentLineSnapshot = {
  queueKey: string;
  nowServingEntryId: string | null;
  nextUpEntryId: string | null;
  waitingCount: number;
  updatedAt: string;
  entries: PaymentLineEntry[];
};

export type PaymentLineSession = {
  sessionId: string;
  queueKey: string;
  deviceId: string;
  activeEntryId: string;
  heartbeatIntervalSeconds: number;
  activeTimeoutAt: string | null;
  startedAt: string;
};

export type PaymentLineSellerStreamPayload = {
  queueKey: string;
  snapshot: PaymentLineSnapshot | null;
  activeEntry: PaymentLineEntry | null;
  sellerEntry: PaymentLineEntry | null;
  updatedAt: string;
};

export type PaymentLineReadyEvent = {
  queueKey: string;
  heartbeatSeconds?: number;
  wallboardDefaultLimit?: number;
};

export type PaymentLineEntryUpdatedEvent = {
  entryId: string;
  position: number | null;
  waitingCount: number;
  nowServingEntryId: string | null;
  isYourTurn: boolean;
  isNext: boolean;
  uiState: PaymentLineUiStatus;
  updatedAt: string;
  status: PaymentLineDispatchStatus;
  failureReason: string | null;
};
