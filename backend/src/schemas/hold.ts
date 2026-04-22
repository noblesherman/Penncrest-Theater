/*
Handoff note for Mr. Smith:
- File: `backend/src/schemas/hold.ts`
- What this is: Backend validation schema module.
- What it does: Defines typed input constraints for route payloads.
- Connections: Referenced by route handlers and service input guards.
- Main content type: Schema/type declarations.
- Safe edits here: Additive optional fields and docs comments.
- Be careful with: Required-field or shape changes that break clients.
- Useful context: Contract edits here should be coordinated with frontend/mobile callers.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { z } from 'zod';

export const holdRequestSchema = z.object({
  performanceId: z.string().min(1),
  seatIds: z.array(z.string().min(1)).max(50),
  clientToken: z.string().min(8)
});
