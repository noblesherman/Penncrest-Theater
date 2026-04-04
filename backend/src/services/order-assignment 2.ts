import crypto from 'node:crypto';
import { InPersonPaymentMethod, OrderSource, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/http-error.js';
import { buildQrPayload } from '../lib/qr.js';
import { generateOrderAccessToken } from '../lib/order-access.js';
import { sendTicketsEmail } from '../lib/email.js';

type AssignedOrderParams = {
  performanceId: string;
  seatIds: string[];
  userId?: string;
  staffCompRedemptionUserId?: string;
  customerName: string;
  customerEmail: string;
  attendeeNames?: Record<string, string>;
  source: OrderSource;
  ticketTypeBySeatId?: Record<string, string>;
  priceBySeatId?: Record<string, number>;
  allowHeldSeats?: boolean;
  enforceSalesCutoff?: boolean;
  sendEmail?: boolean;
  inPersonPaymentMethod?: InPersonPaymentMethod | null;
};

function dedupeSeatIds(seatIds: string[]): string[] {
  return [...new Set(seatIds)];
}

async function hasInPersonPaymentMethodColumn(): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ inPersonPaymentMethodColumn: boolean }>>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'Order'
        AND column_name = 'inPersonPaymentMethod'
    ) AS "inPersonPaymentMethodColumn"
  `;

  return Boolean(rows[0]?.inPersonPaymentMethodColumn);
}

function sortSeats<T extends { sectionName: string; row: string; number: number }>(seats: T[]): T[] {
  return [...seats].sort((a, b) => {
    if (a.sectionName !== b.sectionName) return a.sectionName.localeCompare(b.sectionName);
    if (a.row !== b.row) return a.row.localeCompare(b.row, undefined, { numeric: true, sensitivity: 'base' });
    return a.number - b.number;
  });
}

function validateCompanionSelection(
  seats: Array<{
    id: string;
    isAccessible: boolean;
    isCompanion: boolean;
    companionForSeatId: string | null;
  }>
): void {
  const selectedSeatIds = new Set(seats.map((seat) => seat.id));
  const selectedAccessibleSeats = seats.filter((seat) => seat.isAccessible);

  const invalidCompanion = seats.find((seat) => {
    if (!seat.isCompanion) return false;
    if (seat.companionForSeatId) {
      return !selectedSeatIds.has(seat.companionForSeatId);
    }
    return selectedAccessibleSeats.length === 0;
  });

  if (invalidCompanion) {
    throw new HttpError(400, 'Companion seats require a paired accessible seat in the same order');
  }
}

async function closeEmptyHolds(tx: Prisma.TransactionClient, holdIds: string[]): Promise<void> {
  if (holdIds.length === 0) return;

  const candidates = await tx.holdSession.findMany({
    where: {
      id: { in: holdIds },
      status: 'ACTIVE'
    },
    include: { seatHolds: true }
  });

  const emptyIds = candidates.filter((hold) => hold.seatHolds.length === 0).map((hold) => hold.id);
  if (emptyIds.length === 0) return;

  await tx.holdSession.updateMany({
    where: { id: { in: emptyIds } },
    data: { status: 'CANCELED' }
  });
}

export async function createAssignedOrder(params: AssignedOrderParams) {
  const seatIds = dedupeSeatIds(params.seatIds);
  if (seatIds.length === 0) {
    throw new HttpError(400, 'Select at least one seat');
  }

  const email = params.customerEmail.trim().toLowerCase();
  if (!email) {
    throw new HttpError(400, 'Customer email is required');
  }

  const name = params.customerName.trim();
  if (!name) {
    throw new HttpError(400, 'Customer name is required');
  }

  const allowHeldSeats = Boolean(params.allowHeldSeats);
  const enforceSalesCutoff = params.enforceSalesCutoff ?? false;
  const supportsInPersonPaymentMethod = await hasInPersonPaymentMethodColumn();

  const order = await prisma.$transaction(async (tx) => {
    if (params.source === 'DOOR' && !params.inPersonPaymentMethod) {
      throw new HttpError(400, 'In-person door sales require a payment method');
    }

    if (params.source !== 'DOOR' && params.inPersonPaymentMethod) {
      throw new HttpError(400, 'Payment method is only supported for in-person door sales');
    }

    const performance = await tx.performance.findFirst({
      where: { id: params.performanceId, isArchived: false },
      include: {
        show: true,
        seats: {
          where: { id: { in: seatIds } },
          select: {
            id: true,
            sectionName: true,
            row: true,
            number: true,
            price: true,
            status: true,
            holdSessionId: true,
            isAccessible: true,
            isCompanion: true,
            companionForSeatId: true
          }
        }
      }
    });

    if (!performance) {
      throw new HttpError(404, 'Performance not found');
    }

    if (enforceSalesCutoff) {
      const salesCutoffAt = performance.salesCutoffAt || performance.startsAt;
      if (salesCutoffAt <= new Date()) {
        throw new HttpError(400, 'Online sales are closed for this performance');
      }
    }

    if (performance.seats.length !== seatIds.length) {
      throw new HttpError(400, 'One or more selected seats are invalid for this performance');
    }

    validateCompanionSelection(performance.seats);

    const disallowed = performance.seats.find((seat) => {
      if (seat.status === 'SOLD' || seat.status === 'BLOCKED') return true;
      if (!allowHeldSeats && seat.status === 'HELD') return true;
      return false;
    });

    if (disallowed) {
      throw new HttpError(409, 'One or more selected seats are no longer available');
    }

    const heldStatuses: Array<'AVAILABLE' | 'HELD'> = allowHeldSeats ? ['AVAILABLE', 'HELD'] : ['AVAILABLE'];
    const updated = await tx.seat.updateMany({
      where: {
        id: { in: seatIds },
        performanceId: params.performanceId,
        status: { in: heldStatuses }
      },
      data: {
        status: 'SOLD',
        holdSessionId: null
      }
    });

    if (updated.count !== seatIds.length) {
      throw new HttpError(409, 'One or more selected seats are no longer available');
    }

    await tx.seatHold.deleteMany({
      where: {
        seatId: { in: seatIds }
      }
    });

    const holdIds = performance.seats
      .map((seat) => seat.holdSessionId)
      .filter((value): value is string => Boolean(value));
    await closeEmptyHolds(tx, holdIds);

    const complimentarySources = new Set<OrderSource>(['COMP', 'STAFF_FREE', 'STAFF_COMP', 'FAMILY_FREE', 'STUDENT_COMP']);
    const isSourceComplimentary = complimentarySources.has(params.source);

    const sortedSeats = sortSeats(performance.seats);
    const seatAssignments = sortedSeats.map((seat) => {
      const requestedPrice = params.priceBySeatId?.[seat.id];
      const normalizedPrice = typeof requestedPrice === 'number' && Number.isFinite(requestedPrice) ? Math.max(0, Math.round(requestedPrice)) : seat.price;
      const price = isSourceComplimentary ? 0 : normalizedPrice;
      return {
        seat,
        price,
        ticketType: params.ticketTypeBySeatId?.[seat.id] || null,
        attendeeName: params.attendeeNames?.[seat.id],
        isComplimentary: isSourceComplimentary || price === 0
      };
    });

    const amountTotal = seatAssignments.reduce((sum, assignment) => sum + assignment.price, 0);

    const createdOrder = await tx.order.create({
      data: {
        performanceId: params.performanceId,
        userId: params.userId,
        email,
        customerName: name,
        attendeeNamesJson: params.attendeeNames || undefined,
        amountTotal,
        currency: 'usd',
        status: 'PAID',
        source: params.source,
        ...(supportsInPersonPaymentMethod
          ? {
              inPersonPaymentMethod: params.source === 'DOOR' ? params.inPersonPaymentMethod || 'STRIPE' : null
            }
          : {}),
        accessToken: generateOrderAccessToken()
      }
    });

    await tx.orderSeat.createMany({
      data: seatAssignments.map((assignment) => ({
        orderId: createdOrder.id,
        seatId: assignment.seat.id,
        price: assignment.price,
        ticketType: assignment.ticketType,
        attendeeName: assignment.attendeeName,
        isComplimentary: assignment.isComplimentary
      }))
    });

    const createdTicketIds: string[] = [];
    const autoCheckInAt = params.source === 'DOOR' ? new Date() : null;

    for (const assignment of seatAssignments) {
      const ticketId = crypto.randomUUID();
      const qrSecret = crypto.randomBytes(16).toString('hex');
      await tx.ticket.create({
        data: {
          id: ticketId,
          orderId: createdOrder.id,
          performanceId: params.performanceId,
          userId: params.userId,
          seatId: assignment.seat.id,
          type:
            params.source === 'STAFF_COMP' || params.source === 'STAFF_FREE'
              ? 'STAFF_COMP'
              : params.source === 'STUDENT_COMP' && assignment.isComplimentary
                ? 'STUDENT_COMP'
                : 'PAID',
          priceCents: assignment.price,
          status: 'ISSUED',
          publicId: crypto.randomBytes(8).toString('hex'),
          qrSecret,
          qrPayload: buildQrPayload(ticketId, qrSecret),
          checkedInAt: autoCheckInAt,
          checkedInBy: autoCheckInAt ? 'BOX_OFFICE_AUTO' : null,
          checkInGate: autoCheckInAt ? 'BOX_OFFICE' : null
        }
      });
      createdTicketIds.push(ticketId);
    }

    if (params.staffCompRedemptionUserId) {
      const redemptionTicketId = createdTicketIds[0];
      if (!redemptionTicketId) {
        throw new HttpError(400, 'Staff comp redemption requires at least one ticket');
      }

      await tx.staffCompRedemption.create({
        data: {
          performanceId: params.performanceId,
          userId: params.staffCompRedemptionUserId,
          // A redemption is one claim per user/performance; tie it to the first issued ticket.
          ticketId: redemptionTicketId
        }
      });
    }

    return tx.order.findUnique({
      where: { id: createdOrder.id },
      include: {
        performance: { include: { show: true } },
        orderSeats: { include: { seat: true } },
        tickets: { include: { seat: true } }
      }
    });
  });

  if (!order) {
    throw new HttpError(500, 'Failed to create assigned order');
  }

  if (params.sendEmail) {
    const orderSeatBySeatId = new Map(order.orderSeats.map((seat) => [seat.seatId, seat]));
    const emailTickets = order.tickets.flatMap((ticket) => {
      if (!ticket.seat) return [];
      const orderSeat = ticket.seatId ? orderSeatBySeatId.get(ticket.seatId) : undefined;
      return [{
        publicId: ticket.publicId,
        row: ticket.seat.row,
        number: ticket.seat.number,
        sectionName: ticket.seat.sectionName,
        ticketType: orderSeat?.ticketType || null,
        attendeeName: orderSeat?.attendeeName || null
      }];
    });

    await sendTicketsEmail({
      orderId: order.id,
      customerName: order.customerName,
      customerEmail: order.email,
      showTitle: order.performance.title || order.performance.show.title,
      startsAtIso: order.performance.startsAt.toISOString(),
      venue: order.performance.venue,
      tickets: emailTickets
    });
  }

  return order;
}
