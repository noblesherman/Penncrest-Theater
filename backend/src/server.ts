import './lib/load-env.js';
import Fastify from 'fastify';
import { env } from './lib/env.js';
import { prisma } from './lib/prisma.js';
import { corsPlugin } from './plugins/cors.js';
import { jwtPlugin } from './plugins/jwt.js';
import { rawBodyPlugin } from './plugins/raw-body.js';
import { rateLimitPlugin } from './plugins/rate-limit.js';
import { adminAuthPlugin } from './plugins/admin-auth.js';
import { userAuthPlugin } from './plugins/user-auth.js';
import { healthRoutes } from './routes/health.js';
import { performanceRoutes } from './routes/performances.js';
import { holdRoutes } from './routes/hold.js';
import { checkoutRoutes } from './routes/checkout.js';
import { stripeWebhookRoutes } from './routes/webhooks-stripe.js';
import { ticketRoutes } from './routes/tickets.js';
import { adminAuthRoutes } from './routes/admin-auth.js';
import { adminDashboardRoutes } from './routes/admin-dashboard.js';
import { adminPerformanceRoutes } from './routes/admin-performances.js';
import { adminSeatRoutes } from './routes/admin-seats.js';
import { adminOrderRoutes } from './routes/admin-orders.js';
import { adminRosterRoutes } from './routes/admin-roster.js';
import { adminAuditRoutes } from './routes/admin-audit.js';
import { showRoutes } from './routes/shows.js';
import { calendarRoutes } from './routes/calendar.js';
import { orderRoutes } from './routes/orders.js';
import { freeClaimRoutes } from './routes/free-claims.js';
import { authRoutes } from './routes/auth.js';
import { staffRoutes } from './routes/staff.js';
import { staffCompRoutes } from './routes/staff-comp.js';
import { adminStaffRoutes } from './routes/admin-staff.js';
import { studentCreditRoutes } from './routes/student-credits.js';
import { releaseExpiredHolds } from './services/hold-service.js';

async function createServer() {
  const app = Fastify({
    logger: env.NODE_ENV === 'development'
  });

  await app.register(corsPlugin);
  await app.register(jwtPlugin);
  await app.register(rawBodyPlugin);
  await app.register(rateLimitPlugin);
  await app.register(adminAuthPlugin);
  await app.register(userAuthPlugin);

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

  // Compatibility routes
  await app.register(showRoutes);
  await app.register(calendarRoutes);

  // Admin routes
  await app.register(adminAuthRoutes);
  await app.register(adminDashboardRoutes);
  await app.register(adminPerformanceRoutes);
  await app.register(adminSeatRoutes);
  await app.register(adminOrderRoutes);
  await app.register(adminRosterRoutes);
  await app.register(adminAuditRoutes);
  await app.register(adminStaffRoutes);
  await app.register(studentCreditRoutes);

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    reply.status(500).send({ error: 'Internal server error' });
  });

  return app;
}

async function start() {
  const app = await createServer();

  const cleanupIntervalMs = env.HOLD_CLEANUP_INTERVAL_SECONDS * 1000;
  const interval = setInterval(async () => {
    try {
      await releaseExpiredHolds();
    } catch (err) {
      app.log.error(err);
    }
  }, cleanupIntervalMs);

  interval.unref();

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
    clearInterval(interval);
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start();
