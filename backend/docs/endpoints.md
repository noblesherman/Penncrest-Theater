# Theater API Endpoints

Base URL examples:
- Local backend: `http://localhost:4000`
- All routes shown include `/api/...`

## Public

### `GET /health`
Lightweight liveness probe.

Response:
```json
{
  "status": "ok"
}
```

### `GET /health/live`
Alias for `/health` liveness.

### `GET /api/health/ready`
Lightweight readiness probe (database ping + dependency configuration summary).

### `GET /api/health`
Public liveness alias.

### `GET /health/diag` (Diagnostics, Admin)
Heavy diagnostics snapshot. Protected by admin auth. Expensive sections are cached for `HEALTH_DIAGNOSTICS_CACHE_TTL_SECONDS` (default 10s).

### `GET /api/health/diagnostics` (Diagnostics alias, Admin)
Protected alias for diagnostics (`/health/diag`).

Response:
```json
{
  "status": "degraded",
  "observedAt": "2026-04-10T02:18:11.913Z",
  "responseTimeMs": 57,
  "degradationReasons": ["queue_lag_high", "recent_errors_detected"],
  "service": {
    "environment": "production",
    "uptimeSeconds": 34812,
    "startedAt": "2026-04-09T16:37:59.000Z",
    "pid": 42811,
    "nodeVersion": "v22.14.0",
    "platform": "darwin",
    "arch": "arm64",
    "timezone": "America/New_York"
  },
  "dependencies": {
    "database": {
      "status": "ok",
      "latencyMs": 12,
      "schemaReady": true,
      "clockSkewMs": 1,
      "name": "theater"
    },
    "stripe": {
      "status": "configured",
      "mode": "live",
      "publishableKeyConfigured": true,
      "webhookSecretConfigured": true
    },
    "email": { "status": "configured", "transport": "smtp" },
    "storage": {
      "status": "configured",
      "provider": "cloudflare_r2",
      "maxUploadBytes": 8388608
    },
    "oauth": { "google": "configured", "microsoft": "configured" }
  },
  "queue": {
    "waitingCount": 45,
    "processingCount": 3,
    "lagSeconds": 12,
    "oldestWaitingAgeSeconds": 12,
    "readyCountLastFiveMinutes": 28,
    "failedCountLastFiveMinutes": 4,
    "byStatus": {
      "WAITING": 45,
      "PROCESSING": 3,
      "READY": 214,
      "FAILED": 5,
      "EXPIRED": 1,
      "CANCELED": 0
    },
    "capacity": {
      "maxActive": 30,
      "utilizationPercent": 10,
      "stuckProcessingCount": 0
    },
    "retry": {
      "retryReadyCount": 42,
      "retryScheduledCount": 3
    },
    "config": {
      "maxWaitSeconds": 480,
      "pollMinMs": 1500,
      "pollMaxMs": 4000
    }
  },
  "throughput": {
    "successfulCheckoutsLastMinute": 3,
    "successfulCheckoutsLastFiveMinutes": 12,
    "successfulCheckoutsLastFifteenMinutes": 31,
    "queueReadyLastFiveMinutes": 28,
    "queueFailuresLastFiveMinutes": 4
  },
  "orders": {
    "byStatus": {
      "PENDING": 9,
      "PAID": 1262,
      "FINALIZATION_FAILED": 2,
      "REFUNDED": 14,
      "CANCELED": 8
    },
    "paidLast24Hours": 219,
    "refundedLast24Hours": 1,
    "finalizationFailedLast24Hours": 0
  },
  "holds": {
    "activeCount": 51,
    "expiringWithinTwoMinutes": 7,
    "staleActiveCount": 0,
    "byStatus": {
      "ACTIVE": 51,
      "EXPIRED": 318,
      "CONVERTED": 1191,
      "CANCELED": 12
    },
    "config": {
      "holdTtlMinutes": 10,
      "cleanupIntervalSeconds": 60
    }
  },
  "webhooks": {
    "byStatus": {
      "PROCESSING": 0,
      "PROCESSED": 784,
      "FAILED": 2
    },
    "failedLastMinute": 0,
    "processedLastFiveMinutes": 3
  },
  "errorsLastMinute": 0,
  "seats": {
    "total": 1760,
    "soldPercent": 64.2,
    "byStatus": {
      "AVAILABLE": 580,
      "HELD": 50,
      "SOLD": 1130,
      "BLOCKED": 0
    }
  },
  "system": {
    "memoryUsageMb": 280,
    "heapUsedMb": 166,
    "heapTotalMb": 212,
    "externalMemoryMb": 12,
    "freeMemoryMb": 10541,
    "totalMemoryMb": 16384,
    "cpuPercent": 65,
    "loadAverage1m": 5.2,
    "loadAverage5m": 4.8,
    "loadAverage15m": 4.1
  },
  "lastSuccessfulCheckout": {
    "at": "2026-04-10T02:17:53.000Z",
    "secondsAgo": 18,
    "amountCents": 3600,
    "currency": "usd",
    "source": "ONLINE"
  },
  "lastSuccessfulCheckoutSecondsAgo": 18
}
```

