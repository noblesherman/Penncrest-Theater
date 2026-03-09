import { FastifyPluginAsync } from 'fastify';
import { StudentCreditVerificationMethod, User } from '@prisma/client';
import { checkoutRequestSchema } from '../schemas/checkout.js';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/http-error.js';
import { handleRouteError } from '../lib/route-error.js';
import { stripe } from '../lib/stripe.js';
import { releaseExpiredHolds } from '../services/hold-service.js';
import { createAssignedOrder } from '../services/order-assignment.js';
import { env } from '../lib/env.js';
import {
  getStudentCreditEligibilityByCode,
  redeemStudentCreditImmediatelyForPaidOrder,
  releasePendingStudentCreditForOrder,
  reserveStudentCreditForOrder
} from '../services/student-ticket-credit-service.js';

type SeatAssignment = {
  seat: {
    id: string;
    sectionName: string;
    row: string;
    number: number;
    price: number;
  };
  basePrice: number;
  finalPrice: number;
  ticketType: string | null;
  isTeacherTicket: boolean;
  isTeacherComplimentary: boolean;
  isStudentComplimentary: boolean;
};

type ResolvedTicketSelection = {
  name: string;
  priceCents: number | null;
  isTeacherTicket: boolean;
};

const TEACHER_TICKET_OPTION_ID = 'teacher-comp';
const MAX_TEACHER_COMP_TICKETS = 2;

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

function naturalSeatSort(
  a: { sectionName: string; row: string; number: number },
  b: { sectionName: string; row: string; number: number }
): number {
  if (a.sectionName !== b.sectionName) return a.sectionName.localeCompare(b.sectionName);
  if (a.row !== b.row) return a.row.localeCompare(b.row, undefined, { numeric: true, sensitivity: 'base' });
  return a.number - b.number;
}

function pickComplimentarySeatIds(assignments: SeatAssignment[], quantity: number): Set<string> {
  if (quantity <= 0) {
    return new Set();
  }

  const ranked = [...assignments].sort((a, b) => {
    if (a.basePrice !== b.basePrice) return b.basePrice - a.basePrice;
    return naturalSeatSort(a.seat, b.seat);
  });

  return new Set(ranked.slice(0, quantity).map((assignment) => assignment.seat.id));
}

function isTeacherTicketName(name: string): boolean {
  return name.trim().toLowerCase().includes('teacher');
}

