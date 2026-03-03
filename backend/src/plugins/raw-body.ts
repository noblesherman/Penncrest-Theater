import fp from 'fastify-plugin';
import rawBody from 'fastify-raw-body';

export const rawBodyPlugin = fp(async (app) => {
  await app.register(rawBody, {
    global: false,
    field: 'rawBody',
    encoding: false,
    runFirst: true
  });
});
