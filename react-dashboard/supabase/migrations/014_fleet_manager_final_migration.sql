-- fleet_manager: view-only on Records/Compare/Stations, full edit on Fleet/Drivers, no Overview

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

drop policy if exists "admin can insert drivers" on public.drivers;
create policy "admin can insert drivers"
on public.drivers for insert
to authenticated
with check (coalesce(auth.jwt() -> 'user_metadata' ->> 'project', '') = '');

drop policy if exists "admin can update drivers" on public.drivers;
create policy "admin can update drivers"
on public.drivers for update
to authenticated
using (coalesce(auth.jwt() -> 'user_metadata' ->> 'project', '') = '')
with check (coalesce(auth.jwt() -> 'user_metadata' ->> 'project', '') = '');
