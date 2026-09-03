-- ============================================================
-- 029_shift_entries_insert_policy_migration.sql
-- Allow the main admin account to INSERT into shift_entries.
-- Needed so a deleted record (Records / Form Response page) can
-- be restored via the new Ctrl+Z undo feature — previously only
-- SELECT/UPDATE/DELETE policies existed for authenticated users.
-- ============================================================

grant insert on public.shift_entries to authenticated;

drop policy if exists "admin can insert shift_entries" on public.shift_entries;
create policy "admin can insert shift_entries"
on public.shift_entries for insert
to authenticated
with check (coalesce(auth.jwt() -> 'user_metadata' ->> 'project', '') = '');
