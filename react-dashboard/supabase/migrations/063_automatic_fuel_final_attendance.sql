begin;

-- =====================================================================
-- 063_automatic_fuel_final_attendance.sql
-- FDP Automatic Fuel only for a day whose FINAL attendance code is P.
--
-- Business rule (2026-11-14):
--   * given ONLY when the driver's final attendance code for that day is P
--   * not given for WO, AL, A, Left, VM
--   * NM = "not submitted yet"; it becomes A once the day is over (KSA), so
--     eligibility can only be decided after midnight Riyadh time.
--
-- How the final code is worked out (private.auto_fuel_final_attendance):
--   1. a code a manager entered in driver_attendance wins (P, VM, WO, AL, A, Left)
--   2. no code, or NM: a shift form (shift_entries) for that day -> P
--   3. no code, or NM, no shift form, and the day is over (Riyadh) -> A
--   4. otherwise (today or later) -> NM, not final yet
-- This is the same rule the dashboard uses to show attendance
-- (src/lib/attendanceCodes.js deriveAttendanceStatus), except that a stored NM
-- on a finished day counts as A here, as the rule above says.
-- NOTE: nothing in the database converts NM to A. There is no midnight job;
-- the dashboard only works the code out when it shows it.  This file decides
-- it the same way, at the moment the allocation runs.
--
-- Changes:
--   * allocate_daily_automatic_fuel(p_date) now defaults to YESTERDAY in Riyadh
--     time, refuses a day that is not over yet, and only allocates drivers whose
--     final code for p_date is P.  Amounts are unchanged from 061 (the driver's
--     own amount, else the default).
--   * the cron job daily-fdp-automatic-fuel moves from 09:00 UTC (12:00 Riyadh,
--     allocating TODAY) to 03:30 UTC (06:30 Riyadh, allocating the PREVIOUS day).
--     Running at 06:30 rather than just after midnight leaves the night for a
--     manager to enter a code (WO, AL, ...) for the day before fuel is given.
--
-- Allocations already made are NOT touched (see the past-records proposal).
-- No double allocation on the switch-over day: the old job already made today's
-- rows at 12:00, and the new job's insert for that same day is
-- "on conflict do nothing".
-- Needs 036/038/061.  ONE transaction: if anything fails, nothing changes.
-- Undo: 063_rollback.sql.
-- =====================================================================

do $$
begin
  if to_regclass('public.automatic_fuel_settings') is null then
    raise exception 'STOP: run 061 first (public.automatic_fuel_settings does not exist).';
  end if;
  if to_regclass('public.driver_attendance') is null or to_regclass('public.shift_entries') is null then
    raise exception 'STOP: public.driver_attendance / public.shift_entries missing.';
  end if;
  if to_regprocedure('private.auto_fuel_final_attendance(text,date)') is not null then
    raise exception 'STOP: 063 is already installed (private.auto_fuel_final_attendance exists).';
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 1) Riyadh "today", and the final attendance code of a driver-day
-- ---------------------------------------------------------------------

create function private.riyadh_today() returns date
language sql stable
as $$ select (now() at time zone 'Asia/Riyadh')::date $$;

create function private.auto_fuel_final_attendance(p_identity_number text, p_date date)
returns text
language sql stable
set search_path = public
as $$
  select case
    when a.status is not null and a.status <> 'NM' then a.status
    when exists (select 1 from public.shift_entries s
                 where s.identity_number = p_identity_number and s.shift_date = p_date) then 'P'
    when p_date < private.riyadh_today() then 'A'
    else 'NM'
  end
  from (select (select da.status from public.driver_attendance da
                where da.identity_number = p_identity_number and da.attendance_date = p_date) as status) a
$$;


-- ---------------------------------------------------------------------
-- 2) Daily allocation: previous Riyadh day, final code P only
-- ---------------------------------------------------------------------

create or replace function public.allocate_daily_automatic_fuel(p_date date default (now() at time zone 'Asia/Riyadh')::date - 1)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_date is null or p_date >= private.riyadh_today() then
    raise exception 'AUTO_FUEL_DAY_NOT_FINAL: % is not over yet in Riyadh time', p_date
      using errcode = '22023';
  end if;
  insert into public.automatic_fuel_allocations (identity_number, full_name, project, vehicle_plate, allocation_date, amount)
  select d.identity_number, d.full_name, d.project, d.assigned_vehicle_plate, p_date,
         coalesce(da.amount, (select s.default_amount from public.automatic_fuel_settings s), 20)
  from public.drivers d
  left join public.automatic_fuel_driver_amounts da on da.identity_number = d.identity_number
  where d.project = 'FDP'
    and d.is_active = true
    and private.auto_fuel_final_attendance(d.identity_number, p_date) = 'P'
  on conflict (identity_number, allocation_date) do nothing;
end;
$$;

-- The daily job only: nobody signed in can trigger an allocation (as in 061;
-- repeated in case create or replace ever left a default grant behind).
revoke all on function public.allocate_daily_automatic_fuel(date) from public, anon, authenticated;
-- Helpers: only the job (running as the owner, inside the SECURITY DEFINER
-- function above) and the SQL Editor use them; nobody signed in needs them.
revoke all on function private.riyadh_today(), private.auto_fuel_final_attendance(text, date) from public, anon, authenticated;


-- ---------------------------------------------------------------------
-- 3) Cron: 03:30 UTC = 06:30 Riyadh, for the previous Riyadh day
-- ---------------------------------------------------------------------

do $$
begin
  if exists (select 1 from cron.job where jobname = 'daily-fdp-automatic-fuel') then
    perform cron.unschedule('daily-fdp-automatic-fuel');
  end if;
end $$;

select cron.schedule(
  'daily-fdp-automatic-fuel',
  '30 3 * * *',
  $$select public.allocate_daily_automatic_fuel();$$
);

commit;
