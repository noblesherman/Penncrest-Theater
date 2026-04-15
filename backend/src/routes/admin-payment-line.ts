import { FastifyPluginAsync } from 'fastify';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { handleRouteError } from '../lib/route-error.js';
import { HttpError } from '../lib/http-error.js';
import { prisma } from '../lib/prisma.js';
import { env, getAllowedOrigins } from '../lib/env.js';
import { isAllowedOrigin } from '../plugins/cors.js';
import {
  backToLineEntry,
  cancelPaymentLineEntry,
  fetchPaymentLineEntry,
  fetchPaymentLineSnapshot,
  publishNowServingChanged,
  publishQueueAndEntry
} from '../services/payment-line-service.js';
import { buildPaymentLineClientId, registerPaymentLineSseClient } from '../services/payment-line-events.js';

const enqueueSchema = z.object({
  performanceId: z.string().min(1),
  seatIds: z.array(z.string().min(1)).min(1).max(50),
  ticketSelectionBySeatId: z.record(z.string().min(1), z.string().min(1)),
  customerName: z.string().max(120).optional(),
  receiptEmail: z.string().email().optional(),
  sendReceipt: z.boolean().optional(),
  studentCode: z.string().min(1).optional(),
  deviceId: z.string().min(1).max(200),
  sellerStationName: z.string().trim().max(120).optional(),
  sellerClientSessionId: z.string().trim().max(160).optional(),
  submissionId: z.string().trim().max(160).optional()
});

const entryParamsSchema = z.object({
  id: z.string().min(1)
});

const queueSnapshotQuerySchema = z.object({
  queueKey: z.string().min(1)
});

const eventsTokenQuerySchema = z.object({
  queueKey: z.string().min(1)
});

const eventsQuerySchema = z.object({
  token: z.string().min(8)
});

