/*
Handoff note for Mr. Smith:
- File: `backend/src/lib/admin-users.ts`
- What this is: Backend shared utility module.
- What it does: Provides reusable helpers for auth, crypto, storage, content, and data transforms.
- Connections: Imported by routes/services/jobs across the backend.
- Main content type: Shared behavior/utilities.
- Safe edits here: Additive helpers and local docs with stable exports.
- Be careful with: Changing helper semantics used by multiple domains.
- Useful context: Cross-feature bugs often trace back to a shared lib helper like this.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

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
      throw new Error('We hit a small backstage snag while trying to bootstrap the initial super admin');
    }
    return created;
  }
}
