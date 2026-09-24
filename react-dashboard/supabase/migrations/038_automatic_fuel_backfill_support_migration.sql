-- ============================================================
-- 038_automatic_fuel_backfill_support_migration.sql
-- Lets allocate_daily_automatic_fuel() run for an explicit past
-- date (backfill), not just "today" — the cron job keeps calling
-- it with no argument (defaults to current_date, unchanged
-- behavior), while a manual call can now target any date.
-- ============================================================

-- Drop the old zero-argument signature explicitly first — otherwise
-- Postgres treats the new one-argument (with default) version as a
-- separate overload, and the cron job's no-argument call becomes
-- ambiguous between the two.
drop function if exists public.allocate_daily_automatic_fuel();

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
