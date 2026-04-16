import nodemailer from 'nodemailer';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env, isSmtpConfigured } from './env.js';

export type TicketEmailTicket = {
  publicId: string;
  row: string;
  number: number;
  sectionName: string;
  seatLabel?: string | null;
  ticketType?: string | null;
  attendeeName?: string | null;
};

export type TicketEmailPayload = {
  orderId: string;
  customerName: string;
  customerEmail: string;
  showTitle: string;
  startsAtIso: string;
  venue: string;
  tickets: TicketEmailTicket[];
};

type DonationThankYouEmailPayload = {
  donorName: string;
  donorEmail: string;
  amountCents: number;
  currency: string;
  paymentIntentId: string;
};

type SeniorSendoffSubmissionEmailPayload = {
  parentName: string;
  parentEmail: string;
  parentPhone: string;
  studentName: string;
  showTitle: string;
  message: string;
  entryNumber: number;
  isPaid: boolean;
  paidAmountCents: number | null;
  paidCurrency: string | null;
  paymentIntentId: string | null;
};

type TripLoginCodeEmailPayload = {
  email: string;
  accountName?: string | null;
  code: string;
  expiresAt: Date;
};

type SystemAlertEmailPayload = {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
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

function formatMoney(amountCents: number, currency: string): string {
  const resolvedCurrency = (currency || 'usd').toUpperCase();
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: resolvedCurrency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amountCents / 100);
  } catch {
    return `$${(amountCents / 100).toFixed(2)}`;
  }
}

function formatTripCodeExpiry(expiresAt: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  }).format(expiresAt);
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
                          : `<table role="presentation" cellpadding="0" cellspacing="0" width="72" style="width:72px;height:72px;border-radius:10px;border:2px solid #c9a84c;background:#5a1010;"><tr><td width="72" height="72" align="center" valign="middle" style="width:72px;height:72px;text-align:center;vertical-align:middle;line-height:72px;mso-line-height-rule:exactly;"><span style="display:inline-block;line-height:1;font-size:32px;font-family:'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif;">&#127917;</span></td></tr></table>`
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

export async function sendDonationThankYouEmail(payload: DonationThankYouEmailPayload): Promise<void> {
  if (!transporter || !env.SMTP_FROM) {
    console.warn('SMTP is not configured; skipping donation thank-you email send.');
    return;
  }

  const donorName = payload.donorName.trim() || 'Supporter';
  const donorEmail = payload.donorEmail.trim().toLowerCase();
  const amountLabel = formatMoney(payload.amountCents, payload.currency);
  const safeDonorName = escapeHtml(donorName);
  const safeAmountLabel = escapeHtml(amountLabel);
  const safeDonationId = escapeHtml(payload.paymentIntentId);
  const safeDonorEmail = escapeHtml(donorEmail);

  const text = [
    `Hi ${donorName},`,
    '',
    `Thank you for your donation to ${BRAND_NAME}.`,
    `Donation amount: ${amountLabel}`,
    `Donation ID: ${payload.paymentIntentId}`,
    '',
    'Your support directly helps student performers and crew members.',
    '',
    `A Stripe receipt was sent to ${donorEmail}.`,
    '',
    `With gratitude,`,
    BRAND_NAME
  ].join('\n');

  const html = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;">
            <tr>
              <td style="background:linear-gradient(160deg,#1a0505 0%,#3d0a0a 100%);border-radius:14px 14px 0 0;padding:24px;">
                <div style="font-family:Arial,sans-serif;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#c9a84c;margin-bottom:8px;">${BRAND_NAME}</div>
                <div style="font-family:Georgia,'Times New Roman',serif;font-size:28px;font-weight:700;color:#f5f0e8;line-height:1.2;">Thank You</div>
                <div style="margin-top:8px;font-family:Arial,sans-serif;font-size:14px;color:#f5d98b;line-height:1.5;">Your donation helps our students build incredible productions.</div>
              </td>
            </tr>
            <tr>
              <td style="height:3px;background:linear-gradient(90deg,#8b1a1a,#c9a84c,#8b1a1a);"></td>
            </tr>
            <tr>
              <td style="background:#fffdf7;border:1px solid #e8dfc8;border-top:none;padding:24px;">
                <p style="margin:0 0 10px 0;font-family:Georgia,'Times New Roman',serif;font-size:18px;color:#1a0a0a;">Hi ${safeDonorName},</p>
                <p style="margin:0 0 14px 0;font-family:Arial,sans-serif;font-size:14px;line-height:1.7;color:#3d2020;">
                  Thank you for your generous donation to ${BRAND_NAME}. We truly appreciate your support.
                </p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #c9a84c;border-radius:10px;background:#fdf8ee;">
                  <tr>
                    <td style="padding:12px 14px;font-family:Arial,sans-serif;font-size:13px;color:#1a0a0a;line-height:1.8;">
                      <div><strong style="color:#8b6914;">Donation amount:</strong> ${safeAmountLabel}</div>
                      <div><strong style="color:#8b6914;">Donation ID:</strong> ${safeDonationId}</div>
                      <div><strong style="color:#8b6914;">Receipt email:</strong> ${safeDonorEmail}</div>
                    </td>
                  </tr>
                </table>
                <p style="margin:14px 0 0 0;font-family:Arial,sans-serif;font-size:13px;line-height:1.6;color:#3d2020;">
                  Stripe also sent your official payment receipt to your email.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;

  await transporter.sendMail({
    from: env.SMTP_FROM,
    to: donorEmail,
    subject: `Thank you for your donation — ${BRAND_NAME}`,
    text,
    html
  });
}

