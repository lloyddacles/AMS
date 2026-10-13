import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import JSZip from 'jszip';
import { api } from '../api.js';
import { composeIdCard } from '../idCard.js';
import StudentIdCard from '../components/StudentIdCard.jsx';

function sanitize(value) {
  return String(value || '').trim().replace(/[^a-z0-9-]+/gi, '_').replace(/^_+|_+$/g, '');
}

function fileBase(student) {
  return `${sanitize(student.studentNo)}_${sanitize(student.lastName)}_${sanitize(student.firstName)}`;
}

function csvEscape(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export default function QrSheet() {
  const [students, setStudents] = useState([]);
  const [search, setSearch] = useState('');
  const [course, setCourse] = useState('');
  const [loading, setLoading] = useState(true);
  const [zipping, setZipping] = useState(false);
  const [error, setError] = useState('');
  const gridRef = useRef(null);

  useEffect(() => {
    api
      .getStudents()
      .then(setStudents)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const courses = useMemo(
    () => [...new Set(students.map((s) => s.course).filter(Boolean))].sort(),
    [students]
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return students.filter((s) => {
      const matchesSearch =
        !q ||
        s.firstName.toLowerCase().includes(q) ||
        s.lastName.toLowerCase().includes(q) ||
        s.studentNo.toLowerCase().includes(q) ||
        (s.section || '').toLowerCase().includes(q);
      const matchesCourse = !course || s.course === course;
      return matchesSearch && matchesCourse;
    });
  }, [students, search, course]);

  async function downloadZip() {
    if (filtered.length === 0) return;
    setZipping(true);
    setError('');
    try {
      const cards = gridRef.current.querySelectorAll('.id-card');
      const zip = new JSZip();
      const folder = zip.folder('id-cards');
      const indexRows = [['Student No', 'Last Name', 'First Name', 'Course', 'Year Level', 'Section', 'File Name']];

      filtered.forEach((s, i) => {
        const qrCanvas = cards[i]?.querySelector('canvas');
        const base = fileBase(s);
        const fileName = `${base}.png`;
        if (qrCanvas) {
          const cardCanvas = composeIdCard(s, qrCanvas);
          const dataUrl = cardCanvas.toDataURL('image/png');
          folder.file(fileName, dataUrl.split(',')[1], { base64: true });
        }
        indexRows.push([s.studentNo, s.lastName, s.firstName, s.course, s.yearLevel, s.section, `id-cards/${fileName}`]);
      });

      zip.file(
        'id-card-index.csv',
        indexRows.map((r) => r.map(csvEscape).join(',')).join('\n')
      );

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `student-id-cards-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(`Could not build ZIP: ${e.message}`);
    } finally {
      setZipping(false);
    }
  }

  return (
    <div className="page qr-sheet-page">
      <div className="page-head no-print">
        <div>
          <Link to="/students" className="link back">← Students</Link>
          <h2>Student ID Cards</h2>
          <p className="muted">
            {filtered.length} card{filtered.length === 1 ? '' : 's'} — ID size (85.6 × 54 mm), with name, year &amp; section.
          </p>
        </div>
        <div className="head-actions">
          <button className="btn" onClick={() => window.print()}>Print / Save as PDF</button>
          <button className="btn btn-primary" onClick={downloadZip} disabled={zipping || filtered.length === 0}>
            {zipping ? 'Preparing…' : 'Download ZIP (PNG)'}
          </button>
        </div>
      </div>

      <div className="toolbar no-print">
        <input
          className="search"
          placeholder="Search students…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={course} onChange={(e) => setCourse(e.target.value)}>
          <option value="">All courses</option>
          {courses.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="muted small" style={{ marginLeft: 'auto' }}>
          Print tips: “Save as PDF”, background graphics on, scale 100% for true ID size.
        </span>
      </div>

      {error && <div className="alert alert-error no-print">{error}</div>}
      {loading && <div className="muted no-print">Loading…</div>}

      <div className="id-sheet" ref={gridRef}>
        {filtered.map((s) => (
          <StudentIdCard student={s} key={s.id} />
        ))}
        {!loading && filtered.length === 0 && (
          <p className="muted">No students match the filter.</p>
        )}
      </div>
    </div>
  );
}
