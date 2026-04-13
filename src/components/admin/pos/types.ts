export type PosPerformanceOption = {
  id: string;
  title: string;
  startsAt: string;
  isFundraiser?: boolean;
};

export type PosTicketOption = {
  id: string;
  name: string;
  priceCents: number;
  isSynthetic?: boolean;
};

export type PosSelectionLine = {
  id: string;
  label: string;
  sectionName: string;
  row: string;
  number: number;
  seatPriceCents: number;
};

export type PosLinePricing = {
  line: PosSelectionLine;
  ticketName: string;
  priceCents: number;
};

export type PosTerminalDevice = {
  deviceId: string;
  name: string;
  lastHeartbeatAt: string;
  isBusy: boolean;
};

export type PosSaleRecapSeat = {
  id: string;
  sectionName: string;
  row: string;
  number: number;
  ticketType: string;
  priceCents: number;
};

export type PosTerminalDispatch = {
  dispatchId: string;
  status: 'PENDING' | 'DELIVERED' | 'PROCESSING' | 'FAILED' | 'SUCCEEDED' | 'EXPIRED' | 'CANCELED';
  failureReason?: string | null;
  holdExpiresAt: string;
  holdActive: boolean;
  canRetry: boolean;
  expectedAmountCents: number;
  currency: string;
  attemptCount: number;
  finalOrderId?: string | null;
  targetDeviceId: string;
  targetDeviceName?: string | null;
  seatCount: number;
  seats: PosSaleRecapSeat[];
};