### `GET /api/performances`
Response:
```json
[
  {
    "id": "perf_123",
    "title": "Little Shop of Horrors",
    "startsAt": "2026-03-20T23:00:00.000Z",
    "venue": "Penncrest High School Auditorium",
    "show": { "id": "show_1", "title": "Little Shop of Horrors" },
    "minPrice": 1800,
    "maxPrice": 2200,
    "availableSeats": 240
  }
]
```

### `GET /api/performances/:id`
Response:
```json
{
  "id": "perf_123",
  "title": "Little Shop of Horrors",
  "startsAt": "2026-03-20T23:00:00.000Z",
  "venue": "Penncrest High School Auditorium",
  "show": {
    "id": "show_1",
    "title": "Little Shop of Horrors",
    "description": "A dark comedy musical"
  },
  "pricingTiers": [
    { "id": "tier_1", "name": "Adult", "priceCents": 1800 }
  ],
  "seatingSections": [
    { "sectionName": "Orchestra", "totalSeats": 240, "availableSeats": 220, "minPrice": 1800, "maxPrice": 2200 }
  ]
}
```

### `GET /api/performances/:performanceId/seats`
Response:
```json
[
  {
    "id": "seat_1",
    "row": "A",
    "number": 1,
    "x": 40,
    "y": 120,
    "status": "available",
    "isAccessible": true,
    "sectionName": "Orchestra",
    "price": 2200
  }
]
```

### `POST /api/hold`
Request:
```json
{
  "performanceId": "perf_123",
  "seatIds": ["seat_1", "seat_2"],
  "clientToken": "session_token_abc"
}
```
Response:
```json
{
  "holdToken": "hold_token_abc",
  "expiresAt": "2026-03-02T18:15:00.000Z",
  "heldSeatIds": ["seat_1", "seat_2"]
}
```

### `POST /api/checkout`
Request:
```json
{
  "performanceId": "perf_123",
  "seatIds": ["seat_1", "seat_2"],
  "holdToken": "hold_token_abc",
  "clientToken": "session_token_abc",
  "customerEmail": "buyer@example.com",
  "customerName": "Jordan Taylor",
  "attendeeNames": {
    "seat_1": "Jordan Taylor",
    "seat_2": "Alex Taylor"
  }
}
```
Paid checkout response (queue entry):
```json
{
  "status": "QUEUED",
  "queueId": "cq_123",
  "position": 12,
  "estimatedWaitSeconds": 35,
  "refreshAfterMs": 2000
}
```

Complimentary / no-payment response:
```json
{
  "orderId": "order_123",
  "orderAccessToken": "access_token_abc",
  "clientSecret": "pi_123_secret_abc",
  "publishableKey": "pk_live_..."
}
```

