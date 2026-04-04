import { randomUUID } from 'node:crypto';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
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
  });

  return cachedClient;
}

function sanitizeSegment(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'asset';
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
  const matched = /^data:([^;,]+);base64,([a-z0-9+/=]+)$/i.exec(trimmed);
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
