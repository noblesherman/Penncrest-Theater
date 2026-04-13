import crypto from 'node:crypto';
import Stripe from 'stripe';
import { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { env } from '../lib/env.js';
import { prisma } from '../lib/prisma.js';
import { stripe } from '../lib/stripe.js';
import { handleRouteError } from '../lib/route-error.js';
import { HttpError } from '../lib/http-error.js';
import { sendTicketsEmail } from '../lib/email.js';
import { logAudit } from '../lib/audit-log.js';
import { createAssignedOrder } from '../services/order-assignment.js';
import { requestStripeRefundForOrder } from '../services/order-refund-service.js';
import { releaseHoldByToken } from '../services/hold-service.js';
import {
  createTerminalDispatchHold,
  expireDeviceDispatches,
  expireExpiredTerminalDispatches,
  expireTerminalDispatchIfNeeded,
  getActiveTerminalDeviceSession,
  isTerminalDeviceBusy,
  listActiveTerminalDeviceSessions,
  parseTerminalDispatchSnapshot,
  type TerminalDispatchSnapshot
} from '../services/terminal-dispatch-service.js';
import {
  getStudentCreditEligibilityByStudentCode,
  normalizeStudentVerificationCode,
  releasePendingStudentCreditForOrderTx
} from '../services/student-ticket-credit-service.js';

const refundSchema = z.object({
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

const inPersonQuoteSchema = z.object({
  performanceId: z.string().min(1),
  seatIds: z.array(z.string().min(1)).min(1).max(50),
  ticketSelectionBySeatId: z.record(z.string().min(1), z.string().min(1)),
  studentCode: z.string().min(1).optional(),
  source: z.literal('DOOR').default('DOOR'),
});

const inPersonFinalizeSchema = z.object({
  performanceId: z.string().min(1),
  seatIds: z.array(z.string().min(1)).min(1).max(50),
  ticketSelectionBySeatId: z.record(z.string().min(1), z.string().min(1)),
  customerName: z.string().max(120).optional(),
  paymentMethod: z.enum(['STRIPE', 'CASH']).default('STRIPE'),
  receiptEmail: z.string().email().optional(),
  sendReceipt: z.boolean().optional(),
  studentCode: z.string().min(1).optional(),
});

const inPersonManualIntentSchema = z.object({
  performanceId: z.string().min(1),
  seatIds: z.array(z.string().min(1)).min(1).max(50),
  ticketSelectionBySeatId: z.record(z.string().min(1), z.string().min(1)),
  customerName: z.string().max(120).optional(),
  receiptEmail: z.string().email().optional(),
  sendReceipt: z.boolean().optional(),
  studentCode: z.string().min(1).optional()
});

const inPersonManualCompleteSchema = inPersonManualIntentSchema.extend({
  paymentIntentId: z.string().min(1)
});

const inPersonTerminalSendSchema = z.object({
  performanceId: z.string().min(1),
  seatIds: z.array(z.string().min(1)).min(1).max(50),
  ticketSelectionBySeatId: z.record(z.string().min(1), z.string().min(1)),
  customerName: z.string().max(120).optional(),
  receiptEmail: z.string().email().optional(),
  sendReceipt: z.boolean().optional(),
  studentCode: z.string().min(1).optional(),
  deviceId: z.string().min(1).max(200),
  sellerStationName: z.string().trim().max(120).optional(),
  sellerAdminId: z.string().trim().max(120).optional(),
  sellerClientSessionId: z.string().trim().max(160).optional(),
  submissionId: z.string().trim().max(160).optional()
});

const terminalDispatchParamsSchema = z.object({
  dispatchId: z.string().min(1)
});

const inPersonCashTonightQuerySchema = z.object({
  performanceId: z.string().min(1).optional()
});

type InPersonSaleSeat = {
  id: string;
  sectionName: string;
  row: string;
  number: number;
  price: number;
  status: 'AVAILABLE' | 'HELD' | 'SOLD' | 'BLOCKED';
  isAccessible: boolean;
  isCompanion: boolean;
  companionForSeatId: string | null;
};

const TEACHER_TICKET_OPTION_ID = 'teacher-comp';
const STUDENT_SHOW_TICKET_OPTION_ID = 'student-show-comp';
const MAX_TEACHER_COMP_TICKETS = 2;
const MAX_STUDENT_COMP_TICKETS = 2;

function isTeacherTicketName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return normalized.includes('teacher') || (normalized.includes('rtmsd') && normalized.includes('staff'));
}

function isStudentInShowTicketName(name: string): boolean {
  return name.trim().toLowerCase().includes('student in show');
}

function pickComplimentarySeatIds(
  seats: Array<{ id: string; sectionName: string; row: string; number: number; basePriceCents: number }>,
  quantity: number
): Set<string> {
  if (quantity <= 0) {
    return new Set();
  }

  const ranked = [...seats].sort((a, b) => {
    if (a.basePriceCents !== b.basePriceCents) {
      return b.basePriceCents - a.basePriceCents;
    }
    if (a.sectionName !== b.sectionName) {
      return a.sectionName.localeCompare(b.sectionName);
    }
    if (a.row !== b.row) {
      return a.row.localeCompare(b.row, undefined, { numeric: true, sensitivity: 'base' });
    }
    return a.number - b.number;
  });

  return new Set(ranked.slice(0, quantity).map((seat) => seat.id));
}

function isMissingInPersonPaymentMethodColumnError(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }

  if (err.code !== 'P2022') {
    return false;
  }

  const haystack = `${err.message} ${JSON.stringify(err.meta || {})}`.toLowerCase();
  return haystack.includes('inpersonpaymentmethod');
}

function parseAuditMetadata(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

async function summarizeCashFromAuditLogFallback(params: {
  performanceId?: string;
  nightStart: Date;
  nightEnd: Date;
}): Promise<{ totalCashCents: number; saleCount: number }> {
  const rows = await prisma.auditLog.findMany({
    where: {
      action: 'IN_PERSON_SALE_FINALIZED',
      createdAt: {
        gte: params.nightStart,
        lte: params.nightEnd
      }
    },
    select: {
      metadataJson: true,
      meta: true
    }
  });

  let totalCashCents = 0;
  let saleCount = 0;

  rows.forEach((row) => {
    const metadata = parseAuditMetadata(row.metadataJson) || parseAuditMetadata(row.meta);
    if (!metadata) return;

    if (String(metadata.paymentMethod || '').toUpperCase() !== 'CASH') {
      return;
    }

    if (params.performanceId && String(metadata.performanceId || '') !== params.performanceId) {
      return;
    }

    const expectedAmountCents = Number(metadata.expectedAmountCents);
    if (!Number.isFinite(expectedAmountCents) || expectedAmountCents < 0) {
      return;
    }

    totalCashCents += Math.round(expectedAmountCents);
    saleCount += 1;
  });

  return { totalCashCents, saleCount };
}

function dedupeSeatIds(seatIds: string[]): string[] {
  return [...new Set(seatIds)];
}

function isoFromUnix(seconds?: number | null): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
    return null;
  }
  return new Date(seconds * 1000).toISOString();
}

function isDeletedStripeCustomer(customer: Stripe.Customer | Stripe.DeletedCustomer): customer is Stripe.DeletedCustomer {
  return 'deleted' in customer && customer.deleted === true;
}

type StripeActivityEntry = {
  key: string;
  label: string;
  status: 'success' | 'warning' | 'info';
  occurredAt: string;
};

function buildStripeActivity(params: {
  paymentIntent: Stripe.PaymentIntent;
  charge: Stripe.Charge | null;
  refunds: Stripe.Refund[];
}): StripeActivityEntry[] {
  const entries: StripeActivityEntry[] = [];

  const paymentCreatedAt = isoFromUnix(params.paymentIntent.created);
  if (paymentCreatedAt) {
    entries.push({
      key: `pi-created:${params.paymentIntent.id}`,
      label: 'Payment started',
      status: 'info',
      occurredAt: paymentCreatedAt
    });
  }

  if (params.paymentIntent.status === 'succeeded') {
    const succeededAt =
      isoFromUnix(params.charge?.created ?? null) ||
      isoFromUnix(params.paymentIntent.created);
    if (succeededAt) {
      entries.push({
        key: `pi-succeeded:${params.paymentIntent.id}`,
        label: 'Payment succeeded',
        status: 'success',
        occurredAt: succeededAt
      });
    }
  }

  if (params.paymentIntent.status === 'requires_payment_method' || params.paymentIntent.status === 'canceled') {
    const canceledAt =
      isoFromUnix(params.paymentIntent.canceled_at) ||
      isoFromUnix(params.paymentIntent.created);
    if (canceledAt) {
      entries.push({
        key: `pi-blocked:${params.paymentIntent.id}`,
        label: params.paymentIntent.status === 'canceled' ? 'Payment canceled' : 'Payment needs attention',
        status: 'warning',
        occurredAt: canceledAt
      });
    }
  }

  if (params.charge) {
    const chargeCreatedAt = isoFromUnix(params.charge.created);
    if (chargeCreatedAt) {
      entries.push({
        key: `charge:${params.charge.id}`,
        label:
          params.charge.status === 'succeeded'
            ? 'Charge captured'
            : params.charge.status === 'failed'
              ? 'Charge failed'
              : `Charge ${params.charge.status}`,
        status: params.charge.status === 'succeeded' ? 'success' : params.charge.status === 'failed' ? 'warning' : 'info',
        occurredAt: chargeCreatedAt
      });
    }
  }

  params.refunds.forEach((refund) => {
    const occurredAt = isoFromUnix(refund.created);
    if (!occurredAt) return;

    entries.push({
      key: `refund:${refund.id}`,
      label: `Refund ${refund.status}`,
      status: refund.status === 'succeeded' ? 'success' : refund.status === 'failed' ? 'warning' : 'info',
      occurredAt
    });
  });

  return entries
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, 10);
}

