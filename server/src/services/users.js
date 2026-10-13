import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { get, run } from '../db.js';

export async function createUser({ username, password, name, role = 'admin' }) {
  const password_hash = bcrypt.hashSync(password, 10);
  const info = await run(
    'INSERT INTO users (username, password_hash, name, role) VALUES (?, ?, ?, ?)',
    [username.trim(), password_hash, name.trim(), role]
  );
  return get('SELECT id, username, name, role FROM users WHERE id = ?', [info.lastInsertRowid]);
}

export async function verifyCredentials(username, password) {
  const user = await get('SELECT * FROM users WHERE username = ?', [(username || '').trim()]);
  if (!user) return null;
  if (!bcrypt.compareSync(password || '', user.password_hash)) return null;
  return { id: user.id, username: user.username, name: user.name, role: user.role };
}

export async function changePassword(userId, currentPassword, newPassword) {
  const user = await get('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user) return { ok: false, status: 404, error: 'User not found' };
  if (!bcrypt.compareSync(currentPassword || '', user.password_hash)) {
    return { ok: false, status: 400, error: 'Current password is incorrect' };
  }
  const password_hash = bcrypt.hashSync(newPassword, 10);
  await run('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash, userId]);
  return { ok: true };
}

export function newToken() {
  return nanoid(12);
}
