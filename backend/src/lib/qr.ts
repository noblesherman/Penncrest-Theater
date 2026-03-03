import crypto from 'node:crypto';

export function createTicketSignature(ticketId: string, qrSecret: string): string {
  return crypto.createHmac('sha256', qrSecret).update(ticketId).digest('base64url').slice(0, 16);
}

export function buildQrPayload(ticketId: string, qrSecret: string): string {
  const signature = createTicketSignature(ticketId, qrSecret);
  return `${ticketId}.${signature}`;
}
