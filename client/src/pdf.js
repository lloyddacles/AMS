import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const BRAND = 'AttendX';
const PRIMARY = [37, 99, 235];
const MUTED = [100, 116, 139];

function classificationLabel(cls) {
  if (!cls) return 'Pending';
  return cls.charAt(0).toUpperCase() + cls.slice(1);
}

function fmtTime(sqliteUtc) {
  if (!sqliteUtc) return '—';
  try {
    return new Date(String(sqliteUtc).replace(' ', 'T') + 'Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
}

function header(doc, title, subtitle) {
  const width = doc.internal.pageSize.getWidth();
  doc.setFillColor(...PRIMARY);
  doc.rect(0, 0, width, 22, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(BRAND, 14, 14);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text('Attendance Report', width - 14, 14, { align: 'right' });

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(title, 14, 34);

  let y = 40;
  if (subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...MUTED);
    const lines = doc.splitTextToSize(subtitle, width - 28);
    doc.text(lines, 14, y);
    y += lines.length * 5;
  }
  return y + 2;
}

function footer(doc, { preparedBy } = {}) {
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    const left = preparedBy ? `Prepared by: ${preparedBy}  ·  Generated ${new Date().toLocaleString()}` : `Generated ${new Date().toLocaleString()}`;
    const leftLines = doc.splitTextToSize(left, width - 60);
    doc.text(leftLines, 14, height - 10);
    doc.text(`Page ${i} of ${pages}`, width - 14, height - 8, { align: 'right' });
  }
}

function ensureSpace(doc, y, needed = 20) {
  const height = doc.internal.pageSize.getHeight();
  if (y + needed > height - 18) {
    doc.addPage();
    return 18;
  }
  return y;
}

function sectionTitle(doc, y, text) {
  y = ensureSpace(doc, y, 12);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42);
  doc.text(text, 14, y);
  return y + 5;
}

function writeParagraph(doc, y, text, opts = {}) {
  const width = doc.internal.pageSize.getWidth();
  const fontSize = opts.fontSize || 9;
  const color = opts.color || [51, 65, 85];
  doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
  doc.setFontSize(fontSize);
  doc.setTextColor(...color);
  const lines = doc.splitTextToSize(text || '', width - 28);
  const lineHeight = fontSize * 0.45 + 1.2;
  for (const line of lines) {
    y = ensureSpace(doc, y, lineHeight + 2);
    doc.text(line, 14, y);
    y += lineHeight;
  }
  return y + 1;
}

export function exportEventPdf(event, rows, summary) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const meta = [
    event.eventDate,
    event.startTime ? `${event.startTime}${event.endTime ? `–${event.endTime}` : ''}` : null,
    event.location,
  ].filter(Boolean).join('  ·  ');
  let y = header(doc, event.name, meta);

  if (summary) {
    const stats = [
      ['Attended', `${summary.attended}/${summary.totalStudents}`],
      ['Rate', `${summary.rate}%`],
      ['Early', summary.early],
      ['On-time', summary.onTime],
      ['Late', summary.late],
      ['Excused', summary.excused],
      ['Absent', summary.absent],
    ];
    autoTable(doc, {
      startY: y,
      body: [stats.map(([k, v]) => `${k}: ${v}`)],
      theme: 'plain',
      styles: { fontSize: 9, textColor: [51, 65, 85], cellPadding: 1 },
      columnStyles: Object.fromEntries(stats.map((_, i) => [i, { halign: 'left' }])),
      margin: { left: 14, right: 14 },
    });
    y = doc.lastAutoTable.finalY + 4;
  }

  autoTable(doc, {
    startY: y,
    head: [['Student No', 'Name', 'Course', 'Status', 'Method', 'Time In', 'Time Out']],
    body: rows.map((r) => [
      r.studentNo,
      `${r.lastName}, ${r.firstName}`,
      r.course || '—',
      r.attending === false ? 'Not attending' : classificationLabel(r.classification),
      r.method || '—',
      fmtTime(r.checkedInAt),
      fmtTime(r.checkedOutAt),
    ]),
    theme: 'grid',
    headStyles: { fillColor: PRIMARY, fontSize: 9 },
    styles: { fontSize: 8, cellPadding: 1.6 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 14, right: 14 },
  });

  footer(doc);
  const safe = event.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  doc.save(`attendance-${safe}-${event.eventDate}.pdf`);
}

