-- NOTE: statements that inserted/updated personal data were removed for privacy; structure kept.
alter table public.drivers enable row level security;

drop policy if exists "anon can view drivers" on public.drivers;
create policy "anon can view drivers" on public.drivers for select to anon using (true);
grant select on public.drivers to anon;

drop policy if exists "authenticated can view drivers" on public.drivers;
create policy "authenticated can view drivers" on public.drivers for select to authenticated using (true);
grant select on public.drivers to authenticated;
