-- Tag the account as a fleet manager (edit-only access to vehicles & drivers)
update auth.users set raw_user_meta_data = raw_user_meta_data || '{"role":"fleet_manager"}'::jsonb where email = 'fleet.manager@gbe.sa';

-- shift_entries: fleet managers get no access at all
drop policy if exists "scoped view shift_entries" on public.shift_entries;
create policy "scoped view shift_entries"
on public.shift_entries for select
to authenticated
using (
  coalesce(auth.jwt() -> 'user_metadata' ->> 'role', '') <> 'fleet_manager'
  and (
    coalesce(auth.jwt() -> 'user_metadata' ->> 'project', '') = ''
    or exists (
      select 1 from public.drivers d
      where d.identity_number = shift_entries.identity_number
        and d.project = (auth.jwt() -> 'user_metadata' ->> 'project')
    )
  )
);

drop policy if exists "admin can update shift_entries" on public.shift_entries;
create policy "admin can update shift_entries"
on public.shift_entries for update
to authenticated
using (
  coalesce(auth.jwt() -> 'user_metadata' ->> 'project', '') = ''
  and coalesce(auth.jwt() -> 'user_metadata' ->> 'role', '') <> 'fleet_manager'
)
with check (
  coalesce(auth.jwt() -> 'user_metadata' ->> 'project', '') = ''
  and coalesce(auth.jwt() -> 'user_metadata' ->> 'role', '') <> 'fleet_manager'
);

drop policy if exists "admin can delete shift_entries" on public.shift_entries;
create policy "admin can delete shift_entries"
on public.shift_entries for delete
to authenticated
using (
  coalesce(auth.jwt() -> 'user_metadata' ->> 'project', '') = ''
  and coalesce(auth.jwt() -> 'user_metadata' ->> 'role', '') <> 'fleet_manager'
);
