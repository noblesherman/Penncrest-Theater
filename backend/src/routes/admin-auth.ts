/*
Handoff note for Mr. Smith:
- File: `backend/src/routes/admin-auth.ts`
- What this is: Fastify route module.
- What it does: Defines HTTP endpoints and route-level request handling for one domain area.
- Connections: Registered by backend server bootstrap; calls services/lib helpers and Prisma.
- Main content type: HTTP logic + auth guards + response shaping.
- Safe edits here: Response wording and non-breaking diagnostics.
- Be careful with: Auth hooks, schema contracts, and transactional behavior.
- Useful context: If frontend/mobile API calls fail after changes, contract drift often starts here.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { FastifyPluginAsync, FastifyReply } from 'fastify';
import { z } from 'zod';
import { ensureBootstrapSuperAdmin, normalizeAdminUsername, serializeAdminUser } from '../lib/admin-users.js';
import { prisma } from '../lib/prisma.js';
import { verifyPassword } from '../lib/password.js';
import { encryptSecret, decryptSecret } from '../lib/secret-box.js';
import { buildOtpAuthUrl, formatTotpSecret, generateTotpSecret, verifyTotpCode } from '../lib/totp.js';

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  otpCode: z.string().optional(),
  rememberMe: z.boolean().optional()
});

const completeTwoFactorSetupSchema = z.object({
  setupToken: z.string().min(1),
  otpCode: z.string().min(1),
  rememberMe: z.boolean().optional()
});

async function signAdminToken(
  reply: FastifyReply,
  admin: NonNullable<Awaited<ReturnType<typeof prisma.adminUser.findUnique>>>,
  options?: { rememberMe?: boolean }
) {
  return reply.jwtSign(
    {
      role: 'admin',
      adminId: admin.id,
      adminRole: admin.role,
      username: admin.username
    },
    { expiresIn: options?.rememberMe ? '30d' : '8h' }
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
      const { password, otpCode, rememberMe } = parsed.data;

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

      if (admin.role === 'BOX_OFFICE' && (admin.twoFactorEnabled || Boolean(admin.twoFactorSecretEncrypted))) {
        admin = await prisma.adminUser.update({
          where: { id: admin.id },
          data: {
            twoFactorEnabled: false,
            twoFactorSecretEncrypted: null
          }
        });
      }

      const requiresTwoFactorCheck = admin.role !== 'BOX_OFFICE' && admin.twoFactorEnabled;

      if (requiresTwoFactorCheck) {
        if (!admin.twoFactorSecretEncrypted) {
          const candidateSecret = generateTotpSecret();
          const candidateSecretEncrypted = encryptSecret(candidateSecret);

          await prisma.adminUser.updateMany({
            where: {
              id: admin.id,
              twoFactorSecretEncrypted: null
            },
            data: {
              twoFactorSecretEncrypted: candidateSecretEncrypted
            }
          });

          const refreshedAdmin = await prisma.adminUser.findUnique({
            where: { id: admin.id }
          });

          if (!refreshedAdmin?.twoFactorSecretEncrypted) {
            return reply.status(500).send({ error: 'Two-factor authentication setup could not be started' });
          }

          admin = refreshedAdmin;
          const setupSecret = decryptSecret(refreshedAdmin.twoFactorSecretEncrypted);
          const setupToken = await app.jwt.sign(
            {
              role: 'admin_setup',
              purpose: 'admin-2fa-setup',
              adminId: admin.id,
              username: admin.username
            },
            { expiresIn: '15m' }
          );

          return reply.send({
            twoFactorSetupRequired: true,
            setupToken,
            manualEntryKey: formatTotpSecret(setupSecret),
            otpAuthUrl: buildOtpAuthUrl({
              issuer: 'Penncrest Theater Admin',
              accountName: admin.username,
              secret: setupSecret
            }),
            admin: serializeAdminUser(admin)
          });
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

      const token = await signAdminToken(reply, admin, { rememberMe });

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
      }>(parsed.data.setupToken);

      if (payload.role !== 'admin_setup' || payload.purpose !== 'admin-2fa-setup' || !payload.adminId) {
        return reply.status(401).send({ error: 'Invalid setup token' });
      }

      let admin = await prisma.adminUser.findUnique({
        where: { id: payload.adminId }
      });

      if (!admin || !admin.isActive) {
        return reply.status(404).send({ error: 'Admin account not found' });
      }

      if (admin.role === 'BOX_OFFICE') {
        return reply.status(403).send({ error: 'Two-factor authentication is not enabled for box office accounts' });
      }

      if (!admin.twoFactorSecretEncrypted) {
        return reply.status(400).send({ error: 'Two-factor setup has expired. Sign in again to restart setup.' });
      }

      const secret = decryptSecret(admin.twoFactorSecretEncrypted);
      if (!verifyTotpCode({ secret, code: parsed.data.otpCode })) {
        return reply.status(400).send({ error: 'Invalid authentication code' });
      }

      admin = await prisma.adminUser.update({
        where: { id: admin.id },
        data: {
          twoFactorEnabled: true,
          lastLoginAt: new Date()
        }
      });

      const token = await signAdminToken(reply, admin, { rememberMe: parsed.data.rememberMe });

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
