import { randomUUID } from 'node:crypto';
import { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { env } from '../lib/env.js';
import { HttpError } from '../lib/http-error.js';
import { handleRouteError } from '../lib/route-error.js';
import { logAudit } from '../lib/audit-log.js';
import { uploadImageFromDataUrl } from '../lib/r2.js';
import { normalizeStudentVerificationCode } from '../services/student-ticket-credit-service.js';

const PROGRAM_BIO_SCHEMA_VERSION = 'PROGRAM_BIO_V1';
const PROGRAM_BIO_DEFAULT_TITLE = 'Bio for Ticketing Site and Program';
const PROGRAM_BIO_MAX_WORDS = 120;

const PROGRAM_BIO_DEFAULT_INSTRUCTIONS = `Please complete this form so we can feature you correctly on the ticketing site and in the program.

What to submit:
- Your display name exactly as you want it shown.
- Your school email (@${env.STAFF_ALLOWED_DOMAIN}).
- Your grade level (9, 10, 11, or 12).
- Your role in the show.
- A short bio (max ${PROGRAM_BIO_MAX_WORDS} words).
- A clear headshot image.

Notes:
- You can submit again with the same school email to update your response.
- The latest submission for your school email is what the team will review and sync.`;

const programBioCustomQuestionTypeSchema = z.enum(['short_text', 'long_text', 'multiple_choice']);

const programBioCustomQuestionSchema = z
  .object({
    id: z.string().trim().min(1).max(100),
    label: z.string().trim().max(160),
    type: programBioCustomQuestionTypeSchema,
    required: z.boolean().optional(),
    hidden: z.boolean().optional(),
    options: z.array(z.string().trim().min(1).max(160)).max(25).optional()
  })
  .strict();

const programBioQuestionsPatchSchema = z
  .object({
    fullNameLabel: z.string().trim().min(1).max(120).optional(),
    schoolEmailLabel: z.string().trim().min(1).max(120).optional(),
    gradeLevelLabel: z.string().trim().min(1).max(120).optional(),
    roleInShowLabel: z.string().trim().min(1).max(120).optional(),
    bioLabel: z.string().trim().min(1).max(120).optional(),
    headshotLabel: z.string().trim().min(1).max(120).optional(),
    customQuestions: z.array(programBioCustomQuestionSchema).max(40).optional()
  })
  .strict();

type ProgramBioCustomQuestionType = z.infer<typeof programBioCustomQuestionTypeSchema>;

type ProgramBioCustomQuestion = {
  id: string;
  label: string;
  type: ProgramBioCustomQuestionType;
  required: boolean;
  hidden: boolean;
  options: string[];
};

type ProgramBioQuestionsPatch = z.infer<typeof programBioQuestionsPatchSchema>;

type ProgramBioQuestions = {
  fullNameLabel: string;
  schoolEmailLabel: string;
  gradeLevelLabel: string;
  roleInShowLabel: string;
  bioLabel: string;
  headshotLabel: string;
  customQuestions: ProgramBioCustomQuestion[];
};

const PROGRAM_BIO_DEFAULT_QUESTIONS: ProgramBioQuestions = {
  fullNameLabel: 'Full name',
  schoolEmailLabel: 'School email',
  gradeLevelLabel: 'Grade',
  roleInShowLabel: 'Role in show',
  bioLabel: 'Bio',
  headshotLabel: 'Headshot upload',
  customQuestions: []
};

const createProgramBioFormSchema = z.object({
  showId: z.string().trim().min(1),
  deadlineAt: z.string().datetime().optional()
});

const updateProgramBioFormSchema = z
  .object({
    title: z.string().trim().min(1).max(180).optional(),
    instructions: z.string().trim().min(1).max(12_000).optional(),
    deadlineAt: z.string().datetime().optional(),
    isOpen: z.boolean().optional(),
    questions: programBioQuestionsPatchSchema.optional()
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Provide at least one field to update'
  });

const syncProgramBioFormSchema = z.object({
  syncCast: z.boolean().default(true),
  syncStudentCredits: z.boolean().default(false)
});

const publicProgramBioSubmissionSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  schoolEmail: z.string().trim().email().max(160),
  gradeLevel: z.coerce.number().int().min(9).max(12),
  roleInShow: z.string().trim().min(1).max(120),
  bio: z.string().trim().min(1).max(2400),
  headshotDataUrl: z.string().trim().min(1).max(9_000_000),
  customResponses: z.record(z.string().max(4_000)).optional()
});

