/*
Handoff note for Mr. Smith:
- File: `backend/src/routes/admin-drive.ts`
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
import { env } from '../lib/env.js';
import { HttpError } from '../lib/http-error.js';
import { prisma } from '../lib/prisma.js';
import { handleRouteError } from '../lib/route-error.js';
import { deleteUploadedObjectByKey, isR2Configured, uploadFileFromDataUrl } from '../lib/r2.js';
import { logAudit } from '../lib/audit-log.js';

const listQuerySchema = z.object({
  folderId: z.string().trim().min(1).optional()
});

const createFolderSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[^\\/]+$/, 'Folder name cannot include slashes'),
  parentId: z.union([z.string().trim().min(1), z.null()]).optional()
});

const updateFolderSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[^\\/]+$/, 'Folder name cannot include slashes')
});

const uploadFileSchema = z.object({
  folderId: z.union([z.string().trim().min(1), z.null()]).optional(),
  filename: z.string().trim().min(1).max(255),
  dataUrl: z.string().trim().min(1).max(72_000_000)
});

const updateFileSchema = z
  .object({
    folderId: z.union([z.string().trim().min(1), z.null()]).optional(),
    displayName: z.string().trim().min(1).max(255).optional()
  })
  .refine((value) => value.folderId !== undefined || value.displayName !== undefined, {
    message: 'Provide folderId and/or displayName'
  });

function isUniqueConstraintError(err: unknown): err is Prisma.PrismaClientKnownRequestError {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

async function ensureFolderExists(folderId: string): Promise<{ id: string; name: string; parentId: string | null }> {
  const folder = await prisma.driveFolder.findUnique({
    where: { id: folderId },
    select: { id: true, name: true, parentId: true }
  });

  if (!folder) {
    throw new HttpError(404, 'Folder not found');
  }

  return folder;
}

async function ensureFolderNameAvailable(params: { parentId: string | null; name: string; excludeFolderId?: string }): Promise<void> {
  const existing = await prisma.driveFolder.findFirst({
    where: {
      parentId: params.parentId,
      name: {
        equals: params.name,
        mode: 'insensitive'
      },
      ...(params.excludeFolderId
        ? {
            id: {
              not: params.excludeFolderId
            }
          }
        : {})
    },
    select: {
      id: true
    }
  });

  if (existing) {
    throw new HttpError(409, 'A folder with this name already exists here.');
  }
}

function buildBreadcrumbs(params: {
  folderId: string | null;
  foldersById: Map<string, { id: string; name: string; parentId: string | null }>;
}): Array<{ id: string | null; name: string }> {
  const trail: Array<{ id: string | null; name: string }> = [{ id: null, name: 'Drive' }];
  if (!params.folderId) {
    return trail;
  }

  const stack: Array<{ id: string; name: string; parentId: string | null }> = [];
  const visited = new Set<string>();
  let currentId: string | null = params.folderId;

  while (currentId) {
    if (visited.has(currentId)) {
      break;
    }
    visited.add(currentId);

    const current = params.foldersById.get(currentId);
    if (!current) {
      break;
    }

    stack.push(current);
    currentId = current.parentId;
  }

  stack.reverse().forEach((folder) => {
    trail.push({ id: folder.id, name: folder.name });
  });

  return trail;
}

export const adminDriveRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/admin/drive', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query || {});
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    const currentFolderId = parsed.data.folderId || null;

    try {
      if (currentFolderId) {
        await ensureFolderExists(currentFolderId);
      }

      const [allFolders, folders, files] = await Promise.all([
        prisma.driveFolder.findMany({
          orderBy: [{ name: 'asc' }],
          select: {
            id: true,
            name: true,
            parentId: true,
            createdAt: true,
            updatedAt: true,
            _count: {
              select: {
                children: true,
                files: true
              }
            }
          }
        }),
        prisma.driveFolder.findMany({
          where: {
            parentId: currentFolderId
          },
          orderBy: [{ name: 'asc' }],
          select: {
            id: true,
            name: true,
            parentId: true,
            createdAt: true,
            updatedAt: true,
            _count: {
              select: {
                children: true,
                files: true
              }
            }
          }
        }),
        prisma.driveFile.findMany({
          where: {
            folderId: currentFolderId
          },
          orderBy: [{ displayName: 'asc' }, { createdAt: 'desc' }],
          select: {
            id: true,
            folderId: true,
            displayName: true,
            objectKey: true,
            publicUrl: true,
            mimeType: true,
            sizeBytes: true,
            uploadedByAdminId: true,
            createdAt: true,
            updatedAt: true
          }
        })
      ]);

      const foldersById = new Map(allFolders.map((folder) => [folder.id, { id: folder.id, name: folder.name, parentId: folder.parentId }]));

      const currentFolder = currentFolderId
        ? allFolders.find((folder) => folder.id === currentFolderId) || null
        : null;

      reply.send({
        currentFolder,
        breadcrumbs: buildBreadcrumbs({
          folderId: currentFolderId,
          foldersById
        }),
        folders,
        files,
        tree: allFolders,
        upload: {
          enabled: isR2Configured(),
          maxBytes: env.R2_MAX_UPLOAD_BYTES
        }
      });
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to load drive');
    }
  });

  app.post('/api/admin/drive/folders', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const parsed = createFolderSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const parentId = parsed.data.parentId === undefined ? null : parsed.data.parentId;

      if (parentId) {
        await ensureFolderExists(parentId);
      }
      await ensureFolderNameAvailable({
        parentId,
        name: parsed.data.name
      });

      const folder = await prisma.driveFolder.create({
        data: {
          name: parsed.data.name,
          parentId,
          createdByAdminId: request.adminUser?.id || null
        }
      });

      await logAudit({
        actor: request.adminUser?.name || 'Admin',
        actorAdminId: request.adminUser?.id || null,
        action: 'DRIVE_FOLDER_CREATED',
        entityType: 'drive_folder',
        entityId: folder.id,
        metadata: {
          name: folder.name,
          parentId: folder.parentId
        }
      });

      reply.status(201).send({ folder });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        return reply.status(409).send({ error: 'A folder with this name already exists here.' });
      }
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to create folder');
    }
  });

  app.patch('/api/admin/drive/folders/:folderId', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const params = request.params as { folderId: string };
    const parsed = updateFolderSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const existing = await ensureFolderExists(params.folderId);
      await ensureFolderNameAvailable({
        parentId: existing.parentId,
        name: parsed.data.name,
        excludeFolderId: existing.id
      });

      const folder = await prisma.driveFolder.update({
        where: { id: params.folderId },
        data: {
          name: parsed.data.name
        }
      });

      await logAudit({
        actor: request.adminUser?.name || 'Admin',
        actorAdminId: request.adminUser?.id || null,
        action: 'DRIVE_FOLDER_RENAMED',
        entityType: 'drive_folder',
        entityId: folder.id,
        metadata: {
          from: existing.name,
          to: folder.name
        }
      });

      reply.send({ folder });
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        return reply.status(409).send({ error: 'A folder with this name already exists here.' });
      }
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to rename folder');
    }
  });

  app.delete('/api/admin/drive/folders/:folderId', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const params = request.params as { folderId: string };

    try {
      const folder = await ensureFolderExists(params.folderId);

      const [childFolderCount, childFileCount] = await Promise.all([
        prisma.driveFolder.count({ where: { parentId: folder.id } }),
        prisma.driveFile.count({ where: { folderId: folder.id } })
      ]);

      if (childFolderCount > 0 || childFileCount > 0) {
        return reply.status(400).send({
          error: 'Folder is not empty. Move or delete its files/subfolders first.'
        });
      }

      await prisma.driveFolder.delete({
        where: {
          id: folder.id
        }
      });

      await logAudit({
        actor: request.adminUser?.name || 'Admin',
        actorAdminId: request.adminUser?.id || null,
        action: 'DRIVE_FOLDER_DELETED',
        entityType: 'drive_folder',
        entityId: folder.id,
        metadata: {
          name: folder.name
        }
      });

      reply.status(204).send();
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to delete folder');
    }
  });

  app.post('/api/admin/drive/files/upload', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const parsed = uploadFileSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    if (!isR2Configured()) {
      return reply.status(503).send({ error: 'Drive uploads are unavailable because R2/CDN is not configured.' });
    }

    let uploaded: { key: string; url: string; size: number; mimeType: string } | null = null;

    try {
      const folderId = parsed.data.folderId === undefined ? null : parsed.data.folderId;
      if (folderId) {
        await ensureFolderExists(folderId);
      }

      uploaded = await uploadFileFromDataUrl({
        dataUrl: parsed.data.dataUrl,
        scope: 'drive',
        filename: parsed.data.filename
      });

      const file = await prisma.driveFile.create({
        data: {
          folderId,
          displayName: parsed.data.filename,
          objectKey: uploaded.key,
          publicUrl: uploaded.url,
          mimeType: uploaded.mimeType,
          sizeBytes: uploaded.size,
          uploadedByAdminId: request.adminUser?.id || null
        }
      });

      await logAudit({
        actor: request.adminUser?.name || 'Admin',
        actorAdminId: request.adminUser?.id || null,
        action: 'DRIVE_FILE_UPLOADED',
        entityType: 'drive_file',
        entityId: file.id,
        metadata: {
          folderId: file.folderId,
          displayName: file.displayName,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          objectKey: file.objectKey
        }
      });

      reply.status(201).send({ file });
    } catch (err) {
      if (uploaded?.key) {
        void deleteUploadedObjectByKey(uploaded.key).catch(() => {
          // Best effort cleanup for partially-failed uploads.
        });
      }
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to upload file');
    }
  });

  app.patch('/api/admin/drive/files/:fileId', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const params = request.params as { fileId: string };
    const parsed = updateFileSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() });
    }

    try {
      const existing = await prisma.driveFile.findUnique({
        where: {
          id: params.fileId
        },
        select: {
          id: true,
          folderId: true,
          displayName: true
        }
      });

      if (!existing) {
        return reply.status(404).send({ error: 'File not found' });
      }

      if (parsed.data.folderId !== undefined && parsed.data.folderId !== null) {
        await ensureFolderExists(parsed.data.folderId);
      }

      const file = await prisma.driveFile.update({
        where: {
          id: params.fileId
        },
        data: {
          folderId: parsed.data.folderId,
          displayName: parsed.data.displayName
        }
      });

      await logAudit({
        actor: request.adminUser?.name || 'Admin',
        actorAdminId: request.adminUser?.id || null,
        action: 'DRIVE_FILE_UPDATED',
        entityType: 'drive_file',
        entityId: file.id,
        metadata: {
          from: {
            folderId: existing.folderId,
            displayName: existing.displayName
          },
          to: {
            folderId: file.folderId,
            displayName: file.displayName
          }
        }
      });

      reply.send({ file });
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to update file');
    }
  });

  app.delete('/api/admin/drive/files/:fileId', { preHandler: app.requireAdminRole('ADMIN') }, async (request, reply) => {
    const params = request.params as { fileId: string };

    try {
      const file = await prisma.driveFile.findUnique({
        where: {
          id: params.fileId
        }
      });

      if (!file) {
        return reply.status(404).send({ error: 'File not found' });
      }

      await deleteUploadedObjectByKey(file.objectKey);

      await prisma.driveFile.delete({
        where: {
          id: file.id
        }
      });

      await logAudit({
        actor: request.adminUser?.name || 'Admin',
        actorAdminId: request.adminUser?.id || null,
        action: 'DRIVE_FILE_DELETED',
        entityType: 'drive_file',
        entityId: file.id,
        metadata: {
          displayName: file.displayName,
          objectKey: file.objectKey
        }
      });

      reply.status(204).send();
    } catch (err) {
      handleRouteError(reply, err, 'We hit a small backstage snag while trying to delete file');
    }
  });
};
