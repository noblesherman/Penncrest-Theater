import nodemailer from 'nodemailer';
import { env, isSmtpConfigured } from './env.js';

type TicketEmailTicket = {
  publicId: string;
  row: string;
  number: number;
  sectionName: string;
  ticketType?: string | null;
  attendeeName?: string | null;
};

type TicketEmailPayload = {
  orderId: string;
  customerName: string;
  customerEmail: string;
  showTitle: string;
  startsAtIso: string;
  venue: string;
  tickets: TicketEmailTicket[];
};

const transporter = isSmtpConfigured()
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS
      }
    })
  : null;

export async function sendTicketsEmail(payload: TicketEmailPayload): Promise<void> {
  if (!transporter || !env.SMTP_FROM) {
    console.warn('SMTP is not configured; skipping ticket email send.');
    return;
  }

  const ticketLines = payload.tickets
    .map((ticket) => {
      const link = `${env.APP_BASE_URL}/tickets/${ticket.publicId}`;
      const attendee = ticket.attendeeName ? ` (${ticket.attendeeName})` : '';
      const typeLabel = ticket.ticketType ? ` [${ticket.ticketType}]` : '';
      return `- ${ticket.sectionName} Row ${ticket.row} Seat ${ticket.number}${typeLabel}${attendee}: ${link}`;
    })
    .join('\n');

  const startsAt = new Date(payload.startsAtIso).toLocaleString();

  const text = [
    `Hi ${payload.customerName},`,
    '',
    `Your order ${payload.orderId} is confirmed for ${payload.showTitle}.`,
    `Performance: ${startsAt}`,
    `Venue: ${payload.venue}`,
    '',
    'Your ticket links:',
    ticketLines,
    '',
    'Thanks for supporting the Penncrest Theater program.'
  ].join('\n');

  const htmlTickets = payload.tickets
    .map((ticket) => {
      const attendee = ticket.attendeeName ? ` <em>(${ticket.attendeeName})</em>` : '';
      const typeLabel = ticket.ticketType ? ` <strong>[${ticket.ticketType}]</strong>` : '';
      const link = `${env.APP_BASE_URL}/tickets/${ticket.publicId}`;
      return `<li>${ticket.sectionName} Row ${ticket.row} Seat ${ticket.number}${typeLabel}${attendee} - <a href=\"${link}\">${link}</a></li>`;
    })
    .join('');

  const html = `
    <p>Hi ${payload.customerName},</p>
    <p>Your order <strong>${payload.orderId}</strong> is confirmed for <strong>${payload.showTitle}</strong>.</p>
    <p><strong>Performance:</strong> ${startsAt}<br/><strong>Venue:</strong> ${payload.venue}</p>
    <p>Your ticket links:</p>
    <ul>${htmlTickets}</ul>
    <p>Thanks for supporting the Penncrest Theater program.</p>
  `;

  await transporter.sendMail({
    from: env.SMTP_FROM,
    to: payload.customerEmail,
    subject: `Your tickets for ${payload.showTitle}`,
    text,
    html
  });
}
