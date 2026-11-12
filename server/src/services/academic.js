import { all, get, run } from '../db.js';

export async function listDepartments() {
  return all(
    `SELECT d.id, d.name, d.created_at AS createdAt,
            (SELECT COUNT(*) FROM programs p WHERE p.department_id = d.id AND p.active = 1) AS programCount
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
    `SELECT p.id, p.name, p.code, p.active, p.department_id AS departmentId, d.name AS departmentName, p.created_at AS createdAt
     FROM programs p
     JOIN departments d ON d.id = p.department_id
     ${where}
     ORDER BY d.name COLLATE NOCASE, p.name COLLATE NOCASE`,
    params
  );
}

export async function createProgram({ departmentId, name, code = '' }) {
  const deptId = Number(departmentId);
  if (!Number.isInteger(deptId) || deptId <= 0) return { ok: false, status: 400, error: 'Department is required' };
  const trimmed = String(name || '').trim();
  if (!trimmed) return { ok: false, status: 400, error: 'Program name is required' };
  const dept = await get('SELECT id, name FROM departments WHERE id = ?', [deptId]);
  if (!dept) return { ok: false, status: 404, error: 'Department not found' };
  try {
    const info = await run(
      'INSERT INTO programs (department_id, name, code, active) VALUES (?, ?, ?, 1)',
      [deptId, trimmed, String(code || '').trim() || null]
    );
    const program = await get(
      `SELECT p.id, p.name, p.code, p.active, p.department_id AS departmentId, d.name AS departmentName
       FROM programs p JOIN departments d ON d.id = p.department_id WHERE p.id = ?`,
      [info.lastInsertRowid]
    );
    return { ok: true, program };
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return { ok: false, status: 409, error: 'That program already exists in this department' };
    }
    throw err;
  }
}

export async function getAcademicStructure() {
  const [departments, programs] = await Promise.all([listDepartments(), listPrograms({ includeInactive: false })]);
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
