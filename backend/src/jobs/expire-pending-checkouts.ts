/*
Handoff note for Mr. Smith:
- File: `backend/src/jobs/expire-pending-checkouts.ts`
- What this is: Backend scheduled job module.
- What it does: Runs periodic maintenance tasks like cleanup/expiry handling.
- Connections: Triggered by worker schedules and uses shared DB/service logic.
- Main content type: Background operational logic.
- Safe edits here: Log messaging and guard-rail comments.
- Be careful with: Record selection/update criteria that can affect lots of rows.
- Useful context: If stale holds or pending states accumulate, this layer is critical.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

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