### `GET /api/checkout/queue/:queueId?holdToken=...&clientToken=...`
Queue status for checkout wait screen.

`WAITING` response:
```json
{
  "status": "WAITING",
  "queueId": "cq_123",
  "position": 8,
  "estimatedWaitSeconds": 24,
  "refreshAfterMs": 1800
}
```

`READY` response:
```json
{
  "status": "READY",
  "queueId": "cq_123",
  "orderId": "order_123",
  "orderAccessToken": "access_token_abc",
  "clientSecret": "pi_123_secret_abc",
  "publishableKey": "pk_live_...",
  "mode": "PAID"
}
```

Terminal response:
```json
{
  "status": "FAILED",
  "queueId": "cq_123",
  "reason": "QUEUE_TIMEOUT",
  "message": "Checkout wait time expired. Please reselect your seats and try again."
}
```

### `POST /api/fundraising/donations/intent`
Request:
```json
{
  "amountCents": 1000,
  "donorName": "Jamie Rivera",
  "donorEmail": "jamie@example.com"
}
```
Response:
```json
{
  "paymentIntentId": "pi_123",
  "clientSecret": "pi_123_secret_abc",
  "publishableKey": "pk_live_...",
  "amountCents": 1000,
  "currency": "usd"
}
```
Notes:
- `donorEmail` is sent to Stripe as `receipt_email` for payment receipts.
- Successful donations trigger a thank-you email (SMTP must be configured).

### `POST /api/webhooks/stripe`
Stripe sends events to this endpoint with raw body signature verification.

Handled events:
- `checkout.session.completed`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `charge.refunded`

Success response:
```json
{ "received": true }
```

### `GET /api/orders/:orderId`
Response:
```json
{
  "order": {
    "id": "order_123",
    "status": "PAID",
    "email": "buyer@example.com",
    "customerName": "Jordan Taylor",
    "amountTotal": 3600,
    "currency": "usd"
  },
  "performance": {
    "id": "perf_123",
    "showTitle": "Little Shop of Horrors",
    "startsAt": "2026-03-20T23:00:00.000Z",
    "venue": "Penncrest High School Auditorium"
  },
  "tickets": [
    {
      "publicId": "9f2da1f9e6bf",
      "sectionName": "Orchestra",
      "row": "A",
      "number": 1,
      "attendeeName": "Jordan Taylor",
      "qrPayload": "ticket_id.signature"
    }
  ]
}
```

### `POST /api/orders/lookup`
Request:
```json
{ "orderId": "order_123", "email": "buyer@example.com" }
```
Response: same structure as `GET /api/orders/:orderId`

### `GET /api/tickets/:publicId`
Response:
```json
{
  "id": "ticket_uuid",
  "publicId": "9f2da1f9e6bf",
  "qrPayload": "ticket_id.signature",
  "performance": {
    "showTitle": "Little Shop of Horrors",
    "startsAt": "2026-03-20T23:00:00.000Z",
    "venue": "Penncrest High School Auditorium"
  },
  "seat": { "sectionName": "Orchestra", "row": "A", "number": 1 },
  "holder": {
    "customerName": "Jordan Taylor",
    "customerEmail": "buyer@example.com",
    "attendeeName": "Jordan Taylor"
  }
}
```

## Mobile Box Office

All mobile routes require admin JWT:
- `Authorization: Bearer <admin_token>`

### `POST /api/mobile/scan/validate`
Request:
```json
{
  "scannedCode": "ticket_id.signature_or_public_id",
  "performanceId": "perf_123",
  "gate": "MOBILE"
}
```
Response:
```json
{
  "status": "valid",
  "message": "Ticket accepted"
}
```
Status values:
- `valid`
- `already_used`
- `invalid`

### `POST /api/mobile/terminal/connection-token`
Creates a Stripe Terminal connection token for the mobile app.

