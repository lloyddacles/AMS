function avg(nums) {
  const list = nums.filter((n) => Number.isFinite(n));
  if (!list.length) return 0;
  return list.reduce((a, b) => a + b, 0) / list.length;
}

function byCourse(overview) {
  const map = new Map();
  for (const s of overview?.students || []) {
    const key = (s.course || 'Unspecified').trim() || 'Unspecified';
    if (!map.has(key)) map.set(key, { course: key, count: 0, rates: [], absences: 0, lates: 0, students: [] });
    const g = map.get(key);
    g.count += 1;
    g.rates.push(Number(s.rate) || 0);
    g.absences += Number(s.absent) || 0;
    g.lates += Number(s.late) || 0;
    g.students.push(s);
  }
  return [...map.values()]
    .map((g) => ({
      ...g,
      avgRate: Math.round(avg(g.rates)),
      below80: g.students.filter((s) => Number(s.rate) < 80).length,
    }))
    .sort((a, b) => a.avgRate - b.avgRate || b.count - a.count);
}

function trendDirection(points = []) {
  const rates = points.map((p) => Number(p.rate)).filter((n) => Number.isFinite(n));
  if (rates.length < 2) return { label: 'Not enough trend data', delta: 0, tone: 'neutral' };
  const mid = Math.ceil(rates.length / 2);
  const first = avg(rates.slice(0, mid));
  const last = avg(rates.slice(mid));
  const delta = Math.round(last - first);
  if (delta >= 5) return { label: 'Improving', delta, tone: 'positive' };
  if (delta <= -5) return { label: 'Declining', delta, tone: 'negative' };
  return { label: 'Stable', delta, tone: 'neutral' };
}

function confidenceMeta({ overview, trends, atRisk, compliance, riskModel }) {
  const events = Number(overview?.totalEvents || trends?.summary?.events || 0);
  const students = Number(overview?.students?.length || trends?.totalStudents || 0);
  const hasRisk = !!(riskModel?.students?.length || atRisk?.students?.some((s) => typeof s.risk === 'number'));
  let level = 'Low';
  let score = 35;
  const reasons = [];
  if (events >= 10) { score += 25; reasons.push(`${events} events provide a solid sample.`); }
  else if (events >= 4) { score += 15; reasons.push(`${events} events provide moderate context.`); }
  else if (events > 0) { score += 5; reasons.push(`Only ${events} event${events === 1 ? '' : 's'} recorded; insights may shift quickly.`); }
  else { reasons.push('No events in the selected range yet.'); }

  if (students >= 20) { score += 15; reasons.push(`${students} students included.`); }
  else if (students > 0) { score += 8; reasons.push(`${students} students included.`); }

  if (trends?.points?.length >= 3) { score += 10; reasons.push('Trend history is available for pattern detection.'); }
  if (hasRisk) { score += 10; reasons.push('Explainable risk scores are available for prioritization.'); }
  if (compliance?.eligible) { score += 5; reasons.push('Compliance context is available.'); }

  if (score >= 75) level = 'High';
  else if (score >= 55) level = 'Medium';
  return { level, score: Math.min(95, score), reasons };
}

function topRiskStudents(atRisk, riskModel) {
  const fromAtRisk = (atRisk?.students || []).map((s) => ({
    id: s.id,
    name: `${s.lastName || ''}, ${s.firstName || ''}`.replace(/^,\s*/, ''),
    studentNo: s.studentNo,
    course: s.course,
    rate: Number(s.rate) || 0,
    risk: typeof s.risk === 'number' ? s.risk : null,
    riskLevel: s.riskLevel || null,
    drivers: (s.drivers || []).slice(0, 2).map((d) => d.label || d.text).filter(Boolean),
    absent: Number(s.absent) || 0,
    late: Number(s.late) || 0,
  }));
  if (fromAtRisk.length) {
    return fromAtRisk
      .sort((a, b) => (b.risk ?? 0) - (a.risk ?? 0) || a.rate - b.rate)
      .slice(0, 5);
  }
  const list = riskModel?.students || [];
  return [...list]
    .sort((a, b) => (b.risk || 0) - (a.risk || 0))
    .slice(0, 5)
    .map((s) => ({
      id: s.id,
      name: `${s.lastName || ''}, ${s.firstName || ''}`.replace(/^,\s*/, ''),
      studentNo: s.studentNo,
      course: s.course,
      rate: s.raw?.total ? Math.round(((s.raw.total - s.raw.absent) / s.raw.total) * 100) : 0,
      risk: s.risk,
      riskLevel: s.riskLevel,
      drivers: (s.drivers || []).slice(0, 2).map((d) => d.label).filter(Boolean),
      absent: s.raw?.absent || 0,
      late: s.raw?.late || 0,
    }));
}

