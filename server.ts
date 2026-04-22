/*
Handoff note for Mr. Smith:
- File: `server.ts`
- What this is: Local/legacy server utility file.
- What it does: Supports local DB setup or basic server-side bootstrap behavior.
- Connections: Separate from the main backend stack but still relevant for local workflows.
- Main content type: Setup/runtime helper logic.
- Safe edits here: Local docs and non-breaking notes.
- Be careful with: Mixing assumptions with main backend runtime paths.
- Useful context: Looks older than the main stack; confirm active usage before major changes.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

const message = [
  'Legacy root server entrypoint is disabled.',
  'Use `npm run dev:backend` for the maintained backend service instead.',
].join(' ');

console.error(message);
process.exit(1);
