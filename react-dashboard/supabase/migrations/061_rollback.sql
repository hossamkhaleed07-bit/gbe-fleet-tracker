begin;

-- =====================================================================
-- 061_rollback.sql   Removes everything 061_automatic_fuel_amounts.sql created.
--
-- allocate_daily_automatic_fuel() goes back to a flat 20 for every driver.
-- Allocations already made keep their amounts (including corrected ones);
-- only the adjusted_at / adjusted_by columns are dropped.  The change log is
-- dropped too: export it first if you need it
--   select * from public.automatic_fuel_amount_changes order by changed_at;
-- ONE transaction: if anything fails, nothing changes.
-- =====================================================================

do $$
begin
  if to_regclass('public.automatic_fuel_settings') is null then
    raise exception 'STOP: 061 is not installed (public.automatic_fuel_settings does not exist).';
  end if;
end $$;

create or replace function public.allocate_daily_automatic_fuel(p_date date default current_date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.automatic_fuel_allocations (identity_number, full_name, project, vehicle_plate, allocation_date, amount)
  select d.identity_number, d.full_name, d.project, d.assigned_vehicle_plate, p_date, 20
  from public.drivers d
  where d.project = 'FDP'
    and d.is_active = true
  on conflict (identity_number, allocation_date) do nothing;
end;
$$;

drop function if exists public.auto_fuel_set_default(numeric);
drop function if exists public.auto_fuel_set_driver_amount(text, numeric);
drop function if exists public.auto_fuel_adjust_allocation(uuid, numeric, text);

drop table if exists public.automatic_fuel_amount_changes;
drop table if exists public.automatic_fuel_driver_amounts;
drop table if exists public.automatic_fuel_settings;

drop function if exists private.auto_fuel_append_only();
drop function if exists private.auto_fuel_require_admin();
drop function if exists private.auto_fuel_actor();
drop function if exists private.auto_fuel_can_read();

alter table public.automatic_fuel_allocations
  drop column if exists adjusted_at,
  drop column if exists adjusted_by;

commit;
