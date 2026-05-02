# Show Night Cashier Checkout Incident Analysis

## Executive summary

Online sales can be blocked by `onlineSalesStartsAt` and `salesCutoffAt`; cash cashier checkout should not be. The cash route `POST /api/admin/orders/in-person/finalize` calls `createAssignedOrder` with `enforceSalesCutoff: false`, so a past online cutoff alone does not explain cash checkout failure.

The most likely cash failures in the code are inventory/pricing integrity failures: selected seats no longer available, selected seats with existing `ISSUED` tickets, missing pricing tiers, mismatched ticket tier selections, or a race during seat update/ticket creation. Another important hardening finding: after the order and tickets were created, audit-log writes could still fail before the route returned `201`, making the cashier see a failure even though the sale had finalized.

This change adds structured PM2-visible checkout logs, frontend diagnostic logs, backend tests for cash checkout failure modes, and makes post-finalize audit logging non-fatal for successful cash sales.

## What we know

- Cash finalize route: `backend/src/routes/admin-orders.ts`, `POST /api/admin/orders/in-person/finalize`.
- Cash finalize service: `backend/src/services/order-assignment.ts`, `createAssignedOrder`.
- The cash route rejects non-cash payment methods and uses terminal/payment-line paths for card.
- The cash route builds a quote first with `buildInPersonSaleQuote`.
- The cash route then calls `createAssignedOrder` with `source: 'DOOR'`, `inPersonPaymentMethod: 'CASH'`, and `enforceSalesCutoff: false`.
- Online checkout paths use cutoff enforcement:
  - `backend/src/services/checkout-execution-service.ts`
  - `backend/src/services/checkout-queue-service.ts`
  - `backend/src/services/hold-service.ts`
  - `createAssignedOrder(... enforceSalesCutoff: true)` for online/comp checkout paths.
- Local migration check on this machine is not representative of production: local `DATABASE_URL` points to `localhost:5432/theater`, migration history is divergent, and the local DB does not have `Ticket_one_issued_per_seat`.

## What we do not know because logs were missing

- The exact backend error returned to the cashier on show night.
- Whether the selected seats were already `SOLD`, `HELD`, or `BLOCKED`.
- Whether `Seat.status` still said `AVAILABLE` while an `ISSUED` ticket already existed.
- Whether pricing tiers were missing or the UI sent stale ticket tier IDs.
- Whether an audit-log write failed after order/ticket creation.
- Whether a Prisma unique-index or schema mismatch error happened.
- Whether the frontend displayed the real backend message or a generic fallback.

## Why sales cutoff explains online checkout but not cash checkout

Online checkout and holds explicitly check `onlineSalesStartsAt` and `salesCutoffAt`. If an admin edit shifted a cutoff into the past, online sales would close.

Cash cashier checkout is different. The route `POST /api/admin/orders/in-person/finalize` passes `enforceSalesCutoff: false` to `createAssignedOrder`. The service only reads cutoff fields for diagnostics or when `enforceSalesCutoff` is true. A past cutoff is therefore ruled out as the direct cash blocker unless a different route was used.

## Cash checkout failure points found in code

- Admin auth fails: `backend/src/plugins/admin-auth.ts`.
- Request validation fails: `inPersonFinalizeSchema` in `backend/src/routes/admin-orders.ts`.
- Payment method is not `CASH`: cash finalize route rejects card and directs card to terminal dispatch.
- Performance missing or archived: `buildInPersonSaleQuote`, then `createAssignedOrder`.
- Selected seats invalid for the performance.
- No pricing tiers configured for the performance.
- Ticket selections do not include every selected seat.
- Selected ticket tier ID is invalid or stale.
- Selected seat is `HELD`, `SOLD`, or `BLOCKED`.
- Companion seat rules fail.
- Teacher/student comp rules fail or student code is missing/ineligible.
- Existing `ISSUED` ticket exists for a selected seat.
- Seat optimistic update count is lower than selected seat count, usually a race or stale seat state.
- `Ticket_one_issued_per_seat` unique index rejects a duplicate issued ticket.
- Order, order-seat, ticket, outbox, or student-credit DB write fails.
- Prisma client/schema mismatch or missing columns/tables.
- Previously: audit logging after successful order creation could fail before the route sent `201`.

## Most likely based on DB evidence

Given the reported DB evidence that duplicate issued ticket query returns zero rows and the unique index exists in the server DB, persistent duplicate issued tickets are less likely now.

The most likely cash failure classes are:

- Stale seat state at the cashier: a seat already became `SOLD`, `HELD`, or `BLOCKED` before finalize.
- Seat status drift: the UI saw a seat as available while an issued ticket existed or had just been created.
- Missing/stale pricing tier configuration caused quote validation to fail.
- Post-order audit logging failed, causing the frontend to see failure after tickets were already issued.

