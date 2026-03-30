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
    const isLocalHost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    const isTryCloudflare = parsed.hostname.endsWith('.trycloudflare.com');
    return isLocalHost || isTryCloudflare;
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

  return env.NODE_ENV !== 'production' && isDevDynamicOrigin(origin);
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
