/*
Handoff note for Mr. Smith:
- File: `backend/src/plugins/cors.ts`
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
import cors from '@fastify/cors';
import { env, getAllowedOrigins } from '../lib/env.js';

export const CORS_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
export const CORS_ALLOWED_HEADERS = ['Content-Type', 'Authorization'];

export function isDevDynamicOrigin(origin: string): boolean {
  if (!origin) {
    return false;
  }

  try {
    const parsed = new URL(origin);
    return parsed.hostname.endsWith('.trycloudflare.com');
  } catch {
    return false;
  }
}

function isLocalOrigin(origin: string): boolean {
  if (!origin) {
    return false;
  }

  try {
    const parsed = new URL(origin);
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

export function isAllowedOrigin(origin: string, allowedOrigins: string[]): boolean {
  if (!origin) {
    return true;
  }

  if (allowedOrigins.includes(origin)) {
    return true;
  }

  if (env.NODE_ENV === 'production') {
    return false;
  }

  if (isLocalOrigin(origin)) {
    return true;
  }

  return env.CORS_ALLOW_DEV_TUNNEL_ORIGINS && isDevDynamicOrigin(origin);
}

export const corsPlugin = fp(async (app) => {
  const allowed = getAllowedOrigins();

  await app.register(cors, {
    origin: (origin, cb) => {
      cb(null, isAllowedOrigin(origin ?? '', allowed));
    },
    methods: CORS_METHODS,
    allowedHeaders: CORS_ALLOWED_HEADERS,
    credentials: true,
    preflightContinue: false,
    optionsSuccessStatus: 204,
    strictPreflight: false
  });
});
