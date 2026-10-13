import { get } from './db.js';
import { createUser } from './services/users.js';

const DEFAULT_ADMIN = { username: 'admin', password: 'admin123', name: 'Administrator' };

export async function ensureAdmin() {
  const row = await get('SELECT COUNT(*) AS c FROM users');
  if (row.c > 0) return;
  await createUser({ ...DEFAULT_ADMIN, role: 'admin' });
  console.log(`Seeded default admin -> username: ${DEFAULT_ADMIN.username}  password: ${DEFAULT_ADMIN.password}`);
}
