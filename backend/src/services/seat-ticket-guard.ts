/*
Handoff note for Mr. Smith:
- File: `backend/src/services/seat-ticket-guard.ts`
- What this is: Backend domain guard module.
- What it does: Centralizes issued-ticket uniqueness checks for assigned reserved seats.
- Connections: Called before ticket creation in checkout, comp, and in-person order paths.
- Main content type: Defensive data-integrity checks.
- Safe edits here: Error wording and additional diagnostic fields.
- Be careful with: Relaxing this guard can re-open duplicate seat issuance.
*/

import { Prisma } from '@prisma/client';
import { HttpError } from '../lib/http-error.js';

type AssertNoIssuedTicketsForSeatsParams = {
  performanceId: string;
  seatIds: string[];
  excludingOrderId?: string;
};

export async function assertNoIssuedTicketsForSeats(
  tx: Prisma.TransactionClient,
  params: AssertNoIssuedTicketsForSeatsParams
): Promise<void> {
  const seatIds = [...new Set(params.seatIds.filter(Boolean))];
  if (seatIds.length === 0) {
    return;
  }

  const conflictingTicket = await tx.ticket.findFirst({
    where: {
      performanceId: params.performanceId,
      seatId: { in: seatIds },
      status: 'ISSUED',
      ...(params.excludingOrderId ? { orderId: { not: params.excludingOrderId } } : {})
    },
    include: {
      seat: {
        select: {
          sectionName: true,
          row: true,
          number: true
        }
      }
    },
    orderBy: {
      createdAt: 'asc'
    }
  });

  if (!conflictingTicket) {
    return;
  }

  const seatLabel = conflictingTicket.seat
    ? `${conflictingTicket.seat.sectionName} Row ${conflictingTicket.seat.row} Seat ${conflictingTicket.seat.number}`
    : 'one selected seat';

  throw new HttpError(
    409,
    `${seatLabel} already has an issued ticket. Refresh the seat map and choose another seat.`
  );
}
