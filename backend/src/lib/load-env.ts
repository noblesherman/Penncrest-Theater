import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const currentFile = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFile);

// Always load backend/.env in local dev, regardless of process cwd.
dotenv.config({ path: path.resolve(currentDir, '../../.env') });
