/*
Handoff note for Mr. Smith:
- File: `backend/src/routes/admin-messages.ts`
- What this is: Fastify route module.
- What it does: Defines HTTP endpoints and route-level request handling for one domain area.
- Connections: Registered by backend server bootstrap; calls services/lib helpers and Prisma.
- Main content type: HTTP logic + auth guards + response shaping.
- Safe edits here: Response wording and non-breaking diagnostics.
- Be careful with: Auth hooks, schema contracts, and transactional behavior.
- Useful context: If frontend/mobile API calls fail after changes, contract drift often starts here.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { sendAudienceBroadcastEmail } from '../lib/email.js';
import { logAudit } from '../lib/audit-log.js';
import { handleRouteError } from '../lib/route-error.js';
import { HttpError } from '../lib/http-error.js';
import { env, isSmtpConfigured } from '../lib/env.js';

const sendAudienceMessageSchema = z
  .object({
    performanceId: z.string().trim().min(1),
    subject: z.string().trim().min(3).max(160),
    previewText: z.string().trim().max(200).optional(),
    headline: z.string().trim().min(3).max(140),
    body: z.string().trim().min(8).max(5000),
    callToActionLabel: z.string().trim().max(60).optional(),
    callToActionUrl: z.string().trim().url().max(500).optional(),
    includeEventDetails: z.boolean().optional(),
    signature: z.string().trim().max(120).optional()
  })
  .refine((value) => {
    const hasLabel = Boolean(value.callToActionLabel?.trim());
    const hasUrl = Boolean(value.callToActionUrl?.trim());
    return hasLabel === hasUrl;
  }, {
    message: 'Call-to-action label and URL must both be provided.',
    path: ['callToActionUrl']
  });

const listMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(80)
});

const inboundMessageSchema = z
  .object({
    provider: z.string().trim().max(80).optional(),
    messageId: z.string().trim().max(300).optional(),
    fromEmail: z.string().trim().min(3).max(320),
    fromName: z.string().trim().max(160).optional(),
    toEmail: z.string().trim().max(320).optional(),
    toName: z.string().trim().max(160).optional(),
    subject: z.string().trim().min(1).max(240),
    text: z.string().max(20000).optional(),
    html: z.string().max(80000).optional(),
    receivedAt: z.string().datetime().optional()
  })
  .refine((value) => Boolean(value.text?.trim()) || Boolean(value.html?.trim()), {
    message: 'Inbound payload requires text or html content.',
    path: ['text']
  });

const inboundMessageQuerySchema = z.object({
  secret: z.string().trim().optional()
});

type AudienceStats = {
  recipientCount: number;
  orderCount: number;
  lastOrderAt: string | null;
};

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function firstNameFromCustomerName(value: string): string | null {
  const cleaned = value.trim();
  if (!cleaned) return null;
  const first = cleaned.split(/\s+/)[0] || '';
  if (!first) return null;
  return first.slice(0, 40);
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message.trim()) {
    return err.message.trim();
  }
  return 'Unknown send error';
}

function readObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const asNumber = Number(value);
    return Number.isFinite(asNumber) ? asNumber : null;
  }
  return null;
}

function firstHeaderValue(raw: string | string[] | undefined): string | null {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    return raw[0]?.trim() || null;
  }
  const trimmed = raw.trim();
  return trimmed || null;
}

function safeSnippet(value: string | null, maxLen = 240): string | null {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, maxLen - 1)}…`;
}

function parseFailureList(value: unknown): Array<{ email: string; error: string }> {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => {
      const row = readObject(entry);
      if (!row) return null;
      const email = readString(row.email);
      const error = readString(row.error);
      if (!email || !error) return null;
      return { email, error };
    })
    .filter((entry): entry is { email: string; error: string } => Boolean(entry));
}

export const adminMessageRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/messages/inbound', async (request, reply) => {
    try {
      if (!env.INBOUND_EMAIL_WEBHOOK_SECRET) {
        throw new HttpError(503, 'Inbound email webhook is not configured.');
      }

      const parsedQuery = inboundMessageQuerySchema.safeParse(request.query ?? {});
      if (!parsedQuery.success) {
        throw new HttpError(400, 'Invalid inbound webhook query string.');
      }

      const parsedBody = inboundMessageSchema.safeParse(request.body ?? {});
      if (!parsedBody.success) {
        throw new HttpError(400, parsedBody.error.issues[0]?.message || 'Invalid inbound message payload');
      }

      const body = parsedBody.data;
      const authorization = firstHeaderValue(request.headers.authorization);
      const authBearer = authorization?.toLowerCase().startsWith('bearer ')
        ? authorization.slice(7).trim()
        : null;
      const providedSecret =
        firstHeaderValue(request.headers['x-inbound-email-secret']) ||
        firstHeaderValue(request.headers['x-webhook-secret']) ||
        authBearer ||
        parsedQuery.data.secret ||
        null;

      if (!providedSecret || providedSecret !== env.INBOUND_EMAIL_WEBHOOK_SECRET) {
        throw new HttpError(401, 'Unauthorized inbound webhook request.');
      }

      const messageId = readString(body.messageId);
      if (messageId) {
        const duplicate = await prisma.auditLog.findFirst({
          where: {
            action: 'AUDIENCE_MESSAGE_RECEIVED',
            entityType: 'EMAIL_INBOUND',
            entityId: messageId
          },
          select: { id: true }
        });

        if (duplicate) {
          reply.send({ ok: true, duplicate: true, id: duplicate.id });
          return;
        }
      }

      const entityId =
        messageId ||
        `inbound-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

      const textContent = body.text?.trim() || null;
      const htmlContent = body.html?.trim() || null;

      await logAudit({
        actor: 'SYSTEM',
        action: 'AUDIENCE_MESSAGE_RECEIVED',
        entityType: 'EMAIL_INBOUND',
        entityId,
        metadata: {
          provider: body.provider?.trim() || 'unknown',
          messageId,
          fromEmail: body.fromEmail.trim(),
          fromName: body.fromName?.trim() || null,
          toEmail: body.toEmail?.trim() || null,
          toName: body.toName?.trim() || null,
          subject: body.subject.trim(),
          text: textContent,
          html: htmlContent,
          textSnippet: safeSnippet(textContent),
          receivedAt: body.receivedAt || new Date().toISOString()
        }
      });

      reply.send({ ok: true, id: entityId });
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to store inbound email');
    }
  });

  app.get('/api/admin/messages/audiences', { preHandler: app.requireAdminRole('ADMIN') }, async (_request, reply) => {
    try {
      const performances = await prisma.performance.findMany({
        where: { isArchived: false },
        orderBy: [{ startsAt: 'asc' }],
        select: {
          id: true,
          title: true,
          startsAt: true,
          venue: true,
          isFundraiser: true,
          show: {
            select: {
              title: true
            }
          }
        }
      });

      const performanceIds = performances.map((performance) => performance.id);
      const statsByPerformanceId = new Map<string, AudienceStats>();

      if (performanceIds.length > 0) {
        const paidOrders = await prisma.order.findMany({
          where: {
            status: 'PAID',
            performanceId: {
              in: performanceIds
            }
          },
          select: {
            performanceId: true,
            email: true,
            createdAt: true
          },
          orderBy: [{ createdAt: 'desc' }]
        });

        const uniqueRecipientsByPerformanceId = new Map<string, Set<string>>();

        paidOrders.forEach((order) => {
          const email = normalizeEmail(order.email);
          if (!email) return;

          const existing = statsByPerformanceId.get(order.performanceId);
          if (!existing) {
            statsByPerformanceId.set(order.performanceId, {
              recipientCount: 0,
              orderCount: 1,
              lastOrderAt: order.createdAt.toISOString()
            });
          } else {
            existing.orderCount += 1;
          }

          const existingRecipients = uniqueRecipientsByPerformanceId.get(order.performanceId);
          if (!existingRecipients) {
            uniqueRecipientsByPerformanceId.set(order.performanceId, new Set([email]));
            return;
          }
          existingRecipients.add(email);
        });

        uniqueRecipientsByPerformanceId.forEach((recipientSet, performanceId) => {
          const existing = statsByPerformanceId.get(performanceId);
          if (!existing) {
            statsByPerformanceId.set(performanceId, {
              recipientCount: recipientSet.size,
              orderCount: 0,
              lastOrderAt: null
            });
            return;
          }
          existing.recipientCount = recipientSet.size;
        });
      }

      reply.send({
        items: performances.map((performance) => {
          const stats = statsByPerformanceId.get(performance.id);
          return {
            id: performance.id,
            title: performance.title || performance.show.title,
            showTitle: performance.show.title,
            startsAt: performance.startsAt.toISOString(),
            venue: performance.venue,
            isFundraiser: performance.isFundraiser,
            recipientCount: stats?.recipientCount || 0,
            orderCount: stats?.orderCount || 0,
            lastOrderAt: stats?.lastOrderAt || null
          };
        })
      });
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to load message audiences');
    }
  });

  app.get('/api/admin/messages/history', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    try {
      const parsedQuery = listMessagesQuerySchema.safeParse(request.query ?? {});
      if (!parsedQuery.success) {
        throw new HttpError(400, parsedQuery.error.issues[0]?.message || 'Invalid history query');
      }

      const rows = await prisma.auditLog.findMany({
        where: {
          action: 'AUDIENCE_MESSAGE_SENT'
        },
        orderBy: {
          createdAt: 'desc'
        },
        take: parsedQuery.data.limit,
        select: {
          id: true,
          actorAdminId: true,
          entityId: true,
          createdAt: true,
          metadataJson: true,
          meta: true
        }
      });

      const adminIds = [...new Set(rows.map((row) => row.actorAdminId).filter((id): id is string => Boolean(id)))];
      const admins = adminIds.length
        ? await prisma.adminUser.findMany({
            where: {
              id: {
                in: adminIds
              }
            },
            select: {
              id: true,
              name: true,
              username: true
            }
          })
        : [];
      const adminById = new Map(admins.map((admin) => [admin.id, admin]));

      const items = rows.map((row) => {
        const metadata = readObject(row.metadataJson) || readObject(row.meta) || {};
        const admin = row.actorAdminId ? adminById.get(row.actorAdminId) : null;
        const recipientCount = readNumber(metadata.recipientCount) || 0;
        const sentCount = readNumber(metadata.sentCount) || 0;
        const failedCount = readNumber(metadata.failedCount) || 0;

        return {
          id: row.id,
          createdAt: row.createdAt.toISOString(),
          audienceId: row.entityId,
          audienceTitle: readString(metadata.audienceTitle) || null,
          audienceKind: readString(metadata.audienceKind) || null,
          subject: readString(metadata.subject) || '',
          headline: readString(metadata.headline) || '',
          previewText: readString(metadata.previewText) || null,
          body: readString(metadata.body) || null,
          signature: readString(metadata.signature) || null,
          includeEventDetails: Boolean(metadata.includeEventDetails),
          callToActionLabel: readString(metadata.callToActionLabel) || null,
          callToActionUrl: readString(metadata.callToActionUrl) || null,
          replyToAddress: readString(metadata.replyToAddress) || null,
          recipientCount,
          sentCount,
          failedCount,
          failures: parseFailureList(metadata.failures).slice(0, 25),
          sentBy: admin
            ? {
                id: admin.id,
                name: admin.name,
                username: admin.username
              }
            : null
        };
      });

      reply.send({ items });
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to load sent message history');
    }
  });

  app.get('/api/admin/messages/inbox', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    try {
      const parsedQuery = listMessagesQuerySchema.safeParse(request.query ?? {});
      if (!parsedQuery.success) {
        throw new HttpError(400, parsedQuery.error.issues[0]?.message || 'Invalid inbox query');
      }

      const rows = await prisma.auditLog.findMany({
        where: {
          action: 'AUDIENCE_MESSAGE_RECEIVED',
          entityType: 'EMAIL_INBOUND'
        },
        orderBy: {
          createdAt: 'desc'
        },
        take: parsedQuery.data.limit,
        select: {
          id: true,
          createdAt: true,
          entityId: true,
          metadataJson: true,
          meta: true
        }
      });

      const items = rows.map((row) => {
        const metadata = readObject(row.metadataJson) || readObject(row.meta) || {};
        const text = readString(metadata.text);

        return {
          id: row.id,
          entityId: row.entityId,
          createdAt: row.createdAt.toISOString(),
          provider: readString(metadata.provider) || 'unknown',
          messageId: readString(metadata.messageId) || null,
          fromEmail: readString(metadata.fromEmail) || null,
          fromName: readString(metadata.fromName) || null,
          toEmail: readString(metadata.toEmail) || null,
          toName: readString(metadata.toName) || null,
          subject: readString(metadata.subject) || '(no subject)',
          text,
          html: readString(metadata.html) || null,
          textSnippet: readString(metadata.textSnippet) || safeSnippet(text),
          receivedAt: readString(metadata.receivedAt) || row.createdAt.toISOString()
        };
      });

      reply.send({ items });
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to load inbound messages');
    }
  });

  app.post('/api/admin/messages/send', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    try {
      const parsed = sendAudienceMessageSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        throw new HttpError(400, parsed.error.issues[0]?.message || 'Invalid audience message payload');
      }

      const payload = parsed.data;
      if (!isSmtpConfigured()) {
        throw new HttpError(503, 'SMTP is not configured for outbound email.');
      }

      const performance = await prisma.performance.findUnique({
        where: { id: payload.performanceId },
        select: {
          id: true,
          title: true,
          startsAt: true,
          venue: true,
          isFundraiser: true,
          show: {
            select: {
              title: true
            }
          }
        }
      });

      if (!performance) {
        throw new HttpError(404, 'Selected audience was not found.');
      }

      const paidOrders = await prisma.order.findMany({
        where: {
          performanceId: performance.id,
          status: 'PAID'
        },
        select: {
          email: true,
          customerName: true,
          createdAt: true
        },
        orderBy: [{ createdAt: 'desc' }]
      });

      const recipientsByEmail = new Map<string, { email: string; recipientName: string | null }>();
      paidOrders.forEach((order) => {
        const email = normalizeEmail(order.email);
        if (!email || recipientsByEmail.has(email)) {
          return;
        }
        recipientsByEmail.set(email, {
          email,
          recipientName: firstNameFromCustomerName(order.customerName)
        });
      });

      const recipients = [...recipientsByEmail.values()];
      if (recipients.length === 0) {
        throw new HttpError(409, 'No paid ticket holder emails were found for this audience.');
      }

      const audienceLabel = performance.title || performance.show.title;
      const audienceKind = performance.isFundraiser ? 'fundraiser' : 'performance';
      const failures: Array<{ email: string; error: string }> = [];
      let sentCount = 0;
      const batchSize = 20;

      for (let start = 0; start < recipients.length; start += batchSize) {
        const batch = recipients.slice(start, start + batchSize);
        const results = await Promise.allSettled(
          batch.map((recipient) =>
            sendAudienceBroadcastEmail({
              toEmail: recipient.email,
              recipientName: recipient.recipientName,
              subject: payload.subject,
              previewText: payload.previewText,
              headline: payload.headline,
              body: payload.body,
              callToActionLabel: payload.callToActionLabel,
              callToActionUrl: payload.callToActionUrl,
              audienceLabel,
              audienceStartsAtIso: performance.startsAt.toISOString(),
              audienceVenue: performance.venue,
              includeEventDetails: payload.includeEventDetails !== false,
              signature: payload.signature
            })
          )
        );

        results.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            sentCount += 1;
            return;
          }

          failures.push({
            email: batch[index]?.email || 'unknown',
            error: toErrorMessage(result.reason)
          });
        });
      }

      await logAudit({
        actor: 'ADMIN',
        actorAdminId: request.adminUser?.id || null,
        action: 'AUDIENCE_MESSAGE_SENT',
        entityType: 'PERFORMANCE',
        entityId: performance.id,
        metadata: {
          subject: payload.subject,
          previewText: payload.previewText || null,
          headline: payload.headline,
          body: payload.body,
          callToActionLabel: payload.callToActionLabel || null,
          callToActionUrl: payload.callToActionUrl || null,
          includeEventDetails: payload.includeEventDetails !== false,
          signature: payload.signature || null,
          replyToAddress: env.AUDIENCE_MESSAGE_REPLY_TO || null,
          audienceTitle: audienceLabel,
          audienceKind,
          isFundraiser: performance.isFundraiser,
          recipientCount: recipients.length,
          sentCount,
          failedCount: failures.length,
          failures: failures.slice(0, 50)
        }
      });

      if (sentCount === 0) {
        throw new HttpError(502, 'All message sends failed. Check SMTP configuration and try again.');
      }

      reply.send({
        audience: {
          id: performance.id,
          title: audienceLabel,
          startsAt: performance.startsAt.toISOString(),
          venue: performance.venue,
          isFundraiser: performance.isFundraiser
        },
        recipientCount: recipients.length,
        sentCount,
        failedCount: failures.length,
        failures: failures.slice(0, 25)
      });
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to send that message');
    }
  });
};
