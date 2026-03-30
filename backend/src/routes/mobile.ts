import crypto from 'node:crypto';
import Stripe from 'stripe';
import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { env } from '../lib/env.js';
import { prisma } from '../lib/prisma.js';
import { stripe } from '../lib/stripe.js';
import { HttpError } from '../lib/http-error.js';
import { handleRouteError } from '../lib/route-error.js';
import { createTicketSignature } from '../lib/qr.js';
import { createAssignedOrder } from '../services/order-assignment.js';
import { releaseHoldByToken, syncSeatHold } from '../services/hold-service.js';
import { logAudit } from '../lib/audit-log.js';
import {
  expireDeviceDispatches,
  expireExpiredTerminalDispatches,
  expireTerminalDispatchIfNeeded,
  getActiveTerminalDeviceSession,
  heartbeatTerminalDeviceSession,
  parseTerminalDispatchSnapshot,
  registerTerminalDeviceSession,
  TERMINAL_NEXT_DISPATCH_WAIT_MS,
  touchTerminalDispatchPoll
} from '../services/terminal-dispatch-service.js';

const createPaymentIntentSchema = z.object({
  performanceId: z.string().min(1),
  pricingTierId: z.string().min(1),
  quantity: z.coerce.number().int().min(1).max(20),
  customerName: z.string().trim().max(120).optional(),
  receiptEmail: z.string().email().optional()
});

const completePaymentSchema = z.object({
  paymentIntentId: z.string().min(1),
  mockApproved: z.boolean().optional()
});

const terminalDeviceRegisterSchema = z.object({
  deviceId: z.string().trim().min(1).max(200),
  terminalName: z.string().trim().min(1).max(120)
});

const terminalDeviceHeartbeatSchema = z.object({
  deviceId: z.string().trim().min(1).max(200)
});

const terminalNextDispatchSchema = z.object({
  deviceId: z.string().trim().min(1).max(200),
  waitMs: z.coerce.number().int().min(1_000).max(30_000).optional()
});

const terminalDispatchStatusSchema = z.object({
  deviceId: z.string().trim().min(1).max(200),
  status: z.enum(['PROCESSING', 'FAILED']),
  failureReason: z.string().trim().min(1).max(500).optional()
});

const terminalDispatchCompleteSchema = z.object({
  deviceId: z.string().trim().min(1).max(200),
  mockApproved: z.boolean().optional(),
  paymentIntentId: z.string().trim().min(1).optional()
});

const terminalDispatchManualPaymentIntentSchema = z.object({
  deviceId: z.string().trim().min(1).max(200)
});

const terminalDispatchTelemetrySchema = z.object({
  deviceId: z.string().trim().min(1).max(200),
  stage: z.string().trim().min(1).max(120),
  paymentMethod: z.enum(['TAP_TO_PAY', 'MANUAL', 'UNKNOWN']).optional(),
  paymentIntentId: z.string().trim().min(1).max(200).optional(),
  failureReason: z.string().trim().min(1).max(500).optional(),
  metadata: z.unknown().optional()
});

const scanValidateSchema = z.object({
  scannedCode: z.string().min(1),
  performanceId: z.string().min(1).optional(),
  gate: z.string().trim().min(1).max(64).optional()
});

type ScanReference =
  | { kind: 'qr'; ticketId: string; signature: string }
  | { kind: 'publicId'; publicId: string }
  | { kind: 'invalid' };

function sortSeats<T extends { sectionName: string; row: string; number: number }>(seats: T[]): T[] {
  return [...seats].sort((a, b) => {
    if (a.sectionName !== b.sectionName) return a.sectionName.localeCompare(b.sectionName);
    if (a.row !== b.row) return a.row.localeCompare(b.row, undefined, { numeric: true, sensitivity: 'base' });
    return a.number - b.number;
  });
}

function normalizeScannedInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const match = url.pathname.match(/\/tickets\/([^/]+)/i);
      if (match?.[1]) return decodeURIComponent(match[1]).trim();
    } catch {
      return trimmed;
    }
  }

  return trimmed;
}

function parseScanReference(value: string): ScanReference {
  const normalized = normalizeScannedInput(value);
  if (!normalized) return { kind: 'invalid' };

  const dotParts = normalized.split('.');
  if (
    dotParts.length === 2 &&
    /^[a-z0-9-]{8,}$/i.test(dotParts[0]) &&
    /^[a-z0-9_-]{8,}$/i.test(dotParts[1])
  ) {
    return {
      kind: 'qr',
      ticketId: dotParts[0],
      signature: dotParts[1]
    };
  }

  if (/^[a-z0-9]+$/i.test(normalized) && normalized.length >= 8) {
    return {
      kind: 'publicId',
      publicId: normalized
    };
  }

  return { kind: 'invalid' };
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function parseMetadataSeatIds(raw: string | undefined): string[] {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === 'string' && value.length > 0);
  } catch {
    return [];
  }
}

