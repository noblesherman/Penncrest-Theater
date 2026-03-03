import crypto from 'node:crypto';
import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { env } from '../lib/env.js';

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1)
});

function secureCompare(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export const adminAuthRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/api/admin/login',
    {
      config: {
        rateLimit: {
          max: 8,
          timeWindow: '1 minute'
        }
      }
    },
    async (request, reply) => {
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      const { username, password } = parsed.data;
      if (!secureCompare(username, env.ADMIN_USERNAME) || !secureCompare(password, env.ADMIN_PASSWORD)) {
        return reply.status(401).send({ error: 'Invalid credentials' });
      }

      const token = await reply.jwtSign({ username: env.ADMIN_USERNAME, role: 'admin' }, { expiresIn: '8h' });
      return reply.send({ token });
    }
  );

  app.get('/api/admin/me', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    reply.send({
      username: request.user.username || env.ADMIN_USERNAME,
      role: request.user.role
    });
  });
};
