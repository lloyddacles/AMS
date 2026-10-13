import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { db } from '../db.js';

export function createUser({ username, password, name, role = 'admin' }) {
  const password_hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare(
      'INSERT INTO users (username, password_hash, name, role) VALUES (?, ?, ?, ?)'
    )
    .run(username.trim(), password_hash, name.trim(), role);
  return db.prepare('SELECT id, username, name, role FROM users WHERE id = ?').get(info.lastInsertRowid);
}

export function verifyCredentials(username, password) {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get((username || '').trim());
  if (!user) return null;
  if (!bcrypt.compareSync(password || '', user.password_hash)) return null;
  return { id: user.id, username: user.username, name: user.name, role: user.role };
}

export function changePassword(userId, currentPassword, newPassword) {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!user) return { ok: false, status: 404, error: 'User not found' };
  if (!bcrypt.compareSync(currentPassword || '', user.password_hash)) {
    return { ok: false, status: 400, error: 'Current password is incorrect' };
  }
  const password_hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(password_hash, userId);
  return { ok: true };
}

export function newToken() {
  return nanoid(12);
}
