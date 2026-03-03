# Penncrest Theater Ticketing Platform

Production-ready school theater ticketing platform with reserved seating, Stripe checkout, ticket delivery, and admin management.

## Stack

- Frontend: React + Vite + TypeScript (`/src`)
- Backend: Fastify + Prisma + Postgres + TypeScript (`/backend`)
- Payments: Stripe Checkout + Stripe webhooks
- Email: SMTP (Nodemailer)

## Key Features

- Performance browsing and seat map availability
- Hold sync endpoint with TTL and client token (`POST /api/hold`)
- Stripe checkout (`POST /api/checkout`)
- Webhook-based purchase finalization (`POST /api/webhooks/stripe`)
- Ticket links with QR payloads (`/tickets/:publicId`)
- Admin portal (`/admin`) for:
  - dashboard
  - performance CRUD + pricing tiers
  - seat blocking/unblocking
  - order search/detail/resend/refund
  - attendee roster (no check-in scanning)
  - audit log

## Local Setup

### 1) Install frontend dependencies

```bash
npm install
```

### 2) Install backend dependencies

```bash
npm --prefix backend install
```

### 3) Configure backend env

```bash
cp backend/.env.example backend/.env
```

Fill in:
- `DATABASE_URL`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `JWT_SECRET`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- SMTP settings (optional but recommended for email delivery)

### 4) Prisma generate + migrate + seed

```bash
npm --prefix backend run prisma:generate
npm --prefix backend run prisma:migrate -- --name init_ticketing
npm --prefix backend run seed
```

### 5) Run both apps

Terminal A:
```bash
npm run dev
```

Terminal B:
```bash
npm run dev:backend
```

Or one command:
```bash
npm run dev:full
```

Frontend: `http://localhost:5173`
Backend: `http://localhost:4000`

## Stripe Webhook Local Testing

```bash
stripe listen --forward-to localhost:4000/api/webhooks/stripe
```

Use the returned webhook signing secret as `STRIPE_WEBHOOK_SECRET`.

## Useful Commands

Frontend build:
```bash
npm run build
```

Backend typecheck:
```bash
npm --prefix backend run build
```

Release expired holds manually:
```bash
npm --prefix backend run cron:release-holds
```

## API Documentation

See:
- `backend/docs/endpoints.md`

## Environment Variables

### Frontend (`.env`)
- `VITE_API_BASE_URL` optional, defaults to same-origin
- `VITE_API_PROXY_TARGET` optional, default `http://localhost:4000`

### Backend (`backend/.env`)
- `PORT`
- `DATABASE_URL`
- `APP_BASE_URL`
- `FRONTEND_ORIGIN`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `JWT_SECRET`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `HOLD_TTL_MINUTES`
- `HOLD_CLEANUP_INTERVAL_SECONDS`
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
- `GOOGLE_CALENDAR_ICS_URL` (optional)

## Deployment Notes

1. Deploy frontend static assets and backend service separately.
2. Provision Postgres and set `DATABASE_URL`.
3. Run backend migrations on deploy:
   ```bash
   npm --prefix backend run prisma:deploy
   ```
4. Configure Stripe webhook endpoint:
   - `https://<backend-domain>/api/webhooks/stripe`
5. Set all backend env vars in your host.
6. Ensure hold cleanup runs continuously (in-process interval) or via scheduled job using `cron:release-holds`.
