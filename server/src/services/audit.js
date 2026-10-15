import { run, all, get } from '../db.js';

// Record an action in the audit trail. Never throws into the request path.
export async function logAudit({ user, action, entity = null, entityId = null, detail = null }) {
  try {
    await run(
      `INSERT INTO audit_log (user_id, user_name, action, entity, entity_id, detail)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        user?.id ?? null,
        user?.name ?? user?.username ?? null,
        action,
        entity,
        entityId === null || entityId === undefined ? null : String(entityId),
        detail ? (typeof detail === 'string' ? detail : JSON.stringify(detail)) : null,
      ]
    );
  } catch (err) {
    console.error('audit log failed', err);
  }
}

export async function listAudit({ userId, entity, action, search, from, to, limit = 50, offset = 0 }) {
  const where = [];
  const args = [];
  if (userId) {
    where.push('user_id = ?');
    args.push(userId);
  }
  if (entity) {
    where.push('entity = ?');
    args.push(entity);
  }
  if (action) {
    where.push('action = ?');
    args.push(action);
  }
  if (from) {
    where.push('created_at >= ?');
    args.push(from);
  }
  if (to) {
    where.push('created_at <= ?');
    args.push(to);
  }
  if (search) {
    where.push('(user_name LIKE ? OR action LIKE ? OR detail LIKE ?)');
    const like = `%${search}%`;
    args.push(like, like, like);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (await get(`SELECT COUNT(*) AS c FROM audit_log ${clause}`, args)).c;
  const rows = await all(
    `SELECT id, user_id AS userId, user_name AS userName, action, entity,
            entity_id AS entityId, detail, created_at AS createdAt
     FROM audit_log ${clause}
     ORDER BY id DESC
     LIMIT ? OFFSET ?`,
    [...args, Number(limit), Number(offset)]
  );
  return { total, rows };
}

export async function listAuditActors() {
  return all(
    `SELECT DISTINCT user_id AS id, user_name AS name FROM audit_log
     WHERE user_id IS NOT NULL ORDER BY user_name COLLATE NOCASE`
  );
}
