-- ============================================================
-- Tag each manager account with their project
-- ============================================================
update auth.users set raw_user_meta_data = raw_user_meta_data || '{"project":"FDP"}'::jsonb where email = 'fdp.manager@gbe.sa';
update auth.users set raw_user_meta_data = raw_user_meta_data || '{"project":"ADM"}'::jsonb where email = 'adm.manager@gbe.sa';
update auth.users set raw_user_meta_data = raw_user_meta_data || '{"project":"LMS"}'::jsonb where email = 'lms.manager@gbe.sa';
update auth.users set raw_user_meta_data = raw_user_meta_data || '{"project":"JDL"}'::jsonb where email = 'jdl.manager@gbe.sa';
update auth.users set raw_user_meta_data = raw_user_meta_data || '{"project":"SHC"}'::jsonb where email = 'shc.manager@gbe.sa';

-- ============================================================
-- shift_entries: scoped SELECT by project, UPDATE/DELETE admin-only
-- ============================================================
drop policy if exists "authenticated can view shift_entries" on public.shift_entries;
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

drop policy if exists "authenticated can update shift_entries" on public.shift_entries;
create policy "admin can update shift_entries"
on public.shift_entries for update
to authenticated
using (coalesce(auth.jwt() -> 'user_metadata' ->> 'project', '') = '')
with check (coalesce(auth.jwt() -> 'user_metadata' ->> 'project', '') = '');

drop policy if exists "authenticated can delete shift_entries" on public.shift_entries;
create policy "admin can delete shift_entries"
on public.shift_entries for delete
to authenticated
using (coalesce(auth.jwt() -> 'user_metadata' ->> 'project', '') = '');

-- ============================================================
-- drivers: scoped SELECT by project
-- ============================================================
drop policy if exists "authenticated can view drivers" on public.drivers;
create policy "scoped view drivers"
on public.drivers for select
to authenticated
using (
  coalesce(auth.jwt() -> 'user_metadata' ->> 'project', '') = ''
  or project = (auth.jwt() -> 'user_metadata' ->> 'project')
);
