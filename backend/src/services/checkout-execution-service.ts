import { Prisma, StudentCreditVerificationMethod } from '@prisma/client';
import type { z } from 'zod';
import Stripe from 'stripe';
import { checkoutRequestSchema } from '../schemas/checkout.js';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/http-error.js';
import { stripe } from '../lib/stripe.js';
import { createAssignedOrder } from './order-assignment.js';
import { env } from '../lib/env.js';
import { generateOrderAccessToken } from '../lib/order-access.js';
import {
  getCheckoutAttemptExpiresAt,
  markCheckoutAttemptAwaitingPayment,
  markCheckoutAttemptFailed
} from './checkout-attempt-service.js';
import {
  getStudentCreditEligibilityByStudentCode,
  normalizeStudentVerificationCode,
  redeemStudentCreditImmediatelyForPaidOrder,
  reserveStudentCreditForOrderTx
} from './student-ticket-credit-service.js';
import { validateTeacherCompPromoCode } from './teacher-comp-promo-code-service.js';
import {
  normalizeEventRegistrationDefinition,
  normalizeEventRegistrationSettings,
  validateEventRegistrationSubmission,
  type ValidatedEventRegistrationSubmission
} from '../lib/event-registration-form.js';

export type CheckoutRequestPayload = z.infer<typeof checkoutRequestSchema>;

export type CheckoutExecutionResult = {
  orderId: string;
  orderAccessToken: string;
  mode: CheckoutRequestPayload['checkoutMode'];
  clientSecret?: string;
  publishableKey?: string;
  paymentIntentId?: string;
};

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
  isStudentTicket: boolean;
  isTeacherComplimentary: boolean;
  isStudentComplimentary: boolean;
};

type ResolvedTicketSelection = {
  name: string;
  priceCents: number | null;
  isTeacherTicket: boolean;
  isStudentTicket: boolean;
};

const TEACHER_TICKET_OPTION_ID = 'teacher-comp';
const STUDENT_SHOW_TICKET_OPTION_ID = 'student-show-comp';
const MAX_TEACHER_COMP_TICKETS = 2;
const MAX_STUDENT_COMP_TICKETS = 2;

function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
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
  const normalized = name.trim().toLowerCase();
  return normalized.includes('teacher') || (normalized.includes('rtmsd') && normalized.includes('staff'));
}

function isStudentInShowTicketName(name: string): boolean {
  return name.trim().toLowerCase().includes('student in show');
}

function buildPaymentDescription(showTitle: string, assignments: SeatAssignment[]): string {
  const payableSeats = assignments.filter((assignment) => assignment.finalPrice > 0);
  if (payableSeats.length === 0) {
    return `${showTitle} tickets`;
  }

  const seatList = payableSeats
    .slice(0, 3)
    .map((assignment) => `${assignment.seat.sectionName} ${assignment.seat.row}${assignment.seat.number}`)
    .join(', ');
  const remainder = payableSeats.length > 3 ? ` +${payableSeats.length - 3} more` : '';
  return `${showTitle} tickets (${seatList}${remainder})`;
}

