-- =====================================================================
-- 064_verify.sql   READ ONLY.  Run each query on its own in the SQL Editor.
-- Totals only (no names or IDs).
-- =====================================================================

-- 1) Everything is installed: expect five true
select
  exists (select 1 from information_schema.columns where table_schema = 'public'
          and table_name = 'automatic_fuel_allocations' and column_name = 'voided_at')       as has_void_columns,
  to_regprocedure('public.auto_fuel_void_allocations(uuid[],text)') is not null              as has_void,
  to_regprocedure('public.auto_fuel_restore_allocation(uuid,text)') is not null              as has_restore,
  to_regprocedure('public.auto_fuel_invoice_review(date,date)') is not null                  as has_review,
  position('AUTO_FUEL_ALLOCATION_VOIDED' in pg_get_functiondef(
    'public.auto_fuel_adjust_allocation(uuid,numeric,text)'::regprocedure)) > 0              as adjust_refuses_voided;

-- 2) Nobody signed in except through the functions: expect false, false
select has_function_privilege('anon', 'public.auto_fuel_void_allocations(uuid[],text)', 'execute') as anon_can_void,
       has_function_privilege('anon', 'public.auto_fuel_invoice_review(date,date)', 'execute')    as anon_can_review;

-- 3) Right after the migration: expect 0 voided, and the same allocation
--    count and total as before running it (runbook step 2)
select count(*) as allocations, sum(amount) as total,
       count(*) filter (where voided_at is not null) as voided
from public.automatic_fuel_allocations;

-- 4) Later: what is voided, per month (the dashboard leaves these out of totals)
select to_char(allocation_date, 'YYYY-MM') as month, count(*) as voided_days, sum(amount) as voided_sar
from public.automatic_fuel_allocations
where voided_at is not null
group by 1 order by 1;

-- 5) Review list summary for September-October 2026, per status.  The function
--    needs the admin role, so select BOTH lines below and run them together
--    (the first line only lasts for that one run).
select set_config('request.jwt.claims', '{"app_metadata":{"role":"admin"}}', true);
select to_char(allocation_date, 'YYYY-MM') as month, status, count(*) as days, sum(automatic_fuel) as automatic_fuel_sar
from public.auto_fuel_invoice_review(date '2026-09-01', date '2026-10-31')
group by 1, 2 order by 1, 2;
