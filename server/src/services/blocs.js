import { all, get, run, batch } from '../db.js';
import { scopedWriteScope, studentScopeFilter } from './academic.js';
import { includeStudents } from './roster.js';

function normalizeId(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function blocScopeFilter(user, opts = {}) {
  const alias = opts.blocAlias ? `${opts.blocAlias}.` : '';
  if (!user || user.role === 'admin') return { where: '', params: [], scoped: false };
  const departmentId = Number(user.departmentId || 0);
  const programId = Number(user.programId || 0);
  if (!departmentId && !programId) return { where: '', params: [], scoped: false }; // legacy/unassigned
  if (programId) {
    return {
      where: ` AND (${alias}program_id = ? OR (${alias}program_id IS NULL AND ${alias}department_id = ?)) `,
      params: [programId, departmentId || 0],
      scoped: true,
      departmentId: departmentId || null,
      programId,
    };
  }
  return {
    where: ` AND (${alias}department_id = ? OR (COALESCE(${alias}department_id, 0) = 0 AND 1=0)) `,
    params: [departmentId],
    scoped: true,
    departmentId,
    programId: null,
  };
}

export function blocVisibleToUser(user, bloc = {}) {
  const scope = blocScopeFilter(user);
  if (!scope.scoped) return true;
  const bDept = Number(bloc.departmentId || bloc.department_id || 0);
  const bProg = Number(bloc.programId || bloc.program_id || 0);
  const uDept = Number(user.departmentId || 0);
  const uProg = Number(user.programId || 0);
  if (uProg) return bProg === uProg || (!bProg && bDept === uDept);
  if (uDept) return bDept === uDept;
  return true;
}

const BLOC_FIELDS = `b.id, b.name, b.description, b.department_id AS departmentId, b.program_id AS programId,
  b.course, b.year_level AS yearLevel, b.section, b.active, b.created_by AS createdBy,
  b.created_at AS createdAt, b.updated_at AS updatedAt,
  d.name AS departmentName, p.name AS programName,
  (SELECT COUNT(*) FROM bloc_members bm WHERE bm.bloc_id = b.id) AS memberCount`;

export async function listBlocs(user, { search = '', includeInactive = false } = {}) {
  const scope = blocScopeFilter(user, { blocAlias: 'b' });
  const clauses = [];
  const params = [];
  if (!includeInactive) clauses.push('b.active = 1');
  const q = String(search || '').trim().toLowerCase();
  if (q) {
    clauses.push(`(LOWER(b.name) LIKE ? OR LOWER(COALESCE(b.description,'')) LIKE ? OR LOWER(COALESCE(b.course,'')) LIKE ? OR LOWER(COALESCE(b.section,'')) LIKE ? OR LOWER(COALESCE(d.name,'')) LIKE ? OR LOWER(COALESCE(p.name,'')) LIKE ?)`);
    const like = `%${q}%`;
    params.push(like, like, like, like, like, like);
  }
  const whereParts = [];
  if (clauses.length) whereParts.push(clauses.join(' AND '));
  let where = '';
  if (whereParts.length) where = `WHERE ${whereParts.join(' AND ')} ${scope.where}`;
  else if (scope.where) where = `WHERE 1=1 ${scope.where}`;
  const rows = await all(
    `SELECT ${BLOC_FIELDS}
     FROM blocs b
     LEFT JOIN departments d ON d.id = b.department_id
     LEFT JOIN programs p ON p.id = b.program_id
     ${where}
     ORDER BY b.active DESC, b.updated_at DESC, b.name COLLATE NOCASE`,
    [...params, ...scope.params]
  );
  return rows.map((r) => ({ ...r, active: Number(r.active) ? 1 : 0, memberCount: Number(r.memberCount) || 0 }));
}

export async function getBloc(id, user) {
  const blocId = normalizeId(id);
  if (!blocId) return null;
  const scope = blocScopeFilter(user, { blocAlias: 'b' });
  const row = await get(
    `SELECT ${BLOC_FIELDS}
     FROM blocs b
     LEFT JOIN departments d ON d.id = b.department_id
     LEFT JOIN programs p ON p.id = b.program_id
     WHERE b.id = ? ${scope.where}`,
    [blocId, ...scope.params]
  );
  if (!row) return null;
  return { ...row, active: Number(row.active) ? 1 : 0, memberCount: Number(row.memberCount) || 0 };
}

function normalizeBlocInput(input = {}, existing = null, user = null) {
  const name = String(input.name ?? existing?.name ?? '').trim();
  if (!name) return { error: 'Bloc name is required' };
  const requestedScope = user?.role === 'admin'
    ? { departmentId: input.departmentId !== undefined ? input.departmentId : existing?.departmentId, programId: input.programId !== undefined ? input.programId : existing?.programId }
    : { departmentId: existing?.departmentId ?? user?.departmentId ?? null, programId: existing?.programId ?? user?.programId ?? null };
  const scope = scopedWriteScope(user, requestedScope);
  // If scoped staff has no program, keep dept scope; if they have program, force it.
  const active = input.active === undefined ? Number(existing?.active ?? 1) : (input.active ? 1 : 0);
  return {
    name,
    description: input.description === undefined ? (existing?.description ?? null) : (String(input.description || '').trim() || null),
    course: input.course === undefined ? (existing?.course ?? null) : (String(input.course || '').trim() || null),
    yearLevel: input.yearLevel === undefined ? (existing?.yearLevel ?? existing?.year_level ?? null) : (String(input.yearLevel || '').trim() || null),
    section: input.section === undefined ? (existing?.section ?? null) : (String(input.section || '').trim() || null),
    departmentId: scope.departmentId,
    programId: scope.programId,
    active,
  };
}

export async function createBloc(input = {}, user = null) {
  const parsed = normalizeBlocInput(input, null, user);
  if (parsed.error) return { ok: false, status: 400, error: parsed.error };
  // validate dept/program existence if provided
  if (parsed.departmentId) {
    const d = await get('SELECT id FROM departments WHERE id = ?', [parsed.departmentId]);
    if (!d) return { ok: false, status: 404, error: 'Department/college not found' };
  }
  if (parsed.programId) {
    const p = await get('SELECT id, department_id AS departmentId FROM programs WHERE id = ?', [parsed.programId]);
    if (!p) return { ok: false, status: 404, error: 'Program not found' };
    if (parsed.departmentId && Number(p.departmentId) !== Number(parsed.departmentId)) {
      return { ok: false, status: 400, error: 'Program does not belong to the selected department/college' };
    }
    if (!parsed.departmentId) parsed.departmentId = Number(p.departmentId);
  }
  const info = await run(
    `INSERT INTO blocs (name, description, department_id, program_id, course, year_level, section, active, created_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [parsed.name, parsed.description, parsed.departmentId, parsed.programId, parsed.course, parsed.yearLevel, parsed.section, parsed.active, user?.id || null]
  );
  const bloc = await getBloc(info.lastInsertRowid, user?.role === 'admin' ? user : { ...user, role: 'admin' }) || await getBloc(info.lastInsertRowid, user);
  // but scoped staff may not see if mismatch; return by direct read fallback
  const direct = bloc || await get(
    `SELECT ${BLOC_FIELDS} FROM blocs b LEFT JOIN departments d ON d.id=b.department_id LEFT JOIN programs p ON p.id=b.program_id WHERE b.id=?`,
    [info.lastInsertRowid]
  );
  return { ok: true, bloc: { ...direct, active: Number(direct.active) ? 1 : 0, memberCount: Number(direct.memberCount) || 0 } };
}

export async function updateBloc(id, input = {}, user = null) {
  const blocId = normalizeId(id);
  if (!blocId) return { ok: false, status: 400, error: 'Invalid bloc' };
  const existing = await getBloc(blocId, user);
  if (!existing) return { ok: false, status: 404, error: 'Bloc not found' };
  const parsed = normalizeBlocInput(input, existing, user);
  if (parsed.error) return { ok: false, status: 400, error: parsed.error };
  if (parsed.departmentId) {
    const d = await get('SELECT id FROM departments WHERE id = ?', [parsed.departmentId]);
    if (!d) return { ok: false, status: 404, error: 'Department/college not found' };
  }
  if (parsed.programId) {
    const p = await get('SELECT id, department_id AS departmentId FROM programs WHERE id = ?', [parsed.programId]);
    if (!p) return { ok: false, status: 404, error: 'Program not found' };
    if (parsed.departmentId && Number(p.departmentId) !== Number(parsed.departmentId)) {
      return { ok: false, status: 400, error: 'Program does not belong to the selected department/college' };
    }
    if (!parsed.departmentId) parsed.departmentId = Number(p.departmentId);
  }
  await run(
    `UPDATE blocs SET name=?, description=?, department_id=?, program_id=?, course=?, year_level=?, section=?, active=?, updated_at=datetime('now') WHERE id=?`,
    [parsed.name, parsed.description, parsed.departmentId, parsed.programId, parsed.course, parsed.yearLevel, parsed.section, parsed.active, blocId]
  );
  const bloc = await getBloc(blocId, user);
  return { ok: true, bloc };
}

export async function deleteBloc(id, user = null) {
  const blocId = normalizeId(id);
  if (!blocId) return { ok: false, status: 400, error: 'Invalid bloc' };
  const existing = await getBloc(blocId, user);
  if (!existing) return { ok: false, status: 404, error: 'Bloc not found' };
  await run('DELETE FROM blocs WHERE id = ?', [blocId]);
  return { ok: true, bloc: existing };
}

async function filterStudentIdsForBloc(user, bloc, studentIds = []) {
  const ids = [...new Set(studentIds.map(normalizeId).filter(Boolean))];
  if (!ids.length) return { ids: [], rejected: [] };
  const placeholders = ids.map(() => '?').join(',');
  const sScope = studentScopeFilter(user, { studentAlias: 's', programAlias: 'p_scope' });
  // visible to acting user
  const visibleRows = await all(
    `SELECT s.id
     FROM students s
     LEFT JOIN programs p ON p.id = s.program_id
     LEFT JOIN departments d ON d.id = COALESCE(s.department_id, p.department_id)
     ${sScope.join}
     WHERE s.id IN (${placeholders}) ${sScope.where}`,
    [...ids, ...sScope.params]
  );
  const visible = new Set(visibleRows.map((r) => Number(r.id)));
  // must also fit bloc scope when bloc is scoped (program/dept)
  let allowed = visible;
  const bDept = Number(bloc.departmentId || 0);
  const bProg = Number(bloc.programId || 0);
  if (bProg || bDept) {
    const scopeRows = await all(
      `SELECT s.id
       FROM students s
       LEFT JOIN programs p ON p.id = s.program_id
       WHERE s.id IN (${placeholders})
         AND (
           ${bProg ? 's.program_id = ?' : '(s.department_id = ? OR p.department_id = ?)'}
         )`,
      bProg ? [...ids, bProg] : [...ids, bDept, bDept]
    );
    const inBlocScope = new Set(scopeRows.map((r) => Number(r.id)));
    allowed = new Set([...visible].filter((idv) => inBlocScope.has(idv)));
  }
  const rejected = ids.filter((idv) => !allowed.has(idv));
  return { ids: ids.filter((idv) => allowed.has(idv)), rejected };
}

export async function listBlocMembers(blocId, user) {
  const bloc = await getBloc(blocId, user);
  if (!bloc) return { ok: false, status: 404, error: 'Bloc not found' };
  const rows = await all(
    `SELECT s.id AS studentId, s.student_no AS studentNo, s.first_name AS firstName, s.last_name AS lastName,
            s.course, s.year_level AS yearLevel, s.section, s.status,
            s.program_id AS programId, s.department_id AS departmentId,
            bm.added_at AS addedAt
     FROM bloc_members bm
     JOIN students s ON s.id = bm.student_id
     WHERE bm.bloc_id = ?
     ORDER BY s.last_name COLLATE NOCASE, s.first_name COLLATE NOCASE`,
    [bloc.id]
  );
  return { ok: true, bloc, members: rows };
}

export async function addBlocMembers(blocId, studentIds = [], user = null) {
  const bloc = await getBloc(blocId, user);
  if (!bloc) return { ok: false, status: 404, error: 'Bloc not found' };
  const { ids, rejected } = await filterStudentIdsForBloc(user, bloc, studentIds);
  if (!ids.length) return { ok: false, status: 400, error: rejected.length ? 'No eligible students selected for this bloc/scope' : 'Select at least one student' };
  let added = 0;
  for (const sid of ids) {
    const info = await run(
      'INSERT OR IGNORE INTO bloc_members (bloc_id, student_id, added_by) VALUES (?, ?, ?)',
      [bloc.id, sid, user?.id || null]
    );
    if (info.changes) added += 1;
  }
  await run("UPDATE blocs SET updated_at = datetime('now') WHERE id = ?", [bloc.id]);
  const members = await listBlocMembers(bloc.id, user);
  return { ok: true, bloc: members.bloc, members: members.members, added, rejectedCount: rejected.length, rejectedIds: rejected };
}

export async function removeBlocMembers(blocId, studentIds = [], user = null) {
  const bloc = await getBloc(blocId, user);
  if (!bloc) return { ok: false, status: 404, error: 'Bloc not found' };
  const ids = [...new Set(studentIds.map(normalizeId).filter(Boolean))];
  if (!ids.length) return { ok: false, status: 400, error: 'Select at least one student' };
  const placeholders = ids.map(() => '?').join(',');
  const info = await run(
    `DELETE FROM bloc_members WHERE bloc_id = ? AND student_id IN (${placeholders})`,
    [bloc.id, ...ids]
  );
  await run("UPDATE blocs SET updated_at = datetime('now') WHERE id = ?", [bloc.id]);
  const members = await listBlocMembers(bloc.id, user);
  return { ok: true, bloc: members.bloc, members: members.members, removed: info.changes || 0 };
}

export async function setBlocMembers(blocId, studentIds = [], user = null) {
  const bloc = await getBloc(blocId, user);
  if (!bloc) return { ok: false, status: 404, error: 'Bloc not found' };
  const desired = [...new Set(studentIds.map(normalizeId).filter(Boolean))];
  const { ids: allowedIds, rejected } = desired.length ? await filterStudentIdsForBloc(user, bloc, desired) : { ids: [], rejected: [] };
  // replace membership with allowed set
  const existing = await all('SELECT student_id AS studentId FROM bloc_members WHERE bloc_id = ?', [bloc.id]);
  const existingIds = new Set(existing.map((r) => Number(r.studentId)));
  const keep = new Set(allowedIds);
  const toAdd = allowedIds.filter((idv) => !existingIds.has(idv));
  const toRemove = [...existingIds].filter((idv) => !keep.has(idv));
  if (toRemove.length) {
    const ph = toRemove.map(() => '?').join(',');
    await run(`DELETE FROM bloc_members WHERE bloc_id = ? AND student_id IN (${ph})`, [bloc.id, ...toRemove]);
  }
  for (const sid of toAdd) {
    await run('INSERT OR IGNORE INTO bloc_members (bloc_id, student_id, added_by) VALUES (?, ?, ?)', [bloc.id, sid, user?.id || null]);
  }
  await run("UPDATE blocs SET updated_at = datetime('now') WHERE id = ?", [bloc.id]);
  const members = await listBlocMembers(bloc.id, user);
  return { ok: true, bloc: members.bloc, members: members.members, added: toAdd.length, removed: toRemove.length, rejectedCount: rejected.length, rejectedIds: rejected };
}

export async function applyBlocsToEvent({ eventId, blocIds = [], user = null }) {
  const eid = normalizeId(eventId);
  if (!eid) return { ok: false, status: 400, error: 'Invalid event' };
  const bids = [...new Set(blocIds.map(normalizeId).filter(Boolean))];
  if (!bids.length) return { ok: false, status: 400, error: 'Select at least one bloc' };
  // load blocs visible to user
  const blocs = [];
  const missing = [];
  for (const bid of bids) {
    const b = await getBloc(bid, user);
    if (!b) missing.push(bid); else blocs.push(b);
  }
  if (!blocs.length) return { ok: false, status: 404, error: 'No matching blocs found' };
  // gather all member ids
  const memberRows = await all(
    `SELECT DISTINCT student_id AS studentId FROM bloc_members WHERE bloc_id IN (${blocs.map(() => '?').join(',')})`,
    blocs.map((b) => b.id)
  );
  const memberIds = memberRows.map((r) => Number(r.studentId)).filter(Boolean);
  if (!memberIds.length) return { ok: true, added: 0, memberCount: 0, blocs: blocs.map((b) => b.id), missing, note: 'Selected blocs have no members' };
  // include members in event roster (idempotent) - roster semantics: add to attendees = remove exclusion
  const added = await includeStudents({ eventId: eid, studentIds: memberIds });
  return { ok: true, added, memberCount: memberIds.length, blocs: blocs.map((b) => b.id), missing };
}
