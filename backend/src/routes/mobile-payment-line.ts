import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { handleRouteError } from '../lib/route-error.js';
import {
  backToLineEntry,
  cancelPaymentLineEntry,
  fetchPaymentLineEntry,
  fetchPaymentLineSnapshot,
  heartbeatPaymentLineEntry,
  publishNowServingChanged,
  publishQueueAndEntry,
  startPaymentLineEntry
} from '../services/payment-line-service.js';

const entryParamsSchema = z.object({
  id: z.string().min(1)
});

const snapshotQuerySchema = z.object({
  deviceId: z.string().trim().min(1).max(200)
});

const startBodySchema = z.object({
  deviceId: z.string().trim().min(1).max(200)
});

const heartbeatBodySchema = z.object({
  deviceId: z.string().trim().min(1).max(200)
});

const completeBodySchema = z.object({
  deviceId: z.string().trim().min(1).max(200),
  mockApproved: z.boolean().optional(),
  paymentIntentId: z.string().trim().min(1).optional()
});

const failBodySchema = z.object({
  deviceId: z.string().trim().min(1).max(200),
  failureReason: z.string().trim().min(1).max(500).optional()
});

const backToLineBodySchema = z.object({
  deviceId: z.string().trim().min(1).max(200).optional()
});

const cancelBodySchema = z.object({
  deviceId: z.string().trim().min(1).max(200).optional()
});

