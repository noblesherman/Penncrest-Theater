import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { env } from '../lib/env.js';

const execFileAsync = promisify(execFile);

const InstagramFeedItemSchema = z.object({
  id: z.string().min(1),
  shortcode: z.string().min(1),
  caption: z.string(),
  mediaType: z.enum(['IMAGE', 'VIDEO', 'CAROUSEL_ALBUM']),
  mediaUrl: z.string().url(),
  thumbnailUrl: z.string().url().nullable(),
  permalink: z.string().url(),
  timestamp: z.string().datetime()
});

const ScriptSuccessSchema = z.object({
  items: z.array(z.unknown())
});

const ScriptErrorSchema = z.object({
  error: z.object({
    message: z.string().min(1),
    type: z.string().optional()
  })
});

const PersistedSnapshotSchema = z.object({
  items: z.array(InstagramFeedItemSchema),
  fetchedAt: z.string().datetime()
});

export type InstagramFeedItem = z.infer<typeof InstagramFeedItemSchema>;
export type InstagramFeedSnapshot = z.infer<typeof PersistedSnapshotSchema>;
type InstagramFeedServiceErrorCode = 'config' | 'timeout' | 'script_failed' | 'invalid_response' | 'unknown';

export class InstagramFeedServiceError extends Error {
  readonly code: InstagramFeedServiceErrorCode;

  constructor(code: InstagramFeedServiceErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

function resolveScriptPath(): string {
  const configured = env.INSTAGRAM_SCRIPT_PATH?.trim();
  if (configured) {
    if (path.isAbsolute(configured)) {
      return configured;
    }
    return path.resolve(process.cwd(), configured);
  }

  const candidates = [path.resolve(process.cwd(), 'scripts/instagram_feed.py'), path.resolve(process.cwd(), 'backend/scripts/instagram_feed.py')];
  const existing = candidates.find((candidate) => existsSync(candidate));
  return existing ?? candidates[0];
}

function resolvePythonBin(): string {
  const configured = env.INSTAGRAM_PYTHON_BIN.trim();
  if (!configured) {
    return 'python3';
  }

  const looksLikePath = configured.includes('/') || configured.startsWith('.');
  if (!looksLikePath) {
    return configured;
  }

  if (path.isAbsolute(configured)) {
    return configured;
  }

  return path.resolve(process.cwd(), configured);
}

function resolveCacheFilePath(): string {
  const configured = env.INSTAGRAM_CACHE_FILE.trim();
  if (path.isAbsolute(configured)) {
    return configured;
  }
  return path.resolve(process.cwd(), configured);
}

function normalizeItems(rawItems: unknown[]): InstagramFeedItem[] {
  const items: InstagramFeedItem[] = [];
  for (const rawItem of rawItems) {
    const parsed = InstagramFeedItemSchema.safeParse(rawItem);
    if (!parsed.success) {
      continue;
    }
    items.push(parsed.data);
  }
  return items;
}

function parseScriptError(stderr: string): string {
  const trimmed = stderr.trim();
  if (!trimmed) {
    return '';
  }

  const parsedJson = ScriptErrorSchema.safeParse(parseJson(trimmed));
  if (parsedJson.success) {
    return parsedJson.data.error.message;
  }

  return trimmed;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export async function fetchInstagramFeedFromInstaloader(): Promise<InstagramFeedSnapshot> {
  const username = env.INSTAGRAM_USERNAME?.trim() ?? '';
  if (!username) {
    throw new InstagramFeedServiceError('config', 'INSTAGRAM_USERNAME is not configured.');
  }

  const scriptPath = resolveScriptPath();
  const pythonBin = resolvePythonBin();
  const args = ['--username', username, '--limit', String(env.INSTAGRAM_MEDIA_LIMIT)];
  const sessionUser = env.INSTAGRAM_SESSION_USERNAME?.trim();
  const sessionFile = env.INSTAGRAM_SESSION_FILE?.trim();

  if (sessionUser && sessionFile) {
    args.push('--session-user', sessionUser, '--session-file', path.isAbsolute(sessionFile) ? sessionFile : path.resolve(process.cwd(), sessionFile));
  }

  try {
    // Instaloader is unofficial and can break when Instagram changes internals.
    const { stdout, stderr } = await execFileAsync(pythonBin, [scriptPath, ...args], {
      timeout: env.INSTAGRAM_REQUEST_TIMEOUT_MS,
      maxBuffer: 1024 * 1024
    });

    const parsedResponse = ScriptSuccessSchema.safeParse(parseJson(stdout));
    if (!parsedResponse.success) {
      throw new InstagramFeedServiceError('invalid_response', 'Instaloader script returned invalid JSON.');
    }

    const items = normalizeItems(parsedResponse.data.items);
    return {
      items,
      fetchedAt: new Date().toISOString()
    };
  } catch (error) {
    if (error instanceof InstagramFeedServiceError) {
      throw error;
    }

    const err = error as {
      killed?: boolean;
      signal?: NodeJS.Signals;
      code?: string | number;
      stdout?: string;
      stderr?: string;
      message?: string;
    };

    if (err.killed && err.signal === 'SIGTERM') {
      throw new InstagramFeedServiceError('timeout', 'Instaloader request timed out.');
    }

    const message = parseScriptError(err.stderr ?? '');
    throw new InstagramFeedServiceError('script_failed', message || err.message || 'Instaloader request failed.');
  }
}

export async function readInstagramFeedFromDisk(): Promise<InstagramFeedSnapshot | null> {
  try {
    const cacheFilePath = resolveCacheFilePath();
    const data = await readFile(cacheFilePath, 'utf8');
    const parsed = PersistedSnapshotSchema.safeParse(parseJson(data));
    if (!parsed.success) {
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

export async function writeInstagramFeedToDisk(snapshot: InstagramFeedSnapshot): Promise<void> {
  const cacheFilePath = resolveCacheFilePath();
  await mkdir(path.dirname(cacheFilePath), { recursive: true });
  await writeFile(cacheFilePath, JSON.stringify(snapshot), 'utf8');
}
