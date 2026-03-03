import { prisma } from '../lib/prisma.js';
import { releaseExpiredHolds } from '../services/hold-service.js';

async function run() {
  const released = await releaseExpiredHolds();
  console.log(`Released ${released} expired hold sessions`);
}

run()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
