import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { get, all, run } from '../db.js';

export const DEFAULT_PASSWORD = 'admin123';

const PUBLIC_COLS =
  'id, username, name, role, avatar, active, must_change_password AS mustChangePassword, created_at AS createdAt';

export async function getUser(userId) {
  return get(`SELECT ${PUBLIC_COLS} FROM users WHERE id = ?`, [userId]);
}

export async function listUsers() {
  return all(`SELECT ${PUBLIC_COLS} FROM users ORDER BY role DESC, name COLLATE NOCASE`);
}

export async function createUser({ username, password, name, role = 'staff', mustChangePassword = 0 }) {
  const password_hash = bcrypt.hashSync(password, 10);
  const info = await run(
    'INSERT INTO users (username, password_hash, name, role, must_change_password) VALUES (?, ?, ?, ?, ?)',
    [username.trim(), password_hash, name.trim(), role, mustChangePassword ? 1 : 0]
  );
  return getUser(info.lastInsertRowid);
}

export async function verifyCredentials(username, password) {
  const user = await get('SELECT * FROM users WHERE username = ?', [(username || '').trim()]);
  if (!user) return null;
  if (Number(user.active) === 0) return null;
  if (!bcrypt.compareSync(password || '', user.password_hash)) return null;
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    avatar: user.avatar || null,
    mustChangePassword: Number(user.must_change_password) ? 1 : 0,
  };
}

export async function changePassword(userId, currentPassword, newPassword) {
  const user = await get('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user) return { ok: false, status: 404, error: 'User not found' };
  if (!bcrypt.compareSync(currentPassword || '', user.password_hash)) {
    return { ok: false, status: 400, error: 'Current password is incorrect' };
  }
  const password_hash = bcrypt.hashSync(newPassword, 10);
  await run('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', [password_hash, userId]);
  return { ok: true };
}

export async function updateProfile(userId, { name, avatar }) {
  const user = await get('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user) return { ok: false, status: 404, error: 'User not found' };
  const nextName = name === undefined ? user.name : String(name).trim();
  if (!nextName) return { ok: false, status: 400, error: 'Name is required' };
  const nextAvatar = avatar === undefined ? user.avatar : avatar;
  await run('UPDATE users SET name = ?, avatar = ? WHERE id = ?', [nextName, nextAvatar || null, userId]);
  return { ok: true, user: await getUser(userId) };
}

async function countActiveAdmins(excludeId) {
  const row = await get(
    `SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND active = 1 AND id != ?`,
    [excludeId ?? 0]
  );
  return row.c;
}

export async function updateUser(actorId, userId, { name, role, active }) {
  const user = await get('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user) return { ok: false, status: 404, error: 'User not found' };

  const nextRole = role === undefined ? user.role : role;
  const nextActive = active === undefined ? Number(user.active) : (active ? 1 : 0);
  const nextName = name === undefined ? user.name : String(name).trim();
  if (!nextName) return { ok: false, status: 400, error: 'Name is required' };
  if (!['admin', 'staff'].includes(nextRole)) {
    return { ok: false, status: 400, error: 'Invalid role' };
  }

  if (Number(user.id) === Number(actorId) && nextActive === 0) {
    return { ok: false, status: 400, error: 'You cannot deactivate your own account' };
  }

  // Never lock out the system: keep at least one active admin.
  const losingAdmin =
    user.role === 'admin' && (nextRole !== 'admin' || nextActive === 0);
  if (losingAdmin && (await countActiveAdmins(userId)) === 0) {
    return { ok: false, status: 400, error: 'At least one active admin is required' };
  }

  await run('UPDATE users SET name = ?, role = ?, active = ? WHERE id = ?', [
    nextName,
    nextRole,
    nextActive,
    userId,
  ]);
  return { ok: true, user: await getUser(userId) };
}

export async function resetUserPassword(userId, password) {
  const user = await get('SELECT id FROM users WHERE id = ?', [userId]);
  if (!user) return { ok: false, status: 404, error: 'User not found' };
  const password_hash = bcrypt.hashSync(password, 10);
  await run('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash, userId]);
  return { ok: true };
}

export async function deleteUser(actorId, userId) {
  const user = await get('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user) return { ok: false, status: 404, error: 'User not found' };
  if (Number(user.id) === Number(actorId)) {
    return { ok: false, status: 400, error: 'You cannot delete your own account' };
  }
  if (user.role === 'admin' && (await countActiveAdmins(userId)) === 0) {
    return { ok: false, status: 400, error: 'At least one active admin is required' };
  }
  await run('DELETE FROM users WHERE id = ?', [userId]);
  return { ok: true };
}

export function newToken() {
  return nanoid(12);
}

// Flag any account that is still using the built-in default password so it is
// forced to change it on next sign-in. Returns how many were flagged.
export async function flagUsersWithDefaultPassword(defaultPassword = DEFAULT_PASSWORD) {
  const users = await all('SELECT id, password_hash FROM users');
  let flagged = 0;
  for (const u of users) {
    if (bcrypt.compareSync(defaultPassword, u.password_hash)) {
      await run('UPDATE users SET must_change_password = 1 WHERE id = ? AND must_change_password = 0', [u.id]);
      flagged += 1;
    }
  }
  return flagged;
}
