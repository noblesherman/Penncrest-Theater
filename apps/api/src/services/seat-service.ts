/*
Handoff note for Mr. Smith:
- File: `apps/api/src/services/seat-service.ts`
- What this is: Express service handler module (secondary API app).
- What it does: Contains request business logic used by route handlers.
- Connections: Invoked from routes and tied to Prisma/Stripe helpers.
- Main content type: Business logic with DB/payment side effects.
- Safe edits here: Comments and non-breaking readability improvements.
- Be careful with: Idempotency and write-order changes in checkout/payment flows.
- Useful context: If this app is still live anywhere, keep behavior changes tightly controlled.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../errors.js';

function mapSeatState(state: any) {
  switch (state) {
    case 'AVAILABLE':
    case 'HELD':
    case 'SOLD':
    case 'BLOCKED':
      return state.toLowerCase();
    default:
      return 'available';
  }
}

export const seatController = {
  getSeats: async (req: Request, res: Response) => {
    const performanceId = req.params.id;
    try {
      const performance = await prisma.performance.findUnique({
        where: { id: performanceId },
        include: {
          seatMapVersion: {
            include: {
              sections: true,
              seats: true
            }
          },
          tiers: true,
          priceRules: true
        }
      });
      if (!performance) throw new HttpError(404, 'Performance not found');

      const seatStates = await prisma.performanceSeatState.findMany({
        where: { performanceId },
        select: { seatId: true, state: true }
      });
      const stateMap = new Map(seatStates.map((s) => [s.seatId, mapSeatState(s.state)]));

      const seats = performance.seatMapVersion.seats.map((seat) => ({
        id: seat.id,
        sectionId: seat.sectionId,
        rowLabel: seat.rowLabel,
        seatNumber: seat.seatNumber,
        seatLabel: seat.seatLabel,
        flags: seat.flagsJson,
        state: stateMap.get(seat.id) || 'available'
      }));

      res.json({
        seatMap: {
          id: performance.seatMapVersionId,
          sections: performance.seatMapVersion.sections,
          seats
        },
        tiers: performance.tiers.filter((t) => t.active),
        priceRules: performance.priceRules
      });
    } catch (err: any) {
      const status = err instanceof HttpError ? err.status : 500;
      res.status(status).json({ error: err.message || 'Failed to fetch seats' });
    }
  }
};