Response:
```json
{
  "secret": "pst_test_..."
}
```

### `POST /api/mobile/create-payment-intent`
Request:
```json
{
  "performanceId": "perf_123",
  "pricingTierId": "tier_1",
  "quantity": 2,
  "customerName": "Walk-in Guest",
  "receiptEmail": "guest@example.com"
}
```
Response includes:
- `paymentIntentId`
- `clientSecret`
- assigned seat list
- hold token and expiry
- amount total

### `POST /api/mobile/payment/complete`
Finalizes paid in-person order after Terminal confirms payment.

Request:
```json
{
  "paymentIntentId": "pi_123"
}
```
Response includes:
- `success` / `alreadyCompleted`
- `orderId`
- ticket/seat summary

## Staff Verification & Comp

### `GET /auth/google/start`
Starts Google OAuth and redirects to Google consent.

### `GET /auth/google/callback`
Completes Google OAuth, enforces `@rtmsd.org`, verifies staff, and redirects to `/staff-tickets?authToken=...`.

### `GET /auth/microsoft/start`
Starts Microsoft OAuth and redirects to Microsoft consent.

### `GET /auth/microsoft/callback`
Completes Microsoft OAuth, enforces `@rtmsd.org`, verifies staff, and redirects to `/staff-tickets?authToken=...`.

### `POST /auth/staff/local-session`
Fallback session bootstrapping when OAuth is blocked.
Request:
```json
{ "name": "Alex Teacher", "email": "alex@rtmsd.org" }
```
Response:
```json
{
  "token": "jwt_token_here",
  "user": {
    "id": "user_123",
    "email": "alex@rtmsd.org",
    "verifiedStaff": false
  }
}
```

### `GET /auth/staff/me`
Requires `Authorization: Bearer <staff_token>`. Returns current staff user profile.

### `POST /staff/redeem-code`
Requires staff JWT. Rate limited.
Request:
```json
{ "code": "ABCD-EFGH-JKLM" }
```
Response:
```json
{
  "token": "jwt_token_here",
  "user": {
    "id": "user_123",
    "verifiedStaff": true,
    "staffVerifyMethod": "REDEEM_CODE"
  }
}
```

### `POST /tickets/staff-comp/reserve`
No staff JWT required. Requires teacher promo code + customer identity fields. Layered throttles are enforced per IP, per email, and per promo code with temporary lockouts after repeated failures. No Stripe checkout used.
Request:
```json
{
  "performanceId": "perf_123",
  "teacherPromoCode": "ABCD-EFGH",
  "customerName": "Alex Teacher",
  "customerEmail": "alex@example.com",
  "seatId": "seat_1",
  "attendeeName": "Alex Teacher"
}
```
Response:
```json
{
  "orderId": "order_123",
  "ticket": {
    "id": "ticket_uuid",
    "publicId": "9f2da1f9e6bf",
    "type": "STAFF_COMP",
    "status": "ISSUED",
    "priceCents": 0
  }
}
```

### Compatibility

#### `GET /api/shows`
Returns existing frontend show cards.

#### `GET /api/shows/:id`
Returns show details and `performances` with `date` field.

#### `GET /api/calendar`
Returns mapped ICS events:
```json
[{ "title": "Rehearsal", "date": "2026-03-04T23:00:00.000Z", "type": "event" }]
```

## Admin

Use `Authorization: Bearer <token>` for protected routes.

### `POST /api/admin/login`
Request:
```json
{ "username": "admin", "password": "secret" }
```
Response:
```json
{ "token": "jwt_token_here" }
```

### `GET /api/admin/me`
Response:
```json
{ "username": "admin", "role": "admin" }
```

### `GET /api/admin/dashboard`
Query:
```text
range=month|today|rolling30 (default: month)
```

