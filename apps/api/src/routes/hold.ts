/*
Handoff note for Mr. Smith:
- File: `apps/api/src/routes/hold.ts`
- What this is: Express route module (secondary API app).
- What it does: Maps endpoint paths to handlers for this lighter API service.
- Connections: Mounted by `apps/api/src/server.ts` and delegates to service modules.
- Main content type: Thin HTTP routing and middleware wiring.
- Safe edits here: Route docs and non-breaking middleware notes.
- Be careful with: Webhook/raw-body handling and route contract changes.
- Useful context: This stack looks more minimal/legacy, so contract edits should be deliberate.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { Router } from 'express';
import { holdController } from '../services/hold-service.js';

export const router = Router();

router.post('/performances/:id/hold', holdController.createHold);
router.post('/holds/:holdId/release', holdController.releaseHold);
