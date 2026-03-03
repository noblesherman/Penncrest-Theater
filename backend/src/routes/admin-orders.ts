import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { handleRouteError } from '../lib/route-error.js';
import { HttpError } from '../lib/http-error.js';
import { sendTicketsEmail } from '../lib/email.js';
import { logAudit } from '../lib/audit-log.js';
import { createAssignedOrder } from '../services/order-assignment.js';

const refundSchema = z.object({
  releaseSeats: z.boolean().optional(),
  reason: z.string().max(300).optional()
});

const assignOrderSchema = z.object({
  performanceId: z.string().min(1),
  seatIds: z.array(z.string().min(1)).min(1).max(50),
  customerName: z.string().min(1).max(120),
  customerEmail: z.string().email(),
  attendeeNames: z.record(z.string().min(1), z.string().max(80)).optional(),
  ticketTypeBySeatId: z.record(z.string().min(1), z.string().max(40)).optional(),
  priceBySeatId: z.record(z.string().min(1), z.number().int().min(0).max(20000)).optional(),
  source: z.enum(['DOOR', 'COMP']).default('DOOR'),
  sendEmail: z.boolean().optional()
});

export const adminOrderRoutes: FastifyPluginAsync = async (app) => {
  const adminActor = (request: { user: { username?: string } }) => request.user.username || 'admin';

  app.get('/api/admin/orders', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const query = request.query as {
      q?: string;
      status?: string;
      source?: string;
      performanceId?: string;
    };

    try {
      const where: any = {};
      if (query.status) where.status = query.status;
      if (query.source) where.source = query.source;
      if (query.performanceId) where.performanceId = query.performanceId;
      if (query.q) {
        where.OR = [
          { id: { contains: query.q, mode: 'insensitive' } },
          { email: { contains: query.q, mode: 'insensitive' } },
          { customerName: { contains: query.q, mode: 'insensitive' } }
        ];
      }

      const orders = await prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          performance: { include: { show: true } },
          orderSeats: { include: { seat: true } },
          tickets: true
        }
      });

      reply.send(
        orders.map((order) => ({
          id: order.id,
          status: order.status,
          source: order.source,
          email: order.email,
          customerName: order.customerName,
          amountTotal: order.amountTotal,
          createdAt: order.createdAt,
          performanceId: order.performanceId,
          performanceTitle: order.performance.title || order.performance.show.title,
          seats: order.orderSeats.map((seat) => `${seat.seat.sectionName} ${seat.seat.row}-${seat.seat.number}`),
          ticketCount: order.tickets.length
        }))
      );
    } catch (err) {
      handleRouteError(reply, err, 'Failed to fetch orders');
    }
  });

  app.get('/api/admin/orders/:id', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const params = request.params as { id: string };

    try {
      const order = await prisma.order.findUnique({
        where: { id: params.id },
        include: {
          performance: { include: { show: true } },
          orderSeats: { include: { seat: true } },
          tickets: { include: { seat: true } }
        }
      });

      if (!order) {
        throw new HttpError(404, 'Order not found');
      }

      reply.send(order);
    } catch (err) {
      handleRouteError(reply, err, 'Failed to fetch order details');
    }
  });

  app.post('/api/admin/orders/assign', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsed = assignOrderSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const created = await createAssignedOrder({
        performanceId: parsed.data.performanceId,
        seatIds: parsed.data.seatIds,
        customerName: parsed.data.customerName,
        customerEmail: parsed.data.customerEmail,
        attendeeNames: parsed.data.attendeeNames,
        ticketTypeBySeatId: parsed.data.ticketTypeBySeatId,
        priceBySeatId: parsed.data.priceBySeatId,
        source: parsed.data.source,
        allowHeldSeats: true,
        enforceSalesCutoff: false,
        sendEmail: parsed.data.sendEmail ?? false
      });

      await logAudit({
        actor: adminActor(request),
        action: 'ORDER_ASSIGNED',
        entityType: 'Order',
        entityId: created.id,
        metadata: {
          source: parsed.data.source,
          performanceId: parsed.data.performanceId,
          seatIds: parsed.data.seatIds
        }
      });

      reply.status(201).send({
        id: created.id,
        status: created.status,
        source: created.source
      });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to assign seats');
    }
  });

  app.post('/api/admin/orders/:id/resend', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const params = request.params as { id: string };

    try {
      const order = await prisma.order.findUnique({
        where: { id: params.id },
        include: {
          performance: { include: { show: true } },
          tickets: { include: { seat: true } },
          orderSeats: true
        }
      });

      if (!order) {
        throw new HttpError(404, 'Order not found');
      }

      if (order.status !== 'PAID') {
        throw new HttpError(400, 'Only paid orders can resend tickets');
      }

      const orderSeatBySeatId = new Map(order.orderSeats.map((seat) => [seat.seatId, seat]));

      await sendTicketsEmail({
        orderId: order.id,
        customerName: order.customerName,
        customerEmail: order.email,
        showTitle: order.performance.title || order.performance.show.title,
        startsAtIso: order.performance.startsAt.toISOString(),
        venue: order.performance.venue,
        tickets: order.tickets.map((ticket) => ({
          publicId: ticket.publicId,
          row: ticket.seat.row,
          number: ticket.seat.number,
          sectionName: ticket.seat.sectionName,
          ticketType: orderSeatBySeatId.get(ticket.seatId)?.ticketType || null,
          attendeeName: orderSeatBySeatId.get(ticket.seatId)?.attendeeName || null
        }))
      });

      await logAudit({
        actor: adminActor(request),
        action: 'ORDER_TICKETS_RESENT',
        entityType: 'Order',
        entityId: order.id
      });

      reply.send({ success: true });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to resend tickets');
    }
  });

  app.post('/api/admin/orders/:id/refund', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const params = request.params as { id: string };
    const parsed = refundSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const order = await prisma.order.findUnique({
        where: { id: params.id },
        include: {
          orderSeats: true
        }
      });

      if (!order) {
        throw new HttpError(404, 'Order not found');
      }

      await prisma.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: order.id },
          data: { status: 'REFUNDED' }
        });

        if (parsed.data.releaseSeats) {
          await tx.seat.updateMany({
            where: {
              id: { in: order.orderSeats.map((seat) => seat.seatId) },
              status: 'SOLD'
            },
            data: { status: 'AVAILABLE' }
          });
        }
      });

      await logAudit({
        actor: adminActor(request),
        action: 'ORDER_REFUNDED',
        entityType: 'Order',
        entityId: order.id,
        metadata: parsed.data
      });

      reply.send({ success: true });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to mark order refunded');
    }
  });
};
