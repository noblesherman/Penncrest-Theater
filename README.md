# Penncrest Theater Ticketing Platform

Production-ready school theater ticketing platform with reserved seating, Stripe checkout, ticket delivery, and admin management.

## Stack

- Frontend: React + Vite + TypeScript (`/src`)
- Backend: Fastify + Prisma + Postgres + TypeScript (`/backend`)
- Payments: Stripe Checkout + Stripe webhooks
- Email: SMTP (Nodemailer)

## Canonical API

`/backend` is the only maintained API service. The root `server.ts` entrypoint and `/apps/api` have been intentionally disabled so hotfixes and deploys land on a single backend implementation.

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

Database backup:
```bash
npm run backup:db -- --dry-run
```

Database restore:
```bash
npm run restore:db -- --file backups/postgres/<file>.dump.enc --yes-i-understand
```

Hard reset all system data except users:
```bash
RESET_CONFIRM=WIPE_NON_USER_DATA npm --prefix backend run reset:system:keep-users -- --yes
```

Safer restore into a separate database first:
```bash
npm run restore:db -- \
  --file backups/postgres/<file>.dump.enc \
  --target-db-url "postgresql://USER:PASSWORD@HOST:5432/theater_restore" \
  --yes-i-understand
```

See:
- `docs/database-backups.md`
- `deploy/systemd/theater-db-backup.service`
- `deploy/systemd/theater-db-backup.timer`

## API Documentation

See:
- `backend/docs/endpoints.md`

## Environment Variables

### Frontend (`.env`)
- `VITE_API_BASE_URL` optional, defaults to same-origin
- `VITE_API_PROXY_TARGET` optional, default `http://localhost:4000`
- `VITE_ALLOWED_HOSTS` optional, comma-separated host allowlist for tunneling the Vite dev server; defaults to `.trycloudflare.com`
- `VITE_SITE_URL` recommended, used for canonical URLs, sitemap.xml, robots.txt, and social metadata

### Backend (`backend/.env`)
- `PORT`
- `TRUST_PROXY_HOPS` (optional, default `1` in production and `0` otherwise)
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
- `R2_ACCOUNT_ID` (optional if `R2_ENDPOINT` is set)
- `R2_ENDPOINT` (optional if `R2_ACCOUNT_ID` is set)
- `R2_BUCKET`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_PUBLIC_BASE_URL`
- `R2_UPLOAD_PREFIX` (optional, default `uploads`)
- `R2_MAX_UPLOAD_BYTES` (optional, default `8388608`)

### One-Time Image Migration to R2

After configuring R2 vars in `backend/.env`, convert existing Base64-stored images in Postgres:

```bash
npm --prefix backend run images:migrate-r2
```

This migrates:
- `show.posterUrl`
- `castMember.photoUrl`
- image data URLs nested in `contentPage.content` (About page editor content)

## Deployment Notes

1. Deploy frontend static assets and backend service separately.
2. Provision Postgres and set `DATABASE_URL`.
3. Run backend migrations on deploy:
   ```bash
   npm --prefix backend run prisma:deploy
   ```
4. Build backend JS once per deploy so PM2 runs compiled output:
   ```bash
   npm --prefix backend run build
   ```
5. Recommended one-command deploy (single backend + single tunnel):
   ```bash
   npm install -g pm2
   cp cloudflared/config.example.yml cloudflared/config.yml
   # edit cloudflared/config.yml with your tunnel id, credentials path, and hostname
   ./scripts/deploy-theater.sh
   pm2 startup
   ```
   Notes:
   - This uses `ecosystem.single.cjs`.
   - It keeps only `theater-backend` + `theater-tunnel`.
   - Checkout queue and hold cleanup run in-process inside `theater-backend`.
   - Script location: `scripts/deploy-theater.sh`
   - Optional overrides: `BACKEND_PORT`, `CLOUDFLARED_CONFIG`, `API_HEALTH_URL`.
6. Alternative multi-process deploy (separate checkout + hold-cleanup workers):
   ```bash
   # optional: set checkout worker replicas (defaults to 2)
   export CHECKOUT_WORKER_INSTANCES=3
   pm2 start ecosystem.config.cjs
   pm2 save
   ```
   For a temporary quick tunnel instead of a named tunnel:
   ```bash
   pm2 start ecosystem.quick-tunnel.config.cjs
   pm2 save
   ```
   Process inspection/restart:
   ```bash
   pm2 status
   pm2 logs theater-backend
   pm2 logs theater-checkout-worker
   pm2 logs theater-hold-cleanup
   pm2 logs theater-tunnel
   pm2 logs theater-quick-tunnel
   pm2 restart theater-backend
   pm2 restart theater-checkout-worker
   pm2 restart theater-hold-cleanup
   pm2 restart theater-tunnel
   ```
7. Create a named Cloudflare Tunnel so the backend URL is stable. Point it at `http://localhost:$PORT` (for example `http://localhost:6000`), then set the frontend `VITE_API_BASE_URL` to that hostname and set backend `FRONTEND_ORIGIN` / `APP_BASE_URL` to your Vercel frontend URL.
   Quick tunnels are fine for temporary testing:
   ```bash
   cloudflared tunnel --url http://localhost:6000
   ```
   They are not a good PM2 target because the hostname changes when the process restarts.
   If you tunnel the Vite dev server instead of the backend, set `VITE_ALLOWED_HOSTS` so Vite accepts the tunnel hostname.
8. Configure Stripe webhook endpoint:
   - `https://<backend-domain>/api/webhooks/stripe`
9. Set all backend env vars in your host.
10. Keep queue and cleanup workers running separately from the API process:
   - `theater-checkout-worker` can run multiple instances (set `CHECKOUT_WORKER_INSTANCES`).
   - `theater-hold-cleanup` should run as a single scheduler process.
   - If needed, you can still run manual/scheduled cleanup with `npm --prefix backend run cron:release-holds`.