type AdminRequestLike = {
  user?: {
    username?: string;
  };
  adminUser?: {
    id: string;
    username: string;
  };
};

type ProgramBioSyncResult = {
  created: number;
  updated: number;
  skipped: number;
};

type SubmissionSyncInput = {
  fullName: string;
  schoolEmail: string;
  gradeLevel: number;
  roleInShow: string;
  bio: string;
  headshotUrl: string;
};

function adminActor(request: AdminRequestLike): string {
  return request.user?.username || request.adminUser?.username || 'admin';
}

function normalizeSchoolEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hasAllowedSchoolDomain(email: string): boolean {
  return normalizeSchoolEmail(email).endsWith(`@${env.STAFF_ALLOWED_DOMAIN.toLowerCase()}`);
}

function countWords(value: string): number {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
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
  return `program-bio-${showSlug}`;
}

async function generateUniquePublicSlug(tx: Prisma.TransactionClient, showTitle: string): Promise<string> {
  const base = buildBasePublicSlug(showTitle);
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const suffix = attempt === 0 ? '' : `-${randomUUID().slice(0, 6)}`;
    const candidate = `${base}${suffix}`;
    const existing = await tx.programBioForm.findUnique({
      where: { publicSlug: candidate },
      select: { id: true }
    });
    if (!existing) {
      return candidate;
    }
  }

  throw new HttpError(500, 'Unable to generate a unique public form link');
}

function isAcceptingResponses(form: { isOpen: boolean; deadlineAt: Date }, now: Date): boolean {
  return form.isOpen && form.deadlineAt > now;
}

