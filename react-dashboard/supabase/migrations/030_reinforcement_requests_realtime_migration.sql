-- ============================================================
-- 030_reinforcement_requests_realtime_migration.sql
-- Enable Supabase Realtime on reinforcement_requests so the
-- dashboard can show a live toast the moment a driver submits a
-- new reinforcement (fuel) request, without needing a refresh.
-- Delivery is filtered by the existing RLS SELECT policy, so a
-- project-scoped manager only gets notified about their project's
-- drivers, while the main admin account gets all of them.
-- ============================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reinforcement_requests'
  ) then
    alter publication supabase_realtime add table public.reinforcement_requests;
  end if;
end $$;
