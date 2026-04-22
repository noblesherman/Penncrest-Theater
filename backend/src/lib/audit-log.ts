/*
Handoff note for Mr. Smith:
- File: `backend/src/lib/audit-log.ts`
- What this is: Backend shared utility module.
- What it does: Provides reusable helpers for auth, crypto, storage, content, and data transforms.
- Connections: Imported by routes/services/jobs across the backend.
- Main content type: Shared behavior/utilities.
- Safe edits here: Additive helpers and local docs with stable exports.
- Be careful with: Changing helper semantics used by multiple domains.
- Useful context: Cross-feature bugs often trace back to a shared lib helper like this.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

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
