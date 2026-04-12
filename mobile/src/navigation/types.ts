import type { CreatePaymentIntentResponse } from '../api/mobile';

export type RootStackParamList = {
  Login: undefined;
  Legal: undefined;
  Home: undefined;
  Maintenance: undefined;
  TerminalStation: undefined;
  ScanTickets: undefined;
  SellTickets: undefined;
  TapToPay: {
    sale: CreatePaymentIntentResponse;
  };
  Success: {
    orderId?: string;
  };
};
