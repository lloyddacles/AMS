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
    doc.text(subtitle, 14, y);
    y += 6;
  }
  return y + 2;
}

function footer(doc) {
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const pages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(`Generated ${new Date().toLocaleString()}`, 14, height - 8);
    doc.text(`Page ${i} of ${pages}`, width - 14, height - 8, { align: 'right' });
  }
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
