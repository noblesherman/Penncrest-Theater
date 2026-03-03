import { FastifyPluginAsync } from 'fastify';
import ical from 'node-ical';
import { env } from '../lib/env.js';
import { handleRouteError } from '../lib/route-error.js';

export const calendarRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/calendar', async (_request, reply) => {
    try {
      if (!env.GOOGLE_CALENDAR_ICS_URL) {
        return reply.send([]);
      }

      const events = await ical.async.fromURL(env.GOOGLE_CALENDAR_ICS_URL);
      const payload = Object.values(events)
        .filter((event: any) => event.type === 'VEVENT')
        .map((event: any) => ({
          title: event.summary || 'Theater Event',
          date: event.start,
          end: event.end,
          description: event.description,
          location: event.location,
          type: 'event'
        }));

      reply.send(payload);
    } catch (err) {
      handleRouteError(reply, err, 'Failed to fetch calendar events');
    }
  });
};
