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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatPerformanceDate(startsAtIso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(startsAtIso));
}

export async function sendTicketsEmail(payload: TicketEmailPayload): Promise<void> {
  if (!transporter || !env.SMTP_FROM) {
    console.warn('SMTP is not configured; skipping ticket email send.');
    return;
  }

  const safeCustomerName = escapeHtml(payload.customerName);
  const safeOrderId = escapeHtml(payload.orderId);
  const safeShowTitle = escapeHtml(payload.showTitle);
  const safeVenue = escapeHtml(payload.venue);

  const ticketLines = payload.tickets
    .map((ticket, index) => {
      const link = `${env.APP_BASE_URL}/tickets/${ticket.publicId}`;
      const attendee = ticket.attendeeName ? ` (${ticket.attendeeName})` : '';
      const typeLabel = ticket.ticketType ? ` [${ticket.ticketType}]` : '';
      return `${index + 1}. ${ticket.sectionName} Row ${ticket.row} Seat ${ticket.number}${typeLabel}${attendee}\n   ${link}`;
    })
    .join('\n');

  const startsAt = formatPerformanceDate(payload.startsAtIso);

  const text = [
    `Hi ${payload.customerName},`,
    '',
    `Your tickets are confirmed for ${payload.showTitle}.`,
    `Order ID: ${payload.orderId}`,
    `Performance: ${startsAt}`,
    `Venue: ${payload.venue}`,
    '',
    'Your ticket links:',
    ticketLines,
    '',
    'Thanks for supporting the Penncrest Theater program.',
    'See you at the show!'
  ].join('\n');

  const htmlTickets = payload.tickets
    .map((ticket) => {
      const attendee = ticket.attendeeName ? ` for ${escapeHtml(ticket.attendeeName)}` : '';
      const typeLabel = ticket.ticketType ? escapeHtml(ticket.ticketType) : 'Ticket';
      const link = `${env.APP_BASE_URL}/tickets/${ticket.publicId}`;
      const safeLink = escapeHtml(link);
      const seatLabel = `${escapeHtml(ticket.sectionName)} Row ${escapeHtml(ticket.row)} Seat ${ticket.number}`;

      return `
        <tr>
          <td style="padding:0 0 12px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e7e5e4;border-radius:12px;background:#ffffff;">
              <tr>
                <td style="padding:14px 16px;font-family:Arial,sans-serif;color:#1c1917;">
                  <div style="font-size:15px;font-weight:700;line-height:1.4;">${seatLabel}</div>
                  <div style="font-size:13px;color:#57534e;line-height:1.5;margin-top:4px;">${typeLabel}${attendee}</div>
                  <div style="margin-top:12px;">
                    <a href="${safeLink}" style="display:inline-block;background:#1c1917;color:#ffffff;text-decoration:none;padding:9px 14px;border-radius:8px;font-size:13px;font-weight:700;">View Ticket</a>
                  </div>
                  <div style="font-size:12px;color:#78716c;line-height:1.5;margin-top:10px;word-break:break-all;">${safeLink}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      `;
    })
    .join('');

  const html = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f4;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border:1px solid #e7e5e4;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="background:#1c1917;padding:20px 24px;font-family:Arial,sans-serif;color:#ffffff;">
                <div style="font-size:13px;letter-spacing:0.5px;text-transform:uppercase;opacity:0.85;">Penncrest Theater</div>
                <div style="font-size:24px;font-weight:800;line-height:1.25;margin-top:6px;">Your Tickets for ${safeShowTitle}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:22px 24px 10px 24px;font-family:Arial,sans-serif;color:#1c1917;">
                <p style="margin:0 0 12px 0;font-size:15px;line-height:1.6;">Hi ${safeCustomerName},</p>
                <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;">
                  Your order is confirmed. We cannot wait to see you at <strong>${safeShowTitle}</strong>.
                </p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e7e5e4;border-radius:12px;background:#fafaf9;">
                  <tr>
                    <td style="padding:12px 14px;font-size:14px;line-height:1.6;color:#292524;font-family:Arial,sans-serif;">
                      <div><strong>Order ID:</strong> ${safeOrderId}</div>
                      <div><strong>Performance:</strong> ${escapeHtml(startsAt)}</div>
                      <div><strong>Venue:</strong> ${safeVenue}</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:4px 24px 8px 24px;font-family:Arial,sans-serif;">
                <div style="font-size:14px;font-weight:700;color:#1c1917;margin-bottom:10px;">Your Ticket Links</div>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  ${htmlTickets}
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:4px 24px 24px 24px;font-family:Arial,sans-serif;color:#57534e;font-size:13px;line-height:1.6;">
                Thanks for supporting the Penncrest Theater program.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;

  await transporter.sendMail({
    from: env.SMTP_FROM,
    to: payload.customerEmail,
    subject: `Your tickets for ${payload.showTitle}`,
    text,
    html
  });
}