function acceptanceMessage(form: { isOpen: boolean; deadlineAt: Date }, now: Date): string {
  if (!form.isOpen) {
    return "This form isn't accepting responses.";
  }
  if (form.deadlineAt <= now) {
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

function normalizeCustomQuestions(value: ProgramBioQuestionsPatch['customQuestions']): ProgramBioCustomQuestion[] {
  if (!Array.isArray(value)) return [];

  const seenIds = new Set<string>();
  const normalized: ProgramBioCustomQuestion[] = [];

  for (const question of value) {
    const id = question.id.trim();
    if (!id || seenIds.has(id)) continue;

    const label = question.label.trim();
    if (!label) continue;

    const options = question.type === 'multiple_choice'
      ? normalizeCustomQuestionOptions(question.options)
      : [];

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

function normalizeProgramBioQuestions(value: Prisma.JsonValue | null | undefined): ProgramBioQuestions {
  const parsed = programBioQuestionsPatchSchema.safeParse(value ?? {});
  if (!parsed.success) {
    return { ...PROGRAM_BIO_DEFAULT_QUESTIONS };
  }

  const { customQuestions, ...labelPatch } = parsed.data;
  const normalizedLabels = Object.fromEntries(
    Object.entries(labelPatch).filter(([, fieldValue]) => fieldValue !== undefined)
  ) as Omit<ProgramBioQuestions, 'customQuestions'>;

  return {
    ...PROGRAM_BIO_DEFAULT_QUESTIONS,
    ...normalizedLabels,
    customQuestions: normalizeCustomQuestions(customQuestions)
  };
}

function mergeProgramBioQuestions(
  current: Prisma.JsonValue | null | undefined,
  patch: ProgramBioQuestionsPatch
): ProgramBioQuestions {
  const base = normalizeProgramBioQuestions(current);
  const { customQuestions, ...labelPatch } = patch;
  const normalizedLabels = Object.fromEntries(
    Object.entries(labelPatch).filter(([, fieldValue]) => fieldValue !== undefined)
  ) as Partial<Omit<ProgramBioQuestions, 'customQuestions'>>;

  return normalizeProgramBioQuestions({
    ...base,
    ...normalizedLabels,
    customQuestions: customQuestions ?? base.customQuestions
  } as Prisma.JsonObject);
}

function normalizeSubmissionCustomResponses(
  value: Record<string, string> | undefined,
  customQuestions: ProgramBioCustomQuestion[]
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
    createdAt: Date;
    updatedAt: Date;
    show: { id: string; title: string };
    _count?: { submissions: number };
  },
  now: Date
) {
  const acceptingResponses = isAcceptingResponses(form, now);
  return {
    id: form.id,
    showId: form.showId,
    show: {
      id: form.show.id,
      title: form.show.title
    },
    publicSlug: form.publicSlug,
    sharePath: `/forms/${form.publicSlug}`,
    schemaVersion: form.schemaVersion,
    title: form.title,
    instructions: form.instructions,
    questions: normalizeProgramBioQuestions(form.questionConfig),
    deadlineAt: form.deadlineAt,
    isOpen: form.isOpen,
    acceptingResponses,
    status: acceptingResponses ? 'OPEN' : 'CLOSED',
    responseCount: form._count?.submissions ?? 0,
    createdAt: form.createdAt,
    updatedAt: form.updatedAt
  };
}

function buildStudentCodeFromName(name: string): string {
  const tokens = name
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/[^a-zA-Z0-9]/g, ''))
    .filter(Boolean);
  if (tokens.length === 0) return '';

  const firstInitial = tokens[0][0] || '';
  const lastName = tokens[tokens.length - 1] || '';
  return normalizeStudentVerificationCode(`${firstInitial}${lastName}`);
}

async function syncParticipantsToStudentCreditsTx(
  tx: Prisma.TransactionClient,
  showId: string,
  participants: Array<{ name: string; role: string }>
): Promise<ProgramBioSyncResult> {
  const normalizedParticipants = participants
    .map((member) => ({
      name: member.name.trim(),
      role: member.role.trim()
    }))
    .filter((member) => member.name && member.role);

  if (normalizedParticipants.length === 0) {
    return { created: 0, updated: 0, skipped: 0 };
  }

  const existingCredits = await tx.studentTicketCredit.findMany({
    where: { showId },
    select: {
      id: true,
      studentName: true,
      studentEmail: true,
      roleName: true
    }
  });

  const existingByCode = new Map<string, (typeof existingCredits)[number]>();
  const existingByName = new Map<string, (typeof existingCredits)[number]>();
  existingCredits.forEach((credit) => {
    const normalizedName = normalizeName(credit.studentName);
    if (normalizedName && !existingByName.has(normalizedName)) {
      existingByName.set(normalizedName, credit);
    }

    if (!credit.studentEmail) return;
    const normalizedCode = normalizeStudentVerificationCode(credit.studentEmail);
    if (!normalizedCode) return;
    if (!existingByCode.has(normalizedCode)) {
      existingByCode.set(normalizedCode, credit);
    }
  });

  const assignedCodes = new Set<string>();
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const member of normalizedParticipants) {
    const normalizedMemberName = normalizeName(member.name);
    const existingByMemberName = existingByName.get(normalizedMemberName);
    const baseGeneratedCode = buildStudentCodeFromName(member.name);
    let candidateCode = existingByMemberName?.studentEmail
      ? normalizeStudentVerificationCode(existingByMemberName.studentEmail)
      : baseGeneratedCode;

    if (!candidateCode || !baseGeneratedCode) {
      skipped += 1;
      continue;
    }

    let suffix = 2;
    while (true) {
      const codeOwner = existingByCode.get(candidateCode);
      const ownedBySameName =
        codeOwner && normalizeName(codeOwner.studentName) === normalizedMemberName;
      if (!assignedCodes.has(candidateCode) && (!codeOwner || ownedBySameName)) {
        break;
      }
      candidateCode = `${baseGeneratedCode}${suffix}`;
      suffix += 1;
    }

    const existingCredit = existingByCode.get(candidateCode);
    if (existingCredit) {
      await tx.studentTicketCredit.update({
        where: { id: existingCredit.id },
        data: {
          studentName: member.name,
          roleName: member.role
        }
      });
      updated += 1;
    } else {
      const createdCredit = await tx.studentTicketCredit.create({
        data: {
          showId,
          studentName: member.name,
          studentEmail: candidateCode,
          roleName: member.role,
          allocatedTickets: 2,
          isActive: true
        },
        select: {
          id: true,
          studentName: true,
          studentEmail: true,
          roleName: true
        }
      });
      existingByCode.set(candidateCode, createdCredit);
      created += 1;
    }

    assignedCodes.add(candidateCode);
  }

  return { created, updated, skipped };
}

