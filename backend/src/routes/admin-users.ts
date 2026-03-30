import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { handleRouteError } from '../lib/route-error.js';
import { HttpError } from '../lib/http-error.js';
import { hashPassword } from '../lib/password.js';
import { normalizeAdminUsername, serializeAdminUser } from '../lib/admin-users.js';
import { logAudit } from '../lib/audit-log.js';

const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(40)
  .regex(/^[a-z0-9._-]+$/i, 'Username can only contain letters, numbers, dots, hyphens, and underscores');

const passwordSchema = z.string().min(8).max(120);

const createAdminUserSchema = z.object({
  username: usernameSchema,
  name: z.string().trim().min(1).max(120),
  password: passwordSchema,
  role: z.enum(['BOX_OFFICE', 'ADMIN', 'SUPER_ADMIN'])
});

const updateAdminUserSchema = z
  .object({
    username: usernameSchema.optional(),
    name: z.string().trim().min(1).max(120).optional(),
    role: z.enum(['BOX_OFFICE', 'ADMIN', 'SUPER_ADMIN']).optional(),
    isActive: z.boolean().optional()
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), 'Provide at least one field to update');

const resetPasswordSchema = z.object({
  password: passwordSchema
});

async function assertSuperAdminSafety(targetId: string, nextRole?: 'BOX_OFFICE' | 'ADMIN' | 'SUPER_ADMIN', nextActive?: boolean) {
  const target = await prisma.adminUser.findUnique({
    where: { id: targetId }
  });

  if (!target) {
    throw new HttpError(404, 'User not found');
  }

  const removesSuperAdmin = target.role === 'SUPER_ADMIN' && nextRole && nextRole !== 'SUPER_ADMIN';
  const deactivatesSuperAdmin = target.role === 'SUPER_ADMIN' && nextActive === false;

  if (!removesSuperAdmin && !deactivatesSuperAdmin) {
    return target;
  }

  const superAdminCount = await prisma.adminUser.count({
    where: {
      role: 'SUPER_ADMIN',
      isActive: true
    }
  });

  if (superAdminCount <= 1) {
    throw new HttpError(400, 'You must keep at least one active super admin.');
  }

  return target;
}

export const adminUserRoutes: FastifyPluginAsync = async (app) => {
  const adminActor = (request: { adminUser?: { username: string; id: string } }) => ({
    actor: request.adminUser?.username || 'super-admin',
    actorAdminId: request.adminUser?.id || null
  });

  app.get('/api/admin/users', { preHandler: app.requireAdminRole('SUPER_ADMIN') }, async (_request, reply) => {
    try {
      const rows = await prisma.adminUser.findMany({
        orderBy: [{ role: 'desc' }, { createdAt: 'asc' }]
      });

      reply.send(rows.map((row) => serializeAdminUser(row)));
    } catch (err) {
      handleRouteError(reply, err, 'Failed to load admin users');
    }
  });

  app.post('/api/admin/users', { preHandler: app.requireAdminRole('SUPER_ADMIN') }, async (request, reply) => {
    const parsed = createAdminUserSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const created = await prisma.adminUser.create({
        data: {
          username: normalizeAdminUsername(parsed.data.username),
          name: parsed.data.name.trim(),
          passwordHash: await hashPassword(parsed.data.password),
          role: parsed.data.role
        }
      });

      await logAudit({
        ...adminActor(request),
        action: 'ADMIN_USER_CREATED',
        entityType: 'AdminUser',
        entityId: created.id,
        metadata: {
          username: created.username,
          role: created.role
        }
      });

      reply.status(201).send(serializeAdminUser(created));
    } catch (err) {
      handleRouteError(reply, err, 'Failed to create admin user');
    }
  });

  app.patch('/api/admin/users/:id', { preHandler: app.requireAdminRole('SUPER_ADMIN') }, async (request, reply) => {
    const params = request.params as { id: string };
    const parsed = updateAdminUserSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      await assertSuperAdminSafety(params.id, parsed.data.role, parsed.data.isActive);

      const updated = await prisma.adminUser.update({
        where: { id: params.id },
        data: {
          username:
            parsed.data.username !== undefined ? normalizeAdminUsername(parsed.data.username) : undefined,
          name: parsed.data.name?.trim(),
          role: parsed.data.role,
          isActive: parsed.data.isActive
        }
      });

      await logAudit({
        ...adminActor(request),
        action: 'ADMIN_USER_UPDATED',
        entityType: 'AdminUser',
        entityId: updated.id,
        metadata: parsed.data
      });

      reply.send(serializeAdminUser(updated));
    } catch (err) {
      handleRouteError(reply, err, 'Failed to update admin user');
    }
  });

  app.post(
    '/api/admin/users/:id/reset-password',
    { preHandler: app.requireAdminRole('SUPER_ADMIN') },
    async (request, reply) => {
      const params = request.params as { id: string };
      const parsed = resetPasswordSchema.safeParse(request.body || {});
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      try {
        const target = await prisma.adminUser.findUnique({
          where: { id: params.id }
        });
        if (!target) {
          throw new HttpError(404, 'User not found');
        }

        await prisma.adminUser.update({
          where: { id: params.id },
          data: {
            passwordHash: await hashPassword(parsed.data.password)
          }
        });

        await logAudit({
          ...adminActor(request),
          action: 'ADMIN_USER_PASSWORD_RESET',
          entityType: 'AdminUser',
          entityId: target.id
        });

        reply.send({ success: true });
      } catch (err) {
        handleRouteError(reply, err, 'Failed to reset password');
      }
    }
  );

  app.post('/api/admin/users/:id/reset-2fa', { preHandler: app.requireAdminRole('SUPER_ADMIN') }, async (request, reply) => {
    const params = request.params as { id: string };

    try {
      const target = await prisma.adminUser.findUnique({
        where: { id: params.id }
      });
      if (!target) {
        throw new HttpError(404, 'User not found');
      }

      await prisma.adminUser.update({
        where: { id: target.id },
        data: {
          twoFactorEnabled: false,
          twoFactorSecretEncrypted: null
        }
      });

      await logAudit({
        ...adminActor(request),
        action: 'ADMIN_USER_2FA_RESET',
        entityType: 'AdminUser',
        entityId: target.id
      });

      reply.send({ success: true });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to reset two-factor authentication');
    }
  });
};
