alter table public.vehicles add column if not exists is_active boolean not null default true;

grant select, insert, update on public.vehicles to authenticated;

drop policy if exists "authenticated can view vehicles" on public.vehicles;
create policy "authenticated can view vehicles"
on public.vehicles for select
to authenticated
using (true);

drop policy if exists "admin can insert vehicles" on public.vehicles;
create policy "admin can insert vehicles"
on public.vehicles for insert
to authenticated
with check (coalesce(auth.jwt() -> 'user_metadata' ->> 'project', '') = '');

drop policy if exists "admin can update vehicles" on public.vehicles;
create policy "admin can update vehicles"
on public.vehicles for update
to authenticated
using (coalesce(auth.jwt() -> 'user_metadata' ->> 'project', '') = '')
with check (coalesce(auth.jwt() -> 'user_metadata' ->> 'project', '') = '');