export const mobilePaymentLineRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/mobile/payment-line/snapshot', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsed = snapshotQuerySchema.safeParse(request.query || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const snapshot = await fetchPaymentLineSnapshot(parsed.data.deviceId);
      reply.send(snapshot);
    } catch (err) {
      handleRouteError(reply, err, 'Unable to load payment line snapshot');
    }
  });

  app.post('/api/mobile/payment-line/entry/:id/start', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsedParams = entryParamsSchema.safeParse(request.params || {});
    const parsedBody = startBodySchema.safeParse(request.body || {});
    if (!parsedParams.success || !parsedBody.success) {
      return reply.status(400).send({
        error: {
          params: parsedParams.success ? undefined : parsedParams.error.flatten(),
          body: parsedBody.success ? undefined : parsedBody.error.flatten()
        }
      });
    }

    try {
      const before = await fetchPaymentLineSnapshot(parsedBody.data.deviceId);
      const entry = await startPaymentLineEntry({
        entryId: parsedParams.data.id,
        deviceId: parsedBody.data.deviceId
      });

      if (before.nowServingEntryId !== entry.nowServingEntryId) {
        await publishNowServingChanged(entry.queueKey, entry.nowServingEntryId);
      }

      reply.send(entry);
    } catch (err) {
      handleRouteError(reply, err, 'Unable to start payment line entry');
    }
  });

  app.post('/api/mobile/payment-line/entry/:id/heartbeat', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsedParams = entryParamsSchema.safeParse(request.params || {});
    const parsedBody = heartbeatBodySchema.safeParse(request.body || {});
    if (!parsedParams.success || !parsedBody.success) {
      return reply.status(400).send({
        error: {
          params: parsedParams.success ? undefined : parsedParams.error.flatten(),
          body: parsedBody.success ? undefined : parsedBody.error.flatten()
        }
      });
    }

    try {
      const result = await heartbeatPaymentLineEntry({
        entryId: parsedParams.data.id,
        deviceId: parsedBody.data.deviceId
      });
      reply.send(result);
    } catch (err) {
      handleRouteError(reply, err, 'Unable to heartbeat payment line entry');
    }
  });

  app.post('/api/mobile/payment-line/entry/:id/complete', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsedParams = entryParamsSchema.safeParse(request.params || {});
    const parsedBody = completeBodySchema.safeParse(request.body || {});
    if (!parsedParams.success || !parsedBody.success) {
      return reply.status(400).send({
        error: {
          params: parsedParams.success ? undefined : parsedParams.error.flatten(),
          body: parsedBody.success ? undefined : parsedBody.error.flatten()
        }
      });
    }

    try {
      const before = await fetchPaymentLineSnapshot(parsedBody.data.deviceId);

      const forwarded = await app.inject({
        method: 'POST',
        url: `/api/mobile/terminal/dispatch/${encodeURIComponent(parsedParams.data.id)}/complete`,
        headers: {
          authorization: request.headers.authorization || ''
        },
        payload: parsedBody.data
      });

      const body = forwarded.json();
      if (forwarded.statusCode < 200 || forwarded.statusCode >= 300) {
        return reply.status(forwarded.statusCode).send(body);
      }

      const entry = await fetchPaymentLineEntry(parsedParams.data.id);
      if (before.nowServingEntryId !== entry.nowServingEntryId) {
        await publishNowServingChanged(entry.queueKey, entry.nowServingEntryId);
      }
      await publishQueueAndEntry(entry.queueKey, entry.entryId);

      reply.status(forwarded.statusCode).send(body);
    } catch (err) {
      handleRouteError(reply, err, 'Unable to complete payment line entry');
    }
  });

  app.post('/api/mobile/payment-line/entry/:id/fail', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsedParams = entryParamsSchema.safeParse(request.params || {});
    const parsedBody = failBodySchema.safeParse(request.body || {});
    if (!parsedParams.success || !parsedBody.success) {
      return reply.status(400).send({
        error: {
          params: parsedParams.success ? undefined : parsedParams.error.flatten(),
          body: parsedBody.success ? undefined : parsedBody.error.flatten()
        }
      });
    }

    try {
      const before = await fetchPaymentLineSnapshot(parsedBody.data.deviceId);

      const forwarded = await app.inject({
        method: 'POST',
        url: `/api/mobile/terminal/dispatch/${encodeURIComponent(parsedParams.data.id)}/status`,
        headers: {
          authorization: request.headers.authorization || ''
        },
        payload: {
          deviceId: parsedBody.data.deviceId,
          status: 'FAILED',
          failureReason: parsedBody.data.failureReason
        }
      });

      const body = forwarded.json();
      if (forwarded.statusCode < 200 || forwarded.statusCode >= 300) {
        return reply.status(forwarded.statusCode).send(body);
      }

      const entry = await fetchPaymentLineEntry(parsedParams.data.id);
      if (before.nowServingEntryId !== entry.nowServingEntryId) {
        await publishNowServingChanged(entry.queueKey, entry.nowServingEntryId);
      }
      await publishQueueAndEntry(entry.queueKey, entry.entryId);

      reply.status(forwarded.statusCode).send(entry);
    } catch (err) {
      handleRouteError(reply, err, 'Unable to fail payment line entry');
    }
  });

  app.post('/api/mobile/payment-line/entry/:id/back-to-line', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsedParams = entryParamsSchema.safeParse(request.params || {});
    const parsedBody = backToLineBodySchema.safeParse(request.body || {});
    if (!parsedParams.success || !parsedBody.success) {
      return reply.status(400).send({
        error: {
          params: parsedParams.success ? undefined : parsedParams.error.flatten(),
          body: parsedBody.success ? undefined : parsedBody.error.flatten()
        }
      });
    }

    try {
      const before = await fetchPaymentLineEntry(parsedParams.data.id);
      if (parsedBody.data.deviceId && parsedBody.data.deviceId !== before.targetDeviceId) {
        return reply.status(403).send({ error: 'Entry is assigned to a different payment device' });
      }

      const updated = await backToLineEntry({
        entryId: parsedParams.data.id,
        reason: 'Moved to back of line'
      });

      if (before.nowServingEntryId !== updated.nowServingEntryId) {
        await publishNowServingChanged(updated.queueKey, updated.nowServingEntryId);
      }

      reply.send(updated);
    } catch (err) {
      handleRouteError(reply, err, 'Unable to move payment line entry to back of line');
    }
  });

  app.post('/api/mobile/payment-line/entry/:id/cancel', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsedParams = entryParamsSchema.safeParse(request.params || {});
    const parsedBody = cancelBodySchema.safeParse(request.body || {});
    if (!parsedParams.success || !parsedBody.success) {
      return reply.status(400).send({
        error: {
          params: parsedParams.success ? undefined : parsedParams.error.flatten(),
          body: parsedBody.success ? undefined : parsedBody.error.flatten()
        }
      });
    }

    try {
      const before = await fetchPaymentLineEntry(parsedParams.data.id);
      if (parsedBody.data.deviceId && parsedBody.data.deviceId !== before.targetDeviceId) {
        return reply.status(403).send({ error: 'Entry is assigned to a different payment device' });
      }

      const updated = await cancelPaymentLineEntry({
        entryId: parsedParams.data.id,
        reason: 'Canceled by operator'
      });

      if (before.nowServingEntryId !== updated.nowServingEntryId) {
        await publishNowServingChanged(updated.queueKey, updated.nowServingEntryId);
      }

      reply.send(updated);
    } catch (err) {
      handleRouteError(reply, err, 'Unable to cancel payment line entry');
    }
  });
};
