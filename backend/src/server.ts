import './lib/load-env.js';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { env, getAllowedOrigins } from './lib/env.js';
import { prisma } from './lib/prisma.js';
import { helmetPlugin } from './plugins/helmet.js';
import { CORS_ALLOWED_HEADERS, CORS_METHODS, corsPlugin, isAllowedOrigin } from './plugins/cors.js';
import { jwtPlugin } from './plugins/jwt.js';
import { rawBodyPlugin } from './plugins/raw-body.js';
import { rateLimitPlugin } from './plugins/rate-limit.js';
import { adminAuthPlugin } from './plugins/admin-auth.js';
import { userAuthPlugin } from './plugins/user-auth.js';
import { tripAccountAuthPlugin } from './plugins/trip-account-auth.js';
import { deviceAuthPlugin } from './plugins/device-auth.js';
import { healthRoutes } from './routes/health.js';
import { performanceRoutes } from './routes/performances.js';
import { holdRoutes } from './routes/hold.js';
import { checkoutRoutes } from './routes/checkout.js';
import { stripeWebhookRoutes } from './routes/webhooks-stripe.js';
import { ticketRoutes } from './routes/tickets.js';
import { adminAuthRoutes } from './routes/admin-auth.js';
import { adminDashboardRoutes } from './routes/admin-dashboard.js';
import { adminFinanceRoutes } from './routes/admin-finance.js';
import { adminPerformanceRoutes } from './routes/admin-performances.js';
import { adminSeatRoutes } from './routes/admin-seats.js';
import { adminOrderRoutes } from './routes/admin-orders.js';
import { adminRosterRoutes } from './routes/admin-roster.js';
import { adminAuditRoutes } from './routes/admin-audit.js';
import { showRoutes } from './routes/shows.js';
import { programBioFormRoutes } from './routes/program-bio-forms.js';
import { seniorSendoffFormRoutes } from './routes/senior-sendoff-forms.js';
import { fundraisingRoutes } from './routes/fundraising.js';
import { fundraisingSponsorRoutes } from './routes/fundraising-sponsors.js';
import { calendarRoutes } from './routes/calendar.js';
import { orderRoutes } from './routes/orders.js';
import { freeClaimRoutes } from './routes/free-claims.js';
import { authRoutes } from './routes/auth.js';
import { staffRoutes } from './routes/staff.js';
import { staffCompRoutes } from './routes/staff-comp.js';
import { adminStaffRoutes } from './routes/admin-staff.js';
import { studentCreditRoutes } from './routes/student-credits.js';
import { adminCheckInRoutes } from './routes/admin-checkin.js';
import { adminUserRoutes } from './routes/admin-users.js';
import { aboutContentRoutes } from './routes/about-content.js';
import { adminUploadRoutes } from './routes/admin-uploads.js';
import { mobileRoutes } from './routes/mobile.js';
import { tripAuthRoutes } from './routes/trip-auth.js';
import { tripPortalRoutes } from './routes/trips-portal.js';
import { adminTripRoutes } from './routes/admin-trips.js';
import { adminDriveRoutes } from './routes/admin-drive.js';
import { mobileDeviceRoutes } from './routes/mobile-device.js';
import { adminDeviceRoutes } from './routes/admin-devices.js';
import { startCheckoutQueueWorker } from './services/checkout-queue-worker.js';
import { startHoldCleanupScheduler } from './services/hold-cleanup-scheduler.js';
import { startHealthAlertMonitor } from './services/health-alert-monitor.js';

