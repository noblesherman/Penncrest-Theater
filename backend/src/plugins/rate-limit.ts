import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';

export const rateLimitPlugin = fp(async (app) => {
  await app.register(rateLimit, {
    global: false,
    max: 100,
    timeWindow: '1 minute',
    errorResponseBuilder: (_request, context) => ({
      error: `Rate limit exceeded. Try again in ${Math.max(1, Math.ceil(context.ttl / 1000))} seconds.`
    })
  });
});
