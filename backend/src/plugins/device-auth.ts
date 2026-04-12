import fp from 'fastify-plugin';
import { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../lib/prisma.js';

type MobileDeviceJwtPayload = {
  role: 'mobile_device';
  managedDeviceId?: string;
  deviceId?: string;
  tokenVersion?: number;
};

export const deviceAuthPlugin = fp(async (app) => {
  app.decorate('authenticateManagedDevice', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      if (request.user.role !== 'mobile_device') {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      const payload = request.user as MobileDeviceJwtPayload;
      if (!payload.managedDeviceId) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      const managedDevice = await prisma.managedDevice.findUnique({
        where: {
          id: payload.managedDeviceId
        }
      });

      if (!managedDevice) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      if (payload.deviceId && managedDevice.deviceId !== payload.deviceId) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      if (typeof payload.tokenVersion === 'number' && managedDevice.tokenVersion !== payload.tokenVersion) {
        return reply.status(401).send({ error: 'Unauthorized' });
      }

      request.managedDevice = managedDevice;
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });
});
