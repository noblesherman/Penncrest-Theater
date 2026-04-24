/*
Handoff note for Mr. Smith:
- File: `backend/src/lib/email.ts`
- What this is: Backend shared utility module.
- What it does: Provides reusable helpers for auth, crypto, storage, content, and data transforms.
- Connections: Imported by routes/services/jobs across the backend.
- Main content type: Shared behavior/utilities.
- Safe edits here: Additive helpers and local docs with stable exports.
- Be careful with: Changing helper semantics used by multiple domains.
- Useful context: Cross-feature bugs often trace back to a shared lib helper like this.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

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
  orderAccessToken?: string | null;
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

export type AudienceBroadcastEmailPayload = {
  toEmail: string;
  recipientName?: string | null;
  subject: string;
  previewText?: string | null;
  headline: string;
  body: string;
  callToActionLabel?: string | null;
  callToActionUrl?: string | null;
  audienceLabel: string;
  audienceStartsAtIso?: string | null;
  audienceVenue?: string | null;
  includeEventDetails?: boolean;
  signature?: string | null;
};

type EmailLogoAttachment = {
  filename: string;
  content: Buffer;
  contentType: string;
  cid: string;
};

const BRAND_NAME = 'Penncrest Theater';
const NO_REPLY_FROM = 'Penncrest Theater <no-reply@penncresttheater.com>';
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

// Shared dark-mode style block injected into every HTML email
const DARK_MODE_STYLES = `
  <style>
    @media (prefers-color-scheme: dark) {
      .email-outer   { background-color: #1a1108 !important; }
      .email-body    { background-color: #251a0a !important; border-color: #4a3820 !important; }
      .email-body p,
      .email-body div { color: #e8dfc8 !important; }
      .detail-box    { background-color: #2e1f0a !important; border-color: #8b6914 !important; }
      .detail-label  { color: #c9a84c !important; }
      .detail-value  { color: #f0e6cc !important; }
      .ticket-row    { background-color: #2e1f0a !important; border-color: #8b6914 !important; }
      .ticket-meta   { color: #c9a84c !important; }
      .wallet-box    { background-color: #2e1f0a !important; border-color: #8b6914 !important; }
      .tip-box       { background-color: #2e1f0a !important; }
      .msg-box       { background-color: #2e1f0a !important; border-color: #4a3820 !important; color: #e8dfc8 !important; }
      .section-label { color: #c9a84c !important; }
    }
    /* Prevent iOS / Gmail auto-resizing tiny text */
    body { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
  </style>
`;

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
  const walletUrl = payload.orderAccessToken
    ? `${env.APP_BASE_URL}/confirmation?${new URLSearchParams({
        orderId: payload.orderId,
        token: payload.orderAccessToken
      }).toString()}`
    : null;
  const safeWalletUrl = walletUrl ? escapeHtml(walletUrl) : null;

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
    walletUrl ? 'Open all tickets (wallet):' : null,
    walletUrl || null,
    walletUrl ? '' : null,
    'Individual ticket links (fallback):',
    ticketLines,
    '',
    `Thanks for supporting ${BRAND_NAME}.`,
    'See you at the show!'
  ]
    .filter(Boolean)
    .join('\n');

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
            <table class="ticket-row" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #c9a84c;border-radius:11px;background:#fffdf7;overflow:hidden;">
              <tr>
                <td style="padding:8px 16px;background:#8b1a1a;">
                  <div class="ticket-meta" style="font-family:Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:1.4px;color:#f5d98b;text-transform:uppercase;">${seatLabel}</div>
                </td>
              </tr>
              <tr>
                <td style="padding:14px 16px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="font-family:Arial,sans-serif;font-size:13px;color:#5a3a1a;vertical-align:middle;line-height:1.4;">${typeLabel}${attendee}</td>
                      <td align="right" style="vertical-align:middle;padding-left:12px;">
                        <a href="${safeLink}" style="display:inline-block;background:#8b1a1a;color:#f5d98b;text-decoration:none;padding:9px 18px;border-radius:8px;font-size:12px;font-weight:700;font-family:Arial,sans-serif;border:1px solid #c9a84c;white-space:nowrap;letter-spacing:0.3px;">Open My Ticket</a>
                      </td>
                    </tr>
                  </table>
                  <div style="font-size:11px;color:#9b8365;line-height:1.5;margin-top:9px;word-break:break-all;font-family:Arial,sans-serif;">${safeLink}</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      `;
    })
    .join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light dark" />
  <meta name="supported-color-schemes" content="light dark" />
  ${DARK_MODE_STYLES}
