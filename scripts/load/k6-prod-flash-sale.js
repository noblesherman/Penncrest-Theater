import http from 'k6/http';
import { check, fail } from 'k6';
import exec from 'k6/execution';
import { Rate, Trend, Counter } from 'k6/metrics';

const TARGET_BUYERS = Number(__ENV.TARGET_BUYERS || 400);
const BASE_URL = (__ENV.BASE_URL || '').trim();
const PERFORMANCE_ID = (__ENV.PERFORMANCE_ID || '').trim();
const ENABLE_CHECKOUT = String(__ENV.ENABLE_CHECKOUT || 'false').toLowerCase() === 'true';
const SPIKE_MODE = String(__ENV.SPIKE_MODE || 'false').toLowerCase() === 'true';

const holdOk = new Rate('hold_ok');
const checkoutOk = new Rate('checkout_ok');
const holdConflict = new Rate('hold_conflict_409');
const checkoutConflict = new Rate('checkout_conflict_409');
const checkoutRateLimited = new Rate('checkout_rate_limited_429');
const checkoutServerError = new Rate('checkout_server_error_5xx');
const buyersAttempted = new Counter('buyers_attempted');
const buyersCompletedCheckout = new Counter('buyers_completed_checkout');
const holdDuration = new Trend('hold_duration_ms');
const checkoutDuration = new Trend('checkout_duration_ms');

function buildScenarios(targetBuyers, spikeMode) {
  if (spikeMode) {
    return {
      spike_400: {
        executor: 'per-vu-iterations',
        vus: targetBuyers,
        iterations: 1,
        maxDuration: '5m',
      },
    };
  }

  const fractions = [0.125, 0.125, 0.25, 0.5];
  const startTimes = ['0s', '45s', '90s', '135s'];
  const waveCounts = [];
  let assigned = 0;

  for (let i = 0; i < fractions.length; i += 1) {
    const base = i === fractions.length - 1 ? targetBuyers - assigned : Math.max(1, Math.floor(targetBuyers * fractions[i]));
    waveCounts.push(base);
    assigned += base;
  }

  const scenarios = {};
  for (let i = 0; i < waveCounts.length; i += 1) {
    scenarios[`wave_${i + 1}`] = {
      executor: 'per-vu-iterations',
      vus: waveCounts[i],
      iterations: 1,
      startTime: startTimes[i],
      maxDuration: '2m',
    };
  }
  return scenarios;
}

