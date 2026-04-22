/*
Handoff note for Mr. Smith:
- File: `backend/src/plugins/rate-limit.ts`
- What this is: Fastify plugin module.
- What it does: Configures shared request lifecycle behavior (auth/security/rate limits/etc).
- Connections: Loaded early in server bootstrap before route registration.
- Main content type: Cross-cutting server configuration.
- Safe edits here: Documentation notes and conservative config explanation updates.
- Be careful with: Default values that affect every request across the backend.
- Useful context: If requests fail before route handlers run, inspect plugins first.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

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
