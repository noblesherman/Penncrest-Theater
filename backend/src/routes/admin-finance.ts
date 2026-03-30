import { FastifyPluginAsync } from 'fastify';
import Stripe from 'stripe';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { env } from '../lib/env.js';
import { prisma } from '../lib/prisma.js';
import { stripe } from '../lib/stripe.js';
import { handleRouteError } from '../lib/route-error.js';
import { HttpError } from '../lib/http-error.js';
import { logAudit } from '../lib/audit-log.js';

const financeQuerySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  performanceId: z.string().min(1).optional(),
  includeCompOrders: z.enum(['1', '0', 'true', 'false']).default('1')
});

const stripeReportDownloadQuerySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reportTypeId: z.string().min(1).optional()
});

const sendInvoiceLineItemSchema = z.object({
  description: z.string().trim().min(1).max(240),
  quantity: z.number().int().min(1).max(1000),
  unitAmountCents: z.number().int().min(1).max(2_500_000)
});

const sendInvoiceSchema = z
  .object({
    customerEmail: z.string().trim().email(),
    customerName: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(400),
    customerNote: z.string().trim().max(2000).optional(),
    amountCents: z.number().int().min(50).max(2_500_000).optional(),
    lineItems: z.array(sendInvoiceLineItemSchema).min(1).max(25).optional(),
    dueInDays: z.number().int().min(1).max(90).default(30)
  })
  .refine((value) => {
    return Boolean(value.amountCents && value.amountCents > 0) || Boolean(value.lineItems?.length);
  }, {
    message: 'Provide either amountCents or at least one line item',
    path: ['lineItems']
  });

const financeInvoiceListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(40),
  status: z.enum(['all', 'draft', 'open', 'paid', 'void', 'uncollectible']).default('all'),
  q: z.string().trim().max(160).optional()
});

const financeInvoiceParamsSchema = z.object({
  invoiceId: z.string().trim().min(1)
});

const STRIPE_ITEMIZED_BALANCE_PREFIX = 'balance_change_from_activity.itemized.';
const STRIPE_BALANCE_SUMMARY_PREFIX = 'balance.summary.';
const BRAND_NAME = 'Penncrest High School Theater';
const BRAND_ADDRESS_LINE = '134 Barren Rd, Media, PA 19063';
const BRAND_EMAIL = 'jsmith3@rtmsd.org';
const BRAND_WEB = 'www.penncresttheater.org';

let cachedLogoBuffer: Buffer | null | undefined;

type FinanceOrderRow = {
  id: string;
  createdAt: string;
  showTitle: string;
  performanceTitle: string;
  source: string;
  paymentMethodLabel: string;
  orderStatus: string;
  ticketCount: number;
  grossCents: number;
  refundCents: number;
  netCents: number;
};

type FinanceBreakdownRow = {
  key: string;
  label: string;
  orderCount: number;
  ticketCount: number;
  grossCents: number;
  refundCents: number;
  netCents: number;
};

type FinanceReportData = {
  stripeReportsUrl: string;
  generatedAtIso: string;
  startDate: string;
  endDate: string;
  includeCompOrders: boolean;
  performanceId: string | null;
  performanceLabel: string;
  totals: {
    orderCount: number;
    ticketCount: number;
    grossCents: number;
    refundCents: number;
    netCents: number;
    cashNetCents: number;
    cardNetCents: number;
  };
  paymentBreakdown: FinanceBreakdownRow[];
  sourceBreakdown: FinanceBreakdownRow[];
  orders: FinanceOrderRow[];
};

type PdfDocumentCtor = new (options?: Record<string, unknown>) => any;

function parseUtcBoundary(date: string, endOfDay: boolean): Date {
  const stamp = `${date}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`;
  const parsed = new Date(stamp);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, 'Invalid date range');
  }
  return parsed;
}

function parseUtcDayStart(date: string): Date {
  return parseUtcBoundary(date, false);
}

function parseUtcNextDayStart(date: string): Date {
  const start = parseUtcDayStart(date);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000);
}

function centsToDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function toIsoFromEpochSeconds(value: number | null | undefined): string | null {
  if (!value || value <= 0) return null;
  return new Date(value * 1000).toISOString();
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function getStripeReportsUrl(): string {
  return env.STRIPE_SECRET_KEY.startsWith('sk_test_')
    ? 'https://dashboard.stripe.com/test/reports'
    : 'https://dashboard.stripe.com/reports';
}

function safeFilenamePart(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
  return normalized || 'report';
}

function toUsd(valueInCents: number): string {
  return (valueInCents / 100).toFixed(2);
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function csvRow(values: unknown[]): string {
  return values.map((value) => csvCell(value)).join(',');
}

function mapInvoiceStatusToStage(status: Stripe.Invoice.Status | null): string {
  switch (status) {
    case 'paid':
      return 'paid';
    case 'open':
      return 'open';
    case 'void':
      return 'void';
    case 'uncollectible':
      return 'uncollectible';
    case 'draft':
      return 'draft';
    default:
      return 'unknown';
  }
}

function buildInvoiceProcess(invoice: Stripe.Invoice): {
  stage: string;
  createdAt: string;
  finalizedAt: string | null;
  sentAt: string | null;
  paidAt: string | null;
  voidedAt: string | null;
  markedUncollectibleAt: string | null;
} {
  const createdAt = toIsoFromEpochSeconds(invoice.created) || new Date().toISOString();
  const finalizedAt = toIsoFromEpochSeconds(invoice.status_transitions.finalized_at);
  return {
    stage: mapInvoiceStatusToStage(invoice.status),
    createdAt,
    finalizedAt,
    sentAt: invoice.collection_method === 'send_invoice' ? finalizedAt : null,
    paidAt: toIsoFromEpochSeconds(invoice.status_transitions.paid_at),
    voidedAt: toIsoFromEpochSeconds(invoice.status_transitions.voided_at),
    markedUncollectibleAt: toIsoFromEpochSeconds(invoice.status_transitions.marked_uncollectible_at)
  };
}

function loadBrandLogoBuffer(): Buffer | null {
  if (cachedLogoBuffer !== undefined) {
    return cachedLogoBuffer;
  }

  const routeDir = dirname(fileURLToPath(import.meta.url));
  const projectRoot = resolve(routeDir, '../../../');
  const candidates = [
    resolve(projectRoot, 'src/assets/penncrest-logo.jpeg'),
    resolve(projectRoot, 'src/assets/penncrest-logo.jpg'),
    resolve(projectRoot, 'src/assets/penncrest-logo.png')
  ];

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      cachedLogoBuffer = readFileSync(path);
      return cachedLogoBuffer;
    } catch {
    }
  }

  cachedLogoBuffer = null;
  return cachedLogoBuffer;
}

function latestStripeReportTypeIdByPrefix(
  reportTypes: Stripe.Reporting.ReportType[],
  prefix: string
): string | null {
  const candidates = reportTypes
    .filter((type) => type.id.startsWith(prefix))
    .map((type) => {
      const suffix = type.id.slice(prefix.length);
      const version = Number.parseInt(suffix, 10);
      return {
        id: type.id,
        version: Number.isFinite(version) ? version : -1
      };
    })
    .sort((a, b) => b.version - a.version);

  return candidates[0]?.id || null;
}

async function resolveStripeReportTypeId(preferredReportTypeId?: string): Promise<string> {
  if (preferredReportTypeId?.trim()) {
    return preferredReportTypeId.trim();
  }

  const reportTypes = await stripe.reporting.reportTypes
    .list({})
    .autoPagingToArray({ limit: 200 });

  const itemized = latestStripeReportTypeIdByPrefix(reportTypes, STRIPE_ITEMIZED_BALANCE_PREFIX);
  if (itemized) {
    return itemized;
  }

  const summary = latestStripeReportTypeIdByPrefix(reportTypes, STRIPE_BALANCE_SUMMARY_PREFIX);
  if (summary) {
    return summary;
  }

  const fallback = reportTypes[0]?.id;
  if (fallback) {
    return fallback;
  }

  throw new HttpError(502, 'Stripe report types were unavailable for this account');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForStripeReportRun(reportRunId: string): Promise<Stripe.Reporting.ReportRun> {
  const timeoutMs = 90_000;
  const pollMs = 1_500;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const run = await stripe.reporting.reportRuns.retrieve(reportRunId, { expand: ['result'] });
    if (run.status === 'succeeded') {
      return run;
    }
    if (run.status === 'failed') {
      throw new HttpError(400, run.error || 'Stripe report generation failed');
    }
    await sleep(pollMs);
  }

  throw new HttpError(
    504,
    'Stripe is still preparing this report. Try again in a minute or use a shorter date range.'
  );
}

async function findOrCreateInvoiceCustomer(params: {
  email: string;
  name: string;
}): Promise<Stripe.Customer> {
  const existing = await stripe.customers.list({
    email: params.email,
    limit: 1
  });
  const customer = existing.data[0];
  if (customer) {
    if (customer.name !== params.name) {
      return stripe.customers.update(customer.id, { name: params.name });
    }
    return customer;
  }
  return stripe.customers.create({
    email: params.email,
    name: params.name
  });
}

function labelForPaymentMethod(order: {
  source: string;
  inPersonPaymentMethod: string | null;
  amountTotal: number;
}): string {
  if (order.amountTotal <= 0) {
    return 'Comp/No charge';
  }
  if (order.source === 'DOOR') {
    return order.inPersonPaymentMethod === 'CASH' ? 'Cash' : 'Card';
  }
  return 'Card';
}

function mergeIntoBreakdown(
  map: Map<string, FinanceBreakdownRow>,
  key: string,
  label: string,
  values: { ticketCount: number; grossCents: number; refundCents: number; netCents: number }
): void {
  const existing = map.get(key);
  if (existing) {
    existing.orderCount += 1;
    existing.ticketCount += values.ticketCount;
    existing.grossCents += values.grossCents;
    existing.refundCents += values.refundCents;
    existing.netCents += values.netCents;
    return;
  }

  map.set(key, {
    key,
    label,
    orderCount: 1,
    ticketCount: values.ticketCount,
    grossCents: values.grossCents,
    refundCents: values.refundCents,
    netCents: values.netCents
  });
}

