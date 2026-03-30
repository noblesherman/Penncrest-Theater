import {
  StudentCreditTransactionType,
  OrderSource,
  Prisma,
  StudentCreditVerificationMethod,
  StudentTicketCredit
} from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/http-error.js';

type StudentCreditIdentity = {
  id: string;
  showId: string;
  studentName: string;
  studentEmail: string | null;
  roleName: string | null;
  allocatedTickets: number;
  usedTickets: number;
  pendingTickets: number;
  isActive: boolean;
};

export type StudentCreditEligibility = {
  studentTicketCreditId: string;
  studentName: string;
  studentEmail: string | null;
  roleName: string | null;
  allocatedTickets: number;
  usedTickets: number;
  remainingTickets: number;
  maxUsableOnCheckout: number;
  verificationMethod: 'code';
};

export function normalizeStudentVerificationCode(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '');
}

// Backward-compat alias while callers transition away from email terminology.
export function normalizeStudentSchoolEmail(email: string): string {
  return normalizeStudentVerificationCode(email);
}

function computeEligibility(credit: StudentCreditIdentity, requestedSeatCount: number): StudentCreditEligibility {
  const safeRequested = Math.max(0, Math.floor(requestedSeatCount));
  const remainingTickets = Math.max(0, credit.allocatedTickets - credit.usedTickets);
  const availableNow = Math.max(0, remainingTickets - credit.pendingTickets);

  return {
    studentTicketCreditId: credit.id,
    studentName: credit.studentName,
    studentEmail: credit.studentEmail,
    roleName: credit.roleName,
    allocatedTickets: credit.allocatedTickets,
    usedTickets: credit.usedTickets,
    remainingTickets,
    maxUsableOnCheckout: Math.min(safeRequested, availableNow),
    verificationMethod: 'code'
  };
}

function assertEligibilityHasAvailability(eligibility: StudentCreditEligibility): void {
  if (eligibility.remainingTickets <= 0) {
    throw new HttpError(409, 'No remaining complimentary student tickets');
  }

  if (eligibility.maxUsableOnCheckout <= 0) {
    throw new HttpError(409, 'No complimentary student tickets are currently available for checkout');
  }
}

async function loadPerformanceShowId(tx: Prisma.TransactionClient, performanceId: string): Promise<string> {
  const performance = await tx.performance.findFirst({
    where: { id: performanceId, isArchived: false },
    select: { id: true, showId: true }
  });

  if (!performance) {
    throw new HttpError(404, 'Performance not found');
  }

  return performance.showId;
}

function assertStudentCreditActive(credit: StudentCreditIdentity): void {
  if (!credit.isActive) {
    throw new HttpError(403, 'Student credit record is inactive');
  }
}

async function lockStudentCreditRow(
  tx: Prisma.TransactionClient,
  studentTicketCreditId: string
): Promise<StudentCreditIdentity> {
  const rows = await tx.$queryRaw<StudentCreditIdentity[]>`
    SELECT
      "id",
      "showId",
      "studentName",
      "studentEmail",
      "roleName",
      "allocatedTickets",
      "usedTickets",
      "pendingTickets",
      "isActive"
    FROM "StudentTicketCredit"
    WHERE "id" = ${studentTicketCreditId}
    FOR UPDATE
  `;

  const credit = rows[0];
  if (!credit) {
    throw new HttpError(404, 'Student credit record not found');
  }

  return credit;
}

export async function getStudentCreditEligibilityBySchoolEmail(params: {
  performanceId: string;
  schoolEmail: string;
  requestedSeatCount: number;
}): Promise<StudentCreditEligibility> {
  return getStudentCreditEligibilityByStudentCode({
    performanceId: params.performanceId,
    studentCode: params.schoolEmail,
    requestedSeatCount: params.requestedSeatCount
  });
}