export async function sendSeniorSendoffSubmissionEmail(payload: SeniorSendoffSubmissionEmailPayload): Promise<void> {
  if (!transporter || !env.SMTP_FROM) {
    console.warn('SMTP is not configured; skipping shout out confirmation email send.');
    return;
  }

  const parentName = payload.parentName.trim() || 'Parent/Guardian';
  const parentEmail = payload.parentEmail.trim().toLowerCase();
  const paidAmountLabel =
    payload.isPaid && payload.paidAmountCents !== null
      ? formatMoney(payload.paidAmountCents, payload.paidCurrency || 'usd')
      : null;

  const safeParentName = escapeHtml(parentName);
  const safeStudentName = escapeHtml(payload.studentName);
  const safeShowTitle = escapeHtml(payload.showTitle);
  const safeParentPhone = escapeHtml(payload.parentPhone);
  const safeParentEmail = escapeHtml(parentEmail);
  const safeMessage = escapeHtml(payload.message);
  const safeEntryNumber = escapeHtml(String(payload.entryNumber));
  const safePaidAmount = paidAmountLabel ? escapeHtml(paidAmountLabel) : null;
  const safePaymentIntentId = payload.paymentIntentId ? escapeHtml(payload.paymentIntentId) : null;

  const text = [
    `Hi ${parentName},`,
    '',
    `Your shout out was submitted for ${payload.studentName}.`,
    `Show: ${payload.showTitle}`,
    `Entry number for this student: ${payload.entryNumber} of 2`,
    payload.isPaid && paidAmountLabel ? `Payment received: ${paidAmountLabel}` : 'Payment: Not required',
    payload.isPaid && payload.paymentIntentId ? `Payment ID: ${payload.paymentIntentId}` : null,
    '',
    'Submitted details:',
    `Parent/Guardian: ${parentName}`,
    `Email: ${parentEmail}`,
    `Phone: ${payload.parentPhone}`,
    `Student: ${payload.studentName}`,
    `Message: ${payload.message}`,
    '',
    `Thank you for supporting ${BRAND_NAME}.`
  ]
    .filter(Boolean)
    .join('\n');

  const html = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;">
            <tr>
              <td style="background:linear-gradient(160deg,#1a0505 0%,#3d0a0a 100%);border-radius:14px 14px 0 0;padding:24px;">
                <div style="font-family:Arial,sans-serif;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#c9a84c;margin-bottom:8px;">${BRAND_NAME}</div>
                <div style="font-family:Georgia,'Times New Roman',serif;font-size:28px;font-weight:700;color:#f5f0e8;line-height:1.2;">Shout Out Received</div>
                <div style="margin-top:8px;font-family:Arial,sans-serif;font-size:14px;color:#f5d98b;line-height:1.5;">Your playbill shout-out has been submitted.</div>
              </td>
            </tr>
            <tr>
              <td style="height:3px;background:linear-gradient(90deg,#8b1a1a,#c9a84c,#8b1a1a);"></td>
            </tr>
            <tr>
              <td style="background:#fffdf7;border:1px solid #e8dfc8;border-top:none;padding:24px;">
                <p style="margin:0 0 10px 0;font-family:Georgia,'Times New Roman',serif;font-size:18px;color:#1a0a0a;">Hi ${safeParentName},</p>
                <p style="margin:0 0 14px 0;font-family:Arial,sans-serif;font-size:14px;line-height:1.7;color:#3d2020;">
                  We received your shout out for <strong>${safeStudentName}</strong> in <strong>${safeShowTitle}</strong>.
                </p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #c9a84c;border-radius:10px;background:#fdf8ee;margin-bottom:14px;">
                  <tr>
                    <td style="padding:12px 14px;font-family:Arial,sans-serif;font-size:13px;color:#1a0a0a;line-height:1.8;">
                      <div><strong style="color:#8b6914;">Entry number:</strong> ${safeEntryNumber} of 2</div>
                      <div><strong style="color:#8b6914;">Parent email:</strong> ${safeParentEmail}</div>
                      <div><strong style="color:#8b6914;">Parent phone:</strong> ${safeParentPhone}</div>
                      <div><strong style="color:#8b6914;">Student:</strong> ${safeStudentName}</div>
                      <div><strong style="color:#8b6914;">Payment:</strong> ${safePaidAmount || 'Not required'}</div>
                      ${safePaymentIntentId ? `<div><strong style="color:#8b6914;">Payment ID:</strong> ${safePaymentIntentId}</div>` : ''}
                    </td>
                  </tr>
                </table>
                <div style="font-family:Arial,sans-serif;font-size:12px;font-weight:700;color:#8b6914;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.8px;">Message</div>
                <div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.7;color:#3d2020;border:1px solid #e8dfc8;border-radius:10px;background:#fff;padding:12px 14px;white-space:pre-wrap;">${safeMessage}</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;

  await transporter.sendMail({
    from: env.SMTP_FROM,
    to: parentEmail,
    subject: `Shout Out submitted - ${payload.studentName} (${payload.showTitle})`,
    text,
    html
  });
}