</head>
<body style="margin:0;padding:0;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px;">
      Your Penncrest Theater tickets are ready. Open all tickets in one wallet link.&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
    </div>
    <table class="email-outer" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;">

            <!-- HEADER -->
            <tr>
              <td style="background:linear-gradient(160deg,#1a0505 0%,#3d0a0a 60%,#5a1010 100%);border-radius:16px 16px 0 0;padding:32px 32px 28px 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td valign="middle">
                      <div style="font-family:Arial,sans-serif;font-size:10px;letter-spacing:2.5px;text-transform:uppercase;color:#c9a84c;margin-bottom:10px;">${BRAND_NAME}</div>
                      <div style="font-family:Georgia,'Times New Roman',serif;font-size:30px;font-weight:700;color:#f5f0e8;line-height:1.2;margin-bottom:10px;">You&rsquo;re going to the show!</div>
                      <div style="font-family:Georgia,'Times New Roman',serif;font-size:14px;font-style:italic;color:rgba(245,217,139,0.80);line-height:1.6;">Your tickets are confirmed and waiting for you.</div>
                    </td>
                    <td valign="middle" align="right" style="padding-left:16px;min-width:84px;">
                      ${
                        logoSrc
                          ? `<img src="${logoSrc}" width="76" height="76" alt="${BRAND_NAME} logo" style="display:block;width:76px;height:76px;object-fit:contain;border-radius:12px;border:2px solid #c9a84c;background:#3d0a0a;padding:5px;box-sizing:border-box;" />`
                          : `<table role="presentation" cellpadding="0" cellspacing="0" width="76" style="width:76px;height:76px;border-radius:12px;border:2px solid #c9a84c;background:#5a1010;"><tr><td width="76" height="76" align="center" valign="middle" style="width:76px;height:76px;text-align:center;vertical-align:middle;font-size:34px;font-family:'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif;">&#127917;</td></tr></table>`
                      }
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- GOLD DIVIDER -->
            <tr>
              <td style="height:3px;background:linear-gradient(90deg,#6b0f0f,#c9a84c,#6b0f0f);"></td>
            </tr>

            <!-- BODY -->
            <tr>
              <td class="email-body" style="background:#fffdf7;padding:28px 32px 10px 32px;border:1px solid #e8dfc8;border-top:none;">

                <p style="margin:0 0 8px 0;font-size:17px;line-height:1.5;font-family:Georgia,serif;color:#1a0a0a;">Hey ${safeCustomerName}!</p>
                <p style="margin:0 0 14px 0;font-size:14px;line-height:1.8;font-family:Arial,sans-serif;color:#3d2020;">
                  We are so excited to have you join us for <strong style="color:#8b1a1a;">${safeShowTitle}</strong>. Our cast and crew have been working incredibly hard, and we can&rsquo;t wait to share this show with you.
                </p>
                <p style="margin:0 0 20px 0;font-size:14px;line-height:1.8;font-family:Arial,sans-serif;color:#3d2020;">
                  Here&rsquo;s everything you need for the big night:
                </p>

                <!-- SHOW DETAILS BOX -->
                <table class="detail-box" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #c9a84c;border-radius:12px;background:#fdf8ee;margin-bottom:24px;">
                  <tr>
                    <td style="padding:7px 18px;background:#c9a84c;border-radius:11px 11px 0 0;">
                      <div style="font-family:Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#3d1a00;">Show Details</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:16px 18px;font-family:Arial,sans-serif;font-size:13px;line-height:1;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                          <td class="detail-label" style="color:#8b6914;font-weight:700;width:110px;vertical-align:top;padding-bottom:10px;">When</td>
                          <td class="detail-value" style="color:#1a0a0a;padding-bottom:10px;line-height:1.5;">${escapeHtml(startsAt)}</td>
                        </tr>
                        <tr>
                          <td class="detail-label" style="color:#8b6914;font-weight:700;vertical-align:top;padding-bottom:10px;">Where</td>
                          <td class="detail-value" style="color:#1a0a0a;padding-bottom:10px;">${safeVenue}</td>
                        </tr>
                        <tr>
                          <td class="detail-label" style="color:#8b6914;font-weight:700;vertical-align:top;padding-bottom:10px;">Order ID</td>
                          <td class="detail-value" style="color:#1a0a0a;padding-bottom:10px;font-size:12px;letter-spacing:0.4px;">${safeOrderId}</td>
                        </tr>
                        <tr>
                          <td class="detail-label" style="color:#8b6914;font-weight:700;vertical-align:top;">Email</td>
                          <td class="detail-value" style="color:#1a0a0a;">${safeCustomerEmail}</td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>

                ${
                  safeWalletUrl
                    ? `
                <table class="wallet-box" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:22px;">
                  <tr>
                    <td style="border:1px solid #c9a84c;border-radius:12px;background:#fff8e8;padding:18px 18px 16px;">
                      <div style="font-family:Arial,sans-serif;font-size:10px;font-weight:700;color:#8b6914;margin-bottom:6px;text-transform:uppercase;letter-spacing:1.2px;">Open All Tickets</div>
                      <div style="font-family:Arial,sans-serif;font-size:13px;color:#3d2020;line-height:1.65;margin-bottom:14px;">Use one wallet link to swipe through every ticket in this order &mdash; no need to open them individually.</div>
                      <a href="${safeWalletUrl}" style="display:inline-block;background:#8b1a1a;color:#f5d98b;text-decoration:none;padding:11px 20px;border-radius:8px;font-size:13px;font-weight:700;font-family:Arial,sans-serif;border:1px solid #c9a84c;letter-spacing:0.3px;">Open All Tickets &rarr;</a>
                      <div style="font-size:11px;color:#9b8365;line-height:1.5;margin-top:12px;word-break:break-all;font-family:Arial,sans-serif;">${safeWalletUrl}</div>
                    </td>
                  </tr>
                </table>
                `
                    : ''
                }

                <!-- TICKETS SECTION LABEL -->
                <div class="section-label" style="font-family:Georgia,serif;font-size:15px;font-weight:700;color:#1a0a0a;margin-bottom:12px;">
                  Individual ticket links
                </div>

                <!-- TICKETS -->
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  ${htmlTickets}
                </table>

                <!-- TIP BOX -->
                <table class="tip-box" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                  <tr>
                    <td style="border-left:3px solid #c9a84c;padding:13px 16px;background:#fdf8ee;border-radius:0 10px 10px 0;">
                      <div style="font-family:Arial,sans-serif;font-size:10px;font-weight:700;color:#8b6914;margin-bottom:5px;text-transform:uppercase;letter-spacing:1px;">Quick tip</div>
                      <div style="font-family:Arial,sans-serif;font-size:13px;color:#3d2020;line-height:1.7;">Pull up your ticket links before you arrive &mdash; each one has a QR code for easy entry. Doors open 30&nbsp;minutes before showtime.</div>
                    </td>
                  </tr>
                </table>

              </td>
            </tr>

            <!-- FOOTER DIVIDER -->
            <tr>
              <td style="height:3px;background:linear-gradient(90deg,#6b0f0f,#c9a84c,#6b0f0f);"></td>
            </tr>

            <!-- FOOTER -->
            <tr>
              <td style="background:linear-gradient(160deg,#1a0505 0%,#3d0a0a 100%);border-radius:0 0 16px 16px;padding:20px 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td>
                      <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;line-height:1.7;color:rgba(245,240,232,0.80);">Thank you for supporting the students of ${BRAND_NAME}.<br/>See you opening night!</p>
                    </td>
                    <td align="right" valign="middle" style="padding-left:16px;">
                      <div style="font-family:Georgia,serif;font-size:22px;color:#c9a84c;">&#127914;</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
