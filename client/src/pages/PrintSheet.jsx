import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import Spinner from '../components/Spinner.jsx';

// Blank paper sign-in sheet for an event — the offline/traditional backup when
// devices or scanners are unavailable. Prints one row per attendee with empty
// Time In / Status / Signature columns for handwriting.
export default function PrintSheet() {
  const { id } = useParams();
  const [event, setEvent] = useState(null);
  const [attendees, setAttendees] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.getEvent(id), api.getEventAttendees(id)])
      .then(([e, list]) => {
        setEvent(e);
        setAttendees(list);
      })
      .catch((err) => setError(err.message));
  }, [id]);

  const students = (attendees?.students || []).filter((s) => s.attending);

  return (
    <div className="page">
      <div className="page-head no-print">
        <div>
          <Link to={`/events/${id}`} className="link back">← Back to event</Link>
          <h2>Attendance Sheet</h2>
          <p className="muted">
            Blank sign-in sheet — {students.length} attendee{students.length === 1 ? '' : 's'}.
            Use it when devices or scanners are unavailable.
          </p>
        </div>
        <div className="head-actions">
          <button className="btn btn-primary" onClick={() => window.print()} disabled={!event}>
            Print / Save as PDF
          </button>
        </div>
      </div>

      {error && <div className="alert alert-error no-print">{error}</div>}
      {!event && !error && (
        <div className="no-print">
          <Spinner label="Loading sheet…" size="lg" variant="panel" />
        </div>
      )}

      {event && (
        <div className="card print-sheet">
          <div className="sheet-head">
            <div>
              <div className="sheet-title">{event.name}</div>
              <div className="muted small">
                {event.eventDate}
                {event.startTime ? ` · ${event.startTime}${event.endTime ? `–${event.endTime}` : ''}` : ''}
                {event.location ? ` · ${event.location}` : ''}
              </div>
            </div>
            <div className="sheet-meta">
              <div>Attendees: <strong>{students.length}</strong></div>
              <div className="muted small">Printed {new Date().toLocaleDateString()}</div>
            </div>
          </div>

          <table className="table sheet-table">
            <thead>
              <tr>
                <th className="num">#</th>
                <th>Student No</th>
                <th>Name</th>
                <th>Course / Year / Section</th>
                <th className="sheet-blank">Time In</th>
                <th className="sheet-blank">Status</th>
                <th className="sheet-blank wide">Signature</th>
              </tr>
            </thead>
            <tbody>
              {students.map((s, i) => (
                <tr key={s.studentId}>
                  <td className="num">{i + 1}</td>
                  <td className="mono">{s.studentNo}</td>
                  <td>{s.lastName}, {s.firstName}</td>
                  <td className="muted">
                    {[s.course, s.yearLevel ? `Y${s.yearLevel}` : '', s.section].filter(Boolean).join(' · ') || '—'}
                  </td>
                  <td className="sheet-blank" />
                  <td className="sheet-blank" />
                  <td className="sheet-blank wide" />
                </tr>
              ))}
              {students.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">No attendees on the list for this event.</td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="sheet-foot muted small">
            Organizer / teacher signature: ________________________&nbsp;&nbsp;&nbsp;Date: ______________
          </div>
        </div>
      )}
    </div>
  );
}