Response:
```json
{
  "generatedAt": "2026-04-04T17:25:13.000Z",
  "range": "month",
  "core": {
    "paidRevenueCents": 4200,
    "paidOrderCount": 3,
    "ticketsIssuedCount": 3,
    "checkInsCount": 1
  },
  "operations": {
    "upcomingPerformances": [],
    "recentOrders": [],
    "scanner": {
      "activeSessions": 0,
      "latestScanAt": null
    }
  },
  "quickLinks": {
    "orders": "/admin/orders",
    "scanner": "/admin/scanner"
  },
  "adminModules": {
    "trips": {
      "activeTripCount": 2,
      "enrollmentCount": 3,
      "collectedCents": 16000,
      "remainingCents": 14000,
      "nextDueAt": "2026-04-06T13:25:00.000Z"
    },
    "fundraise": {
      "activeEventCount": 2,
      "seatsSold": 3,
      "seatsTotal": 5,
      "donationSucceededCents": 5800
    },
    "forms": {
      "openCount": 2,
      "closedCount": 3,
      "responseCount": 6,
      "programBio": { "openCount": 1, "closedCount": 2, "responseCount": 3 },
      "seniorSendoff": { "openCount": 1, "closedCount": 1, "responseCount": 3 }
    },
    "system": {
      "recentAudit": []
    }
  }
}
```

### `GET /api/admin/performances`
Returns performance rows with tiers and seat counts.

### `GET /api/admin/fundraising/donations?limit=60`
Returns recent Stripe fundraising donations (`metadata.source = fundraising_donation`) for the admin fundraising donations tab.
Response:
```json
{
  "donations": [
    {
      "paymentIntentId": "pi_123",
      "amountCents": 2000,
      "currency": "usd",
      "status": "succeeded",
      "donorName": "Jamie Rivera",
      "donorEmail": "jamie@example.com",
      "receiptEmail": "jamie@example.com",
      "createdAt": "2026-03-30T20:18:44.000Z",
      "thankYouEmailSent": true
    }
  ],
  "summary": {
    "count": 1,
    "succeededCount": 1,
    "grossSucceededCents": 2000
  }
}
```

### `POST /api/admin/check-in/session/start`
Starts a scanner staff session for one performance/gate.
Request:
```json
{
  "performanceId": "perf_123",
  "staffName": "Alex",
  "gate": "Main Entrance",
  "deviceLabel": "iPhone Gate A"
}
```
Response:
```json
{
  "sessionId": "sess_123",
  "sessionToken": "scanner_session_secret",
  "performanceId": "perf_123",
  "staffName": "Alex",
  "gate": "Main Entrance",
  "deviceLabel": "iPhone Gate A",
  "createdAt": "2026-03-11T22:13:45.100Z"
}
```

### `POST /api/admin/check-in/session/end`
Ends an active scanner session.
Request:
```json
{ "sessionToken": "scanner_session_secret" }
```
Response:
```json
{ "success": true }
```

### `GET /api/admin/check-in/events?performanceId=perf_123&token=<admin_jwt>`
Server-Sent Events (SSE) realtime stream for scanner updates.

Event names:
- `ready`
- `ping`
- `checkin`
- `decision`
- `session`

### `POST /api/admin/check-in/scan`
Scans and validates one ticket for a selected performance, then marks it checked in.
Request:
```json
{
  "performanceId": "perf_123",
  "sessionToken": "scanner_session_secret",
  "scannedValue": "ticket_uuid.signature",
  "clientScanId": "optional-client-id",
  "offlineQueuedAt": "2026-03-11T22:10:00.000Z"
}
```
`scannedValue` can be QR payload, ticket URL, or public ticket id.

