-- ============================================================
-- GBE Fleet Tracker — Vehicles table for the plate dropdown
-- شغّليه كامل في Supabase Dashboard → SQL Editor → Run
-- ============================================================

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  plate_number text not null unique,
  created_at timestamptz not null default now()
);

alter table public.vehicles enable row level security;

drop policy if exists "anon can view vehicles" on public.vehicles;
create policy "anon can view vehicles"
on public.vehicles for select
to anon
using (true);

grant select on public.vehicles to anon;
