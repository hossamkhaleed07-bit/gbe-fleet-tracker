-- ============================================================
-- Narrow driver_attendance.status from the full 20-code set (#040)
-- down to the 6 codes actually needed: A, WO, Left, AL, P, VM.
-- Any rows already using one of the other 14 codes are remapped to
-- their closest equivalent among the 6 so no data is lost:
--   PNS, OT, OTF, NJ, VI, NM  -> P   (still a working/present day)
--   UP, SL, EL, PH, EA, EF, ND, FD -> AL  (generic leave)
-- ============================================================

alter table public.driver_attendance drop constraint if exists driver_attendance_status_check;

update public.driver_attendance set status = 'P' where status in ('PNS','OT','OTF','NJ','VI','NM');
update public.driver_attendance set status = 'AL' where status in ('UP','SL','EL','PH','EA','EF','ND','FD');

alter table public.driver_attendance
  add constraint driver_attendance_status_check
  check (status in ('A','WO','Left','AL','P','VM'));

alter table public.driver_attendance alter column status set default 'P';
