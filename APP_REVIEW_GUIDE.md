# App Review Guide (Theater Mobile iOS)

## App Scope
The app is a staff-only companion for in-person theater operations:
- Staff authentication
- Ticket QR scanning at venue entry
- Walk-up ticket sales
- Stripe Terminal station flow for dispatched in-person payments

## Sign In
- Login is required.
- Use a reviewer account provisioned in backend admin users (`BOX_OFFICE` role minimum).
- If 2FA is enabled for the review account, include the active test OTP method/code process in App Store Connect review notes.

## Main Reviewer Flow
1. Launch app and continue through startup preflight.
2. Sign in with review credentials.
3. Open `Sell Tickets`, select performance/tier/quantity, create payment.
4. Open `Tap to Pay` and complete payment with configured Stripe test/live reader setup.
5. Open `Scan Tickets` and scan issued ticket QR to verify valid/already-used handling.
6. Open `Legal & Support` to review privacy/terms/support links.

## Terminal Station Flow
1. Open `Terminal Station`.
2. Confirm device registers successfully.
3. Trigger an in-person terminal dispatch from admin web interface.
4. Verify terminal receives dispatch and completes payment path.
5. Verify operator controls for retry/cancel on failed dispatch.

## Required Hardware / Environment
- Real iPhone with production-distributed build.
- Stripe Terminal/Tap to Pay entitlement + Stripe account setup.
- Reachable production API at `https://api.penncresttheater.com`.

## Notes for Reviewer
- This app does not sell digital content; it processes physical event ticket sales.
- No consumer social login providers are used.
- No public account creation flow exists in app.