</body>
</html>`;

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

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light dark" />
  <meta name="supported-color-schemes" content="light dark" />
  ${DARK_MODE_STYLES}
</head>
<body style="margin:0;padding:0;">
    <table class="email-outer" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;">
            <tr>
              <td style="background:linear-gradient(160deg,#1a0505 0%,#3d0a0a 100%);border-radius:16px 16px 0 0;padding:32px 32px 28px;">
                <div style="font-family:Arial,sans-serif;font-size:10px;letter-spacing:2.5px;text-transform:uppercase;color:#c9a84c;margin-bottom:10px;">${BRAND_NAME}</div>
                <div style="font-family:Georgia,'Times New Roman',serif;font-size:30px;font-weight:700;color:#f5f0e8;line-height:1.2;margin-bottom:10px;">Thank You</div>
                <div style="font-family:Arial,sans-serif;font-size:14px;color:rgba(245,217,139,0.80);line-height:1.65;">Your donation helps our students build incredible productions.</div>
              </td>
            </tr>
            <tr>
              <td style="height:3px;background:linear-gradient(90deg,#6b0f0f,#c9a84c,#6b0f0f);"></td>
            </tr>
            <tr>
              <td class="email-body" style="background:#fffdf7;border:1px solid #e8dfc8;border-top:none;padding:28px 32px 24px;">
                <p style="margin:0 0 12px 0;font-family:Georgia,'Times New Roman',serif;font-size:18px;color:#1a0a0a;">Hi ${safeDonorName},</p>
                <p style="margin:0 0 16px 0;font-family:Arial,sans-serif;font-size:14px;line-height:1.8;color:#3d2020;">
                  Thank you for your generous donation to ${BRAND_NAME}. We truly appreciate your support.
                </p>
                <table class="detail-box" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #c9a84c;border-radius:12px;background:#fdf8ee;margin-bottom:16px;">
                  <tr>
                    <td style="padding:7px 18px;background:#c9a84c;border-radius:11px 11px 0 0;">
                      <div style="font-family:Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#3d1a00;">Donation Details</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:16px 18px;font-family:Arial,sans-serif;font-size:13px;line-height:1;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                          <td class="detail-label" style="color:#8b6914;font-weight:700;width:130px;vertical-align:top;padding-bottom:10px;">Amount</td>
                          <td class="detail-value" style="color:#1a0a0a;padding-bottom:10px;">${safeAmountLabel}</td>
                        </tr>
                        <tr>
                          <td class="detail-label" style="color:#8b6914;font-weight:700;vertical-align:top;padding-bottom:10px;">Donation ID</td>
                          <td class="detail-value" style="color:#1a0a0a;padding-bottom:10px;font-size:12px;letter-spacing:0.4px;">${safeDonationId}</td>
                        </tr>
                        <tr>
                          <td class="detail-label" style="color:#8b6914;font-weight:700;vertical-align:top;">Receipt email</td>
                          <td class="detail-value" style="color:#1a0a0a;">${safeDonorEmail}</td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
                <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;line-height:1.7;color:#3d2020;">
                  Stripe also sent your official payment receipt to your email address.
                </p>
              </td>
            </tr>
            <tr>
              <td style="height:3px;background:linear-gradient(90deg,#6b0f0f,#c9a84c,#6b0f0f);"></td>
            </tr>
            <tr>
              <td style="background:linear-gradient(160deg,#1a0505 0%,#3d0a0a 100%);border-radius:0 0 16px 16px;padding:18px 32px;">
                <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;line-height:1.7;color:rgba(245,240,232,0.80);">With gratitude &mdash; ${BRAND_NAME}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
</body>
</html>`;

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

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light dark" />
  <meta name="supported-color-schemes" content="light dark" />
  ${DARK_MODE_STYLES}