async function buildFinanceReportData(params: {
  startDate: string;
  endDate: string;
  performanceId?: string;
  includeCompOrders: boolean;
}): Promise<FinanceReportData> {
  const startsAt = parseUtcBoundary(params.startDate, false);
  const endsAt = parseUtcBoundary(params.endDate, true);
  if (startsAt > endsAt) {
    throw new HttpError(400, 'startDate must be on or before endDate');
  }

  const spanDays = (endsAt.getTime() - startsAt.getTime()) / (1000 * 60 * 60 * 24);
  if (spanDays > 370) {
    throw new HttpError(400, 'Date range cannot exceed 370 days');
  }

  const where: Prisma.OrderWhereInput = {
    createdAt: {
      gte: startsAt,
      lte: endsAt
    },
    status: {
      in: ['PAID', 'REFUNDED']
    },
    ...(params.performanceId ? { performanceId: params.performanceId } : {}),
    ...(params.includeCompOrders ? {} : { amountTotal: { gt: 0 } })
  };

  const orders = await prisma.order.findMany({
    where,
    orderBy: [{ createdAt: 'asc' }],
    include: {
      performance: {
        include: {
          show: true
        }
      },
      orderSeats: {
        select: {
          id: true
        }
      }
    }
  });

  const paymentBreakdownMap = new Map<string, FinanceBreakdownRow>();
  const sourceBreakdownMap = new Map<string, FinanceBreakdownRow>();
  const orderRows: FinanceOrderRow[] = [];

  let grossCents = 0;
  let refundCents = 0;
  let ticketCount = 0;
  let cashNetCents = 0;
  let cardNetCents = 0;

  for (const order of orders) {
    const refundAmountCents = Math.max(0, order.refundAmountCents || 0);
    const netCents = order.amountTotal - refundAmountCents;
    const orderTicketCount = order.orderSeats.length;
    const paymentMethodLabel = labelForPaymentMethod(order);

    grossCents += order.amountTotal;
    refundCents += refundAmountCents;
    ticketCount += orderTicketCount;

    if (paymentMethodLabel === 'Cash') {
      cashNetCents += netCents;
    } else if (paymentMethodLabel === 'Card') {
      cardNetCents += netCents;
    }

    mergeIntoBreakdown(paymentBreakdownMap, paymentMethodLabel, paymentMethodLabel, {
      ticketCount: orderTicketCount,
      grossCents: order.amountTotal,
      refundCents: refundAmountCents,
      netCents
    });

    mergeIntoBreakdown(sourceBreakdownMap, order.source, order.source, {
      ticketCount: orderTicketCount,
      grossCents: order.amountTotal,
      refundCents: refundAmountCents,
      netCents
    });

    orderRows.push({
      id: order.id,
      createdAt: order.createdAt.toISOString(),
      showTitle: order.performance.show.title,
      performanceTitle: order.performance.title || order.performance.show.title,
      source: order.source,
      paymentMethodLabel,
      orderStatus: order.status,
      ticketCount: orderTicketCount,
      grossCents: order.amountTotal,
      refundCents: refundAmountCents,
      netCents
    });
  }

  let performanceLabel = 'All performances';
  if (params.performanceId) {
    const performance = await prisma.performance.findUnique({
      where: { id: params.performanceId },
      include: { show: true }
    });
    if (!performance) {
      throw new HttpError(404, 'Performance not found');
    }
    performanceLabel = performance.title || performance.show.title;
  }

  return {
    stripeReportsUrl: getStripeReportsUrl(),
    generatedAtIso: new Date().toISOString(),
    startDate: params.startDate,
    endDate: params.endDate,
    includeCompOrders: params.includeCompOrders,
    performanceId: params.performanceId || null,
    performanceLabel,
    totals: {
      orderCount: orders.length,
      ticketCount,
      grossCents,
      refundCents,
      netCents: grossCents - refundCents,
      cashNetCents,
      cardNetCents
    },
    paymentBreakdown: [...paymentBreakdownMap.values()].sort((a, b) => b.netCents - a.netCents),
    sourceBreakdown: [...sourceBreakdownMap.values()].sort((a, b) => b.netCents - a.netCents),
    orders: orderRows
  };
}

async function resolvePdfDocumentCtor(): Promise<PdfDocumentCtor> {
  try {
    const module = await import('pdfkit');
    return (module.default ?? module) as unknown as PdfDocumentCtor;
  } catch {
    throw new HttpError(
      500,
      'PDF export is unavailable because the server is missing the "pdfkit" package'
    );
  }
}

