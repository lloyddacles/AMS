import { useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import Modal from './Modal.jsx';

const COLUMNS = [
  { key: 'studentNo', label: 'Student No', aliases: /student\s*(no|number|id)|^no$|^id$/ },
  { key: 'firstName', label: 'First Name', aliases: /first\s*name|given/ },
  { key: 'lastName', label: 'Last Name', aliases: /last\s*name|surname|family/ },
  { key: 'email', label: 'Email', aliases: /e-?mail/ },
  { key: 'course', label: 'Course', aliases: /course|program|strand/ },
  { key: 'yearLevel', label: 'Year Level', aliases: /year|level|grade/ },
  { key: 'section', label: 'Section', aliases: /section|block/ },
];

const SAMPLE = [
  'Student No,First Name,Last Name,Email,Course,Year Level,Section',
  '2024-1001,Jose,Rizal,jose.rizal@example.edu,BSCS,1st Year,A',
  '2024-1002,Andres,Bonifacio,andres.bonifacio@example.edu,BSIT,2nd Year,B',
].join('\n');

function splitLine(line) {
  const delim = line.includes('\t') ? '\t' : ',';
  return line.split(delim).map((c) => c.trim().replace(/^"|"$/g, ''));
}

// Split a combined "Name" field into first/last, keeping a trailing suffix (Jr, III…) with the surname.
function splitName(full) {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  const SUFFIX = /^(jr|sr|ii|iii|iv|v)\.?$/i;
  let lastIdx = parts.length - 1;
  if (SUFFIX.test(parts[parts.length - 1]) && parts.length > 2) {
    lastIdx = parts.length - 2;
  }
  return {
    firstName: parts.slice(0, lastIdx).join(' '),
    lastName: parts.slice(lastIdx).join(' '),
  };
}

function parseText(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return { rows: [], headerMapped: false };

  const firstCells = splitLine(lines[0]);
  const looksLikeHeader = firstCells.some((c) => COLUMNS.some((col) => col.aliases.test(c.toLowerCase())));

  let indices = COLUMNS.map((_, i) => i);
  let bodyLines = lines;
  // Index of a combined "Name" column (only meaningful when a header is present).
  let nameIdx = -1;
  if (looksLikeHeader) {
    indices = COLUMNS.map((col) => firstCells.findIndex((c) => col.aliases.test(c.toLowerCase())));
    nameIdx = firstCells.findIndex((c) => /^(full\s*name|name)$/i.test(c.trim()));
    bodyLines = lines.slice(1);
  }

  const rows = bodyLines.map((line, i) => {
    const cells = splitLine(line);
    const row = { line: i + (looksLikeHeader ? 2 : 1) };
    COLUMNS.forEach((col, ci) => {
      const idx = indices[ci];
      row[col.key] = idx >= 0 && idx < cells.length ? cells[idx] : '';
    });
    if (nameIdx >= 0 && (!row.firstName || !row.lastName) && cells[nameIdx]) {
      const { firstName, lastName } = splitName(cells[nameIdx]);
      row.firstName = row.firstName || firstName;
      row.lastName = row.lastName || lastName;
    }
    return row;
  });

  return { rows, headerMapped: looksLikeHeader };
}

export default function BulkAddStudents({ onClose, onDone }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [updateExisting, setUpdateExisting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const fileRef = useRef(null);

  const { rows } = useMemo(() => parseText(text), [text]);
  const validCount = rows.filter((r) => r.studentNo && r.firstName && r.lastName).length;

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setText(String(reader.result || ''));
    reader.readAsText(file);
  }

  function downloadTemplate() {
    const blob = new Blob([SAMPLE], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'students-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function submit() {
    if (rows.length === 0) return;
    setBusy(true);
    setError('');
    try {
      const res = await api.bulkCreateStudents(rows, updateExisting);
      setResult(res);
      onDone?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <Modal
        title="Import Complete"
        onClose={onClose}
        footer={<button className="btn btn-primary" onClick={onClose}>Done</button>}
      >
        <div className="bulk-result">
          <div className="bulk-stat ok">
            <span className="bulk-num">{result.createdCount}</span>
            <span>imported</span>
          </div>
          {(result.updatedCount > 0 || updateExisting) && (
            <div className={`bulk-stat ${result.updatedCount ? 'info' : ''}`}>
              <span className="bulk-num">{result.updatedCount || 0}</span>
              <span>updated</span>
            </div>
          )}
          <div className={`bulk-stat ${result.skippedCount ? 'warn' : ''}`}>
            <span className="bulk-num">{result.skippedCount}</span>
            <span>skipped</span>
          </div>
        </div>
        {result.skippedCount > 0 && (
          <div className="card table-card" style={{ marginTop: '1rem' }}>
            <table className="table">
              <thead>
                <tr><th>Line</th><th>Student No</th><th>Reason</th></tr>
              </thead>
              <tbody>
                {result.skipped.map((s, i) => (
                  <tr key={i}><td className="mono">{s.line}</td><td className="mono">{s.studentNo || '—'}</td><td className="muted">{s.reason}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    );
  }

  return (
    <Modal
      title="Bulk Add Students"
      wide
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={downloadTemplate}>Download template</button>
          <button className="btn btn-primary" onClick={submit} disabled={busy || rows.length === 0}>
            {busy ? 'Importing…' : `Import ${rows.length} student${rows.length === 1 ? '' : 's'}`}
          </button>
        </>
      }
    >
      <p className="muted small">
        Paste rows or upload a CSV. Columns: <strong>Student No, First Name, Last Name, Email, Course, Year Level, Section</strong>.
        A header row is optional; extra columns are ignored.
      </p>
      <label className="bulk-update-toggle">
        <input type="checkbox" checked={updateExisting} onChange={(e) => setUpdateExisting(e.target.checked)} />
        <span>
          Update existing students
          <span className="muted small"> — rows matching an existing student number overwrite that student instead of being skipped (QR codes are kept).</span>
        </span>
      </label>
      <div className="bulk-toolbar">
        <button className="btn btn-sm" onClick={() => fileRef.current?.click()}>Upload CSV</button>
        <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain" hidden onChange={handleFile} />
        <button className="btn btn-sm" onClick={() => setText('')} disabled={!text}>Clear</button>
        <button className="btn btn-sm" onClick={() => setText(SAMPLE)}>Load sample</button>
        {text && (
          <span className="muted small" style={{ marginLeft: 'auto' }}>
            {rows.length} row{rows.length === 1 ? '' : 's'} · {validCount} valid
          </span>
        )}
      </div>
      <textarea
        className="bulk-textarea"
        rows={10}
        placeholder={SAMPLE}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {error && <div className="alert alert-error">{error}</div>}
    </Modal>
  );
}
