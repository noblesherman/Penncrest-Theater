import fp from 'fastify-plugin';
import cors from '@fastify/cors';
import { getAllowedOrigins } from '../lib/env.js';

export const corsPlugin = fp(async (app) => {
  const allowed = getAllowedOrigins();

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) {
        cb(null, true);
        return;
      }
      cb(null, allowed.includes(origin));
    },
    credentials: true
  });
});