function buildSeatLabel(seat: { sectionName: string; row: string; number: number } | null | undefined): string {
  if (!seat) {
    return 'General Admission';
  }
  return `${seat.sectionName} ${seat.row}-${seat.number}`;
}

function buildMobileActor(admin: { username: string }, gate?: string): string {
  const gateLabel = gate?.trim() || 'MOBILE';
  return `${admin.username} @ ${gateLabel}`;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function serializeTerminalDispatchForMobile(dispatch: {
  id: string;
  status: string;
  stripePaymentIntentId: string | null;
  stripePaymentIntentClientSecret: string | null;
  expectedAmountCents: number;
  currency: string;
  holdExpiresAt: Date;
  saleSnapshot: unknown;
}) {
  const snapshot = parseTerminalDispatchSnapshot(dispatch.saleSnapshot);

  return {
    dispatchId: dispatch.id,
    status: dispatch.status,
    paymentIntentId: dispatch.stripePaymentIntentId,
    paymentIntentClientSecret: dispatch.stripePaymentIntentClientSecret,
    expectedAmountCents: dispatch.expectedAmountCents,
    currency: dispatch.currency,
    holdExpiresAt: dispatch.holdExpiresAt.toISOString(),
    performanceId: snapshot.performanceId,
    performanceTitle: snapshot.performanceTitle,
    seats: snapshot.seatIds.map((seatId) => ({
      id: seatId,
      label: snapshot.seatSummaryBySeatId[seatId]?.label || snapshot.seatLabelsBySeatId[seatId] || seatId,
      ticketType: snapshot.ticketTypeBySeatId[seatId] || 'Ticket',
      priceCents: snapshot.priceBySeatId[seatId] ?? 0
    }))
  };
}

export const mobileRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/mobile/preflight', async (_request, reply) => {
    const stripeSecretConfigured = env.STRIPE_SECRET_KEY.startsWith('sk_');
    const stripePublishableConfigured = Boolean(env.STRIPE_PUBLISHABLE_KEY?.trim());
    const status = stripeSecretConfigured ? 'ok' : 'degraded';

    return reply.send({
      status,
      apiReachable: true,
      requiredRoutes: {
        terminalConnectionToken: true,
        terminalDeviceRegister: true,
        terminalDispatchNext: true,
        terminalDispatchStatus: true,
        terminalDispatchComplete: true,
        terminalDispatchTelemetry: true,
        dispatchRetry: true,
        dispatchCancel: true
      },
      stripe: {
        terminalSecretKeyConfigured: stripeSecretConfigured,
        publishableKeyConfigured: stripePublishableConfigured
      }
    });
  });

  app.post('/api/mobile/terminal/connection-token', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    try {
      const token = await stripe.terminal.connectionTokens.create();
      return reply.send({
        secret: token.secret
      });
    } catch (err) {
      if (err instanceof Stripe.errors.StripeError) {
        return reply.status(502).send({ error: err.message || 'Unable to create terminal connection token' });
      }

      handleRouteError(reply, err, 'Unable to create terminal connection token');
    }
  });

  app.post('/api/mobile/terminal/device/register', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsed = terminalDeviceRegisterSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const session = await registerTerminalDeviceSession({
        deviceId: parsed.data.deviceId,
        displayName: parsed.data.terminalName,
        registeredByAdminId: request.adminUser?.id || null
      });

      await logAudit({
        actor: request.user.username || 'admin',
        action: 'MOBILE_TERMINAL_DEVICE_REGISTERED',
        entityType: 'TerminalDevice',
        entityId: session.deviceId,
        metadata: {
          terminalName: session.displayName
        }
      });

      reply.send({
        deviceId: session.deviceId,
        terminalName: session.displayName,
        lastHeartbeatAt: session.lastHeartbeatAt.toISOString()
      });
    } catch (err) {
      handleRouteError(reply, err, 'Unable to register terminal device');
    }
  });

  app.post('/api/mobile/terminal/device/heartbeat', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsed = terminalDeviceHeartbeatSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      await heartbeatTerminalDeviceSession(parsed.data.deviceId);
      reply.send({ ok: true, deviceId: parsed.data.deviceId });
    } catch (err) {
      handleRouteError(reply, err, 'Unable to update terminal heartbeat');
    }
  });

  app.post('/api/mobile/terminal/dispatch/next', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsed = terminalNextDispatchSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const waitMs = parsed.data.waitMs ?? TERMINAL_NEXT_DISPATCH_WAIT_MS;
    const deadline = Date.now() + waitMs;

    try {
      await getActiveTerminalDeviceSession(parsed.data.deviceId);

      while (Date.now() < deadline) {
        await touchTerminalDispatchPoll(parsed.data.deviceId);
        await expireExpiredTerminalDispatches();
        await expireDeviceDispatches(parsed.data.deviceId);

        const processing = await prisma.terminalPaymentDispatch.findFirst({
          where: {
            targetDeviceId: parsed.data.deviceId,
            status: 'PROCESSING',
            stripePaymentIntentId: { not: null },
            stripePaymentIntentClientSecret: { not: null }
          },
          orderBy: [{ processingStartedAt: 'asc' }, { createdAt: 'asc' }]
        });

        if (processing) {
          await expireTerminalDispatchIfNeeded(processing.id);
          const refreshed = await prisma.terminalPaymentDispatch.findUnique({
            where: { id: processing.id }
          });
          if (refreshed && refreshed.status === 'PROCESSING' && refreshed.stripePaymentIntentId && refreshed.stripePaymentIntentClientSecret) {
            return reply.send({
              dispatch: serializeTerminalDispatchForMobile(refreshed)
            });
          }
        }

        const delivered = await prisma.terminalPaymentDispatch.findFirst({
          where: {
            targetDeviceId: parsed.data.deviceId,
            status: 'DELIVERED',
            stripePaymentIntentId: { not: null },
            stripePaymentIntentClientSecret: { not: null }
          },
          orderBy: [{ deliveredAt: 'asc' }, { createdAt: 'asc' }]
        });

        if (delivered) {
          await expireTerminalDispatchIfNeeded(delivered.id);
          const refreshed = await prisma.terminalPaymentDispatch.findUnique({
            where: { id: delivered.id }
          });
          if (refreshed && refreshed.status === 'DELIVERED' && refreshed.stripePaymentIntentId && refreshed.stripePaymentIntentClientSecret) {
            return reply.send({
              dispatch: serializeTerminalDispatchForMobile(refreshed)
            });
          }
        }

        const pending = await prisma.terminalPaymentDispatch.findFirst({
          where: {
            targetDeviceId: parsed.data.deviceId,
            status: 'PENDING',
            stripePaymentIntentId: { not: null },
            stripePaymentIntentClientSecret: { not: null }
          },
          orderBy: [{ createdAt: 'asc' }]
        });

        if (!pending) {
          await wait(1_000);
          continue;
        }

        await expireTerminalDispatchIfNeeded(pending.id);

        const promoted = await prisma.terminalPaymentDispatch.updateMany({
          where: {
            id: pending.id,
            status: 'PENDING',
            holdExpiresAt: { gt: new Date() }
          },
          data: {
            status: 'DELIVERED',
            deliveredAt: new Date()
          }
        });
        if (promoted.count === 0) {
          await wait(250);
          continue;
        }

        const dispatch = await prisma.terminalPaymentDispatch.findUnique({
          where: { id: pending.id }
        });
        if (!dispatch || !dispatch.stripePaymentIntentId || !dispatch.stripePaymentIntentClientSecret) {
          await wait(250);
          continue;
        }

        return reply.send({
          dispatch: serializeTerminalDispatchForMobile(dispatch)
        });
      }

      reply.send({ dispatch: null });
    } catch (err) {
      handleRouteError(reply, err, 'Unable to load terminal dispatch');
    }
  });

  app.post('/api/mobile/terminal/dispatch/:dispatchId/status', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const params = request.params as { dispatchId?: string };
    const parsed = terminalDispatchStatusSchema.safeParse(request.body || {});
    if (!params.dispatchId) {
      return reply.status(400).send({ error: 'Dispatch id is required' });
    }
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      await getActiveTerminalDeviceSession(parsed.data.deviceId);
      await expireTerminalDispatchIfNeeded(params.dispatchId);

      const dispatch = await prisma.terminalPaymentDispatch.findUnique({
        where: { id: params.dispatchId }
      });
      if (!dispatch) {
        throw new HttpError(404, 'Terminal dispatch not found');
      }
      if (dispatch.targetDeviceId !== parsed.data.deviceId) {
        throw new HttpError(403, 'Dispatch is assigned to a different terminal');
      }

      if (parsed.data.status === 'PROCESSING') {
        if (!['PENDING', 'DELIVERED', 'PROCESSING'].includes(dispatch.status)) {
          throw new HttpError(409, `Dispatch is ${dispatch.status} and cannot move to PROCESSING`);
        }

        const updated = await prisma.terminalPaymentDispatch.update({
          where: { id: dispatch.id },
          data: {
            status: 'PROCESSING',
            processingStartedAt: dispatch.processingStartedAt || new Date(),
            failureReason: null
          }
        });

        return reply.send({
          dispatchId: updated.id,
          status: updated.status
        });
      }

      if (['SUCCEEDED', 'EXPIRED', 'CANCELED'].includes(dispatch.status)) {
        throw new HttpError(409, `Dispatch is ${dispatch.status} and cannot be marked failed`);
      }

      const updated = await prisma.terminalPaymentDispatch.update({
        where: { id: dispatch.id },
        data: {
          status: 'FAILED',
          failureReason: parsed.data.failureReason || 'Terminal payment failed'
        }
      });

      await logAudit({
        actor: request.user.username || 'admin',
        action: 'MOBILE_TERMINAL_DISPATCH_FAILED',
        entityType: 'TerminalDispatch',
        entityId: updated.id,
        metadata: {
          failureReason: updated.failureReason
        }
      });

      reply.send({
        dispatchId: updated.id,
        status: updated.status,
        failureReason: updated.failureReason
      });
    } catch (err) {
      handleRouteError(reply, err, 'Unable to update terminal dispatch status');
    }
  });

  app.post('/api/mobile/terminal/dispatch/:dispatchId/manual-payment-intent', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const params = request.params as { dispatchId?: string };
    const parsed = terminalDispatchManualPaymentIntentSchema.safeParse(request.body || {});
    if (!params.dispatchId) {
      return reply.status(400).send({ error: 'Dispatch id is required' });
    }
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      if (!env.STRIPE_PUBLISHABLE_KEY) {
        throw new HttpError(500, 'Stripe publishable key is not configured');
      }

      await getActiveTerminalDeviceSession(parsed.data.deviceId);
      await expireTerminalDispatchIfNeeded(params.dispatchId);

      const dispatch = await prisma.terminalPaymentDispatch.findUnique({
        where: { id: params.dispatchId }
      });
      if (!dispatch) {
        throw new HttpError(404, 'Terminal dispatch not found');
      }
      if (dispatch.targetDeviceId !== parsed.data.deviceId) {
        throw new HttpError(403, 'Dispatch is assigned to a different terminal');
      }
      if (dispatch.status === 'SUCCEEDED') {
        throw new HttpError(409, 'Dispatch is already completed');
      }
      if (dispatch.status === 'EXPIRED' || dispatch.status === 'CANCELED') {
        throw new HttpError(409, `Dispatch is ${dispatch.status} and cannot be paid`);
      }

      const paymentIntent = await stripe.paymentIntents.create({
        amount: dispatch.expectedAmountCents,
        currency: dispatch.currency,
        payment_method_types: ['card'],
        capture_method: 'automatic',
        description: `Manual payment for terminal dispatch ${dispatch.id}`,
        metadata: {
          source: 'mobile_terminal_dispatch_manual',
          dispatchId: dispatch.id,
          performanceId: dispatch.performanceId,
          holdToken: dispatch.holdToken,
          targetDeviceId: dispatch.targetDeviceId,
          expectedAmountCents: String(dispatch.expectedAmountCents)
        }
      });

      if (!paymentIntent.client_secret) {
        throw new HttpError(500, 'Stripe payment intent missing client secret');
      }

      return reply.send({
        paymentIntentId: paymentIntent.id,
        clientSecret: paymentIntent.client_secret,
        publishableKey: env.STRIPE_PUBLISHABLE_KEY
      });
    } catch (err) {
      if (err instanceof Stripe.errors.StripeError) {
        return reply.status(502).send({ error: err.message || 'Payment provider error' });
      }

      handleRouteError(reply, err, 'Unable to create manual payment intent for terminal dispatch');
    }
  });

  app.post('/api/mobile/terminal/dispatch/:dispatchId/complete', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const params = request.params as { dispatchId?: string };
    const parsed = terminalDispatchCompleteSchema.safeParse(request.body || {});
    if (!params.dispatchId) {
      return reply.status(400).send({ error: 'Dispatch id is required' });
    }
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      await getActiveTerminalDeviceSession(parsed.data.deviceId);
      await expireTerminalDispatchIfNeeded(params.dispatchId);

      const dispatch = await prisma.terminalPaymentDispatch.findUnique({
        where: { id: params.dispatchId }
      });
      if (!dispatch) {
        throw new HttpError(404, 'Terminal dispatch not found');
      }
      if (dispatch.targetDeviceId !== parsed.data.deviceId) {
        throw new HttpError(403, 'Dispatch is assigned to a different terminal');
      }

      if (dispatch.status === 'SUCCEEDED') {
        return reply.send({
          success: true,
          alreadyCompleted: true,
          orderId: dispatch.finalOrderId
        });
      }
      if (dispatch.status === 'EXPIRED' || dispatch.status === 'CANCELED') {
        throw new HttpError(409, `Dispatch is ${dispatch.status} and cannot be completed`);
      }
      const mockCompletionRequested = Boolean(parsed.data.mockApproved);
      const mockCompletionAllowed = env.NODE_ENV !== 'production' || env.TERMINAL_DISPATCH_ALLOW_MOCK_PAYMENTS;
      if (mockCompletionRequested && !mockCompletionAllowed) {
        throw new HttpError(403, 'Mock terminal completion is disabled');
      }

      let completionPaymentIntentId: string | null = null;
      let completionAmountReceivedCents = dispatch.expectedAmountCents;
      let completionCurrency = dispatch.currency;

      if (mockCompletionRequested) {
        completionPaymentIntentId = dispatch.stripePaymentIntentId || null;
      } else {
        const paymentIntentId = parsed.data.paymentIntentId || dispatch.stripePaymentIntentId;
        if (!paymentIntentId) {
          throw new HttpError(400, 'Dispatch is missing a Stripe payment intent');
        }

        const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
        if (paymentIntent.status !== 'succeeded') {
          throw new HttpError(409, `Payment intent is ${paymentIntent.status}. It must be succeeded before completion.`);
        }
        if (parsed.data.paymentIntentId && paymentIntent.metadata?.dispatchId !== dispatch.id) {
          throw new HttpError(400, 'Payment intent does not belong to this dispatch');
        }

        completionPaymentIntentId = paymentIntent.id;
        completionAmountReceivedCents = paymentIntent.amount_received;
        completionCurrency = paymentIntent.currency;
      }

      const snapshot = parseTerminalDispatchSnapshot(dispatch.saleSnapshot);
      const customerEmail = snapshot.receiptEmail || `walkin+${dispatch.id}@boxoffice.local`;
      const sendEmail = Boolean(snapshot.sendReceipt && snapshot.receiptEmail);

      const created = await createAssignedOrder({
        performanceId: snapshot.performanceId,
        seatIds: snapshot.seatIds,
        customerName: snapshot.customerName,
        customerEmail,
        ticketTypeBySeatId: snapshot.ticketTypeBySeatId,
        priceBySeatId: snapshot.priceBySeatId,
        source: 'DOOR',
        allowHeldSeats: true,
        enforceSalesCutoff: false,
        sendEmail,
        inPersonPaymentMethod: 'STRIPE'
      });

      if (completionPaymentIntentId) {
        await prisma.order.update({
          where: { id: created.id },
          data: {
            stripePaymentIntentId: completionPaymentIntentId
          }
        });
      }

      const completed = await prisma.terminalPaymentDispatch.update({
        where: { id: dispatch.id },
        data: {
          status: 'SUCCEEDED',
          completedAt: new Date(),
          finalOrderId: created.id,
          failureReason: null
        }
      });

      await releaseHoldByToken(dispatch.holdToken).catch(() => undefined);

      await logAudit({
        actor: request.user.username || 'admin',
        action: 'MOBILE_TERMINAL_DISPATCH_SUCCEEDED',
        entityType: 'TerminalDispatch',
        entityId: completed.id,
        metadata: {
          orderId: created.id,
          paymentIntentId: completionPaymentIntentId,
          mockApproved: mockCompletionRequested,
          seatIds: snapshot.seatIds
        }
      });

      reply.send({
        success: true,
        orderId: created.id,
        dispatchId: completed.id,
        paymentIntentId: completionPaymentIntentId,
        amountReceivedCents: completionAmountReceivedCents,
        currency: completionCurrency,
        mockApproved: mockCompletionRequested
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Terminal dispatch completion failed';
      if (params.dispatchId) {
        await prisma.terminalPaymentDispatch
          .updateMany({
            where: {
              id: params.dispatchId,
              status: {
                in: ['PENDING', 'DELIVERED', 'PROCESSING']
              }
            },
            data: {
              status: 'FAILED',
              failureReason: message.slice(0, 500)
            }
          })
          .catch(() => undefined);
      }

      if (err instanceof Stripe.errors.StripeError) {
        return reply.status(502).send({ error: err.message || 'Payment provider error' });
      }

      handleRouteError(reply, err, 'Unable to complete terminal dispatch');
    }
  });

  app.post('/api/mobile/terminal/dispatch/:dispatchId/telemetry', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const params = request.params as { dispatchId?: string };
    const parsed = terminalDispatchTelemetrySchema.safeParse(request.body || {});
    if (!params.dispatchId) {
      return reply.status(400).send({ error: 'Dispatch id is required' });
    }
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const dispatch = await prisma.terminalPaymentDispatch.findUnique({
        where: { id: params.dispatchId },
        select: {
          id: true,
          targetDeviceId: true
        }
      });
      if (!dispatch) {
        throw new HttpError(404, 'Terminal dispatch not found');
      }
      if (dispatch.targetDeviceId !== parsed.data.deviceId) {
        throw new HttpError(403, 'Dispatch is assigned to a different terminal');
      }

      const telemetryPayload = {
        dispatchId: dispatch.id,
        deviceId: parsed.data.deviceId,
        stage: parsed.data.stage,
        paymentMethod: parsed.data.paymentMethod || 'UNKNOWN',
        paymentIntentId: parsed.data.paymentIntentId || null,
        failureReason: parsed.data.failureReason || null,
        metadata: parsed.data.metadata || null
      };

      app.log.info({ terminalTelemetry: telemetryPayload }, 'mobile_terminal_dispatch_telemetry');

      await logAudit({
        actor: request.user.username || 'admin',
        action: 'MOBILE_TERMINAL_DISPATCH_TELEMETRY',
        entityType: 'TerminalDispatch',
        entityId: dispatch.id,
        metadata: telemetryPayload
      });

      return reply.send({ ok: true });
    } catch (err) {
      handleRouteError(reply, err, 'Unable to record terminal dispatch telemetry');
    }
  });

  app.post('/api/mobile/create-payment-intent', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsed = createPaymentIntentSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const { performanceId, pricingTierId, quantity, customerName, receiptEmail } = parsed.data;

    let holdToken: string | null = null;

    try {
      const performance = await prisma.performance.findFirst({
        where: { id: performanceId, isArchived: false },
        include: {
          show: true,
          pricingTiers: {
            where: { id: pricingTierId },
            select: {
              id: true,
              name: true,
              priceCents: true
            }
          }
        }
      });

      if (!performance) {
        throw new HttpError(404, 'Performance not found');
      }

      const tier = performance.pricingTiers[0];
      if (!tier) {
        throw new HttpError(404, 'Ticket type not found for this performance');
      }

      if (tier.priceCents <= 0) {
        throw new HttpError(400, 'Selected ticket type must be a paid price');
      }

      const availableSeats = await prisma.seat.findMany({
        where: {
          performanceId,
          status: 'AVAILABLE'
        },
        select: {
          id: true,
          sectionName: true,
          row: true,
          number: true,
          price: true
        },
        orderBy: [{ sectionName: 'asc' }, { row: 'asc' }, { number: 'asc' }]
      });

      const preferredSeats = availableSeats.filter((seat) => seat.price === tier.priceCents);
      const fallbackSeats = availableSeats.filter((seat) => seat.price !== tier.priceCents);
      const selectedSeats = [...preferredSeats, ...fallbackSeats].slice(0, quantity);

      if (selectedSeats.length < quantity) {
        throw new HttpError(409, `Only ${selectedSeats.length} seat(s) are currently available`);
      }

      const holdResult = await syncSeatHold({
        performanceId,
        seatIds: selectedSeats.map((seat) => seat.id),
        clientToken: `mobile:${request.adminUser!.id}:${crypto.randomBytes(8).toString('hex')}`
      });
      holdToken = holdResult.holdToken;

      const amountTotal = tier.priceCents * quantity;
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amountTotal,
        currency: 'usd',
        payment_method_types: ['card_present'],
        capture_method: 'automatic',
        receipt_email: receiptEmail,
        description: `${performance.title || performance.show.title} - ${tier.name} x${quantity}`,
        metadata: {
          source: 'mobile_box_office',
          performanceId,
          pricingTierId: tier.id,
          ticketType: tier.name,
          quantity: String(quantity),
          unitPriceCents: String(tier.priceCents),
          holdToken: holdResult.holdToken,
          seatIds: JSON.stringify(selectedSeats.map((seat) => seat.id)),
          customerName: customerName?.trim() || '',
          receiptEmail: receiptEmail || '',
          createdByAdminId: request.adminUser!.id
        }
      });

      if (!paymentIntent.client_secret) {
        throw new HttpError(500, 'Stripe payment intent missing client secret');
      }

      await logAudit({
        actor: request.user.username || 'admin',
        action: 'MOBILE_PAYMENT_INTENT_CREATED',
        entityType: 'PaymentIntent',
        entityId: paymentIntent.id,
        metadata: {
          performanceId,
          pricingTierId: tier.id,
          quantity,
          amountTotal,
          holdToken: holdResult.holdToken,
          seatIds: selectedSeats.map((seat) => seat.id)
        }
      });

      return reply.send({
        paymentIntentId: paymentIntent.id,
        clientSecret: paymentIntent.client_secret,
        amountTotalCents: amountTotal,
        currency: 'usd',
        performance: {
          id: performance.id,
          title: performance.title || performance.show.title,
          startsAt: performance.startsAt.toISOString()
        },
        ticketType: {
          id: tier.id,
          name: tier.name,
          unitPriceCents: tier.priceCents
        },
        quantity,
        holdToken: holdResult.holdToken,
        holdExpiresAt: holdResult.expiresAt.toISOString(),
        seats: sortSeats(selectedSeats).map((seat) => ({
          id: seat.id,
          label: buildSeatLabel(seat),
          sectionName: seat.sectionName,
          row: seat.row,
          number: seat.number,
          priceCents: seat.price
        }))
      });
    } catch (err) {
      if (holdToken) {
        try {
          await releaseHoldByToken(holdToken);
        } catch {
          // ignore hold release failures here; cleanup job will recover stale holds.
        }
      }

      if (err instanceof Stripe.errors.StripeError) {
        return reply.status(502).send({ error: err.message || 'Payment provider error' });
      }

      handleRouteError(reply, err, 'Failed to create mobile payment intent');
    }
  });

  app.post('/api/mobile/payment/complete', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsed = completePaymentSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const mockCompletionRequested = Boolean(parsed.data.mockApproved);
      const mockCompletionAllowed = env.NODE_ENV !== 'production' || env.TERMINAL_DISPATCH_ALLOW_MOCK_PAYMENTS;
      if (mockCompletionRequested && !mockCompletionAllowed) {
        throw new HttpError(403, 'Mock mobile payment completion is disabled');
      }

      const existing = await prisma.order.findFirst({
        where: { stripePaymentIntentId: parsed.data.paymentIntentId },
        select: {
          id: true,
          status: true,
          amountTotal: true,
          performance: {
            select: {
              id: true,
              title: true,
              show: { select: { title: true } }
            }
          }
        }
      });
      if (existing) {
        return reply.send({
          alreadyCompleted: true,
          mockApproved: mockCompletionRequested,
          order: {
            id: existing.id,
            status: existing.status,
            amountTotal: existing.amountTotal,
            performanceId: existing.performance.id,
            performanceTitle: existing.performance.title || existing.performance.show.title
          }
        });
      }

      const paymentIntent = await stripe.paymentIntents.retrieve(parsed.data.paymentIntentId);
      if (!mockCompletionRequested && paymentIntent.status !== 'succeeded') {
        throw new HttpError(409, `Payment intent is ${paymentIntent.status}. It must be succeeded before completion.`);
      }

      const metadata = paymentIntent.metadata || {};
      const performanceId = metadata.performanceId;
      const ticketType = metadata.ticketType;
      const holdToken = metadata.holdToken;
      const seatIds = parseMetadataSeatIds(metadata.seatIds);
      const quantity = Number(metadata.quantity || 0);
      const unitPriceCents = Number(metadata.unitPriceCents || 0);

      if (!performanceId || !ticketType || !holdToken || seatIds.length === 0 || quantity <= 0 || unitPriceCents <= 0) {
        throw new HttpError(400, 'Payment intent metadata is incomplete for mobile completion');
      }

      if (seatIds.length !== quantity) {
        throw new HttpError(400, 'Payment intent seat count does not match requested quantity');
      }

      const seats = await prisma.seat.findMany({
        where: {
          id: { in: seatIds },
          performanceId
        },
        select: {
          id: true,
          sectionName: true,
          row: true,
          number: true
        }
      });
      if (seats.length !== seatIds.length) {
        throw new HttpError(400, 'Unable to load seats for payment completion');
      }

      const normalizedCustomerName = metadata.customerName?.trim() || 'Walk-in Guest';
      const normalizedReceiptEmail = metadata.receiptEmail?.trim().toLowerCase() || null;
      const customerEmail = normalizedReceiptEmail || `walkin+${paymentIntent.id}@boxoffice.local`;
      const sendEmail = Boolean(normalizedReceiptEmail);

      const ticketTypeBySeatId = Object.fromEntries(seatIds.map((seatId) => [seatId, ticketType])) as Record<string, string>;
      const priceBySeatId = Object.fromEntries(seatIds.map((seatId) => [seatId, unitPriceCents])) as Record<string, number>;

      let createdOrderId: string | null = null;
      try {
        const created = await createAssignedOrder({
          performanceId,
          seatIds,
          customerName: normalizedCustomerName,
          customerEmail,
          ticketTypeBySeatId,
          priceBySeatId,
          source: 'DOOR',
          allowHeldSeats: true,
          enforceSalesCutoff: false,
          sendEmail,
          inPersonPaymentMethod: 'STRIPE'
        });
        createdOrderId = created.id;

        await prisma.order.update({
          where: { id: created.id },
          data: {
            stripePaymentIntentId: paymentIntent.id
          }
        });
      } catch (orderErr) {
        if (!mockCompletionRequested) {
          try {
            await stripe.refunds.create({
              payment_intent: paymentIntent.id,
              metadata: {
                reason: 'mobile_completion_failed'
              }
            });
          } catch {
            // leave audit trail below; manual intervention may be needed.
          }
        }

        throw orderErr;
      } finally {
        await releaseHoldByToken(holdToken).catch(() => undefined);
      }

      await logAudit({
        actor: request.user.username || 'admin',
        action: 'MOBILE_PAYMENT_COMPLETED',
        entityType: 'Order',
        entityId: createdOrderId || 'unknown',
        metadata: {
          paymentIntentId: paymentIntent.id,
          performanceId,
          ticketType,
          quantity,
          amountReceived: paymentIntent.amount_received,
          seatIds,
          mockApproved: mockCompletionRequested
        }
      });

      return reply.send({
        success: true,
        orderId: createdOrderId,
        paymentIntentId: paymentIntent.id,
        amountReceivedCents: paymentIntent.amount_received,
        currency: paymentIntent.currency,
        mockApproved: mockCompletionRequested,
        ticketsIssued: seatIds.length,
        seats: sortSeats(seats).map((seat) => ({
          id: seat.id,
          label: buildSeatLabel(seat)
        }))
      });
    } catch (err) {
      if (err instanceof Stripe.errors.StripeError) {
        return reply.status(502).send({ error: err.message || 'Payment provider error' });
      }

      handleRouteError(reply, err, 'Failed to complete mobile payment');
    }
  });

  app.post('/api/mobile/scan/validate', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsed = scanValidateSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const reference = parseScanReference(parsed.data.scannedCode);
      if (reference.kind === 'invalid') {
        return reply.send({
          status: 'invalid',
          message: 'Unrecognized QR code format'
        });
      }

      const ticket =
        reference.kind === 'qr'
          ? await prisma.ticket.findUnique({
              where: { id: reference.ticketId },
              include: {
                order: true,
                seat: true,
                performance: { include: { show: true } }
              }
            })
          : await prisma.ticket.findUnique({
              where: { publicId: reference.publicId },
              include: {
                order: true,
                seat: true,
                performance: { include: { show: true } }
              }
            });

      if (!ticket) {
        return reply.send({
          status: 'invalid',
          message: 'Ticket not found'
        });
      }

      if (reference.kind === 'qr') {
        const expected = createTicketSignature(ticket.id, ticket.qrSecret);
        if (!constantTimeEqual(expected, reference.signature)) {
          return reply.send({
            status: 'invalid',
            message: 'Ticket signature is invalid'
          });
        }
      }

      if (parsed.data.performanceId && ticket.performanceId !== parsed.data.performanceId) {
        return reply.send({
          status: 'invalid',
          message: 'Ticket belongs to a different performance'
        });
      }

      if (ticket.order.status !== 'PAID' || ticket.status !== 'ISSUED' || ticket.admissionDecision === 'DENY') {
        return reply.send({
          status: 'invalid',
          message: 'Ticket is not eligible for entry'
        });
      }

      if (ticket.checkedInAt) {
        return reply.send({
          status: 'already_used',
          message: `Already used at ${ticket.checkedInAt.toISOString()}`,
          ticket: {
            id: ticket.id,
            publicId: ticket.publicId
          }
        });
      }

      const scannedAt = new Date();
      const actor = buildMobileActor(request.adminUser!, parsed.data.gate);
      const gate = parsed.data.gate?.trim() || 'MOBILE';

      const updated = await prisma.ticket.updateMany({
        where: {
          id: ticket.id,
          checkedInAt: null
        },
        data: {
          checkedInAt: scannedAt,
          checkedInBy: actor,
          checkInGate: gate
        }
      });

      if (updated.count === 0) {
        return reply.send({
          status: 'already_used',
          message: 'Already used'
        });
      }

      await logAudit({
        actor: request.user.username || 'admin',
        action: 'MOBILE_TICKET_SCANNED',
        entityType: 'Ticket',
        entityId: ticket.id,
        metadata: {
          performanceId: ticket.performanceId,
          publicId: ticket.publicId,
          gate
        }
      });

      return reply.send({
        status: 'valid',
        message: 'Ticket accepted',
        ticket: {
          id: ticket.id,
          publicId: ticket.publicId,
          performanceTitle: ticket.performance.title || ticket.performance.show.title,
          seat: buildSeatLabel(ticket.seat),
          checkedInAt: scannedAt.toISOString()
        }
      });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to validate scanned ticket');
    }
  });
};
