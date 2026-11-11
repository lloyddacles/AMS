import { all } from '../db.js';
import { todayInTz, eventPhase, formatTzTime, eventStart, displayStatus } from '../classify.js';
import { buildOverview, buildAtRisk, buildCompliance } from './reports.js';
import { buildRiskModel } from './risk.js';
import { exclusionsByEvent } from './roster.js';

function nameOf(s) {
  return `${s.lastName || ''}, ${s.firstName || ''}`.replace(/^,\s*/, '').trim() || s.studentNo || 'Student';
}

function confidenceFromEvidence(events, riskScore) {
  if (events >= 8 || riskScore >= 75) return 'High';
  if (events >= 4 || riskScore >= 50) return 'Medium';
  return 'Low';
}

export async function buildDailyBriefing() {
  const today = todayInTz();
  const now = new Date();

  const [overview, atRisk, compliance, riskModel, todayEventsRaw] = await Promise.all([
    buildOverview({}).catch(() => ({ totalEvents: 0, students: [] })),
    buildAtRisk({}).catch(() => ({ threshold: 75, minEvents: 3, totalEvents: 0, students: [], model: null })),
    buildCompliance({}).catch(() => ({ eligible: false, below: 0, minimum: 75, students: [], totalStudents: 0, totalEvents: 0 })),
    buildRiskModel().catch(() => ({ totalEvents: 0, context: null, byStudent: new Map(), students: [] })),
    all(
      `SELECT e.id, e.name, e.event_date AS eventDate, e.start_time AS startTime, e.end_time AS endTime,
              e.location, e.status, e.archived,
              (SELECT COUNT(*) FROM attendance a
                WHERE a.event_id = e.id AND a.status IN ('early','on-time','late','present')
                  AND NOT EXISTS (SELECT 1 FROM event_exclusions x WHERE x.event_id = a.event_id AND x.student_id = a.student_id)
              ) AS attended,
              (SELECT COUNT(*) FROM students) - (SELECT COUNT(*) FROM event_exclusions x WHERE x.event_id = e.id) AS expected
       FROM events e
       WHERE e.event_date = ? AND e.archived = 0
       ORDER BY e.start_time ASC, e.id ASC`,
      [today]
    ),
  ]);

  const todayEventIds = todayEventsRaw.map((e) => e.id);
  let records = [];
  if (todayEventIds.length) {
    records = await all(
      `SELECT event_id AS eventId, student_id AS studentId, status, method, checked_in_at AS checkedInAt
       FROM attendance WHERE event_id IN (${todayEventIds.map(() => '?').join(',')})`,
      todayEventIds
    );
  }
  const excluded = await exclusionsByEvent(todayEventIds);
  const byEventRecords = new Map();
  for (const r of records) {
    if (!byEventRecords.has(r.eventId)) byEventRecords.set(r.eventId, []);
    byEventRecords.get(r.eventId).push(r);
  }

  const todayEvents = todayEventsRaw.map((e) => {
    const phase = eventPhase(e, now);
    const expected = Math.max(0, Number(e.expected || 0));
    const attended = Math.max(0, Number(e.attended || 0));
    const ex = excluded.get(e.id) || new Set();
    const recs = byEventRecords.get(e.id) || [];
    let late = 0;
    let excused = 0;
    for (const r of recs) {
      if (ex.has(r.studentId)) continue;
      const cls = displayStatus(e, r);
      if (cls === 'late') late += 1;
      if (cls === 'excused') excused += 1;
    }
    const remaining = Math.max(0, expected - attended - excused);
    const rate = expected ? Math.round((attended / expected) * 100) : 0;
    return {
      id: e.id,
      name: e.name,
      eventDate: e.eventDate,
      startTime: e.startTime || null,
      endTime: e.endTime || null,
      location: e.location || '',
      status: e.status,
      phase,
      expected,
      attended,
      late,
      excused,
      remaining,
      rate,
      startsAtLabel: formatTzTime(eventStart(e)),
    };
  });

  const openEvents = todayEvents.filter((e) => e.phase === 'active').length;
  const upcomingEvents = todayEvents.filter((e) => e.phase === 'upcoming').length;
  const closedEvents = todayEvents.filter((e) => e.phase === 'closed').length;
  const expectedToday = todayEvents.reduce((a, e) => a + e.expected, 0);
  const checkedInToday = todayEvents.reduce((a, e) => a + e.attended, 0);
  const remainingToday = todayEvents
    .filter((e) => e.phase !== 'closed')
    .reduce((a, e) => a + e.remaining, 0);

  const riskById = riskModel.byStudent || new Map();
  const overviewById = new Map((overview.students || []).map((s) => [s.id, s]));

  // Watchlist: students likely to be absent/late today based on historical patterns.
  const watchlist = (riskModel.students || [])
    .map((s) => {
      const ov = overviewById.get(s.id) || {};
      const recentMiss = Number(s.raw?.recentMiss || 0);
      const recentTotal = Number(s.raw?.recentTotal || 0);
      const streak = Number(s.raw?.streak || 0);
      const late = Number(s.raw?.late || 0);
      const absent = Number(s.raw?.absent || 0);
      const reasons = [];
      if (streak >= 2) reasons.push(`${streak} consecutive absences`);
      if (recentTotal > 0 && recentMiss >= 2) reasons.push(`${recentMiss}/${recentTotal} recent absences`);
      if (late >= 3) reasons.push(`${late} late records`);
      if (absent >= 3 && streak < 2) reasons.push(`${absent} total absences`);
      const driver = (s.drivers || []).find((d) => d.contribution > 0);
      if (!reasons.length && driver) reasons.push(driver.label || 'Attendance risk pattern');
      const likelihood = s.risk >= 75 || streak >= 3 || recentMiss >= 2 ? 'High' : s.risk >= 45 ? 'Medium' : 'Low';
      return {
        studentId: s.id,
        name: nameOf(s),
        studentNo: s.studentNo,
        course: s.course || '',
        risk: s.risk,
        riskLevel: s.riskLevel,
        likelihood,
        rate: Number(ov.rate || 0),
        absent,
        late,
        streak,
        recentMiss,
        reasons,
        confidence: confidenceFromEvidence(Number(s.raw?.total || ov.expected || 0), s.risk),
      };
    })
    .filter((s) => s.likelihood !== 'Low' || s.risk >= 40)
    .sort((a, b) => b.risk - a.risk || b.absent - a.absent || b.late - a.late)
    .slice(0, 8);

  // Intervention queue: evidence-based actions for teacher follow-up.
  const queueMap = new Map();
  function upsert(item) {
    const prev = queueMap.get(item.studentId);
    if (!prev) {
      queueMap.set(item.studentId, item);
      return;
    }
    const rank = { High: 3, Medium: 2, Low: 1 };
    if ((rank[item.priority] || 0) > (rank[prev.priority] || 0)) {
      prev.priority = item.priority;
      prev.action = item.action;
      prev.title = item.title;
    }
    if (item.risk > (prev.risk || 0)) prev.risk = item.risk;
    prev.reasons = [...new Set([...(prev.reasons || []), ...(item.reasons || [])])].slice(0, 4);
    prev.confidence = (rank[item.confidence] || 0) > (rank[prev.confidence] || 0) ? item.confidence : prev.confidence;
  }

  for (const s of atRisk.students || []) {
    const r = riskById.get(s.id);
    const risk = typeof s.risk === 'number' ? s.risk : (r?.risk || 0);
    const reasons = [];
    if (Number(s.absent || 0) > 0) reasons.push(`${s.absent} absences`);
    if (Number(s.late || 0) > 0) reasons.push(`${s.late} late`);
    if (r?.raw?.streak >= 2) reasons.push(`${r.raw.streak}-day absence streak`);
    const topDriver = (s.drivers || r?.drivers || []).find((d) => d.contribution > 0);
    if (topDriver) reasons.push(topDriver.label);
    upsert({
      studentId: s.id,
      name: nameOf(s),
      studentNo: s.studentNo,
      course: s.course || '',
      rate: Number(s.rate || 0),
      risk,
      riskLevel: s.riskLevel || r?.riskLevel || 'moderate',
      priority: risk >= 70 || Number(s.rate || 0) < 60 ? 'High' : 'Medium',
      title: 'At-risk attendance follow-up',
      action: risk >= 70
        ? 'Contact the student/guardian today, identify barriers, and agree on an immediate attendance recovery plan.'
        : 'Check in with the student, remind them of upcoming sessions, and monitor attendance closely.',
      reasons: reasons.slice(0, 3),
      confidence: confidenceFromEvidence(Number(s.expected || r?.raw?.total || 0), risk),
      category: 'at-risk',
    });
  }

  if (compliance.eligible) {
    for (const s of compliance.students || []) {
      const r = riskById.get(s.id);
      const risk = r?.risk || 0;
      upsert({
        studentId: s.id,
        name: nameOf(s),
        studentNo: s.studentNo,
        course: s.course || '',
        rate: Number(s.rate || 0),
        risk,
        riskLevel: r?.riskLevel || 'moderate',
        priority: Number(s.needed || 0) >= 3 || Number(s.rate || 0) < compliance.minimum - 10 ? 'High' : 'Medium',
        title: 'Compliance recovery needed',
        action: `Student needs ${s.needed} more attended event(s) to reach ${compliance.minimum}%. Set a clear recovery target and track each upcoming event.`,
        reasons: [`Below ${compliance.minimum}% compliance`, `${s.needed} attendance(s) needed`],
        confidence: confidenceFromEvidence(Number(s.expected || r?.raw?.total || 0), risk),
        category: 'compliance',
      });
    }
  }

  for (const w of watchlist.filter((s) => s.streak >= 2 || s.recentMiss >= 2)) {
    upsert({
      studentId: w.studentId,
      name: w.name,
      studentNo: w.studentNo,
      course: w.course || '',
      rate: w.rate,
      risk: w.risk,
      riskLevel: w.riskLevel,
      priority: w.streak >= 3 || w.risk >= 75 ? 'High' : 'Medium',
      title: 'Worsening attendance pattern',
      action: 'Intervene early: ask about recent barriers, provide support/reminders, and confirm attendance for the next event.',
      reasons: w.reasons.slice(0, 3),
      confidence: w.confidence,
      category: 'pattern',
    });
  }

  const interventionQueue = [...queueMap.values()]
    .sort((a, b) => ({ High: 3, Medium: 2, Low: 1 }[b.priority] - { High: 3, Medium: 2, Low: 1 }[a.priority] || b.risk - a.risk || a.rate - b.rate))
    .slice(0, 10);

  const avgRate = (overview.students || []).length
    ? Math.round((overview.students || []).reduce((sum, s) => sum + (Number(s.rate) || 0), 0) / overview.students.length)
    : 0;

  const focus = [];
  if (todayEvents.length === 0) focus.push('No events scheduled today. Use this time to follow up on at-risk students and review attendance trends.');
  else if (openEvents > 0) focus.push(`${openEvents} event${openEvents === 1 ? ' is' : 's are'} open now. Monitor live check-ins and be ready to assist late arrivals.`);
  else if (upcomingEvents > 0) focus.push(`${upcomingEvents} upcoming event${upcomingEvents === 1 ? '' : 's'} today. Prepare attendance materials and consider reminders for likely absentees.`);
  else focus.push('Today’s events are closed. Review outcomes and follow up with absent or late students.');

  if (interventionQueue.length) {
    const high = interventionQueue.filter((i) => i.priority === 'High').length;
    focus.push(high > 0
      ? `${interventionQueue.length} student${interventionQueue.length === 1 ? '' : 's'} need follow-up (${high} high priority).`
      : `${interventionQueue.length} student${interventionQueue.length === 1 ? '' : 's'} may benefit from early follow-up.`);
  } else {
    focus.push('No urgent intervention cases detected from current data.');
  }

  return {
    generatedAt: new Date().toISOString(),
    today,
    summary: {
      averageRate: avgRate,
      totalStudents: (overview.students || []).length,
      totalEvents: overview.totalEvents || 0,
      todayEvents: todayEvents.length,
      openEvents,
      upcomingEvents,
      closedEvents,
      expectedToday,
      checkedInToday,
      remainingToday,
      interventions: interventionQueue.length,
      highPriorityInterventions: interventionQueue.filter((i) => i.priority === 'High').length,
      watchlistCount: watchlist.length,
      atRiskThreshold: atRisk.threshold,
    },
    todayEvents,
    watchlist,
    interventionQueue,
    focus,
    confidence: {
      level: (overview.totalEvents || 0) >= 6 ? 'High' : (overview.totalEvents || 0) >= 3 ? 'Medium' : 'Low',
      note: 'Recommendations are based on recorded attendance history, risk patterns, and today’s schedule. Review student context before taking formal action.',
    },
  };
}
