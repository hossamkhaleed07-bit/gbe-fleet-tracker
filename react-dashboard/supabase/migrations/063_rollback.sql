begin;

-- =====================================================================
-- 063_rollback.sql   Undoes 063_automatic_fuel_final_attendance.sql.
--
-- allocate_daily_automatic_fuel() goes back to 061: every active FDP driver,
-- for TODAY (no attendance check), and the cron job back to 09:00 UTC
-- (12:00 Riyadh).  Allocations already made are not touched.
-- Run it away from 12:00 Riyadh.  ONE transaction.
-- It does NOT touch auto_fuel_set_default: the 062 fix (and the default of
-- 30) stays as it is.
-- =====================================================================

do $$
begin
  if to_regprocedure('private.auto_fuel_final_attendance(text,date)') is null then
    raise exception 'STOP: 063 is not installed (private.auto_fuel_final_attendance does not exist).';
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
  select d.identity_number, d.full_name, d.project, d.assigned_vehicle_plate, p_date,
         coalesce(da.amount, (select s.default_amount from public.automatic_fuel_settings s), 20)
  from public.drivers d
  left join public.automatic_fuel_driver_amounts da on da.identity_number = d.identity_number
  where d.project = 'FDP'
    and d.is_active = true
  on conflict (identity_number, allocation_date) do nothing;
end;
$$;

revoke all on function public.allocate_daily_automatic_fuel(date) from public, anon, authenticated;

drop function if exists public.allocate_recent_automatic_fuel(integer);
drop function if exists private.auto_fuel_final_attendance(text, date);
drop function if exists private.auto_fuel_amount_on(text, date);
drop function if exists private.riyadh_today();

do $$
begin
  if exists (select 1 from cron.job where jobname = 'daily-fdp-automatic-fuel') then
    perform cron.unschedule('daily-fdp-automatic-fuel');
  end if;
end $$;

select cron.schedule(
  'daily-fdp-automatic-fuel',
  '0 9 * * *',
  $$select public.allocate_daily_automatic_fuel();$$
);

commit;