async function renderFinanceReportPdf(data: FinanceReportData): Promise<Buffer> {
  const PDFDocument = await resolvePdfDocumentCtor();
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 42, size: 'LETTER' });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer | Uint8Array | string) =>
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    );
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const left = 42;
    const right = 570;
    const pageBottom = 742;
    const lineGap = 16;
    const logoBuffer = loadBrandLogoBuffer();
    let y = 44;
    const orderRowHeight = 13;

    const drawHeaderRules = () => {
      doc.rect(0, 0, 612, 6).fill('#991b1b');
      doc.rect(0, 6, 612, 2).fill('#f59e0b');
      doc.fillColor('#111827');
    };

    const drawLetterhead = () => {
      drawHeaderRules();

      if (logoBuffer) {
        try {
          doc.image(logoBuffer, left, 20, { fit: [78, 52], valign: 'center' });
        } catch {
          doc
            .roundedRect(left, 24, 60, 40, 6)
            .lineWidth(1)
            .strokeColor('#d1d5db')
            .stroke();
          doc.font('Helvetica-Bold').fontSize(8).fillColor('#6b7280').text('PENNCREST', left + 8, 40);
        }
      } else {
        doc
          .roundedRect(left, 24, 60, 40, 6)
          .lineWidth(1)
          .strokeColor('#d1d5db')
          .stroke();
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#6b7280').text('PENNCREST', left + 8, 40);
      }

      doc
        .font('Helvetica-Bold')
        .fontSize(18)
        .fillColor('#0f172a')
        .text(BRAND_NAME, left + 88, 30, { width: 270, lineBreak: false });
      doc
        .font('Helvetica')
        .fontSize(9.5)
        .fillColor('#64748b')
        .text('Theater Finance Office', left + 88, 52, { width: 270, lineBreak: false });

      const contactX = 392;
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#334155').text('Contact', contactX, 28, {
        width: right - contactX,
        align: 'right'
      });
      doc.font('Helvetica').fontSize(9).fillColor('#64748b');
      doc.text(BRAND_ADDRESS_LINE, contactX, 42, { width: right - contactX, align: 'right' });
      doc.text(BRAND_EMAIL, contactX, 55, { width: right - contactX, align: 'right' });
      doc.text(BRAND_WEB, contactX, 68, { width: right - contactX, align: 'right' });

      doc.moveTo(left, 84).lineTo(right, 84).lineWidth(1).strokeColor('#e5e7eb').stroke();

      doc.font('Helvetica-Bold').fontSize(14).fillColor('#111827').text('Financial Reporting Statement', left, 96);
      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor('#475569')
        .text(
          `${data.startDate} to ${data.endDate}   |   Scope: ${data.performanceLabel}   |   Generated: ${formatDateTime(data.generatedAtIso)}`,
          left,
          115,
          { width: right - left }
        );
      doc
        .font('Helvetica-Oblique')
        .fontSize(8.7)
        .fillColor('#6b7280')
        .text(
          'Figures are presented in USD.',
          left,
          132,
          { width: right - left }
        );
    };

    const ensureSpace = (required: number) => {
      if (y + required < pageBottom) return;
      doc.addPage();
      drawLetterhead();
      y = 162;
    };

    const fitText = (value: string, width: number, font: string, fontSize: number): string => {
      const text = value || '';
      doc.font(font).fontSize(fontSize);
      if (doc.widthOfString(text) <= width) return text;
      const ellipsis = '...';
      let low = 0;
      let high = text.length;
      let best = ellipsis;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const candidate = `${text.slice(0, mid)}${ellipsis}`;
        if (doc.widthOfString(candidate) <= width) {
          best = candidate;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      return best;
    };

    const drawCell = (params: {
      text: string;
      x: number;
      yPos: number;
      width: number;
      align?: 'left' | 'right' | 'center';
      font?: string;
      fontSize?: number;
      color?: string;
    }) => {
      const font = params.font || 'Helvetica';
      const fontSize = params.fontSize ?? 8.8;
      const color = params.color || '#0f172a';
      const text = fitText(params.text, params.width, font, fontSize);
      doc
        .font(font)
        .fontSize(fontSize)
        .fillColor(color)
        .text(text, params.x, params.yPos, {
          width: params.width,
          align: params.align || 'left',
          lineBreak: false
        });
    };

    const formatSourceLabel = (source: string): string => {
      const normalized = source.trim().toUpperCase();
      const mapping: Record<string, string> = {
        ONLINE: 'Online',
        DOOR: 'Door',
        COMP: 'Comp',
        STAFF_FREE: 'Staff Free',
        STAFF_COMP: 'Staff Comp',
        FAMILY_FREE: 'Family Free',
        STUDENT_COMP: 'Student Comp'
      };
      return mapping[normalized] || source.replace(/_/g, ' ');
    };

    const formatPaymentLabel = (value: string): string => {
      if (value === 'Comp/No charge') return 'Comp';
      return value;
    };

    const formatCompactDateTime = (isoValue: string): string => {
      const date = new Date(isoValue);
      if (Number.isNaN(date.getTime())) return isoValue;
      return date.toLocaleString('en-US', {
        month: 'numeric',
        day: 'numeric',
        year: '2-digit',
        hour: 'numeric',
        minute: '2-digit'
      });
    };

    const drawSummaryPanel = () => {
      const panelTop = y;
      const panelHeight = 132;
      doc.roundedRect(left, panelTop, right - left, panelHeight, 10).fillAndStroke('#f8fafc', '#e5e7eb');

      doc.font('Helvetica-Bold').fontSize(10).fillColor('#334155').text('Executive Summary', left + 12, panelTop + 10);
      const rowA = panelTop + 32;
      const rowB = panelTop + 82;

      const metric = (label: string, value: string, x: number, yPos: number) => {
        doc.font('Helvetica').fontSize(8).fillColor('#94a3b8').text(label, x, yPos);
        doc.font('Helvetica-Bold').fontSize(15).fillColor('#0f172a').text(value, x, yPos + 10);
      };

      metric('Net Revenue', centsToDollars(data.totals.netCents), left + 16, rowA);
      metric('Gross Revenue', centsToDollars(data.totals.grossCents), left + 146, rowA);
      metric('Refunds', centsToDollars(data.totals.refundCents), left + 286, rowA);
      metric('Orders', String(data.totals.orderCount), left + 428, rowA);

      metric('Cash Net', centsToDollars(data.totals.cashNetCents), left + 16, rowB);
      metric('Card Net', centsToDollars(data.totals.cardNetCents), left + 146, rowB);
      metric('Tickets', String(data.totals.ticketCount), left + 286, rowB);
      metric('Comp Included', data.includeCompOrders ? 'Yes' : 'No', left + 428, rowB);

      y = panelTop + panelHeight + 18;
    };

    const drawBreakdownSection = (title: string, rows: FinanceBreakdownRow[]) => {
      ensureSpace(44 + rows.length * 18);
      doc.font('Helvetica-Bold').fontSize(11.5).fillColor('#111827').text(title, left, y);
      y += 16;
      drawCell({ text: 'Category', x: left, yPos: y, width: 226, font: 'Helvetica-Bold', fontSize: 8.6, color: '#64748b' });
      drawCell({ text: 'Orders', x: left + 230, yPos: y, width: 48, font: 'Helvetica-Bold', fontSize: 8.6, color: '#64748b', align: 'right' });
      drawCell({ text: 'Tickets', x: left + 282, yPos: y, width: 52, font: 'Helvetica-Bold', fontSize: 8.6, color: '#64748b', align: 'right' });
      drawCell({ text: 'Gross', x: left + 338, yPos: y, width: 68, font: 'Helvetica-Bold', fontSize: 8.6, color: '#64748b', align: 'right' });
      drawCell({ text: 'Refunds', x: left + 410, yPos: y, width: 70, font: 'Helvetica-Bold', fontSize: 8.6, color: '#64748b', align: 'right' });
      drawCell({ text: 'Net', x: left + 484, yPos: y, width: 44, font: 'Helvetica-Bold', fontSize: 8.6, color: '#64748b', align: 'right' });
      y += 11;
      doc.moveTo(left, y).lineTo(right, y).lineWidth(0.8).strokeColor('#e5e7eb').stroke();
      y += 8;

      rows.forEach((row) => {
        ensureSpace(18);
        drawCell({ text: row.label, x: left, yPos: y, width: 226, fontSize: 9, color: '#1f2937' });
        drawCell({ text: String(row.orderCount), x: left + 230, yPos: y, width: 48, align: 'right', fontSize: 9, color: '#1f2937' });
        drawCell({ text: String(row.ticketCount), x: left + 282, yPos: y, width: 52, align: 'right', fontSize: 9, color: '#1f2937' });
        drawCell({ text: centsToDollars(row.grossCents), x: left + 338, yPos: y, width: 68, align: 'right', fontSize: 9, color: '#1f2937' });
        drawCell({ text: centsToDollars(row.refundCents), x: left + 410, yPos: y, width: 70, align: 'right', fontSize: 9, color: '#b91c1c' });
        drawCell({ text: centsToDollars(row.netCents), x: left + 484, yPos: y, width: 44, align: 'right', font: 'Helvetica-Bold', fontSize: 9, color: '#0f172a' });
        y += lineGap;
      });

      y += 10;
    };

    const drawOrderDetailHeader = () => {
      drawCell({ text: 'Date', x: left, yPos: y, width: 76, font: 'Helvetica-Bold', fontSize: 8.4, color: '#64748b' });
      drawCell({ text: 'Order ID', x: left + 80, yPos: y, width: 86, font: 'Helvetica-Bold', fontSize: 8.4, color: '#64748b' });
      drawCell({ text: 'Source', x: left + 170, yPos: y, width: 64, font: 'Helvetica-Bold', fontSize: 8.4, color: '#64748b' });
      drawCell({ text: 'Payment', x: left + 238, yPos: y, width: 72, font: 'Helvetica-Bold', fontSize: 8.4, color: '#64748b' });
      drawCell({ text: 'Tkts', x: left + 314, yPos: y, width: 30, align: 'right', font: 'Helvetica-Bold', fontSize: 8.4, color: '#64748b' });
      drawCell({ text: 'Gross', x: left + 348, yPos: y, width: 56, align: 'right', font: 'Helvetica-Bold', fontSize: 8.4, color: '#64748b' });
      drawCell({ text: 'Refund', x: left + 408, yPos: y, width: 54, align: 'right', font: 'Helvetica-Bold', fontSize: 8.4, color: '#64748b' });
      drawCell({ text: 'Net', x: left + 466, yPos: y, width: 50, align: 'right', font: 'Helvetica-Bold', fontSize: 8.4, color: '#64748b' });
      drawCell({ text: 'Performance', x: left + 520, yPos: y, width: 50, font: 'Helvetica-Bold', fontSize: 8.4, color: '#64748b' });
      y += 11;
      doc.moveTo(left, y).lineTo(right, y).lineWidth(0.8).strokeColor('#e5e7eb').stroke();
      y += 7;
    };

    const drawOrderSectionTitle = (continued: boolean) => {
      ensureSpace(40);
      doc
        .font('Helvetica-Bold')
        .fontSize(11.5)
        .fillColor('#111827')
        .text(continued ? 'Order Detail (continued)' : 'Order Detail', left, y);
      y += 16;
      drawOrderDetailHeader();
    };

    drawLetterhead();
    y = 162;
    drawSummaryPanel();
    drawBreakdownSection('Payment Method Breakdown', data.paymentBreakdown);
    drawBreakdownSection('Order Source Breakdown', data.sourceBreakdown);
    drawOrderSectionTitle(false);

    data.orders.forEach((order, index) => {
      if (y + orderRowHeight > pageBottom) {
        doc.addPage();
        drawLetterhead();
        y = 162;
        drawOrderSectionTitle(true);
      }

      if (index % 2 === 0) {
        doc.rect(left, y - 1.5, right - left, orderRowHeight).fill('#fcfcfd');
      }

      drawCell({ text: formatCompactDateTime(order.createdAt), x: left, yPos: y, width: 76, fontSize: 8.1 });
      drawCell({ text: order.id.slice(0, 14), x: left + 80, yPos: y, width: 86, fontSize: 8.1 });
      drawCell({ text: formatSourceLabel(order.source), x: left + 170, yPos: y, width: 64, fontSize: 8.1 });
      drawCell({ text: formatPaymentLabel(order.paymentMethodLabel), x: left + 238, yPos: y, width: 72, fontSize: 8.1 });
      drawCell({ text: String(order.ticketCount), x: left + 314, yPos: y, width: 30, align: 'right', fontSize: 8.1 });
      drawCell({ text: centsToDollars(order.grossCents), x: left + 348, yPos: y, width: 56, align: 'right', fontSize: 8.1 });
      drawCell({ text: centsToDollars(order.refundCents), x: left + 408, yPos: y, width: 54, align: 'right', fontSize: 8.1, color: '#b91c1c' });
      drawCell({ text: centsToDollars(order.netCents), x: left + 466, yPos: y, width: 50, align: 'right', font: 'Helvetica-Bold', fontSize: 8.1 });
      drawCell({ text: order.performanceTitle, x: left + 520, yPos: y, width: 50, fontSize: 8.1 });
      y += orderRowHeight;
    });

    doc.end();
  });
}