function buildStripeLineItems(
  showTitle: string,
  assignments: SeatAssignment[]
): Array<{
  quantity: number;
  price_data: {
    currency: string;
    unit_amount: number;
    product_data: { name: string; description?: string };
  };
}> {
  return assignments
    .filter((assignment) => assignment.finalPrice > 0)
    .map((assignment) => ({
      quantity: 1,
      price_data: {
        currency: 'usd',
        unit_amount: assignment.finalPrice,
        product_data: {
          name: `${showTitle} - ${assignment.seat.sectionName} Row ${assignment.seat.row} Seat ${assignment.seat.number}`,
          description: assignment.ticketType ? `${assignment.ticketType} ticket` : undefined
        }
      }
    }));
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
        ticketSelectionBySeatId,
        holdToken,
        clientToken,
        studentVerificationCode,
        customerEmail,
        customerName,
        attendeeNames
      } = parsed.data;
      const uniqueSeatIds = [...new Set(seatIds)];
      const isStudentCompCheckout = checkoutMode === 'STUDENT_COMP';

      let createdOrderId: string | null = null;
      let reservedStudentCredits = false;

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
        const isTeacherCompCheckout = checkoutMode === 'TEACHER_COMP';
        let teacherCheckoutUser: User | null = null;
        let effectiveCustomerEmail = normalizedCustomerEmail;
        let effectiveCustomerName = normalizedCustomerName;

        if (isTeacherCompCheckout) {
          if (!performance.staffCompsEnabled) {
            throw new HttpError(400, 'Teacher complimentary tickets are not enabled for this performance');
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

          if (userRedemptionCount >= 1) {
            throw new HttpError(409, 'Teacher complimentary tickets have already been claimed for this performance');
          }

          teacherCheckoutUser = user;
          if (!effectiveCustomerName) {
            throw new HttpError(400, 'Customer name is required for teacher checkout');
          }
          if (!effectiveCustomerEmail) {
            throw new HttpError(400, 'Customer email is required for teacher checkout');
          }
          if (effectiveCustomerEmail.endsWith('@rtmsd.org')) {
            throw new HttpError(400, 'Use a personal email for ticket delivery (not @rtmsd.org)');
          }
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

        const sortedSeats = [...seats].sort(naturalSeatSort);
        const tiersById = new Map(performance.pricingTiers.map((tier) => [tier.id, tier]));
        const resolveTicketSelection = (selectionId: string): ResolvedTicketSelection => {
          if (selectionId === TEACHER_TICKET_OPTION_ID) {
            return {
              name: 'Teacher',
              priceCents: null,
              isTeacherTicket: true
            };
          }

          const tier = tiersById.get(selectionId);
          if (!tier) {
            throw new HttpError(400, `Invalid ticket tier: ${selectionId}`);
          }

          return {
            name: tier.name,
            priceCents: tier.priceCents,
            isTeacherTicket: isTeacherTicketName(tier.name)
          };
        };

        const resolvedSelectionBySeatId = new Map<string, ResolvedTicketSelection>();
        if (ticketSelectionBySeatId && Object.keys(ticketSelectionBySeatId).length > 0) {
          const providedSeatIds = Object.keys(ticketSelectionBySeatId).sort();
          const sortedRequestedSeatIds = [...uniqueSeatIds].sort();
          if (
            providedSeatIds.length !== sortedRequestedSeatIds.length ||
            providedSeatIds.join(',') !== sortedRequestedSeatIds.join(',')
          ) {
            throw new HttpError(400, 'Ticket seat selections must match selected seats');
          }

          for (const seatId of sortedRequestedSeatIds) {
            const selectionId = ticketSelectionBySeatId[seatId];
            if (!selectionId) {
              throw new HttpError(400, `Missing ticket selection for seat: ${seatId}`);
            }
            resolvedSelectionBySeatId.set(seatId, resolveTicketSelection(selectionId));
          }
        }

        const expandedTierSelection: ResolvedTicketSelection[] = [];
        if (resolvedSelectionBySeatId.size === 0 && ticketSelections && ticketSelections.length > 0) {
          for (const selectedTier of ticketSelections) {
            if (selectedTier.count <= 0) continue;
            const resolved = resolveTicketSelection(selectedTier.tierId);
            for (let i = 0; i < selectedTier.count; i += 1) {
              expandedTierSelection.push(resolved);
            }
          }

          if (expandedTierSelection.length !== sortedSeats.length) {
            throw new HttpError(400, 'Ticket category counts must equal selected seat count');
          }
        }

        let seatAssignments: SeatAssignment[] = sortedSeats.map((seat, index) => {
          const selectedTicket =
            resolvedSelectionBySeatId.get(seat.id) ??
            (expandedTierSelection.length > 0 ? expandedTierSelection[index] : null);
          const basePrice = selectedTicket?.priceCents ?? seat.price;

          return {
            seat,
            basePrice,
            finalPrice: basePrice,
            ticketType: selectedTicket?.name || null,
            isTeacherTicket: selectedTicket?.isTeacherTicket || false,
            isTeacherComplimentary: false,
            isStudentComplimentary: false
          };
        });

        if (isTeacherCompCheckout) {
          const teacherTicketAssignments = seatAssignments.filter((assignment) => assignment.isTeacherTicket);
          const complimentaryCandidates = teacherTicketAssignments.length > 0 ? teacherTicketAssignments : seatAssignments;
          const complimentaryTeacherQuantity = Math.min(MAX_TEACHER_COMP_TICKETS, complimentaryCandidates.length);
          const complimentaryTeacherSeatIds = pickComplimentarySeatIds(complimentaryCandidates, complimentaryTeacherQuantity);

          seatAssignments = seatAssignments.map((assignment) => {
            const isTeacherCompSeat = complimentaryTeacherSeatIds.has(assignment.seat.id);
            return {
              ...assignment,
              finalPrice: isTeacherCompSeat ? 0 : assignment.basePrice,
              ticketType: isTeacherCompSeat ? 'Teacher Comp' : assignment.ticketType,
              isTeacherComplimentary: isTeacherCompSeat
            };
          });
        }

        let studentTicketCreditId: string | null = null;
        let studentComplimentaryQuantity = 0;

        if (isStudentCompCheckout) {
          if (!studentVerificationCode || !studentVerificationCode.trim()) {
            throw new HttpError(400, 'Student verification code is required');
          }

          const eligibility = await getStudentCreditEligibilityByCode({
            performanceId,
            verificationCode: studentVerificationCode,
            requestedSeatCount: seatAssignments.length
          });

          studentTicketCreditId = eligibility.studentTicketCreditId;
          studentComplimentaryQuantity = Math.min(seatAssignments.length, eligibility.maxUsableOnCheckout);

          if (studentComplimentaryQuantity <= 0) {
            throw new HttpError(409, 'No complimentary student tickets available for this checkout');
          }

          const complimentarySeatIds = pickComplimentarySeatIds(seatAssignments, studentComplimentaryQuantity);
          seatAssignments = seatAssignments.map((assignment) => {
            const isStudentCompSeat = complimentarySeatIds.has(assignment.seat.id);
            return {
              ...assignment,
              finalPrice: isStudentCompSeat ? 0 : assignment.basePrice,
              ticketType: isStudentCompSeat ? 'Student Comp' : assignment.ticketType,
              isStudentComplimentary: isStudentCompSeat
            };
          });
        }

        const amountTotal = seatAssignments.reduce((sum, assignment) => sum + assignment.finalPrice, 0);

        if (amountTotal === 0) {
          const ticketTypeBySeatId = Object.fromEntries(
            seatAssignments.map((assignment) => [assignment.seat.id, assignment.ticketType || 'Complimentary'])
          );
          const priceBySeatId = Object.fromEntries(seatAssignments.map((assignment) => [assignment.seat.id, assignment.finalPrice]));

          const order = await createAssignedOrder({
            performanceId,
            seatIds: uniqueSeatIds,
            userId: teacherCheckoutUser?.id,
            staffCompRedemptionUserId: isTeacherCompCheckout ? teacherCheckoutUser?.id : undefined,
            customerName: effectiveCustomerName,
            customerEmail: effectiveCustomerEmail,
            attendeeNames,
            ticketTypeBySeatId,
            priceBySeatId,
            source: isStudentCompCheckout ? 'STUDENT_COMP' : isTeacherCompCheckout ? 'STAFF_COMP' : 'ONLINE',
            allowHeldSeats: true,
            enforceSalesCutoff: true,
            sendEmail: true
          });

          if (isStudentCompCheckout && studentTicketCreditId && studentComplimentaryQuantity > 0) {
            await redeemStudentCreditImmediatelyForPaidOrder({
              orderId: order.id,
              performanceId,
              studentTicketCreditId,
              quantity: studentComplimentaryQuantity,
              verificationMethod: StudentCreditVerificationMethod.CODE
            });
          }

          return reply.send({
            orderId: order.id,
            mode: checkoutMode
          });
        }

        const source = isStudentCompCheckout ? 'STUDENT_COMP' : isTeacherCompCheckout ? 'STAFF_COMP' : 'ONLINE';
        const order = await prisma.order.create({
          data: {
            performanceId,
            userId: teacherCheckoutUser?.id,
            email: effectiveCustomerEmail,
            customerName: effectiveCustomerName,
            attendeeNamesJson: attendeeNames ?? undefined,
            amountTotal,
            currency: 'usd',
            status: 'PENDING',
            source,
            holdToken
          }
        });
        createdOrderId = order.id;

        await prisma.orderSeat.createMany({
          data: seatAssignments.map((assignment) => ({
            orderId: order.id,
            seatId: assignment.seat.id,
            price: assignment.finalPrice,
            ticketType: assignment.ticketType,
            attendeeName: attendeeNames?.[assignment.seat.id],
            isComplimentary: assignment.finalPrice === 0
          }))
        });

        if (isStudentCompCheckout && studentTicketCreditId && studentComplimentaryQuantity > 0) {
          await reserveStudentCreditForOrder({
            orderId: order.id,
            studentTicketCreditId,
            quantity: studentComplimentaryQuantity,
            verificationMethod: StudentCreditVerificationMethod.CODE
          });
          reservedStudentCredits = true;
        }

        const lineItems = buildStripeLineItems(performance.title || performance.show.title, seatAssignments);
        if (lineItems.length === 0) {
          throw new HttpError(400, 'Checkout has no payable line items');
        }

        const session = await stripe.checkout.sessions.create({
          mode: 'payment',
          customer_email: effectiveCustomerEmail,
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
            seatIds: JSON.stringify(uniqueSeatIds),
            checkoutMode,
            studentCreditQuantity: String(studentComplimentaryQuantity)
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
        if (createdOrderId && reservedStudentCredits) {
          try {
            await releasePendingStudentCreditForOrder(createdOrderId);
          } catch (releaseErr) {
            request.log?.error?.(releaseErr);
          }
        }

        if (createdOrderId) {
          try {
            await prisma.order.updateMany({
              where: {
                id: createdOrderId,
                status: 'PENDING'
              },
              data: {
                status: 'CANCELED'
              }
            });
          } catch (cancelErr) {
            request.log?.error?.(cancelErr);
          }
        }

        handleRouteError(reply, err, 'Checkout failed');
      }
    }
  );
};
