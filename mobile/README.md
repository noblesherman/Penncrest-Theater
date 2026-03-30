# Mobile Companion App (`/mobile`)

React Native (Expo + TypeScript) companion app for box office staff.

## Features

- Admin login (reuses backend `/api/admin/login` JWT)
- Home screen with:
  - Scan Tickets
  - Sell Tickets
- Ticket scanning via QR camera (`expo-camera`)
  - Calls `POST /api/mobile/scan/validate`
  - Shows valid / already used / invalid status
- In-person selling
  - Select performance, ticket type, quantity
  - Calls `POST /api/mobile/create-payment-intent`
- Tap to Pay flow using `@stripe/stripe-terminal-react-native`
  - Connection token provider (`POST /api/mobile/terminal/connection-token`)
  - Reader discovery (`tapToPay`)
  - `connectReader`
  - `collectPaymentMethod`
  - `confirmPaymentIntent`
  - Backend finalization (`POST /api/mobile/payment/complete`)
- Payment success screen

## Local Setup

1. Install dependencies:

```bash
npm --prefix mobile install
```

2. Configure environment:

```bash
cp mobile/.env.example mobile/.env
```

Set `EXPO_PUBLIC_API_BASE_URL` to your backend URL.
Optional legal/support URLs can also be configured:
- `EXPO_PUBLIC_PRIVACY_POLICY_URL`
- `EXPO_PUBLIC_TERMS_OF_USE_URL`
- `EXPO_PUBLIC_REFUND_POLICY_URL`
- `EXPO_PUBLIC_SUPPORT_URL`

- iOS Simulator can use `http://localhost:4000`
- Real devices must use a reachable LAN/tunnel URL (not `localhost`)

3. Start backend:

```bash
npm --prefix backend run dev
```

4. Start mobile app:

```bash
npm --prefix mobile run start
```

Then press `i` (iOS simulator), `a` (Android), or scan the QR with Expo Go.

## Tap to Pay Notes

- Real Tap to Pay requires a physical iPhone and Stripe entitlement setup.
- For device testing with Terminal, use an iOS development build:

```bash
npx expo run:ios
```

or EAS development builds, then test on real hardware.
