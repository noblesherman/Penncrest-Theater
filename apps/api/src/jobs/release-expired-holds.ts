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
