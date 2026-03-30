import nodemailer from 'nodemailer';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env, isSmtpConfigured } from './env.js';

type TicketEmailTicket = {
  publicId: string;
  row: string;
  number: number;
  sectionName: string;
  seatLabel?: string | null;
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

type EmailLogoAttachment = {
  filename: string;
  content: Buffer;
  contentType: string;
  cid: string;
};

const BRAND_NAME = 'Penncrest Theater';
const LOGO_CID = 'penncrest-theater-logo';
let cachedLogoAttachment: EmailLogoAttachment | null | undefined;

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
    timeZone: 'America/New_York',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  }).format(new Date(startsAtIso));
}

function inferMimeTypeFromFile(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  return 'application/octet-stream';
}

function loadEmailLogoAttachment(): EmailLogoAttachment | null {
  if (cachedLogoAttachment !== undefined) {
    return cachedLogoAttachment;
  }

  const currentDir = dirname(fileURLToPath(import.meta.url));
  const projectRoot = resolve(currentDir, '../../../');
  const candidates = [
    resolve(projectRoot, 'public/favicon.svg'),
    resolve(projectRoot, 'src/assets/penncrest-logo.jpeg'),
    resolve(projectRoot, 'src/assets/penncrest-logo.jpg'),
    resolve(projectRoot, 'src/assets/penncrest-logo.png')
  ];

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      cachedLogoAttachment = {
        filename: basename(path) || 'penncrest-logo.jpg',
        content: readFileSync(path),
        contentType: inferMimeTypeFromFile(path),
        cid: LOGO_CID
      };
      return cachedLogoAttachment;
    } catch {
    }
  }

  cachedLogoAttachment = null;
  return cachedLogoAttachment;
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
  const safeCustomerEmail = escapeHtml(payload.customerEmail);
  const logo = loadEmailLogoAttachment();
  const logoSrc = logo ? `cid:${logo.cid}` : null;

  const ticketLines = payload.tickets
    .map((ticket, index) => {
      const link = `${env.APP_BASE_URL}/tickets/${ticket.publicId}`;
      const attendee = ticket.attendeeName ? ` (${ticket.attendeeName})` : '';
      const typeLabel = ticket.ticketType ? ` [${ticket.ticketType}]` : '';
      const seatLabel =
        ticket.seatLabel?.trim() ||
        `${ticket.sectionName}${ticket.row ? ` Row ${ticket.row}` : ''}${ticket.number > 0 ? ` Seat ${ticket.number}` : ''}`;
      return `${index + 1}. ${seatLabel}${typeLabel}${attendee}\n   ${link}`;
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
    `Thanks for supporting ${BRAND_NAME}.`,
    'See you at the show!'
  ].join('\n');

  const htmlTickets = payload.tickets
    .map((ticket, index) => {
      const attendee = ticket.attendeeName ? ` &mdash; ${escapeHtml(ticket.attendeeName)}` : '';
      const typeLabel = ticket.ticketType ? escapeHtml(ticket.ticketType) : 'General Admission';
      const link = `${env.APP_BASE_URL}/tickets/${ticket.publicId}`;
      const safeLink = escapeHtml(link);
      const resolvedSeatLabel =
        ticket.seatLabel?.trim() ||
        `${ticket.sectionName}${ticket.row ? `, Row ${ticket.row}` : ''}${ticket.number > 0 ? `, Seat ${ticket.number}` : ''}`;
      const seatLabel = `Ticket ${index + 1} &mdash; ${escapeHtml(resolvedSeatLabel)}`;

      return `
        <tr>
          <td style="padding:0 0 10px 0;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #c9a84c;border-radius:11px;background:#fffdf7;overflow:hidden;">
              <tr>
                <td style="padding:7px 14px;background:#8b1a1a;">
                  <div style="font-family:Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:1.2px;color:#f5d98b;text-transform:uppercase;">${seatLabel}</div>
                </td>
              </tr>
              <tr>
                <td style="padding:13px 14px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="font-family:Arial,sans-serif;font-size:12px;color:#5a3a1a;vertical-align:middle;">${typeLabel}${attendee}</td>
                      <td align="right" style="vertical-align:middle;">
                        <a href="${safeLink}" style="display:inline-block;background:#8b1a1a;color:#f5d98b;text-decoration:none;padding:8px 16px;border-radius:7px;font-size:12px;font-weight:700;font-family:Arial,sans-serif;border:1px solid #c9a84c;white-space:nowrap;">Open My Ticket</a>
                      </td>
                    </tr>
                  </table>
                  <div style="font-size:11px;color:#8b7355;line-height:1.5;margin-top:8px;word-break:break-all;font-family:Arial,sans-serif;">${safeLink}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      `;
    })
    .join('');

  const html = `
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
      Your Penncrest Theater tickets are ready. Open each ticket link for entry QR codes.
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8;padding:26px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;">

            <!-- HEADER -->
            <tr>
              <td style="background:linear-gradient(160deg,#1a0505 0%,#3d0a0a 60%,#5a1010 100%);border-radius:16px 16px 0 0;padding:28px 28px 24px 28px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td valign="middle">
                      <div style="font-family:Arial,sans-serif;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#c9a84c;margin-bottom:8px;">${BRAND_NAME}</div>
                      <div style="font-family:Georgia,'Times New Roman',serif;font-size:28px;font-weight:700;color:#f5f0e8;line-height:1.2;">You're going to the show!</div>
                      <div style="margin-top:10px;font-family:Georgia,'Times New Roman',serif;font-size:14px;font-style:italic;color:rgba(245,217,139,0.85);line-height:1.5;">Your tickets are confirmed and waiting for you.</div>
                    </td>
                    <td valign="middle" align="right" style="padding-left:12px;">
                      ${
                        logoSrc
                          ? `<img src="${logoSrc}" width="72" height="72" alt="${BRAND_NAME} lion crest" style="display:block;width:72px;height:72px;object-fit:contain;border-radius:10px;border:2px solid #c9a84c;background:#3d0a0a;padding:4px;box-sizing:border-box;" />`
                          : `<div style="width:72px;height:72px;border-radius:10px;border:2px solid #c9a84c;background:#5a1010;display:flex;align-items:center;justify-content:center;font-family:Georgia,serif;font-size:28px;color:#c9a84c;text-align:center;line-height:72px;">&#127914;</div>`
                      }
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- GOLD DIVIDER LINE -->
            <tr>
              <td style="height:3px;background:linear-gradient(90deg,#8b1a1a,#c9a84c,#8b1a1a);"></td>
            </tr>

            <!-- BODY -->
            <tr>
              <td style="background:#fffdf7;padding:26px 28px 8px 28px;border:1px solid #e8dfc8;border-top:none;">
                <p style="margin:0 0 6px 0;font-size:16px;line-height:1.6;font-family:Georgia,serif;color:#1a0a0a;">Hey ${safeCustomerName}!</p>
                <p style="margin:0 0 12px 0;font-size:15px;line-height:1.75;font-family:Arial,sans-serif;color:#3d2020;">
                  We are so excited to have you join us for <strong style="color:#8b1a1a;">${safeShowTitle}</strong>. Our cast and crew have been working incredibly hard, and we can&rsquo;t wait to share this show with you.
                </p>
                <p style="margin:0 0 18px 0;font-size:15px;line-height:1.75;font-family:Arial,sans-serif;color:#3d2020;">
                  Here&rsquo;s everything you need for the big night:
                </p>

                <!-- ORDER DETAILS BOX -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #c9a84c;border-radius:10px;background:#fdf8ee;margin-bottom:22px;">
                  <tr>
                    <td style="padding:6px 16px;background:#c9a84c;border-radius:9px 9px 0 0;">
                      <div style="font-family:Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:1.8px;text-transform:uppercase;color:#3d1a00;">Show Details</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:14px 16px;font-family:Arial,sans-serif;font-size:13px;line-height:2;color:#1a0a0a;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                          <td style="color:#8b6914;font-weight:700;width:120px;vertical-align:top;">When</td>
                          <td style="color:#1a0a0a;">${escapeHtml(startsAt)}</td>
                        </tr>
                        <tr>
                          <td style="color:#8b6914;font-weight:700;vertical-align:top;">Where</td>
                          <td style="color:#1a0a0a;">${safeVenue}</td>
                        </tr>
                        <tr>
                          <td style="color:#8b6914;font-weight:700;vertical-align:top;">Order ID</td>
                          <td style="color:#1a0a0a;">${safeOrderId}</td>
                        </tr>
                        <tr>
                          <td style="color:#8b6914;font-weight:700;vertical-align:top;">Email</td>
                          <td style="color:#1a0a0a;">${safeCustomerEmail}</td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>

                <!-- TICKETS SECTION LABEL -->
                <div style="font-family:Georgia,serif;font-size:16px;font-weight:700;color:#1a0a0a;margin-bottom:12px;">
                  Your tickets
                </div>

                <!-- TICKETS -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  ${htmlTickets}
                </table>

                <!-- TIP BOX -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
                  <tr>
                    <td style="border-left:3px solid #c9a84c;padding:12px 14px;background:#fdf8ee;border-radius:0 8px 8px 0;">
                      <div style="font-family:Arial,sans-serif;font-size:10px;font-weight:700;color:#8b6914;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.8px;">A quick tip</div>
                      <div style="font-family:Arial,sans-serif;font-size:13px;color:#3d2020;line-height:1.6;">Pull up your ticket links on your phone before you arrive &mdash; each one has a QR code for easy entry. Doors open 30 minutes before showtime.</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- FOOTER -->
            <tr>
              <td style="height:3px;background:linear-gradient(90deg,#8b1a1a,#c9a84c,#8b1a1a);"></td>
            </tr>
            <tr>
              <td style="background:linear-gradient(160deg,#1a0505 0%,#3d0a0a 100%);border-radius:0 0 16px 16px;padding:18px 28px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td>
                      <p style="margin:0;font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:rgba(245,240,232,0.85);">Thank you for supporting the students of ${BRAND_NAME}. See you opening night!</p>
                    </td>
                    <td align="right" valign="middle" style="padding-left:16px;">
                      <div style="font-family:Georgia,serif;font-size:18px;color:#c9a84c;">&#127914;</div>
                    </td>
                  </tr>
                </table>
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
    subject: `Your tickets for ${payload.showTitle} — ${BRAND_NAME}`,
    text,
    html,
    attachments: logo
      ? [
          {
            filename: logo.filename,
            content: logo.content,
            contentType: logo.contentType,
            cid: logo.cid
          }
        ]
      : undefined
  });
}