export async function executeCheckoutRequest(payload: CheckoutRequestPayload): Promise<CheckoutExecutionResult> {
  const {
    performanceId,
    checkoutMode,
    seatIds,
    ticketSelections,
    ticketSelectionBySeatId,
    holdToken,
    clientToken,
    teacherPromoCode,
    studentCode,
    studentSchoolEmail,
    customerEmail,
    customerName,
    customerPhone,
    attendeeNames,
    registrationSubmission,
    clientIpAddress
  } = payload;
  const uniqueSeatIds = [...new Set(seatIds)];
  const isStudentCompCheckout = checkoutMode === 'STUDENT_COMP';

  let createdOrderId: string | null = null;
  let createdPaymentIntentId: string | null = null;
  let validatedRegistrationSubmission: ValidatedEventRegistrationSubmission | null = null;
  let registrationFormBinding: { formId: string; formVersionId: string } | null = null;

  try {
    const [performance, holdSession] = await Promise.all([
      prisma.performance.findFirst({
        where: { id: performanceId, isArchived: false },
        include: {
          show: true,
          pricingTiers: true,
          registrationForm: {
            select: {
              id: true,
              status: true,
              publishedVersion: {
                select: {
                  id: true,
                  settingsJson: true,
                  definitionJson: true
                }
              }
            }
          }
        }
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

    const registrationForm = performance.registrationForm;
    const publishedRegistrationFormVersion =
      performance.isFundraiser &&
      registrationForm?.status === 'PUBLISHED' &&
      registrationForm.publishedVersion
        ? registrationForm.publishedVersion
        : null;

    if (registrationForm && publishedRegistrationFormVersion) {
      const registrationSettings = normalizeEventRegistrationSettings(
        publishedRegistrationFormVersion.settingsJson as Prisma.JsonValue
      );

      if (registrationSettings.enabled) {
        if (!registrationSubmission) {
          throw new HttpError(400, 'Registration form is required before checkout.');
        }

        const registrationDefinition = normalizeEventRegistrationDefinition(
          publishedRegistrationFormVersion.definitionJson as Prisma.JsonValue
        );

        validatedRegistrationSubmission = validateEventRegistrationSubmission({
          definition: registrationDefinition,
          settings: registrationSettings,
          ticketQuantity: uniqueSeatIds.length,
          payload: registrationSubmission,
          expectedFormVersionId: publishedRegistrationFormVersion.id,
          ipAddress: clientIpAddress || null
        });
        registrationFormBinding = {
          formId: registrationForm.id,
          formVersionId: publishedRegistrationFormVersion.id
        };
      }
    }

    if (!performance.isPublished || (performance.onlineSalesStartsAt && performance.onlineSalesStartsAt > new Date())) {
      throw new HttpError(400, 'Online sales are not live for this performance yet');
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
    const normalizedCustomerPhone = customerPhone.trim();
    const isTeacherCompCheckout = checkoutMode === 'TEACHER_COMP';
    let effectiveCustomerEmail = normalizedCustomerEmail;
    let effectiveCustomerName = normalizedCustomerName;

    if (!normalizedCustomerPhone) {
      throw new HttpError(400, 'Customer phone number is required');
    }

    if (isTeacherCompCheckout) {
      if (performance.isFundraiser) {
        throw new HttpError(400, 'Teacher complimentary tickets are not available for fundraiser events');
      }

      if (!performance.staffCompsEnabled) {
        throw new HttpError(400, 'Teacher complimentary tickets are not enabled for this performance');
      }

      if (!teacherPromoCode) {
        throw new HttpError(400, 'Teacher promo code is required for teacher complimentary checkout');
      }
      await validateTeacherCompPromoCode(teacherPromoCode);

      if (!effectiveCustomerName) {
        throw new HttpError(400, 'Customer name is required for teacher checkout');
      }
      if (!effectiveCustomerEmail) {
        throw new HttpError(400, 'Customer email is required for teacher checkout');
      }
      if (effectiveCustomerEmail.endsWith('@rtmsd.org')) {
        throw new HttpError(400, 'Use a personal email for ticket delivery (not @rtmsd.org)');
      }

      const userRedemptionCount = await prisma.order.count({
        where: {
          performanceId: performance.id,
          source: 'STAFF_COMP',
          email: effectiveCustomerEmail,
          status: { not: 'CANCELED' }
        }
      });

      const perUserLimit = Math.max(1, performance.staffCompLimitPerUser || 1);
      if (userRedemptionCount >= perUserLimit) {
        throw new HttpError(409, `Teacher complimentary ticket limit reached for this email (${perUserLimit})`);
      }
    }

    const sortedSeats = [...seats].sort(naturalSeatSort);
    const tiersById = new Map(performance.pricingTiers.map((tier) => [tier.id, tier]));
    const resolveTicketSelection = (selectionId: string): ResolvedTicketSelection => {
      if (selectionId === TEACHER_TICKET_OPTION_ID) {
        if (performance.isFundraiser) {
          throw new HttpError(400, 'Teacher complimentary tickets are not available for fundraiser events');
        }

        return {
          name: 'RTMSD STAFF',
          priceCents: null,
          isTeacherTicket: true,
          isStudentTicket: false
        };
      }

      if (selectionId === STUDENT_SHOW_TICKET_OPTION_ID) {
        return {
          name: 'Student in Show',
          priceCents: null,
          isTeacherTicket: false,
          isStudentTicket: true
        };
      }

      const tier = tiersById.get(selectionId);
      if (!tier) {
        throw new HttpError(400, `Invalid ticket tier: ${selectionId}`);
      }

      if (performance.isFundraiser && isTeacherTicketName(tier.name)) {
        throw new HttpError(400, 'Teacher complimentary tickets are not available for fundraiser events');
      }

      return {
        name: tier.name,
        priceCents: tier.priceCents,
        isTeacherTicket: isTeacherTicketName(tier.name),
        isStudentTicket: isStudentInShowTicketName(tier.name)
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
        isStudentTicket: selectedTicket?.isStudentTicket || false,
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
      if (!performance.familyFreeTicketEnabled) {
        throw new HttpError(400, 'Student complimentary tickets are not enabled for this performance');
      }
      const rawStudentCode = studentCode ?? studentSchoolEmail;
      if (!rawStudentCode || !rawStudentCode.trim()) {
        throw new HttpError(400, 'Student code is required for student complimentary checkout');
      }
      const normalizedStudentCode = normalizeStudentVerificationCode(rawStudentCode);

      const eligibility = await getStudentCreditEligibilityByStudentCode({
        performanceId,
        studentCode: normalizedStudentCode,
        requestedSeatCount: seatAssignments.length
      });

      studentTicketCreditId = eligibility.studentTicketCreditId;
      const studentTicketAssignments = seatAssignments.filter((assignment) => assignment.isStudentTicket);
      const complimentaryCandidates = studentTicketAssignments.length > 0 ? studentTicketAssignments : seatAssignments;
      studentComplimentaryQuantity = Math.min(
        complimentaryCandidates.length,
        eligibility.maxUsableOnCheckout,
        MAX_STUDENT_COMP_TICKETS
      );

      if (studentComplimentaryQuantity <= 0) {
        throw new HttpError(409, 'No complimentary student tickets available for this checkout');
      }

      const complimentarySeatIds = pickComplimentarySeatIds(complimentaryCandidates, studentComplimentaryQuantity);
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
    const isGeneralAdmissionNoSeatLinks = performance.seatSelectionEnabled === false;

    if (amountTotal === 0) {
      const ticketTypeBySeatId = Object.fromEntries(
        seatAssignments.map((assignment) => [assignment.seat.id, assignment.ticketType || 'Complimentary'])
      );
      const priceBySeatId = Object.fromEntries(seatAssignments.map((assignment) => [assignment.seat.id, assignment.finalPrice]));

      const order = await createAssignedOrder({
        performanceId,
        seatIds: uniqueSeatIds,
        customerName: effectiveCustomerName,
        customerEmail: effectiveCustomerEmail,
        customerPhone: normalizedCustomerPhone,
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

      if (validatedRegistrationSubmission && registrationFormBinding) {
        await prisma.eventRegistrationSubmission.create({
          data: {
            orderId: order.id,
            performanceId,
            formId: registrationFormBinding.formId,
            formVersionId: registrationFormBinding.formVersionId,
            responseJson: toPrismaJson(validatedRegistrationSubmission)
          }
        });
      }

      return {
        orderId: order.id,
        orderAccessToken: order.accessToken,
        mode: checkoutMode
      };
    }

    const source = isStudentCompCheckout ? 'STUDENT_COMP' : isTeacherCompCheckout ? 'STAFF_COMP' : 'ONLINE';
    const checkoutAttemptExpiresAt = getCheckoutAttemptExpiresAt();
    const order = await prisma.$transaction(async (tx) => {
      const createdOrder = await tx.order.create({
        data: {
          performanceId,
          email: effectiveCustomerEmail,
          customerName: effectiveCustomerName,
          customerPhone: normalizedCustomerPhone,
          attendeeNamesJson: attendeeNames ?? undefined,
          amountTotal,
          currency: 'usd',
          status: 'PENDING',
          checkoutAttemptState: 'CREATING_PAYMENT_INTENT',
          checkoutAttemptExpiresAt,
          source,
          holdToken,
          accessToken: generateOrderAccessToken()
        }
      });

      await tx.orderSeat.createMany({
        data: seatAssignments.map((assignment) => ({
          orderId: createdOrder.id,
          seatId: isGeneralAdmissionNoSeatLinks ? null : assignment.seat.id,
          price: assignment.finalPrice,
          ticketType: assignment.ticketType,
          attendeeName: attendeeNames?.[assignment.seat.id],
          isComplimentary: assignment.finalPrice === 0
        }))
      });

      if (isStudentCompCheckout && studentTicketCreditId && studentComplimentaryQuantity > 0) {
        await reserveStudentCreditForOrderTx(tx, {
          orderId: createdOrder.id,
          studentTicketCreditId,
          quantity: studentComplimentaryQuantity,
          verificationMethod: StudentCreditVerificationMethod.CODE
        });
      }

      if (validatedRegistrationSubmission && registrationFormBinding) {
        await tx.eventRegistrationSubmission.create({
          data: {
            orderId: createdOrder.id,
            performanceId,
            formId: registrationFormBinding.formId,
            formVersionId: registrationFormBinding.formVersionId,
            responseJson: toPrismaJson(validatedRegistrationSubmission)
          }
        });
      }

      return createdOrder;
    });
    createdOrderId = order.id;

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountTotal,
      currency: 'usd',
      payment_method_types: ['card'],
      receipt_email: effectiveCustomerEmail,
      description: buildPaymentDescription(performance.title || performance.show.title, seatAssignments),
      metadata: {
        orderId: order.id,
        performanceId,
        seatIds: JSON.stringify(uniqueSeatIds),
        holdToken,
        clientToken,
        checkoutMode,
        seatCount: String(uniqueSeatIds.length),
        studentCreditQuantity: String(studentComplimentaryQuantity)
      }
    });
    createdPaymentIntentId = paymentIntent.id;

    if (!paymentIntent.client_secret) {
      throw new HttpError(500, 'Stripe payment intent missing client secret');
    }

    await markCheckoutAttemptAwaitingPayment({
      orderId: order.id,
      stripePaymentIntentId: paymentIntent.id
    });

    return {
      orderId: order.id,
      orderAccessToken: order.accessToken,
      clientSecret: paymentIntent.client_secret,
      publishableKey: env.STRIPE_PUBLISHABLE_KEY || undefined,
      paymentIntentId: paymentIntent.id,
      mode: checkoutMode
    };
  } catch (err) {
    if (createdOrderId) {
      try {
        await markCheckoutAttemptFailed({
          orderId: createdOrderId,
          stripePaymentIntentId: createdPaymentIntentId
        });
      } catch {
        // Ignore best-effort state marking failure.
      }
    }

    if (err instanceof Stripe.errors.StripeError) {
      throw err;
    }

    throw err;
  }
}
