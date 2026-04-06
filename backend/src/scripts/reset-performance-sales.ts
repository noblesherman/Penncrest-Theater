import '../lib/load-env.js';
import type { SeatStatus } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

const CONFIRMATION_TOKEN = 'WIPE_PERFORMANCE_SALES';

type CliFlags = {
  yes: boolean;
  dryRun: boolean;
  includeBlocked: boolean;
  performanceId?: string;
};

function parseFlags(argv: string[]): CliFlags {
  const performanceIdArg = argv.find((arg) => arg.startsWith('--performanceId='));

  return {
    yes: argv.includes('--yes'),
    dryRun: argv.includes('--dry-run'),
    includeBlocked: argv.includes('--include-blocked'),
    performanceId: performanceIdArg ? performanceIdArg.slice('--performanceId='.length).trim() : undefined
  };
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const performanceId = flags.performanceId || process.env.PERFORMANCE_ID?.trim();

  if (!performanceId) {
    console.error('Missing performance id.');
    console.error('Provide one of:');
    console.error('1) --performanceId=<id>');
    console.error('2) PERFORMANCE_ID=<id>');
    process.exit(1);
  }

  if (!flags.yes || process.env.RESET_CONFIRM !== CONFIRMATION_TOKEN) {
    console.error('Refusing to run destructive reset without explicit confirmation.');
    console.error('This command only resets sales/holds/queue for ONE performance id.');
    console.error('');
    console.error('Required:');
    console.error('1) pass --yes');
    console.error(`2) set RESET_CONFIRM=${CONFIRMATION_TOKEN}`);
    console.error('');
    console.error(
      `Example: RESET_CONFIRM=${CONFIRMATION_TOKEN} PERFORMANCE_ID=${performanceId} npm run reset:performance:sales -- --yes`
    );
    process.exit(1);
  }

  const performance = await prisma.performance.findUnique({
    where: { id: performanceId },
    select: {
      id: true,
      title: true,
      startsAt: true,
      show: { select: { title: true } }
    }
  });

  if (!performance) {
    console.error(`Performance not found: ${performanceId}`);
    process.exit(1);
  }

  const [ordersBefore, holdsBefore, queueBefore, soldBefore, heldBefore, blockedBefore] = await Promise.all([
    prisma.order.count({ where: { performanceId } }),
    prisma.holdSession.count({ where: { performanceId } }),
    prisma.checkoutQueueItem.count({ where: { performanceId } }),
    prisma.seat.count({ where: { performanceId, status: 'SOLD' } }),
    prisma.seat.count({ where: { performanceId, status: 'HELD' } }),
    prisma.seat.count({ where: { performanceId, status: 'BLOCKED' } })
  ]);

  console.log(`Performance: ${performance.id}`);
  console.log(`Show: ${performance.show.title}`);
  console.log(`Performance title: ${performance.title || '(untitled)'}`);
  console.log(`Starts at: ${performance.startsAt.toISOString()}`);
  console.log('');
  console.log('Before reset:');
  console.log(`- Orders: ${ordersBefore}`);
  console.log(`- Hold sessions: ${holdsBefore}`);
  console.log(`- Queue items: ${queueBefore}`);
  console.log(`- Seats SOLD: ${soldBefore}`);
  console.log(`- Seats HELD: ${heldBefore}`);
  console.log(`- Seats BLOCKED: ${blockedBefore}`);
  console.log(
    `- Seat statuses to reset: ${flags.includeBlocked ? 'HELD,SOLD,BLOCKED' : 'HELD,SOLD'} -> AVAILABLE`
  );

  if (flags.dryRun) {
    console.log('');
    console.log('Dry run enabled. No changes were written.');
    return;
  }

  const resetStatuses: SeatStatus[] = flags.includeBlocked ? ['HELD', 'SOLD', 'BLOCKED'] : ['HELD', 'SOLD'];

  const result = await prisma.$transaction(async (tx) => {
    const queueDeleted = await tx.checkoutQueueItem.deleteMany({ where: { performanceId } });
    const holdsDeleted = await tx.holdSession.deleteMany({ where: { performanceId } });
    const ordersDeleted = await tx.order.deleteMany({ where: { performanceId } });
    const seatsReset = await tx.seat.updateMany({
      where: {
        performanceId,
        status: { in: resetStatuses }
      },
      data: {
        status: 'AVAILABLE',
        holdSessionId: null
      }
    });

    return {
      queueDeleted: queueDeleted.count,
      holdsDeleted: holdsDeleted.count,
      ordersDeleted: ordersDeleted.count,
      seatsReset: seatsReset.count
    };
  });

  const [ordersAfter, holdsAfter, queueAfter, soldAfter, heldAfter, blockedAfter] = await Promise.all([
    prisma.order.count({ where: { performanceId } }),
    prisma.holdSession.count({ where: { performanceId } }),
    prisma.checkoutQueueItem.count({ where: { performanceId } }),
    prisma.seat.count({ where: { performanceId, status: 'SOLD' } }),
    prisma.seat.count({ where: { performanceId, status: 'HELD' } }),
    prisma.seat.count({ where: { performanceId, status: 'BLOCKED' } })
  ]);

  console.log('');
  console.log('Reset complete.');
  console.log(`- Queue items deleted: ${result.queueDeleted}`);
  console.log(`- Hold sessions deleted: ${result.holdsDeleted}`);
  console.log(`- Orders deleted: ${result.ordersDeleted}`);
  console.log(`- Seats reset to AVAILABLE: ${result.seatsReset}`);
  console.log('');
  console.log('After reset:');
  console.log(`- Orders: ${ordersAfter}`);
  console.log(`- Hold sessions: ${holdsAfter}`);
  console.log(`- Queue items: ${queueAfter}`);
  console.log(`- Seats SOLD: ${soldAfter}`);
  console.log(`- Seats HELD: ${heldAfter}`);
  console.log(`- Seats BLOCKED: ${blockedAfter}`);
}

main()
  .catch((err) => {
    console.error('Reset failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
