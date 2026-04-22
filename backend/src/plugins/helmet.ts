/*
Handoff note for Mr. Smith:
- File: `backend/src/plugins/helmet.ts`
- What this is: Fastify plugin module.
- What it does: Configures shared request lifecycle behavior (auth/security/rate limits/etc).
- Connections: Loaded early in server bootstrap before route registration.
- Main content type: Cross-cutting server configuration.
- Safe edits here: Documentation notes and conservative config explanation updates.
- Be careful with: Default values that affect every request across the backend.
- Useful context: If requests fail before route handlers run, inspect plugins first.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import fp from 'fastify-plugin';
import helmet from '@fastify/helmet';

export const helmetPlugin = fp(async (app) => {
  await app.register(helmet, {
    global: true
  });
});