</head>
<body style="margin:0;padding:0;">
    <table class="email-outer" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;">
            <tr>
              <td style="background:linear-gradient(160deg,#1a0505 0%,#3d0a0a 100%);border-radius:16px 16px 0 0;padding:32px 32px 28px;">
                <div style="font-family:Arial,sans-serif;font-size:10px;letter-spacing:2.5px;text-transform:uppercase;color:#c9a84c;margin-bottom:10px;">${BRAND_NAME}</div>
                <div style="font-family:Georgia,'Times New Roman',serif;font-size:30px;font-weight:700;color:#f5f0e8;line-height:1.2;margin-bottom:10px;">Shout Out Received</div>
                <div style="font-family:Arial,sans-serif;font-size:14px;color:rgba(245,217,139,0.80);line-height:1.65;">Your playbill shout-out has been submitted successfully.</div>
              </td>
            </tr>
            <tr>
              <td style="height:3px;background:linear-gradient(90deg,#6b0f0f,#c9a84c,#6b0f0f);"></td>
            </tr>
            <tr>
              <td class="email-body" style="background:#fffdf7;border:1px solid #e8dfc8;border-top:none;padding:28px 32px 24px;">
                <p style="margin:0 0 12px 0;font-family:Georgia,'Times New Roman',serif;font-size:18px;color:#1a0a0a;">Hi ${safeParentName},</p>
                <p style="margin:0 0 18px 0;font-family:Arial,sans-serif;font-size:14px;line-height:1.8;color:#3d2020;">
                  We received your shout out for <strong>${safeStudentName}</strong> in <strong>${safeShowTitle}</strong>.
                </p>
                <table class="detail-box" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #c9a84c;border-radius:12px;background:#fdf8ee;margin-bottom:20px;">
                  <tr>
                    <td style="padding:7px 18px;background:#c9a84c;border-radius:11px 11px 0 0;">
                      <div style="font-family:Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#3d1a00;">Submission Details</div>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:16px 18px;font-family:Arial,sans-serif;font-size:13px;line-height:1;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                          <td class="detail-label" style="color:#8b6914;font-weight:700;width:130px;vertical-align:top;padding-bottom:10px;">Entry</td>
                          <td class="detail-value" style="color:#1a0a0a;padding-bottom:10px;">${safeEntryNumber} of 2</td>
                        </tr>
                        <tr>
                          <td class="detail-label" style="color:#8b6914;font-weight:700;vertical-align:top;padding-bottom:10px;">Parent email</td>
                          <td class="detail-value" style="color:#1a0a0a;padding-bottom:10px;">${safeParentEmail}</td>
                        </tr>
                        <tr>
                          <td class="detail-label" style="color:#8b6914;font-weight:700;vertical-align:top;padding-bottom:10px;">Parent phone</td>
                          <td class="detail-value" style="color:#1a0a0a;padding-bottom:10px;">${safeParentPhone}</td>
                        </tr>
                        <tr>
                          <td class="detail-label" style="color:#8b6914;font-weight:700;vertical-align:top;padding-bottom:10px;">Student</td>
                          <td class="detail-value" style="color:#1a0a0a;padding-bottom:10px;">${safeStudentName}</td>
                        </tr>
                        <tr>
                          <td class="detail-label" style="color:#8b6914;font-weight:700;vertical-align:top;${safePaymentIntentId ? 'padding-bottom:10px;' : ''}">Payment</td>
                          <td class="detail-value" style="color:#1a0a0a;${safePaymentIntentId ? 'padding-bottom:10px;' : ''}">${safePaidAmount || 'Not required'}</td>
                        </tr>
                        ${safePaymentIntentId ? `
                        <tr>
                          <td class="detail-label" style="color:#8b6914;font-weight:700;vertical-align:top;">Payment ID</td>
                          <td class="detail-value" style="color:#1a0a0a;font-size:12px;letter-spacing:0.4px;">${safePaymentIntentId}</td>
                        </tr>` : ''}
                      </table>
                    </td>
                  </tr>
                </table>
                <div class="section-label" style="font-family:Arial,sans-serif;font-size:10px;font-weight:700;color:#8b6914;margin-bottom:8px;text-transform:uppercase;letter-spacing:1.2px;">Message</div>
                <div class="msg-box" style="font-family:Arial,sans-serif;font-size:13px;line-height:1.75;color:#3d2020;border:1px solid #e8dfc8;border-radius:10px;background:#fff;padding:14px 16px;white-space:pre-wrap;">${safeMessage}</div>
              </td>
            </tr>
            <tr>
              <td style="height:3px;background:linear-gradient(90deg,#6b0f0f,#c9a84c,#6b0f0f);"></td>
            </tr>
            <tr>
              <td style="background:linear-gradient(160deg,#1a0505 0%,#3d0a0a 100%);border-radius:0 0 16px 16px;padding:18px 32px;">
                <p style="margin:0;font-family:Arial,sans-serif;font-size:13px;line-height:1.7;color:rgba(245,240,232,0.80);">Thank you for supporting ${BRAND_NAME}.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
