-- ============================================================
-- Add "NM" (Not Marked) back as the 7th standard attendance code and
-- make it the default. Paired with the app-side change where P/A are
-- now mostly auto-derived from shift_entries (submitted -> P, day over
-- with nothing submitted -> A) instead of always being written as rows
-- — NM is what a driver-day shows before that derivation applies
-- (today/future, not due yet) and before any manual exception is set.
-- ============================================================

alter table public.driver_attendance drop constraint if exists driver_attendance_status_check;

alter table public.driver_attendance
  add constraint driver_attendance_status_check
  check (status in ('A','WO','Left','AL','P','VM','NM'));

alter table public.driver_attendance alter column status set default 'NM';