export const adminPaymentLineRoutes: FastifyPluginAsync = async (app) => {
  const allowedOrigins = getAllowedOrigins();
  const applySseCorsHeaders = (origin: unknown, reply: FastifyReply) => {
    if (typeof origin !== 'string' || !isAllowedOrigin(origin, allowedOrigins)) {
      return;
    }
    reply.raw.setHeader('Access-Control-Allow-Origin', origin);
    reply.raw.setHeader('Vary', 'Origin');
    reply.raw.setHeader('Access-Control-Allow-Credentials', 'true');
  };

  app.post('/api/admin/payment-line/enqueue', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsed = enqueueSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const payload = {
        ...parsed.data,
        sellerAdminId: request.adminUser?.id || null
      };

      if (payload.sellerClientSessionId && payload.submissionId) {
        const existing = await prisma.terminalPaymentDispatch.findFirst({
          where: {
            queueKey: parsed.data.deviceId,
            sellerClientSessionId: payload.sellerClientSessionId,
            saleSnapshot: {
              path: ['submissionId'],
              equals: payload.submissionId
            }
          },
          orderBy: [{ createdAt: 'desc' }],
          select: { id: true }
        });

        if (existing) {
          const entry = await fetchPaymentLineEntry(existing.id);
          return reply.send(entry);
        }
      }

      const forwarded = await app.inject({
        method: 'POST',
        url: '/api/admin/orders/in-person/terminal/send',
        headers: {
          authorization: request.headers.authorization || ''
        },
        payload
      });

      const body = forwarded.json();
      if (forwarded.statusCode < 200 || forwarded.statusCode >= 300) {
        return reply.status(forwarded.statusCode).send(body);
      }

      if (typeof body.dispatchId === 'string') {
        await publishQueueAndEntry(parsed.data.deviceId, body.dispatchId).catch(() => undefined);
        const entry = await fetchPaymentLineEntry(body.dispatchId);
        return reply.status(forwarded.statusCode).send(entry);
      }

      return reply.status(forwarded.statusCode).send(body);
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to enqueue payment line entry');
    }
  });

  app.get('/api/admin/payment-line/entry/:id', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsed = entryParamsSchema.safeParse(request.params || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const entry = await fetchPaymentLineEntry(parsed.data.id);
      reply.send(entry);
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to load payment line entry');
    }
  });

  app.get('/api/admin/payment-line/snapshot', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsed = queueSnapshotQuerySchema.safeParse(request.query || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const snapshot = await fetchPaymentLineSnapshot(parsed.data.queueKey);
      reply.send(snapshot);
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to load payment line snapshot');
    }
  });

  app.post('/api/admin/payment-line/entry/:id/back-to-line', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsed = entryParamsSchema.safeParse(request.params || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const before = await fetchPaymentLineEntry(parsed.data.id);
      const updated = await backToLineEntry({
        entryId: parsed.data.id,
        reason: 'Moved to back of line'
      });

      if (before.nowServingEntryId !== updated.nowServingEntryId) {
        await publishNowServingChanged(updated.queueKey, updated.nowServingEntryId);
      }

      reply.send(updated);
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to move payment line entry to back of line');
    }
  });

  app.post('/api/admin/payment-line/entry/:id/cancel', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsed = entryParamsSchema.safeParse(request.params || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const before = await fetchPaymentLineEntry(parsed.data.id);
      const updated = await cancelPaymentLineEntry({
        entryId: parsed.data.id,
        reason: 'Canceled by cashier'
      });

      if (before.nowServingEntryId !== updated.nowServingEntryId) {
        await publishNowServingChanged(updated.queueKey, updated.nowServingEntryId);
      }

      reply.send(updated);
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to cancel payment line entry');
    }
  });

  app.post('/api/admin/payment-line/entry/:id/retry-now', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsed = entryParamsSchema.safeParse(request.params || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const before = await fetchPaymentLineEntry(parsed.data.id);
      const forwarded = await app.inject({
        method: 'POST',
        url: `/api/admin/orders/in-person/terminal/dispatch/${encodeURIComponent(parsed.data.id)}/retry`,
        headers: {
          authorization: request.headers.authorization || ''
        }
      });

      const body = forwarded.json();
      if (forwarded.statusCode < 200 || forwarded.statusCode >= 300) {
        return reply.status(forwarded.statusCode).send(body);
      }

      const updated = await fetchPaymentLineEntry(parsed.data.id);
      if (before.nowServingEntryId !== updated.nowServingEntryId) {
        await publishNowServingChanged(updated.queueKey, updated.nowServingEntryId);
      }

      reply.status(forwarded.statusCode).send(updated);
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to retry payment line entry');
    }
  });

  app.get('/api/admin/payment-line/events/token', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsed = eventsTokenQuerySchema.safeParse(request.query || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const token = await app.jwt.sign(
        {
          role: 'admin_payment_line_events',
          purpose: 'admin-payment-line-events',
          adminId: request.adminUser!.id,
          queueKey: parsed.data.queueKey
        },
        { expiresIn: '8h' }
      );

      reply.send({ token });
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to issue payment line events token');
    }
  });

  app.get('/api/admin/payment-line/events', async (request, reply) => {
    const parsed = eventsQuerySchema.safeParse(request.query || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const payload = await app.jwt.verify<{
        role?: string;
        purpose?: string;
        adminId?: string;
        queueKey?: string;
      }>(parsed.data.token);

      if (
        payload.role !== 'admin_payment_line_events' ||
        payload.purpose !== 'admin-payment-line-events' ||
        !payload.adminId ||
        !payload.queueKey
      ) {
        throw new HttpError(403, 'Forbidden');
      }

      const adminUser = await prisma.adminUser.findUnique({
        where: { id: payload.adminId },
        select: { id: true, isActive: true }
      });

      if (!adminUser?.isActive) {
        throw new HttpError(403, 'Account inactive');
      }

      applySseCorsHeaders(request.headers.origin, reply);
      reply.raw.setHeader('Content-Type', 'text/event-stream');
      reply.raw.setHeader('Cache-Control', 'no-cache');
      reply.raw.setHeader('Connection', 'keep-alive');
      reply.raw.flushHeaders?.();

      const client = {
        id: buildPaymentLineClientId(),
        write: (chunk: string) => reply.raw.write(chunk)
      };
      const unsubscribe = registerPaymentLineSseClient(payload.queueKey, client);

      const keepAlive = setInterval(() => {
        reply.raw.write(`event: ping\ndata: {"t":"${new Date().toISOString()}"}\n\n`);
      }, env.PAYMENT_LINE_SSE_HEARTBEAT_SECONDS * 1_000);

      const snapshot = await fetchPaymentLineSnapshot(payload.queueKey);
      reply.raw.write(
        `event: ready\ndata: ${JSON.stringify({
          queueKey: payload.queueKey,
          heartbeatSeconds: env.PAYMENT_LINE_SSE_HEARTBEAT_SECONDS,
          wallboardDefaultLimit: env.PAYMENT_LINE_WALLBOARD_DEFAULT_LIMIT
        })}\n\n`
      );
      reply.raw.write(`event: queue_snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);

      request.raw.on('close', () => {
        clearInterval(keepAlive);
        unsubscribe();
      });
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to start payment line stream');
    }
  });
};
