import fp from 'fastify-plugin';
import jwt from '@fastify/jwt';
import { env } from '../lib/env.js';

export const jwtPlugin = fp(async (app) => {
  await app.register(jwt, { secret: env.JWT_SECRET });
});
