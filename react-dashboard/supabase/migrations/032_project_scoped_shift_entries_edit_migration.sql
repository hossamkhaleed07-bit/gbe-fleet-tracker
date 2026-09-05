-- ============================================================
-- 032_project_scoped_shift_entries_edit_migration.sql
-- Let a project-scoped account (e.g. fdp.manager@gbe.sa) edit and
-- delete shift_entries rows for their own project's drivers —
-- previously UPDATE/DELETE was admin-only (project = ''), even
-- though SELECT was already scoped per-project.
-- ============================================================

drop policy if exists "admin can update shift_entries" on public.shift_entries;
create policy "scoped update shift_entries"
on public.shift_entries for update
to authenticated
using (
  coalesce(auth.jwt() -> 'user_metadata' ->> 'project', '') = ''
  or exists (
    select 1 from public.drivers d
    where d.identity_number = shift_entries.identity_number
      and d.project = (auth.jwt() -> 'user_metadata' ->> 'project')
  )
)
with check (
  coalesce(auth.jwt() -> 'user_metadata' ->> 'project', '') = ''
  or exists (
    select 1 from public.drivers d
    where d.identity_number = shift_entries.identity_number
      and d.project = (auth.jwt() -> 'user_metadata' ->> 'project')
  )
);

drop policy if exists "admin can delete shift_entries" on public.shift_entries;
create policy "scoped delete shift_entries"
on public.shift_entries for delete
to authenticated
using (
  coalesce(auth.jwt() -> 'user_metadata' ->> 'project', '') = ''
  or exists (
    select 1 from public.drivers d
    where d.identity_number = shift_entries.identity_number
      and d.project = (auth.jwt() -> 'user_metadata' ->> 'project')
  )
);

-- Also let a project-scoped account insert a restored row via the
-- Ctrl+Z undo feature (028) — same scoping as update/delete.
drop policy if exists "admin can insert shift_entries" on public.shift_entries;
create policy "scoped insert shift_entries"
on public.shift_entries for insert
to authenticated
with check (
  coalesce(auth.jwt() -> 'user_metadata' ->> 'project', '') = ''
  or exists (
    select 1 from public.drivers d
    where d.identity_number = shift_entries.identity_number
      and d.project = (auth.jwt() -> 'user_metadata' ->> 'project')
  )
);

-- Fuel/reinforcement requests are intentionally left admin-only for
-- UPDATE (approve/reject + loan adjustment stay project=''-only) —
-- project accounts can still SELECT and see them (already scoped),
-- they just can't decide on them. No change needed there.