export function exportAtRiskPdf(students, threshold, totalEvents) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = header(
    doc,
    'At-Risk Students',
    `Below ${threshold}% attendance  ·  ${students.length} student${students.length === 1 ? '' : 's'}  ·  ${totalEvents} event${totalEvents === 1 ? '' : 's'}`
  );

  autoTable(doc, {
    startY: y,
    head: [['Student No', 'Name', 'Course', 'Year', 'Attended', 'Absent', 'Excused', 'Rate']],
    body: students.map((s) => [
      s.studentNo,
      `${s.lastName}, ${s.firstName}`,
      s.course || '—',
      s.yearLevel || '—',
      s.attended,
      s.absent,
      s.excused,
      `${s.rate}%`,
    ]),
    theme: 'grid',
    headStyles: { fillColor: [220, 38, 38], fontSize: 8 },
    styles: { fontSize: 8, cellPadding: 1.4, halign: 'center' },
    columnStyles: {
      0: { halign: 'left' },
      1: { halign: 'left' },
      2: { halign: 'left' },
      3: { halign: 'left' },
    },
    alternateRowStyles: { fillColor: [254, 242, 242] },
    margin: { left: 14, right: 14 },
  });

  footer(doc);
  doc.save('at-risk-students.pdf');
}

export function exportSummaryPdf(students, totalEvents) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = header(doc, 'Student Attendance Summary', `${totalEvents} event${totalEvents === 1 ? '' : 's'} total`);

  autoTable(doc, {
    startY: y,
    head: [['Student No', 'Name', 'Course', 'Early', 'On-time', 'Late', 'Excused', 'Absent', 'Rate']],
    body: students.map((s) => [
      s.studentNo,
      `${s.lastName}, ${s.firstName}`,
      s.course || '—',
      s.early,
      s.onTime,
      s.late,
      s.excused,
      s.absent,
      `${s.rate}%`,
    ]),
    theme: 'grid',
    headStyles: { fillColor: PRIMARY, fontSize: 8 },
    styles: { fontSize: 8, cellPadding: 1.4, halign: 'center' },
    columnStyles: {
      0: { halign: 'left' },
      1: { halign: 'left' },
      2: { halign: 'left' },
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 14, right: 14 },
  });

  footer(doc);
  doc.save('student-attendance-summary.pdf');
}

