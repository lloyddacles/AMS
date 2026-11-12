import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { get, all, run } from '../db.js';

export const DEFAULT_PASSWORD = 'admin123';

const PUBLIC_COLS = `
  u.id, u.username, u.name, u.role, u.avatar, u.active,
  u.must_change_password AS mustChangePassword,
  u.department_id AS departmentId, u.program_id AS programId,
  d.name AS departmentName, p.name AS programName,
  u.created_at AS createdAt
`;

const PUBLIC_FROM = `
  FROM users u
  LEFT JOIN departments d ON d.id = u.department_id
  LEFT JOIN programs p ON p.id = u.program_id
`;

async function validateAssignment({ role = 'staff', departmentId = null, programId = null } = {}) {
  const deptId = departmentId == null || departmentId === '' ? null : Number(departmentId);
  const progId = programId == null || programId === '' ? null : Number(programId);
  if ((deptId != null && (!Number.isInteger(deptId) || deptId <= 0)) || (progId != null && (!Number.isInteger(progId) || progId <= 0))) {
    return { ok: false, status: 400, error: 'Invalid department or program selection' };
  }
  if (role === 'admin') {
    // Admins have full access; assignment is optional/ignored in practice but allowed.
    if (!deptId && !progId) return { ok: true, departmentId: null, programId: null };
  }
  if (progId) {
    const prog = await get(
      'SELECT id, department_id AS departmentId FROM programs WHERE id = ? AND active = 1',
      [progId]
    );
    if (!prog) return { ok: false, status: 400, error: 'Selected program was not found' };
    if (deptId && Number(deptId) !== Number(prog.departmentId)) {
      return { ok: false, status: 400, error: 'Selected program does not belong to the selected department' };
    }
    return { ok: true, departmentId: Number(prog.departmentId), programId: Number(prog.id) };
  }
  if (deptId) {
    const dept = await get('SELECT id FROM departments WHERE id = ?', [deptId]);
    if (!dept) return { ok: false, status: 400, error: 'Selected department was not found' };
    return { ok: true, departmentId: Number(dept.id), programId: null };
  }
  return { ok: true, departmentId: null, programId: null };
}

export async function getUser(userId) {
  return get(`SELECT ${PUBLIC_COLS} ${PUBLIC_FROM} WHERE u.id = ?`, [userId]);
}

export async function listUsers() {
  return all(`SELECT ${PUBLIC_COLS} ${PUBLIC_FROM} ORDER BY u.role DESC, u.name COLLATE NOCASE`);
}

export async function createUser({ username, password, name, role = 'staff', mustChangePassword = 0, departmentId = null, programId = null }) {
  const assignment = await validateAssignment({ role, departmentId, programId });
  if (!assignment.ok) throw Object.assign(new Error(assignment.error), { status: assignment.status });
  const password_hash = bcrypt.hashSync(password, 10);
  const info = await run(
    `INSERT INTO users (username, password_hash, name, role, must_change_password, department_id, program_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [username.trim(), password_hash, name.trim(), role, mustChangePassword ? 1 : 0, assignment.departmentId, assignment.programId]
  );
  return getUser(info.lastInsertRowid);
}

export async function verifyCredentials(username, password) {
  const user = await get(
    `SELECT u.*, d.name AS department_name, p.name AS program_name
     FROM users u
     LEFT JOIN departments d ON d.id = u.department_id
     LEFT JOIN programs p ON p.id = u.program_id
     WHERE u.username = ?`,
    [(username || '').trim()]
  );
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
    departmentId: user.department_id || null,
    programId: user.program_id || null,
    departmentName: user.department_name || null,
    programName: user.program_name || null,
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

export async function updateUser(actorId, userId, { name, role, active, departmentId, programId }) {
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

  const nextDepartmentId = departmentId === undefined ? user.department_id : departmentId;
  const nextProgramId = programId === undefined ? user.program_id : programId;
  const assignment = await validateAssignment({ role: nextRole, departmentId: nextDepartmentId, programId: nextProgramId });
  if (!assignment.ok) return assignment;

  await run(
    'UPDATE users SET name = ?, role = ?, active = ?, department_id = ?, program_id = ? WHERE id = ?',
    [nextName, nextRole, nextActive, assignment.departmentId, assignment.programId, userId]
  );
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
