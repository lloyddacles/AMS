import { get, all, run, initDb } from './db.js';
import { newToken } from './services/users.js';
import { ensureAdmin } from './bootstrap.js';

const STUDENTS = [
  ['2024-0001', 'Maria', 'Santos', 'BSCS', '3rd Year'],
  ['2024-0002', 'Juan', 'Dela Cruz', 'BSCS', '3rd Year'],
  ['2024-0003', 'Ana', 'Reyes', 'BSIT', '2nd Year'],
  ['2024-0004', 'Mark', 'Villanueva', 'BSIT', '2nd Year'],
  ['2024-0005', 'Liza', 'Mendoza', 'BSEd', '1st Year'],
  ['2024-0006', 'Paolo', 'Garcia', 'BSCS', '4th Year'],
  ['2024-0007', 'Grace', 'Torres', 'BSBA', '1st Year'],
  ['2024-0008', 'Rico', 'Bautista', 'BSIT', '3rd Year'],
];

const EVENTS = [
  ['General Assembly', 'Opening assembly for the school year', 'Main Auditorium', '2026-08-15', '08:00', '11:00'],
  ['Science Seminar', 'Guest lecture on emerging technologies', 'Room 204', '2026-08-22', '13:00', '16:00'],
  ['Intramurals Opening', 'Sports fest opening ceremony', 'Gymnasium', '2026-09-05', '07:30', '12:00'],
];

async function seed() {
  await initDb();
  await ensureAdmin();

  if ((await get('SELECT COUNT(*) AS c FROM students')).c === 0) {
    for (const [no, first, last, course, year] of STUDENTS) {
      const email = `${first.toLowerCase()}.${last.toLowerCase().replace(/\s+/g, '')}@example.edu`;
      await run(
        `INSERT INTO students (student_no, first_name, last_name, email, course, year_level, qr_token)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [no, first, last, email, course, year, newToken()]
      );
    }
    console.log(`Seeded ${STUDENTS.length} students`);
  }

  if ((await get('SELECT COUNT(*) AS c FROM events')).c === 0) {
    for (const [name, desc, loc, date, start, end] of EVENTS) {
      await run(
        `INSERT INTO events (name, description, location, event_date, start_time, end_time, checkin_code)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [name, desc, loc, date, start, end, newToken()]
      );
    }
    console.log(`Seeded ${EVENTS.length} events`);
  }

  if ((await get('SELECT COUNT(*) AS c FROM attendance')).c === 0) {
    const eventIds = (await all('SELECT id FROM events')).map((r) => r.id);
    const studentIds = (await all('SELECT id FROM students')).map((r) => r.id);
    for (const eventId of eventIds) {
      for (const studentId of studentIds) {
        const roll = Math.random();
        if (roll < 0.65) await run('INSERT OR IGNORE INTO attendance (event_id, student_id, status, method) VALUES (?, ?, ?, ?)', [eventId, studentId, 'present', 'qr']);
        else if (roll < 0.75) await run('INSERT OR IGNORE INTO attendance (event_id, student_id, status, method) VALUES (?, ?, ?, ?)', [eventId, studentId, 'late', 'qr']);
        else if (roll < 0.85) await run('INSERT OR IGNORE INTO attendance (event_id, student_id, status, method) VALUES (?, ?, ?, ?)', [eventId, studentId, 'absent', 'manual']);
      }
    }
    console.log('Seeded sample attendance records');
  }

  console.log('Seed complete.');
}

seed().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
