/*
Handoff note for Mr. Smith:
- File: `apps/api/src/server.ts`
- What this is: Secondary API support module.
- What it does: Provides config/errors/validation/bootstrap pieces for the Express app.
- Connections: Supports route/service execution inside `apps/api/src`.
- Main content type: Config/types/infrastructure logic.
- Safe edits here: Additive validation and documentation updates.
- Be careful with: Env parsing and shared type changes used broadly.
- Useful context: Helpful context when maintaining both API stacks in parallel.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

const message = [
  'Legacy apps/api server is decommissioned.',
  'Use `npm --prefix backend run dev` or `npm run dev:backend` for the canonical backend service.',
].join(' ');

console.error(message);
process.exit(1);
