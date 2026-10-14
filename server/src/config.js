import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '..', '.env');

if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const defaultDbUrl = `file:${path.join(__dirname, '..', 'data', 'attendance.sqlite')}`;

export const config = {
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET || 'dev-insecure-secret',
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  // Timezone used to interpret event dates/times (event schedules are local).
  // The server (e.g. Vercel) runs in UTC, so this is required for correct
  // early/on-time/late classification and time-out windows.
  timezone: process.env.APP_TIMEZONE || 'Asia/Manila',
  // Hosted SQLite (libSQL/Turso) in production; a local file for development.
  dbUrl: process.env.TURSO_DATABASE_URL || process.env.DB_URL || defaultDbUrl,
  dbAuthToken: process.env.TURSO_AUTH_TOKEN || process.env.DB_AUTH_TOKEN || undefined,
};