export async function getStudentCreditEligibilityByStudentCode(params: {
  performanceId: string;
  studentCode: string;
  requestedSeatCount: number;
}): Promise<StudentCreditEligibility> {
  const normalizedCode = normalizeStudentVerificationCode(params.studentCode);
  if (!normalizedCode) {
    throw new HttpError(400, 'Student code is required');
  }

  const result = await prisma.$transaction(async (tx) => {
    const showId = await loadPerformanceShowId(tx, params.performanceId);

    const matchingCredits = await tx.studentTicketCredit.findMany({
      where: {
        showId,
        studentEmail: normalizedCode,
        isActive: true
      },
      select: {
        id: true,
        showId: true,
        studentName: true,
        studentEmail: true,
        roleName: true,
        allocatedTickets: true,
        usedTickets: true,
        pendingTickets: true,
        isActive: true
      }
    });

    if (matchingCredits.length === 0) {
      throw new HttpError(404, 'Student code is not approved for student complimentary tickets');
    }

    if (matchingCredits.length > 1) {
      throw new HttpError(
        409,
        'Multiple student credit records found for this student code. Please contact the box office.'
      );
    }

    const eligibility = computeEligibility(matchingCredits[0], params.requestedSeatCount);
    assertEligibilityHasAvailability(eligibility);
    return eligibility;
  });

  return result;
}

export async function reserveStudentCreditForOrder(params: {
  orderId: string;
  studentTicketCreditId: string;
  quantity: number;
  verificationMethod: StudentCreditVerificationMethod;
}): Promise<void> {
  const reserveQuantity = Math.max(0, Math.floor(params.quantity));
  if (reserveQuantity <= 0) {
    throw new HttpError(400, 'At least one student complimentary ticket is required for reservation');
  }

  await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: params.orderId },
      select: {
        id: true,
        performanceId: true,
        studentTicketCreditId: true,
        studentCreditPendingQuantity: true,
        status: true
      }
    });

    if (!order) {
      throw new HttpError(404, 'Order not found for student credit reservation');
    }

    if (order.status !== 'PENDING') {
      throw new HttpError(409, 'Student credit reservation requires a pending order');
    }

    if (order.studentCreditPendingQuantity > 0 || order.studentTicketCreditId) {
      throw new HttpError(409, 'Student credit reservation already exists for this order');
    }

    const credit = await lockStudentCreditRow(tx, params.studentTicketCreditId);
    assertStudentCreditActive(credit);

    const showId = await loadPerformanceShowId(tx, order.performanceId);
    if (credit.showId !== showId) {
      throw new HttpError(400, 'Student credit show does not match this checkout');
    }

    const availableNow = credit.allocatedTickets - credit.usedTickets - credit.pendingTickets;
    if (reserveQuantity > availableNow) {
      throw new HttpError(409, 'Over-redemption attempt: insufficient remaining student credits');
    }

    await tx.studentTicketCredit.update({
      where: { id: credit.id },
      data: {
        pendingTickets: {
          increment: reserveQuantity
        }
      }
    });

    await tx.order.update({
      where: { id: order.id },
      data: {
        studentTicketCreditId: credit.id,
        studentCreditPendingQuantity: reserveQuantity,
        studentCreditVerificationMethod: params.verificationMethod
      }
    });
  });
}

export async function releasePendingStudentCreditForOrder(orderId: string): Promise<number> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        studentTicketCreditId: true,
        studentCreditPendingQuantity: true
      }
    });

    if (!order || !order.studentTicketCreditId || order.studentCreditPendingQuantity <= 0) {
      return 0;
    }

    const credit = await lockStudentCreditRow(tx, order.studentTicketCreditId);
    const releaseQuantity = Math.min(order.studentCreditPendingQuantity, Math.max(0, credit.pendingTickets));

    if (releaseQuantity > 0) {
      await tx.studentTicketCredit.update({
        where: { id: credit.id },
        data: {
          pendingTickets: {
            decrement: releaseQuantity
          }
        }
      });
    }

    await tx.order.update({
      where: { id: order.id },
      data: {
        studentCreditPendingQuantity: 0
      }
    });

    return releaseQuantity;
  });
}