export async function sendTripLoginCodeEmail(payload: TripLoginCodeEmailPayload): Promise<void> {
  if (!transporter || !env.SMTP_FROM) {
    console.warn('SMTP is not configured; skipping trip login code email send.');
    return;
  }

  const recipient = payload.email.trim().toLowerCase();
  const safeName = escapeHtml(payload.accountName?.trim() || 'Family');
  const safeCode = escapeHtml(payload.code);
  const expiryLabel = formatTripCodeExpiry(payload.expiresAt);
  const safeExpiry = escapeHtml(expiryLabel);

  const text = [
    `Hi ${payload.accountName?.trim() || 'Family'},`,
    '',
    `Your Penncrest Theater trip portal sign-in code is: ${payload.code}`,
    `This code expires at ${expiryLabel}.`,
    '',
    'If you did not request this, you can ignore this message.'
  ].join('\n');

  const html = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
            <tr>
              <td style="background:#1a0505;border-radius:14px 14px 0 0;padding:20px;">
                <div style="font-family:Arial,sans-serif;font-size:10px;letter-spacing:2px;text-transform:uppercase;color:#c9a84c;margin-bottom:8px;">${BRAND_NAME}</div>
                <div style="font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:700;color:#f5f0e8;line-height:1.2;">Trip Payments Sign-In Code</div>
              </td>
            </tr>
            <tr>
              <td style="background:#fffdf7;border:1px solid #e8dfc8;border-top:none;border-radius:0 0 14px 14px;padding:22px;">
                <p style="margin:0 0 12px 0;font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#3d2020;">Hi ${safeName},</p>
                <p style="margin:0 0 12px 0;font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#3d2020;">Use this one-time code to sign in:</p>
                <div style="font-family:Arial,sans-serif;font-size:34px;letter-spacing:5px;font-weight:700;color:#8b1a1a;margin:4px 0 14px 0;">${safeCode}</div>
                <p style="margin:0 0 8px 0;font-family:Arial,sans-serif;font-size:13px;color:#5a3a1a;">Expires: ${safeExpiry}</p>
                <p style="margin:0;font-family:Arial,sans-serif;font-size:12px;color:#6f5a44;">If you did not request this code, you can ignore this email.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;

  await transporter.sendMail({
    from: env.SMTP_FROM,
    to: recipient,
    subject: 'Your Penncrest Theater trip sign-in code',
    text,
    html
  });
}

export async function sendSystemAlertEmail(payload: SystemAlertEmailPayload): Promise<void> {
  if (!transporter || !env.SMTP_FROM) {
    console.warn('SMTP is not configured; skipping system alert email send.');
    return;
  }

  const recipients = Array.isArray(payload.to) ? payload.to : [payload.to];
  const normalizedRecipients = recipients.map((recipient) => recipient.trim().toLowerCase()).filter(Boolean);
  if (normalizedRecipients.length === 0) {
    console.warn('No recipients configured; skipping system alert email send.');
    return;
  }

  await transporter.sendMail({
    from: env.SMTP_FROM,
    to: normalizedRecipients.join(','),
    subject: payload.subject,
    text: payload.text,
    html: payload.html
  });
}
