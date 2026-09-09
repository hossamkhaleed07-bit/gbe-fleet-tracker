-- fleet_manager becomes a read-only viewer of Records/Compare/Stations
-- (no Fleet/Drivers access, no editing anywhere)

drop policy if exists "scoped view shift_entries" on public.shift_entries;
create policy "scoped view shift_entries"
on public.shift_entries for select
to authenticated
using (
  coalesce(auth.jwt() -> 'user_metadata' ->> 'project', '') = ''
  or exists (
    select 1 from public.drivers d
    where d.identity_number = shift_entries.identity_number
      and d.project = (auth.jwt() -> 'user_metadata' ->> 'project')
  )
);

drop policy if exists "admin can insert vehicles" on public.vehicles;
create policy "admin can insert vehicles"
on public.vehicles for insert
to authenticated
with check (
  coalesce(auth.jwt() -> 'user_metadata' ->> 'project', '') = ''
  and coalesce(auth.jwt() -> 'user_metadata' ->> 'role', '') <> 'fleet_manager'
);

drop policy if exists "admin can update vehicles" on public.vehicles;
create policy "admin can update vehicles"
on public.vehicles for update
to authenticated
using (
  coalesce(auth.jwt() -> 'user_metadata' ->> 'project', '') = ''
  and coalesce(auth.jwt() -> 'user_metadata' ->> 'role', '') <> 'fleet_manager'
)
with check (
  coalesce(auth.jwt() -> 'user_metadata' ->> 'project', '') = ''
  and coalesce(auth.jwt() -> 'user_metadata' ->> 'role', '') <> 'fleet_manager'
);

drop policy if exists "admin can insert drivers" on public.drivers;
create policy "admin can insert drivers"
on public.drivers for insert
to authenticated
with check (
  coalesce(auth.jwt() -> 'user_metadata' ->> 'project', '') = ''
  and coalesce(auth.jwt() -> 'user_metadata' ->> 'role', '') <> 'fleet_manager'
);

drop policy if exists "admin can update drivers" on public.drivers;
create policy "admin can update drivers"
on public.drivers for update
to authenticated
using (
  coalesce(auth.jwt() -> 'user_metadata' ->> 'project', '') = ''
  and coalesce(auth.jwt() -> 'user_metadata' ->> 'role', '') <> 'fleet_manager'
)
with check (
  coalesce(auth.jwt() -> 'user_metadata' ->> 'project', '') = ''
  and coalesce(auth.jwt() -> 'user_metadata' ->> 'role', '') <> 'fleet_manager'
);