export async function finalizeStudentCreditForOrderTx(
  tx: Prisma.TransactionClient,
  order: {
    id: string;
    source: OrderSource;
    performanceId: string;
    studentTicketCreditId: string | null;
    studentCreditPendingQuantity: number;
    studentCreditVerificationMethod: StudentCreditVerificationMethod | null;
  }
): Promise<number> {
  if (order.source !== 'STUDENT_COMP') {
    return 0;
  }

  if (!order.studentTicketCreditId || order.studentCreditPendingQuantity <= 0) {
    return 0;
  }

  const quantity = order.studentCreditPendingQuantity;
  const credit = await lockStudentCreditRow(tx, order.studentTicketCreditId);

  if (credit.pendingTickets < quantity) {
    throw new HttpError(409, 'Unable to finalize student credit reservation');
  }

  if (credit.usedTickets + quantity > credit.allocatedTickets) {
    throw new HttpError(409, 'Student credit over-redemption detected during finalization');
  }

  await tx.studentTicketCredit.update({
    where: { id: credit.id },
    data: {
      usedTickets: {
        increment: quantity
      },
      pendingTickets: {
        decrement: quantity
      }
    }
  });

  await tx.studentTicketCreditTransaction.create({
    data: {
      studentTicketCreditId: credit.id,
      orderId: order.id,
      performanceId: order.performanceId,
      quantity,
      type: StudentCreditTransactionType.REDEEM,
      verificationMethod: order.studentCreditVerificationMethod || StudentCreditVerificationMethod.CODE
    }
  });

  await tx.order.update({
    where: { id: order.id },
    data: {
      studentCreditPendingQuantity: 0,
      studentCreditRedeemedQuantity: {
        increment: quantity
      }
    }
  });

  return quantity;
}

export async function redeemStudentCreditImmediatelyForPaidOrder(params: {
  orderId: string;
  performanceId: string;
  studentTicketCreditId: string;
  quantity: number;
  verificationMethod: StudentCreditVerificationMethod;
}): Promise<void> {
  const quantity = Math.max(0, Math.floor(params.quantity));
  if (quantity <= 0) {
    return;
  }

  await prisma.$transaction(async (tx) => {
    const credit = await lockStudentCreditRow(tx, params.studentTicketCreditId);
    assertStudentCreditActive(credit);
    const availableNow = credit.allocatedTickets - credit.usedTickets - credit.pendingTickets;
    if (availableNow < quantity) {
      throw new HttpError(409, 'Over-redemption attempt: insufficient remaining student credits');
    }

    await tx.studentTicketCredit.update({
      where: { id: credit.id },
      data: {
        usedTickets: {
          increment: quantity
        }
      }
    });

    await tx.studentTicketCreditTransaction.create({
      data: {
        studentTicketCreditId: credit.id,
        orderId: params.orderId,
        performanceId: params.performanceId,
        quantity,
        type: StudentCreditTransactionType.REDEEM,
        verificationMethod: params.verificationMethod
      }
    });

    await tx.order.update({
      where: { id: params.orderId },
      data: {
        studentTicketCreditId: credit.id,
        studentCreditPendingQuantity: 0,
        studentCreditRedeemedQuantity: {
          increment: quantity
        },
        studentCreditVerificationMethod: params.verificationMethod
      }
    });
  });
}

