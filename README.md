# AttendX

AttendX: A QR-based attendance monitoring and digital attendance records system.
Staff generate QR ID cards for students; students scan (or have their QR scanned)
to record time-in and time-out, and staff can view, manage, and export
attendance reports.

---

## Creator

**Designed & developed by Mr. Lloyd Christopher F. Dacles, MIS.**

---

## Rights

© 2026 Attendance Monitoring Web App · **All Rights Reserved.**

This project is the intellectual property of the creator named above. No part of
this software may be copied, reproduced, modified, distributed, sublicensed, or
used in any form without the prior written permission of the creator.

---

## AI Disclosure

Portions of this project were built with the assistance of Artificial
Intelligence using **OpenCode**, an AI-powered coding assistant. All AI-assisted
code was reviewed, tested, and integrated under the direction and responsibility
of the creator. Any errors or omissions remain the responsibility of the creator.

---

## Features

- **Event management** — create, edit, open/close events with date, time,
  location, and a unique check-in code.
- **QR check-in** — scan a student's QR code to record attendance; a second scan
  records time-out. Check-in is accepted at any time (scans after the grace
  period are marked *late*); time-out opens shortly before the event ends.
- **Public self check-in** — students scan an event QR and confirm their student
  number themselves.
- **Student management** — add/import students in bulk, edit, and delete.
- **Printable QR ID cards** — generate 85.6 × 54 mm ID cards, a QR sheet, and a
  ZIP export for printing.
- **Attendance management** — view per-event attendance, manually mark
  present/late/excused/absent, and export to CSV.
- **Dashboard & reports** — attendance rates, trends, top attendees, and filters.
- **Authentication** — JWT-based login with an in-app *change password* feature.
- **Attribution** — an About page crediting the creator and tech stack.

---

## Tech Stack

**Frontend**
- React 18 + Vite
- react-router-dom
- qrcode.react (QR generation) and html5-qrcode (QR scanning)
- recharts (dashboard charts)
- jszip (bulk QR export)

**Backend**
- Node.js + Express 4 (`express-async-errors`)
- `@libsql/client` — libSQL / [Turso](https://turso.tech) hosted SQLite
- jsonwebtoken (JWT auth), bcryptjs (password hashing), nanoid (tokens), CORS

**Tooling / Deployment**
- OpenCode (AI coding assistant)
- Vercel (client static hosting + server as a serverless function)
- Turso (hosted database)

---

## Project Structure

```
.
├── client/              # React + Vite frontend
│   ├── src/
│   │   ├── pages/       # Dashboard, Events, Scanner, Students, Reports, ...
│   │   ├── components/  # Layout, modals, ID cards, footer, ...
│   │   ├── api.js       # API client (uses VITE_API_URL)
│   │   └── meta.js      # App name, author, tech stack
│   └── vercel.json      # SPA rewrites
└── server/              # Express + libSQL backend
    ├── src/
    │   ├── app.js       # Express app (default export; Vercel entry)
    │   ├── dev.js       # Local listener
    │   ├── db.js        # libSQL client + schema/migrations
    │   ├── config.js    # Environment configuration
    │   ├── bootstrap.js # Auto-create admin
    │   ├── seed.js      # Sample data
    │   ├── routes/      # auth, students, events, attendance, reports, dashboard
    │   └── services/    # user helpers
    └── .env.example
```

---

## Getting Started (Local Development)

**Requirements:** Node.js 20 or newer.

1. Install dependencies (root, client, and server):
   ```sh
   npm run install:all
   ```
2. Start both the server and client in development:
   ```sh
   npm run dev
   ```
   - Client: http://localhost:5173
   - Server: http://localhost:4000

By default the server uses a local SQLite file at
`server/data/attendance.sqlite` (created automatically). Optionally seed sample
students/events:
```sh
npm run seed
```

**Default login:** `admin` / `admin123` (change it after first login).

---

## Environment Variables

### Server (`server/.env`)

| Variable             | Description                                                              |
| -------------------- | ------------------------------------------------------------------------ |
| `PORT`               | Server port (default `4000`).                                           |
| `JWT_SECRET`         | Secret for signing JWTs — set a long random value in production.        |
| `CLIENT_ORIGIN`      | Allowed CORS origin(s), comma-separated. Empty = allow all.             |
| `TURSO_DATABASE_URL` | Hosted libSQL URL (e.g. `libsql://...`). Unset = local file database.   |
| `TURSO_AUTH_TOKEN`   | Turso auth token for the hosted database.                               |

### Client (`client/.env`)

| Variable       | Description                                                        |
| -------------- | ------------------------------------------------------------------ |
| `VITE_API_URL` | Base URL of the API including `/api` (e.g. `https://api.../api`).  |

---

## Deployment (Vercel + Turso)

The app deploys as **two Vercel projects** from this repository plus a **Turso**
database:

1. **Database (Turso)** — create a database and copy its URL and auth token.
2. **API project** — import this repo on Vercel, set **Root Directory** to
   `server`, and add env vars `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, and
   `JWT_SECRET`. The Express app is detected and deployed as a function.
3. **Client project** — import this repo again, set **Root Directory** to
   `client`, and add `VITE_API_URL=https://<api-domain>/api`.
4. **CORS** — set the API's `CLIENT_ORIGIN` to the client's URL and redeploy.

The database schema and default admin account are created automatically on the
first request.

---

## API Overview

All endpoints are under `/api`. Authentication uses a Bearer JWT.

| Area       | Examples                                                        |
| ---------- | --------------------------------------------------------------- |
| Auth       | `POST /auth/login`, `GET /auth/me`, `POST /auth/password`       |
| Students   | `GET/POST /students`, `POST /students/bulk`, `PUT/DELETE /:id`  |
| Events     | `GET/POST /events`, `GET/PUT /events/:id`                       |
| Attendance | `POST /attendance/scan`, `POST /attendance/lookup`, `/public/…` |
| Reports    | `GET /reports/...` (CSV export)                                 |
| Dashboard  | `GET /dashboard/stats`                                          |

---

© 2026 Attendance Monitoring Web App · All Rights Reserved.
Designed & developed by Mr. Lloyd Christopher F. Dacles, MIS.
