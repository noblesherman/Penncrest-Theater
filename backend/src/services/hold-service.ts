import crypto from 'node:crypto';
import { HoldSession, Prisma } from '@prisma/client';
import { env } from '../lib/env.js';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/http-error.js';

function generateHoldToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

function dedupeSeatIds(seatIds: string[]): string[] {
  return [...new Set(seatIds)];
}

async function releaseExpiredHoldsInTx(tx: Prisma.TransactionClient): Promise<number> {
  const now = new Date();
  const expired = await tx.holdSession.findMany({
    where: { status: 'ACTIVE', expiresAt: { lt: now } },
    select: { id: true }
  });

  if (expired.length === 0) {
    return 0;
  }

  const expiredIds = expired.map((h) => h.id);
  await tx.seat.updateMany({
    where: { holdSessionId: { in: expiredIds }, status: 'HELD' },
    data: { status: 'AVAILABLE', holdSessionId: null }
  });
  await tx.seatHold.deleteMany({ where: { holdSessionId: { in: expiredIds } } });
  await tx.holdSession.updateMany({
    where: { id: { in: expiredIds } },
    data: { status: 'EXPIRED' }
  });

  return expired.length;
}

export async function releaseExpiredHolds(): Promise<number> {
  return prisma.$transaction(async (tx) => releaseExpiredHoldsInTx(tx));
}

async function getOrCreateHoldSession(tx: Prisma.TransactionClient, performanceId: string, clientToken: string): Promise<HoldSession> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + env.HOLD_TTL_MINUTES * 60_000);

  const existing = await tx.holdSession.findUnique({
    where: {
      performanceId_clientToken: {
        performanceId,
        clientToken
      }
    }
  });

  if (!existing) {
    return tx.holdSession.create({
      data: {
        performanceId,
        clientToken,
        holdToken: generateHoldToken(),
        status: 'ACTIVE',
        expiresAt
      }
    });
  }

  return tx.holdSession.update({
    where: { id: existing.id },
    data: {
      holdToken: existing.holdToken || generateHoldToken(),
      status: 'ACTIVE',
      expiresAt
    }
  });
}

export async function syncSeatHold(params: {
  performanceId: string;
  seatIds: string[];
  clientToken: string;
}): Promise<{ holdToken: string; expiresAt: Date; heldSeatIds: string[] }> {
  const seatIds = dedupeSeatIds(params.seatIds);

  return prisma.$transaction(async (tx) => {
    await releaseExpiredHoldsInTx(tx);

    const performance = await tx.performance.findUnique({
      where: { id: params.performanceId },
      select: { id: true, startsAt: true, salesCutoffAt: true }
    });
    if (!performance) {
      throw new HttpError(404, 'Performance not found');
    }

    const salesCutoffAt = performance.salesCutoffAt || performance.startsAt;
    if (salesCutoffAt <= new Date()) {
      throw new HttpError(400, 'Online sales are closed for this performance');
    }

    const holdSession = await getOrCreateHoldSession(tx, params.performanceId, params.clientToken);

    const seats = seatIds.length
      ? await tx.seat.findMany({
          where: {
            id: { in: seatIds },
            performanceId: params.performanceId
          },
          select: {
            id: true,
            status: true,
            holdSessionId: true,
            isAccessible: true,
            isCompanion: true,
            companionForSeatId: true
          }
        })
      : [];

    if (seats.length !== seatIds.length) {
      throw new HttpError(400, 'One or more selected seats are invalid for this performance');
    }

    const blockedOrSold = seats.find((seat) => seat.status === 'SOLD' || seat.status === 'BLOCKED');
    if (blockedOrSold) {
      throw new HttpError(409, 'One or more selected seats are no longer available');
    }

    const heldByOther = seats.find(
      (seat) => seat.status === 'HELD' && seat.holdSessionId !== holdSession.id
    );
    if (heldByOther) {
      throw new HttpError(409, 'One or more selected seats are currently held by another customer');
    }

    const selectedSeatIds = new Set(seatIds);
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

    const existingHoldSeats = await tx.seatHold.findMany({
      where: { holdSessionId: holdSession.id },
      select: { seatId: true }
    });

    const currentSeatIds = new Set(existingHoldSeats.map((s) => s.seatId));
    const requestedSeatIds = new Set(seatIds);

    const toRelease = [...currentSeatIds].filter((seatId) => !requestedSeatIds.has(seatId));
    const toAcquire = [...requestedSeatIds].filter((seatId) => !currentSeatIds.has(seatId));

    if (toRelease.length) {
      await tx.seat.updateMany({
        where: {
          id: { in: toRelease },
          holdSessionId: holdSession.id,
          status: 'HELD'
        },
        data: {
          status: 'AVAILABLE',
          holdSessionId: null
        }
      });

      await tx.seatHold.deleteMany({
        where: {
          holdSessionId: holdSession.id,
          seatId: { in: toRelease }
        }
      });
    }

    if (toAcquire.length) {
      const updated = await tx.seat.updateMany({
        where: {
          id: { in: toAcquire },
          performanceId: params.performanceId,
          status: 'AVAILABLE',
          holdSessionId: null
        },
        data: {
          status: 'HELD',
          holdSessionId: holdSession.id
        }
      });

      if (updated.count !== toAcquire.length) {
        throw new HttpError(409, 'One or more selected seats are no longer available');
      }

      await tx.seatHold.createMany({
        data: toAcquire.map((seatId) => ({
          seatId,
          holdSessionId: holdSession.id
        })),
        skipDuplicates: true
      });
    }

    const refreshed = await tx.holdSession.update({
      where: { id: holdSession.id },
      data: {
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + env.HOLD_TTL_MINUTES * 60_000)
      },
      include: {
        seatHolds: {
          select: { seatId: true }
        }
      }
    });

    return {
      holdToken: refreshed.holdToken,
      expiresAt: refreshed.expiresAt,
      heldSeatIds: refreshed.seatHolds.map((seat) => seat.seatId)
    };
  });
}

export async function releaseHoldByToken(holdToken: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const hold = await tx.holdSession.findUnique({ where: { holdToken } });
    if (!hold || hold.status !== 'ACTIVE') {
      return;
    }

    await tx.seat.updateMany({
      where: {
        holdSessionId: hold.id,
        status: 'HELD'
      },
      data: {
        status: 'AVAILABLE',
        holdSessionId: null
      }
    });

    await tx.seatHold.deleteMany({ where: { holdSessionId: hold.id } });
    await tx.holdSession.update({
      where: { id: hold.id },
      data: { status: 'CANCELED' }
    });
  });
}
