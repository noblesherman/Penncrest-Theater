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
    role: 'admin' | 'user' | 'trip_account' | 'admin_setup' | 'admin_checkin_events' | 'mobile_device';
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
    managedDeviceId?: string;
    deviceId?: string;
    tokenVersion?: number;
  };

  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}
