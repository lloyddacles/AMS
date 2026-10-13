import { db } from './db.js';
import { createUser } from './services/users.js';

const DEFAULT_ADMIN = { username: 'admin', password: 'admin123', name: 'Administrator' };

export function ensureAdmin() {
  if (db.prepare('SELECT COUNT(*) AS c FROM users').get().c > 0) return;
  createUser({ ...DEFAULT_ADMIN, role: 'admin' });
  console.log(`Seeded default admin -> username: ${DEFAULT_ADMIN.username}  password: ${DEFAULT_ADMIN.password}`);
}
