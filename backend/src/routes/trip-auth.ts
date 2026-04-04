import { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { env } from '../lib/env.js';
import { sendTripLoginCodeEmail } from '../lib/email.js';
import { handleRouteError } from '../lib/route-error.js';
import {
  generateTripLoginCode,
  hashTripLoginCode,
  normalizeTripAccountEmail,
  normalizeTripLoginCode
} from '../lib/trip-auth.js';

const requestCodeSchema = z.object({
  email: z.string().trim().email().max(200),
  name: z.string().trim().min(1).max(120).optional()
});

const verifyCodeSchema = z.object({
  email: z.string().trim().email().max(200),
  code: z.string().trim().min(4).max(16)
});

function toPublicAccount(account: {
  id: string;
  email: string;
  name: string | null;
  studentId: string | null;
  lastLoginAt: Date | null;
}) {
  return {
    id: account.id,
    email: account.email,
    name: account.name,
    studentId: account.studentId,
    hasClaimedStudent: Boolean(account.studentId),
    lastLoginAt: account.lastLoginAt
  };
}

export const tripAuthRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/api/trip-auth/request-code',
    {
      config: {
        rateLimit: {
          max: 8,
          timeWindow: '1 minute'
        }
      }
    },
    async (request, reply) => {
      const parsed = requestCodeSchema.safeParse(request.body || {});
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      const normalizedEmail = normalizeTripAccountEmail(parsed.data.email);
      const normalizedName = parsed.data.name?.trim() || null;
      const code = generateTripLoginCode(6);
      const codeHash = hashTripLoginCode(code);
      const expiresAt = new Date(Date.now() + env.TRIP_LOGIN_CODE_TTL_MINUTES * 60_000);

      try {
        const account = await prisma.tripAccount.upsert({
          where: { email: normalizedEmail },
          update: {
            ...(normalizedName
              ? {
                  name: normalizedName
                }
              : {})
          },
          create: {
            email: normalizedEmail,
            name: normalizedName
          }
        });

        await prisma.tripLoginCode.create({
          data: {
            accountId: account.id,
            codeHash,
            expiresAt
          }
        });

        await sendTripLoginCodeEmail({
          email: normalizedEmail,
          accountName: account.name,
          code,
          expiresAt
        });

        reply.send({
          success: true,
          expiresAt,
          expiresInMinutes: env.TRIP_LOGIN_CODE_TTL_MINUTES
        });
      } catch (err) {
        handleRouteError(reply, err, 'Failed to send trip login code');
      }
    }
  );

  app.post(
    '/api/trip-auth/verify-code',
    {
      config: {
        rateLimit: {
          max: 15,
          timeWindow: '5 minutes'
        }
      }
    },
    async (request, reply) => {
      const parsed = verifyCodeSchema.safeParse(request.body || {});
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      const normalizedEmail = normalizeTripAccountEmail(parsed.data.email);
      const normalizedCode = normalizeTripLoginCode(parsed.data.code);
      const submittedHash = hashTripLoginCode(normalizedCode);
      const now = new Date();

      try {
        const account = await prisma.tripAccount.findUnique({
          where: { email: normalizedEmail },
          select: {
            id: true,
            email: true,
            name: true,
            studentId: true,
            isActive: true,
            lastLoginAt: true
          }
        });

        if (!account || !account.isActive) {
          return reply.status(401).send({ error: 'Invalid login code' });
        }

        const activeCode = await prisma.tripLoginCode.findFirst({
          where: {
            accountId: account.id,
            consumedAt: null,
            expiresAt: {
              gt: now
            }
          },
          orderBy: {
            createdAt: 'desc'
          }
        });

        if (!activeCode) {
          return reply.status(401).send({ error: 'Login code expired or already used' });
        }

        const nextAttemptCount = activeCode.attemptCount + 1;
        if (activeCode.attemptCount >= env.TRIP_LOGIN_CODE_MAX_ATTEMPTS) {
          return reply.status(429).send({ error: 'Too many code attempts. Request a new code.' });
        }

        if (activeCode.codeHash !== submittedHash) {
          await prisma.tripLoginCode.update({
            where: { id: activeCode.id },
            data: {
              attemptCount: nextAttemptCount,
              ...(nextAttemptCount >= env.TRIP_LOGIN_CODE_MAX_ATTEMPTS
                ? {
                    consumedAt: now
                  }
                : {})
            }
          });

          return reply.status(401).send({ error: 'Invalid login code' });
        }

        const consumeResult = await prisma.tripLoginCode.updateMany({
          where: {
            id: activeCode.id,
            consumedAt: null,
            expiresAt: {
              gt: now
            }
          },
          data: {
            consumedAt: now,
            attemptCount: nextAttemptCount
          }
        });

        if (consumeResult.count === 0) {
          return reply.status(401).send({ error: 'Login code expired or already used' });
        }

        const updatedAccount = await prisma.tripAccount.update({
          where: { id: account.id },
          data: {
            lastLoginAt: now
          },
          select: {
            id: true,
            email: true,
            name: true,
            studentId: true,
            lastLoginAt: true
          }
        });

        const token = await app.jwt.sign(
          {
            role: 'trip_account',
            tripAccountId: account.id,
            tripAccountEmail: account.email
          },
          {
            expiresIn: `${env.TRIP_ACCOUNT_TOKEN_TTL_HOURS}h`
          }
        );

        reply.send({
          token,
          account: toPublicAccount(updatedAccount)
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2021') {
          return reply.status(503).send({ error: 'Database schema is out of date. Run backend migrations.' });
        }
        handleRouteError(reply, err, 'Failed to verify trip login code');
      }
    }
  );

  app.get('/api/trip-auth/me', { preHandler: app.authenticateTripAccount }, async (request, reply) => {
    try {
      const account = await prisma.tripAccount.findUnique({
        where: {
          id: request.tripAccount!.id
        },
        include: {
          student: {
            select: {
              id: true,
              name: true,
              grade: true,
              isActive: true
            }
          }
        }
      });

      if (!account || !account.isActive) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      reply.send({
        account: toPublicAccount(account),
        student: account.student
      });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to load trip account session');
    }
  });
};
