-- ============================================================
-- 031_shift_entries_realtime_migration.sql
-- Enable Supabase Realtime on shift_entries too — 030 only
-- enabled it for reinforcement_requests, which is why "new shift
-- registration" notifications never fired even though "new fuel
-- request" ones did.
-- ============================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shift_entries'
  ) then
    alter publication supabase_realtime add table public.shift_entries;
  end if;
end $$;
