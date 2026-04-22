/*
Handoff note for Mr. Smith:
- File: `backend/src/routes/senior-sendoff-forms.ts`
- What this is: Fastify route module.
- What it does: Defines HTTP endpoints and route-level request handling for one domain area.
- Connections: Registered by backend server bootstrap; calls services/lib helpers and Prisma.
- Main content type: HTTP logic + auth guards + response shaping.
- Safe edits here: Response wording and non-breaking diagnostics.
- Be careful with: Auth hooks, schema contracts, and transactional behavior.
- Useful context: If frontend/mobile API calls fail after changes, contract drift often starts here.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { env } from '../lib/env.js';
import { HttpError } from '../lib/http-error.js';
import { handleRouteError } from '../lib/route-error.js';
import { logAudit } from '../lib/audit-log.js';
import { stripe } from '../lib/stripe.js';
import { sendSeniorSendoffSubmissionEmail } from '../lib/email.js';

const SENIOR_SENDOFF_SCHEMA_VERSION = 'SENIOR_SENDOFF_V1';
const SENIOR_SENDOFF_DEFAULT_TITLE = 'Shout Outs';
const SENIOR_SENDOFF_DEFAULT_SECOND_SUBMISSION_PRICE_CENTS = 2500;
const SENIOR_SENDOFF_MAX_MESSAGE_LENGTH = 1800;

const SENIOR_SENDOFF_DEFAULT_INSTRUCTIONS = `Celebrate your senior with a shout-out in the playbill.

Rules:
- Each parent/guardian can submit up to 2 shout-outs per student for this show.
- The first shout-out for a student is free.
- The second shout-out for the same student requires payment.

Please include:
- Parent/guardian name
- Email and phone number
- Student name
- Your shout-out message`;

const seniorSendoffCustomQuestionTypeSchema = z.enum(['short_text', 'long_text', 'multiple_choice']);

const seniorSendoffCustomQuestionSchema = z
  .object({
    id: z.string().trim().min(1).max(100),
    label: z.string().trim().max(160),
    type: seniorSendoffCustomQuestionTypeSchema,
    required: z.boolean().optional(),
    hidden: z.boolean().optional(),
    options: z.array(z.string().trim().min(1).max(160)).max(25).optional()
  })
  .strict();

const seniorSendoffQuestionsPatchSchema = z
  .object({
    parentNameLabel: z.string().trim().min(1).max(120).optional(),
    parentEmailLabel: z.string().trim().min(1).max(120).optional(),
    parentPhoneLabel: z.string().trim().min(1).max(120).optional(),
    studentNameLabel: z.string().trim().min(1).max(120).optional(),
    messageLabel: z.string().trim().min(1).max(120).optional(),
    customQuestions: z.array(seniorSendoffCustomQuestionSchema).max(40).optional()
  })
  .strict();

const createSeniorSendoffFormSchema = z.object({
  showId: z.string().trim().min(1),
  deadlineAt: z.string().datetime().optional(),
  secondSubmissionPriceCents: z.coerce.number().int().min(0).max(100_000).optional()
});

const adminSeniorSendoffSubmissionParamsSchema = z.object({
  id: z.string().trim().min(1),
  submissionId: z.string().trim().min(1)
});

const updateSeniorSendoffFormSchema = z
  .object({
    title: z.string().trim().min(1).max(180).optional(),
    instructions: z.string().trim().min(1).max(12_000).optional(),
    deadlineAt: z.string().datetime().optional(),
    isOpen: z.boolean().optional(),
    secondSubmissionPriceCents: z.coerce.number().int().min(0).max(100_000).optional(),
    questions: seniorSendoffQuestionsPatchSchema.optional()
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Provide at least one field to update'
  });

const publicEligibilitySchema = z.object({
  parentEmail: z.string().trim().email().max(320),
  studentName: z.string().trim().min(1).max(120)
});

const publicPaymentIntentSchema = z.object({
  parentName: z.string().trim().min(1).max(120),
  parentEmail: z.string().trim().email().max(320),
  studentName: z.string().trim().min(1).max(120)
});

const publicSubmissionSchema = z.object({
  parentName: z.string().trim().min(1).max(120),
  parentEmail: z.string().trim().email().max(320),
  parentPhone: z.string().trim().min(7).max(40),
  studentName: z.string().trim().min(1).max(120),
  message: z.string().trim().min(1).max(SENIOR_SENDOFF_MAX_MESSAGE_LENGTH),
  customResponses: z.record(z.string().max(4_000)).optional(),
  paymentIntentId: z.string().trim().min(1).max(255).optional()
});

type SeniorSendoffCustomQuestionType = z.infer<typeof seniorSendoffCustomQuestionTypeSchema>;

type SeniorSendoffCustomQuestion = {
  id: string;
  label: string;
  type: SeniorSendoffCustomQuestionType;
  required: boolean;
  hidden: boolean;
  options: string[];
};

type SeniorSendoffQuestionsPatch = z.infer<typeof seniorSendoffQuestionsPatchSchema>;

type SeniorSendoffQuestions = {
  parentNameLabel: string;
  parentEmailLabel: string;
  parentPhoneLabel: string;
  studentNameLabel: string;
  messageLabel: string;
  customQuestions: SeniorSendoffCustomQuestion[];
};

const SENIOR_SENDOFF_DEFAULT_QUESTIONS: SeniorSendoffQuestions = {
  parentNameLabel: 'Parent/Guardian Name',
  parentEmailLabel: 'Parent Email',
  parentPhoneLabel: 'Parent Phone',
  studentNameLabel: 'Student Name',
  messageLabel: 'Shout-Out Message',
  customQuestions: []
};

type AdminRequestLike = {
  user?: {
    username?: string;
  };
  adminUser?: {
    id: string;
    username: string;
  };
};

function adminActor(request: AdminRequestLike): string {
  return request.user?.username || request.adminUser?.username || 'admin';
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeStudentKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function toSlugPart(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function buildBasePublicSlug(showTitle: string): string {
  const showSlug = toSlugPart(showTitle) || 'show';
  return `senior-sendoff-${showSlug}`;
}

async function generateUniquePublicSlug(tx: Prisma.TransactionClient, showTitle: string): Promise<string> {
  const base = buildBasePublicSlug(showTitle);
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const suffix = attempt === 0 ? '' : `-${randomUUID().slice(0, 6)}`;
    const candidate = `${base}${suffix}`;
    const existing = await tx.seniorSendoffForm.findUnique({
      where: { publicSlug: candidate },
      select: { id: true }
    });
    if (!existing) return candidate;
  }

  throw new HttpError(500, 'We could not generate a unique public form link');
}

function isAcceptingResponses(form: { isOpen: boolean; deadlineAt: Date }, now: Date): boolean {
  return form.isOpen && form.deadlineAt > now;
}

function acceptanceMessage(form: { isOpen: boolean; deadlineAt: Date }, now: Date): string {
  if (!form.isOpen || form.deadlineAt <= now) {
    return "This form isn't accepting responses.";
  }
  return '';
}

function normalizeCustomQuestionOptions(options: string[] | undefined): string[] {
  if (!options) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const option of options) {
    const trimmed = option.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

function normalizeCustomQuestions(value: SeniorSendoffQuestionsPatch['customQuestions']): SeniorSendoffCustomQuestion[] {
  if (!Array.isArray(value)) return [];

  const seenIds = new Set<string>();
  const normalized: SeniorSendoffCustomQuestion[] = [];

  for (const question of value) {
    const id = question.id.trim();
    if (!id || seenIds.has(id)) continue;

    const label = question.label.trim();
    if (!label) continue;

    const options = question.type === 'multiple_choice' ? normalizeCustomQuestionOptions(question.options) : [];
    if (question.type === 'multiple_choice' && options.length < 2) continue;

    normalized.push({
      id,
      label,
      type: question.type,
      required: Boolean(question.required),
      hidden: Boolean(question.hidden),
      options
    });
    seenIds.add(id);
  }

  return normalized;
}

function normalizeSeniorSendoffQuestions(value: Prisma.JsonValue | null | undefined): SeniorSendoffQuestions {
  const parsed = seniorSendoffQuestionsPatchSchema.safeParse(value ?? {});
  if (!parsed.success) {
    return { ...SENIOR_SENDOFF_DEFAULT_QUESTIONS };
  }

  const { customQuestions, ...labelPatch } = parsed.data;
  const normalizedLabels = Object.fromEntries(
    Object.entries(labelPatch).filter(([, fieldValue]) => fieldValue !== undefined)
  ) as Omit<SeniorSendoffQuestions, 'customQuestions'>;

  return {
    ...SENIOR_SENDOFF_DEFAULT_QUESTIONS,
    ...normalizedLabels,
    customQuestions: normalizeCustomQuestions(customQuestions)
  };
}

function mergeSeniorSendoffQuestions(
  current: Prisma.JsonValue | null | undefined,
  patch: SeniorSendoffQuestionsPatch
): SeniorSendoffQuestions {
  const base = normalizeSeniorSendoffQuestions(current);
  const { customQuestions, ...labelPatch } = patch;
  const normalizedLabels = Object.fromEntries(
    Object.entries(labelPatch).filter(([, fieldValue]) => fieldValue !== undefined)
  ) as Partial<Omit<SeniorSendoffQuestions, 'customQuestions'>>;

  return normalizeSeniorSendoffQuestions({
    ...base,
    ...normalizedLabels,
    customQuestions: customQuestions ?? base.customQuestions
  } as Prisma.JsonObject);
}

function normalizeSubmissionCustomResponses(
  value: Record<string, string> | undefined,
  customQuestions: SeniorSendoffCustomQuestion[]
): Record<string, string> {
  const visibleCustomQuestions = customQuestions.filter((question) => !question.hidden);
  if (visibleCustomQuestions.length === 0) return {};

  const source = value || {};
  const normalized: Record<string, string> = {};

  for (const question of visibleCustomQuestions) {
    const raw = source[question.id];
    const trimmed = typeof raw === 'string' ? raw.trim() : '';

    if (!trimmed) {
      if (question.required) {
        throw new HttpError(400, `${question.label} is required.`);
      }
      continue;
    }

    if (question.type === 'multiple_choice' && !question.options.includes(trimmed)) {
      throw new HttpError(400, `Invalid response for "${question.label}".`);
    }

    normalized[question.id] = trimmed;
  }

  return normalized;
}

function serializeFormSummary(
  form: {
    id: string;
    showId: string;
    publicSlug: string;
    schemaVersion: string;
    title: string;
    instructions: string;
    questionConfig: Prisma.JsonValue | null;
    deadlineAt: Date;
    isOpen: boolean;
    isArchived: boolean;
    archivedAt: Date | null;
    secondSubmissionPriceCents: number;
    createdAt: Date;
    updatedAt: Date;
    show: { id: string; title: string };
    submissions?: Array<{ isPaid: boolean }>;
    _count?: { submissions: number };
  },
  now: Date
) {
  const acceptingResponses = isAcceptingResponses(form, now);
  const status = form.isArchived ? 'ARCHIVED' : acceptingResponses ? 'OPEN' : 'CLOSED';
  const responseCount = form._count?.submissions ?? form.submissions?.length ?? 0;
  const paidResponseCount = form.submissions?.reduce((sum, submission) => sum + (submission.isPaid ? 1 : 0), 0) ?? 0;

  return {
    id: form.id,
    showId: form.showId,
    show: {
      id: form.show.id,
      title: form.show.title
    },
    publicSlug: form.publicSlug,
    sharePath: `/forms/senior-sendoff/${form.publicSlug}`,
    schemaVersion: form.schemaVersion,
    title: form.title,
    instructions: form.instructions,
    questions: normalizeSeniorSendoffQuestions(form.questionConfig),
    deadlineAt: form.deadlineAt,
    isOpen: form.isOpen,
    isArchived: form.isArchived,
    archivedAt: form.archivedAt,
    secondSubmissionPriceCents: form.secondSubmissionPriceCents,
    acceptingResponses,
    status,
    responseCount,
    paidResponseCount,
    createdAt: form.createdAt,
    updatedAt: form.updatedAt
  };
}

type EligibilityResult = {
  existingCount: number;
  remainingCount: number;
  requiresPaymentForNextSubmission: boolean;
  maxReached: boolean;
};

async function computeEligibility(params: {
  formId: string;
  parentEmail: string;
  studentKey: string;
  secondSubmissionPriceCents: number;
}): Promise<EligibilityResult> {
  const existingCount = await prisma.seniorSendoffSubmission.count({
    where: {
      formId: params.formId,
      parentEmail: params.parentEmail,
      studentKey: params.studentKey
    }
  });

  const remainingCount = Math.max(0, 2 - existingCount);
  const maxReached = existingCount >= 2;
  const requiresPaymentForNextSubmission = existingCount === 1 && params.secondSubmissionPriceCents > 0;

  return {
    existingCount,
    remainingCount,
    requiresPaymentForNextSubmission,
    maxReached
  };
}

function isAllowedPaymentStatus(status: Stripe.PaymentIntent.Status): boolean {
  return status === 'succeeded' || status === 'processing' || status === 'requires_capture';
}

async function verifySecondSubmissionPayment(params: {
  paymentIntentId: string;
  expectedAmountCents: number;
  formId: string;
  parentEmail: string;
  studentKey: string;
}): Promise<{ amount: number; currency: string }> {
  const paymentIntent = await stripe.paymentIntents.retrieve(params.paymentIntentId);

  if (!isAllowedPaymentStatus(paymentIntent.status)) {
    throw new HttpError(409, `Payment status is ${paymentIntent.status}. Complete payment before submitting.`);
  }

  if ((paymentIntent.currency || '').toLowerCase() !== 'usd') {
    throw new HttpError(400, 'Payment currency mismatch.');
  }

  if (paymentIntent.amount !== params.expectedAmountCents) {
    throw new HttpError(400, 'Payment amount does not match the required second submission fee.');
  }

  const source = paymentIntent.metadata?.source;
  if (source !== 'senior_sendoff_second_submission') {
    throw new HttpError(400, 'Payment source is invalid for this submission.');
  }

  if (paymentIntent.metadata?.formId !== params.formId) {
    throw new HttpError(400, 'Payment does not belong to this form.');
  }

  if (normalizeEmail(paymentIntent.metadata?.parentEmail || '') !== params.parentEmail) {
    throw new HttpError(400, 'Payment email does not match this submission.');
  }

  if (normalizeStudentKey(paymentIntent.metadata?.studentKey || '') !== params.studentKey) {
    throw new HttpError(400, 'Payment student does not match this submission.');
  }

  return {
    amount: paymentIntent.amount,
    currency: (paymentIntent.currency || 'usd').toLowerCase()
  };
}

export const seniorSendoffFormRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/admin/forms/senior-sendoff', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const parsed = createSeniorSendoffFormSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const created = await prisma.$transaction(async (tx) => {
        const show = await tx.show.findUnique({
          where: { id: parsed.data.showId },
          select: {
            id: true,
            title: true,
            performances: {
              where: {
                isArchived: false,
                isFundraiser: false
              },
              orderBy: { startsAt: 'asc' },
              select: {
                startsAt: true
              }
            }
          }
        });

        if (!show) {
          throw new HttpError(404, 'Show not found');
        }

        const existingForm = await tx.seniorSendoffForm.findUnique({
          where: { showId: show.id },
          select: { id: true, isArchived: true }
        });
        if (existingForm) {
          throw new HttpError(
            409,
            existingForm.isArchived
              ? 'A shout out form already exists for this show and is archived. Delete it first.'
              : 'A shout out form already exists for this show'
          );
        }

        const defaultDeadline = show.performances[0]?.startsAt || new Date(Date.now() + 21 * 24 * 60 * 60 * 1000);
        const deadlineAt = parsed.data.deadlineAt ? new Date(parsed.data.deadlineAt) : defaultDeadline;
        const publicSlug = await generateUniquePublicSlug(tx, show.title);
        const secondSubmissionPriceCents =
          parsed.data.secondSubmissionPriceCents ?? SENIOR_SENDOFF_DEFAULT_SECOND_SUBMISSION_PRICE_CENTS;

        return tx.seniorSendoffForm.create({
          data: {
            showId: show.id,
            publicSlug,
            schemaVersion: SENIOR_SENDOFF_SCHEMA_VERSION,
            title: SENIOR_SENDOFF_DEFAULT_TITLE,
            instructions: SENIOR_SENDOFF_DEFAULT_INSTRUCTIONS,
            questionConfig: SENIOR_SENDOFF_DEFAULT_QUESTIONS,
            deadlineAt,
            isOpen: true,
            isArchived: false,
            archivedAt: null,
            secondSubmissionPriceCents,
            createdByAdminId: request.adminUser?.id || null,
            updatedByAdminId: request.adminUser?.id || null
          },
          include: {
            show: {
              select: {
                id: true,
                title: true
              }
            },
            _count: {
              select: {
                submissions: true
              }
            },
            submissions: {
              select: {
                isPaid: true
              }
            }
          }
        });
      });

      await logAudit({
        actor: adminActor(request),
        actorAdminId: request.adminUser?.id || null,
        action: 'SENIOR_SENDOFF_FORM_CREATED',
        entityType: 'SeniorSendoffForm',
        entityId: created.id,
        metadata: {
          showId: created.showId,
          publicSlug: created.publicSlug,
          deadlineAt: created.deadlineAt.toISOString(),
          isOpen: created.isOpen,
          secondSubmissionPriceCents: created.secondSubmissionPriceCents,
          schemaVersion: created.schemaVersion
        }
      });

      reply.status(201).send(serializeFormSummary(created, new Date()));
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to create shout out form');
    }
  });

  app.get('/api/admin/forms/senior-sendoff', { preHandler: app.requireAdminRole('ADMIN') }, async (_request, reply) => {
    try {
      const forms = await prisma.seniorSendoffForm.findMany({
        orderBy: [{ createdAt: 'desc' }],
        include: {
          show: {
            select: {
              id: true,
              title: true
            }
          },
          _count: {
            select: {
              submissions: true
            }
          },
          submissions: {
            select: {
              isPaid: true
            }
          }
        }
      });

      const now = new Date();
      reply.send(forms.map((form) => serializeFormSummary(form, now)));
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to fetch shout out forms');
    }
  });

  app.patch('/api/admin/forms/senior-sendoff/:id', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const params = request.params as { id: string };
    const parsed = updateSeniorSendoffFormSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const existing = await prisma.seniorSendoffForm.findUnique({
        where: { id: params.id },
        include: {
          show: {
            select: {
              id: true,
              title: true
            }
          },
          _count: {
            select: {
              submissions: true
            }
          },
          submissions: {
            select: {
              isPaid: true
            }
          }
        }
      });

      if (!existing) {
        throw new HttpError(404, 'Form not found');
      }

      if (existing.isArchived && parsed.data.isOpen === true) {
        throw new HttpError(400, 'Archived forms cannot be opened.');
      }

      const nextQuestions = parsed.data.questions
        ? mergeSeniorSendoffQuestions(existing.questionConfig, parsed.data.questions)
        : undefined;

      const updated = await prisma.seniorSendoffForm.update({
        where: { id: params.id },
        data: {
          title: parsed.data.title,
          instructions: parsed.data.instructions,
          questionConfig: nextQuestions,
          deadlineAt: parsed.data.deadlineAt ? new Date(parsed.data.deadlineAt) : undefined,
          isOpen: parsed.data.isOpen,
          secondSubmissionPriceCents: parsed.data.secondSubmissionPriceCents,
          updatedByAdminId: request.adminUser?.id || null
        },
        include: {
          show: {
            select: {
              id: true,
              title: true
            }
          },
          _count: {
            select: {
              submissions: true
            }
          },
          submissions: {
            select: {
              isPaid: true
            }
          }
        }
      });

      const closedByToggle = existing.isOpen && parsed.data.isOpen === false;
      const action = closedByToggle ? 'SENIOR_SENDOFF_FORM_CLOSED' : 'SENIOR_SENDOFF_FORM_UPDATED';

      await logAudit({
        actor: adminActor(request),
        actorAdminId: request.adminUser?.id || null,
        action,
        entityType: 'SeniorSendoffForm',
        entityId: updated.id,
        metadata: {
          title: updated.title,
          deadlineAt: updated.deadlineAt.toISOString(),
          isOpen: updated.isOpen,
          secondSubmissionPriceCents: updated.secondSubmissionPriceCents,
          patchedFields: Object.keys(parsed.data)
        }
      });

      reply.send(serializeFormSummary(updated, new Date()));
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to update shout out form');
    }
  });

  app.get('/api/admin/forms/senior-sendoff/:id/submissions', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const params = request.params as { id: string };

    try {
      const form = await prisma.seniorSendoffForm.findUnique({
        where: { id: params.id },
        select: { id: true }
      });
      if (!form) {
        throw new HttpError(404, 'Form not found');
      }

      const submissions = await prisma.seniorSendoffSubmission.findMany({
        where: { formId: params.id },
        orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }]
      });

      reply.send(
        submissions.map((submission) => ({
          id: submission.id,
          formId: submission.formId,
          parentName: submission.parentName,
          parentEmail: submission.parentEmail,
          parentPhone: submission.parentPhone,
          studentName: submission.studentName,
          message: submission.message,
          extraResponses: submission.extraResponses ?? {},
          entryNumber: submission.entryNumber,
          isPaid: submission.isPaid,
          paymentIntentId: submission.paymentIntentId,
          paymentAmountCents: submission.paymentAmountCents,
          paymentCurrency: submission.paymentCurrency,
          submittedAt: submission.submittedAt,
          createdAt: submission.createdAt,
          updatedAt: submission.updatedAt
        }))
      );
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to fetch shout out submissions');
    }
  });

  app.delete('/api/admin/forms/senior-sendoff/:id/submissions/:submissionId', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const parsedParams = adminSeniorSendoffSubmissionParamsSchema.safeParse(request.params || {});
    if (!parsedParams.success) {
      return reply.status(400).send({ error: parsedParams.error.flatten() });
    }

    try {
      const form = await prisma.seniorSendoffForm.findUnique({
        where: { id: parsedParams.data.id },
        select: {
          id: true,
          showId: true,
          title: true,
          show: {
            select: {
              title: true
            }
          }
        }
      });
      if (!form) {
        throw new HttpError(404, 'Form not found');
      }

      const submission = await prisma.seniorSendoffSubmission.findFirst({
        where: {
          id: parsedParams.data.submissionId,
          formId: form.id
        },
        select: {
          id: true,
          parentName: true,
          parentEmail: true,
          studentName: true,
          entryNumber: true,
          isPaid: true,
          paymentAmountCents: true,
          paymentCurrency: true,
          paymentIntentId: true
        }
      });
      if (!submission) {
        throw new HttpError(404, 'Submission not found');
      }

      await prisma.seniorSendoffSubmission.delete({
        where: { id: submission.id }
      });

      await logAudit({
        actor: adminActor(request),
        actorAdminId: request.adminUser?.id || null,
        action: 'SENIOR_SENDOFF_SUBMISSION_DELETED',
        entityType: 'SeniorSendoffSubmission',
        entityId: submission.id,
        metadata: {
          formId: form.id,
          formTitle: form.title,
          showId: form.showId,
          showTitle: form.show.title,
          parentName: submission.parentName,
          parentEmail: submission.parentEmail,
          studentName: submission.studentName,
          entryNumber: submission.entryNumber,
          isPaid: submission.isPaid,
          paymentAmountCents: submission.paymentAmountCents,
          paymentCurrency: submission.paymentCurrency,
          paymentIntentId: submission.paymentIntentId
        }
      });

      return reply.send({
        deleted: true,
        formId: form.id,
        submissionId: submission.id,
        isPaid: submission.isPaid
      });
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to delete shout out submission');
    }
  });

  app.post('/api/admin/forms/senior-sendoff/:id/archive', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const params = request.params as { id: string };

    try {
      const existing = await prisma.seniorSendoffForm.findUnique({
        where: { id: params.id },
        include: {
          show: {
            select: {
              id: true,
              title: true
            }
          },
          _count: {
            select: {
              submissions: true
            }
          },
          submissions: {
            select: {
              isPaid: true
            }
          }
        }
      });

      if (!existing) {
        throw new HttpError(404, 'Form not found');
      }

      if (existing.isArchived) {
        return reply.send(serializeFormSummary(existing, new Date()));
      }

      const archived = await prisma.seniorSendoffForm.update({
        where: { id: params.id },
        data: {
          isArchived: true,
          archivedAt: new Date(),
          isOpen: false,
          updatedByAdminId: request.adminUser?.id || null
        },
        include: {
          show: {
            select: {
              id: true,
              title: true
            }
          },
          _count: {
            select: {
              submissions: true
            }
          },
          submissions: {
            select: {
              isPaid: true
            }
          }
        }
      });

      await logAudit({
        actor: adminActor(request),
        actorAdminId: request.adminUser?.id || null,
        action: 'SENIOR_SENDOFF_FORM_ARCHIVED',
        entityType: 'SeniorSendoffForm',
        entityId: archived.id,
        metadata: {
          showId: archived.showId,
          archivedAt: archived.archivedAt?.toISOString() || null,
          responseCount: archived._count?.submissions ?? 0
        }
      });

      reply.send(serializeFormSummary(archived, new Date()));
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to archive shout out form');
    }
  });

  app.delete('/api/admin/forms/senior-sendoff/:id', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const params = request.params as { id: string };

    try {
      const existing = await prisma.seniorSendoffForm.findUnique({
        where: { id: params.id },
        include: {
          show: {
            select: {
              id: true,
              title: true
            }
          },
          submissions: {
            select: {
              id: true,
              isPaid: true
            }
          }
        }
      });
      if (!existing) {
        throw new HttpError(404, 'Form not found');
      }

      await prisma.seniorSendoffForm.delete({
        where: { id: existing.id }
      });

      const paidSubmissionCount = existing.submissions.reduce(
        (sum, submission) => sum + (submission.isPaid ? 1 : 0),
        0
      );

      await logAudit({
        actor: adminActor(request),
        actorAdminId: request.adminUser?.id || null,
        action: 'SENIOR_SENDOFF_FORM_DELETED',
        entityType: 'SeniorSendoffForm',
        entityId: existing.id,
        metadata: {
          showId: existing.showId,
          submissionCount: existing.submissions.length,
          paidSubmissionCount
        }
      });

      reply.send({
        deleted: true,
        formId: existing.id,
        submissionCount: existing.submissions.length,
        paidSubmissionCount
      });
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to delete shout out form');
    }
  });

  app.get('/api/forms/senior-sendoff/:slug', async (request, reply) => {
    const params = request.params as { slug: string };

    try {
      const form = await prisma.seniorSendoffForm.findUnique({
        where: { publicSlug: params.slug },
        include: {
          show: {
            select: {
              id: true,
              title: true
            }
          }
        }
      });

      if (!form) {
        throw new HttpError(404, 'Form not found');
      }
      if (form.isArchived) {
        throw new HttpError(404, 'Form not found');
      }

      const now = new Date();
      const questions = normalizeSeniorSendoffQuestions(form.questionConfig);
      reply.send({
        id: form.id,
        publicSlug: form.publicSlug,
        schemaVersion: form.schemaVersion,
        title: form.title,
        instructions: form.instructions,
        questions: {
          ...questions,
          customQuestions: questions.customQuestions.filter((question) => !question.hidden)
        },
        deadlineAt: form.deadlineAt,
        isOpen: form.isOpen,
        secondSubmissionPriceCents: form.secondSubmissionPriceCents,
        acceptingResponses: isAcceptingResponses(form, now),
        closedMessage: acceptanceMessage(form, now),
        show: {
          id: form.show.id,
          title: form.show.title
        },
        limits: {
          maxPerStudent: 2,
          firstIsFree: true,
          secondRequiresPayment: form.secondSubmissionPriceCents > 0
        },
        requiredFields: ['parentName', 'parentEmail', 'parentPhone', 'studentName', 'message']
      });
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to fetch shout out form');
    }
  });

  app.post('/api/forms/senior-sendoff/:slug/eligibility', async (request, reply) => {
    const params = request.params as { slug: string };
    const parsed = publicEligibilitySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const form = await prisma.seniorSendoffForm.findUnique({
        where: { publicSlug: params.slug },
        select: {
          id: true,
          isOpen: true,
          deadlineAt: true,
          isArchived: true,
          secondSubmissionPriceCents: true
        }
      });
      if (!form) {
        throw new HttpError(404, 'Form not found');
      }
      if (form.isArchived) {
        throw new HttpError(404, 'Form not found');
      }

      const now = new Date();
      if (!isAcceptingResponses(form, now)) {
        throw new HttpError(409, "This form isn't accepting responses.");
      }

      const parentEmail = normalizeEmail(parsed.data.parentEmail);
      const studentKey = normalizeStudentKey(parsed.data.studentName);

      const eligibility = await computeEligibility({
        formId: form.id,
        parentEmail,
        studentKey,
        secondSubmissionPriceCents: form.secondSubmissionPriceCents
      });

      reply.send({
        ...eligibility,
        secondSubmissionPriceCents: form.secondSubmissionPriceCents,
        currency: 'usd'
      });
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to check submission eligibility');
    }
  });

  app.post(
    '/api/forms/senior-sendoff/:slug/payment-intent',
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '1 minute'
        }
      }
    },
    async (request, reply) => {
      const params = request.params as { slug: string };
      const parsed = publicPaymentIntentSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.flatten() });
      }

      try {
        const form = await prisma.seniorSendoffForm.findUnique({
          where: { publicSlug: params.slug },
          select: {
            id: true,
            showId: true,
            isOpen: true,
            deadlineAt: true,
            isArchived: true,
            secondSubmissionPriceCents: true,
            show: {
              select: {
                title: true
              }
            }
          }
        });

        if (!form) {
          throw new HttpError(404, 'Form not found');
        }
        if (form.isArchived) {
          throw new HttpError(404, 'Form not found');
        }

        const now = new Date();
        if (!isAcceptingResponses(form, now)) {
          throw new HttpError(409, "This form isn't accepting responses.");
        }

        const parentEmail = normalizeEmail(parsed.data.parentEmail);
        const studentKey = normalizeStudentKey(parsed.data.studentName);
        const eligibility = await computeEligibility({
          formId: form.id,
          parentEmail,
          studentKey,
          secondSubmissionPriceCents: form.secondSubmissionPriceCents
        });

        if (eligibility.maxReached) {
          throw new HttpError(409, 'You have already submitted the maximum of 2 shout-outs for this student.');
        }

        if (eligibility.existingCount === 0 || form.secondSubmissionPriceCents <= 0) {
          throw new HttpError(400, 'Payment is not required for the next submission.');
        }

        const amountCents = form.secondSubmissionPriceCents;
        const parentName = parsed.data.parentName.trim();
        const studentName = parsed.data.studentName.trim();
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amountCents,
          currency: 'usd',
          automatic_payment_methods: { enabled: true },
          receipt_email: parentEmail,
          description: `Shout out (${studentName}) - ${form.show.title}`,
          metadata: {
            source: 'senior_sendoff_second_submission',
            formId: form.id,
            showId: form.showId,
            parentName,
            parentEmail,
            studentName,
            studentKey,
            amountCents: String(amountCents)
          }
        });

        if (!paymentIntent.client_secret) {
          return reply.status(500).send({ error: 'Stripe payment intent missing client secret' });
        }

        return reply.send({
          paymentIntentId: paymentIntent.id,
          clientSecret: paymentIntent.client_secret,
          publishableKey: env.STRIPE_PUBLISHABLE_KEY || undefined,
          amountCents,
          currency: 'usd'
        });
      } catch (err) {
        if (err instanceof Stripe.errors.StripeError) {
          const statusCode = err.type === 'StripeInvalidRequestError' ? 400 : 502;
          return reply.status(statusCode).send({ error: err.message || 'Payment provider error' });
        }

        handleRouteError(reply, err, 'We hit a small backstage snag while trying to create second submission payment intent');
      }
    }
  );

  app.post('/api/forms/senior-sendoff/:slug/submissions', async (request, reply) => {
    const params = request.params as { slug: string };
    const parsed = publicSubmissionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const form = await prisma.seniorSendoffForm.findUnique({
        where: { publicSlug: params.slug },
        include: {
          show: {
            select: {
              id: true,
              title: true
            }
          }
        }
      });

      if (!form) {
        throw new HttpError(404, 'Form not found');
      }
      if (form.isArchived) {
        throw new HttpError(404, 'Form not found');
      }

      const now = new Date();
      if (!isAcceptingResponses(form, now)) {
        throw new HttpError(409, "This form isn't accepting responses.");
      }

      const parentName = parsed.data.parentName.trim();
      const parentEmail = normalizeEmail(parsed.data.parentEmail);
      const parentPhone = parsed.data.parentPhone.trim();
      const studentName = parsed.data.studentName.trim();
      const studentKey = normalizeStudentKey(studentName);
      const message = parsed.data.message.trim();
      const questionConfig = normalizeSeniorSendoffQuestions(form.questionConfig);
      const normalizedCustomResponses = normalizeSubmissionCustomResponses(
        parsed.data.customResponses,
        questionConfig.customQuestions
      );

      const existingCount = await prisma.seniorSendoffSubmission.count({
        where: {
          formId: form.id,
          parentEmail,
          studentKey
        }
      });

      if (existingCount >= 2) {
        throw new HttpError(409, 'You have already submitted the maximum of 2 shout-outs for this student.');
      }

      const entryNumber = existingCount + 1;
      const requiresPayment = entryNumber === 2 && form.secondSubmissionPriceCents > 0;

      const paymentIntentId = parsed.data.paymentIntentId?.trim();
      if (!requiresPayment && paymentIntentId) {
        throw new HttpError(400, 'Payment is not required for this submission.');
      }

      if (requiresPayment && !paymentIntentId) {
        return reply.status(402).send({
          error: `A payment of $${(form.secondSubmissionPriceCents / 100).toFixed(2)} is required for a second shout-out.`,
          requiresPayment: true,
          amountCents: form.secondSubmissionPriceCents,
          currency: 'usd'
        });
      }

      let paymentDetails: { amount: number; currency: string } | null = null;
      if (requiresPayment && paymentIntentId) {
        const alreadyUsed = await prisma.seniorSendoffSubmission.findUnique({
          where: { paymentIntentId },
          select: { id: true }
        });
        if (alreadyUsed) {
          throw new HttpError(409, 'This payment has already been used for a submission.');
        }

        paymentDetails = await verifySecondSubmissionPayment({
          paymentIntentId,
          expectedAmountCents: form.secondSubmissionPriceCents,
          formId: form.id,
          parentEmail,
          studentKey
        });
      }

      let submission;
      try {
        submission = await prisma.seniorSendoffSubmission.create({
          data: {
            formId: form.id,
            parentName,
            parentEmail,
            parentPhone,
            studentName,
            studentKey,
            message,
            extraResponses: normalizedCustomResponses,
            entryNumber,
            isPaid: requiresPayment,
            paymentIntentId: requiresPayment ? paymentIntentId : null,
            paymentAmountCents: paymentDetails?.amount,
            paymentCurrency: paymentDetails?.currency
          },
          select: {
            id: true,
            entryNumber: true,
            isPaid: true,
            paymentIntentId: true,
            submittedAt: true,
            createdAt: true,
            updatedAt: true
          }
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new HttpError(409, 'A shout-out for this student was just submitted. Refresh and try again.');
        }
        throw err;
      }

      try {
        await sendSeniorSendoffSubmissionEmail({
          parentName,
          parentEmail,
          parentPhone,
          studentName,
          showTitle: form.show.title,
          message,
          entryNumber: submission.entryNumber,
          isPaid: submission.isPaid,
          paidAmountCents: paymentDetails?.amount || null,
          paidCurrency: paymentDetails?.currency || null,
          paymentIntentId: submission.paymentIntentId || null
        });
      } catch (mailErr) {
        request.log.error({ err: mailErr, submissionId: submission.id }, 'We hit a small backstage snag while trying to send shout out submission email');
      }

      const remainingCount = Math.max(0, 2 - submission.entryNumber);

      reply.status(201).send({
        submissionId: submission.id,
        entryNumber: submission.entryNumber,
        isPaid: submission.isPaid,
        remainingCount,
        submittedAt: submission.submittedAt,
        createdAt: submission.createdAt,
        updatedAt: submission.updatedAt
      });
    } catch (err) {
      if (err instanceof Stripe.errors.StripeError) {
        const statusCode = err.type === 'StripeInvalidRequestError' ? 400 : 502;
        return reply.status(statusCode).send({ error: err.message || 'Payment provider error' });
      }

      handleRouteError(reply, err, 'We hit a small backstage snag while trying to submit shout out');
    }
  });
};
