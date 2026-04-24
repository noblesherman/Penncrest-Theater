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
import { isSmtpConfigured } from '../lib/env.js';

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

export const adminMessageRoutes: FastifyPluginAsync = async (app) => {
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
          headline: payload.headline,
          isFundraiser: performance.isFundraiser,
          recipientCount: recipients.length,
          sentCount,
          failedCount: failures.length
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
