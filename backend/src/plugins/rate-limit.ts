import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';
import { getClientIp, getRequestPath } from '../lib/client-ip.js';

export const rateLimitPlugin = fp(async (app) => {
  await app.register(rateLimit, {
    global: true,
    hook: 'onRequest',
    max: 240,
    timeWindow: '1 minute',
    keyGenerator: (request) => {
      const ip = getClientIp(request);
      const path = getRequestPath(request);
      return `${ip}:${request.method}:${path}`;
    },
    skipOnError: true,
    errorResponseBuilder: (_request, context) => {
      const error = new Error(`Rate limit exceeded. Try again in ${Math.max(1, Math.ceil(context.ttl / 1000))} seconds.`) as Error & {
        statusCode?: number
      };
      error.statusCode = context.statusCode;
      return error;
    }
  });
});
