import fs from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

let app;
let db;
let notif;

function rm(file) {
  try { fs.unlinkSync(file); } catch {}
}

beforeAll(async () => {
  const dbFile = './data/test-authz-scope.sqlite';
  rm(dbFile);
  process.env.JWT_SECRET = 'test-secret-that-is-long-enough';
  process.env.NODE_ENV = 'test';
  process.env.TURSO_DATABASE_URL = `file:${dbFile}`;
  vi.resetModules();
  app = (await import('../src/app.js')).default;
  db = await import('../src/db.js');
  notif = await import('../src/services/notifications.js');
});

async function login(username, password) {
  const res = await request(app).post('/api/auth/login').send({ username, password });
  expect(res.status).toBe(200);
  return res.body.token;
}

describe('Authorization and department/program scoping', () => {
  let adminToken, staffAToken, staffBToken, unassignedToken;
  let deptA, deptB, progA, progB;
  let studentA, studentB, eventA, eventB;

  it('sets up scoped users, students, and events', async () => {
    adminToken = await login('admin', 'admin123');
    const acad = await request(app).get('/api/academic/structure').set('Authorization', `Bearer ${adminToken}`);
    expect(acad.status).toBe(200);
    deptA = acad.body.departments[0];
    deptB = acad.body.departments[1] || acad.body.departments[0];
    progA = (acad.body.programs || []).find((p) => p.departmentId === deptA.id) || null;
    progB = (acad.body.programs || []).find((p) => p.departmentId === deptB.id) || progA;

    const mkStaff = async (username, departmentId, programId) => {
      const res = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ username, name: username, password: 'staffpass123', role: 'staff', departmentId, programId: programId || null });
      expect(res.status).toBe(201);
      return login(username, 'staffpass123');
    };
    staffAToken = await mkStaff('scope_staff_a', deptA.id, progA?.id);
    staffBToken = await mkStaff('scope_staff_b', deptB.id, progB?.id);
    const unassignedRes = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: 'scope_unassigned', name: 'Unassigned Staff', password: 'staffpass123', role: 'staff' });
    expect(unassignedRes.status).toBe(201);
    unassignedToken = await login('scope_unassigned', 'staffpass123');

    const mkStudent = async (studentNo, firstName, lastName, departmentId, programId, programName) => {
      const res = await request(app)
        .post('/api/students')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ studentNo, firstName, lastName, programId: programId || null, course: programName || 'Test Course' });
      expect(res.status).toBe(201);
      return res.body;
    };
    studentA = await mkStudent('SA001', 'Entrep', 'Alpha', deptA.id, progA?.id, progA?.name);
    studentB = await mkStudent('SB001', 'Other', 'Beta', deptB.id, progB?.id, progB?.name);

    // Ensure test fixtures represent distinct scopes when the seeded academic structure allows it.
    expect(studentA.programId || studentA.departmentId).toBeTruthy();
    expect(studentB.programId || studentB.departmentId).toBeTruthy();

    const today = new Date().toISOString().slice(0, 10);
    const mkEvent = async (name, departmentId, programId) => {
      const res = await request(app)
        .post('/api/events')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name, eventDate: today, startTime: '00:00', endTime: '23:59', status: 'active', departmentId, programId: programId || null });
      expect(res.status).toBe(201);
      return res.body;
    };
    eventA = await mkEvent('Dept A Event', deptA.id, progA?.id);
    eventB = await mkEvent('Dept B Event', deptB.id, progB?.id);

    await db.run('INSERT INTO attendance (event_id, student_id, status, method, checked_in_at) VALUES (?, ?, ?, ?, ?)', [eventA.id, studentA.id, 'on-time', 'manual', '2026-02-10 08:05:00']);
    await db.run('INSERT INTO attendance (event_id, student_id, status, method, checked_in_at) VALUES (?, ?, ?, ?, ?)', [eventB.id, studentB.id, 'on-time', 'manual', '2026-02-10 08:05:00']);
  });

  it('scopes notifications so student-related alerts are only visible to the student department staff', async () => {
    await notif.createNotification({ type: 'correction-requested', title: 'Student A request', body: 'A', audience: 'all', departmentId: deptA.id, programId: progA?.id || null, dedupeKey: 'test:authz:notif:a' });
    await notif.createNotification({ type: 'correction-requested', title: 'Student B request', body: 'B', audience: 'all', departmentId: deptB.id, programId: progB?.id || null, dedupeKey: 'test:authz:notif:b' });

    const a = await request(app).get('/api/notifications').set('Authorization', `Bearer ${staffAToken}`);
    const b = await request(app).get('/api/notifications').set('Authorization', `Bearer ${staffBToken}`);
    const admin = await request(app).get('/api/notifications').set('Authorization', `Bearer ${adminToken}`);
    expect(a.status).toBe(200); expect(b.status).toBe(200); expect(admin.status).toBe(200);
    expect(a.body.items.map((n) => n.title)).toContain('Student A request');
    expect(a.body.items.map((n) => n.title)).not.toContain('Student B request');
    expect(b.body.items.map((n) => n.title)).toContain('Student B request');
    expect(b.body.items.map((n) => n.title)).not.toContain('Student A request');
    expect(admin.body.items.map((n) => n.title)).toEqual(expect.arrayContaining(['Student A request', 'Student B request']));
  });

  it('scopes correction queue and blocks cross-department correction actions by ID', async () => {
    const cA = await request(app).post('/api/corrections').send({ eventId: eventA.id, studentNo: studentA.studentNo, name: `${studentA.firstName} ${studentA.lastName}`, requestedStatus: 'present', reason: 'Present in class' });
    const cB = await request(app).post('/api/corrections').send({ eventId: eventB.id, studentNo: studentB.studentNo, name: `${studentB.firstName} ${studentB.lastName}`, requestedStatus: 'present', reason: 'Present in class' });
    expect(cA.status).toBe(201); expect(cB.status).toBe(201);

    const listA = await request(app).get('/api/corrections?status=all').set('Authorization', `Bearer ${staffAToken}`);
    const listB = await request(app).get('/api/corrections?status=all').set('Authorization', `Bearer ${staffBToken}`);
    expect(listA.status).toBe(200); expect(listB.status).toBe(200);
    const nosA = listA.body.rows.map((r) => r.studentNo);
    const nosB = listB.body.rows.map((r) => r.studentNo);
    expect(nosA).toContain(studentA.studentNo);
    expect(nosA).not.toContain(studentB.studentNo);
    expect(nosB).toContain(studentB.studentNo);
    expect(nosB).not.toContain(studentA.studentNo);

    const cross = await request(app).post(`/api/corrections/${cB.body.id}/approve`).set('Authorization', `Bearer ${staffAToken}`).send({});
    expect([403, 404]).toContain(cross.status);
  });

  it('scopes search, live board, and event/student access by department', async () => {
    const searchStudentA = await request(app).get('/api/search?q=Alpha').set('Authorization', `Bearer ${staffAToken}`);
    const searchEventA = await request(app).get('/api/search?q=Dept%20A%20Event').set('Authorization', `Bearer ${staffAToken}`);
    const searchStudentBFromA = await request(app).get('/api/search?q=Beta').set('Authorization', `Bearer ${staffAToken}`);
    const searchEventBFromA = await request(app).get('/api/search?q=Dept%20B%20Event').set('Authorization', `Bearer ${staffAToken}`);
    expect(searchStudentA.status).toBe(200);
    expect(searchEventA.status).toBe(200);
    expect(searchStudentA.body.students.some((s) => s.studentNo === studentA.studentNo)).toBe(true);
    expect(searchEventA.body.events.some((e) => e.id === eventA.id)).toBe(true);
    expect(searchStudentBFromA.body.students.some((s) => s.studentNo === studentB.studentNo)).toBe(false);
    expect(searchEventBFromA.body.events.some((e) => e.id === eventB.id)).toBe(false);

    const boardA = await request(app).get('/api/events/live-board').set('Authorization', `Bearer ${staffAToken}`);
    expect(boardA.status).toBe(200);
    const liveA = boardA.body.events.find((e) => e.id === eventA.id);
    expect(liveA).toBeTruthy();
    const scanNos = (liveA.board?.recentScans || []).map((s) => s.studentNo);
    expect(scanNos).toContain(studentA.studentNo);
    expect(scanNos).not.toContain(studentB.studentNo);

    const getOtherEvent = await request(app).get(`/api/events/${eventB.id}`).set('Authorization', `Bearer ${staffAToken}`);
    expect(getOtherEvent.status).toBe(404);
    const getOtherStudent = await request(app).get(`/api/students/${studentB.id}`).set('Authorization', `Bearer ${staffAToken}`);
    expect(getOtherStudent.status).toBe(404);
  });

  it('scopes dashboard briefing to visible students/events', async () => {
    const briefingA = await request(app).get('/api/dashboard/briefing').set('Authorization', `Bearer ${staffAToken}`);
    expect(briefingA.status).toBe(200);
    // Core scoping: briefing must not leak cross-department student/event data.
    const payload = JSON.stringify(briefingA.body);
    expect(payload).not.toContain(studentB.studentNo);
    expect(payload).not.toContain('Other Beta');
    const eventIds = (briefingA.body.todayEvents || []).map((e) => e.id);
    if (eventIds.length) {
      expect(eventIds).toContain(eventA.id);
      expect(eventIds).not.toContain(eventB.id);
    }
  });

  it('keeps unassigned staff unrestricted (legacy behavior)', async () => {
    const list = await request(app).get('/api/corrections?status=all').set('Authorization', `Bearer ${unassignedToken}`);
    expect(list.status).toBe(200);
    const nos = list.body.rows.map((r) => r.studentNo);
    expect(nos).toEqual(expect.arrayContaining([studentA.studentNo, studentB.studentNo]));
  });
});