export async function restoreStudentCreditsForRefundTx(
  tx: Prisma.TransactionClient,
  params: {
    orderId: string;
    restoredBy: string;
    notes?: string;
  }
): Promise<number> {
  const order = await tx.order.findUnique({
    where: { id: params.orderId },
    select: {
      id: true,
      performanceId: true,
      studentTicketCreditId: true,
      studentCreditRedeemedQuantity: true,
      studentCreditRestoredQuantity: true,
      studentCreditVerificationMethod: true
    }
  });

  if (!order || !order.studentTicketCreditId) {
    return 0;
  }

  const outstandingRestore = order.studentCreditRedeemedQuantity - order.studentCreditRestoredQuantity;
  if (outstandingRestore <= 0) {
    return 0;
  }

  const credit = await lockStudentCreditRow(tx, order.studentTicketCreditId);
  if (credit.usedTickets < outstandingRestore) {
    throw new HttpError(409, 'Unable to restore student credits: usage state is inconsistent');
  }

  await tx.studentTicketCredit.update({
    where: { id: credit.id },
    data: {
      usedTickets: {
        decrement: outstandingRestore
      }
    }
  });

  await tx.studentTicketCreditTransaction.create({
    data: {
      studentTicketCreditId: credit.id,
      orderId: order.id,
      performanceId: order.performanceId,
      quantity: outstandingRestore,
      type: StudentCreditTransactionType.REFUND_RESTORE,
      verificationMethod: order.studentCreditVerificationMethod || StudentCreditVerificationMethod.ADMIN,
      redeemedBy: params.restoredBy,
      notes: params.notes || 'Refund restoration'
    }
  });

  await tx.order.update({
    where: { id: order.id },
    data: {
      studentCreditRestoredQuantity: {
        increment: outstandingRestore
      }
    }
  });

  return outstandingRestore;
}

export async function manualRedeemStudentCredit(params: {
  studentTicketCreditId: string;
  quantity: number;
  performanceId?: string;
  redeemedBy: string;
  notes?: string;
}): Promise<StudentTicketCredit> {
  const quantity = Math.max(0, Math.floor(params.quantity));
  if (quantity <= 0) {
    throw new HttpError(400, 'Quantity must be at least 1');
  }

  return prisma.$transaction(async (tx) => {
    const credit = await lockStudentCreditRow(tx, params.studentTicketCreditId);
    const availableNow = credit.allocatedTickets - credit.usedTickets - credit.pendingTickets;

    if (availableNow < quantity) {
      throw new HttpError(409, 'Over-redemption attempt: insufficient remaining student credits');
    }

    await tx.studentTicketCredit.update({
      where: { id: credit.id },
      data: {
        usedTickets: {
          increment: quantity
        }
      }
    });

    await tx.studentTicketCreditTransaction.create({
      data: {
        studentTicketCreditId: credit.id,
        performanceId: params.performanceId,
        quantity,
        type: StudentCreditTransactionType.MANUAL_REDEEM,
        verificationMethod: StudentCreditVerificationMethod.ADMIN,
        redeemedBy: params.redeemedBy,
        notes: params.notes
      }
    });

    return tx.studentTicketCredit.findUniqueOrThrow({ where: { id: credit.id } });
  });
}

export async function manualRestoreStudentCredit(params: {
  studentTicketCreditId: string;
  quantity: number;
  performanceId?: string;
  restoredBy: string;
  notes?: string;
}): Promise<StudentTicketCredit> {
  const quantity = Math.max(0, Math.floor(params.quantity));
  if (quantity <= 0) {
    throw new HttpError(400, 'Quantity must be at least 1');
  }

  return prisma.$transaction(async (tx) => {
    const credit = await lockStudentCreditRow(tx, params.studentTicketCreditId);

    if (credit.usedTickets < quantity) {
      throw new HttpError(409, 'Cannot restore more tickets than currently used');
    }

    await tx.studentTicketCredit.update({
      where: { id: credit.id },
      data: {
        usedTickets: {
          decrement: quantity
        }
      }
    });

    await tx.studentTicketCreditTransaction.create({
      data: {
        studentTicketCreditId: credit.id,
        performanceId: params.performanceId,
        quantity,
        type: StudentCreditTransactionType.REFUND_RESTORE,
        verificationMethod: StudentCreditVerificationMethod.ADMIN,
        redeemedBy: params.restoredBy,
        notes: params.notes || 'Manual restore'
      }
    });

    return tx.studentTicketCredit.findUniqueOrThrow({ where: { id: credit.id } });
  });
}

export function studentCreditRemainingTickets(credit: Pick<StudentTicketCredit, 'allocatedTickets' | 'usedTickets'>): number {
  return Math.max(0, credit.allocatedTickets - credit.usedTickets);
}