export function buildReportInsights({ overview, trends, atRisk, compliance, riskModel, filters = {} }) {
  const events = Number(overview?.totalEvents || trends?.summary?.events || compliance?.totalEvents || 0);
  const students = overview?.students || [];
  const avgRate = events && students.length ? Math.round(avg(students.map((s) => Number(s.rate) || 0))) : 0;
  const perfect = students.filter((s) => Number(s.rate) === 100).length;
  const criticalCount = students.filter((s) => Number(s.rate) < 60 && Number(s.expected || 0) > 0).length;
  const below80 = students.filter((s) => Number(s.rate) < 80 && Number(s.expected || 0) > 0).length;
  const highAbsence = [...students]
    .filter((s) => Number(s.expected || 0) > 0)
    .sort((a, b) => (Number(b.absent) || 0) - (Number(a.absent) || 0))
    .slice(0, 3);
  const lateHeavy = [...students]
    .filter((s) => Number(s.late) >= 2)
    .sort((a, b) => (Number(b.late) || 0) - (Number(a.late) || 0))
    .slice(0, 3);
  const courses = byCourse(overview).filter((c) => c.count > 0);
  const weakestCourse = courses.find((c) => c.count >= 2) || courses[0] || null;
  const td = trendDirection(trends?.points || []);
  const confidence = confidenceMeta({ overview, trends, atRisk, compliance, riskModel });
  const priorityStudents = topRiskStudents(atRisk, riskModel);
  const complianceGap = compliance?.eligible ? Number(compliance.below || 0) : null;

  const findings = [];
  if (events === 0) {
    findings.push({ tone: 'neutral', title: 'No attendance records in range', detail: 'There are no events/records for the selected filters, so insights are limited. Adjust the date range or term to analyze attendance.' });
  } else {
    findings.push({
      tone: avgRate >= 85 ? 'positive' : avgRate >= 70 ? 'warning' : 'critical',
      title: `Overall attendance is ${avgRate}%`,
      detail: `${students.length} student${students.length === 1 ? '' : 's'} across ${events} event${events === 1 ? '' : 's'}${filters.course ? ` in ${filters.course}` : ''}. ${perfect} student${perfect === 1 ? ' has' : 's have'} perfect attendance.`,
    });
  }

  if (trends?.points?.length) {
    findings.push({
      tone: td.tone === 'positive' ? 'positive' : td.tone === 'negative' ? 'critical' : 'neutral',
      title: `Attendance trend: ${td.label}`,
      detail: td.delta === 0
        ? 'Recent attendance rates are relatively stable compared to earlier periods in this range.'
        : `Recent periods are ${td.delta > 0 ? 'up' : 'down'} by about ${Math.abs(td.delta)} percentage points compared to earlier periods.`,
    });
  }

  if (weakestCourse && courses.length > 1) {
    findings.push({
      tone: weakestCourse.avgRate < 75 ? 'critical' : 'warning',
      title: `Lowest-performing group: ${weakestCourse.course}`,
      detail: `Average rate ${weakestCourse.avgRate}% across ${weakestCourse.count} students (${weakestCourse.below80} below 80%). Consider targeted follow-up for this group.`,
    });
  }

  if (below80 > 0 || criticalCount > 0) {
    findings.push({
      tone: criticalCount > 0 ? 'critical' : 'warning',
      title: `${below80} student${below80 === 1 ? '' : 's'} below 80% attendance`,
      detail: criticalCount > 0
        ? `${criticalCount} student${criticalCount === 1 ? ' is' : 's are'} below 60% and likely need immediate intervention.`
        : 'These students may benefit from early check-ins, reminders, or counseling before patterns worsen.',
    });
  }

  if (lateHeavy.length) {
    findings.push({
      tone: 'warning',
      title: 'Tardiness pattern detected',
      detail: `${lateHeavy.map((s) => `${s.lastName}, ${s.firstName} (${s.late} late)`).join('; ')}. Frequent lateness can become absence risk if unaddressed.`,
    });
  }

  if (complianceGap !== null) {
    findings.push({
      tone: complianceGap > 0 ? 'warning' : 'positive',
      title: complianceGap > 0 ? `${complianceGap} student${complianceGap === 1 ? '' : 's'} below compliance minimum` : 'All students meet compliance minimum',
      detail: complianceGap > 0
        ? `Minimum required: ${compliance.minimum}%. Review needed attendances and create a recovery plan before term end.`
        : `All included students are at or above ${compliance.minimum}% in the selected range.`,
    });
  }

  const actions = [];
  if (priorityStudents.length) {
    const names = priorityStudents.slice(0, 3).map((s) => s.name).join(', ');
    actions.push({
      priority: 'High',
      title: 'Prioritize outreach to highest-risk students',
      detail: `Start with: ${names}. Contact students/guardians, document barriers, and agree on a concrete attendance recovery plan.`,
      why: 'Targeting highest-risk cases first usually prevents further absences fastest.',
    });
  }
  if (td.tone === 'negative') {
    actions.push({
      priority: 'High',
      title: 'Respond to declining attendance trend',
      detail: 'Review recent event timing, communication, and conflicts. Send reminders before upcoming events and monitor next-period rates.',
      why: 'A downward trend indicates a systemic issue, not only isolated student cases.',
    });
  }
  if (weakestCourse && weakestCourse.avgRate < 80) {
    actions.push({
      priority: 'Medium',
      title: `Run a focused intervention for ${weakestCourse.course}`,
      detail: `Coordinate with class advisers/instructors for ${weakestCourse.course} to address common causes and track weekly improvement.`,
      why: 'Group-level interventions are efficient when one cohort underperforms.',
    });
  }
  if (lateHeavy.length) {
    actions.push({
      priority: 'Medium',
      title: 'Address repeated lateness early',
      detail: 'Clarify start times/check-in windows, share expectations, and follow up with frequently late students before absences increase.',
      why: 'Lateness is often an early warning signal for disengagement or scheduling issues.',
    });
  }
  if (complianceGap > 0) {
    actions.push({
      priority: 'High',
      title: 'Create compliance recovery plans',
      detail: 'Use the Compliance view “Needed” counts to set achievable targets per student and monitor progress each event.',
      why: 'Students need a clear, numeric path to reach the minimum attendance requirement.',
    });
  }
  if (!actions.length) {
    actions.push({
      priority: 'Low',
      title: 'Maintain current attendance practices',
      detail: 'Attendance is healthy in this range. Continue monitoring trends and recognize consistently present students.',
      why: 'Positive reinforcement and ongoing monitoring help sustain strong attendance.',
    });
  }

  const headline = events === 0
    ? 'No attendance data available for AI analysis in this range'
    : avgRate >= 85
      ? 'Attendance is strong overall, with targeted follow-up opportunities'
      : avgRate >= 70
        ? 'Attendance is moderate — focused interventions can improve outcomes'
        : 'Attendance needs attention — prioritize at-risk students and recovery actions';

  const summary = events === 0
    ? 'Select a term/date range with recorded events to generate evidence-based insights and recommended decisions.'
    : `Based on ${events} event${events === 1 ? '' : 's'} and ${students.length} student${students.length === 1 ? '' : 's'}, average attendance is ${avgRate}%. ${priorityStudents.length ? `${priorityStudents.length} priority student${priorityStudents.length === 1 ? '' : 's'} identified for follow-up.` : 'No critical risk concentration detected.'} ${td.label !== 'Not enough trend data' ? `Trend appears ${td.label.toLowerCase()}.` : ''}`;

  return {
    generatedAt: new Date().toISOString(),
    headline,
    summary,
    confidence,
    metrics: {
      events,
      students: students.length,
      avgRate,
      perfect,
      below80,
      criticalCount,
      complianceGap,
      trend: td,
    },
    findings: findings.slice(0, 6),
    priorityStudents,
    actions: actions.slice(0, 5),
    groups: courses.slice(0, 5),
    notable: { highAbsence, lateHeavy },
  };
}
