import 'fastify';
import type { User } from '@prisma/client';

declare module 'fastify' {
  interface FastifyInstance {
    authenticateAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authenticateUser: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    staffUser?: User;
  }
}

declare module '@fastify/jwt' {
  type JwtPayload = {
    role: 'admin' | 'user';
    username?: string;
    userId?: string;
    email?: string;
  };

  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}