export async function createServer() {
  const uploadBodyLimitBytes = Math.max(16 * 1024 * 1024, Math.ceil(env.R2_MAX_UPLOAD_BYTES * 1.5));

  const app = Fastify({
    logger: env.NODE_ENV === 'development',
    bodyLimit: uploadBodyLimitBytes,
    trustProxy: env.TRUST_PROXY_HOPS > 0 ? env.TRUST_PROXY_HOPS : false
  });

  if (env.NODE_ENV === 'production' && env.TRUST_PROXY_HOPS === 0) {
    app.log.warn(
      'TRUST_PROXY_HOPS is 0 in production; client IP attribution and rate limiting may be incorrect behind a proxy.'
    );
  }

  await app.register(helmetPlugin);
  await app.register(corsPlugin);
  await app.register(jwtPlugin);
  await app.register(rawBodyPlugin);
  await app.register(rateLimitPlugin);
  await app.register(adminAuthPlugin);
  await app.register(userAuthPlugin);
  await app.register(tripAccountAuthPlugin);
  await app.register(deviceAuthPlugin);

  const allowedOrigins = getAllowedOrigins();
  app.options('/api/*', async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && isAllowedOrigin(origin, allowedOrigins)) {
      reply.header('Access-Control-Allow-Origin', origin);
      reply.header('Vary', 'Origin');
      reply.header('Access-Control-Allow-Credentials', 'true');
      reply.header('Access-Control-Allow-Methods', CORS_METHODS.join(', '));
      reply.header(
        'Access-Control-Allow-Headers',
        String(request.headers['access-control-request-headers'] ?? CORS_ALLOWED_HEADERS.join(', '))
      );
    }

    return reply.code(204).send();
  });

  // Public routes
  await app.register(healthRoutes);
  await app.register(performanceRoutes);
  await app.register(holdRoutes);
  await app.register(checkoutRoutes);
  await app.register(stripeWebhookRoutes);
  await app.register(orderRoutes);
  await app.register(ticketRoutes);
  await app.register(freeClaimRoutes);
  await app.register(authRoutes);
  await app.register(staffRoutes);
  await app.register(staffCompRoutes);
  await app.register(aboutContentRoutes);
  await app.register(mobileRoutes);
  await app.register(mobileDeviceRoutes);
  await app.register(programBioFormRoutes);
  await app.register(seniorSendoffFormRoutes);
  await app.register(tripAuthRoutes);
  await app.register(tripPortalRoutes);

  // Compatibility routes
  await app.register(showRoutes);
  await app.register(fundraisingRoutes);
  await app.register(fundraisingSponsorRoutes);
  await app.register(calendarRoutes);

  // Admin routes
  await app.register(adminAuthRoutes);
  await app.register(adminDashboardRoutes);
  await app.register(adminFinanceRoutes);
  await app.register(adminPerformanceRoutes);
  await app.register(adminSeatRoutes);
  await app.register(adminOrderRoutes);
  await app.register(adminRosterRoutes);
  await app.register(adminAuditRoutes);
  await app.register(adminStaffRoutes);
  await app.register(studentCreditRoutes);
  await app.register(adminCheckInRoutes);
  await app.register(adminUserRoutes);
  await app.register(adminUploadRoutes);
  await app.register(adminTripRoutes);
  await app.register(adminDriveRoutes);
  await app.register(adminDeviceRoutes);

  const backgroundControllers: Array<{ stop: () => void | Promise<void> }> = [];

  if (env.ENABLE_IN_PROCESS_CHECKOUT_QUEUE_WORKER) {
    const checkoutQueueWorker = startCheckoutQueueWorker(app.log);
    backgroundControllers.push({
      stop: () => checkoutQueueWorker.stop()
    });
    app.log.info({ maxActiveWorkers: env.CHECKOUT_MAX_ACTIVE }, 'in-process checkout queue worker enabled');
  }

  if (env.ENABLE_IN_PROCESS_HOLD_CLEANUP_SCHEDULER) {
    const holdCleanupScheduler = startHoldCleanupScheduler(app.log);
    backgroundControllers.push({
      stop: () => holdCleanupScheduler.stop()
    });
    app.log.info('in-process hold cleanup scheduler enabled');
  }

  if (env.ENABLE_IN_PROCESS_HEALTH_ALERT_MONITOR) {
    const healthAlertMonitor = startHealthAlertMonitor(app.log);
    backgroundControllers.push({
      stop: () => healthAlertMonitor.stop()
    });
    app.log.info('in-process health alert monitor enabled');
  }

  if (backgroundControllers.length > 0) {
    app.addHook('onClose', async () => {
      for (const controller of backgroundControllers) {
        await controller.stop();
      }
    });
  }

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    const statusCode =
      typeof (error as { statusCode?: unknown }).statusCode === 'number'
        ? (error as { statusCode: number }).statusCode
        : 500;

    if (statusCode >= 500) {
      reply.status(statusCode).send({ error: 'Internal server error' });
      return;
    }

    const errorMessage = error instanceof Error ? error.message : 'Request failed';
    reply.status(statusCode).send({ error: errorMessage || 'Request failed' });
  });

  return app;
}

async function start() {
  const app = await createServer();

  try {
    await app.listen({
      host: '0.0.0.0',
      port: env.PORT
    });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  const shutdown = async () => {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

const entryFile = process.argv[1];
if (entryFile && fileURLToPath(import.meta.url) === entryFile) {
  void start();
}