function sortSeats<T extends { sectionName: string; row: string; number: number }>(seats: T[]): T[] {
  return [...seats].sort((a, b) => {
    if (a.sectionName !== b.sectionName) {
      return a.sectionName.localeCompare(b.sectionName);
    }
    if (a.row !== b.row) {
      return a.row.localeCompare(b.row, undefined, { numeric: true, sensitivity: 'base' });
    }
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

async function buildInPersonSaleQuote(params: {
  performanceId: string;
  seatIds: string[];
  ticketSelectionBySeatId: Record<string, string>;
  studentCode?: string;
}): Promise<{
  performanceId: string;
  performanceTitle: string;
  isGeneralAdmission: boolean;
  seatIds: string[];
  holdSeatIds: string[];
  seatCount: number;
  expectedAmountCents: number;
  currency: 'usd';
  ticketOptions: Array<{
    id: string;
    name: string;
    priceCents: number;
  }>;
  seats: Array<{
    id: string;
    label: string;
    sectionName: string;
    row: string;
    number: number;
    ticketTierId: string;
    ticketType: string;
    priceCents: number;
  }>;
}> {
  const normalizedSeatIds = dedupeSeatIds(params.seatIds);
  if (normalizedSeatIds.length === 0) {
    throw new HttpError(400, 'Select at least one seat');
  }

  const performance = await prisma.performance.findFirst({
    where: { id: params.performanceId, isArchived: false },
    include: {
      show: true,
      pricingTiers: {
        select: {
          id: true,
          name: true,
          priceCents: true
        }
      },
      seats: {
        where: { id: { in: normalizedSeatIds } },
        select: {
          id: true,
          sectionName: true,
          row: true,
          number: true,
          price: true,
          status: true,
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

  const isGeneralAdmission = performance.seatSelectionEnabled === false;

  if (!isGeneralAdmission && performance.seats.length !== normalizedSeatIds.length) {
    throw new HttpError(400, 'One or more selected seats are invalid for this performance');
  }

  if (performance.pricingTiers.length === 0) {
    throw new HttpError(400, 'No pricing tiers are configured for this performance');
  }

  const providedSeatIds = Object.keys(params.ticketSelectionBySeatId).sort();
  const requestedSeatIds = [...normalizedSeatIds].sort();
  if (
    providedSeatIds.length !== requestedSeatIds.length ||
    providedSeatIds.join(',') !== requestedSeatIds.join(',')
  ) {
    throw new HttpError(400, 'Ticket selections must include every selected seat');
  }

  const tierById = new Map(performance.pricingTiers.map((tier) => [tier.id, tier]));

  const hasTeacherOption = performance.pricingTiers.some(
    (tier) => tier.id === TEACHER_TICKET_OPTION_ID || isTeacherTicketName(tier.name)
  );
  const hasStudentOption = performance.pricingTiers.some(
    (tier) => tier.id === STUDENT_SHOW_TICKET_OPTION_ID || isStudentInShowTicketName(tier.name)
  );

  const ticketOptions = performance.pricingTiers
    .map((tier) => ({
      id: tier.id,
      name: tier.name,
      priceCents: tier.priceCents
    }));

  if (performance.staffCompsEnabled && !hasTeacherOption) {
    ticketOptions.push({
      id: TEACHER_TICKET_OPTION_ID,
      name: 'RTMSD STAFF',
      priceCents: 0
    });
  }

  if (performance.familyFreeTicketEnabled && !hasStudentOption) {
    ticketOptions.push({
      id: STUDENT_SHOW_TICKET_OPTION_ID,
      name: 'Student in Show',
      priceCents: 0
    });
  }

  if (!isGeneralAdmission) {
    validateCompanionSelection(performance.seats as InPersonSaleSeat[]);

    const unavailableSeat = performance.seats.find(
      (seat) => seat.status === 'HELD' || seat.status === 'SOLD' || seat.status === 'BLOCKED'
    );
    if (unavailableSeat) {
      throw new HttpError(409, 'One or more selected seats are no longer available');
    }
  }

  const sortedSeats = isGeneralAdmission
    ? [...normalizedSeatIds]
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
        .map((seatId, index) => ({
          id: seatId,
          sectionName: 'General Admission',
          row: 'GA',
          number: index + 1,
          price: Math.max(0, performance.pricingTiers[0]?.priceCents || 0),
          status: 'AVAILABLE' as const,
          isAccessible: false,
          isCompanion: false,
          companionForSeatId: null
        }))
    : sortSeats(performance.seats as InPersonSaleSeat[]);
  let seatPriceSelections = sortedSeats.map((seat) => {
    const ticketTierId = params.ticketSelectionBySeatId[seat.id];
    if (!ticketTierId) {
      throw new HttpError(400, `Missing ticket selection for ${isGeneralAdmission ? 'ticket' : 'seat'}: ${seat.id}`);
    }

    if (ticketTierId === TEACHER_TICKET_OPTION_ID && !tierById.has(ticketTierId)) {
      if (!performance.staffCompsEnabled) {
        throw new HttpError(400, 'Teacher complimentary tickets are not enabled for this performance');
      }

      return {
        seat,
        ticketTierId,
        ticketType: 'RTMSD STAFF',
        basePriceCents: Math.max(0, seat.price),
        finalPriceCents: Math.max(0, seat.price),
        isTeacherTicket: true,
        isStudentTicket: false
      };
    }

    if (ticketTierId === STUDENT_SHOW_TICKET_OPTION_ID && !tierById.has(ticketTierId)) {
      if (!performance.familyFreeTicketEnabled) {
        throw new HttpError(400, 'Student complimentary tickets are not enabled for this performance');
      }

      return {
        seat,
        ticketTierId,
        ticketType: 'Student in Show',
        basePriceCents: Math.max(0, seat.price),
        finalPriceCents: Math.max(0, seat.price),
        isTeacherTicket: false,
        isStudentTicket: true
      };
    }

    const tier = tierById.get(ticketTierId);
    if (!tier) {
      throw new HttpError(400, `Invalid ticket tier: ${ticketTierId}`);
    }

    const basePriceCents = Math.max(0, tier.priceCents);
    return {
      seat,
      ticketTierId,
      ticketType: tier.name,
      basePriceCents,
      finalPriceCents: basePriceCents,
      isTeacherTicket: isTeacherTicketName(tier.name),
      isStudentTicket: isStudentInShowTicketName(tier.name)
    };
  });

  const hasTeacherCompSelection = seatPriceSelections.some((selection) => selection.isTeacherTicket);
  const hasStudentCompSelection = seatPriceSelections.some((selection) => selection.isStudentTicket);

  if (hasTeacherCompSelection && hasStudentCompSelection) {
    throw new HttpError(400, 'Teacher and Student in Show complimentary tickets cannot be mixed in one order');
  }

  if (hasTeacherCompSelection) {
    if (!performance.staffCompsEnabled) {
      throw new HttpError(400, 'Teacher complimentary tickets are not enabled for this performance');
    }

    const teacherSelections = seatPriceSelections.filter((selection) => selection.isTeacherTicket);
    const complimentarySeatIds = pickComplimentarySeatIds(
      teacherSelections.map((selection) => ({
        id: selection.seat.id,
        sectionName: selection.seat.sectionName,
        row: selection.seat.row,
        number: selection.seat.number,
        basePriceCents: selection.basePriceCents
      })),
      Math.min(MAX_TEACHER_COMP_TICKETS, teacherSelections.length)
    );

    seatPriceSelections = seatPriceSelections.map((selection) => {
      if (!selection.isTeacherTicket) {
        return selection;
      }

      const isComplimentary = complimentarySeatIds.has(selection.seat.id);
      return {
        ...selection,
        finalPriceCents: isComplimentary ? 0 : selection.basePriceCents,
        ticketType: isComplimentary ? 'Teacher Comp' : selection.ticketType
      };
    });
  }

  if (hasStudentCompSelection) {
    if (!performance.familyFreeTicketEnabled) {
      throw new HttpError(400, 'Student complimentary tickets are not enabled for this performance');
    }

    const normalizedStudentCode = normalizeStudentVerificationCode(params.studentCode || '');
    if (!normalizedStudentCode) {
      throw new HttpError(400, 'Student code is required for student complimentary checkout');
    }

    const eligibility = await getStudentCreditEligibilityByStudentCode({
      performanceId: params.performanceId,
      studentCode: normalizedStudentCode,
      requestedSeatCount: seatPriceSelections.length
    });

    const studentSelections = seatPriceSelections.filter((selection) => selection.isStudentTicket);
    const complimentaryQuantity = Math.min(
      studentSelections.length,
      eligibility.maxUsableOnCheckout,
      MAX_STUDENT_COMP_TICKETS
    );

    if (complimentaryQuantity <= 0) {
      throw new HttpError(409, 'No complimentary student tickets available for this checkout');
    }

    const complimentarySeatIds = pickComplimentarySeatIds(
      studentSelections.map((selection) => ({
        id: selection.seat.id,
        sectionName: selection.seat.sectionName,
        row: selection.seat.row,
        number: selection.seat.number,
        basePriceCents: selection.basePriceCents
      })),
      complimentaryQuantity
    );

    seatPriceSelections = seatPriceSelections.map((selection) => {
      if (!selection.isStudentTicket) {
        return selection;
      }

      const isComplimentary = complimentarySeatIds.has(selection.seat.id);
      return {
        ...selection,
        finalPriceCents: isComplimentary ? 0 : selection.basePriceCents,
        ticketType: isComplimentary ? 'Student Comp' : selection.ticketType
      };
    });
  }

  const expectedAmountCents = seatPriceSelections.reduce((sum, selection) => sum + selection.finalPriceCents, 0);

  return {
    performanceId: performance.id,
    performanceTitle: performance.title || performance.show.title,
    isGeneralAdmission,
    seatIds: sortedSeats.map((seat) => seat.id),
    holdSeatIds: isGeneralAdmission ? [] : sortedSeats.map((seat) => seat.id),
    seatCount: sortedSeats.length,
    expectedAmountCents,
    currency: 'usd',
    ticketOptions: ticketOptions
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })),
    seats: seatPriceSelections.map((selection) => ({
      id: selection.seat.id,
      label: `${selection.seat.sectionName} ${selection.seat.row}-${selection.seat.number}`,
      sectionName: selection.seat.sectionName,
      row: selection.seat.row,
      number: selection.seat.number,
      ticketTierId: selection.ticketTierId,
      ticketType: selection.ticketType,
      priceCents: selection.finalPriceCents
    }))
  };
}

function buildTerminalDispatchSnapshot(params: {
  quote: Awaited<ReturnType<typeof buildInPersonSaleQuote>>;
  ticketSelectionBySeatId: Record<string, string>;
  customerName: string;
  receiptEmail: string | null;
  sendReceipt: boolean;
}): TerminalDispatchSnapshot {
  return {
    performanceId: params.quote.performanceId,
    performanceTitle: params.quote.performanceTitle,
    isGeneralAdmission: params.quote.isGeneralAdmission,
    seatIds: params.quote.seatIds,
    seatLabelsBySeatId: Object.fromEntries(params.quote.seats.map((seat) => [seat.id, seat.label])),
    seatSummaryBySeatId: Object.fromEntries(
      params.quote.seats.map((seat) => [
        seat.id,
        {
          label: seat.label,
          sectionName: seat.sectionName,
          row: seat.row,
          number: seat.number
        }
      ])
    ),
    ticketSelectionBySeatId: params.ticketSelectionBySeatId,
    ticketTypeBySeatId: Object.fromEntries(params.quote.seats.map((seat) => [seat.id, seat.ticketType])),
    priceBySeatId: Object.fromEntries(params.quote.seats.map((seat) => [seat.id, seat.priceCents])),
    customerName: params.customerName,
    receiptEmail: params.receiptEmail,
    sendReceipt: params.sendReceipt,
    expectedAmountCents: params.quote.expectedAmountCents,
    currency: 'usd'
  };
}

function serializeTerminalDispatchForAdmin(params: {
  dispatch: {
    id: string;
    status: string;
    failureReason: string | null;
    holdExpiresAt: Date;
    expectedAmountCents: number;
    currency: string;
    attemptCount: number;
    finalOrderId: string | null;
    targetDeviceId: string;
    targetDeviceSession?: { displayName: string } | null;
    saleSnapshot: Prisma.JsonValue;
  };
}) {
  const snapshot = parseTerminalDispatchSnapshot(params.dispatch.saleSnapshot);
  const nowMs = Date.now();
  const holdExpiresAtMs = params.dispatch.holdExpiresAt.getTime();
  const holdActive =
    holdExpiresAtMs > nowMs &&
    !['SUCCEEDED', 'EXPIRED', 'CANCELED'].includes(params.dispatch.status);

  return {
    dispatchId: params.dispatch.id,
    status: params.dispatch.status,
    failureReason: params.dispatch.failureReason,
    holdExpiresAt: params.dispatch.holdExpiresAt.toISOString(),
    holdActive,
    canRetry: params.dispatch.status === 'FAILED' && holdActive,
    expectedAmountCents: params.dispatch.expectedAmountCents,
    currency: params.dispatch.currency,
    attemptCount: params.dispatch.attemptCount,
    finalOrderId: params.dispatch.finalOrderId,
    targetDeviceId: params.dispatch.targetDeviceId,
    targetDeviceName: params.dispatch.targetDeviceSession?.displayName || null,
    seatCount: snapshot.seatIds.length,
    seats: snapshot.seatIds.map((seatId) => {
      const seatSummary = snapshot.seatSummaryBySeatId[seatId];
      return {
        id: seatId,
        sectionName: seatSummary?.sectionName || '',
        row: seatSummary?.row || '',
        number: seatSummary?.number ?? 0,
        ticketType: snapshot.ticketTypeBySeatId[seatId] || 'Ticket',
        priceCents: snapshot.priceBySeatId[seatId] ?? 0
      };
    })
  };
}

export const adminOrderRoutes: FastifyPluginAsync = async (app) => {
  const adminActor = (request: { user: { username?: string } }) => request.user.username || 'admin';

  app.get('/api/admin/orders', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const querySchema = z.object({
      q: z.string().optional(),
      status: z.string().optional(),
      source: z.string().optional(),
      performanceId: z.string().optional(),
      scope: z.enum(['active', 'archived', 'all']).default('active'),
      page: z.coerce.number().int().min(1).optional(),
      pageSize: z.coerce.number().int().min(1).max(200).optional()
    });
    const parsedQuery = querySchema.safeParse(request.query || {});
    if (!parsedQuery.success) {
      return reply.status(400).send({ error: parsedQuery.error.flatten() });
    }
    const query = parsedQuery.data;

    try {
      const where: any = {};
      if (query.status) where.status = query.status;
      if (query.source) where.source = query.source;
      if (query.performanceId) where.performanceId = query.performanceId;
      if (query.scope !== 'all') {
        where.performance = {
          isArchived: query.scope === 'archived'
        };
      }
      if (query.q) {
        where.OR = [
          { id: { contains: query.q, mode: 'insensitive' } },
          { email: { contains: query.q, mode: 'insensitive' } },
          { customerName: { contains: query.q, mode: 'insensitive' } }
        ];
      }

      const shouldPaginate = typeof query.page === 'number' || typeof query.pageSize === 'number';
      const page = query.page ?? 1;
      const pageSize = query.pageSize ?? 100;

      const [orders, total] = await Promise.all([
        prisma.order.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          ...(shouldPaginate
            ? {
                skip: (page - 1) * pageSize,
                take: pageSize
              }
            : {}),
          select: {
            id: true,
            status: true,
            source: true,
            inPersonPaymentMethod: true,
            email: true,
            customerName: true,
            amountTotal: true,
            createdAt: true,
            performanceId: true,
            performance: {
              select: {
                title: true,
                seatSelectionEnabled: true,
                show: {
                  select: {
                    title: true
                  }
                }
              }
            },
            orderSeats: {
              orderBy: { createdAt: 'asc' },
              select: {
                seat: {
                  select: {
                    sectionName: true,
                    row: true,
                    number: true
                  }
                }
              }
            },
            _count: {
              select: {
                tickets: true
              }
            }
          }
        }),
        shouldPaginate ? prisma.order.count({ where }) : Promise.resolve(0)
      ]);

      const rows = orders.map((order) => ({
          id: order.id,
          status: order.status,
          source: order.source,
          inPersonPaymentMethod: order.inPersonPaymentMethod,
          email: order.email,
          customerName: order.customerName,
          amountTotal: order.amountTotal,
          createdAt: order.createdAt,
          performanceId: order.performanceId,
          performanceTitle: order.performance.title || order.performance.show.title,
          seats: order.orderSeats.map((seat, index) =>
            order.performance.seatSelectionEnabled === false
              ? `General Admission ${index + 1}`
              : `${seat.seat?.sectionName || 'Unassigned'} ${seat.seat?.row || ''}-${seat.seat?.number || index + 1}`
          ),
          ticketCount: order._count.tickets
        }));

      if (shouldPaginate) {
        return reply.send({
          page,
          pageSize,
          total,
          rows
        });
      }

      reply.send(rows);
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
          orderSeats: { include: { seat: true }, orderBy: { createdAt: 'asc' } },
          tickets: { include: { seat: true }, orderBy: { createdAt: 'asc' } }
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

  app.get('/api/admin/orders/:id/transaction', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const params = request.params as { id: string };

    try {
      const order = await prisma.order.findUnique({
        where: { id: params.id },
        select: {
          id: true,
          email: true,
          stripeSessionId: true,
          stripePaymentIntentId: true,
          stripeRefundId: true,
          stripeRefundStatus: true
        }
      });

      if (!order) {
        throw new HttpError(404, 'Order not found');
      }

      let paymentIntentId = order.stripePaymentIntentId;
      if (!paymentIntentId && order.stripeSessionId) {
        const session = await stripe.checkout.sessions.retrieve(order.stripeSessionId);
        if (typeof session.payment_intent === 'string') {
          paymentIntentId = session.payment_intent;
          await prisma.order
            .update({
              where: { id: order.id },
              data: { stripePaymentIntentId: paymentIntentId }
            })
            .catch(() => undefined);
        }
      }

      if (!paymentIntentId) {
        return reply.send({
          available: false,
          reason: 'No Stripe payment is linked to this order.'
        });
      }

      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
        expand: ['latest_charge.balance_transaction', 'payment_method', 'customer']
      });

      const charge =
        paymentIntent.latest_charge && typeof paymentIntent.latest_charge !== 'string'
          ? paymentIntent.latest_charge
          : null;
      const balanceTransaction =
        charge?.balance_transaction && typeof charge.balance_transaction !== 'string'
          ? charge.balance_transaction
          : null;

      let paymentMethod =
        paymentIntent.payment_method && typeof paymentIntent.payment_method !== 'string'
          ? paymentIntent.payment_method
          : null;
      if (!paymentMethod && typeof paymentIntent.payment_method === 'string') {
        try {
          paymentMethod = await stripe.paymentMethods.retrieve(paymentIntent.payment_method);
        } catch (err) {
          if (err instanceof Stripe.errors.StripeError) {
            app.log.warn(
              { err, paymentMethodId: paymentIntent.payment_method, orderId: order.id },
              'Failed to retrieve Stripe payment method'
            );
          } else {
            throw err;
          }
        }
      }

      const chargeCardDetails =
        charge?.payment_method_details?.type === 'card' ? charge.payment_method_details.card : null;
      const cardDetails = paymentMethod?.card ?? null;
      const cardChecks = cardDetails?.checks || chargeCardDetails?.checks || null;
      const cardWalletType = cardDetails?.wallet?.type || chargeCardDetails?.wallet?.type || null;

      const expandedCustomer =
        paymentIntent.customer && typeof paymentIntent.customer !== 'string'
          ? paymentIntent.customer
          : null;
      const customer =
        expandedCustomer && !isDeletedStripeCustomer(expandedCustomer)
          ? expandedCustomer
          : null;

      const refundsById = new Map<string, Stripe.Refund>();
      (charge?.refunds?.data || []).forEach((refund) => refundsById.set(refund.id, refund));
      if (order.stripeRefundId && !refundsById.has(order.stripeRefundId)) {
        try {
          const refund = await stripe.refunds.retrieve(order.stripeRefundId);
          refundsById.set(refund.id, refund);
        } catch (err) {
          if (err instanceof Stripe.errors.StripeError) {
            app.log.warn({ err, refundId: order.stripeRefundId, orderId: order.id }, 'Failed to retrieve Stripe refund');
          } else {
            throw err;
          }
        }
      }
      const refunds = [...refundsById.values()].sort((a, b) => b.created - a.created);

      const billingAddress = charge?.billing_details?.address || paymentMethod?.billing_details?.address || null;
      const billingEmail =
        charge?.billing_details?.email || paymentMethod?.billing_details?.email || paymentIntent.receipt_email || order.email || null;
      const billingName = charge?.billing_details?.name || paymentMethod?.billing_details?.name || null;

      const activity = buildStripeActivity({ paymentIntent, charge, refunds });
      const dashboardBase = paymentIntent.livemode ? 'https://dashboard.stripe.com' : 'https://dashboard.stripe.com/test';

      reply.send({
        available: true,
        orderId: order.id,
        dashboardUrl: `${dashboardBase}/payments/${paymentIntent.id}`,
        paymentIntent: {
          id: paymentIntent.id,
          status: paymentIntent.status,
          amount: paymentIntent.amount,
          amountReceived: paymentIntent.amount_received,
          currency: paymentIntent.currency,
          createdAt: isoFromUnix(paymentIntent.created),
          canceledAt: isoFromUnix(paymentIntent.canceled_at),
          cancellationReason: paymentIntent.cancellation_reason,
          description: paymentIntent.description,
          captureMethod: paymentIntent.capture_method,
          statementDescriptor: paymentIntent.statement_descriptor,
          statementDescriptorSuffix: paymentIntent.statement_descriptor_suffix,
          paymentMethodTypes: paymentIntent.payment_method_types,
          livemode: paymentIntent.livemode
        },
        paymentMethod: {
          id: paymentMethod?.id || (typeof paymentIntent.payment_method === 'string' ? paymentIntent.payment_method : null),
          type: paymentMethod?.type || charge?.payment_method_details?.type || null,
          brand: cardDetails?.brand || chargeCardDetails?.brand || null,
          displayBrand: cardDetails?.display_brand || null,
          funding: cardDetails?.funding || chargeCardDetails?.funding || null,
          last4: cardDetails?.last4 || chargeCardDetails?.last4 || null,
          fingerprint: cardDetails?.fingerprint || chargeCardDetails?.fingerprint || null,
          expMonth: cardDetails?.exp_month || chargeCardDetails?.exp_month || null,
          expYear: cardDetails?.exp_year || chargeCardDetails?.exp_year || null,
          issuer: cardDetails?.issuer || chargeCardDetails?.issuer || null,
          country: cardDetails?.country || chargeCardDetails?.country || null,
          network: chargeCardDetails?.network || cardDetails?.networks?.preferred || null,
          walletType: cardWalletType,
          checks: {
            cvcCheck: cardChecks?.cvc_check || null,
            addressLine1Check: cardChecks?.address_line1_check || null,
            addressPostalCodeCheck: cardChecks?.address_postal_code_check || null
          }
        },
        charge: charge
          ? {
              id: charge.id,
              status: charge.status,
              paid: charge.paid,
              captured: charge.captured,
              amount: charge.amount,
              amountCaptured: charge.amount_captured,
              amountRefunded: charge.amount_refunded,
              createdAt: isoFromUnix(charge.created),
              receiptEmail: charge.receipt_email,
              receiptUrl: charge.receipt_url,
              failureCode: charge.failure_code,
              failureMessage: charge.failure_message,
              statementDescriptor: charge.statement_descriptor,
              statementDescriptorSuffix: charge.statement_descriptor_suffix,
              outcome: charge.outcome
                ? {
                    riskLevel: charge.outcome.risk_level || null,
                    riskScore: charge.outcome.risk_score ?? null,
                    networkStatus: charge.outcome.network_status,
                    sellerMessage: charge.outcome.seller_message,
                    type: charge.outcome.type
                  }
                : null,
              billingDetails: {
                name: billingName,
                email: billingEmail,
                phone: charge.billing_details?.phone || paymentMethod?.billing_details?.phone || null,
                postalCode: billingAddress?.postal_code || null,
                country: billingAddress?.country || null
              }
            }
          : null,
        balance: balanceTransaction
          ? {
              id: balanceTransaction.id,
              amount: balanceTransaction.amount,
              fee: balanceTransaction.fee,
              net: balanceTransaction.net,
              type: balanceTransaction.type,
              reportingCategory: balanceTransaction.reporting_category,
              availableOn: isoFromUnix(balanceTransaction.available_on),
              exchangeRate: balanceTransaction.exchange_rate,
              feeDetails: balanceTransaction.fee_details.map((row) => ({
                amount: row.amount,
                currency: row.currency,
                description: row.description,
                type: row.type
              }))
            }
          : null,
        customer: {
          id: customer?.id || (typeof paymentIntent.customer === 'string' ? paymentIntent.customer : null),
          name: customer?.name || billingName,
          email: customer?.email || billingEmail,
          phone: customer?.phone || charge?.billing_details?.phone || paymentMethod?.billing_details?.phone || null,
          country: customer?.address?.country || billingAddress?.country || null
        },
        refunds: refunds.map((refund) => ({
          id: refund.id,
          status: refund.status,
          amount: refund.amount,
          reason: refund.reason,
          createdAt: isoFromUnix(refund.created)
        })),
        activity,
        metadata: paymentIntent.metadata,
        orderRefundStatus: order.stripeRefundStatus
      });
    } catch (err) {
      if (err instanceof Stripe.errors.StripeError) {
        return reply.status(502).send({ error: err.message || 'Stripe request failed' });
      }
      handleRouteError(reply, err, 'Failed to fetch Stripe transaction details');
    }
  });

  app.post('/api/admin/orders/assign', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsed = assignOrderSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      if (parsed.data.source === 'DOOR') {
        throw new HttpError(
          400,
          'Door sales must use the in-person finalize flow. Use /api/admin/orders/in-person/finalize.'
        );
      }

      const created = await createAssignedOrder({
        performanceId: parsed.data.performanceId,
        seatIds: parsed.data.seatIds,
        customerName: parsed.data.customerName,
        customerEmail: parsed.data.customerEmail,
        attendeeNames: parsed.data.attendeeNames,
        ticketTypeBySeatId: parsed.data.ticketTypeBySeatId,
        priceBySeatId: parsed.data.priceBySeatId,
        source: parsed.data.source,
        allowHeldSeats: false,
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

  app.post('/api/admin/orders/in-person/quote', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsed = inPersonQuoteSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const quote = await buildInPersonSaleQuote({
        performanceId: parsed.data.performanceId,
        seatIds: parsed.data.seatIds,
        ticketSelectionBySeatId: parsed.data.ticketSelectionBySeatId,
        studentCode: parsed.data.studentCode
      });
      const attemptId = `ips_${crypto.randomBytes(10).toString('hex')}`;

      await logAudit({
        actor: adminActor(request),
        action: 'IN_PERSON_SALE_QUOTED',
        entityType: 'InPersonSale',
        entityId: attemptId,
        metadata: {
          performanceId: quote.performanceId,
          performanceTitle: quote.performanceTitle,
          seatIds: quote.seatIds,
          seatCount: quote.seatCount,
          expectedAmountCents: quote.expectedAmountCents,
          currency: quote.currency,
          ticketSelectionBySeatId: parsed.data.ticketSelectionBySeatId
        }
      });

      reply.send({
        attemptId,
        performanceId: quote.performanceId,
        performanceTitle: quote.performanceTitle,
        source: parsed.data.source,
        seatCount: quote.seatCount,
        expectedAmountCents: quote.expectedAmountCents,
        currency: quote.currency,
        ticketOptions: quote.ticketOptions,
        seats: quote.seats
      });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to prepare in-person sale quote');
    }
  });

  app.post('/api/admin/orders/in-person/manual-intent', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsed = inPersonManualIntentSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      if (!env.STRIPE_PUBLISHABLE_KEY) {
        throw new HttpError(500, 'Stripe publishable key is not configured');
      }

      const quote = await buildInPersonSaleQuote({
        performanceId: parsed.data.performanceId,
        seatIds: parsed.data.seatIds,
        ticketSelectionBySeatId: parsed.data.ticketSelectionBySeatId,
        studentCode: parsed.data.studentCode
      });

      if (quote.expectedAmountCents <= 0) {
        throw new HttpError(400, 'Manual card checkout requires a charge amount greater than $0.00');
      }

      const paymentIntent = await stripe.paymentIntents.create({
        amount: quote.expectedAmountCents,
        currency: quote.currency,
        payment_method_types: ['card'],
        capture_method: 'automatic',
        description: `${quote.performanceTitle} - ${quote.seatCount} ${quote.isGeneralAdmission ? 'ticket' : 'seat'}${quote.seatCount === 1 ? '' : 's'}`,
        receipt_email: parsed.data.receiptEmail?.trim().toLowerCase() || undefined,
        metadata: {
          source: 'admin_in_person_manual',
          performanceId: quote.performanceId,
          expectedAmountCents: String(quote.expectedAmountCents),
          seatCount: String(quote.seatCount)
        }
      });

      if (!paymentIntent.client_secret) {
        throw new HttpError(500, 'Stripe payment intent missing client secret');
      }

      await logAudit({
        actor: adminActor(request),
        action: 'IN_PERSON_MANUAL_CHECKOUT_STARTED',
        entityType: 'InPersonSale',
        entityId: paymentIntent.id,
        metadata: {
          performanceId: quote.performanceId,
          seatIds: quote.seatIds,
          seatCount: quote.seatCount,
          expectedAmountCents: quote.expectedAmountCents,
          paymentIntentId: paymentIntent.id
        }
      });

      reply.send({
        paymentIntentId: paymentIntent.id,
        clientSecret: paymentIntent.client_secret,
        publishableKey: env.STRIPE_PUBLISHABLE_KEY,
        expectedAmountCents: quote.expectedAmountCents,
        currency: quote.currency
      });
    } catch (err) {
      if (err instanceof Stripe.errors.StripeError) {
        return reply.status(502).send({ error: err.message || 'Payment provider error' });
      }
      handleRouteError(reply, err, 'Failed to create manual in-person payment intent');
    }
  });

  app.post('/api/admin/orders/in-person/manual-complete', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsed = inPersonManualCompleteSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const quote = await buildInPersonSaleQuote({
        performanceId: parsed.data.performanceId,
        seatIds: parsed.data.seatIds,
        ticketSelectionBySeatId: parsed.data.ticketSelectionBySeatId,
        studentCode: parsed.data.studentCode
      });
      if (quote.expectedAmountCents <= 0) {
        throw new HttpError(400, 'Manual card checkout requires a charge amount greater than $0.00');
      }

      const paymentIntent = await stripe.paymentIntents.retrieve(parsed.data.paymentIntentId);
      if (paymentIntent.status !== 'succeeded') {
        throw new HttpError(409, `Payment intent is ${paymentIntent.status}. It must be succeeded before checkout can complete.`);
      }

      const paymentSource = String(paymentIntent.metadata?.source || '');
      if (paymentSource && paymentSource !== 'admin_in_person_manual') {
        throw new HttpError(400, 'Payment intent source is invalid for manual in-person checkout');
      }

      const paymentIntentPerformanceId = String(paymentIntent.metadata?.performanceId || '');
      if (paymentIntentPerformanceId && paymentIntentPerformanceId !== quote.performanceId) {
        throw new HttpError(400, 'Payment intent performance does not match this checkout');
      }

      if (paymentIntent.currency.toLowerCase() !== quote.currency.toLowerCase()) {
        throw new HttpError(409, 'Payment currency does not match checkout currency');
      }
      if (paymentIntent.amount_received < quote.expectedAmountCents) {
        throw new HttpError(409, 'Payment amount is less than the expected checkout total');
      }

      const existingOrder = await prisma.order.findUnique({
        where: { stripePaymentIntentId: paymentIntent.id },
        select: {
          id: true,
          status: true,
          source: true
        }
      });
      if (existingOrder) {
        return reply.send({
          success: true,
          alreadyCompleted: true,
          id: existingOrder.id,
          status: existingOrder.status,
          source: existingOrder.source,
          expectedAmountCents: quote.expectedAmountCents,
          paymentMethod: 'STRIPE' as const,
          seats: quote.seats
        });
      }

      const attemptId = `ipsm_${crypto.randomBytes(10).toString('hex')}`;
      const normalizedSeatIds = quote.seatIds;
      const priceBySeatId = Object.fromEntries(quote.seats.map((seat) => [seat.id, seat.priceCents]));
      const ticketTypeBySeatId = Object.fromEntries(
        quote.seats.map((seat) => [seat.id, seat.ticketType])
      ) as Record<string, string>;

      const normalizedCustomerName = parsed.data.customerName?.trim() || 'Walk-in Guest';
      const normalizedReceiptEmail = parsed.data.receiptEmail?.trim().toLowerCase() || null;
      const customerEmail = normalizedReceiptEmail || `walkin+${attemptId}@boxoffice.local`;
      const sendEmail = Boolean(parsed.data.sendReceipt && normalizedReceiptEmail);

      let created: Awaited<ReturnType<typeof createAssignedOrder>>;
      try {
        created = await createAssignedOrder({
          performanceId: parsed.data.performanceId,
          seatIds: normalizedSeatIds,
          customerName: normalizedCustomerName,
          customerEmail,
          ticketTypeBySeatId,
          priceBySeatId,
          source: 'DOOR',
          allowHeldSeats: false,
          enforceSalesCutoff: false,
          sendEmail,
          inPersonPaymentMethod: 'STRIPE'
        });
      } catch (err) {
        if (err instanceof HttpError && err.statusCode >= 400 && err.statusCode < 500) {
          try {
            const refund = await stripe.refunds.create(
              {
                payment_intent: paymentIntent.id,
                reason: 'requested_by_customer',
                metadata: {
                  source: 'admin_in_person_manual_auto_refund',
                  reason: 'checkout_finalize_failed',
                  performanceId: parsed.data.performanceId
                }
              },
              {
                idempotencyKey: `admin-manual-complete-refund:${paymentIntent.id}`
              }
            );

            await logAudit({
              actor: adminActor(request),
              action: 'IN_PERSON_MANUAL_CHECKOUT_AUTO_REFUND_REQUESTED',
              entityType: 'InPersonSale',
              entityId: paymentIntent.id,
              metadata: {
                refundId: refund.id,
                refundStatus: refund.status,
                failureReason: err.message
              }
            });
          } catch (refundErr) {
            await logAudit({
              actor: adminActor(request),
              action: 'IN_PERSON_MANUAL_CHECKOUT_AUTO_REFUND_FAILED',
              entityType: 'InPersonSale',
              entityId: paymentIntent.id,
              metadata: {
                failureReason: err.message,
                refundError: refundErr instanceof Error ? refundErr.message : 'Unknown refund error'
              }
            });
          }

          throw new HttpError(
            409,
            'Payment succeeded but checkout could not be finalized. A Stripe refund was requested automatically.'
          );
        }

        throw err;
      }

      await prisma.order.update({
        where: { id: created.id },
        data: {
          stripePaymentIntentId: paymentIntent.id
        }
      });

      await logAudit({
        actor: adminActor(request),
        action: 'IN_PERSON_SALE_FINALIZED',
        entityType: 'InPersonSale',
        entityId: attemptId,
        metadata: {
          orderId: created.id,
          performanceId: quote.performanceId,
          performanceTitle: quote.performanceTitle,
          seatIds: normalizedSeatIds,
          seatCount: quote.seatCount,
          expectedAmountCents: quote.expectedAmountCents,
          paymentMethod: 'STRIPE',
          source: 'DOOR',
          sendReceipt: sendEmail,
          receiptEmail: normalizedReceiptEmail,
          customerName: normalizedCustomerName,
          paymentIntentId: paymentIntent.id
        }
      });

      await logAudit({
        actor: adminActor(request),
        action: 'ORDER_ASSIGNED',
        entityType: 'Order',
        entityId: created.id,
        metadata: {
          source: 'DOOR',
          performanceId: quote.performanceId,
          seatIds: normalizedSeatIds,
          inPersonAttemptId: attemptId,
          expectedAmountCents: quote.expectedAmountCents,
          paymentMethod: 'STRIPE',
          paymentIntentId: paymentIntent.id,
          ticketSelectionBySeatId: parsed.data.ticketSelectionBySeatId
        }
      });

      reply.status(201).send({
        success: true,
        id: created.id,
        status: created.status,
        source: created.source,
        expectedAmountCents: quote.expectedAmountCents,
        paymentMethod: 'STRIPE',
        seats: quote.seats
      });
    } catch (err) {
      if (err instanceof Stripe.errors.StripeError) {
        return reply.status(502).send({ error: err.message || 'Payment provider error' });
      }
      handleRouteError(reply, err, 'Failed to complete manual in-person checkout');
    }
  });

  app.get('/api/admin/orders/in-person/cash-tonight', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsed = inPersonCashTonightQuerySchema.safeParse(request.query || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const now = new Date();
      const nightStart = new Date(now);
      nightStart.setHours(0, 0, 0, 0);
      const nightEnd = new Date(now);
      nightEnd.setHours(23, 59, 59, 999);

      let totalCashCents = 0;
      let saleCount = 0;
      let trackingSource: 'order_column' | 'audit_log_fallback' = 'order_column';

      try {
        const totals = await prisma.order.aggregate({
          where: {
            status: 'PAID',
            source: 'DOOR',
            inPersonPaymentMethod: 'CASH',
            ...(parsed.data.performanceId ? { performanceId: parsed.data.performanceId } : {}),
            createdAt: {
              gte: nightStart,
              lte: nightEnd
            }
          },
          _sum: { amountTotal: true },
          _count: { _all: true }
        });
        totalCashCents = totals._sum.amountTotal || 0;
        saleCount = totals._count._all || 0;
      } catch (err) {
        if (!isMissingInPersonPaymentMethodColumnError(err)) {
          throw err;
        }

        const fallback = await summarizeCashFromAuditLogFallback({
          performanceId: parsed.data.performanceId,
          nightStart,
          nightEnd
        });

        totalCashCents = fallback.totalCashCents;
        saleCount = fallback.saleCount;
        trackingSource = 'audit_log_fallback';
      }

      reply.send({
        totalCashCents,
        saleCount,
        nightStartIso: nightStart.toISOString(),
        nightEndIso: nightEnd.toISOString(),
        performanceId: parsed.data.performanceId || null,
        trackingSource
      });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to calculate tonight cash totals');
    }
  });

  app.get('/api/admin/orders/in-person/terminal/devices', { preHandler: app.authenticateAdmin }, async (_request, reply) => {
    try {
      await expireExpiredTerminalDispatches();

      const sessions = await listActiveTerminalDeviceSessions();
      const deviceIds = sessions.map((session) => session.deviceId);

      const busyRows = deviceIds.length
        ? await prisma.terminalPaymentDispatch.findMany({
            where: {
              targetDeviceId: { in: deviceIds },
              status: 'PROCESSING'
            },
            select: { targetDeviceId: true }
          })
        : [];
      const busyDeviceIds = new Set(busyRows.map((row) => row.targetDeviceId));

      reply.send({
        devices: sessions.map((session) => ({
          deviceId: session.deviceId,
          name: session.displayName,
          lastHeartbeatAt: session.lastHeartbeatAt.toISOString(),
          isBusy: busyDeviceIds.has(session.deviceId)
        }))
      });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to load terminal devices');
    }
  });

  app.post('/api/admin/orders/in-person/terminal/send', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsed = inPersonTerminalSendSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const quote = await buildInPersonSaleQuote({
        performanceId: parsed.data.performanceId,
        seatIds: parsed.data.seatIds,
        ticketSelectionBySeatId: parsed.data.ticketSelectionBySeatId,
        studentCode: parsed.data.studentCode
      });

      const normalizedCustomerName = parsed.data.customerName?.trim() || 'Walk-in Guest';
      const normalizedReceiptEmail = parsed.data.receiptEmail?.trim().toLowerCase() || null;
      const sendReceipt = Boolean(parsed.data.sendReceipt && normalizedReceiptEmail);
      const normalizedDeviceId = parsed.data.deviceId.trim();

      await expireExpiredTerminalDispatches();
      await expireDeviceDispatches(normalizedDeviceId);

      const deviceSession = await getActiveTerminalDeviceSession(normalizedDeviceId);

      const hold = await createTerminalDispatchHold({
        performanceId: quote.performanceId,
        seatIds: quote.holdSeatIds
      });

      const snapshot = buildTerminalDispatchSnapshot({
        quote,
        ticketSelectionBySeatId: parsed.data.ticketSelectionBySeatId,
        customerName: normalizedCustomerName,
        receiptEmail: normalizedReceiptEmail,
        sendReceipt
      });
      const snapshotForStorage = parsed.data.submissionId
        ? {
            ...snapshot,
            submissionId: parsed.data.submissionId
          }
        : snapshot;

      const createdDispatch = await prisma.terminalPaymentDispatch.create({
        data: {
          status: 'PENDING',
          queueKey: normalizedDeviceId,
          queueSortAt: new Date(),
          performanceId: quote.performanceId,
          targetDeviceSessionId: deviceSession.id,
          targetDeviceId: deviceSession.deviceId,
          holdToken: hold.holdToken,
          holdExpiresAt: hold.holdExpiresAt,
          expectedAmountCents: quote.expectedAmountCents,
          currency: quote.currency,
          saleSnapshot: snapshotForStorage as Prisma.InputJsonValue,
          sellerStationName: parsed.data.sellerStationName?.trim() || null,
          sellerAdminId: parsed.data.sellerAdminId?.trim() || request.adminUser?.id || null,
          sellerClientSessionId: parsed.data.sellerClientSessionId?.trim() || null,
          createdByAdminId: request.adminUser?.id || null
        }
      });

      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: quote.expectedAmountCents,
          currency: quote.currency,
          payment_method_types: ['card_present'],
          capture_method: 'automatic',
          description: `${quote.performanceTitle} - ${quote.seatCount} ${quote.isGeneralAdmission ? 'ticket' : 'seat'}${quote.seatCount === 1 ? '' : 's'}`,
          metadata: {
            source: 'admin_terminal_dispatch',
            dispatchId: createdDispatch.id,
            performanceId: quote.performanceId,
            holdToken: hold.holdToken,
            seatIds: JSON.stringify(quote.seatIds),
            expectedAmountCents: String(quote.expectedAmountCents),
            targetDeviceId: normalizedDeviceId
          }
        });

        if (!paymentIntent.client_secret) {
          throw new HttpError(500, 'Stripe payment intent missing client secret');
        }

        const dispatch = await prisma.terminalPaymentDispatch.update({
          where: { id: createdDispatch.id },
          data: {
            stripePaymentIntentId: paymentIntent.id,
            stripePaymentIntentClientSecret: paymentIntent.client_secret,
            failureReason: null
          },
          include: {
            targetDeviceSession: {
              select: {
                displayName: true
              }
            }
          }
        });

        await logAudit({
          actor: adminActor(request),
          action: 'IN_PERSON_TERMINAL_DISPATCH_SENT',
          entityType: 'TerminalDispatch',
          entityId: dispatch.id,
          metadata: {
            performanceId: quote.performanceId,
            expectedAmountCents: quote.expectedAmountCents,
            seatIds: quote.seatIds,
            targetDeviceId: dispatch.targetDeviceId,
            targetDeviceName: dispatch.targetDeviceSession?.displayName || null
          }
        });

        return reply.status(201).send({
          ...serializeTerminalDispatchForAdmin({ dispatch }),
          targetDeviceName: dispatch.targetDeviceSession?.displayName || null
        });
      } catch (err) {
        await prisma.terminalPaymentDispatch.updateMany({
          where: {
            id: createdDispatch.id,
            status: 'PENDING'
          },
          data: {
            status: 'FAILED',
            failureReason:
              err instanceof Error ? err.message.slice(0, 500) : 'Failed to create Stripe payment intent',
            processingHeartbeatAt: null,
            activeTimeoutAt: null
          }
        });

        await releaseHoldByToken(hold.holdToken).catch(() => undefined);

        if (err instanceof Stripe.errors.StripeError) {
          return reply.status(502).send({ error: err.message || 'Payment provider error' });
        }

        throw err;
      }
    } catch (err) {
      handleRouteError(reply, err, 'Failed to send sale to terminal');
    }
  });

  app.get(
    '/api/admin/orders/in-person/terminal/dispatch/:dispatchId',
    { preHandler: app.authenticateAdmin },
    async (request, reply) => {
      const parsedParams = terminalDispatchParamsSchema.safeParse(request.params || {});
      if (!parsedParams.success) {
        return reply.status(400).send({ error: parsedParams.error.flatten() });
      }

      try {
        await expireTerminalDispatchIfNeeded(parsedParams.data.dispatchId);

        const dispatch = await prisma.terminalPaymentDispatch.findUnique({
          where: { id: parsedParams.data.dispatchId },
          include: {
            targetDeviceSession: {
              select: {
                displayName: true
              }
            }
          }
        });

        if (!dispatch) {
          throw new HttpError(404, 'Terminal dispatch not found');
        }

        reply.send(serializeTerminalDispatchForAdmin({ dispatch }));
      } catch (err) {
        handleRouteError(reply, err, 'Failed to load terminal dispatch status');
      }
    }
  );

  app.post(
    '/api/admin/orders/in-person/terminal/dispatch/:dispatchId/retry',
    { preHandler: app.authenticateAdmin },
    async (request, reply) => {
      const parsedParams = terminalDispatchParamsSchema.safeParse(request.params || {});
      if (!parsedParams.success) {
        return reply.status(400).send({ error: parsedParams.error.flatten() });
      }

      try {
        await expireTerminalDispatchIfNeeded(parsedParams.data.dispatchId);
        const current = await prisma.terminalPaymentDispatch.findUnique({
          where: { id: parsedParams.data.dispatchId },
          include: {
            targetDeviceSession: {
              select: {
                displayName: true
              }
            }
          }
        });

        if (!current) {
          throw new HttpError(404, 'Terminal dispatch not found');
        }

        if (current.status !== 'FAILED') {
          throw new HttpError(409, 'Only failed terminal dispatches can be retried');
        }

        if (current.holdExpiresAt.getTime() <= Date.now()) {
          await expireTerminalDispatchIfNeeded(current.id);
          throw new HttpError(409, 'This terminal dispatch has expired');
        }

        await expireDeviceDispatches(current.targetDeviceId);
        const isBusy = await isTerminalDeviceBusy({
          deviceId: current.targetDeviceId,
          excludeDispatchId: current.id
        });
        if (isBusy) {
          throw new HttpError(409, 'Selected terminal is currently busy with another sale');
        }

        const snapshot = parseTerminalDispatchSnapshot(current.saleSnapshot);
        const paymentIntent = await stripe.paymentIntents.create({
          amount: current.expectedAmountCents,
          currency: current.currency,
          payment_method_types: ['card_present'],
          capture_method: 'automatic',
          description: `${snapshot.performanceTitle} - ${snapshot.seatIds.length} ${snapshot.isGeneralAdmission ? 'ticket' : 'seat'}${snapshot.seatIds.length === 1 ? '' : 's'}`,
          metadata: {
            source: 'admin_terminal_dispatch_retry',
            dispatchId: current.id,
            performanceId: current.performanceId,
            holdToken: current.holdToken,
            seatIds: JSON.stringify(snapshot.seatIds),
            expectedAmountCents: String(current.expectedAmountCents),
            targetDeviceId: current.targetDeviceId
          }
        });

        if (!paymentIntent.client_secret) {
          throw new HttpError(500, 'Stripe payment intent missing client secret');
        }

        const dispatch = await prisma.terminalPaymentDispatch.update({
          where: { id: current.id },
          data: {
            status: 'PENDING',
            queueSortAt: new Date(),
            stripePaymentIntentId: paymentIntent.id,
            stripePaymentIntentClientSecret: paymentIntent.client_secret,
            failureReason: null,
            deliveredAt: null,
            processingStartedAt: null,
            processingHeartbeatAt: null,
            activeTimeoutAt: null,
            completedAt: null,
            canceledAt: null,
            attemptCount: {
              increment: 1
            }
          },
          include: {
            targetDeviceSession: {
              select: {
                displayName: true
              }
            }
          }
        });

        await logAudit({
          actor: adminActor(request),
          action: 'IN_PERSON_TERMINAL_DISPATCH_RETRIED',
          entityType: 'TerminalDispatch',
          entityId: dispatch.id,
          metadata: {
            attemptCount: dispatch.attemptCount,
            targetDeviceId: dispatch.targetDeviceId
          }
        });

        reply.send(serializeTerminalDispatchForAdmin({ dispatch }));
      } catch (err) {
        if (err instanceof Stripe.errors.StripeError) {
          return reply.status(502).send({ error: err.message || 'Payment provider error' });
        }

        handleRouteError(reply, err, 'Failed to retry terminal dispatch');
      }
    }
  );

  app.post(
    '/api/admin/orders/in-person/terminal/dispatch/:dispatchId/cancel',
    { preHandler: app.authenticateAdmin },
    async (request, reply) => {
      const parsedParams = terminalDispatchParamsSchema.safeParse(request.params || {});
      if (!parsedParams.success) {
        return reply.status(400).send({ error: parsedParams.error.flatten() });
      }

      try {
        await expireTerminalDispatchIfNeeded(parsedParams.data.dispatchId);
        const current = await prisma.terminalPaymentDispatch.findUnique({
          where: { id: parsedParams.data.dispatchId },
          include: {
            targetDeviceSession: {
              select: {
                displayName: true
              }
            }
          }
        });

        if (!current) {
          throw new HttpError(404, 'Terminal dispatch not found');
        }

        if (current.status !== 'SUCCEEDED' && current.status !== 'EXPIRED' && current.status !== 'CANCELED') {
          await releaseHoldByToken(current.holdToken).catch(() => undefined);
        }

        const dispatch =
          current.status === 'SUCCEEDED' || current.status === 'EXPIRED' || current.status === 'CANCELED'
            ? current
            : await prisma.terminalPaymentDispatch.update({
                where: { id: current.id },
                data: {
                  status: 'CANCELED',
                  canceledAt: new Date(),
                  failureReason: current.failureReason || 'Canceled by cashier',
                  processingHeartbeatAt: null,
                  activeTimeoutAt: null
                },
                include: {
                  targetDeviceSession: {
                    select: {
                      displayName: true
                    }
                  }
                }
              });

        await logAudit({
          actor: adminActor(request),
          action: 'IN_PERSON_TERMINAL_DISPATCH_CANCELED',
          entityType: 'TerminalDispatch',
          entityId: dispatch.id,
          metadata: {
            finalStatus: dispatch.status,
            targetDeviceId: dispatch.targetDeviceId
          }
        });

        reply.send(serializeTerminalDispatchForAdmin({ dispatch }));
      } catch (err) {
        handleRouteError(reply, err, 'Failed to cancel terminal dispatch');
      }
    }
  );

  app.post('/api/admin/orders/in-person/finalize', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsed = inPersonFinalizeSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      if (parsed.data.paymentMethod !== 'CASH') {
        throw new HttpError(400, 'Stripe in-person checkout now uses terminal dispatch. Use /api/admin/orders/in-person/terminal/send.');
      }

      const quote = await buildInPersonSaleQuote({
        performanceId: parsed.data.performanceId,
        seatIds: parsed.data.seatIds,
        ticketSelectionBySeatId: parsed.data.ticketSelectionBySeatId,
        studentCode: parsed.data.studentCode
      });
      const attemptId = `ips_${crypto.randomBytes(10).toString('hex')}`;

      const expectedAmountCents = quote.expectedAmountCents;

      const normalizedSeatIds = quote.seatIds;
      const priceBySeatId = Object.fromEntries(quote.seats.map((seat) => [seat.id, seat.priceCents]));
      const ticketTypeBySeatId = Object.fromEntries(
        quote.seats.map((seat) => [seat.id, seat.ticketType])
      ) as Record<string, string>;

      const normalizedCustomerName = parsed.data.customerName?.trim() || 'Walk-in Guest';
      const normalizedReceiptEmail = parsed.data.receiptEmail?.trim().toLowerCase() || null;
      const customerEmail = normalizedReceiptEmail || `walkin+${attemptId}@boxoffice.local`;
      const sendEmail = Boolean(parsed.data.sendReceipt && normalizedReceiptEmail);

      const created = await createAssignedOrder({
        performanceId: parsed.data.performanceId,
        seatIds: normalizedSeatIds,
        customerName: normalizedCustomerName,
        customerEmail,
        ticketTypeBySeatId,
        priceBySeatId,
        source: 'DOOR',
        allowHeldSeats: false,
        enforceSalesCutoff: false,
        sendEmail,
        inPersonPaymentMethod: parsed.data.paymentMethod
      });

      await logAudit({
        actor: adminActor(request),
        action: 'IN_PERSON_SALE_FINALIZED',
        entityType: 'InPersonSale',
        entityId: attemptId,
        metadata: {
          orderId: created.id,
          performanceId: quote.performanceId,
          performanceTitle: quote.performanceTitle,
          seatIds: normalizedSeatIds,
          seatCount: quote.seatCount,
          expectedAmountCents,
          paymentMethod: parsed.data.paymentMethod,
          source: 'DOOR',
          sendReceipt: sendEmail,
          receiptEmail: normalizedReceiptEmail,
          customerName: normalizedCustomerName
        }
      });

      await logAudit({
        actor: adminActor(request),
        action: 'ORDER_ASSIGNED',
        entityType: 'Order',
        entityId: created.id,
        metadata: {
          source: 'DOOR',
          performanceId: quote.performanceId,
          seatIds: normalizedSeatIds,
          inPersonAttemptId: attemptId,
          expectedAmountCents,
          paymentMethod: parsed.data.paymentMethod,
          ticketSelectionBySeatId: parsed.data.ticketSelectionBySeatId
        }
      });

      reply.status(201).send({
        id: created.id,
        status: created.status,
        source: created.source,
        expectedAmountCents,
        paymentMethod: parsed.data.paymentMethod,
        seats: quote.seats
      });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to finalize in-person sale');
    }
  });

  app.post('/api/admin/orders/:id/resend', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const params = request.params as { id: string };

    try {
      const order = await prisma.order.findUnique({
        where: { id: params.id },
        include: {
          performance: { include: { show: true } },
          tickets: { include: { seat: true }, orderBy: { createdAt: 'asc' } },
          orderSeats: { orderBy: { createdAt: 'asc' } }
        }
      });

      if (!order) {
        throw new HttpError(404, 'Order not found');
      }

      if (order.status !== 'PAID') {
        throw new HttpError(400, 'Only paid orders can resend tickets');
      }

      const isGeneralAdmission = order.performance.seatSelectionEnabled === false;
      const orderSeatBySeatId = new Map(
        order.orderSeats
          .filter((seat) => Boolean(seat.seatId))
          .map((seat) => [seat.seatId, seat])
      );
      const generalAdmissionOrderSeats = order.orderSeats.filter((seat) => !seat.seatId);
      let generalAdmissionSeatCursor = 0;

      await sendTicketsEmail({
        orderId: order.id,
        customerName: order.customerName,
        customerEmail: order.email,
        showTitle: order.performance.title || order.performance.show.title,
        startsAtIso: order.performance.startsAt.toISOString(),
        venue: order.performance.venue,
        tickets: order.tickets.map((ticket, index) => {
          const matchedOrderSeat =
            (ticket.seatId ? orderSeatBySeatId.get(ticket.seatId) : null) ||
            generalAdmissionOrderSeats[generalAdmissionSeatCursor++] ||
            order.orderSeats[index];
          return {
            publicId: ticket.publicId,
            row: isGeneralAdmission ? '' : ticket.seat?.row || '',
            number: isGeneralAdmission ? index + 1 : ticket.seat?.number || index + 1,
            sectionName: isGeneralAdmission ? 'General Admission' : ticket.seat?.sectionName || 'Unassigned Seat',
            seatLabel: isGeneralAdmission ? `General Admission Ticket ${index + 1}` : null,
            ticketType: matchedOrderSeat?.ticketType || null,
            attendeeName: matchedOrderSeat?.attendeeName || null
          };
        })
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

  app.post('/api/admin/orders/:id/refund', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
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

      const refund = await requestStripeRefundForOrder({
        orderId: order.id,
        requestedBy: adminActor(request),
        reason: parsed.data.reason || 'Admin refund',
        idempotencyKey: `admin-refund:${order.id}`
      });

      await logAudit({
        actor: adminActor(request),
        action: 'ORDER_REFUND_REQUESTED',
        entityType: 'Order',
        entityId: order.id,
        metadata: {
          ...parsed.data,
          refundOutcome: refund.outcome,
          refundId: refund.refundId,
          refundStatus: refund.refundStatus
        }
      });

      const successMessage =
        refund.outcome === 'succeeded'
          ? 'Stripe refund completed.'
          : refund.outcome === 'pending' || refund.outcome === 'already_requested'
            ? 'Stripe refund requested and awaiting completion.'
            : refund.outcome === 'already_refunded'
              ? 'Order was already refunded.'
              : 'Stripe refund request failed.';

      reply.send({
        success: refund.outcome !== 'failed',
        refundOutcome: refund.outcome,
        refundId: refund.refundId,
        refundStatus: refund.refundStatus,
        message: successMessage
      });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to refund order');
    }
  });

  app.delete('/api/admin/orders/:id', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const params = request.params as { id: string };

    try {
      const deleted = await prisma.$transaction(async (tx) => {
        const order = await tx.order.findUnique({
          where: { id: params.id },
          select: {
            id: true,
            status: true,
            performanceId: true,
            amountTotal: true,
            source: true,
            stripeSessionId: true,
            stripePaymentIntentId: true,
            orderSeats: {
              select: {
                seatId: true
              }
            },
            _count: {
              select: {
                orderSeats: true,
                tickets: true
              }
            }
          }
        });

        if (!order) {
          throw new HttpError(404, 'Order not found');
        }

        if (order.status !== 'CANCELED') {
          throw new HttpError(400, 'Only canceled orders can be permanently deleted');
        }

        await releasePendingStudentCreditForOrderTx(tx, order.id);

        const seatIds = order.orderSeats
          .map((seat) => seat.seatId)
          .filter((seatId): seatId is string => Boolean(seatId));

        if (seatIds.length > 0) {
          await tx.seat.updateMany({
            where: {
              id: { in: seatIds },
              performanceId: order.performanceId,
              status: 'SOLD'
            },
            data: {
              status: 'AVAILABLE',
              holdSessionId: null
            }
          });
        }

        await tx.order.delete({
          where: { id: order.id }
        });

        return {
          id: order.id,
          status: order.status,
          amountTotal: order.amountTotal,
          source: order.source,
          stripeSessionId: order.stripeSessionId,
          stripePaymentIntentId: order.stripePaymentIntentId,
          orderSeatCount: order._count.orderSeats,
          ticketCount: order._count.tickets
        };
      });

      await logAudit({
        actor: adminActor(request),
        action: 'ORDER_DELETED',
        entityType: 'Order',
        entityId: deleted.id,
        metadata: {
          status: deleted.status,
          amountTotal: deleted.amountTotal,
          source: deleted.source,
          stripeSessionId: deleted.stripeSessionId,
          stripePaymentIntentId: deleted.stripePaymentIntentId,
          orderSeatCount: deleted.orderSeatCount,
          ticketCount: deleted.ticketCount
        }
      });

      reply.send({ success: true, deleted: true });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to delete order');
    }
  });
};