Response:
```json
{
  "outcome": "VALID",
  "message": "Ticket checked in successfully.",
  "scannedAt": "2026-03-11T22:13:45.100Z",
  "ticket": {
    "id": "ticket_uuid",
    "publicId": "9f2da1f9e6bf",
    "performanceId": "perf_123",
    "performanceTitle": "Little Shop of Horrors",
    "startsAt": "2026-03-20T23:00:00.000Z",
    "venue": "Penncrest High School Auditorium",
    "seat": { "sectionName": "Orchestra", "row": "A", "number": 12 },
    "holder": { "customerName": "Jordan Taylor", "customerEmail": "buyer@example.com" },
    "order": { "id": "order_123", "status": "PAID" },
    "checkedInAt": "2026-03-11T22:13:45.100Z",
    "checkedInBy": "Alex @ Main Entrance",
    "checkInGate": "Main Entrance"
  }
}
```

`outcome` values:
- `VALID`
- `ALREADY_CHECKED_IN`
- `WRONG_PERFORMANCE`
- `NOT_ADMITTED`
- `INVALID_QR`
- `NOT_FOUND`

### `POST /api/admin/check-in/undo`
Removes a previously recorded check-in for one ticket.
Request:
```json
{
  "performanceId": "perf_123",
  "sessionToken": "scanner_session_secret",
  "ticketId": "ticket_uuid",
  "reasonCode": "MANUAL_CORRECTION",
  "notes": "Scanner double-tap"
}
```
You can send `publicId` instead of `ticketId`.

Reason codes:
- `DUPLICATE_SCAN`
- `VIP_OVERRIDE`
- `PAYMENT_EXCEPTION`
- `INVALID_TICKET`
- `SAFETY_CONCERN`
- `MANUAL_CORRECTION`
- `OTHER`

Response:
```json
{
  "success": true,
  "message": "Check-in removed.",
  "ticket": {
    "id": "ticket_uuid",
    "publicId": "9f2da1f9e6bf",
    "checkedInAt": null,
    "checkInGate": null
  }
}
```

### `POST /api/admin/check-in/force-decision`
Supervisor override to force admit or deny a ticket.
Request:
```json
{
  "performanceId": "perf_123",
  "sessionToken": "scanner_session_secret",
  "ticketId": "ticket_uuid",
  "decision": "DENY",
  "reasonCode": "SAFETY_CONCERN",
  "notes": "Duplicate printed ticket"
}
```
Response:
```json
{
  "success": true,
  "decision": "DENY",
  "message": "Ticket denied.",
  "ticket": {
    "id": "ticket_uuid",
    "publicId": "9f2da1f9e6bf",
    "admissionDecision": "DENY",
    "admissionReason": "SAFETY_CONCERN: Duplicate printed ticket"
  }
}
```

### `GET /api/admin/check-in/lookup?performanceId=perf_123&q=alex&limit=40`
Manual lookup for supervisor tools by name/email/order/ticket/seat.

### `GET /api/admin/check-in/timeline?performanceId=perf_123&page=1&pageSize=100`
Returns scanner timeline rows (check-ins, undo, force decisions, failed attempts).

### `GET /api/admin/check-in/summary?performanceId=perf_123`
Returns live check-in totals, per-gate breakdown, active sessions, and recent check-ins.
Response:
```json
{
  "performance": {
    "id": "perf_123",
    "title": "Little Shop of Horrors",
    "startsAt": "2026-03-20T23:00:00.000Z",
    "venue": "Penncrest High School Auditorium"
  },
  "totalCheckedIn": 84,
  "totalAdmittable": 212,
  "deniedCount": 2,
  "forceAdmitCount": 4,
  "gateBreakdown": [
    { "gate": "Main Entrance", "count": 60 },
    { "gate": "Side Door", "count": 24 }
  ],
  "activeSessions": [
    {
      "id": "sess_123",
      "staffName": "Alex",
      "gate": "Main Entrance",
      "deviceLabel": "iPhone Gate A",
      "startedAt": "2026-03-11T21:40:00.000Z",
      "lastSeenAt": "2026-03-11T22:13:44.000Z"
    }
  ],
  "recent": [
    {
      "id": "ticket_uuid",
      "publicId": "9f2da1f9e6bf",
      "checkedInAt": "2026-03-11T22:13:45.100Z",
      "checkedInBy": "Alex @ Main Entrance",
      "checkInGate": "Main Entrance",
      "seat": { "sectionName": "Orchestra", "row": "A", "number": 12 },
      "holder": { "customerName": "Jordan Taylor", "customerEmail": "buyer@example.com" }
    }
  ]
}
```

