-- NOTE: statements that inserted/updated personal data were removed for privacy; structure kept.
create table if not exists public.drivers (
  id uuid primary key default gen_random_uuid(),
  identity_number text not null unique,
  full_name text,
  nationality text,
  mobile_number text,
  vehicle_plate text,
  city_name text,
  job_title text,
  vendor_name text,
  department text,
  job_id text,
  vehicle_type text,
  contract_type text,
  employee_type text,
  created_at timestamptz not null default now()
);

alter table public.drivers enable row level security;

drop policy if exists "anon can view drivers" on public.drivers;
create policy "anon can view drivers" on public.drivers for select to anon using (true);
grant select on public.drivers to anon;

drop policy if exists "authenticated can view drivers" on public.drivers;
create policy "authenticated can view drivers" on public.drivers for select to authenticated using (true);
grant select on public.drivers to authenticated;
