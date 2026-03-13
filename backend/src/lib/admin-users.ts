import type { AdminRole, AdminUser } from '@prisma/client';
import { env } from './env.js';
import { prisma } from './prisma.js';
import { hashPassword } from './password.js';

const roleRank: Record<AdminRole, number> = {
  BOX_OFFICE: 1,
  ADMIN: 2,
  SUPER_ADMIN: 3
};

export function normalizeAdminUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function hasAdminRole(role: AdminRole, minimumRole: AdminRole): boolean {
  return roleRank[role] >= roleRank[minimumRole];
}

export function serializeAdminUser(admin: AdminUser) {
  return {
    id: admin.id,
    username: admin.username,
    name: admin.name,
    role: admin.role,
    isActive: admin.isActive,
    twoFactorEnabled: admin.twoFactorEnabled,
    lastLoginAt: admin.lastLoginAt,
    createdAt: admin.createdAt,
    updatedAt: admin.updatedAt
  };
}

export async function ensureBootstrapSuperAdmin(): Promise<AdminUser> {
  const existing = await prisma.adminUser.findFirst({
    orderBy: { createdAt: 'asc' }
  });
  if (existing) {
    return existing;
  }

  const username = normalizeAdminUsername(env.ADMIN_USERNAME);
  const passwordHash = await hashPassword(env.ADMIN_PASSWORD);

  try {
    return await prisma.adminUser.create({
      data: {
        username,
        name: 'Central Admin',
        passwordHash,
        role: 'SUPER_ADMIN'
      }
    });
  } catch {
    const created = await prisma.adminUser.findUnique({
      where: { username }
    });
    if (!created) {
      throw new Error('Failed to bootstrap the initial super admin');
    }
    return created;
  }
}
