import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';

export const rateLimitPlugin = fp(async (app) => {
  await app.register(rateLimit, {
    global: false,
    max: 100,
    timeWindow: '1 minute'
  });
});