async function syncSubmissionsToCastTx(
  tx: Prisma.TransactionClient,
  showId: string,
  submissions: SubmissionSyncInput[]
): Promise<ProgramBioSyncResult> {
  if (submissions.length === 0) {
    return { created: 0, updated: 0, skipped: 0 };
  }

  const existingCast = await tx.castMember.findMany({
    where: { showId },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      name: true,
      schoolEmail: true,
      position: true
    }
  });

  const castByEmail = new Map<string, (typeof existingCast)[number]>();
  const castByName = new Map<string, (typeof existingCast)[number]>();
  let maxPosition = -1;

  for (const castMember of existingCast) {
    if (castMember.position > maxPosition) {
      maxPosition = castMember.position;
    }

    const normalizedName = normalizeName(castMember.name);
    if (normalizedName && !castByName.has(normalizedName)) {
      castByName.set(normalizedName, castMember);
    }

    if (castMember.schoolEmail) {
      castByEmail.set(normalizeSchoolEmail(castMember.schoolEmail), castMember);
    }
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const submission of submissions) {
    try {
      const normalizedEmail = normalizeSchoolEmail(submission.schoolEmail);
      const normalizedFullName = normalizeName(submission.fullName);

      const existingByEmail = castByEmail.get(normalizedEmail);
      const existingByName = castByName.get(normalizedFullName);
      const existing = existingByEmail || existingByName;

      if (existing) {
        await tx.castMember.update({
          where: { id: existing.id },
          data: {
            name: submission.fullName,
            role: submission.roleInShow,
            photoUrl: submission.headshotUrl,
            schoolEmail: normalizedEmail,
            gradeLevel: submission.gradeLevel,
            bio: submission.bio
          }
        });

        const next = {
          ...existing,
          name: submission.fullName,
          schoolEmail: normalizedEmail
        };
        castByEmail.set(normalizedEmail, next);
        castByName.set(normalizedFullName, next);
        updated += 1;
        continue;
      }

      maxPosition += 1;
      const createdCastMember = await tx.castMember.create({
        data: {
          showId,
          name: submission.fullName,
          role: submission.roleInShow,
          photoUrl: submission.headshotUrl,
          schoolEmail: normalizedEmail,
          gradeLevel: submission.gradeLevel,
          bio: submission.bio,
          position: maxPosition
        },
        select: {
          id: true,
          name: true,
          schoolEmail: true,
          position: true
        }
      });

      castByEmail.set(normalizedEmail, createdCastMember);
      castByName.set(normalizedFullName, createdCastMember);
      created += 1;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        skipped += 1;
        continue;
      }
      throw err;
    }
  }

  return { created, updated, skipped };
}

