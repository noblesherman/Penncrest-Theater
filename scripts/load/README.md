# Flash Sale Load Test (k6)

Script: `scripts/load/k6-prod-flash-sale.js`

## 1) Install k6

```bash
brew install k6
```

## 2) Required env vars

- `BASE_URL` (example: `https://api.penncresttheater.com`)
- `PERFORMANCE_ID` (use a dedicated test performance)
- Optional: `TARGET_BUYERS` (default `400`)
- Optional: `ENABLE_CHECKOUT` (`true` or `false`, default `false`)
- Optional: `SPIKE_MODE` (`true` for all-at-once, default `false`)

## 3) Safe validation run (no checkout writes)

Holds only, staged ramp:

```bash
BASE_URL="https://api.penncresttheater.com" \
PERFORMANCE_ID="perf_xxx" \
TARGET_BUYERS=400 \
ENABLE_CHECKOUT=false \
npm run load:flash-sale
```

## 4) Real buyer simulation (creates checkout intents)

Staged ramp:

```bash
BASE_URL="https://api.penncresttheater.com" \
PERFORMANCE_ID="perf_xxx" \
TARGET_BUYERS=400 \
ENABLE_CHECKOUT=true \
npm run load:flash-sale
```

All-at-once spike:

```bash
BASE_URL="https://api.penncresttheater.com" \
PERFORMANCE_ID="perf_xxx" \
TARGET_BUYERS=400 \
ENABLE_CHECKOUT=true \
npm run load:flash-sale:spike
```

## Notes

- The script aborts early if failure, 429 rate, or 5xx rate crosses kill thresholds.
- It requires at least `TARGET_BUYERS` available seats for that performance.
- `ENABLE_CHECKOUT=true` creates pending checkout orders/payment intents unless you also confirm payments externally.
