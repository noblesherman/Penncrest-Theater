import { FastifyReply } from 'fastify';
import { HttpError } from './http-error.js';

export function handleRouteError(reply: FastifyReply, err: unknown, fallbackMessage: string): void {
  if (err instanceof HttpError) {
    reply.status(err.statusCode).send({ error: err.message });
    return;
  }

  if (err instanceof Error) {
    reply.status(500).send({ error: err.message || fallbackMessage });
    return;
  }

  reply.status(500).send({ error: fallbackMessage });
}
