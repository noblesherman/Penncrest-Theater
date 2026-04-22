/*
Handoff note for Mr. Smith:
- File: `backend/src/routes/auth.ts`
- What this is: Fastify route module.
- What it does: Defines HTTP endpoints and route-level request handling for one domain area.
- Connections: Registered by backend server bootstrap; calls services/lib helpers and Prisma.
- Main content type: HTTP logic + auth guards + response shaping.
- Safe edits here: Response wording and non-breaking diagnostics.
- Be careful with: Auth hooks, schema contracts, and transactional behavior.
- Useful context: If frontend/mobile API calls fail after changes, contract drift often starts here.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import crypto from 'node:crypto';
import { FastifyPluginAsync } from 'fastify';
import { AuthProvider, StaffVerifyMethod } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { env } from '../lib/env.js';
import { HttpError } from '../lib/http-error.js';
import { handleRouteError } from '../lib/route-error.js';
import { logAudit } from '../lib/audit-log.js';

const localSessionSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120)
});

const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;

type OAuthProvider = 'google' | 'microsoft';

type OAuthProfile = {
  email: string;
  name: string;
};

function normalizeReturnTo(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/')) return undefined;
  if (trimmed.startsWith('//')) return undefined;
  return trimmed;
}

function createStateToken(provider: OAuthProvider, returnTo?: string): string {
  const issuedAt = Date.now();
  const nonce = crypto.randomBytes(12).toString('hex');
  const returnToEncoded = returnTo ? Buffer.from(returnTo, 'utf8').toString('base64url') : '';
  const payload = `${provider}.${issuedAt}.${nonce}.${returnToEncoded}`;
  const signature = crypto.createHmac('sha256', env.JWT_SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}.${signature}`, 'utf8').toString('base64url');
}

function verifyStateToken(token: string, provider: OAuthProvider): string | undefined {
  let decoded = '';
  try {
    decoded = Buffer.from(token, 'base64url').toString('utf8');
  } catch {
    throw new HttpError(400, 'Invalid OAuth state');
  }

  const parts = decoded.split('.');
  if (parts.length !== 4 && parts.length !== 5) {
    throw new HttpError(400, 'Invalid OAuth state');
  }

  const [tokenProvider, issuedAtRaw, nonce] = parts;
  const returnToEncoded = parts.length === 5 ? parts[3] : '';
  const signature = parts.length === 5 ? parts[4] : parts[3];

  if (!tokenProvider || !issuedAtRaw || !nonce || !signature) {
    throw new HttpError(400, 'Invalid OAuth state');
  }

  if (tokenProvider !== provider) {
    throw new HttpError(400, 'OAuth state/provider mismatch');
  }

  const issuedAt = Number(issuedAtRaw);
  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > OAUTH_STATE_MAX_AGE_MS) {
    throw new HttpError(400, 'OAuth state expired');
  }

  const payload =
    parts.length === 5
      ? `${tokenProvider}.${issuedAtRaw}.${nonce}.${returnToEncoded}`
      : `${tokenProvider}.${issuedAtRaw}.${nonce}`;
  const expected = crypto.createHmac('sha256', env.JWT_SECRET).update(payload).digest('hex');
  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(signature);
  if (expectedBuf.length !== providedBuf.length || !crypto.timingSafeEqual(expectedBuf, providedBuf)) {
    throw new HttpError(400, 'Invalid OAuth state signature');
  }

  if (!returnToEncoded) return undefined;

  try {
    const decodedReturnTo = Buffer.from(returnToEncoded, 'base64url').toString('utf8');
    return normalizeReturnTo(decodedReturnTo);
  } catch {
    return undefined;
  }
}

function hasAllowedDomain(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  return normalized.endsWith(`@${env.STAFF_ALLOWED_DOMAIN.toLowerCase()}`);
}

function authProviderFor(provider: OAuthProvider): AuthProvider {
  return provider === 'google' ? 'GOOGLE' : 'MICROSOFT';
}

function verifyMethodFor(provider: OAuthProvider): StaffVerifyMethod {
  return provider === 'google' ? 'OAUTH_GOOGLE' : 'OAUTH_MICROSOFT';
}

function staffRedirectBaseUrl(): string {
  const candidates = env.FRONTEND_ORIGIN.split(',').map((value) => value.trim()).filter(Boolean);
  for (const candidate of candidates) {
    try {
      return new URL(candidate).toString();
    } catch {
      // ignore invalid origins and fall back below
    }
  }

  return env.APP_BASE_URL;
}

function oauthStartUrl(provider: OAuthProvider, state: string): string {
  if (provider === 'google') {
    if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_REDIRECT_URI) {
      throw new HttpError(503, 'Google OAuth is not configured');
    }

    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', env.GOOGLE_OAUTH_CLIENT_ID);
    url.searchParams.set('redirect_uri', env.GOOGLE_OAUTH_REDIRECT_URI);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    url.searchParams.set('access_type', 'online');
    url.searchParams.set('prompt', 'select_account');
    return url.toString();
  }

  if (!env.MICROSOFT_OAUTH_CLIENT_ID || !env.MICROSOFT_OAUTH_REDIRECT_URI) {
    throw new HttpError(503, 'Microsoft OAuth is not configured');
  }

  const tenant = env.MICROSOFT_OAUTH_TENANT || 'common';
  const url = new URL(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`);
  url.searchParams.set('client_id', env.MICROSOFT_OAUTH_CLIENT_ID);
  url.searchParams.set('redirect_uri', env.MICROSOFT_OAUTH_REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid profile email User.Read');
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

async function fetchGoogleProfile(code: string): Promise<OAuthProfile> {
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET || !env.GOOGLE_OAUTH_REDIRECT_URI) {
    throw new HttpError(503, 'Google OAuth is not configured');
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_OAUTH_REDIRECT_URI,
      grant_type: 'authorization_code'
    })
  });

  if (!tokenRes.ok) {
    throw new HttpError(401, 'Google token exchange failed');
  }

  const tokenBody = (await tokenRes.json()) as { access_token?: string };
  if (!tokenBody.access_token) {
    throw new HttpError(401, 'Google access token missing');
  }

  const profileRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${tokenBody.access_token}` }
  });

  if (!profileRes.ok) {
    throw new HttpError(401, 'We hit a small backstage snag while trying to fetch Google profile');
  }

  const profile = (await profileRes.json()) as { email?: string; name?: string };
  if (!profile.email) {
    throw new HttpError(401, 'Google profile did not include email');
  }

  return {
    email: profile.email.toLowerCase(),
    name: profile.name?.trim() || profile.email
  };
}

async function fetchMicrosoftProfile(code: string): Promise<OAuthProfile> {
  if (!env.MICROSOFT_OAUTH_CLIENT_ID || !env.MICROSOFT_OAUTH_CLIENT_SECRET || !env.MICROSOFT_OAUTH_REDIRECT_URI) {
    throw new HttpError(503, 'Microsoft OAuth is not configured');
  }

  const tenant = env.MICROSOFT_OAUTH_TENANT || 'common';
  const tokenUrl = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;

  const tokenRes = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.MICROSOFT_OAUTH_CLIENT_ID,
      client_secret: env.MICROSOFT_OAUTH_CLIENT_SECRET,
      code,
      redirect_uri: env.MICROSOFT_OAUTH_REDIRECT_URI,
      grant_type: 'authorization_code'
    })
  });

  if (!tokenRes.ok) {
    throw new HttpError(401, 'Microsoft token exchange failed');
  }

  const tokenBody = (await tokenRes.json()) as { access_token?: string };
  if (!tokenBody.access_token) {
    throw new HttpError(401, 'Microsoft access token missing');
  }

  const profileRes = await fetch('https://graph.microsoft.com/oidc/userinfo', {
    headers: { Authorization: `Bearer ${tokenBody.access_token}` }
  });

  if (!profileRes.ok) {
    throw new HttpError(401, 'We hit a small backstage snag while trying to fetch Microsoft profile');
  }

  const profile = (await profileRes.json()) as {
    email?: string;
    preferred_username?: string;
    name?: string;
  };

  const email = (profile.email || profile.preferred_username || '').toLowerCase().trim();
  if (!email) {
    throw new HttpError(401, 'Microsoft profile did not include email');
  }

  return {
    email,
    name: profile.name?.trim() || email
  };
}

function buildStaffRedirect(params: { token?: string; error?: string; returnTo?: string }): string {
  const targetPath = normalizeReturnTo(params.returnTo) || '/teacher-tickets';
  const url = new URL(targetPath, staffRedirectBaseUrl());
  if (params.error) url.searchParams.set('error', params.error);
  if (params.token) {
    url.hash = new URLSearchParams({ authToken: params.token }).toString();
  }
  return url.toString();
}

async function completeOAuthLogin(options: {
  app: Parameters<FastifyPluginAsync>[0];
  provider: OAuthProvider;
  code: string;
  state: string;
}): Promise<{ token: string; returnTo?: string }> {
  const returnTo = verifyStateToken(options.state, options.provider);

  const profile =
    options.provider === 'google' ? await fetchGoogleProfile(options.code) : await fetchMicrosoftProfile(options.code);

  if (!hasAllowedDomain(profile.email)) {
    await logAudit({
      actor: `oauth:${options.provider}`,
      action: 'STAFF_OAUTH_DOMAIN_REJECTED',
      entityType: 'User',
      entityId: profile.email,
      metadata: {
        provider: options.provider,
        email: profile.email,
        allowedDomain: env.STAFF_ALLOWED_DOMAIN
      }
    });

    throw new HttpError(403, `Only @${env.STAFF_ALLOWED_DOMAIN} accounts are allowed`);
  }

  const user = await prisma.user.upsert({
    where: { email: profile.email },
    update: {
      name: profile.name,
      authProvider: authProviderFor(options.provider),
      verifiedStaff: true,
      staffVerifiedAt: new Date(),
      staffVerifyMethod: verifyMethodFor(options.provider)
    },
    create: {
      email: profile.email,
      name: profile.name,
      authProvider: authProviderFor(options.provider),
      verifiedStaff: true,
      staffVerifiedAt: new Date(),
      staffVerifyMethod: verifyMethodFor(options.provider)
    }
  });

  await logAudit({
    actor: user.email,
    actorUserId: user.id,
    action: 'STAFF_VERIFIED',
    entityType: 'User',
    entityId: user.id,
    metadata: {
      method: verifyMethodFor(options.provider),
      provider: options.provider
    }
  });

  const token = await options.app.jwt.sign({ role: 'user', userId: user.id, email: user.email }, { expiresIn: '12h' });
  return { token, returnTo };
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.get('/auth/google/start', async (_request, reply) => {
    return reply.status(410).send({
      error: 'Google OAuth sign-in is disabled. Use teacher promo code checkout instead.'
    });
  });

  app.get('/auth/microsoft/start', async (_request, reply) => {
    return reply.status(410).send({
      error: 'Microsoft OAuth sign-in is disabled. Use teacher promo code checkout instead.'
    });
  });

  app.get('/auth/google/callback', async (_request, reply) => {
    return reply.status(410).send({
      error: 'Google OAuth sign-in is disabled. Use teacher promo code checkout instead.'
    });
  });

  app.get('/auth/microsoft/callback', async (_request, reply) => {
    return reply.status(410).send({
      error: 'Microsoft OAuth sign-in is disabled. Use teacher promo code checkout instead.'
    });
  });

  app.post(
    '/auth/staff/local-session',
    {
      config: {
        rateLimit: {
          max: 12,
          timeWindow: '1 minute'
        }
      }
    },
    async (request, reply) => {
      const parsed = localSessionSchema.safeParse(request.body || {});
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      try {
        const normalizedEmail = parsed.data.email.trim().toLowerCase();
        const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });

        const user = existing
          ? await prisma.user.update({
              where: { id: existing.id },
              data: {
                name: parsed.data.name.trim(),
                authProvider: existing.authProvider === 'LOCAL' ? 'LOCAL' : existing.authProvider
              }
            })
          : await prisma.user.create({
              data: {
                email: normalizedEmail,
                name: parsed.data.name.trim(),
                authProvider: 'LOCAL'
              }
            });

        const token = await reply.jwtSign(
          {
            role: 'user',
            userId: user.id,
            email: user.email
          },
          { expiresIn: '12h' }
        );

        return reply.send({
          token,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            verifiedStaff: user.verifiedStaff,
            staffVerifyMethod: user.staffVerifyMethod,
            staffVerifiedAt: user.staffVerifiedAt
          }
        });
      } catch (err) {
        handleRouteError(reply, err, 'We hit a small backstage snag while trying to start local staff session');
      }
    }
  );

  app.get('/auth/staff/me', { preHandler: app.authenticateUser }, async (request, reply) => {
    const user = request.staffUser;
    if (!user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    return reply.send({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        authProvider: user.authProvider,
        verifiedStaff: user.verifiedStaff,
        staffVerifiedAt: user.staffVerifiedAt,
        staffVerifyMethod: user.staffVerifyMethod
      }
    });
  });
};