export const adminFinanceRoutes: FastifyPluginAsync = async (app) => {
  const adminActor = (request: { adminUser?: { username: string; id: string } }) => ({
    actor: request.adminUser?.username || 'admin',
    actorAdminId: request.adminUser?.id || null
  });

  const serializeInvoiceSummary = (invoice: Stripe.Invoice) => ({
    id: invoice.id,
    number: invoice.number || null,
    status: invoice.status,
    collectionMethod: invoice.collection_method,
    description: invoice.description || null,
    customerId:
      typeof invoice.customer === 'string'
        ? invoice.customer
        : invoice.customer?.id || null,
    customerName: invoice.customer_name || null,
    customerEmail: invoice.customer_email || null,
    currency: invoice.currency.toUpperCase(),
    amountDueCents: invoice.amount_due,
    amountPaidCents: invoice.amount_paid,
    amountRemainingCents: invoice.amount_remaining,
    createdAt: toIsoFromEpochSeconds(invoice.created) || new Date().toISOString(),
    dueDate: toIsoFromEpochSeconds(invoice.due_date),
    hostedInvoiceUrl: invoice.hosted_invoice_url || null,
    invoicePdfUrl: invoice.invoice_pdf || null,
    process: buildInvoiceProcess(invoice)
  });

  app.get('/api/admin/finance/summary', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsed = financeQuerySchema.safeParse(request.query || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const data = await buildFinanceReportData({
        startDate: parsed.data.startDate,
        endDate: parsed.data.endDate,
        performanceId: parsed.data.performanceId,
        includeCompOrders: parsed.data.includeCompOrders === '1' || parsed.data.includeCompOrders === 'true'
      });
      const { orders: _orders, ...summary } = data;
      reply.send(summary);
    } catch (err) {
      handleRouteError(reply, err, 'Failed to fetch finance summary');
    }
  });

  app.get('/api/admin/finance/report.pdf', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsed = financeQuerySchema.safeParse(request.query || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const data = await buildFinanceReportData({
        startDate: parsed.data.startDate,
        endDate: parsed.data.endDate,
        performanceId: parsed.data.performanceId,
        includeCompOrders: parsed.data.includeCompOrders === '1' || parsed.data.includeCompOrders === 'true'
      });
      const pdf = await renderFinanceReportPdf(data);
      const reportTag = `${data.startDate}_to_${data.endDate}`;
      const performanceTag = data.performanceId ? '_show' : '_all';
      const filename = `finance-report-${reportTag}${performanceTag}.pdf`;

      reply.header('Content-Type', 'application/pdf');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      reply.send(pdf);
    } catch (err) {
      handleRouteError(reply, err, 'Failed to generate finance PDF');
    }
  });

  app.get('/api/admin/finance/local-report.csv', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsed = financeQuerySchema.safeParse(request.query || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const data = await buildFinanceReportData({
        startDate: parsed.data.startDate,
        endDate: parsed.data.endDate,
        performanceId: parsed.data.performanceId,
        includeCompOrders: parsed.data.includeCompOrders === '1' || parsed.data.includeCompOrders === 'true'
      });

      const lines: string[] = [];
      lines.push(csvRow([
        'order_id',
        'created_at',
        'show_title',
        'performance_title',
        'source',
        'payment_method',
        'payment_group',
        'status',
        'ticket_count',
        'gross_usd',
        'refund_usd',
        'net_usd'
      ]));

      for (const order of data.orders) {
        const paymentGroup =
          order.paymentMethodLabel === 'Cash'
            ? 'cash'
            : order.paymentMethodLabel === 'Card'
              ? 'card'
              : 'comp_no_charge';

        lines.push(csvRow([
          order.id,
          order.createdAt,
          order.showTitle,
          order.performanceTitle,
          order.source,
          order.paymentMethodLabel,
          paymentGroup,
          order.orderStatus,
          order.ticketCount,
          toUsd(order.grossCents),
          toUsd(order.refundCents),
          toUsd(order.netCents)
        ]));
      }

      const csv = lines.join('\n');
      const reportTag = `${data.startDate}_to_${data.endDate}`;
      const performanceTag = data.performanceId ? '_show' : '_all';
      const filename = `local-finance-${reportTag}${performanceTag}.csv`;

      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      reply.send(csv);
    } catch (err) {
      handleRouteError(reply, err, 'Failed to export local finance CSV');
    }
  });

  app.get('/api/admin/finance/stripe-report.csv', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsed = stripeReportDownloadQuerySchema.safeParse(request.query || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const intervalStart = Math.floor(parseUtcDayStart(parsed.data.startDate).getTime() / 1000);
      const intervalEndExclusive = Math.floor(parseUtcNextDayStart(parsed.data.endDate).getTime() / 1000);
      if (intervalStart >= intervalEndExclusive) {
        throw new HttpError(400, 'startDate must be on or before endDate');
      }

      const balanceRows = await stripe.balanceTransactions
        .list({
          created: {
            gte: intervalStart,
            lt: intervalEndExclusive
          }
        })
        .autoPagingToArray({ limit: 10_000 });

      const relevantRows = balanceRows.filter((row) =>
        ['charge', 'refund', 'payment', 'payment_refund', 'stripe_fee', 'tax_fee'].includes(row.type)
      );

      const lines: string[] = [];
      lines.push(csvRow([
        'id',
        'created_at',
        'available_on',
        'type',
        'reporting_category',
        'description',
        'currency',
        'gross_amount',
        'fee_amount',
        'net_amount',
        'source',
        'status'
      ]));

      for (const row of relevantRows) {
        lines.push(csvRow([
          row.id,
          new Date(row.created * 1000).toISOString(),
          new Date(row.available_on * 1000).toISOString(),
          row.type,
          row.reporting_category,
          row.description || '',
          row.currency.toUpperCase(),
          toUsd(row.amount),
          toUsd(row.fee),
          toUsd(row.net),
          typeof row.source === 'string' ? row.source : row.source?.id || '',
          row.status
        ]));
      }

      const csv = lines.join('\n');
      const reportTypeTag = parsed.data.reportTypeId
        ? safeFilenamePart(parsed.data.reportTypeId)
        : 'balance-transactions';
      const filename = `stripe-${reportTypeTag}-${parsed.data.startDate}-to-${parsed.data.endDate}.csv`;

      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      reply.send(csv);
    } catch (err) {
      if (err instanceof Stripe.errors.StripeError) {
        const statusCode = err.type === 'StripeInvalidRequestError' ? 400 : 502;
        return reply.status(statusCode).send({ error: err.message || 'Stripe reporting error' });
      }
      handleRouteError(reply, err, 'Failed to generate Stripe finance report');
    }
  });

  app.get('/api/admin/finance/invoices', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const parsed = financeInvoiceListQuerySchema.safeParse(request.query || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const statusFilter = parsed.data.status === 'all' ? undefined : parsed.data.status;
      const invoices = await stripe.invoices.list({
        limit: parsed.data.limit,
        ...(statusFilter ? { status: statusFilter as Stripe.InvoiceListParams.Status } : {})
      });

      const query = parsed.data.q?.trim().toLowerCase();
      const filtered = query
        ? invoices.data.filter((invoice) => {
            const fields = [
              invoice.number || '',
              invoice.description || '',
              invoice.customer_email || '',
              invoice.customer_name || '',
              invoice.id
            ];
            return fields.some((field) => field.toLowerCase().includes(query));
          })
        : invoices.data;

      reply.send({
        rows: filtered.map((invoice) => serializeInvoiceSummary(invoice)),
        hasMore: invoices.has_more
      });
    } catch (err) {
      if (err instanceof Stripe.errors.StripeError) {
        const statusCode = err.type === 'StripeInvalidRequestError' ? 400 : 502;
        return reply.status(statusCode).send({ error: err.message || 'Stripe invoice lookup failed' });
      }
      handleRouteError(reply, err, 'Failed to fetch invoices');
    }
  });

  app.get('/api/admin/finance/invoices/:invoiceId', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const parsed = financeInvoiceParamsSchema.safeParse(request.params || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const invoice = await stripe.invoices.retrieve(parsed.data.invoiceId);
      const lineItems = await stripe.invoices.listLineItems(parsed.data.invoiceId, { limit: 100 });
      reply.send({
        invoice: serializeInvoiceSummary(invoice),
        customerNote: invoice.footer || null,
        lineItems: lineItems.data.map((item) => {
          const quantity = item.quantity && item.quantity > 0 ? item.quantity : 1;
          const unitAmountCents = Math.round(item.amount / quantity);
          return {
            id: item.id,
            description: item.description || '',
            quantity,
            amountCents: item.amount,
            unitAmountCents,
            currency: item.currency.toUpperCase()
          };
        })
      });
    } catch (err) {
      if (err instanceof Stripe.errors.StripeError) {
        const statusCode = err.type === 'StripeInvalidRequestError' ? 404 : 502;
        return reply.status(statusCode).send({ error: err.message || 'Stripe invoice detail lookup failed' });
      }
      handleRouteError(reply, err, 'Failed to fetch invoice detail');
    }
  });

  app.post('/api/admin/finance/invoices/send', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const parsed = sendInvoiceSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const customerEmail = parsed.data.customerEmail.trim().toLowerCase();
      const customerName = parsed.data.customerName.trim();
      const description = parsed.data.description.trim();
      const customerNote = parsed.data.customerNote?.trim() || null;

      const invoiceLineItems = parsed.data.lineItems?.length
        ? parsed.data.lineItems.map((item) => ({
            description: item.description.trim(),
            quantity: item.quantity,
            unitAmountCents: item.unitAmountCents,
            amountCents: item.quantity * item.unitAmountCents
          }))
        : [
            {
              description,
              quantity: 1,
              unitAmountCents: parsed.data.amountCents || 0,
              amountCents: parsed.data.amountCents || 0
            }
          ];

      const totalAmountCents = invoiceLineItems.reduce((sum, item) => sum + item.amountCents, 0);
      if (totalAmountCents < 50) {
        throw new HttpError(400, 'Invoice total must be at least $0.50');
      }

      const customer = await findOrCreateInvoiceCustomer({
        email: customerEmail,
        name: customerName
      });

      const invoice = await stripe.invoices.create({
        customer: customer.id,
        collection_method: 'send_invoice',
        days_until_due: parsed.data.dueInDays,
        auto_advance: false,
        description,
        footer: customerNote || undefined,
        metadata: {
          source: 'admin_finance_tab',
          sentByAdminId: request.adminUser?.id || '',
          sentByAdminUsername: request.adminUser?.username || ''
        }
      });

      for (const item of invoiceLineItems) {
        const itemDescription =
          item.quantity > 1
            ? `${item.description} (x${item.quantity} @ ${centsToDollars(item.unitAmountCents)})`
            : item.description;
        await stripe.invoiceItems.create({
          customer: customer.id,
          invoice: invoice.id,
          currency: 'usd',
          amount: item.amountCents,
          description: itemDescription
        });
      }

      await stripe.invoices.finalizeInvoice(invoice.id);
      const sent = await stripe.invoices.sendInvoice(invoice.id);

      await logAudit({
        ...adminActor(request),
        action: 'FINANCE_INVOICE_SENT',
        entityType: 'Invoice',
        entityId: sent.id,
        metadata: {
          customerId: customer.id,
          customerEmail,
          customerName,
          amountCents: totalAmountCents,
          dueInDays: parsed.data.dueInDays,
          description,
          customerNote,
          lineItemCount: invoiceLineItems.length,
          lineItems: invoiceLineItems,
          hostedInvoiceUrl: sent.hosted_invoice_url
        }
      });

      reply.status(201).send({
        invoiceId: sent.id,
        invoiceNumber: sent.number || null,
        customerId: customer.id,
        customerEmail,
        amountDueCents: sent.amount_due,
        status: sent.status,
        hostedInvoiceUrl: sent.hosted_invoice_url || null
      });
    } catch (err) {
      if (err instanceof Stripe.errors.StripeError) {
        const statusCode = err.type === 'StripeInvalidRequestError' ? 400 : 502;
        return reply.status(statusCode).send({ error: err.message || 'Stripe invoice send failed' });
      }
      handleRouteError(reply, err, 'Failed to send invoice');
    }
  });
};
