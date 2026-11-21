-- =====================================================================
-- 063_verify.sql   READ ONLY.  Run in the SQL Editor after
-- 063_automatic_fuel_final_attendance.sql.  Changes nothing.
-- Prints counts and totals only (no names or IDs).
-- =====================================================================

-- 1) Both helpers exist, the allocation function checks attendance, and the
--    7-day job exists, and the amount is the one in effect on the day.
--    Expect: true, true, true, true, true, true
select to_regprocedure('private.riyadh_today()') is not null                         as has_riyadh_today,
       to_regprocedure('public.allocate_recent_automatic_fuel(integer)') is not null as has_7_day_job,
       to_regprocedure('private.auto_fuel_final_attendance(text,date)') is not null  as has_final_attendance,
       position('auto_fuel_final_attendance' in pg_get_functiondef('public.allocate_daily_automatic_fuel(date)'::regprocedure)) > 0 as checks_attendance,
       position('AUTO_FUEL_DAY_NOT_FINAL' in pg_get_functiondef('public.allocate_daily_automatic_fuel(date)'::regprocedure)) > 0 as refuses_open_day,
       position('auto_fuel_amount_on' in pg_get_functiondef('public.allocate_daily_automatic_fuel(date)'::regprocedure)) > 0 as amount_on_the_day;

-- 2) The cron job: expect one row, schedule '30 3 * * *' (06:30 Riyadh),
--    command 'select public.allocate_recent_automatic_fuel();', active = true.
select jobname, schedule, command, active
from cron.job where jobname = 'daily-fdp-automatic-fuel';

-- 3) Nobody signed in can run the allocation.  Expect: false, false, false
select has_function_privilege('authenticated', 'public.allocate_daily_automatic_fuel(date)', 'execute') as authenticated_can_run,
       has_function_privilege('anon', 'public.allocate_daily_automatic_fuel(date)', 'execute')          as anon_can_run,
       has_function_privilege('authenticated', 'public.allocate_recent_automatic_fuel(integer)', 'execute') as authenticated_can_run_7_day;

-- 3b) 062 is untouched: expect true (the default can still be changed)
select position('where id' in pg_get_functiondef('public.auto_fuel_set_default(numeric)'::regprocedure)) > 0 as has_062_fix;

-- 4) Dry run for yesterday (Riyadh): how many active FDP drivers would get fuel,
--    and how many would not, by final code.  Nothing is inserted.
select private.auto_fuel_final_attendance(d.identity_number, private.riyadh_today() - 1) as final_code,
       count(*) as drivers
from public.drivers d
where d.project = 'FDP' and d.is_active = true
group by 1 order by 1;

-- 4b) The amount in effect on a past day, counted per amount (nothing is
--     inserted).  15 Oct: expect every active FDP driver at 20 (the default
--     then).  Yesterday: 30 for drivers without an own amount.
select private.auto_fuel_amount_on(d.identity_number, date '2026-10-15') as amount_15_oct,
       count(*) as drivers
from public.drivers d where d.project = 'FDP' and d.is_active = true
group by 1 order by 1;
select private.auto_fuel_amount_on(d.identity_number, private.riyadh_today() - 1) as amount_yesterday,
       count(*) as drivers
from public.drivers d where d.project = 'FDP' and d.is_active = true
group by 1 order by 1;

-- 5) After the first 06:30 Riyadh run: rows the new job made (created between
--    06:00 and 08:00 Riyadh, last 7 days) should all be P days.  Expect: non_p_rows = 0
select count(*) as rows_made_by_new_job,
       count(*) filter (where private.auto_fuel_final_attendance(a.identity_number, a.allocation_date) <> 'P') as non_p_rows
from public.automatic_fuel_allocations a
where a.allocation_date >= private.riyadh_today() - 7
  and (a.created_at at time zone 'Asia/Riyadh')::time between time '06:00' and time '08:00';

-- 6) The run history of the job (latest 5): status should be 'succeeded'.
select r.start_time, r.status, r.return_message
from cron.job_run_details r
join cron.job j on j.jobid = r.jobid
where j.jobname = 'daily-fdp-automatic-fuel'
order by r.start_time desc
limit 5;