### `GET /api/admin/check-in/analytics?performanceId=perf_123`
Returns post-show analytics including totals, attempts, gate breakdown, and per-minute timeline.

### `GET /api/admin/check-in/analytics.csv?performanceId=perf_123`
CSV export of scanner analytics.

### `POST /api/admin/performances`
Request:
```json
{
  "title": "Little Shop of Horrors",
  "startsAt": "2026-03-20T23:00:00.000Z",
  "venue": "Penncrest High School Auditorium",
  "notes": "Doors 30 minutes before",
  "pricingTiers": [
    { "name": "Adult", "priceCents": 1800 },
    { "name": "Student", "priceCents": 1200 }
  ]
}
```
Response:
```json
{ "id": "perf_123" }
```

### `PATCH /api/admin/performances/:id`
Request: same fields as create, all optional.
Response:
```json
{ "success": true }
```

### `DELETE /api/admin/performances/:id`
Response:
```json
{ "success": true }
```

### `POST /api/admin/seats/block`
Request:
```json
{ "performanceId": "perf_123", "seatIds": ["seat_1", "seat_2"] }
```
Response:
```json
{ "success": true }
```

### `POST /api/admin/seats/unblock`
Request/response same as block.

### `GET /api/admin/orders`
Query params:
- `q` (optional search)
- `status` (optional)
- `performanceId` (optional)

Returns order summary list.

### `GET /api/admin/orders/:id`
Returns full order details with seats and tickets.

### `POST /api/admin/orders/:id/resend`
Response:
```json
{ "success": true }
```

### `POST /api/admin/orders/:id/refund`
Request:
```json
{ "releaseSeats": true, "reason": "Customer requested refund" }
```
Response:
```json
{ "success": true }
```

### `GET /api/admin/finance/summary?startDate=2026-03-01&endDate=2026-03-31`
Returns finance totals and breakdowns for the selected date range.

### `GET /api/admin/finance/report.pdf?startDate=2026-03-01&endDate=2026-03-31`
Downloads branded finance PDF for the selected range.

### `GET /api/admin/finance/local-report.csv?startDate=2026-03-01&endDate=2026-03-31`
Downloads local finance CSV with order-level rows (cash/card/comp split).

### `GET /api/admin/finance/stripe-report.csv?startDate=2026-03-01&endDate=2026-03-31`
Downloads Stripe balance transactions CSV.

### `GET /api/admin/finance/invoices?status=all&archive=active&limit=60&q=jamie`
Returns recent Stripe invoices with status/process metadata for admin tracking.

### `GET /api/admin/finance/invoices/:invoiceId`
Returns one invoice with timeline fields and expanded line items.

### `POST /api/admin/finance/invoices/:invoiceId/archive`
Marks an invoice as archived in admin metadata so it can be hidden from active workflow views.

### `POST /api/admin/finance/invoices/:invoiceId/unarchive`
Restores an archived invoice to active workflow views.

### `POST /api/admin/finance/invoices/send`
Request:
```json
{
  "customerName": "Jordan Taylor",
  "customerEmail": "jordan@example.com",
  "description": "Spring Gala Sponsorship Invoice",
  "customerNote": "Please pay within 30 days.",
  "dueInDays": 30,
  "lineItems": [
    {
      "description": "Sponsorship Package",
      "quantity": 1,
      "unitAmountCents": 12500
    },
    {
      "description": "Playbill ad",
      "quantity": 2,
      "unitAmountCents": 1250
    }
  ]
}
```
Notes:
- `lineItems` is optional if `amountCents` is provided for a single-line invoice.
- `description` is the invoice title shown in Stripe.

