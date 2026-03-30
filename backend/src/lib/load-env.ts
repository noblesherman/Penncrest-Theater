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
