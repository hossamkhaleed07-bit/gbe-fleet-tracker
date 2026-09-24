-- ============================================================
-- 036_automatic_fuel_allocations_migration.sql
-- New: public.automatic_fuel_allocations — the daily automatic
-- fuel FDP drivers receive through PetroApp, recorded here as its
-- own traceable line. It is NEVER merged into the existing
-- "Actual Fuel" figure (approved reinforcement_requests only,
-- lib/calc.js actualFuelCost()) — Automatic Fuel is a distinct
-- column everywhere it's shown.
--
-- Eligibility (current pass, explicitly confirmed): active FDP
-- drivers only — project = 'FDP' and is_active = true. Attendance
-- (leave/absent) is deliberately NOT factored in yet.
--
-- Idempotent by design: unique(identity_number, allocation_date)
-- + "on conflict do nothing" means running the automation twice
-- (retry, manual re-run, overlapping cron ticks) never creates a
-- duplicate allocation for the same driver/day.
-- ============================================================

create table if not exists public.automatic_fuel_allocations (
  id uuid primary key default gen_random_uuid(),
  identity_number text not null,
  full_name text,
  project text not null,
  vehicle_plate text,
  allocation_date date not null default current_date,
  amount numeric not null default 20,
  fuel_type text not null default 'automatic',
  source text not null default 'system',
  status text not null default 'processed' check (status in ('processed', 'failed')),
  created_at timestamptz not null default now(),
  processed_at timestamptz not null default now(),
  unique (identity_number, allocation_date)
);

alter table public.automatic_fuel_allocations enable row level security;

-- SELECT: admin sees all; a project-scoped account sees only their own
-- project's rows — same idiom as drivers/shift_entries/reinforcement_requests.
drop policy if exists "scoped select automatic_fuel_allocations" on public.automatic_fuel_allocations;
create policy "scoped select automatic_fuel_allocations"
on public.automatic_fuel_allocations for select
to authenticated
using (
  coalesce(auth.jwt() -> 'user_metadata' ->> 'project', '') = ''
  or project = (auth.jwt() -> 'user_metadata' ->> 'project')
);

-- No INSERT/UPDATE/DELETE policy for anon or authenticated at all — the
-- only writer is the cron-driven function below, running as the table
-- owner/service role. Nothing here should ever be user-initiated.
grant select on public.automatic_fuel_allocations to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'automatic_fuel_allocations'
  ) then
    alter publication supabase_realtime add table public.automatic_fuel_allocations;
  end if;
end $$;

create or replace function public.allocate_daily_automatic_fuel()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.automatic_fuel_allocations (identity_number, full_name, project, vehicle_plate, allocation_date, amount)
  select d.identity_number, d.full_name, d.project, d.assigned_vehicle_plate, current_date, 20
  from public.drivers d
  where d.project = 'FDP'
    and d.is_active = true
  on conflict (identity_number, allocation_date) do nothing;
end;
$$;

-- 09:00 UTC = 12:00 Riyadh (UTC+3). Re-run-safe: drops any prior schedule
-- under this name before recreating it, so this migration can be
-- copy-pasted again without erroring or double-scheduling.
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
