import { Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { holdRequestSchema, releaseRequestSchema } from '../validation.js';
import { HttpError } from '../errors.js';
import { addMinutes, isAfter } from 'date-fns';

const HOLD_MINUTES = 8;
const MAX_EXTEND = 1;

export const holdController = {
  createHold: async (req: Request, res: Response) => {
    const performanceId = req.params.id;
    const parse = holdRequestSchema.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
    const { seatIds, tierId, clientSessionToken, extend } = parse.data;

    try {
      const performance = await prisma.performance.findUnique({
        where: { id: performanceId },
        include: { seatMapVersion: { select: { id: true } }, tiers: true }
      });
      if (!performance) throw new HttpError(404, 'Performance not found');
      if (performance.status !== 'ON_SALE') throw new HttpError(400, 'Performance not on sale');
      if (performance.onSaleAt && isAfter(new Date(performance.onSaleAt), new Date()))
        throw new HttpError(400, 'Sales not started');
      if (performance.offSaleAt && isAfter(new Date(), new Date(performance.offSaleAt)))
        throw new HttpError(400, 'Sales closed');

      const tier = performance.tiers.find((t) => t.id === tierId && t.active);
      if (!tier) throw new HttpError(400, 'Tier not valid for performance');

      // Validate seats belong to the performance seat map
      const seats = await prisma.seat.findMany({
        where: { id: { in: seatIds }, seatMapVersionId: performance.seatMapVersionId },
        select: { id: true }
      });
      if (seats.length !== seatIds.length) throw new HttpError(400, 'Invalid seats');

      const expiresAt = addMinutes(new Date(), HOLD_MINUTES);

      const result = await prisma.$transaction(async (tx) => {
        // If extend is requested, find existing hold for this client session
        if (extend) {
          const existing = await tx.hold.findFirst({
            where: {
              performanceId,
              clientToken: clientSessionToken,
              status: 'ACTIVE'
            },
            include: { holdSeats: true }
          });
          if (!existing) throw new HttpError(404, 'No active hold to extend');
          if (existing.extendCount >= MAX_EXTEND) throw new HttpError(400, 'Hold already extended');

          const updated = await tx.hold.update({
            where: { id: existing.id },
            data: { expiresAt, extendCount: { increment: 1 } }
          });
          return { holdId: updated.id, lockedSeats: existing.holdSeats.map((s) => s.seatId) };
        }

        // Create hold row
        const hold = await tx.hold.create({
          data: {
            performanceId,
            clientToken: clientSessionToken,
            expiresAt,
            status: 'ACTIVE'
          }
        });

        // Update performance seat state atomically
        const update = await tx.performanceSeatState.updateMany({
          where: {
            performanceId,
            seatId: { in: seatIds },
            state: 'AVAILABLE'
          },
          data: { state: 'HELD', holdId: hold.id }
        });

        if (update.count !== seatIds.length) {
          throw new HttpError(409, 'One or more seats no longer available');
        }

        // Insert HoldSeat mapping
        await tx.holdSeat.createMany({
          data: seatIds.map((seatId) => ({ holdId: hold.id, seatId }))
        });

        // touch updatedAt through PerformanceSeatState updatedAt auto

        return { holdId: hold.id, lockedSeats: seatIds };
      });

      res.json({ holdId: result.holdId, expiresAt, lockedSeats: result.lockedSeats });
    } catch (err: any) {
      const status = err instanceof HttpError ? err.status : 500;
      res.status(status).json({ error: err.message || 'Failed to hold seats' });
    }
  },

  releaseHold: async (req: Request, res: Response) => {
    const holdId = req.params.holdId;
    const parse = releaseRequestSchema.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: parse.error.flatten() });
    const { clientSessionToken } = parse.data;

    try {
      await prisma.$transaction(async (tx) => {
        const hold = await tx.hold.findUnique({ where: { id: holdId } });
        if (!hold) throw new HttpError(404, 'Hold not found');
        if (hold.clientToken !== clientSessionToken) throw new HttpError(403, 'Not your hold');
        if (hold.status !== 'ACTIVE') return; // already handled

        await tx.performanceSeatState.updateMany({
          where: { holdId },
          data: { state: 'AVAILABLE', holdId: null }
        });
        await tx.hold.update({ where: { id: holdId }, data: { status: 'RELEASED' } });
      });
      res.json({ success: true });
    } catch (err: any) {
      const status = err instanceof HttpError ? err.status : 500;
      res.status(status).json({ error: err.message || 'Failed to release hold' });
    }
  }
};