export function exportComprehensiveReportPdf({
  overview,
  insights,
  trends,
  atRisk,
  compliance,
  filters = {},
  preparedBy = '—',
  viewLabel = 'Reports',
}) {
  const students = overview?.students || [];
  const totalEvents = Number(overview?.totalEvents || 0);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });

  const contextParts = [
    filters.termName ? `Term: ${filters.termName}` : null,
    filters.course ? `Course: ${filters.course}` : null,
    filters.search ? `Search: ${filters.search}` : null,
    filters.from || filters.to ? `Date range: ${filters.from || '—'} to ${filters.to || '—'}` : 'Date range: All time',
    `View context: ${viewLabel}`,
  ].filter(Boolean);

  let y = header(doc, 'Comprehensive Attendance Report', contextParts.join('  ·  '));

  y = sectionTitle(doc, y, 'Report Information');
  autoTable(doc, {
    startY: y,
    theme: 'plain',
    styles: { fontSize: 9, cellPadding: 1.2, textColor: [51, 65, 85] },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 38 }, 1: { cellWidth: 140 } },
    body: [
      ['Prepared by', preparedBy || '—'],
      ['Generated on', new Date().toLocaleString()],
      ['Report coverage', `${students.length} student${students.length === 1 ? '' : 's'} · ${totalEvents} event${totalEvents === 1 ? '' : 's'}`],
      ['AI confidence', insights ? `${insights.confidence?.level || '—'} (${insights.confidence?.score ?? '—'}/100)` : '—'],
    ],
    margin: { left: 14, right: 14 },
  });
  y = doc.lastAutoTable.finalY + 4;

  y = sectionTitle(doc, y, 'AI Disclosure');
  y = writeParagraph(
    doc,
    y,
    'AI Disclosure: This report is monitored by AI. AI-assisted attendance insights are used to summarize available attendance, trend, risk, and compliance data, highlight patterns, and recommend possible actions for teachers. These AI-generated insights are advisory and should be reviewed alongside professional judgment, school policies, and the actual student context before making formal decisions.',
    { fontSize: 9, color: [30, 41, 59] }
  );

  if (insights) {
    y = sectionTitle(doc, y, 'Executive Summary & AI Insights');
    y = writeParagraph(doc, y, insights.headline || 'Attendance insights summary', { bold: true, fontSize: 10, color: [15, 23, 42] });
    y = writeParagraph(doc, y, insights.summary || '', { fontSize: 9 });
    if (insights.confidence?.reasons?.length) {
      y = writeParagraph(doc, y, `Confidence notes: ${insights.confidence.reasons.join(' ')}`, { fontSize: 8.5, color: MUTED });
    }

    if (insights.findings?.length) {
      y = sectionTitle(doc, y, 'Key Findings');
      autoTable(doc, {
        startY: y,
        head: [['Finding', 'Details']],
        body: insights.findings.map((f) => [f.title || '—', f.detail || '—']),
        theme: 'grid',
        headStyles: { fillColor: PRIMARY, fontSize: 8.5 },
        styles: { fontSize: 8.2, cellPadding: 2, valign: 'top' },
        columnStyles: { 0: { cellWidth: 55, fontStyle: 'bold' }, 1: { cellWidth: 123 } },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        margin: { left: 14, right: 14 },
      });
      y = doc.lastAutoTable.finalY + 4;
    }

    if (insights.actions?.length) {
      y = sectionTitle(doc, y, 'Recommended Decisions & Actions');
      autoTable(doc, {
        startY: y,
        head: [['Priority', 'Action', 'Rationale']],
        body: insights.actions.map((a) => [a.priority || '—', `${a.title || ''}\n${a.detail || ''}`.trim(), a.why || '—']),
        theme: 'grid',
        headStyles: { fillColor: [30, 64, 175], fontSize: 8.5 },
        styles: { fontSize: 8.1, cellPadding: 2, valign: 'top' },
        columnStyles: { 0: { cellWidth: 20, fontStyle: 'bold' }, 1: { cellWidth: 95 }, 2: { cellWidth: 63 } },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        margin: { left: 14, right: 14 },
      });
      y = doc.lastAutoTable.finalY + 4;
    }

    if (insights.priorityStudents?.length) {
      y = sectionTitle(doc, y, 'Priority Students for Follow-up');
      autoTable(doc, {
        startY: y,
        head: [['Student', 'Course', 'Rate', 'Risk', 'Notes']],
        body: insights.priorityStudents.map((s) => [
          `${s.name || '—'}${s.studentNo ? ` (${s.studentNo})` : ''}`,
          s.course || '—',
          `${s.rate ?? 0}%`,
          typeof s.risk === 'number' ? `${s.risk}% ${s.riskLevel || ''}`.trim() : '—',
          [s.drivers?.length ? `Drivers: ${s.drivers.join(', ')}` : '', `Absent: ${s.absent ?? 0}`, `Late: ${s.late ?? 0}`].filter(Boolean).join(' · '),
        ]),
        theme: 'grid',
        headStyles: { fillColor: [180, 83, 9], fontSize: 8.5 },
        styles: { fontSize: 8.1, cellPadding: 2, valign: 'top' },
        columnStyles: { 0: { cellWidth: 50 }, 1: { cellWidth: 28 }, 2: { cellWidth: 16, halign: 'center' }, 3: { cellWidth: 24, halign: 'center' }, 4: { cellWidth: 60 } },
        alternateRowStyles: { fillColor: [255, 251, 235] },
        margin: { left: 14, right: 14 },
      });
      y = doc.lastAutoTable.finalY + 4;
    }

    if (insights.groups?.length) {
      y = sectionTitle(doc, y, 'Group / Course Highlights');
      autoTable(doc, {
        startY: y,
        head: [['Group/Course', 'Students', 'Avg Rate', 'Below 80%']],
        body: insights.groups.map((g) => [g.course || '—', g.count ?? 0, `${g.avgRate ?? 0}%`, g.below80 ?? 0]),
        theme: 'grid',
        headStyles: { fillColor: [71, 85, 105], fontSize: 8.5 },
        styles: { fontSize: 8.2, cellPadding: 2, halign: 'center' },
        columnStyles: { 0: { halign: 'left', cellWidth: 80 } },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        margin: { left: 14, right: 14 },
      });
      y = doc.lastAutoTable.finalY + 4;
    }
  }

  const trendSummary = trends?.summary;
  const complianceSummary = compliance && compliance.eligible ? compliance : null;
  const atRiskSummary = atRisk || null;

  y = sectionTitle(doc, y, 'Attendance Summary Metrics');
  const metricRows = [
    ['Students (in scope)', students.length],
    ['Events (in range)', totalEvents],
    ['Average attendance rate', insights ? `${insights.metrics?.avgRate ?? 0}%` : '—'],
    ['Perfect attendance', insights ? insights.metrics?.perfect ?? 0 : '—'],
    ['Below 80% attendance', insights ? insights.metrics?.below80 ?? 0 : '—'],
  ];
  if (trendSummary) {
    metricRows.push(['Trend periods/events analyzed', trends.points?.length || 0]);
    metricRows.push(['Trend attendance rate', `${trendSummary.rate ?? 0}%`]);
    metricRows.push(['Trend present / absent / excused', `${trendSummary.present ?? 0} / ${trendSummary.absent ?? 0} / ${trendSummary.excused ?? 0}`]);
  }
  if (atRiskSummary) {
    metricRows.push(['At-risk threshold', `${atRiskSummary.threshold ?? '—'}%`]);
    metricRows.push(['At-risk students', atRiskSummary.students?.length ?? 0]);
  }
  if (complianceSummary) {
    metricRows.push(['Compliance minimum', `${complianceSummary.minimum ?? '—'}%`]);
    metricRows.push(['Non-compliant students', complianceSummary.below ?? 0]);
  }
  autoTable(doc, {
    startY: y,
    theme: 'grid',
    head: [['Metric', 'Value']],
    body: metricRows,
    headStyles: { fillColor: PRIMARY, fontSize: 8.5 },
    styles: { fontSize: 8.3, cellPadding: 2 },
    columnStyles: { 0: { cellWidth: 90, fontStyle: 'bold' }, 1: { cellWidth: 88 } },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 14, right: 14 },
  });
  y = doc.lastAutoTable.finalY + 4;

  y = sectionTitle(doc, y, 'Student Attendance Details');
  autoTable(doc, {
    startY: y,
    head: [['Student No', 'Name', 'Course', 'Early', 'On-time', 'Late', 'Excused', 'Absent', 'Attended/Expected', 'Rate']],
    body: students.map((s) => [
      s.studentNo || '—',
      `${s.lastName || ''}, ${s.firstName || ''}`.replace(/^,\s*/, '') || '—',
      s.course || '—',
      s.early ?? 0,
      s.onTime ?? 0,
      s.late ?? 0,
      s.excused ?? 0,
      s.absent ?? 0,
      `${s.attended ?? 0}/${s.expected ?? 0}`,
      `${s.rate ?? 0}%`,
    ]),
    theme: 'grid',
    headStyles: { fillColor: [15, 23, 42], fontSize: 7.6 },
    styles: { fontSize: 7.4, cellPadding: 1.4, halign: 'center' },
    columnStyles: {
      0: { halign: 'left', cellWidth: 22 },
      1: { halign: 'left', cellWidth: 38 },
      2: { halign: 'left', cellWidth: 24 },
      8: { cellWidth: 24 },
      9: { cellWidth: 14 },
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 10, right: 10 },
  });
  y = doc.lastAutoTable.finalY + 8;

  y = ensureSpace(doc, y, 30);
  doc.setDrawColor(203, 213, 225);
  doc.line(14, y, 90, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(51, 65, 85);
  doc.text(`Prepared by: ${preparedBy || '—'}`, 14, y + 6);
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text('Signature / Date: ____________________________', 14, y + 12);

  footer(doc, { preparedBy });
  const datePart = new Date().toISOString().slice(0, 10);
  doc.save(`attendance-comprehensive-report-${datePart}.pdf`);
}
