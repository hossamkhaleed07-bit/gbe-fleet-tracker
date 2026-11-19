-- =====================================================================
-- 062_verify.sql   READ ONLY.  Run each query on its own in the SQL Editor.
-- Totals only (no names or IDs).
-- =====================================================================

-- 1) The fix is installed: expect true
select position('where id' in pg_get_functiondef('public.auto_fuel_set_default(numeric)'::regprocedure)) > 0
       as has_062_fix;

-- 2) The current default amount
select default_amount, updated_by, updated_at from public.automatic_fuel_settings;

-- 3) Drivers with their own amount, per amount (and whether it equals the default)
select a.amount, count(*) as drivers, a.amount = s.default_amount as same_as_default,
       min(a.updated_at) as first_set, max(a.updated_at) as last_set
from public.automatic_fuel_driver_amounts a cross join public.automatic_fuel_settings s
group by a.amount, s.default_amount
order by a.amount;

-- 4) After you change the default on the page: the last default changes
select old_amount, new_amount, changed_by, changed_at
from public.automatic_fuel_amount_changes
where kind = 'default'
order by changed_at desc
limit 5;
