/*
Handoff note for Mr. Smith:
- File: `backend/src/lib/qr.ts`
- What this is: Backend shared utility module.
- What it does: Provides reusable helpers for auth, crypto, storage, content, and data transforms.
- Connections: Imported by routes/services/jobs across the backend.
- Main content type: Shared behavior/utilities.
- Safe edits here: Additive helpers and local docs with stable exports.
- Be careful with: Changing helper semantics used by multiple domains.
- Useful context: Cross-feature bugs often trace back to a shared lib helper like this.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import crypto from 'node:crypto';

export function createTicketSignature(ticketId: string, qrSecret: string): string {
  return crypto.createHmac('sha256', qrSecret).update(ticketId).digest('base64url').slice(0, 16);
}

export function buildQrPayload(ticketId: string, qrSecret: string): string {
  const signature = createTicketSignature(ticketId, qrSecret);
  return `${ticketId}.${signature}`;
}
