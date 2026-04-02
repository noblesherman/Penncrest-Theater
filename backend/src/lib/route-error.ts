import { FastifyReply } from 'fastify';
import { Prisma } from '@prisma/client';
import { HttpError } from './http-error.js';

export function handleRouteError(reply: FastifyReply, err: unknown, fallbackMessage: string): void {
  if (err instanceof HttpError) {
    reply.status(err.statusCode).send({ error: err.message });
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
      error: `Database schema is out of date.${details} Run backend migrations (prisma migrate deploy).`
    });
    return;
  }

  reply.log.error({ err }, fallbackMessage);

  if (err instanceof Error) {
    reply.status(500).send({ error: fallbackMessage });
    return;
  }

  reply.status(500).send({ error: fallbackMessage });
}
