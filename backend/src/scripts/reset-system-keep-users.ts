/*
Handoff note for Mr. Smith:
- File: `backend/src/scripts/reset-system-keep-users.ts`
- What this is: Backend maintenance script.
- What it does: Executes one-off operational tasks against backend data/services.
- Connections: Run manually outside the normal HTTP request path.
- Main content type: Direct side-effect logic.
- Safe edits here: Dry-run messaging and safety comments.
- Be careful with: Bulk change filters and environment targeting.
- Useful context: Treat this as a power tool: verify scope/environment before running.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import '../lib/load-env.js';
import { prisma } from '../lib/prisma.js';

const CONFIRMATION_TOKEN = 'WIPE_NON_USER_DATA';
const DEFAULT_KEEP_TABLES = ['User', 'AdminUser'];
const PRISMA_MIGRATIONS_TABLE = '_prisma_migrations';

type CliFlags = {
  yes: boolean;
  dryRun: boolean;
};

function parseFlags(argv: string[]): CliFlags {
  return {
    yes: argv.includes('--yes'),
    dryRun: argv.includes('--dry-run')
  };
}

function parseKeepTables(): string[] {
  const raw = process.env.KEEP_TABLES?.trim();
  if (!raw) {
    return [...DEFAULT_KEEP_TABLES];
  }

  const parsed = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (parsed.length === 0) {
    return [...DEFAULT_KEEP_TABLES];
  }

  return [...new Set(parsed)];
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const keepTables = parseKeepTables();
  const keepSet = new Set([...keepTables, PRISMA_MIGRATIONS_TABLE]);

  if (!flags.yes || process.env.RESET_CONFIRM !== CONFIRMATION_TOKEN) {
    console.error('Refusing to run destructive reset without explicit confirmation.');
    console.error('This command deletes all data except selected user tables.');
    console.error('');
    console.error('Required:');
    console.error(`1) pass --yes`);
    console.error(`2) set RESET_CONFIRM=${CONFIRMATION_TOKEN}`);
    console.error('');
    console.error(`Example: RESET_CONFIRM=${CONFIRMATION_TOKEN} npm run reset:system:keep-users -- --yes`);
    console.error(`Optional: KEEP_TABLES=User,AdminUser`);
    process.exit(1);
  }

  const schemaRows = await prisma.$queryRaw<Array<{ schema_name: string }>>`SELECT current_schema() AS schema_name`;
  const currentSchema = schemaRows[0]?.schema_name;
  if (!currentSchema) {
    throw new Error('Could not determine current schema.');
  }

  const tableRows = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = current_schema()
  `;

  const allTables = tableRows.map((row) => row.tablename);
  const wipeTables = allTables.filter((tableName) => !keepSet.has(tableName));

  console.log(`Schema: ${currentSchema}`);
  console.log(`Keeping tables: ${[...keepSet].join(', ')}`);
  console.log(`Wiping ${wipeTables.length} table(s): ${wipeTables.join(', ') || '(none)'}`);

  if (wipeTables.length === 0) {
    console.log('No tables matched wipe criteria.');
    return;
  }

  const truncateSql = `TRUNCATE TABLE ${wipeTables
    .map((tableName) => `${quoteIdentifier(currentSchema)}.${quoteIdentifier(tableName)}`)
    .join(', ')} RESTART IDENTITY CASCADE`;

  if (flags.dryRun) {
    console.log('Dry run enabled. SQL was not executed.');
    console.log(truncateSql);
    return;
  }

  await prisma.$executeRawUnsafe(truncateSql);
  console.log('Reset complete.');
}

main()
  .catch((err) => {
    console.error('Reset failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
