import 'fastify';
import type { AdminRole, AdminUser, User } from '@prisma/client';

declare module 'fastify' {
  interface FastifyInstance {
    authenticateAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAdminRole: (role: AdminRole) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authenticateUser: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    staffUser?: User;
    adminUser?: AdminUser;
  }
}

declare module '@fastify/jwt' {
  type JwtPayload = {
    role: 'admin' | 'user' | 'admin_setup' | 'admin_checkin_events';
    adminId?: string;
    adminRole?: AdminRole;
    username?: string;
    performanceId?: string;
    purpose?: 'admin-2fa-setup' | 'admin-check-in-events';
    twoFactorSetupSecret?: string;
    userId?: string;
    email?: string;
  };

  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}
