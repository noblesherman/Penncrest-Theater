# App Store Metadata Draft

## App Name
Penncrest Theater Box Office

## Subtitle
Staff Ticketing & Check-In

## Keywords
theater,tickets,box office,check-in,qr scanner,staff,events

## Promotional Text
Staff-only mobile tools for ticket scanning, walk-up sales, and in-person terminal dispatch at Penncrest Theater events.

## Description
Penncrest Theater Box Office is a staff operations app for in-person event management.

Use the app to:
- Sign in with authorized staff credentials
- Scan ticket QR codes at venue entry
- Sell walk-up tickets for active performances
- Process in-person card payments through Stripe Terminal workflows
- Handle terminal dispatch retries/cancellations when needed
- Access legal and support resources directly in app

Important:
- This app is intended for theater staff and authorized operators.
- It does not provide consumer ticket browsing or consumer account signup.

## App Review Notes
- Login is required. Provide active review credentials for a `BOX_OFFICE` role account.
- If the review account uses 2FA, include clear OTP instructions in this section before submission.
- Main flow to test:
  1. Sign in
  2. Sell Tickets -> Create Payment
  3. Tap to Pay -> Complete Payment
  4. Scan Tickets -> Validate QR
  5. Legal & Support -> Open policy/support links
- Hardware requirement: iPhone with Stripe Terminal/Tap to Pay setup for live terminal testing.

## Privacy Policy URL
https://www.penncresttheater.org

## Support URL
mailto:boxoffice@penncresttheater.org