The new logs will distinguish these cases by showing seat statuses, existing issued tickets, pricing tiers, calculated total, order ID, ticket IDs, and final error.

## Ruled out

- `salesCutoffAt` as the direct blocker for the cash route is ruled out by the code path: `enforceSalesCutoff` is false.
- Customer PII or payment secrets are not needed to diagnose this failure and are not logged by the new checkout diagnostics.
- The local machine cannot prove the Ubuntu production migration state. Local migration history is divergent and should not be used as production evidence.

## Files, functions, and routes involved

- `backend/src/routes/admin-orders.ts`
  - `POST /api/admin/orders/in-person/finalize`
  - `buildInPersonSaleQuote`
  - `loadCashierCheckoutPreflightSnapshot`
- `backend/src/services/order-assignment.ts`
  - `createAssignedOrder`
- `backend/src/services/seat-ticket-guard.ts`
  - `assertNoIssuedTicketsForSeats`
- `backend/src/lib/cashier-checkout-logger.ts`
  - `logCashierCheckout`
  - `sanitizeCashierCheckoutError`
- `src/pages/admin/Orders.tsx`
  - `finalizeInPersonSale`
  - `finalizeCashierCheckoutWithDiagnostics`
- Migration:
  - `backend/prisma/migrations/20260501020000_prevent_duplicate_issued_seat_tickets/migration.sql`

## Concrete prevention fixes added

- Added structured backend checkout logs visible in PM2:
  - `requestId`
  - route name
  - admin ID/username
  - performance ID
  - selected seat IDs
  - selected ticket tier IDs and ticket types
  - payment method
  - cash received amount
  - calculated total
  - performance `startsAt`, `salesCutoffAt`, `onlineSalesStartsAt`
  - `enforceSalesCutoff`
  - selected seat statuses
  - existing `ISSUED` tickets
  - pricing tiers
  - created order ID
  - created ticket IDs
  - full sanitized error name/message/code/status
- Logged 400/409 business errors, not only 500s.
- Added frontend cash-finalize diagnostics with sanitized endpoint/payload/status/error body/UI mode.
- Made the cashier UI display the backend error message in an explicit alert.
- Made post-finalize audit-log failures non-fatal after order/tickets are created.
- Added integration tests for cash cutoff bypass, duplicate issued tickets, missing pricing, mismatched ticket selections, and valid cash checkout.

## Migration/deploy risk

Migration file `20260501020000_prevent_duplicate_issued_seat_tickets` is correct in principle: it refuses to add the index if duplicate issued tickets exist, then creates partial unique index `Ticket_one_issued_per_seat` on `(performanceId, seatId)` where `seatId IS NOT NULL AND status = 'ISSUED'`.

Read-only local check on this machine:

- `npx prisma migrate status --schema prisma/schema.prisma` against local `localhost:5432/theater` reports divergent history after `20260302_ticketing_feature_expansion`.
- Local `_prisma_migrations` has no row for `20260501020000_prevent_duplicate_issued_seat_tickets`.
- Local `pg_indexes` has no `Ticket_one_issued_per_seat`.
- Local duplicate issued ticket query returns zero rows.

This does not match the user-provided production evidence that the index exists. I did not change the migration. If production has the index and zero duplicates but `_prisma_migrations` marks this migration rolled back, the schema is functionally protected but Prisma migration metadata is inconsistent. Fixing that should be done deliberately on the Ubuntu server after confirming:

```sql
SELECT migration_name, finished_at, rolled_back_at, logs
FROM _prisma_migrations
WHERE migration_name = '20260501020000_prevent_duplicate_issued_seat_tickets';

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = current_schema()
  AND indexname = 'Ticket_one_issued_per_seat';

SELECT "performanceId", "seatId", COUNT(*) AS count
FROM "Ticket"
WHERE "seatId" IS NOT NULL
  AND status = 'ISSUED'
GROUP BY "performanceId", "seatId"
HAVING COUNT(*) > 1;
```

## Remaining recommendations

- Run the migration-state SQL above on the Ubuntu server and decide whether only Prisma metadata needs reconciliation.
- Review the admin performance date edit workflow separately. The checkout code proves shifted cutoff fields can close online sales, but the cash failure needs its own evidence.
- Consider showing issued-ticket-backed seats as sold everywhere in admin seat APIs. There are already local uncommitted changes in `backend/src/routes/admin-seats.ts` and `backend/src/routes/performances.ts` that appear to move in that direction.
- Add an admin incident query/dashboard for recent failed cashier attempts using these structured log fields or a durable checkout-attempt table.
