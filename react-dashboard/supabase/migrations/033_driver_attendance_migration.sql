-- ============================================================
-- 033_driver_attendance_migration.sql
-- New: public.driver_attendance — a daily present/leave/absent
-- status per driver, independent of shift_entries (which only
-- records actual check-in/out events, not planned attendance).
--
-- This is the foundation for the "Attendance Conflict" feature
-- (a fuel/reinforcement request landing on a day the driver is
-- marked leave/absent) and a future signal for FDP daily fuel
-- allocation eligibility. A driver with no row for a given date
-- is treated as "present" by the app (no need to mark everyone
-- every day — only exceptions need a row).
-- ============================================================

create table if not exists public.driver_attendance (
  id uuid primary key default gen_random_uuid(),
  identity_number text not null,
  project text not null,
  attendance_date date not null default current_date,
  status text not null default 'present' check (status in ('present', 'leave', 'absent')),
  marked_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (identity_number, attendance_date)
);

alter table public.driver_attendance enable row level security;

-- SELECT: admin sees all; a project-scoped account (manager or fleet manager,
-- both have no `project` claim... only true project managers do) sees only
-- their own project's rows — same idiom as drivers/shift_entries.
drop policy if exists "scoped select driver_attendance" on public.driver_attendance;
create policy "scoped select driver_attendance"
on public.driver_attendance for select
to authenticated
using (
  coalesce(auth.jwt() -> 'user_metadata' ->> 'project', '') = ''
  or project = (auth.jwt() -> 'user_metadata' ->> 'project')
);

-- INSERT: admin, or a project-scoped manager marking one of their own
-- project's drivers (mirrors the shift_entries scoped-insert policy, 032).
drop policy if exists "scoped insert driver_attendance" on public.driver_attendance;
create policy "scoped insert driver_attendance"
on public.driver_attendance for insert
to authenticated
with check (
  coalesce(auth.jwt() -> 'user_metadata' ->> 'project', '') = ''
  or exists (
    select 1 from public.drivers d
    where d.identity_number = driver_attendance.identity_number
      and d.project = (auth.jwt() -> 'user_metadata' ->> 'project')
  )
);

-- UPDATE: same scoping as insert.
drop policy if exists "scoped update driver_attendance" on public.driver_attendance;
create policy "scoped update driver_attendance"
on public.driver_attendance for update
to authenticated
using (
  coalesce(auth.jwt() -> 'user_metadata' ->> 'project', '') = ''
  or exists (
    select 1 from public.drivers d
    where d.identity_number = driver_attendance.identity_number
      and d.project = (auth.jwt() -> 'user_metadata' ->> 'project')
  )
)
with check (
  coalesce(auth.jwt() -> 'user_metadata' ->> 'project', '') = ''
  or exists (
    select 1 from public.drivers d
    where d.identity_number = driver_attendance.identity_number
      and d.project = (auth.jwt() -> 'user_metadata' ->> 'project')
  )
);

-- DELETE: admin-only, matching the drivers-delete precedent (016).
drop policy if exists "admin delete driver_attendance" on public.driver_attendance;
create policy "admin delete driver_attendance"
on public.driver_attendance for delete
to authenticated
using (coalesce(auth.jwt() -> 'user_metadata' ->> 'project', '') = '');

grant select, insert, update, delete on public.driver_attendance to authenticated;

-- Realtime, added in the same migration that creates the table this time
-- (030/031 had to patch this in after the fact for other tables).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'driver_attendance'
  ) then
    alter publication supabase_realtime add table public.driver_attendance;
  end if;
end $$;
