/*
Handoff note for Mr. Smith:
- File: `mobile/src/navigation/types.ts`
- What this is: Mobile navigation contract module.
- What it does: Defines stack route typing and screen registration wiring.
- Connections: Central navigation layer consumed by all screens.
- Main content type: Navigation config + types.
- Safe edits here: Additive route docs and route additions with matching screen updates.
- Be careful with: Renaming route keys used throughout the app.
- Useful context: If navigation calls fail or mismatch params, inspect this layer first.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

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
