import { FastifyPluginAsync } from 'fastify';
import { User } from '@prisma/client';
import { checkoutRequestSchema } from '../schemas/checkout.js';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/http-error.js';
import { handleRouteError } from '../lib/route-error.js';
import { stripe } from '../lib/stripe.js';
import { releaseExpiredHolds } from '../services/hold-service.js';
import { createAssignedOrder } from '../services/order-assignment.js';
import { env } from '../lib/env.js';

function bearerTokenFromHeader(headerValue?: string): string | null {
  if (!headerValue) return null;
  const [scheme, token] = headerValue.split(' ');
  if (!scheme || !token) return null;
  if (scheme.toLowerCase() !== 'bearer') return null;
  return token;
}

async function requireAuthenticatedStaff(
  app: Parameters<FastifyPluginAsync>[0],
  authHeader: string | undefined
): Promise<User> {
  const token = bearerTokenFromHeader(authHeader);
  if (!token) {
    throw new HttpError(401, 'Teacher ticket requires sign in');
  }

  let payload: { role?: string; userId?: string };
  try {
    payload = await app.jwt.verify<{ role?: string; userId?: string }>(token);
  } catch {
    throw new HttpError(401, 'Teacher ticket requires sign in');
  }

  if (payload.role !== 'user' || !payload.userId) {
    throw new HttpError(401, 'Teacher ticket requires sign in');
  }

  const user = await prisma.user.findUnique({ where: { id: payload.userId } });
  if (!user) {
    throw new HttpError(401, 'Teacher ticket requires sign in');
  }

  return user;
}

