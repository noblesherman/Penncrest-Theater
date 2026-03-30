# App Store Submission Checklist

## Versioning
- [ ] Set `MARKETING_VERSION` to release version.
- [ ] Increment `CURRENT_PROJECT_VERSION` build number.
- [ ] Confirm App Store Connect version matches.

## Configuration
- [ ] `EXPO_PUBLIC_API_BASE_URL` resolves to production API.
- [ ] `EXPO_PUBLIC_TERMINAL_MOCK_MODE=false` for submission build.
- [ ] Privacy/Terms/Support URLs configured if overriding defaults.

## Xcode Archive
- [ ] Open `mobile/ios/TheaterMobile.xcworkspace`.
- [ ] Select `TheaterMobile` target + `Any iOS Device`.
- [ ] Product -> Archive.
- [ ] Validate App.
- [ ] Upload to App Store Connect.

## TestFlight Validation
- [ ] Install uploaded build from TestFlight on physical iPhone.
- [ ] Verify login with review account.
- [ ] Verify scanner permission prompt + scan flow.
- [ ] Verify ticket sale + payment completion.
- [ ] Verify Terminal Station dispatch receive/complete/retry/cancel.
- [ ] Verify Legal & Support links open.

## App Store Connect
- [ ] Populate app metadata from `APP_STORE_METADATA_DRAFT.md`.
- [ ] Upload screenshots that match real app behavior.
- [ ] Complete App Privacy questionnaire with accurate data use.
- [ ] Add review notes and active review credentials.
- [ ] Submit for review.
