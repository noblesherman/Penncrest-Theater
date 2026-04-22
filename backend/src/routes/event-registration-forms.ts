/*
Handoff note for Mr. Smith:
- File: `backend/src/routes/event-registration-forms.ts`
- What this is: Fastify route module.
- What it does: Defines HTTP endpoints and route-level request handling for one domain area.
- Connections: Registered by backend server bootstrap; calls services/lib helpers and Prisma.
- Main content type: HTTP logic + auth guards + response shaping.
- Safe edits here: Response wording and non-breaking diagnostics.
- Be careful with: Auth hooks, schema contracts, and transactional behavior.
- Useful context: If frontend/mobile API calls fail after changes, contract drift often starts here.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { FastifyPluginAsync } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { HttpError } from '../lib/http-error.js';
import { handleRouteError } from '../lib/route-error.js';
import { logAudit } from '../lib/audit-log.js';
import {
  assertEventRegistrationDraftPayload,
  buildDefaultEventRegistrationDraft,
  normalizeEventRegistrationDefinition,
  normalizeEventRegistrationSettings,
  serializeEventRegistrationPublicForm
} from '../lib/event-registration-form.js';

const paramsSchema = z.object({
  performanceId: z.string().trim().min(1)
});

const saveDraftSchema = z.object({
  formName: z.string().trim().min(1).max(180),
  internalDescription: z.string().trim().max(2_000).optional(),
  settings: z.unknown(),
  definition: z.unknown()
});

const duplicateFromSchema = z.object({
  sourcePerformanceId: z.string().trim().min(1)
});

function adminActor(request: { user?: { username?: string } }): string {
  return request.user?.username || 'admin';
}

function assertFundraiserPerformance(performance: { isFundraiser: boolean }, action: string): void {
  if (!performance.isFundraiser) {
    throw new HttpError(400, `Registration forms are only available for fundraising events (${action}).`);
  }
}

function toJsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function serializeAdminForm(form: {
  id: string;
  performanceId: string;
  formName: string;
  internalDescription: string | null;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  settingsJson: unknown;
  draftDefinitionJson: unknown;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  publishedVersion: {
    id: string;
    versionNumber: number;
    publishedAt: Date;
    formName: string;
    settingsJson: unknown;
    definitionJson: unknown;
  } | null;
}) {
  return {
    id: form.id,
    performanceId: form.performanceId,
    formName: form.formName,
    internalDescription: form.internalDescription,
    status: form.status,
    settings: normalizeEventRegistrationSettings(form.settingsJson as any),
    definition: normalizeEventRegistrationDefinition(form.draftDefinitionJson as any),
    createdAt: form.createdAt.toISOString(),
    updatedAt: form.updatedAt.toISOString(),
    archivedAt: form.archivedAt?.toISOString() || null,
    publishedVersion: form.publishedVersion
      ? {
          id: form.publishedVersion.id,
          versionNumber: form.publishedVersion.versionNumber,
          formName: form.publishedVersion.formName,
          settings: normalizeEventRegistrationSettings(form.publishedVersion.settingsJson as any),
          definition: normalizeEventRegistrationDefinition(form.publishedVersion.definitionJson as any),
          publishedAt: form.publishedVersion.publishedAt.toISOString()
        }
      : null
  };
}

export const eventRegistrationFormRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/admin/performances/:performanceId/registration-form', { preHandler: app.authenticateAdmin }, async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const performance = await prisma.performance.findUnique({
        where: { id: parsed.data.performanceId },
        select: {
          id: true,
          isFundraiser: true,
          title: true,
          show: { select: { title: true } },
          registrationForm: {
            include: {
              publishedVersion: {
                select: {
                  id: true,
                  versionNumber: true,
                  formName: true,
                  settingsJson: true,
                  definitionJson: true,
                  publishedAt: true
                }
              }
            }
          }
        }
      });

      if (!performance) {
        throw new HttpError(404, 'Performance not found');
      }
      assertFundraiserPerformance(performance, 'view');

      const defaultDraft = buildDefaultEventRegistrationDraft();
      const defaults = {
        ...defaultDraft,
        settings: {
          ...defaultDraft.settings,
          enabled: performance.isFundraiser
        }
      };

      reply.send({
        performance: {
          id: performance.id,
          title: performance.title || performance.show.title,
          isFundraiser: performance.isFundraiser
        },
        form: performance.registrationForm ? serializeAdminForm(performance.registrationForm as any) : null,
        defaults
      });
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to load registration form');
    }
  });

  app.put('/api/admin/performances/:performanceId/registration-form/draft', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const parsedParams = paramsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({ error: parsedParams.error.flatten() });
    }

    const parsedBody = saveDraftSchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.status(400).send({ error: parsedBody.error.flatten() });
    }

    try {
      const payload = assertEventRegistrationDraftPayload({
        formName: parsedBody.data.formName,
        internalDescription: parsedBody.data.internalDescription,
        settings: parsedBody.data.settings ?? {},
        definition: parsedBody.data.definition ?? {}
      });

      const result = await prisma.$transaction(async (tx) => {
        const performance = await tx.performance.findUnique({
          where: { id: parsedParams.data.performanceId },
          select: {
            id: true,
            isFundraiser: true,
            registrationForm: {
              select: {
                id: true,
                status: true,
                publishedVersionId: true
              }
            }
          }
        });

        if (!performance) {
          throw new HttpError(404, 'Performance not found');
        }
        assertFundraiserPerformance(performance, 'draft save');

        const nextStatus = performance.registrationForm?.status === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT';

        const form = await tx.eventRegistrationForm.upsert({
          where: { performanceId: performance.id },
          create: {
            performanceId: performance.id,
            formName: payload.formName,
            internalDescription: payload.internalDescription || null,
            status: nextStatus,
            settingsJson: toJsonInput(payload.settings),
            draftDefinitionJson: toJsonInput(payload.definition)
          },
          update: {
            formName: payload.formName,
            internalDescription: payload.internalDescription || null,
            status: nextStatus,
            settingsJson: toJsonInput(payload.settings),
            draftDefinitionJson: toJsonInput(payload.definition),
            archivedAt: null
          },
          include: {
            publishedVersion: {
              select: {
                id: true,
                versionNumber: true,
                formName: true,
                settingsJson: true,
                definitionJson: true,
                publishedAt: true
              }
            }
          }
        });

        return form;
      });

      await logAudit({
        actor: adminActor(request),
        action: 'EVENT_REGISTRATION_FORM_DRAFT_SAVED',
        entityType: 'EventRegistrationForm',
        entityId: result.id,
        metadata: {
          performanceId: parsedParams.data.performanceId,
          status: result.status
        }
      });

      reply.send(serializeAdminForm(result as any));
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to save registration form draft');
    }
  });

  app.post('/api/admin/performances/:performanceId/registration-form/publish', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const publishedForm = await prisma.$transaction(async (tx) => {
        const performance = await tx.performance.findUnique({
          where: { id: parsed.data.performanceId },
          select: { id: true, isFundraiser: true }
        });
        if (!performance) {
          throw new HttpError(404, 'Performance not found');
        }
        assertFundraiserPerformance(performance, 'publish');

        let form = await tx.eventRegistrationForm.findUnique({
          where: { performanceId: performance.id },
          include: {
            publishedVersion: {
              select: {
                id: true,
                versionNumber: true,
                formName: true,
                settingsJson: true,
                definitionJson: true,
                publishedAt: true
              }
            },
            versions: {
              select: { versionNumber: true },
              orderBy: { versionNumber: 'desc' },
              take: 1
            }
          }
        });

        if (!form) {
          const defaults = buildDefaultEventRegistrationDraft();
          form = await tx.eventRegistrationForm.create({
            data: {
              performanceId: performance.id,
              formName: defaults.formName,
              internalDescription: defaults.internalDescription,
              status: 'DRAFT',
              settingsJson: toJsonInput(defaults.settings),
              draftDefinitionJson: toJsonInput(defaults.definition)
            },
            include: {
              publishedVersion: {
                select: {
                  id: true,
                  versionNumber: true,
                  formName: true,
                  settingsJson: true,
                  definitionJson: true,
                  publishedAt: true
                }
              },
              versions: {
                select: { versionNumber: true },
                orderBy: { versionNumber: 'desc' },
                take: 1
              }
            }
          });
        }

        const nextVersionNumber = (form.versions[0]?.versionNumber || 0) + 1;
        const newVersion = await tx.eventRegistrationFormVersion.create({
          data: {
            formId: form.id,
            versionNumber: nextVersionNumber,
            formName: form.formName,
            settingsJson: toJsonInput(form.settingsJson),
            definitionJson: toJsonInput(form.draftDefinitionJson),
            createdByAdminId: request.user?.username || null
          },
          select: {
            id: true,
            versionNumber: true,
            formName: true,
            settingsJson: true,
            definitionJson: true,
            publishedAt: true
          }
        });

        const updated = await tx.eventRegistrationForm.update({
          where: { id: form.id },
          data: {
            status: 'PUBLISHED',
            archivedAt: null,
            publishedVersionId: newVersion.id
          },
          include: {
            publishedVersion: {
              select: {
                id: true,
                versionNumber: true,
                formName: true,
                settingsJson: true,
                definitionJson: true,
                publishedAt: true
              }
            }
          }
        });

        return updated;
      });

      await logAudit({
        actor: adminActor(request),
        action: 'EVENT_REGISTRATION_FORM_PUBLISHED',
        entityType: 'EventRegistrationForm',
        entityId: publishedForm.id,
        metadata: {
          performanceId: parsed.data.performanceId,
          versionId: publishedForm.publishedVersionId
        }
      });

      reply.send(serializeAdminForm(publishedForm as any));
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to publish registration form');
    }
  });

  app.post('/api/admin/performances/:performanceId/registration-form/archive', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const updated = await prisma.$transaction(async (tx) => {
        const performance = await tx.performance.findUnique({
          where: { id: parsed.data.performanceId },
          select: { id: true, isFundraiser: true }
        });
        if (!performance) {
          throw new HttpError(404, 'Performance not found');
        }
        assertFundraiserPerformance(performance, 'archive');

        const existing = await tx.eventRegistrationForm.findUnique({
          where: { performanceId: parsed.data.performanceId }
        });
        if (!existing) {
          throw new HttpError(404, 'Registration form not found');
        }

        const settings = normalizeEventRegistrationSettings(existing.settingsJson as any);

        return tx.eventRegistrationForm.update({
          where: { id: existing.id },
          data: {
            status: 'ARCHIVED',
            archivedAt: new Date(),
            settingsJson: toJsonInput({
              ...settings,
              enabled: false
            })
          },
          include: {
            publishedVersion: {
              select: {
                id: true,
                versionNumber: true,
                formName: true,
                settingsJson: true,
                definitionJson: true,
                publishedAt: true
              }
            }
          }
        });
      });

      await logAudit({
        actor: adminActor(request),
        action: 'EVENT_REGISTRATION_FORM_ARCHIVED',
        entityType: 'EventRegistrationForm',
        entityId: updated.id,
        metadata: {
          performanceId: parsed.data.performanceId
        }
      });

      reply.send(serializeAdminForm(updated as any));
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to archive registration form');
    }
  });

  app.post('/api/admin/performances/:performanceId/registration-form/duplicate-from', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const parsedParams = paramsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      return reply.status(400).send({ error: parsedParams.error.flatten() });
    }

    const parsedBody = duplicateFromSchema.safeParse(request.body);
    if (!parsedBody.success) {
      return reply.status(400).send({ error: parsedBody.error.flatten() });
    }

    if (parsedParams.data.performanceId === parsedBody.data.sourcePerformanceId) {
      return reply.status(400).send({ error: 'Choose a different source event.' });
    }

    try {
      const duplicated = await prisma.$transaction(async (tx) => {
        const targetPerformance = await tx.performance.findUnique({
          where: { id: parsedParams.data.performanceId },
          select: { id: true, isFundraiser: true }
        });
        if (!targetPerformance) {
          throw new HttpError(404, 'Performance not found');
        }
        assertFundraiserPerformance(targetPerformance, 'duplicate target');

        const sourcePerformance = await tx.performance.findUnique({
          where: { id: parsedBody.data.sourcePerformanceId },
          select: {
            id: true,
            isFundraiser: true,
            registrationForm: {
              include: {
                publishedVersion: true
              }
            }
          }
        });
        if (!sourcePerformance?.registrationForm) {
          throw new HttpError(404, 'Source event has no registration form to duplicate.');
        }
        assertFundraiserPerformance(sourcePerformance, 'duplicate source');

        const sourceForm = sourcePerformance.registrationForm;
        const sourceSettings = normalizeEventRegistrationSettings(sourceForm.settingsJson as any);
        const sourceDefinition = normalizeEventRegistrationDefinition(sourceForm.draftDefinitionJson as any);

        const form = await tx.eventRegistrationForm.upsert({
          where: { performanceId: parsedParams.data.performanceId },
          create: {
            performanceId: parsedParams.data.performanceId,
            formName: sourceForm.formName,
            internalDescription: sourceForm.internalDescription,
            status: 'DRAFT',
            settingsJson: toJsonInput(sourceSettings),
            draftDefinitionJson: toJsonInput(sourceDefinition),
            publishedVersionId: null
          },
          update: {
            formName: sourceForm.formName,
            internalDescription: sourceForm.internalDescription,
            status: 'DRAFT',
            settingsJson: toJsonInput(sourceSettings),
            draftDefinitionJson: toJsonInput(sourceDefinition),
            archivedAt: null,
            publishedVersionId: null
          },
          include: {
            publishedVersion: {
              select: {
                id: true,
                versionNumber: true,
                formName: true,
                settingsJson: true,
                definitionJson: true,
                publishedAt: true
              }
            }
          }
        });

        return form;
      });

      await logAudit({
        actor: adminActor(request),
        action: 'EVENT_REGISTRATION_FORM_DUPLICATED',
        entityType: 'EventRegistrationForm',
        entityId: duplicated.id,
        metadata: {
          performanceId: parsedParams.data.performanceId,
          sourcePerformanceId: parsedBody.data.sourcePerformanceId
        }
      });

      reply.send(serializeAdminForm(duplicated as any));
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to duplicate registration form');
    }
  });

  app.get('/api/performances/:performanceId/registration-form', async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const performance = await prisma.performance.findFirst({
        where: {
          id: parsed.data.performanceId,
          isArchived: false,
          isPublished: true,
          OR: [{ onlineSalesStartsAt: null }, { onlineSalesStartsAt: { lte: new Date() } }]
        },
        select: {
          id: true,
          isFundraiser: true,
          registrationForm: {
            include: {
              publishedVersion: {
                select: {
                  id: true,
                  versionNumber: true,
                  formName: true,
                  settingsJson: true,
                  definitionJson: true,
                  publishedAt: true
                }
              }
            }
          }
        }
      });

      if (!performance) {
        throw new HttpError(404, 'Performance not found');
      }

      const form = performance.registrationForm;
      if (!performance.isFundraiser || !form || form.status !== 'PUBLISHED' || !form.publishedVersion) {
        return reply.send({ enabled: false });
      }

      const settings = normalizeEventRegistrationSettings(form.publishedVersion.settingsJson as any);
      if (!settings.enabled) {
        return reply.send({ enabled: false });
      }

      const definition = normalizeEventRegistrationDefinition(form.publishedVersion.definitionJson as any);

      reply.send({
        enabled: true,
        ...serializeEventRegistrationPublicForm({
          formId: form.id,
          performanceId: performance.id,
          formName: form.publishedVersion.formName,
          settings,
          definition,
          versionId: form.publishedVersion.id,
          versionNumber: form.publishedVersion.versionNumber,
          publishedAt: form.publishedVersion.publishedAt
        })
      });
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to load registration form');
    }
  });
};
