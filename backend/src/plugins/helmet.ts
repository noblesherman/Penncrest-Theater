import fp from 'fastify-plugin';
import helmet from '@fastify/helmet';

export const helmetPlugin = fp(async (app) => {
  await app.register(helmet, {
    global: true
  });
});
