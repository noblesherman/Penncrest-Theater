/*
Handoff note for Mr. Smith:
- File: `backend/src/types/fastify.d.ts`
- What this is: Backend type augmentation module.
- What it does: Extends framework typings used project-wide.
- Connections: Read at compile time by TypeScript to type decorated fields.
- Main content type: Types only (no runtime behavior).
- Safe edits here: Additive declarations.
- Be careful with: Removing/renaming declarations that many files depend on.
- Useful context: When TS can’t find custom request/server fields, check here first.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import 'fastify';
import type { AdminRole, AdminUser, ManagedDevice, TripAccount, User } from '@prisma/client';

declare module 'fastify' {
  interface FastifyInstance {
    authenticateAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAdminRole: (role: AdminRole) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authenticateUser: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authenticateTripAccount: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authenticateManagedDevice: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    staffUser?: User;
    adminUser?: AdminUser;
    tripAccount?: TripAccount;
    managedDevice?: ManagedDevice;
  }
}

declare module '@fastify/jwt' {
  type JwtPayload = {
    role:
      | 'admin'
      | 'user'
      | 'trip_account'
      | 'admin_setup'
      | 'admin_checkin_events'
      | 'admin_payment_line_events'
      | 'mobile_device';
    adminId?: string;
    adminRole?: AdminRole;
    username?: string;
    performanceId?: string;
    queueKey?: string;
    purpose?: 'admin-2fa-setup' | 'admin-check-in-events' | 'admin-payment-line-events';
    twoFactorSetupSecret?: string;
    userId?: string;
    email?: string;
    tripAccountId?: string;
    tripAccountEmail?: string;
    managedDeviceId?: string;
    deviceId?: string;
    tokenVersion?: number;
  };

  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}
