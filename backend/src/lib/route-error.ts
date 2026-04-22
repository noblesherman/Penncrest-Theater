/*
Handoff note for Mr. Smith:
- File: `backend/src/lib/route-error.ts`
- What this is: Backend shared utility module.
- What it does: Provides reusable helpers for auth, crypto, storage, content, and data transforms.
- Connections: Imported by routes/services/jobs across the backend.
- Main content type: Shared behavior/utilities.
- Safe edits here: Additive helpers and local docs with stable exports.
- Be careful with: Changing helper semantics used by multiple domains.
- Useful context: Cross-feature bugs often trace back to a shared lib helper like this.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { FastifyReply } from 'fastify';
import { Prisma } from '@prisma/client';
import { HttpError } from './http-error.js';
import { toTheaterFriendlyErrorMessage } from './theater-error-tone.js';

export function handleRouteError(reply: FastifyReply, err: unknown, fallbackMessage: string): void {
  const friendlyFallback = toTheaterFriendlyErrorMessage(fallbackMessage);

  if (err instanceof HttpError) {
    reply.status(err.statusCode).send({ error: toTheaterFriendlyErrorMessage(err.message, friendlyFallback) });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2021' || err.code === 'P2022')) {
    const column =
      err.code === 'P2022' &&
      typeof err.meta === 'object' &&
      err.meta !== null &&
      'column' in err.meta &&
      typeof err.meta.column === 'string'
        ? err.meta.column
        : null;
    const table =
      err.code === 'P2021' &&
      typeof err.meta === 'object' &&
      err.meta !== null &&
      'table' in err.meta &&
      typeof err.meta.table === 'string'
        ? err.meta.table
        : null;
    const details = table
      ? ` Missing table: ${table}.`
      : column
        ? ` Missing column: ${column}.`
        : '';
    reply.status(503).send({
      error: toTheaterFriendlyErrorMessage(
        `Database schema is out of date.${details} Run backend migrations (prisma migrate deploy).`,
        friendlyFallback
      )
    });
    return;
  }

  if (
    err instanceof Error &&
    /Unknown arg `(?:questionConfig|extraResponses|secondSubmissionPriceCents|studentKey|entryNumber)`|Unknown argument `(?:questionConfig|extraResponses|secondSubmissionPriceCents|studentKey|entryNumber)`/i.test(err.message)
  ) {
    reply.status(503).send({
      error: toTheaterFriendlyErrorMessage(
        'Backend Prisma client is out of date. Run prisma generate and redeploy backend.',
        friendlyFallback
      )
    });
    return;
  }

  reply.log.error({ err }, fallbackMessage);

  if (err instanceof Error) {
    reply.status(500).send({ error: toTheaterFriendlyErrorMessage(fallbackMessage, friendlyFallback) });
    return;
  }

  reply.status(500).send({ error: friendlyFallback });
}