Response:
```json
{
  "invoiceId": "in_123",
  "invoiceNumber": "A1B2C3D4-0001",
  "customerId": "cus_123",
  "customerEmail": "jordan@example.com",
  "amountDueCents": 15000,
  "status": "open",
  "hostedInvoiceUrl": "https://invoice.stripe.com/..."
}
```

### `GET /api/admin/roster`
Query params:
- `performanceId` (optional)
- `q` (optional)

Returns flattened attendee rows (name/email/seat/order/ticket).

### `GET /api/admin/audit-logs`
Query params:
- `page` (default `1`)
- `pageSize` (default `50`, max `200`)

Response:
```json
{
  "page": 1,
  "pageSize": 50,
  "total": 12,
  "rows": [
    {
      "id": "log_1",
      "actor": "admin",
      "action": "SEATS_BLOCKED",
      "entityType": "Performance",
      "entityId": "perf_123",
      "metadataJson": { "seatIds": ["seat_1"] },
      "createdAt": "2026-03-02T17:00:00.000Z"
    }
  ]
}
```

### `GET /api/admin/staff/users`
Query params:
- `verified` (`true` / `false`, optional)
- `q` (optional text search)
- `limit` (default `100`, max `500`)

### `POST /api/admin/staff/users/:userId/revoke`
Revokes verified staff status.
Request:
```json
{ "reason": "Employment status changed" }
```

### `POST /api/admin/staff/redeem-codes`
Generates high-entropy single-use redeem codes.
Request:
```json
{ "count": 5, "expiresInMinutes": 10080 }
```
Response includes plaintext code values once at creation.

### `GET /api/admin/staff/redeem-codes`
Query params:
- `status`: `active` | `used` | `expired` (optional)
- `page`, `pageSize`

### `GET /api/admin/staff/redemptions`
Query params:
- `performanceId` (optional)
- `userId` (optional)
- `page`, `pageSize`

Returns staff comp redemption ledger rows (user/perforance/ticket/seat metadata).

## Managed Devices

All `/api/admin/devices/*` endpoints require `ADMIN` or `SUPER_ADMIN`.
All `/api/mobile/device/*` endpoints require a valid managed-device token unless noted.

### `POST /api/mobile/device/register` (Admin-auth)
Registers or re-registers a device and returns a device token.

### `POST /api/mobile/device/heartbeat`
Updates device runtime status (`appVersion`, kiosk/maintenance state, update state, command sync state).

### `POST /api/mobile/device/commands/next`
Long-poll for the next pending command (`waitMs` max `30000`).

### `POST /api/mobile/device/commands/:id/ack`
Acknowledge command completion with strict status:
- `SUCCEEDED`
- `FAILED`
- `TIMEOUT`
- `CANCELED`

### `GET /api/mobile/device/update/latest`
Returns current production APK release metadata (if published).

### `POST /api/mobile/device/admin-unlock/verify`
Verifies device-local admin PIN with server-side hash checks and lockout policy.

### `GET /api/admin/devices`
Returns fleet summary (online/offline, heartbeat, version, kiosk/maintenance, latest command).

### `GET /api/admin/devices/:id`
Returns full device detail with recent command and event history.

### `POST /api/admin/devices/:id/commands`
Queues a remote command:
- `REFRESH_CONFIG`
- `RESTART_APP`
- `ENTER_MAINTENANCE`
- `EXIT_MAINTENANCE`
- `UPDATE_APP`
- `SET_KIOSK_LOCK`

### `POST /api/admin/devices/:id/pin`
Sets or rotates admin escape PIN (stored hashed server-side).

### `PUT /api/admin/devices/update-metadata`
Upserts production APK metadata (`version*`, `apkUrl`, `apkSha256`, optional force-update/signature fields).
