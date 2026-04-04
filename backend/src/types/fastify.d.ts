import 'fastify';
import type { AdminRole, AdminUser, TripAccount, User } from '@prisma/client';

declare module 'fastify' {
  interface FastifyInstance {
    authenticateAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAdminRole: (role: AdminRole) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authenticateUser: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authenticateTripAccount: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    staffUser?: User;
    adminUser?: AdminUser;
    tripAccount?: TripAccount;
  }
}

declare module '@fastify/jwt' {
  type JwtPayload = {
    role: 'admin' | 'user' | 'trip_account' | 'admin_setup' | 'admin_checkin_events';
    adminId?: string;
    adminRole?: AdminRole;
    username?: string;
    performanceId?: string;
    purpose?: 'admin-2fa-setup' | 'admin-check-in-events';
    twoFactorSetupSecret?: string;
    userId?: string;
    email?: string;
    tripAccountId?: string;
    tripAccountEmail?: string;
  };

  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}