export const checkoutRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/api/checkout',
    {
      config: {
        rateLimit: {
          max: 15,
          timeWindow: '1 minute'
        }
      }
    },
    async (request, reply) => {
      const parsed = checkoutRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      const {
        performanceId,
        checkoutMode,
        seatIds,
        ticketSelections,
        holdToken,
        clientToken,
        customerEmail,
        customerName,
        attendeeNames
      } = parsed.data;
      const uniqueSeatIds = [...new Set(seatIds)];

      try {
        await releaseExpiredHolds();

        const [performance, holdSession] = await Promise.all([
          prisma.performance.findUnique({
            where: { id: performanceId },
            include: { show: true, pricingTiers: true }
          }),
          prisma.holdSession.findUnique({
            where: { holdToken },
            include: {
              seatHolds: {
                select: { seatId: true }
              }
            }
          })
        ]);

        if (!performance) {
          throw new HttpError(404, 'Performance not found');
        }

        const salesCutoffAt = performance.salesCutoffAt || performance.startsAt;
        if (salesCutoffAt <= new Date()) {
          throw new HttpError(400, 'Online sales are closed for this performance');
        }

        if (!holdSession || holdSession.performanceId !== performanceId || holdSession.clientToken !== clientToken) {
          throw new HttpError(400, 'Invalid hold token for this session');
        }

        if (holdSession.status !== 'ACTIVE' || holdSession.expiresAt < new Date()) {
          throw new HttpError(400, 'Hold expired');
        }

        const heldSeatIds = holdSession.seatHolds.map((seat) => seat.seatId).sort();
        if (heldSeatIds.length !== uniqueSeatIds.length || heldSeatIds.join(',') !== uniqueSeatIds.sort().join(',')) {
          throw new HttpError(400, 'Held seats do not match checkout request');
        }

        const seats = await prisma.seat.findMany({
          where: {
            id: { in: uniqueSeatIds },
            performanceId
          }
        });

        if (seats.length !== uniqueSeatIds.length) {
          throw new HttpError(400, 'One or more seats are invalid');
        }

        const unavailable = seats.find((seat) => seat.status !== 'HELD' || seat.holdSessionId !== holdSession.id);
        if (unavailable) {
          throw new HttpError(409, 'One or more seats are no longer held for this checkout');
        }

        const normalizedCustomerEmail = customerEmail.trim().toLowerCase();
        const normalizedCustomerName = customerName.trim();

        if (checkoutMode === 'TEACHER_COMP') {
          if (!performance.staffCompsEnabled) {
            throw new HttpError(400, 'Teacher complimentary tickets are not enabled for this performance');
          }

          if (uniqueSeatIds.length !== 1) {
            throw new HttpError(400, 'Teacher complimentary tickets require selecting exactly one seat');
          }

          const user = await requireAuthenticatedStaff(app, request.headers.authorization);
          if (!user.verifiedStaff) {
            throw new HttpError(403, 'Staff verification is required before reserving a teacher ticket');
          }

          const userRedemptionCount = await prisma.staffCompRedemption.count({
            where: {
              performanceId: performance.id,
              userId: user.id
            }
          });

          const perUserLimit = Math.max(1, performance.staffCompLimitPerUser || 1);
          if (userRedemptionCount >= perUserLimit) {
            throw new HttpError(409, `Teacher complimentary ticket limit reached for this performance (${perUserLimit})`);
          }

          const seatId = uniqueSeatIds[0];
          const order = await createAssignedOrder({
            performanceId: performance.id,
            seatIds: [seatId],
            userId: user.id,
            staffCompRedemptionUserId: user.id,
            customerName: user.name,
            customerEmail: user.email,
            attendeeNames,
            ticketTypeBySeatId: { [seatId]: 'Teacher Comp' },
            priceBySeatId: { [seatId]: 0 },
            source: 'STAFF_COMP',
            allowHeldSeats: true,
            enforceSalesCutoff: true,
            sendEmail: true
          });

          return reply.send({
            orderId: order.id,
            mode: checkoutMode
          });
        }

        if (checkoutMode === 'FAMILY_FREE') {
          if (!performance.familyFreeTicketEnabled) {
            throw new HttpError(400, 'Family free ticket offers are not enabled for this performance');
          }

          if (uniqueSeatIds.length !== 1) {
            throw new HttpError(400, 'Family free tickets require selecting exactly one seat');
          }

          const existingClaim = await prisma.order.findFirst({
            where: {
              email: normalizedCustomerEmail,
              source: 'FAMILY_FREE',
              status: 'PAID',
              performance: {
                showId: performance.showId
              }
            },
            select: { id: true }
          });

          if (existingClaim) {
            throw new HttpError(409, 'A family free ticket has already been claimed for this show run with this email');
          }

          const seatId = uniqueSeatIds[0];
          const order = await createAssignedOrder({
            performanceId: performance.id,
            seatIds: [seatId],
            customerName: normalizedCustomerName,
            customerEmail: normalizedCustomerEmail,
            attendeeNames,
            ticketTypeBySeatId: { [seatId]: 'Family Free' },
            priceBySeatId: { [seatId]: 0 },
            source: 'FAMILY_FREE',
            allowHeldSeats: true,
            enforceSalesCutoff: true,
            sendEmail: true
          });

          return reply.send({
            orderId: order.id,
            mode: checkoutMode
          });
        }

        const sortedSeats = [...seats].sort((a, b) => {
          if (a.sectionName !== b.sectionName) return a.sectionName.localeCompare(b.sectionName);
          if (a.row !== b.row) return a.row.localeCompare(b.row, undefined, { numeric: true });
          return a.number - b.number;
        });

        const tiersById = new Map(performance.pricingTiers.map((tier) => [tier.id, tier]));
        const expandedTierSelection: Array<{ tierId: string; name: string; priceCents: number }> = [];

        if (ticketSelections && ticketSelections.length > 0) {
          for (const selectedTier of ticketSelections) {
            if (selectedTier.count <= 0) continue;
            const tier = tiersById.get(selectedTier.tierId);
            if (!tier) {
              throw new HttpError(400, `Invalid ticket tier: ${selectedTier.tierId}`);
            }

            for (let i = 0; i < selectedTier.count; i += 1) {
              expandedTierSelection.push({
                tierId: tier.id,
                name: tier.name,
                priceCents: tier.priceCents
              });
            }
          }

          if (expandedTierSelection.length !== sortedSeats.length) {
            throw new HttpError(400, 'Ticket category counts must equal selected seat count');
          }
        }

        const seatAssignments = sortedSeats.map((seat, index) => {
          const selectedTier = expandedTierSelection[index];
          const ticketType = selectedTier?.name || null;
          const price = selectedTier?.priceCents ?? seat.price;

          return {
            seat,
            price,
            ticketType
          };
        });

        const amountTotal = seatAssignments.reduce((sum, assignment) => sum + assignment.price, 0);

        const order = await prisma.order.create({
          data: {
            performanceId,
            email: normalizedCustomerEmail,
            customerName: normalizedCustomerName,
            attendeeNamesJson: attendeeNames ?? undefined,
            amountTotal,
            currency: 'usd',
            status: 'PENDING',
            source: 'ONLINE',
            holdToken
          }
        });

        await prisma.orderSeat.createMany({
          data: seatAssignments.map((assignment) => ({
            orderId: order.id,
            seatId: assignment.seat.id,
            price: assignment.price,
            ticketType: assignment.ticketType,
            attendeeName: attendeeNames?.[assignment.seat.id]
          }))
        });

        const lineItems = seatAssignments.map((assignment) => ({
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: assignment.price,
            product_data: {
              name: `${performance.title || performance.show.title} - ${assignment.seat.sectionName} Row ${assignment.seat.row} Seat ${assignment.seat.number}`,
              description: assignment.ticketType ? `${assignment.ticketType} ticket` : undefined
            }
          }
        }));

        const session = await stripe.checkout.sessions.create({
          mode: 'payment',
          customer_email: normalizedCustomerEmail,
          line_items: lineItems,
          payment_intent_data: {
            metadata: {
              orderId: order.id,
              holdToken
            }
          },
          success_url: `${env.APP_BASE_URL}/confirmation?orderId=${order.id}`,
          cancel_url: `${env.APP_BASE_URL}/booking/${performanceId}`,
          metadata: {
            orderId: order.id,
            performanceId,
            holdToken,
            clientToken,
            seatIds: JSON.stringify(uniqueSeatIds)
          }
        });

        await prisma.order.update({
          where: { id: order.id },
          data: {
            stripeSessionId: session.id
          }
        });

        reply.send({ url: session.url });
      } catch (err) {
        handleRouteError(reply, err, 'Checkout failed');
      }
    }
  );
};
