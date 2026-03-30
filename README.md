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

Database backup:
```bash
npm run backup:db -- --dry-run
```

Database restore:
```bash
npm run restore:db -- --file backups/postgres/<file>.dump.enc --yes-i-understand
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
5. Start the backend and tunnel with PM2 so they stay up after shell disconnects or server restarts:
   ```bash
   npm install -g pm2
   cp cloudflared/config.example.yml cloudflared/config.yml
   # edit cloudflared/config.yml with your tunnel id, credentials path, and hostname
   pm2 start ecosystem.config.cjs
   pm2 save
   pm2 startup
   ```
   For a temporary quick tunnel instead of a named tunnel:
   ```bash
   pm2 start ecosystem.quick-tunnel.config.cjs
   pm2 save
   ```
   You can inspect/restart it with:
   ```bash
   pm2 status
    pm2 logs theater-backend
   pm2 logs theater-tunnel
   pm2 restart theater-backend
   pm2 restart theater-tunnel
   ```
   Quick tunnel logs:
   ```bash
   pm2 logs theater-quick-tunnel
   ```
6. Create a named Cloudflare Tunnel so the backend URL is stable. Point it at `http://localhost:$PORT` (for example `http://localhost:6000`), then set the frontend `VITE_API_BASE_URL` to that hostname and set backend `FRONTEND_ORIGIN` / `APP_BASE_URL` to your Vercel frontend URL.
   Quick tunnels are fine for temporary testing:
   ```bash
   cloudflared tunnel --url http://localhost:6000
   ```
   They are not a good PM2 target because the hostname changes when the process restarts.
   If you tunnel the Vite dev server instead of the backend, set `VITE_ALLOWED_HOSTS` so Vite accepts the tunnel hostname.
7. Configure Stripe webhook endpoint:
   - `https://<backend-domain>/api/webhooks/stripe`
8. Set all backend env vars in your host.
9. Ensure hold cleanup runs continuously (in-process interval) or via scheduled job using `cron:release-holds`.
