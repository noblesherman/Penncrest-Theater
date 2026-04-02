import { prisma } from '../lib/prisma.js';
import { expireStalePendingCheckoutAttempts } from '../services/checkout-attempt-service.js';

async function run() {
  const expired = await expireStalePendingCheckoutAttempts();
  console.log(`Expired ${expired} stale pending checkout attempts`);
}

run()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
