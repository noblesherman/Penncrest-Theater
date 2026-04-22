/*
Handoff note for Mr. Smith:
- File: `apps/api/src/lib/prisma.ts`
- What this is: Secondary API support module.
- What it does: Provides config/errors/validation/bootstrap pieces for the Express app.
- Connections: Supports route/service execution inside `apps/api/src`.
- Main content type: Config/types/infrastructure logic.
- Safe edits here: Additive validation and documentation updates.
- Be careful with: Env parsing and shared type changes used broadly.
- Useful context: Helpful context when maintaining both API stacks in parallel.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'warn', 'error'] : ['warn', 'error']
});

process.on('beforeExit', async () => {
  await prisma.$disconnect();
});