</body>
</html>`;

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

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light dark" />
  <meta name="supported-color-schemes" content="light dark" />
  ${DARK_MODE_STYLES}
</head>
<body style="margin:0;padding:0;">
    <table class="email-outer" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
            <tr>
              <td style="background:#1a0505;border-radius:16px 16px 0 0;padding:28px 32px 24px;">
                <div style="font-family:Arial,sans-serif;font-size:10px;letter-spacing:2.5px;text-transform:uppercase;color:#c9a84c;margin-bottom:10px;">${BRAND_NAME}</div>
                <div style="font-family:Georgia,'Times New Roman',serif;font-size:26px;font-weight:700;color:#f5f0e8;line-height:1.2;">Trip Payments Sign-In Code</div>
              </td>
            </tr>
            <tr>
              <td style="height:3px;background:linear-gradient(90deg,#6b0f0f,#c9a84c,#6b0f0f);"></td>
            </tr>
            <tr>
              <td class="email-body" style="background:#fffdf7;border:1px solid #e8dfc8;border-top:none;border-radius:0 0 16px 16px;padding:28px 32px 24px;">
                <p style="margin:0 0 14px 0;font-family:Arial,sans-serif;font-size:14px;line-height:1.7;color:#3d2020;">Hi ${safeName},</p>
                <p style="margin:0 0 14px 0;font-family:Arial,sans-serif;font-size:14px;line-height:1.7;color:#3d2020;">Use this one-time code to sign in to the trip portal:</p>
                <div style="font-family:'Courier New',Courier,monospace;font-size:38px;letter-spacing:8px;font-weight:700;color:#8b1a1a;margin:4px 0 18px 0;line-height:1;">${safeCode}</div>
                <p style="margin:0 0 10px 0;font-family:Arial,sans-serif;font-size:13px;color:#5a3a1a;line-height:1.6;">Expires: <strong>${safeExpiry}</strong></p>
                <p style="margin:0;font-family:Arial,sans-serif;font-size:12px;color:#9b8365;line-height:1.6;">If you did not request this code, you can safely ignore this email.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
</body>
</html>`;

  await transporter.sendMail({
    from: env.SMTP_FROM,
    to: recipient,
    subject: 'Your Penncrest Theater trip sign-in code',
    text,
    html
  });
}

