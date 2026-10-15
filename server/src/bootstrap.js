import { get } from './db.js';
import { config } from './config.js';
import { createUser, flagUsersWithDefaultPassword } from './services/users.js';

const DEFAULT_ADMIN = { username: 'admin', password: 'admin123', name: 'Administrator' };

export async function ensureAdmin() {
  const row = await get('SELECT COUNT(*) AS c FROM users');
  if (row.c === 0) {
    await createUser({
      ...DEFAULT_ADMIN,
      role: 'admin',
      mustChangePassword: config.forceDefaultPasswordChange ? 1 : 0,
    });
    console.log(`Seeded default admin -> username: ${DEFAULT_ADMIN.username}  password: ${DEFAULT_ADMIN.password}`);
    return;
  }

  // Existing installs: force a change for any account still on the default
  // password (production only, unless overridden).
  if (config.forceDefaultPasswordChange) {
    const flagged = await flagUsersWithDefaultPassword();
    if (flagged) console.log(`Flagged ${flagged} account(s) still using the default password`);
  }
}
