import { all, get, run } from '../db.js';

export async function listDepartments() {
  return all(
    `SELECT d.id, d.name, d.created_at AS createdAt,
            (SELECT COUNT(*) FROM programs p WHERE p.department_id = d.id) AS programCount,
            (SELECT COUNT(*) FROM users u WHERE u.department_id = d.id) AS userCount,
            (SELECT COUNT(*) FROM students s WHERE s.department_id = d.id) AS studentCount,
            (SELECT COUNT(*) FROM events e WHERE e.department_id = d.id) AS eventCount
     FROM departments d
     ORDER BY d.name COLLATE NOCASE`
  );
}

export async function listPrograms({ departmentId = null, includeInactive = false } = {}) {
  const clauses = [];
  const params = [];
  if (departmentId) {
    clauses.push('p.department_id = ?');
    params.push(Number(departmentId));
  }
  if (!includeInactive) clauses.push('p.active = 1');
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return all(
    `SELECT p.id, p.name, p.code, p.active, p.department_id AS departmentId, d.name AS departmentName, p.created_at AS createdAt,
            (SELECT COUNT(*) FROM users u WHERE u.program_id = p.id) AS userCount,
            (SELECT COUNT(*) FROM students s WHERE s.program_id = p.id) AS studentCount,
            (SELECT COUNT(*) FROM events e WHERE e.program_id = p.id) AS eventCount
     FROM programs p
     JOIN departments d ON d.id = p.department_id
     ${where}
     ORDER BY d.name COLLATE NOCASE, p.name COLLATE NOCASE`,
    params
  );
}

export async function createDepartment({ name }) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return { ok: false, status: 400, error: 'College/department name is required' };
  try {
    const info = await run('INSERT INTO departments (name) VALUES (?)', [trimmed]);
    const department = await get(
      `SELECT d.id, d.name, d.created_at AS createdAt,
              0 AS programCount, 0 AS userCount, 0 AS studentCount, 0 AS eventCount
       FROM departments d WHERE d.id = ?`,
      [info.lastInsertRowid]
    );
    return { ok: true, department };
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return { ok: false, status: 409, error: 'That college/department already exists' };
    }
    throw err;
  }
}

export async function updateDepartment(id, { name }) {
  const deptId = Number(id);
  if (!Number.isInteger(deptId) || deptId <= 0) return { ok: false, status: 400, error: 'Invalid department' };
  const existing = await get('SELECT id FROM departments WHERE id = ?', [deptId]);
  if (!existing) return { ok: false, status: 404, error: 'College/department not found' };
  const trimmed = String(name || '').trim();
  if (!trimmed) return { ok: false, status: 400, error: 'College/department name is required' };
  try {
    await run('UPDATE departments SET name = ? WHERE id = ?', [trimmed, deptId]);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return { ok: false, status: 409, error: 'That college/department already exists' };
    }
    throw err;
  }
  const department = await get(
    `SELECT d.id, d.name, d.created_at AS createdAt,
            (SELECT COUNT(*) FROM programs p WHERE p.department_id = d.id) AS programCount,
            (SELECT COUNT(*) FROM users u WHERE u.department_id = d.id) AS userCount,
            (SELECT COUNT(*) FROM students s WHERE s.department_id = d.id) AS studentCount,
            (SELECT COUNT(*) FROM events e WHERE e.department_id = d.id) AS eventCount
     FROM departments d WHERE d.id = ?`,
    [deptId]
  );
  return { ok: true, department };
}

export async function deleteDepartment(id) {
  const deptId = Number(id);
  if (!Number.isInteger(deptId) || deptId <= 0) return { ok: false, status: 400, error: 'Invalid department' };
  const existing = await get('SELECT id, name FROM departments WHERE id = ?', [deptId]);
  if (!existing) return { ok: false, status: 404, error: 'College/department not found' };
  await run('DELETE FROM departments WHERE id = ?', [deptId]);
  return { ok: true, department: existing };
}

export async function createProgram({ departmentId, name, code = '' }) {
  const deptId = Number(departmentId);
  if (!Number.isInteger(deptId) || deptId <= 0) return { ok: false, status: 400, error: 'College/department is required' };
  const trimmed = String(name || '').trim();
  if (!trimmed) return { ok: false, status: 400, error: 'Program name is required' };
  const dept = await get('SELECT id, name FROM departments WHERE id = ?', [deptId]);
  if (!dept) return { ok: false, status: 404, error: 'College/department not found' };
  try {
    const info = await run(
      'INSERT INTO programs (department_id, name, code, active) VALUES (?, ?, ?, 1)',
      [deptId, trimmed, String(code || '').trim() || null]
    );
    const program = await get(
      `SELECT p.id, p.name, p.code, p.active, p.department_id AS departmentId, d.name AS departmentName,
              0 AS userCount, 0 AS studentCount, 0 AS eventCount
       FROM programs p JOIN departments d ON d.id = p.department_id WHERE p.id = ?`,
      [info.lastInsertRowid]
    );
    return { ok: true, program };
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return { ok: false, status: 409, error: 'That program already exists in this college/department' };
    }
    throw err;
  }
}

