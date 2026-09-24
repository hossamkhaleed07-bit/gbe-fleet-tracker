-- ============================================================
-- Replace the 3-state (present/leave/absent) driver_attendance.status
-- with the 20 real attendance codes GBE tracks day-by-day (matches the
-- HR spreadsheet: A, WO, OT, OTF, NJ, Left, NM, UP, SL, EA, EF, ND, FD,
-- AL, EL, PH, VI, PNS, P, VM). The Attendance page becomes a monthly
-- grid (driver x day) instead of a single-day present/leave/absent
-- marker, so the constraint needs to accept these codes.
--
-- Existing rows (only ever 'present'/'leave'/'absent' since the table
-- is brand new) are remapped to their closest equivalent code so no
-- history is lost: present -> P, leave -> AL, absent -> A.
-- ============================================================

alter table public.driver_attendance drop constraint if exists driver_attendance_status_check;

update public.driver_attendance set status = 'P' where status = 'present';
update public.driver_attendance set status = 'AL' where status = 'leave';
update public.driver_attendance set status = 'A' where status = 'absent';

alter table public.driver_attendance
  add constraint driver_attendance_status_check
  check (status in ('A','WO','OT','OTF','NJ','Left','NM','UP','SL','EA','EF','ND','FD','AL','EL','PH','VI','PNS','P','VM'));

alter table public.driver_attendance alter column status set default 'NM';
