-- =====================================================================
-- 065_verify.sql   READ ONLY.  Run each query on its own in the SQL Editor.
-- Counts only (no names or IDs).
-- =====================================================================

-- 1) Installed: expect eight true
select
  exists (select 1 from information_schema.columns where table_schema = 'public'
          and table_name = 'drivers' and column_name = 'last_working_day')                      as has_columns,
  to_regclass('public.driver_status_history') is not null                                       as has_history,
  to_regprocedure('public.set_active_status(text,text,boolean,text,date,text,text)') is not null as has_new_set_active_status,
  to_regprocedure('public.set_active_status(text,text,boolean,text)') is null                   as old_one_removed,
  to_regprocedure('public.set_driver_leaving_details(text,date,text,text)') is not null         as has_correction,
  to_regprocedure('public.driver_activity_after(text,date)') is not null                        as has_activity_check,
  exists (select 1 from pg_trigger where tgname = 'driver_leaving_before_update')               as has_before_trigger,
  exists (select 1 from pg_trigger where tgname = 'driver_status_history_log')                  as has_history_trigger;

-- 2) Access: expect false, false, false, true
select has_function_privilege('anon', 'public.set_active_status(text,text,boolean,text,date,text,text)', 'execute') as anon_can_set,
       has_function_privilege('anon', 'public.driver_activity_after(text,date)', 'execute')                       as anon_can_check,
       has_table_privilege('authenticated', 'public.driver_status_history', 'insert')                            as can_write_history,
       has_function_privilege('authenticated', 'public.set_active_status(text,text,boolean,text,date,text,text)', 'execute') as signed_in_can_set;

-- 3) Right after the migration: nothing filled in yet, history empty.
--    Expect: inactive_drivers = what it was before, with_details = 0, history_rows = 0
select count(*) filter (where not is_active)                         as inactive_drivers,
       count(*) filter (where last_working_day is not null)          as with_details,
       (select count(*) from public.driver_status_history)           as history_rows
from public.drivers;

-- 4) Later: drivers who left, per reason and month of the last working day
select to_char(last_working_day, 'YYYY-MM') as month, deactivation_reason as reason, count(*) as drivers
from public.drivers
where not is_active
group by rollup (1, 2)
order by 1 nulls last, 2 nulls last;

-- 5) Later: inactive drivers still without leaving details (deactivated before
--    065, or directly).  The admin can fill them in on the Drivers page.
select count(*) as inactive_without_details
from public.drivers
where not is_active and last_working_day is null;

-- 6) Later: history rows per kind of change
select change, count(*) as rows, max(changed_at) as last_change
from public.driver_status_history
group by 1 order by 1;
