import { FastifyPluginAsync } from 'fastify';
import ical from 'node-ical';
import { env } from '../lib/env.js';
import { handleRouteError } from '../lib/route-error.js';

const allowedCalendarHosts = [
  'calendar.google.com',
  'google.com',
  'icloud.com',
  'outlook.com',
  'office.com',
  'office365.com',
  'live.com',
  'microsoft.com'
];

function normalizeCalendarUrl(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('webcal://')) {
    return `https://${trimmed.slice('webcal://'.length)}`;
  }
  return trimmed;
}

function isAllowedCalendarUrl(rawValue: string): boolean {
  const normalized = normalizeCalendarUrl(rawValue);
  if (!normalized) return false;

  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }

    const host = parsed.hostname.toLowerCase();
    return allowedCalendarHosts.some((allowedHost) => host === allowedHost || host.endsWith(`.${allowedHost}`));
  } catch {
    return false;
  }
}

export const calendarRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/calendar', async (request, reply) => {
    try {
      const requestedUrl = typeof (request.query as { url?: unknown })?.url === 'string'
        ? (request.query as { url: string }).url
        : '';

      if (requestedUrl && !isAllowedCalendarUrl(requestedUrl)) {
        return reply.status(400).send({ error: 'Invalid calendar URL. Use a public Google, iCloud, or Outlook calendar link.' });
      }

      const sourceUrl = requestedUrl || env.GOOGLE_CALENDAR_ICS_URL;
      if (!sourceUrl || !isAllowedCalendarUrl(sourceUrl)) {
        return reply.send([]);
      }

      const events = await ical.async.fromURL(normalizeCalendarUrl(sourceUrl));
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
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to fetch calendar events');
    }
  });
};
