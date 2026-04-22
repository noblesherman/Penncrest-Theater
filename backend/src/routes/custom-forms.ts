/*
Handoff note for Mr. Smith:
- File: `backend/src/routes/custom-forms.ts`
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
import { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/http-error.js';
import { handleRouteError } from '../lib/route-error.js';
import { logAudit } from '../lib/audit-log.js';

const CUSTOM_FORM_SCHEMA_VERSION = 'CUSTOM_FORM_V1';

const customFormFieldTypeSchema = z.enum([
  'short_text',
  'long_text',
  'email',
  'phone',
  'number',
  'date',
  'dropdown',
  'checkbox'
]);

const customFormStatusSchema = z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']);

type CustomFormFieldType = z.infer<typeof customFormFieldTypeSchema>;
type CustomFormStatus = z.infer<typeof customFormStatusSchema>;

type CustomFormField = {
  id: string;
  label: string;
  type: CustomFormFieldType;
  required: boolean;
  hidden: boolean;
  placeholder?: string;
  helpText?: string;
  options: string[];
};

type CustomFormDefinition = {
  schemaVersion: string;
  introText?: string;
  successMessage?: string;
  submitButtonLabel?: string;
  fields: CustomFormField[];
};

const createCustomFormSchema = z.object({
  formName: z.string().trim().min(1).max(180),
  internalDescription: z.string().trim().max(2_000).optional(),
  definition: z.unknown().optional()
});

const updateCustomFormParamsSchema = z.object({
  id: z.string().trim().min(1)
});

const updateCustomFormSchema = z
  .object({
    formName: z.string().trim().min(1).max(180).optional(),
    internalDescription: z.union([z.string().trim().max(2_000), z.null()]).optional(),
    status: customFormStatusSchema.optional(),
    definition: z.unknown().optional()
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Provide at least one field to update'
  });

const customFormSubmissionParamsSchema = z.object({
  id: z.string().trim().min(1),
  submissionId: z.string().trim().min(1)
});

const publicFormParamsSchema = z.object({
  slug: z.string().trim().min(1)
});

const publicFormSubmissionSchema = z.object({
  responses: z.record(z.unknown()).default({})
});

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function adminActor(request: { user?: { username?: string }; adminUser?: { username?: string } }): string {
  return request.user?.username || request.adminUser?.username || 'admin';
}

function toJsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
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

function buildBaseSlug(formName: string): string {
  const nameSlug = toSlugPart(formName) || 'form';
  return `custom-${nameSlug}`;
}

async function generateUniquePublicSlug(tx: Prisma.TransactionClient, formName: string): Promise<string> {
  const base = buildBaseSlug(formName);
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const suffix = attempt === 0 ? '' : `-${randomUUID().slice(0, 6)}`;
    const candidate = `${base}${suffix}`;
    const existing = await tx.customForm.findUnique({
      where: { publicSlug: candidate },
      select: { id: true }
    });
    if (!existing) {
      return candidate;
    }
  }
  throw new HttpError(500, 'We could not generate a unique custom form link');
}

function normalizeOptions(options: unknown): string[] {
  if (!Array.isArray(options)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const option of options) {
    const value = String(option || '').trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}

function normalizeField(raw: unknown): CustomFormField | null {
  const field = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};

  const id = String(field.id || '').trim();
  const label = String(field.label || '').trim();
  const typeRaw = String(field.type || '').trim().toLowerCase();
  const type: CustomFormFieldType = customFormFieldTypeSchema.options.includes(typeRaw as CustomFormFieldType)
    ? (typeRaw as CustomFormFieldType)
    : 'short_text';

  if (!id || !label) return null;

  const options = type === 'dropdown' ? normalizeOptions(field.options) : [];
  if (type === 'dropdown' && options.length < 1) return null;

  const normalized: CustomFormField = {
    id,
    label,
    type,
    required: Boolean(field.required),
    hidden: Boolean(field.hidden),
    placeholder: String(field.placeholder || '').trim() || undefined,
    helpText: String(field.helpText || '').trim() || undefined,
    options
  };

  return normalized;
}

function buildDefaultDefinition(): CustomFormDefinition {
  return {
    schemaVersion: CUSTOM_FORM_SCHEMA_VERSION,
    introText: '',
    successMessage: 'Thanks! Your response has been submitted.',
    submitButtonLabel: 'Submit',
    fields: [
      {
        id: 'name',
        label: 'Name',
        type: 'short_text',
        required: true,
        hidden: false,
        placeholder: '',
        helpText: '',
        options: []
      },
      {
        id: 'email',
        label: 'Email',
        type: 'email',
        required: true,
        hidden: false,
        placeholder: '',
        helpText: '',
        options: []
      }
    ]
  };
}

function normalizeDefinition(value: unknown): CustomFormDefinition {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

  const seenFieldIds = new Set<string>();
  const rawFields = Array.isArray(raw.fields) ? raw.fields : [];
  const fields: CustomFormField[] = [];

  for (const fieldRaw of rawFields) {
    const normalizedField = normalizeField(fieldRaw);
    if (!normalizedField) continue;
    if (seenFieldIds.has(normalizedField.id)) continue;
    seenFieldIds.add(normalizedField.id);
    fields.push(normalizedField);
  }

  const fallback = buildDefaultDefinition();

  return {
    schemaVersion:
      typeof raw.schemaVersion === 'string' && raw.schemaVersion.trim()
        ? raw.schemaVersion.trim()
        : CUSTOM_FORM_SCHEMA_VERSION,
    introText: String(raw.introText || '').trim() || undefined,
    successMessage: String(raw.successMessage || '').trim() || fallback.successMessage,
    submitButtonLabel: String(raw.submitButtonLabel || '').trim() || fallback.submitButtonLabel,
    fields: fields.length > 0 ? fields : fallback.fields
  };
}

function validateDefinition(definition: CustomFormDefinition): void {
  if (definition.fields.length === 0) {
    throw new HttpError(400, 'Add at least one field.');
  }

  for (let index = 0; index < definition.fields.length; index += 1) {
    const field = definition.fields[index];
    const number = index + 1;

    if (!field.id) {
      throw new HttpError(400, `Field ${number} is missing an id.`);
    }
    if (!field.label) {
      throw new HttpError(400, `Field ${number} is missing a label.`);
    }
    if (field.type === 'dropdown' && field.options.length < 1) {
      throw new HttpError(400, `Field ${number} requires at least one option.`);
    }
  }
}

function serializeAdminForm(form: {
  id: string;
  publicSlug: string;
  formName: string;
  internalDescription: string | null;
  status: string;
  schemaVersion: string;
  definitionJson: Prisma.JsonValue;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  _count?: { submissions: number };
}) {
  return {
    id: form.id,
    publicSlug: form.publicSlug,
    sharePath: `/forms/custom/${form.publicSlug}`,
    formName: form.formName,
    internalDescription: form.internalDescription,
    status: form.status,
    schemaVersion: form.schemaVersion,
    definition: normalizeDefinition(form.definitionJson as unknown),
    archivedAt: form.archivedAt?.toISOString() || null,
    responseCount: form._count?.submissions ?? 0,
    createdAt: form.createdAt.toISOString(),
    updatedAt: form.updatedAt.toISOString()
  };
}

function validateSubmissionAndNormalize(params: {
  definition: CustomFormDefinition;
  responses: Record<string, unknown>;
}): {
  normalizedResponses: Record<string, string | number | boolean>;
  submitterName: string | null;
  submitterEmail: string | null;
} {
  const normalizedResponses: Record<string, string | number | boolean> = {};

  for (const field of params.definition.fields) {
    if (field.hidden) continue;

    const rawValue = params.responses[field.id];
    const isMissing = rawValue === undefined || rawValue === null || rawValue === '';

    if (field.required && isMissing) {
      throw new HttpError(400, `${field.label} is required.`);
    }

    if (isMissing) continue;

    if (field.type === 'checkbox') {
      const boolValue =
        typeof rawValue === 'boolean'
          ? rawValue
          : typeof rawValue === 'string'
            ? rawValue.trim().toLowerCase() === 'true'
            : Boolean(rawValue);
      if (field.required && !boolValue) {
        throw new HttpError(400, `${field.label} is required.`);
      }
      normalizedResponses[field.id] = boolValue;
      continue;
    }

    if (field.type === 'number') {
      const parsed = typeof rawValue === 'number' ? rawValue : Number(String(rawValue));
      if (!Number.isFinite(parsed)) {
        throw new HttpError(400, `${field.label} must be a valid number.`);
      }
      normalizedResponses[field.id] = parsed;
      continue;
    }

    const text = String(rawValue).trim();
    if (field.required && !text) {
      throw new HttpError(400, `${field.label} is required.`);
    }
    if (!text) continue;

    if (field.type === 'email' && !emailRegex.test(text)) {
      throw new HttpError(400, `${field.label} must be a valid email.`);
    }

    if (field.type === 'dropdown' && !field.options.includes(text)) {
      throw new HttpError(400, `${field.label} has an invalid selection.`);
    }

    if (field.type === 'date' && Number.isNaN(new Date(text).getTime())) {
      throw new HttpError(400, `${field.label} must be a valid date.`);
    }

    normalizedResponses[field.id] = text;
  }

  let submitterEmail: string | null = null;
  let submitterName: string | null = null;

  for (const field of params.definition.fields) {
    if (!submitterEmail && field.type === 'email') {
      const value = normalizedResponses[field.id];
      if (typeof value === 'string' && emailRegex.test(value)) {
        submitterEmail = value.toLowerCase();
      }
    }

    if (!submitterName && (field.type === 'short_text' || field.type === 'long_text')) {
      const value = normalizedResponses[field.id];
      const looksLikeName = /name/i.test(field.id) || /name/i.test(field.label);
      if (looksLikeName && typeof value === 'string' && value.trim()) {
        submitterName = value.trim();
      }
    }
  }

  return {
    normalizedResponses,
    submitterName,
    submitterEmail
  };
}

export const customFormRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/admin/custom-forms', { preHandler: app.requireAdminRole('ADMIN') }, async (_request, reply) => {
    try {
      const forms = await prisma.customForm.findMany({
        orderBy: [{ createdAt: 'desc' }],
        include: {
          _count: {
            select: {
              submissions: true
            }
          }
        }
      });

      reply.send(forms.map((form) => serializeAdminForm(form)));
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to fetch custom forms');
    }
  });

  app.post('/api/admin/custom-forms', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const parsed = createCustomFormSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const definition = normalizeDefinition(parsed.data.definition || buildDefaultDefinition());
      validateDefinition(definition);

      const created = await prisma.$transaction(async (tx) => {
        const publicSlug = await generateUniquePublicSlug(tx, parsed.data.formName);
        return tx.customForm.create({
          data: {
            publicSlug,
            formName: parsed.data.formName,
            internalDescription: parsed.data.internalDescription || null,
            status: 'DRAFT',
            schemaVersion: CUSTOM_FORM_SCHEMA_VERSION,
            definitionJson: toJsonInput(definition),
            createdByAdminId: request.adminUser?.id || null,
            updatedByAdminId: request.adminUser?.id || null
          },
          include: {
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
        action: 'CUSTOM_FORM_CREATED',
        entityType: 'CustomForm',
        entityId: created.id,
        metadata: {
          publicSlug: created.publicSlug,
          formName: created.formName,
          status: created.status
        }
      });

      reply.status(201).send(serializeAdminForm(created));
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to create custom form');
    }
  });

  app.patch('/api/admin/custom-forms/:id', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const parsedParams = updateCustomFormParamsSchema.safeParse(request.params || {});
    if (!parsedParams.success) {
      return reply.status(400).send({ error: parsedParams.error.flatten() });
    }

    const parsedBody = updateCustomFormSchema.safeParse(request.body || {});
    if (!parsedBody.success) {
      return reply.status(400).send({ error: parsedBody.error.flatten() });
    }

    try {
      const existing = await prisma.customForm.findUnique({
        where: { id: parsedParams.data.id },
        select: {
          id: true,
          status: true,
          definitionJson: true
        }
      });
      if (!existing) {
        throw new HttpError(404, 'Custom form not found');
      }

      const definition = parsedBody.data.definition !== undefined
        ? normalizeDefinition(parsedBody.data.definition)
        : normalizeDefinition(existing.definitionJson as unknown);
      if (parsedBody.data.definition !== undefined) {
        validateDefinition(definition);
      }

      const nextStatus = parsedBody.data.status || (existing.status as CustomFormStatus);
      const archivedAt = nextStatus === 'ARCHIVED' ? new Date() : null;
      const nextInternalDescription =
        parsedBody.data.internalDescription === undefined
          ? undefined
          : parsedBody.data.internalDescription === null
            ? null
            : parsedBody.data.internalDescription.trim() || null;

      const updated = await prisma.customForm.update({
        where: { id: existing.id },
        data: {
          formName: parsedBody.data.formName,
          internalDescription: nextInternalDescription,
          status: nextStatus,
          archivedAt,
          definitionJson: parsedBody.data.definition !== undefined ? toJsonInput(definition) : undefined,
          updatedByAdminId: request.adminUser?.id || null
        },
        include: {
          _count: {
            select: {
              submissions: true
            }
          }
        }
      });

      await logAudit({
        actor: adminActor(request),
        actorAdminId: request.adminUser?.id || null,
        action: 'CUSTOM_FORM_UPDATED',
        entityType: 'CustomForm',
        entityId: updated.id,
        metadata: {
          status: updated.status,
          patchedFields: Object.keys(parsedBody.data)
        }
      });

      reply.send(serializeAdminForm(updated));
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to update custom form');
    }
  });

  app.delete('/api/admin/custom-forms/:id', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const parsedParams = updateCustomFormParamsSchema.safeParse(request.params || {});
    if (!parsedParams.success) {
      return reply.status(400).send({ error: parsedParams.error.flatten() });
    }

    try {
      const existing = await prisma.customForm.findUnique({
        where: { id: parsedParams.data.id },
        include: {
          _count: {
            select: {
              submissions: true
            }
          }
        }
      });
      if (!existing) {
        throw new HttpError(404, 'Custom form not found');
      }

      await prisma.customForm.delete({ where: { id: existing.id } });

      await logAudit({
        actor: adminActor(request),
        actorAdminId: request.adminUser?.id || null,
        action: 'CUSTOM_FORM_DELETED',
        entityType: 'CustomForm',
        entityId: existing.id,
        metadata: {
          formName: existing.formName,
          submissionCount: existing._count.submissions
        }
      });

      reply.send({
        deleted: true,
        formId: existing.id,
        submissionCount: existing._count.submissions
      });
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to delete custom form');
    }
  });

  app.get('/api/admin/custom-forms/:id/submissions', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const parsedParams = updateCustomFormParamsSchema.safeParse(request.params || {});
    if (!parsedParams.success) {
      return reply.status(400).send({ error: parsedParams.error.flatten() });
    }

    try {
      const form = await prisma.customForm.findUnique({
        where: { id: parsedParams.data.id },
        select: { id: true }
      });
      if (!form) {
        throw new HttpError(404, 'Custom form not found');
      }

      const submissions = await prisma.customFormSubmission.findMany({
        where: { formId: form.id },
        orderBy: [{ submittedAt: 'desc' }, { createdAt: 'desc' }]
      });

      reply.send(
        submissions.map((submission) => ({
          id: submission.id,
          formId: submission.formId,
          responseJson: submission.responseJson,
          submitterName: submission.submitterName,
          submitterEmail: submission.submitterEmail,
          submittedAt: submission.submittedAt,
          createdAt: submission.createdAt,
          updatedAt: submission.updatedAt
        }))
      );
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to load custom form submissions');
    }
  });

  app.delete('/api/admin/custom-forms/:id/submissions/:submissionId', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const parsedParams = customFormSubmissionParamsSchema.safeParse(request.params || {});
    if (!parsedParams.success) {
      return reply.status(400).send({ error: parsedParams.error.flatten() });
    }

    try {
      const form = await prisma.customForm.findUnique({
        where: { id: parsedParams.data.id },
        select: {
          id: true,
          formName: true
        }
      });
      if (!form) {
        throw new HttpError(404, 'Custom form not found');
      }

      const submission = await prisma.customFormSubmission.findFirst({
        where: {
          id: parsedParams.data.submissionId,
          formId: form.id
        },
        select: {
          id: true,
          submitterName: true,
          submitterEmail: true
        }
      });
      if (!submission) {
        throw new HttpError(404, 'Submission not found');
      }

      await prisma.customFormSubmission.delete({
        where: { id: submission.id }
      });

      await logAudit({
        actor: adminActor(request),
        actorAdminId: request.adminUser?.id || null,
        action: 'CUSTOM_FORM_SUBMISSION_DELETED',
        entityType: 'CustomFormSubmission',
        entityId: submission.id,
        metadata: {
          formId: form.id,
          formName: form.formName,
          submitterName: submission.submitterName,
          submitterEmail: submission.submitterEmail
        }
      });

      reply.send({
        deleted: true,
        formId: form.id,
        submissionId: submission.id
      });
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to delete custom form submission');
    }
  });

  app.get('/api/forms/custom/:slug', async (request, reply) => {
    const parsedParams = publicFormParamsSchema.safeParse(request.params || {});
    if (!parsedParams.success) {
      return reply.status(400).send({ error: parsedParams.error.flatten() });
    }

    try {
      const form = await prisma.customForm.findUnique({
        where: { publicSlug: parsedParams.data.slug }
      });
      if (!form || form.status !== 'PUBLISHED') {
        throw new HttpError(404, 'Form not found');
      }

      reply.send({
        id: form.id,
        publicSlug: form.publicSlug,
        formName: form.formName,
        internalDescription: form.internalDescription,
        schemaVersion: form.schemaVersion,
        definition: normalizeDefinition(form.definitionJson as unknown)
      });
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to load custom form');
    }
  });

  app.post('/api/forms/custom/:slug/submissions', async (request, reply) => {
    const parsedParams = publicFormParamsSchema.safeParse(request.params || {});
    if (!parsedParams.success) {
      return reply.status(400).send({ error: parsedParams.error.flatten() });
    }

    const parsedBody = publicFormSubmissionSchema.safeParse(request.body || {});
    if (!parsedBody.success) {
      return reply.status(400).send({ error: parsedBody.error.flatten() });
    }

    try {
      const form = await prisma.customForm.findUnique({
        where: { publicSlug: parsedParams.data.slug },
        select: {
          id: true,
          status: true,
          definitionJson: true
        }
      });
      if (!form || form.status !== 'PUBLISHED') {
        throw new HttpError(404, 'Form not found');
      }

      const definition = normalizeDefinition(form.definitionJson as unknown);
      const validated = validateSubmissionAndNormalize({
        definition,
        responses: parsedBody.data.responses || {}
      });

      const submission = await prisma.customFormSubmission.create({
        data: {
          formId: form.id,
          responseJson: toJsonInput(validated.normalizedResponses),
          submitterName: validated.submitterName,
          submitterEmail: validated.submitterEmail
        },
        select: {
          id: true,
          submittedAt: true
        }
      });

      reply.status(201).send({
        submissionId: submission.id,
        submittedAt: submission.submittedAt.toISOString()
      });
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to submit custom form');
    }
  });
};
