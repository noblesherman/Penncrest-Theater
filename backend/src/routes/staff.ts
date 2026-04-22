/*
Handoff note for Mr. Smith:
- File: `backend/src/routes/staff.ts`
- What this is: Fastify route module.
- What it does: Defines HTTP endpoints and route-level request handling for one domain area.
- Connections: Registered by backend server bootstrap; calls services/lib helpers and Prisma.
- Main content type: HTTP logic + auth guards + response shaping.
- Safe edits here: Response wording and non-breaking diagnostics.
- Be careful with: Auth hooks, schema contracts, and transactional behavior.
- Useful context: If frontend/mobile API calls fail after changes, contract drift often starts here.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/http-error.js';
import { handleRouteError } from '../lib/route-error.js';
import { hashRedeemCode } from '../lib/staff-code.js';
import { logAudit } from '../lib/audit-log.js';

const redeemCodeSchema = z.object({
  code: z.string().min(4).max(64)
});

export const staffRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/staff/redeem-code',
    {
      preHandler: app.authenticateUser,
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '5 minutes'
        }
      }
    },
    async (request, reply) => {
      const parsed = redeemCodeSchema.safeParse(request.body || {});
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      const user = request.staffUser;
      if (!user) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const codeHash = hashRedeemCode(parsed.data.code);

      try {
        const code = await prisma.staffRedeemCode.findFirst({
          where: {
            codeHash,
            usedAt: null,
            expiresAt: {
              gt: new Date()
            }
          }
        });

        if (!code) {
          await logAudit({
            actor: user.email,
            actorUserId: user.id,
            action: 'STAFF_REDEEM_CODE_FAILED',
            entityType: 'StaffRedeemCode',
            entityId: 'unknown',
            metadata: { reason: 'invalid_or_expired' }
          });

          throw new HttpError(400, 'Invalid or expired code');
        }

        const now = new Date();
        const updatedUser = await prisma.$transaction(async (tx) => {
          const consumed = await tx.staffRedeemCode.updateMany({
            where: {
              id: code.id,
              usedAt: null,
              expiresAt: { gt: now }
            },
            data: {
              usedAt: now,
              usedByUserId: user.id
            }
          });

          if (consumed.count !== 1) {
            throw new HttpError(409, 'Code already used');
          }

          return tx.user.update({
            where: { id: user.id },
            data: {
              verifiedStaff: true,
              staffVerifiedAt: now,
              staffVerifyMethod: 'REDEEM_CODE'
            }
          });
        });

        await logAudit({
          actor: updatedUser.email,
          actorUserId: updatedUser.id,
          action: 'STAFF_VERIFIED',
          entityType: 'User',
          entityId: updatedUser.id,
          metadata: {
            method: 'REDEEM_CODE',
            codeId: code.id
          }
        });

        const token = await reply.jwtSign(
          {
            role: 'user',
            userId: updatedUser.id,
            email: updatedUser.email
          },
          { expiresIn: '12h' }
        );

        return reply.send({
          token,
          user: {
            id: updatedUser.id,
            email: updatedUser.email,
            name: updatedUser.name,
            authProvider: updatedUser.authProvider,
            verifiedStaff: updatedUser.verifiedStaff,
            staffVerifiedAt: updatedUser.staffVerifiedAt,
            staffVerifyMethod: updatedUser.staffVerifyMethod
          }
        });
      } catch (err) {
        handleRouteError(reply, err, 'We hit a small backstage snag while trying to redeem staff code');
      }
    }
  );
};
