import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';

export const rateLimitPlugin = fp(async (app) => {
  await app.register(rateLimit, {
    global: true,
    hook: 'onRequest',
    max: 120,
    timeWindow: '1 minute',
    skipOnError: true,
    errorResponseBuilder: (_request, context) => ({
      error: `Rate limit exceeded. Try again in ${Math.max(1, Math.ceil(context.ttl / 1000))} seconds.`
    })
  });
});
