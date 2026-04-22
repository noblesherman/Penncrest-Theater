/*
Handoff note for Mr. Smith:
- File: `backend/src/lib/r2.ts`
- What this is: Backend shared utility module.
- What it does: Provides reusable helpers for auth, crypto, storage, content, and data transforms.
- Connections: Imported by routes/services/jobs across the backend.
- Main content type: Shared behavior/utilities.
- Safe edits here: Additive helpers and local docs with stable exports.
- Be careful with: Changing helper semantics used by multiple domains.
- Useful context: Cross-feature bugs often trace back to a shared lib helper like this.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import { randomUUID } from 'node:crypto';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getR2Config } from './env.js';
import { extensionForMimeType, parseImageDataUrl } from './image-data-url.js';
import { HttpError } from './http-error.js';

type UploadImageFromDataUrlInput = {
  dataUrl: string;
  scope: string;
  filenameBase?: string;
};

type UploadPdfFromDataUrlInput = {
  dataUrl: string;
  scope: string;
  filenameBase?: string;
};

type UploadFileFromDataUrlInput = {
  dataUrl: string;
  scope: string;
  filename: string;
};

let cachedClient: S3Client | null = null;

function getClient(): S3Client {
  if (cachedClient) {
    return cachedClient;
  }

  const config = getR2Config();
  if (!config) {
    throw new HttpError(503, 'R2 is not configured on the backend');
  }

  cachedClient = new S3Client({
    endpoint: config.endpoint,
    region: 'auto',
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    }
  } as any);

  return cachedClient;
}

function sanitizeSegment(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'asset';
}

function sanitizeScopePath(scope: string): string {
  const parts = scope
    .split('/')
    .map((part) => sanitizeSegment(part))
    .filter(Boolean);

  return parts.length > 0 ? parts.join('/') : 'general';
}

function buildObjectKey(scope: string, mimeType: string, filenameBase?: string): string {
  const config = getR2Config();
  if (!config) {
    throw new HttpError(503, 'R2 is not configured on the backend');
  }

  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const safeScope = sanitizeSegment(scope);
  const safeBase = sanitizeSegment(filenameBase || 'image');
  const ext = extensionForMimeType(mimeType);
  const id = randomUUID();
  const key = `${config.uploadPrefix}/${safeScope}/${yyyy}/${mm}/${safeBase}-${id}.${ext}`;
  return key.replace(/\/{2,}/g, '/');
}

function buildPdfObjectKey(scope: string, filenameBase?: string): string {
  const config = getR2Config();
  if (!config) {
    throw new HttpError(503, 'R2 is not configured on the backend');
  }

  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const safeScope = sanitizeSegment(scope);
  const safeBase = sanitizeSegment(filenameBase || 'document');
  const id = randomUUID();
  const key = `${config.uploadPrefix}/${safeScope}/${yyyy}/${mm}/${safeBase}-${id}.pdf`;
  return key.replace(/\/{2,}/g, '/');
}

function parseBase64DataUrl(dataUrl: string): { mimeType: string; buffer: Buffer } | null {
  const trimmed = dataUrl.trim();
  const matched = /^data:([^;,]+)(?:;[^;,]+=[^;,]*)*;base64,([a-z0-9+/=]+)$/i.exec(trimmed);
  if (!matched) {
    return null;
  }

  try {
    return {
      mimeType: matched[1].toLowerCase(),
      buffer: Buffer.from(matched[2], 'base64')
    };
  } catch {
    return null;
  }
}

function extensionForMimeTypeGeneric(mimeType: string): string {
  const normalized = mimeType.toLowerCase();
  switch (normalized) {
    case 'application/pdf':
      return 'pdf';
    case 'text/plain':
      return 'txt';
    case 'text/csv':
      return 'csv';
    case 'application/json':
      return 'json';
    case 'application/zip':
      return 'zip';
    case 'application/msword':
      return 'doc';
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return 'docx';
    case 'application/vnd.ms-excel':
      return 'xls';
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      return 'xlsx';
    case 'application/vnd.ms-powerpoint':
      return 'ppt';
    case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
      return 'pptx';
    case 'audio/mpeg':
      return 'mp3';
    case 'audio/wav':
      return 'wav';
    case 'video/mp4':
      return 'mp4';
    case 'video/webm':
      return 'webm';
    default: {
      const subtype = normalized.split('/')[1] || 'bin';
      const cleanedSubtype = subtype.split('+')[0].replace(/[^a-z0-9]+/g, '');
      return cleanedSubtype || 'bin';
    }
  }
}

function splitFilename(input: string): { base: string; ext: string } {
  const trimmed = input.trim();
  const lastSegment = trimmed.split(/[\\/]/).pop() || 'file';
  const dotIndex = lastSegment.lastIndexOf('.');
  const hasExt = dotIndex > 0 && dotIndex < lastSegment.length - 1;

  const baseRaw = hasExt ? lastSegment.slice(0, dotIndex) : lastSegment;
  const extRaw = hasExt ? lastSegment.slice(dotIndex + 1) : '';

  const base = sanitizeSegment(baseRaw || 'file');
  const ext = sanitizeSegment(extRaw || '').replace(/\./g, '');

  return { base, ext };
}

function buildFileObjectKey(input: { scope: string; filename: string; mimeType: string }): string {
  const config = getR2Config();
  if (!config) {
    throw new HttpError(503, 'R2 is not configured on the backend');
  }

  const now = new Date();
  const yyyy = String(now.getUTCFullYear());
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const safeScope = sanitizeScopePath(input.scope);
  const split = splitFilename(input.filename);
  const ext = split.ext || extensionForMimeTypeGeneric(input.mimeType);
  const safeExt = sanitizeSegment(ext).replace(/\./g, '') || 'bin';
  const id = randomUUID();

  const key = `${config.uploadPrefix}/${safeScope}/${yyyy}/${mm}/${split.base}-${id}.${safeExt}`;
  return key.replace(/\/{2,}/g, '/');
}

export function isR2Configured(): boolean {
  return Boolean(getR2Config());
}

export async function uploadImageFromDataUrl(input: UploadImageFromDataUrlInput): Promise<{ key: string; url: string; size: number; mimeType: string }> {
  const config = getR2Config();
  if (!config) {
    throw new HttpError(503, 'R2 is not configured on the backend');
  }

  const parsed = parseImageDataUrl(input.dataUrl);
  if (!parsed) {
    throw new HttpError(400, 'Invalid image data URL');
  }

  if (parsed.buffer.byteLength === 0) {
    throw new HttpError(400, 'Image payload is empty');
  }

  if (parsed.buffer.byteLength > config.maxUploadBytes) {
    throw new HttpError(413, `Image exceeds max upload size (${config.maxUploadBytes} bytes)`);
  }

  const key = buildObjectKey(input.scope, parsed.mimeType, input.filenameBase);

  await getClient().send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: parsed.buffer,
      ContentType: parsed.mimeType,
      CacheControl: 'public, max-age=31536000, immutable'
    })
  );

  return {
    key,
    url: `${config.publicBaseUrl}/${key}`,
    size: parsed.buffer.byteLength,
    mimeType: parsed.mimeType
  };
}

export async function uploadPdfFromDataUrl(input: UploadPdfFromDataUrlInput): Promise<{ key: string; url: string; size: number; mimeType: string }> {
  const config = getR2Config();
  if (!config) {
    throw new HttpError(503, 'R2 is not configured on the backend');
  }

  const parsed = parseBase64DataUrl(input.dataUrl);
  if (!parsed || parsed.mimeType !== 'application/pdf') {
    throw new HttpError(400, 'Invalid PDF data URL');
  }

  if (parsed.buffer.byteLength === 0) {
    throw new HttpError(400, 'PDF payload is empty');
  }

  if (parsed.buffer.byteLength > config.maxUploadBytes) {
    throw new HttpError(413, `PDF exceeds max upload size (${config.maxUploadBytes} bytes)`);
  }

  const key = buildPdfObjectKey(input.scope, input.filenameBase);

  await getClient().send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: parsed.buffer,
      ContentType: 'application/pdf'
    })
  );

  return {
    key,
    url: `${config.publicBaseUrl}/${key}`,
    size: parsed.buffer.byteLength,
    mimeType: 'application/pdf'
  };
}

export async function uploadFileFromDataUrl(input: UploadFileFromDataUrlInput): Promise<{ key: string; url: string; size: number; mimeType: string }> {
  const config = getR2Config();
  if (!config) {
    throw new HttpError(503, 'R2 is not configured on the backend');
  }

  const parsed = parseBase64DataUrl(input.dataUrl);
  if (!parsed) {
    throw new HttpError(400, 'Invalid file data URL');
  }

  if (parsed.buffer.byteLength === 0) {
    throw new HttpError(400, 'File payload is empty');
  }

  if (parsed.buffer.byteLength > config.maxUploadBytes) {
    throw new HttpError(413, `File exceeds max upload size (${config.maxUploadBytes} bytes)`);
  }

  const key = buildFileObjectKey({
    scope: input.scope,
    filename: input.filename,
    mimeType: parsed.mimeType
  });

  await getClient().send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: parsed.buffer,
      ContentType: parsed.mimeType,
      CacheControl: 'public, max-age=31536000, immutable'
    })
  );

  return {
    key,
    url: `${config.publicBaseUrl}/${key}`,
    size: parsed.buffer.byteLength,
    mimeType: parsed.mimeType
  };
}

export async function deleteUploadedObjectByKey(key: string): Promise<void> {
  const config = getR2Config();
  if (!config) {
    throw new HttpError(503, 'R2 is not configured on the backend');
  }

  await getClient().send(
    new DeleteObjectCommand({
      Bucket: config.bucket,
      Key: key
    })
  );
}
