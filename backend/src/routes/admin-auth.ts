import { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ensureBootstrapSuperAdmin, normalizeAdminUsername, serializeAdminUser } from '../lib/admin-users.js';
import { prisma } from '../lib/prisma.js';
import { verifyPassword } from '../lib/password.js';
import { encryptSecret, decryptSecret } from '../lib/secret-box.js';
import { verifyTotpCode } from '../lib/totp.js';

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  otpCode: z.string().optional()
});

const completeTwoFactorSetupSchema = z.object({
  setupToken: z.string().min(1),
  otpCode: z.string().min(1)
});

async function signAdminToken(reply: FastifyReply, admin: NonNullable<Awaited<ReturnType<typeof prisma.adminUser.findUnique>>>) {
  return reply.jwtSign(
    {
      role: 'admin',
      adminId: admin.id,
      adminRole: admin.role,
      username: admin.username
    },
    { expiresIn: '8h' }
  );
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

      const username = normalizeAdminUsername(parsed.data.username);
      const { password, otpCode } = parsed.data;

      let admin = await prisma.adminUser.findUnique({
        where: { username }
      });

      if (!admin) {
        await ensureBootstrapSuperAdmin();
        admin = await prisma.adminUser.findUnique({
          where: { username }
        });
      }

      if (!admin || !admin.isActive || !(await verifyPassword(password, admin.passwordHash))) {
        return reply.status(401).send({ error: 'Invalid credentials' });
      }

      if (admin.twoFactorEnabled) {
        if (!admin.twoFactorSecretEncrypted) {
          return reply.status(500).send({ error: 'Two-factor authentication is not configured correctly' });
        }

        const secret = decryptSecret(admin.twoFactorSecretEncrypted);
        if (!otpCode || !verifyTotpCode({ secret, code: otpCode })) {
          return reply.status(401).send({
            error: otpCode ? 'Invalid authentication code' : 'Authentication code required',
            twoFactorRequired: true
          });
        }
      }

      admin = await prisma.adminUser.update({
        where: { id: admin.id },
        data: { lastLoginAt: new Date() }
      });

      const token = await signAdminToken(reply, admin);

      return reply.send({
        token,
        admin: serializeAdminUser(admin)
      });
    }
  );

  app.post(
    '/api/admin/2fa/setup/complete',
    {
      config: {
        rateLimit: {
          max: 8,
          timeWindow: '5 minutes'
        }
      }
    },
    async (request, reply) => {
    const parsed = completeTwoFactorSetupSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const payload = await app.jwt.verify<{
        role: 'admin_setup';
        purpose: 'admin-2fa-setup';
        adminId: string;
        username: string;
        twoFactorSetupSecret: string;
      }>(parsed.data.setupToken);

      if (payload.role !== 'admin_setup' || payload.purpose !== 'admin-2fa-setup' || !payload.adminId || !payload.twoFactorSetupSecret) {
        return reply.status(401).send({ error: 'Invalid setup token' });
      }

      if (!verifyTotpCode({ secret: payload.twoFactorSetupSecret, code: parsed.data.otpCode })) {
        return reply.status(400).send({ error: 'Invalid authentication code' });
      }

      let admin = await prisma.adminUser.findUnique({
        where: { id: payload.adminId }
      });

      if (!admin || !admin.isActive) {
        return reply.status(404).send({ error: 'Admin account not found' });
      }

      admin = await prisma.adminUser.update({
        where: { id: admin.id },
        data: {
          twoFactorEnabled: true,
          twoFactorSecretEncrypted: encryptSecret(payload.twoFactorSetupSecret),
          lastLoginAt: new Date()
        }
      });

      const token = await signAdminToken(reply, admin);

      return reply.send({
        token,
        admin: serializeAdminUser(admin)
      });
    } catch {
      return reply.status(401).send({ error: 'Invalid or expired setup token' });
    }
    }
  );

  app.get('/api/admin/me', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    reply.send(serializeAdminUser(request.adminUser!));
  });
};