export const programBioFormRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/admin/forms', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const parsed = createProgramBioFormSchema.safeParse(request.body);
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

        const existingForm = await tx.programBioForm.findUnique({
          where: { showId: show.id },
          select: { id: true }
        });
        if (existingForm) {
          throw new HttpError(409, 'A program bio form already exists for this show');
        }

        const defaultDeadline = show.performances[0]?.startsAt || new Date(Date.now() + 21 * 24 * 60 * 60 * 1000);
        const deadlineAt = parsed.data.deadlineAt ? new Date(parsed.data.deadlineAt) : defaultDeadline;
        const publicSlug = await generateUniquePublicSlug(tx, show.title);

        return tx.programBioForm.create({
          data: {
            showId: show.id,
            publicSlug,
            schemaVersion: PROGRAM_BIO_SCHEMA_VERSION,
            title: PROGRAM_BIO_DEFAULT_TITLE,
            instructions: PROGRAM_BIO_DEFAULT_INSTRUCTIONS,
            questionConfig: PROGRAM_BIO_DEFAULT_QUESTIONS,
            deadlineAt,
            isOpen: true,
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
            }
          }
        });
      });

      await logAudit({
        actor: adminActor(request),
        actorAdminId: request.adminUser?.id || null,
        action: 'PROGRAM_BIO_FORM_CREATED',
        entityType: 'ProgramBioForm',
        entityId: created.id,
        metadata: {
          showId: created.showId,
          publicSlug: created.publicSlug,
          deadlineAt: created.deadlineAt.toISOString(),
          isOpen: created.isOpen,
          schemaVersion: created.schemaVersion
        }
      });

      reply.status(201).send(serializeFormSummary(created, new Date()));
    } catch (err) {
      handleRouteError(reply, err, 'Failed to create form');
    }
  });

  app.get('/api/admin/forms', { preHandler: app.requireAdminRole('ADMIN') }, async (_request, reply) => {
    try {
      const forms = await prisma.programBioForm.findMany({
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
          }
        }
      });

      const now = new Date();
      reply.send(forms.map((form) => serializeFormSummary(form, now)));
    } catch (err) {
      handleRouteError(reply, err, 'Failed to fetch forms');
    }
  });

  app.get('/api/admin/forms/:id', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const params = request.params as { id: string };

    try {
      const form = await prisma.programBioForm.findUnique({
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
          }
        }
      });

      if (!form) {
        throw new HttpError(404, 'Form not found');
      }

      reply.send(serializeFormSummary(form, new Date()));
    } catch (err) {
      handleRouteError(reply, err, 'Failed to fetch form');
    }
  });

  app.patch('/api/admin/forms/:id', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const params = request.params as { id: string };
    const parsed = updateProgramBioFormSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const existing = await prisma.programBioForm.findUnique({
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
          }
        }
      });
      if (!existing) {
        throw new HttpError(404, 'Form not found');
      }

      const nextQuestions = parsed.data.questions
        ? mergeProgramBioQuestions(existing.questionConfig, parsed.data.questions)
        : undefined;

      const updated = await prisma.programBioForm.update({
        where: { id: params.id },
        data: {
          title: parsed.data.title,
          instructions: parsed.data.instructions,
          questionConfig: nextQuestions,
          deadlineAt: parsed.data.deadlineAt ? new Date(parsed.data.deadlineAt) : undefined,
          isOpen: parsed.data.isOpen,
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
          }
        }
      });

      const closedByToggle = existing.isOpen && parsed.data.isOpen === false;
      const action = closedByToggle ? 'PROGRAM_BIO_FORM_CLOSED' : 'PROGRAM_BIO_FORM_UPDATED';

      await logAudit({
        actor: adminActor(request),
        actorAdminId: request.adminUser?.id || null,
        action,
        entityType: 'ProgramBioForm',
        entityId: updated.id,
        metadata: {
          title: updated.title,
          deadlineAt: updated.deadlineAt.toISOString(),
          isOpen: updated.isOpen,
          patchedFields: Object.keys(parsed.data)
        }
      });

      reply.send(serializeFormSummary(updated, new Date()));
    } catch (err) {
      handleRouteError(reply, err, 'Failed to update form');
    }
  });

  app.get('/api/admin/forms/:id/submissions', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const params = request.params as { id: string };

    try {
      const form = await prisma.programBioForm.findUnique({
        where: { id: params.id },
        select: { id: true }
      });
      if (!form) {
        throw new HttpError(404, 'Form not found');
      }

      const submissions = await prisma.programBioSubmission.findMany({
        where: { formId: params.id },
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }]
      });

      reply.send(
        submissions.map((submission) => ({
          id: submission.id,
          formId: submission.formId,
          fullName: submission.fullName,
          schoolEmail: submission.schoolEmail,
          gradeLevel: submission.gradeLevel,
          roleInShow: submission.roleInShow,
          bio: submission.bio,
          headshotUrl: submission.headshotUrl,
          extraResponses: submission.extraResponses ?? {},
          submittedAt: submission.submittedAt,
          createdAt: submission.createdAt,
          updatedAt: submission.updatedAt
        }))
      );
    } catch (err) {
      handleRouteError(reply, err, 'Failed to fetch form submissions');
    }
  });

  app.post('/api/admin/forms/:id/sync', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const params = request.params as { id: string };
    const parsed = syncProgramBioFormSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    if (!parsed.data.syncCast && !parsed.data.syncStudentCredits) {
      return reply.status(400).send({ error: 'Choose at least one sync target.' });
    }

    try {
      const form = await prisma.programBioForm.findUnique({
        where: { id: params.id },
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

      const submissions = await prisma.programBioSubmission.findMany({
        where: { formId: form.id },
        orderBy: [{ updatedAt: 'asc' }, { createdAt: 'asc' }],
        select: {
          fullName: true,
          schoolEmail: true,
          gradeLevel: true,
          roleInShow: true,
          bio: true,
          headshotUrl: true
        }
      });

      const syncInput: SubmissionSyncInput[] = submissions.map((submission) => ({
        fullName: submission.fullName,
        schoolEmail: submission.schoolEmail,
        gradeLevel: submission.gradeLevel,
        roleInShow: submission.roleInShow,
        bio: submission.bio,
        headshotUrl: submission.headshotUrl
      }));

      const result = await prisma.$transaction(async (tx) => {
        const castResult = parsed.data.syncCast
          ? await syncSubmissionsToCastTx(tx, form.showId, syncInput)
          : null;

        const studentCreditResult = parsed.data.syncStudentCredits
          ? await syncParticipantsToStudentCreditsTx(
              tx,
              form.showId,
              syncInput.map((entry) => ({
                name: entry.fullName,
                role: entry.roleInShow
              }))
            )
          : null;

        return {
          syncCast: castResult,
          syncStudentCredits: studentCreditResult
        };
      });

      await logAudit({
        actor: adminActor(request),
        actorAdminId: request.adminUser?.id || null,
        action: 'PROGRAM_BIO_FORM_SYNCED',
        entityType: 'ProgramBioForm',
        entityId: form.id,
        metadata: {
          formId: form.id,
          showId: form.showId,
          submissionCount: submissions.length,
          syncCast: parsed.data.syncCast,
          syncStudentCredits: parsed.data.syncStudentCredits,
          result
        }
      });

      reply.send({
        formId: form.id,
        showId: form.showId,
        submissionCount: submissions.length,
        syncCast: result.syncCast,
        syncStudentCredits: result.syncStudentCredits
      });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to sync form submissions');
    }
  });

  app.get('/api/forms/:slug', async (request, reply) => {
    const params = request.params as { slug: string };

    try {
      const form = await prisma.programBioForm.findUnique({
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

      const now = new Date();
      const questions = normalizeProgramBioQuestions(form.questionConfig);
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
        acceptingResponses: isAcceptingResponses(form, now),
        closedMessage: acceptanceMessage(form, now),
        show: {
          id: form.show.id,
          title: form.show.title
        },
        requiredFields: ['fullName', 'schoolEmail', 'gradeLevel', 'roleInShow', 'bio', 'headshotDataUrl']
      });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to fetch form');
    }
  });

  app.post('/api/forms/:slug/submissions', async (request, reply) => {
    const params = request.params as { slug: string };
    const parsed = publicProgramBioSubmissionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const form = await prisma.programBioForm.findUnique({
        where: { publicSlug: params.slug },
        select: {
          id: true,
          showId: true,
          questionConfig: true,
          isOpen: true,
          deadlineAt: true
        }
      });
      if (!form) {
        throw new HttpError(404, 'Form not found');
      }

      const now = new Date();
      if (!isAcceptingResponses(form, now)) {
        throw new HttpError(409, "This form isn't accepting responses.");
      }

      const normalizedSchoolEmail = normalizeSchoolEmail(parsed.data.schoolEmail);
      if (!hasAllowedSchoolDomain(normalizedSchoolEmail)) {
        throw new HttpError(400, `Use your school email ending in @${env.STAFF_ALLOWED_DOMAIN}.`);
      }

      if (countWords(parsed.data.bio) > PROGRAM_BIO_MAX_WORDS) {
        throw new HttpError(400, `Bio must be ${PROGRAM_BIO_MAX_WORDS} words or fewer.`);
      }

      const questionConfig = normalizeProgramBioQuestions(form.questionConfig);
      const normalizedCustomResponses = normalizeSubmissionCustomResponses(
        parsed.data.customResponses,
        questionConfig.customQuestions
      );

      const uploaded = await uploadImageFromDataUrl({
        dataUrl: parsed.data.headshotDataUrl,
        scope: `program-bio/${form.id}`,
        filenameBase: parsed.data.fullName
      });

      const existing = await prisma.programBioSubmission.findUnique({
        where: {
          formId_schoolEmail: {
            formId: form.id,
            schoolEmail: normalizedSchoolEmail
          }
        },
        select: { id: true }
      });

      const submission = await prisma.programBioSubmission.upsert({
        where: {
          formId_schoolEmail: {
            formId: form.id,
            schoolEmail: normalizedSchoolEmail
          }
        },
        update: {
          fullName: parsed.data.fullName,
          schoolEmail: normalizedSchoolEmail,
          gradeLevel: parsed.data.gradeLevel,
          roleInShow: parsed.data.roleInShow,
          bio: parsed.data.bio,
          extraResponses: normalizedCustomResponses,
          headshotUrl: uploaded.url,
          headshotKey: uploaded.key,
          submittedAt: new Date()
        },
        create: {
          formId: form.id,
          fullName: parsed.data.fullName,
          schoolEmail: normalizedSchoolEmail,
          gradeLevel: parsed.data.gradeLevel,
          roleInShow: parsed.data.roleInShow,
          bio: parsed.data.bio,
          extraResponses: normalizedCustomResponses,
          headshotUrl: uploaded.url,
          headshotKey: uploaded.key
        },
        select: {
          id: true,
          submittedAt: true,
          updatedAt: true
        }
      });

      reply.status(existing ? 200 : 201).send({
        submissionId: submission.id,
        updatedExisting: Boolean(existing),
        submittedAt: submission.submittedAt,
        updatedAt: submission.updatedAt
      });
    } catch (err) {
      handleRouteError(reply, err, 'Failed to submit form response');
    }
  });
};
