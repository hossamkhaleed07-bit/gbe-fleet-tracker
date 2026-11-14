-- =====================================================================
-- 063_verify.sql   READ ONLY.  Run in the SQL Editor after
-- 063_automatic_fuel_final_attendance.sql.  Changes nothing.
-- Prints counts and totals only (no names or IDs).
-- =====================================================================

-- 1) Both helpers exist, and the allocation function checks attendance.
--    Expect: true, true, true, true
select to_regprocedure('private.riyadh_today()') is not null                         as has_riyadh_today,
       to_regprocedure('private.auto_fuel_final_attendance(text,date)') is not null  as has_final_attendance,
       position('auto_fuel_final_attendance' in pg_get_functiondef('public.allocate_daily_automatic_fuel(date)'::regprocedure)) > 0 as checks_attendance,
       position('AUTO_FUEL_DAY_NOT_FINAL' in pg_get_functiondef('public.allocate_daily_automatic_fuel(date)'::regprocedure)) > 0 as refuses_open_day;

-- 2) The cron job: expect one row, schedule '30 21 * * *', active = true.
select jobname, schedule, command, active
from cron.job where jobname = 'daily-fdp-automatic-fuel';

-- 3) Nobody signed in can run the allocation.  Expect: false, false
select has_function_privilege('authenticated', 'public.allocate_daily_automatic_fuel(date)', 'execute') as authenticated_can_run,
       has_function_privilege('anon', 'public.allocate_daily_automatic_fuel(date)', 'execute')          as anon_can_run;

-- 4) Dry run for yesterday (Riyadh): how many active FDP drivers would get fuel,
--    and how many would not, by final code.  Nothing is inserted.
select private.auto_fuel_final_attendance(d.identity_number, private.riyadh_today() - 1) as final_code,
       count(*) as drivers
from public.drivers d
where d.project = 'FDP' and d.is_active = true
group by 1 order by 1;

-- 5) After the first 00:30 run (next day): yesterday's allocations should all be P days.
--    Expect: non_p_rows = 0
select count(*) as rows_for_yesterday,
       count(*) filter (where private.auto_fuel_final_attendance(a.identity_number, a.allocation_date) <> 'P') as non_p_rows
from public.automatic_fuel_allocations a
where a.allocation_date = private.riyadh_today() - 1;

-- 6) The run history of the job (latest 5): status should be 'succeeded'.
select r.start_time, r.status, r.return_message
from cron.job_run_details r
join cron.job j on j.jobid = r.jobid
where j.jobname = 'daily-fdp-automatic-fuel'
order by r.start_time desc
limit 5;
