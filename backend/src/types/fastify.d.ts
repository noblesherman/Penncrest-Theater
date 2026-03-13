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
    role: 'admin' | 'user' | 'admin_setup';
    adminId?: string;
    adminRole?: AdminRole;
    username?: string;
    purpose?: 'admin-2fa-setup';
    twoFactorSetupSecret?: string;
    userId?: string;
    email?: string;
  };

  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}