function paragraphsFromBody(body: string): string[] {
  return body
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function paragraphToHtml(text: string): string {
  return escapeHtml(text).replace(/\n/g, '<br />');
}

export async function sendAudienceBroadcastEmail(payload: AudienceBroadcastEmailPayload): Promise<void> {
  if (!transporter || !env.SMTP_FROM) {
    console.warn('SMTP is not configured; skipping audience broadcast email send.');
    return;
  }

  const recipient = payload.toEmail.trim().toLowerCase();
  if (!recipient) {
    return;
  }

  const safeRecipientName = escapeHtml(payload.recipientName?.trim() || 'there');
  const safeAudienceLabel = escapeHtml(payload.audienceLabel.trim());
  const safeHeadline = escapeHtml(payload.headline.trim());
  const safeSubject = payload.subject.trim();
  const safePreviewText = escapeHtml(payload.previewText?.trim() || '');
  const safeVenue = payload.audienceVenue?.trim() ? escapeHtml(payload.audienceVenue.trim()) : null;
  const startsAtLabel = payload.audienceStartsAtIso ? formatPerformanceDate(payload.audienceStartsAtIso) : null;
  const safeStartsAt = startsAtLabel ? escapeHtml(startsAtLabel) : null;
  const signatureText = payload.signature?.trim() || BRAND_NAME;
  const safeSignature = escapeHtml(signatureText);
  const includeEventDetails = payload.includeEventDetails !== false;
  const logo = loadEmailLogoAttachment();
  const logoSrc = logo ? `cid:${logo.cid}` : null;
  const paragraphs = paragraphsFromBody(payload.body.trim());
  const htmlParagraphs = paragraphs
    .map(
      (paragraph) => `
        <p style="margin:0 0 14px 0;font-family:Arial,sans-serif;font-size:14px;line-height:1.8;color:#3d2020;">
          ${paragraphToHtml(paragraph)}
        </p>
      `
    )
    .join('');
  const ctaLabel = payload.callToActionLabel?.trim() || '';
  const ctaUrl = payload.callToActionUrl?.trim() || '';
  const hasCallToAction = Boolean(ctaLabel && ctaUrl);
  const safeCtaLabel = hasCallToAction ? escapeHtml(ctaLabel) : '';
  const safeCtaUrl = hasCallToAction ? escapeHtml(ctaUrl) : '';

  const text = [
    `Hi ${payload.recipientName?.trim() || 'there'},`,
    '',
    payload.headline.trim(),
    '',
    payload.body.trim(),
    '',
    includeEventDetails ? `Event: ${payload.audienceLabel}` : null,
    includeEventDetails && startsAtLabel ? `When: ${startsAtLabel}` : null,
    includeEventDetails && payload.audienceVenue ? `Where: ${payload.audienceVenue}` : null,
    '',
    hasCallToAction ? `${ctaLabel}: ${ctaUrl}` : null,
    '',
    signatureText
  ]
    .filter((line) => line !== null)
    .join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light dark" />
  <meta name="supported-color-schemes" content="light dark" />
  ${DARK_MODE_STYLES}
</head>
<body style="margin:0;padding:0;">
  ${
    safePreviewText
      ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px;">${safePreviewText}</div>`
      : ''
  }
  <table class="email-outer" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8;padding:28px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;">
          <tr>
            <td style="background:linear-gradient(160deg,#1a0505 0%,#3d0a0a 60%,#5a1010 100%);border-radius:16px 16px 0 0;padding:30px 32px 26px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td valign="middle">
                    <div style="font-family:Arial,sans-serif;font-size:10px;letter-spacing:2.5px;text-transform:uppercase;color:#c9a84c;margin-bottom:10px;">${BRAND_NAME}</div>
                    <div style="font-family:Georgia,'Times New Roman',serif;font-size:28px;font-weight:700;color:#f5f0e8;line-height:1.2;margin-bottom:8px;">${safeAudienceLabel}</div>
                    <div style="font-family:Arial,sans-serif;font-size:13px;color:rgba(245,217,139,0.85);line-height:1.65;">Message for ticket holders</div>
                  </td>
                  <td valign="middle" align="right" style="padding-left:16px;min-width:84px;">
                    ${
                      logoSrc
                        ? `<img src="${logoSrc}" width="74" height="74" alt="${BRAND_NAME} logo" style="display:block;width:74px;height:74px;object-fit:contain;border-radius:12px;border:2px solid #c9a84c;background:#3d0a0a;padding:5px;box-sizing:border-box;" />`
                        : `<table role="presentation" cellpadding="0" cellspacing="0" width="74" style="width:74px;height:74px;border-radius:12px;border:2px solid #c9a84c;background:#5a1010;"><tr><td width="74" height="74" align="center" valign="middle" style="width:74px;height:74px;text-align:center;vertical-align:middle;font-size:30px;font-family:'Apple Color Emoji','Segoe UI Emoji','Noto Color Emoji',sans-serif;">&#127917;</td></tr></table>`
                    }
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="height:3px;background:linear-gradient(90deg,#6b0f0f,#c9a84c,#6b0f0f);"></td>
          </tr>
          <tr>
            <td class="email-body" style="background:#fffdf7;border:1px solid #e8dfc8;border-top:none;padding:28px 32px 12px;">
              <p style="margin:0 0 10px 0;font-family:Georgia,'Times New Roman',serif;font-size:19px;color:#1a0a0a;line-height:1.4;">Hi ${safeRecipientName},</p>
              <p style="margin:0 0 18px 0;font-family:Georgia,'Times New Roman',serif;font-size:23px;color:#8b1a1a;line-height:1.35;">${safeHeadline}</p>

              ${htmlParagraphs}

              ${
                includeEventDetails && (safeStartsAt || safeVenue)
                  ? `
              <table class="detail-box" role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #c9a84c;border-radius:12px;background:#fdf8ee;margin:14px 0 20px;">
                <tr>
                  <td style="padding:7px 18px;background:#c9a84c;border-radius:11px 11px 0 0;">
                    <div style="font-family:Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#3d1a00;">Event Details</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:16px 18px;font-family:Arial,sans-serif;font-size:13px;line-height:1;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      ${
                        safeStartsAt
                          ? `
                      <tr>
                        <td class="detail-label" style="color:#8b6914;font-weight:700;width:90px;vertical-align:top;padding-bottom:${safeVenue ? '10px' : '0'};">When</td>
                        <td class="detail-value" style="color:#1a0a0a;padding-bottom:${safeVenue ? '10px' : '0'};line-height:1.6;">${safeStartsAt}</td>
                      </tr>`
                          : ''
                      }
                      ${
                        safeVenue
                          ? `
                      <tr>
                        <td class="detail-label" style="color:#8b6914;font-weight:700;vertical-align:top;">Where</td>
                        <td class="detail-value" style="color:#1a0a0a;line-height:1.6;">${safeVenue}</td>
                      </tr>`
                          : ''
                      }
                    </table>
                  </td>
                </tr>
              </table>`
                  : ''
              }

              ${
                hasCallToAction
                  ? `
              <div style="margin:0 0 20px 0;">
                <a href="${safeCtaUrl}" style="display:inline-block;background:#8b1a1a;color:#f5d98b;text-decoration:none;padding:11px 20px;border-radius:8px;font-size:13px;font-weight:700;font-family:Arial,sans-serif;border:1px solid #c9a84c;letter-spacing:0.3px;">${safeCtaLabel} &rarr;</a>
                <div style="font-size:11px;color:#9b8365;line-height:1.6;margin-top:10px;word-break:break-all;font-family:Arial,sans-serif;">${safeCtaUrl}</div>
              </div>`
                  : ''
              }

              <p style="margin:0 0 18px 0;font-family:Arial,sans-serif;font-size:14px;color:#3d2020;">${safeSignature}</p>
            </td>
          </tr>
          <tr>
            <td style="height:3px;background:linear-gradient(90deg,#6b0f0f,#c9a84c,#6b0f0f);"></td>
          </tr>
          <tr>
            <td style="background:linear-gradient(160deg,#1a0505 0%,#3d0a0a 100%);border-radius:0 0 16px 16px;padding:18px 32px;">
              <p style="margin:0;font-family:Arial,sans-serif;font-size:12px;line-height:1.7;color:rgba(245,240,232,0.80);">
                This message was sent by ${BRAND_NAME}. Replies are not monitored.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  await transporter.sendMail({
    from: NO_REPLY_FROM,
    to: recipient,
    subject: safeSubject,
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
