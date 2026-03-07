# Theater API Endpoints

Base URL examples:
- Local backend: `http://localhost:4000`
- All routes shown include `/api/...`

## Public

### `GET /api/health`
Response:
```json
{ "status": "ok" }
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
Response:
```json
{ "url": "https://checkout.stripe.com/c/pay/cs_test_..." }
```

### `POST /api/webhooks/stripe`
Stripe sends events to this endpoint with raw body signature verification.

Handled events:
- `checkout.session.completed`
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
Requires verified staff JWT. Rate limited. No Stripe checkout used.
Request:
```json
{
  "performanceId": "perf_123",
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
Response:
```json
{
  "salesToday": 4200,
  "seatsSold": 120,
  "revenue": 19800,
  "checkIns": 0,
  "salesByPerformance": [
    {
      "performanceId": "perf_123",
      "performanceTitle": "Little Shop of Horrors",
      "startsAt": "2026-03-20T23:00:00.000Z",
      "orders": 11,
      "revenue": 19800
    }
  ]
}
```

### `GET /api/admin/performances`
Returns performance rows with tiers and seat counts.

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
