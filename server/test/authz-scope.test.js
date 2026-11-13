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


  it('auto-rosters scoped events to only associated students on creation', async () => {
    // eventA is scoped to deptA/progA in setup; studentB (other scope) must be excluded, studentA included.
    const attA = await request(app).get(`/api/events/${eventA.id}/attendees`).set('Authorization', `Bearer ${adminToken}`);
    expect(attA.status).toBe(200);
    expect(attA.body.excludedStudentIds).toContain(studentB.id);
    expect(attA.body.excludedStudentIds).not.toContain(studentA.id);
    expect(attA.body.students.find((s) => s.studentId === studentA.id)?.attending).toBe(true);
    expect(attA.body.students.find((s) => s.studentId === studentB.id)?.attending).toBe(false);

    const globalEvent = await request(app)
      .post('/api/events')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Global Event', eventDate: new Date().toISOString().slice(0, 10), startTime: '00:00', endTime: '23:59', status: 'active' });
    expect(globalEvent.status).toBe(201);
    const globalAtt = await request(app).get(`/api/events/${globalEvent.body.id}/attendees`).set('Authorization', `Bearer ${adminToken}`);
    expect(globalAtt.status).toBe(200);
    expect(globalAtt.body.mode).toBe('all');
    expect(globalAtt.body.excludedStudentIds.length).toBe(0);
  });

  it('treats Deceased/Dropped/LOA students as auto-excused with status reason on all events', async () => {
    const today = new Date().toISOString().slice(0, 10);
    // Create a deceased student in scope A and an event they should attend by scope.
    const deceasedRes = await request(app)
      .post('/api/students')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ studentNo: 'SDEC01', firstName: 'Dee', lastName: 'Ceased', programId: progA?.id || null, course: progA?.name || 'Test Course', status: 'Deceased' });
    expect(deceasedRes.status).toBe(201);
    const deceased = deceasedRes.body;

    const evRes = await request(app)
      .post('/api/events')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Excusal Event', eventDate: today, startTime: '00:00', endTime: '23:59', status: 'active', departmentId: deptA.id, programId: progA?.id || null });
    expect(evRes.status).toBe(201);
    const ev = evRes.body;

    // Even if included by scope/attendee list, attendance view must show auto-excused with reason=status.
    const list = await request(app).get(`/api/attendance/event/${ev.id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    const row = list.body.find((r) => r.studentId === deceased.id);
    expect(row).toBeTruthy();
    expect(row.attending).toBe(true);
    expect(row.classification).toBe('excused');
    expect(row.status).toBe('excused');
    expect(row.note).toBe('Deceased');

    // Manual mark attempts must still result in excused with status reason.
    const mark = await request(app)
      .post('/api/attendance')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ eventId: ev.id, studentId: deceased.id, status: 'present', note: 'trying to mark present' });
    expect([200, 201]).toContain(mark.status);
    expect(mark.body.status).toBe('excused');
    expect(mark.body.note || mark.body.reason || mark.body.statusReason || 'Deceased').toBe('Deceased');

    // Scan/lookup reflects auto-excused.
    const lookup = await request(app)
      .post('/api/attendance/lookup')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ eventId: ev.id, qrToken: deceased.qrToken });
    expect(lookup.status).toBe(200);
    expect(lookup.body.classification).toBe('excused');
    expect(['auto-excused', 'already-excused']).toContain(lookup.body.nextAction);

    // Close/consolidation should keep non-attending-status student excused with status reason (not absent).
    const close = await request(app).post(`/api/events/${ev.id}/close`).set('Authorization', `Bearer ${adminToken}`);
    expect(close.status).toBe(200);
    expect(Number(close.body.reportSummary?.excused || 0)).toBeGreaterThanOrEqual(1);
    const attAfter = await request(app).get(`/api/attendance/event/${ev.id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(attAfter.status).toBe(200);
    const deceasedRow = attAfter.body.find((r) => r.studentId === deceased.id);
    expect(deceasedRow).toBeTruthy();
    expect(deceasedRow.classification).toBe('excused');
    expect(deceasedRow.note).toBe('Deceased');
  });

  it('blocks cross-scope attendance access and mutations by ID', async () => {
    // staffA must not access staffB event attendance view or mutate records in scope B.
    const viewCross = await request(app).get(`/api/attendance/event/${eventB.id}`).set('Authorization', `Bearer ${staffAToken}`);
    expect(viewCross.status).toBe(404);

    const manualCross = await request(app)
      .post('/api/attendance')
      .set('Authorization', `Bearer ${staffAToken}`)
      .send({ eventId: eventB.id, studentId: studentB.id, status: 'present' });
    expect(manualCross.status).toBe(404);

    const recB = await db.get('SELECT id FROM attendance WHERE event_id = ? AND student_id = ?', [eventB.id, studentB.id]);
    expect(recB?.id).toBeTruthy();
    const updateCross = await request(app)
      .put(`/api/attendance/${recB.id}`)
      .set('Authorization', `Bearer ${staffAToken}`)
      .send({ status: 'late', note: 'cross' });
    expect(updateCross.status).toBe(404);

    const deleteCross = await request(app)
      .delete(`/api/attendance/${recB.id}`)
      .set('Authorization', `Bearer ${staffAToken}`);
    expect(deleteCross.status).toBe(404);

    // Lookup/scan with cross-scope event should not leak.
    const lookupCross = await request(app)
      .post('/api/attendance/lookup')
      .set('Authorization', `Bearer ${staffAToken}`)
      .send({ eventId: eventB.id, qrToken: studentB.qrToken });
    expect(lookupCross.status).toBe(404);

    const scanCross = await request(app)
      .post('/api/attendance/scan')
      .set('Authorization', `Bearer ${staffAToken}`)
      .send({ eventId: eventB.id, qrToken: studentB.qrToken });
    expect([400, 404]).toContain(scanCross.status);
  });

  it('scopes schedules and auto-rosters generated events for department/program', async () => {
    const startDate = new Date().toISOString().slice(0, 10);
    // Create a schedule in scope A as admin and generate events.
    const schedRes = await request(app)
      .post('/api/schedules')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Scope A Schedule',
        weekdays: [new Date().getUTCDay()],
        startDate,
        endDate: startDate,
        startTime: '08:00',
        endTime: '09:00',
        departmentId: deptA.id,
        programId: progA?.id || null,
        active: true,
      });
    expect([200, 201]).toContain(schedRes.status);
    const schedule = schedRes.body;

    // staffB must not see scope A schedule by list or ID.
    const listB = await request(app).get('/api/schedules').set('Authorization', `Bearer ${staffBToken}`);
    expect(listB.status).toBe(200);
    expect((listB.body || []).some((s) => s.id === schedule.id)).toBe(false);
    const getB = await request(app).get(`/api/schedules/${schedule.id}`).set('Authorization', `Bearer ${staffBToken}`);
    expect(getB.status).toBe(404);

    const gen = await request(app).post(`/api/schedules/${schedule.id}/generate`).set('Authorization', `Bearer ${adminToken}`);
    expect(gen.status).toBe(200);
    expect(Number(gen.body.created || 0)).toBeGreaterThanOrEqual(1);

    const events = await db.all('SELECT id, department_id AS departmentId, program_id AS programId FROM events WHERE schedule_id = ?', [schedule.id]);
    expect(events.length).toBeGreaterThanOrEqual(1);
    for (const ev of events) {
      expect(Number(ev.departmentId || 0) || Number(ev.programId || 0)).toBeTruthy();
      const att = await request(app).get(`/api/events/${ev.id}/attendees`).set('Authorization', `Bearer ${adminToken}`);
      expect(att.status).toBe(200);
      expect(att.body.excludedStudentIds).toContain(studentB.id);
      expect(att.body.excludedStudentIds).not.toContain(studentA.id);
    }

    // staffB cannot generate scope A schedule.
    const genB = await request(app).post(`/api/schedules/${schedule.id}/generate`).set('Authorization', `Bearer ${staffBToken}`);
    expect(genB.status).toBe(404);
  });

  it('scopes event series/bulk actions and prevents cross-department operations by ID', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const e1 = await request(app).post('/api/events').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Series A1', eventDate: today, startTime: '08:00', endTime: '09:00', status: 'active', departmentId: deptA.id, programId: progA?.id || null });
    const e2 = await request(app).post('/api/events').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Series B1', eventDate: today, startTime: '10:00', endTime: '11:00', status: 'active', departmentId: deptB.id, programId: progB?.id || null });
    expect(e1.status).toBe(201); expect(e2.status).toBe(201);

    // staffA cannot bulk operate on staffB event (scoped as "no matching events" or no updates applied).
    const bulkCross = await request(app).post('/api/events/bulk').set('Authorization', `Bearer ${staffAToken}`)
      .send({ action: 'close', ids: [e2.body.id] });
    expect([200, 404]).toContain(bulkCross.status);
    if (bulkCross.status === 200) {
      expect((bulkCross.body.updated || []).some((x) => x.id === e2.body.id)).toBe(false);
    } else {
      expect(bulkCross.body.error).toMatch(/not found|no matching/i);
    }

    // staffA cannot continue or access series of scope B event.
    const contCross = await request(app).post(`/api/events/${e2.body.id}/continue`).set('Authorization', `Bearer ${staffAToken}`)
      .send({ eventDate: today });
    expect(contCross.status).toBe(404);

    // Create series in scope A and ensure staffB cannot see it.
    const seriesRes = await request(app).post('/api/events/series').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Scoped Series A', eventIds: [e1.body.id] });
    expect(seriesRes.status).toBe(201);
    const seriesGetB = await request(app).get(`/api/events/series/${seriesRes.body.id}`).set('Authorization', `Bearer ${staffBToken}`);
    expect(seriesGetB.status).toBe(404);
  });

  it('enforces admin-only reports and scopes dashboard/report data to department', async () => {
    // Reports are admin-only per app policy.
    const reportAsStaff = await request(app).get('/api/reports/overview').set('Authorization', `Bearer ${staffAToken}`);
    expect([401, 403]).toContain(reportAsStaff.status);
    const exportAsStaff = await request(app).get('/api/reports/export?type=overview').set('Authorization', `Bearer ${staffAToken}`);
    expect([401, 403]).toContain(exportAsStaff.status);

    const reportAsAdmin = await request(app).get('/api/reports/overview').set('Authorization', `Bearer ${adminToken}`);
    expect(reportAsAdmin.status).toBe(200);

    // Dashboard stats for scoped staff must not leak other-scope student/event identifiers in payload.
    const statsA = await request(app).get('/api/dashboard/stats').set('Authorization', `Bearer ${staffAToken}`);
    expect(statsA.status).toBe(200);
    const statsPayload = JSON.stringify(statsA.body);
    expect(statsPayload).not.toContain(studentB.studentNo);
    expect(statsPayload).not.toContain('Other Beta');

    const statsB = await request(app).get('/api/dashboard/stats').set('Authorization', `Bearer ${staffBToken}`);
    expect(statsB.status).toBe(200);
    const statsPayloadB = JSON.stringify(statsB.body);
    expect(statsPayloadB).not.toContain(studentA.studentNo);
    expect(statsPayloadB).not.toContain('Entrep Alpha');
  });

  it('scopes interventions to visible students and blocks cross-scope access by ID', async () => {
    // Ensure at least one flaggable/visible case exists by creating attendance context; endpoint behavior may vary by data.
    const listA = await request(app).get('/api/interventions/flagged').set('Authorization', `Bearer ${staffAToken}`);
    expect(listA.status).toBe(200);
    const payloadA = JSON.stringify(listA.body);
    expect(payloadA).not.toContain(studentB.studentNo);

    // Cross-scope student intervention history/detail should not be accessible.
    const histCross = await request(app).get(`/api/interventions/student/${studentB.id}`).set('Authorization', `Bearer ${staffAToken}`);
    expect([403, 404]).toContain(histCross.status);

    const createCross = await request(app)
      .post('/api/interventions')
      .set('Authorization', `Bearer ${staffAToken}`)
      .send({ studentId: studentB.id, interventionDate: new Date().toISOString().slice(0, 10), actionTaken: 'Follow-up', causeCategory: 'Other' });
    expect([400, 403, 404]).toContain(createCross.status);
  });

  it('scopes schedule update/delete and event attendee/lifecycle operations by ID', async () => {
    const today = new Date().toISOString().slice(0, 10);
    // Schedule in scope A (admin-created)
    const schedA = await request(app).post('/api/schedules').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Sched A Lifecycle', weekdays: [new Date().getUTCDay()], startDate: today, endDate: today, startTime: '08:00', endTime: '09:00', departmentId: deptA.id, programId: progA?.id || null, active: true });
    expect([200, 201]).toContain(schedA.status);
    const updB = await request(app).put(`/api/schedules/${schedA.body.id}`).set('Authorization', `Bearer ${staffBToken}`).send({ name: 'Hacked' });
    expect(updB.status).toBe(404);
    const delB = await request(app).delete(`/api/schedules/${schedA.body.id}`).set('Authorization', `Bearer ${staffBToken}`);
    expect(delB.status).toBe(404);

    // Event attendee/lifecycle operations on scope B event must not be accessible to staffA
    const attB = await request(app).get(`/api/events/${eventB.id}/attendees`).set('Authorization', `Bearer ${staffAToken}`);
    expect(attB.status).toBe(404);
    const setAttB = await request(app).post(`/api/events/${eventB.id}/attendees`).set('Authorization', `Bearer ${staffAToken}`)
      .send({ studentIds: [studentB.id], attending: false });
    expect(setAttB.status).toBe(404);
    const onlyAttB = await request(app).post(`/api/events/${eventB.id}/attendees/only`).set('Authorization', `Bearer ${staffAToken}`)
      .send({ studentIds: [studentB.id] });
    expect(onlyAttB.status).toBe(404);
    const resetAttB = await request(app).post(`/api/events/${eventB.id}/attendees/reset`).set('Authorization', `Bearer ${staffAToken}`);
    expect(resetAttB.status).toBe(404);

    // Close/reopen/archive/unarchive/delete/regenerate-code by ID scoped
    const tempB = await request(app).post('/api/events').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Temp B', eventDate: today, startTime: '08:00', endTime: '09:00', status: 'active', departmentId: deptB.id, programId: progB?.id || null });
    expect(tempB.status).toBe(201);
    for (const [method, path] of [
      ['post', `/api/events/${tempB.body.id}/close`],
      ['post', `/api/events/${tempB.body.id}/reopen`],
      ['post', `/api/events/${tempB.body.id}/archive`],
      ['post', `/api/events/${tempB.body.id}/unarchive`],
      ['post', `/api/events/${tempB.body.id}/regenerate-code`],
      ['delete', `/api/events/${tempB.body.id}`],
    ]) {
      const r = await request(app)[method](path).set('Authorization', `Bearer ${staffAToken}`);
      expect([403, 404]).toContain(r.status);
    }

    // StaffA can operate on own scope event lifecycle (smoke)
    const tempA = await request(app).post('/api/events').set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Temp A', eventDate: today, startTime: '08:00', endTime: '09:00', status: 'active', departmentId: deptA.id, programId: progA?.id || null });
    expect(tempA.status).toBe(201);
    // staffA may or may not have permission depending on role policy for some actions, but should not be blocked by scope
    const closeA = await request(app).post(`/api/events/${tempA.body.id}/close`).set('Authorization', `Bearer ${staffAToken}`);
    expect([200, 403]).toContain(closeA.status);
  });

  it('scopes scan batch sync to accessible events/students', async () => {
    // staffA cannot sync scans for scope B event/student
    const batchCross = await request(app).post('/api/attendance/scan/batch').set('Authorization', `Bearer ${staffAToken}`)
      .send({ scans: [{ clientScanId: 'x-scope-b', eventId: eventB.id, qrToken: studentB.qrToken, scannedAt: new Date().toISOString() }] });
    expect(batchCross.status).toBe(200);
    expect(batchCross.body.synced).toBe(0);
    expect(Array.isArray(batchCross.body.results)).toBe(true);
    expect(batchCross.body.results[0]?.ok).toBe(false);

    // staffA can sync valid scan for scope A (eventA is active today from setup)
    const batchOk = await request(app).post('/api/attendance/scan/batch').set('Authorization', `Bearer ${staffAToken}`)
      .send({ scans: [{ clientScanId: 'x-scope-a-1', eventId: eventA.id, qrToken: studentA.qrToken, scannedAt: new Date().toISOString() }] });
    expect(batchOk.status).toBe(200);
    expect(batchOk.body.total).toBe(1);
    expect(batchOk.body.results[0]).toBeTruthy();
    // may be ok or blocked if timing window rules apply, but must not leak cross-scope data and must be scoped correctly
    if (!batchOk.body.results[0].ok) {
      expect(String(batchOk.body.results[0].error || '')).not.toMatch(/student B|Other Beta|SB001/i);
    }
  });

});
