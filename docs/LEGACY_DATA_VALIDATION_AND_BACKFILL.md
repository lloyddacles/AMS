# Legacy Data Validation and Backfill Plan

This document covers validation and controlled reconciliation for legacy/unscoped data after scoping, auto-roster, and student-status excusal changes.

## Scope of changes affecting legacy data

1. **Department/program scoping**
   - Scoped staff only see/manage records matching their scope.
   - Legacy **unassigned staff** remain unrestricted until assigned (preserved behavior).
   - Legacy **unscoped events/schedules** are hidden from scoped staff until scoped (expected by current scope filters).

2. **Auto-roster on scoped event creation/generation**
   - New scoped events (manual create, schedule generation, continuation days) auto-exclude students not associated with the event’s department/program.
   - **Existing scoped events are not retroactively changed.**

3. **Student status takes effect on all events**
   - Students with status **Deceased, Dropped, LOA** are auto-excused on events they attend (reason = status).
   - Enforcement is applied in attendance views, scans/manual actions, close/consolidation, summary refresh, and report/portal/risk aggregations.
   - Historical records/summaries may still need reconciliation depending on when status changed and whether events were closed/refreshed.

## Validation checklist (run on staging/production-like copy)

### A. Scoping visibility and access
- [ ] Unassigned staff can still access legacy data as before (where intended).
- [ ] Scoped staff cannot see/manage out-of-scope students/events/schedules/corrections/notifications.
- [ ] Known-ID direct access to out-of-scope records returns `404` (no data leakage).
- [ ] Admin can view/manage all records and filter reports by program correctly.

### B. Legacy unscoped records
- [ ] Events/schedules with `department_id`/`program_id` NULL are reviewed and assigned scope where appropriate.
- [ ] Students missing `department_id`/`program_id` are reviewed/backfilled (course/program mapping) so scoped auto-roster and visibility work correctly.
- [ ] Notifications without scope behave as intended for global vs scoped audiences.

### C. Existing scoped events (roster alignment)
- [ ] Identify scoped events whose attendee rosters do not match dept/program membership.
- [ ] Decide policy for manually customized rosters:
  - **Strict alignment:** exclude non-matching students (may remove intentional exceptions).
  - **Preserve customizations:** only report mismatches, fix manually.
- [ ] Reconcile selected events (script dry-run first).

### D. Non-attending student statuses (Deceased/Dropped/LOA)
- [ ] Identify students with Deceased/Dropped/LOA status.
- [ ] Verify their attendance is excused with reason=status across relevant events (especially closed events with stale summaries).
- [ ] Reconcile missing/incorrect excusal records and refresh closed-event summaries where needed.

### E. Public/kiosk and portal flows
- [ ] Public check-in page works with event-scoped check-in list (`/api/attendance/public/:code/checkins`); legacy global endpoint is retired.
- [ ] Student portal shows correct excused status/reason for affected students.

## Backfill script (dry-run by default)

`scripts/backfill-scoped-rosters-and-excusals.mjs`

### Usage
```bash
# From server/ with environment configured (DB URL/token, etc.)
node scripts/backfill-scoped-rosters-and-excusals.mjs            # dry-run report
node scripts/backfill-scoped-rosters-and-excusals.mjs --apply-excusals
node scripts/backfill-scoped-rosters-and-excusals.mjs --apply-rosters
node scripts/backfill-scoped-rosters-and-excusals.mjs --apply-excusals --apply-rosters
```

### What it does
- **Excusals (`--apply-excusals`)**: for students with status `Deceased`, `Dropped`, or `LOA`, ensures attendees on each event have an `excused` attendance record with `note = <status>` (upserts where needed) and refreshes `report_summary` for closed events.
- **Rosters (`--apply-rosters`)**: for events with `department_id` or `program_id` set, inserts `event_exclusions` for students **not associated** with the event scope (aligns legacy scoped events to auto-roster policy).
  - **Warning:** this may exclude students previously added manually but outside scope. Review dry-run output first.

### Recommended execution order
1. Take/verify DB backup.
2. Run dry-run and review counts/samples.
3. Apply **excusals** reconciliation first (generally safe and policy-correct).
4. Review roster mismatches; apply **roster** alignment only if strict scope policy is desired.
5. Re-run QA checks (attendance views, summaries, reports, portal).

## Notes
- Auto-roster matching:
  - **Program-scoped event:** student `program_id` must match.
  - **Department-scoped event:** student belongs to department directly or via program department.
  - **Unscoped event:** no automatic exclusions.
- Student/program backfill from course names may be incomplete; verify mappings before relying on scoped rosters.
- All reconciliation should be performed during a maintenance window for production-like environments.