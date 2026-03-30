# App Review Checklist (iOS)

## Build + Signing
- [ ] `mobile/ios/TheaterMobile` builds in `Release` with no errors.
- [ ] `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` are incremented for this submission.
- [ ] Distribution certificate and provisioning profile are valid for the selected bundle identifier.
- [ ] Archive validates in Xcode Organizer with no blocking errors.

## Compliance + Product Readiness
- [ ] No placeholder UI, no fake buttons, and no visible TODO/debug copy in production screens.
- [ ] Startup preflight does not hard-block reviewer access; sign-in is reachable even when checks fail.
- [ ] App shows real staff terminal functionality (scan, sell, terminal station, legal/support).
- [ ] No staging/localhost endpoints are used in release runtime paths.

## Privacy + Permissions
- [ ] Only camera permission is requested.
- [ ] `NSCameraUsageDescription` clearly explains the ticket-scanning use case.
- [ ] No microphone permission key is present in iOS `Info.plist`.
- [ ] App Privacy answers in App Store Connect match actual collection/use.

## Payments + Business Model
- [ ] App handles physical-world event ticket sales only (no digital unlocks requiring IAP).
- [ ] Live mode never auto-converts failed terminal reads into mock approvals.
- [ ] Stripe Terminal + manual card entry are tested on production-distributed iPhone build.

## Auth + Account Policy
- [ ] Review account credentials are active and tested.
- [ ] 2FA expectations are documented in reviewer notes.
- [ ] No in-app consumer account creation flow (account deletion requirement is not triggered).

## Legal + Support
- [ ] Privacy Policy link opens.
- [ ] Terms of Use link opens.
- [ ] Support contact link opens.

## Final QA
- [ ] First launch does not crash.
- [ ] Login succeeds with review credentials.
- [ ] Scan flow handles granted/denied camera permission states.
- [ ] Sell flow can create and complete a payment in live setup.
- [ ] Terminal station can register, receive dispatch, and complete/cancel/retry cleanly.