export const options = {
  scenarios: buildScenarios(TARGET_BUYERS, SPIKE_MODE),
  thresholds: {
    http_req_failed: [{ threshold: 'rate<0.08', abortOnFail: true }],
    http_req_duration: ['p(95)<2500', 'p(99)<5000'],
    hold_ok: ['rate>0.90'],
    hold_conflict_409: ['rate<0.35'],
    checkout_ok: [{ threshold: 'rate>0.85', abortOnFail: true }],
    checkout_rate_limited_429: [{ threshold: 'rate<0.12', abortOnFail: true }],
    checkout_server_error_5xx: [{ threshold: 'rate<0.02', abortOnFail: true }],
    hold_duration_ms: ['p(95)<1500'],
    checkout_duration_ms: ['p(95)<2200'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

export function setup() {
  if (!BASE_URL) fail('BASE_URL is required');
  if (!PERFORMANCE_ID) fail('PERFORMANCE_ID is required');
  if (TARGET_BUYERS <= 0) fail('TARGET_BUYERS must be > 0');

  const url = `${BASE_URL}/api/performances/${PERFORMANCE_ID}/seats`;
  console.log(`setup url=${url}`);

  const seatsRes = http.get(url);
  console.log(`status=${seatsRes.status}`);
  if (seatsRes.status !== 200) {
    fail(`Failed to fetch seats in setup. status=${seatsRes.status} body=${seatsRes.body}`);
  }
  check(seatsRes, { 'setup seats request succeeded': (r) => r.status === 200 }) || fail('Failed to fetch seats in setup');

  const seats = seatsRes.json();
  if (!Array.isArray(seats) || seats.length === 0) {
    fail(`Unexpected or empty seats payload in setup. status=${seatsRes.status} body=${seatsRes.body}`);
  }

  const availableSeats = seats.filter((s) => s && s.status === 'available');
  console.log(`total seats=${seats.length}`);
  console.log(`available seats=${availableSeats.length}`);

  if (availableSeats.length === 0) {
    fail('No available seats found in setup');
  }

  const availableSeatIds = availableSeats
    .filter((seat) => typeof seat.id === 'string')
    .map((seat) => seat.id);

  if (availableSeatIds.length < TARGET_BUYERS) {
    fail(`Not enough available seats. Need ${TARGET_BUYERS}, found ${availableSeatIds.length}`);
  }

  return {
    seats: availableSeats,
    baseUrl: BASE_URL,
    performanceId: PERFORMANCE_ID,
    seatIds: availableSeatIds,
    enableCheckout: ENABLE_CHECKOUT,
  };
}

function buildClientToken() {
  const vu = exec.vu.idInTest;
  const iter = exec.scenario.iterationInTest;
  return `k6-${vu}-${iter}-${Date.now()}`;
}

function pickSeatId(seatIds) {
  const idx = (exec.vu.idInTest - 1) % seatIds.length;
  return seatIds[idx];
}

export default function (data) {
  buyersAttempted.add(1);

  const seatId = pickSeatId(data.seatIds);
  const clientToken = buildClientToken();

  const holdPayload = JSON.stringify({
    performanceId: data.performanceId,
    seatIds: [seatId],
    clientToken,
  });

  const holdRes = http.post(`${data.baseUrl}/api/hold`, holdPayload, {
    headers: { 'Content-Type': 'application/json' },
    tags: { endpoint: 'hold' },
  });
  holdDuration.add(holdRes.timings.duration);
  holdOk.add(holdRes.status === 200);
  holdConflict.add(holdRes.status === 409);

  if (!check(holdRes, { 'hold status is 200 or 409': (r) => r.status === 200 || r.status === 409 })) {
    return;
  }
  if (holdRes.status !== 200) {
    return;
  }

  if (!data.enableCheckout) {
    return;
  }

  const holdBody = holdRes.json();
  const heldSeatIds = Array.isArray(holdBody.heldSeatIds) ? holdBody.heldSeatIds : [seatId];

  const checkoutPayload = JSON.stringify({
    performanceId: data.performanceId,
    checkoutMode: 'PAID',
    seatIds: heldSeatIds,
    holdToken: holdBody.holdToken,
    clientToken,
    customerEmail: `loadtest+${exec.vu.idInTest}@example.com`,
    customerName: `Load Test User ${exec.vu.idInTest}`,
    customerPhone: '6105550000',
  });

  const checkoutRes = http.post(`${data.baseUrl}/api/checkout`, checkoutPayload, {
    headers: { 'Content-Type': 'application/json' },
    tags: { endpoint: 'checkout' },
  });
  checkoutDuration.add(checkoutRes.timings.duration);

  const status = checkoutRes.status;
  checkoutOk.add(status === 200);
  checkoutConflict.add(status === 409);
  checkoutRateLimited.add(status === 429);
  checkoutServerError.add(status >= 500 && status <= 599);

  if (status === 200) {
    buyersCompletedCheckout.add(1);
  }

  check(checkoutRes, { 'checkout status is 200/409/429': (r) => r.status === 200 || r.status === 409 || r.status === 429 });
}

export function handleSummary(data) {
  const attempted = data.metrics.buyers_attempted?.values?.count || 0;
  const completed = data.metrics.buyers_completed_checkout?.values?.count || 0;
  const completionRate = attempted > 0 ? ((completed / attempted) * 100).toFixed(2) : '0.00';

  return {
    stdout: [
      '',
      '=== Flash Sale Summary ===',
      `Target buyers: ${TARGET_BUYERS}`,
      `Attempted buyers: ${attempted}`,
      `Completed checkout (HTTP 200): ${completed}`,
      `Completion rate: ${completionRate}%`,
      `Checkout enabled: ${ENABLE_CHECKOUT}`,
      `Spike mode: ${SPIKE_MODE}`,
      '',
    ].join('\n'),
  };
}
