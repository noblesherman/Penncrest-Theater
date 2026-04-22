/*
Handoff note for Mr. Smith:
- File: `backend/src/lib/client-ip.ts`
- What this is: Backend shared utility module.
- What it does: Provides reusable helpers for auth, crypto, storage, content, and data transforms.
- Connections: Imported by routes/services/jobs across the backend.
- Main content type: Shared behavior/utilities.
- Safe edits here: Additive helpers and local docs with stable exports.
- Be careful with: Changing helper semantics used by multiple domains.
- Useful context: Cross-feature bugs often trace back to a shared lib helper like this.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import type { FastifyRequest } from 'fastify';

function headerValue(header: string | string[] | undefined): string {
  if (!header) return '';
  return Array.isArray(header) ? (header[0] || '') : header;
}

function normalizeIp(rawValue: string): string {
  return rawValue.trim().replace(/^::ffff:/, '').toLowerCase();
}

function firstForwardedIp(rawForwardedFor: string): string {
  const first = rawForwardedFor
    .split(',')
    .map((part) => part.trim())
    .find(Boolean);

  return first ? normalizeIp(first) : '';
}

export function getClientIp(request: FastifyRequest): string {
  const cloudflareIp = normalizeIp(headerValue(request.headers['cf-connecting-ip']));
  if (cloudflareIp) return cloudflareIp;

  const forwarded = firstForwardedIp(headerValue(request.headers['x-forwarded-for']));
  if (forwarded) return forwarded;

  const realIp = normalizeIp(headerValue(request.headers['x-real-ip']));
  if (realIp) return realIp;

  return normalizeIp(request.ip || '') || 'unknown';
}

export function getRequestPath(request: FastifyRequest): string {
  const routePath = request.routeOptions?.url || request.url || '/unknown';
  return routePath.split('?')[0] || '/unknown';
}

