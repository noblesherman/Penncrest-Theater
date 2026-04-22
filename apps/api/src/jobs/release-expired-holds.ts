/*
Handoff note for Mr. Smith:
- File: `apps/api/src/jobs/release-expired-holds.ts`
- What this is: Secondary API support module.
- What it does: Provides config/errors/validation/bootstrap pieces for the Express app.
- Connections: Supports route/service execution inside `apps/api/src`.
- Main content type: Config/types/infrastructure logic.
- Safe edits here: Additive validation and documentation updates.
- Be careful with: Env parsing and shared type changes used broadly.
- Useful context: Helpful context when maintaining both API stacks in parallel.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { prisma } from '../lib/prisma.js';

async function releaseExpired() {
  const now = new Date();
  const expired = await prisma.hold.findMany({
    where: { status: 'ACTIVE', expiresAt: { lt: now } },
    select: { id: true }
  });

  for (const hold of expired) {
    await prisma.$transaction(async (tx) => {
      await tx.performanceSeatState.updateMany({ where: { holdId: hold.id }, data: { state: 'AVAILABLE', holdId: null } });
      await tx.hold.update({ where: { id: hold.id }, data: { status: 'RELEASED' } });
    });
  }

  console.log(`Released ${expired.length} expired holds`);
}

releaseExpired()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