export async function updateProgram(id, { departmentId, name, code = '', active = 1 }) {
  const progId = Number(id);
  if (!Number.isInteger(progId) || progId <= 0) return { ok: false, status: 400, error: 'Invalid program' };
  const existing = await get('SELECT id FROM programs WHERE id = ?', [progId]);
  if (!existing) return { ok: false, status: 404, error: 'Program not found' };
  const deptId = Number(departmentId);
  if (!Number.isInteger(deptId) || deptId <= 0) return { ok: false, status: 400, error: 'College/department is required' };
  const dept = await get('SELECT id FROM departments WHERE id = ?', [deptId]);
  if (!dept) return { ok: false, status: 404, error: 'College/department not found' };
  const trimmed = String(name || '').trim();
  if (!trimmed) return { ok: false, status: 400, error: 'Program name is required' };
  const isActive = active === false || active === 0 || String(active) === '0' ? 0 : 1;
  try {
    await run(
      'UPDATE programs SET department_id = ?, name = ?, code = ?, active = ? WHERE id = ?',
      [deptId, trimmed, String(code || '').trim() || null, isActive, progId]
    );
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return { ok: false, status: 409, error: 'That program already exists in this college/department' };
    }
    throw err;
  }
  const program = await get(
    `SELECT p.id, p.name, p.code, p.active, p.department_id AS departmentId, d.name AS departmentName,
            (SELECT COUNT(*) FROM users u WHERE u.program_id = p.id) AS userCount,
            (SELECT COUNT(*) FROM students s WHERE s.program_id = p.id) AS studentCount,
            (SELECT COUNT(*) FROM events e WHERE e.program_id = p.id) AS eventCount
     FROM programs p JOIN departments d ON d.id = p.department_id WHERE p.id = ?`,
    [progId]
  );
  return { ok: true, program };
}

export async function deleteProgram(id) {
  const progId = Number(id);
  if (!Number.isInteger(progId) || progId <= 0) return { ok: false, status: 400, error: 'Invalid program' };
  const existing = await get('SELECT id, name FROM programs WHERE id = ?', [progId]);
  if (!existing) return { ok: false, status: 404, error: 'Program not found' };
  await run('DELETE FROM programs WHERE id = ?', [progId]);
  return { ok: true, program: existing };
}

export async function getAcademicStructure({ includeInactivePrograms = false } = {}) {
  const [departments, programs] = await Promise.all([
    listDepartments(),
    listPrograms({ includeInactive: includeInactivePrograms }),
  ]);
  return { departments, programs };
}

// Returns a student-scope filter for staff users.
// Admins (or users without an assigned scope) are unrestricted.
export function studentScopeFilter(user, opts = {}) {
  const studentAlias = opts.studentAlias ? `${opts.studentAlias}.` : '';
  const programAlias = opts.programAlias || 'p_scope';
  if (!user || user.role === 'admin') {
    return { join: '', where: '', params: [], scoped: false };
  }
  const departmentId = Number(user.departmentId || 0);
  const programId = Number(user.programId || 0);
  if (!departmentId && !programId) {
    // Legacy/unassigned staff: keep existing access until explicitly assigned.
    return { join: '', where: '', params: [], scoped: false };
  }
  if (programId) {
    return {
      join: ` LEFT JOIN programs ${programAlias} ON ${programAlias}.id = ${studentAlias}program_id `,
      where: ` AND (${studentAlias}program_id = ? OR (${studentAlias}program_id IS NULL AND ${programAlias}.department_id = ?)) `,
      params: [programId, departmentId || 0],
      scoped: true,
      departmentId: departmentId || null,
      programId,
    };
  }
  return {
    join: ` LEFT JOIN programs ${programAlias} ON ${programAlias}.id = ${studentAlias}program_id `,
    where: ` AND (${studentAlias}department_id = ? OR ${programAlias}.department_id = ?) `,
    params: [departmentId, departmentId],
    scoped: true,
    departmentId,
    programId: null,
  };
}

// Returns an event-scope filter for staff users.
// Admins/unassigned staff are unrestricted. Scoped staff only see events tagged
// to their assigned department/program (unscoped legacy events are hidden).
export function eventScopeFilter(user, opts = {}) {
  const alias = opts.eventAlias ? `${opts.eventAlias}.` : '';
  if (!user || user.role === 'admin') return { where: '', params: [], scoped: false };
  const departmentId = Number(user.departmentId || 0);
  const programId = Number(user.programId || 0);
  if (!departmentId && !programId) return { where: '', params: [], scoped: false };
  if (programId) {
    return { where: ` AND ${alias}program_id = ? `, params: [programId], scoped: true, departmentId: departmentId || null, programId };
  }
  return { where: ` AND ${alias}department_id = ? `, params: [departmentId], scoped: true, departmentId, programId: null };
}

export function isStudentVisibleToUser(user, student = {}) {
  const scope = studentScopeFilter(user);
  if (!scope.scoped) return true;
  const deptId = Number(user.departmentId || 0);
  const progId = Number(user.programId || 0);
  const sProg = Number(student.programId || student.program_id || 0);
  const sDept = Number(student.departmentId || student.department_id || 0);
  if (progId) return sProg === progId || (!!deptId && !sProg && sDept === deptId);
  if (deptId) return sDept === deptId; // program department checked via joined context in SQL paths
  return true;
}
