import fp from 'fastify-plugin';
import type { FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';

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

function getClientIp(request: FastifyRequest): string {
  const cloudflareIp = normalizeIp(headerValue(request.headers['cf-connecting-ip']));
  if (cloudflareIp) return cloudflareIp;

  const forwarded = firstForwardedIp(headerValue(request.headers['x-forwarded-for']));
  if (forwarded) return forwarded;

  const realIp = normalizeIp(headerValue(request.headers['x-real-ip']));
  if (realIp) return realIp;

  return normalizeIp(request.ip || '') || 'unknown';
}

function getRequestPath(request: FastifyRequest): string {
  const routePath = request.routeOptions?.url || request.url || '/unknown';
  return routePath.split('?')[0] || '/unknown';
}

export const rateLimitPlugin = fp(async (app) => {
  await app.register(rateLimit, {
    global: true,
    hook: 'onRequest',
    max: 120,
    timeWindow: '1 minute',
    keyGenerator: (request) => {
      const ip = getClientIp(request);
      const path = getRequestPath(request);
      return `${ip}:${request.method}:${path}`;
    },
    skipOnError: true,
    errorResponseBuilder: (_request, context) => ({
      error: `Rate limit exceeded. Try again in ${Math.max(1, Math.ceil(context.ttl / 1000))} seconds.`
    })
  });
});
