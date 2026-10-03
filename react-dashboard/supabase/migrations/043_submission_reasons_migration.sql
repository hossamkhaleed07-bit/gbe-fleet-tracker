-- ============================================================
-- 043_submission_reasons_migration.sql
-- New: public.submission_reasons — an operations-team annotation
-- (standardized Reason dropdown + free-text Notes) attached to a
-- driver-day that has an incomplete or missing shift submission
-- (Start Only / End Only / Non Submitted on Project Performance).
--
-- Keyed by (identity_number, shift_date) rather than a shift_entries
-- id, because a "Non Submitted" day has NO shift_entries row at all
-- (Project Performance/Records synthesize that row client-side) — so
-- this table must be able to hold an annotation independent of
-- whether any shift_entries row exists for that driver-day.
--
-- RLS mirrors driver_attendance (033): admin (no project claim) sees
-- and edits everything; a project-scoped account only their own
-- project's drivers. No delete policy — not part of this feature's
-- spec, nothing in the app deletes these rows.
-- ============================================================

create table if not exists public.submission_reasons (
  id uuid primary key default gen_random_uuid(),
  identity_number text not null,
  shift_date date not null,
  project text,
  reason text,
  notes text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (identity_number, shift_date)
);

alter table public.submission_reasons enable row level security;

drop policy if exists "scoped select submission_reasons" on public.submission_reasons;
create policy "scoped select submission_reasons"
on public.submission_reasons for select
to authenticated
using (
  coalesce(auth.jwt() -> 'user_metadata' ->> 'project', '') = ''
  or project = (auth.jwt() -> 'user_metadata' ->> 'project')
);

drop policy if exists "scoped insert submission_reasons" on public.submission_reasons;
create policy "scoped insert submission_reasons"
on public.submission_reasons for insert
to authenticated
with check (
  coalesce(auth.jwt() -> 'user_metadata' ->> 'project', '') = ''
  or exists (
    select 1 from public.drivers d
    where d.identity_number = submission_reasons.identity_number
      and d.project = (auth.jwt() -> 'user_metadata' ->> 'project')
  )
);

drop policy if exists "scoped update submission_reasons" on public.submission_reasons;
create policy "scoped update submission_reasons"
on public.submission_reasons for update
to authenticated
using (
  coalesce(auth.jwt() -> 'user_metadata' ->> 'project', '') = ''
  or exists (
    select 1 from public.drivers d
    where d.identity_number = submission_reasons.identity_number
      and d.project = (auth.jwt() -> 'user_metadata' ->> 'project')
  )
)
with check (
  coalesce(auth.jwt() -> 'user_metadata' ->> 'project', '') = ''
  or exists (
    select 1 from public.drivers d
    where d.identity_number = submission_reasons.identity_number
      and d.project = (auth.jwt() -> 'user_metadata' ->> 'project')
  )
);

grant select, insert, update on public.submission_reasons to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'submission_reasons'
  ) then
    alter publication supabase_realtime add table public.submission_reasons;
  end if;
end $$;

notify pgrst, 'reload schema';
