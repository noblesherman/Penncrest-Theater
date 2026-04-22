/*
Handoff note for Mr. Smith:
- File: `backend/src/lib/load-env.ts`
- What this is: Backend shared utility module.
- What it does: Provides reusable helpers for auth, crypto, storage, content, and data transforms.
- Connections: Imported by routes/services/jobs across the backend.
- Main content type: Shared behavior/utilities.
- Safe edits here: Additive helpers and local docs with stable exports.
- Be careful with: Changing helper semantics used by multiple domains.
- Useful context: Cross-feature bugs often trace back to a shared lib helper like this.
- Practical note: For simple copy/layout edits, this file is usually safe as long as you keep data contracts intact.
*/

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import dotenv from 'dotenv';

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);

const candidateEnvPaths = [
  path.resolve(currentDir, '../../.env'),
  path.resolve(currentDir, '../../../.env'),
  path.resolve(process.cwd(), '.env')
];

const envPath = candidateEnvPaths.find((candidate) => existsSync(candidate));
dotenv.config(envPath ? { path: envPath } : undefined);
