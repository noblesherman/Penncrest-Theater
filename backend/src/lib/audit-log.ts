import { prisma } from './prisma.js';

export async function logAudit(params: {
  actor: string;
  actorUserId?: string | null;
  actorAdminId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: unknown;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actor: params.actor,
      actorUserId: params.actorUserId || null,
      actorAdminId: params.actorAdminId || null,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      meta: params.metadata as any,
      metadataJson: params.metadata as any
    }
  });
}
