-- =====================================================================
-- 053_fleet_manager_permissions.sql
--
-- Goal: give fleet_manager (all projects) a precise role, without changing
-- what admin and project_supervisor can do.
--
--   fleet_manager can:
--     * READ  : shift_entries, reinforcement_requests, driver_attendance,
--               submission_reasons, automatic_fuel_allocations, drivers,
--               vehicles, fuel_invoice_records           (all projects)
--     * WRITE : vehicles and drivers - insert and update only
--     * ACTIVE/INACTIVE: only through set_active_status() (deactivate needs
--               a reason of 10+ characters; reactivate: optional). Every such
--               change by a fleet manager creates a notification for admins.
--     * DELETE: drivers can only be deleted by an admin (as today).
--   fleet_manager can NOT: add/edit/delete shift_entries, approve or reject
--     reinforcement_requests, edit attendance or submission reasons, edit
--     fuel_invoice_records, delete drivers, change is_active directly.
--   Also: fuel_invoice_records and fuel_invoice_da_directory become readable
--     by admin + fleet_manager only (they were readable by any signed-in user).
--
-- Today fleet_manager is covered by private.has_full_access() (= admin OR
-- fleet_manager), which is why it could write almost everywhere. This file
-- replaces every use of has_full_access() with explicit helpers.
--
-- Prerequisite: 050 parts 0-3 have been run (private.app_role(),
-- private.app_project() exist and policies use app_metadata).
-- Everything below runs in ONE transaction: if anything fails, nothing changes.
-- Users do not need to log out: roles are read from the JWT as before.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1) Helper functions (in the private schema, like app_role/app_project)
-- ---------------------------------------------------------------------
create or replace function private.is_admin() returns boolean
language sql stable
as $$
  select private.app_role() = 'admin'
$$;

create or replace function private.is_fleet_manager() returns boolean
language sql stable
as $$
  select private.app_role() = 'fleet_manager'
$$;

-- A project supervisor is checked by ROLE as well as project, so a
-- fleet_manager that happens to carry a project value never gets the
-- supervisor's write access.
create or replace function private.is_project_supervisor() returns boolean
language sql stable
as $$
  select private.app_role() = 'project_supervisor' and private.app_project() is not null
$$;

revoke all on function private.is_admin()              from public, anon;
revoke all on function private.is_fleet_manager()      from public, anon;
revoke all on function private.is_project_supervisor() from public, anon;
grant execute on function private.is_admin()              to authenticated;
grant execute on function private.is_fleet_manager()      to authenticated;
grant execute on function private.is_project_supervisor() to authenticated;


-- ---------------------------------------------------------------------
-- 2) vehicles  (fleet_manager: insert + update; admin: same; no delete policy)
--    The existing "anon/authenticated can view vehicles" policies stay.
-- ---------------------------------------------------------------------
drop policy if exists "admin can insert vehicles" on public.vehicles;
create policy "admin or fleet manager insert vehicles" on public.vehicles
  for insert to authenticated
  with check (private.is_admin() or private.is_fleet_manager());

drop policy if exists "admin can update vehicles" on public.vehicles;
create policy "admin or fleet manager update vehicles" on public.vehicles
  for update to authenticated
  using (private.is_admin() or private.is_fleet_manager())
  with check (private.is_admin() or private.is_fleet_manager());


-- ---------------------------------------------------------------------
-- 3) drivers  (read all projects; insert/update for fleet_manager; DELETE admin only)
--    "anon can view drivers" is handled separately by 052.
-- ---------------------------------------------------------------------
drop policy if exists "scoped view drivers" on public.drivers;
create policy "scoped view drivers" on public.drivers
  for select to authenticated
  using (
    private.is_admin()
    or private.is_fleet_manager()
    or (private.is_project_supervisor() and project = private.app_project())
  );

drop policy if exists "admin can insert drivers" on public.drivers;
create policy "admin or fleet manager insert drivers" on public.drivers
  for insert to authenticated
  with check (private.is_admin() or private.is_fleet_manager());

drop policy if exists "admin can update drivers" on public.drivers;
create policy "admin or fleet manager update drivers" on public.drivers
  for update to authenticated
  using (private.is_admin() or private.is_fleet_manager())
  with check (private.is_admin() or private.is_fleet_manager());

drop policy if exists "admin can delete drivers" on public.drivers;
create policy "admin can delete drivers" on public.drivers
  for delete to authenticated
  using (private.is_admin());


-- ---------------------------------------------------------------------
-- 4) shift_entries  (fleet_manager: READ only)
-- ---------------------------------------------------------------------
drop policy if exists "scoped view shift_entries" on public.shift_entries;
create policy "scoped view shift_entries" on public.shift_entries
  for select to authenticated
  using (
    private.is_admin()
    or private.is_fleet_manager()
    or (
      private.is_project_supervisor()
      and exists (
        select 1 from public.drivers d
        where d.identity_number = shift_entries.identity_number
          and d.project = private.app_project()
      )
    )
  );

drop policy if exists "scoped insert shift_entries" on public.shift_entries;
create policy "scoped insert shift_entries" on public.shift_entries
  for insert to authenticated
  with check (
    private.is_admin()
    or (
      private.is_project_supervisor()
      and exists (
        select 1 from public.drivers d
        where d.identity_number = shift_entries.identity_number
          and d.project = private.app_project()
      )
    )
  );

drop policy if exists "scoped update shift_entries" on public.shift_entries;
create policy "scoped update shift_entries" on public.shift_entries
  for update to authenticated
  using (
    private.is_admin()
    or (
      private.is_project_supervisor()
      and exists (
        select 1 from public.drivers d
        where d.identity_number = shift_entries.identity_number
          and d.project = private.app_project()
      )
    )
  )
  with check (
    private.is_admin()
    or (
      private.is_project_supervisor()
      and exists (
        select 1 from public.drivers d
        where d.identity_number = shift_entries.identity_number
          and d.project = private.app_project()
      )
    )
  );

drop policy if exists "scoped delete shift_entries" on public.shift_entries;
create policy "scoped delete shift_entries" on public.shift_entries
  for delete to authenticated
  using (
    private.is_admin()
    or (
      private.is_project_supervisor()
      and exists (
        select 1 from public.drivers d
        where d.identity_number = shift_entries.identity_number
          and d.project = private.app_project()
      )
    )
  );


-- ---------------------------------------------------------------------
-- 5) reinforcement_requests  (fleet_manager: READ only; approve/reject = admin only)
-- ---------------------------------------------------------------------
drop policy if exists "scoped view reinforcement_requests" on public.reinforcement_requests;
create policy "scoped view reinforcement_requests" on public.reinforcement_requests
  for select to authenticated
  using (
    private.is_admin()
    or private.is_fleet_manager()
    or (
      private.is_project_supervisor()
      and exists (
        select 1 from public.drivers d
        where d.identity_number = reinforcement_requests.identity_number
          and d.project = private.app_project()
      )
    )
  );

drop policy if exists "admin can update reinforcement_requests" on public.reinforcement_requests;
create policy "admin can update reinforcement_requests" on public.reinforcement_requests
  for update to authenticated
  using (private.is_admin())
  with check (private.is_admin());


-- ---------------------------------------------------------------------
-- 6) driver_attendance  (fleet_manager: READ only)
-- ---------------------------------------------------------------------
drop policy if exists "scoped select driver_attendance" on public.driver_attendance;
create policy "scoped select driver_attendance" on public.driver_attendance
  for select to authenticated
  using (
    private.is_admin()
    or private.is_fleet_manager()
    or (private.is_project_supervisor() and project = private.app_project())
  );

drop policy if exists "scoped insert driver_attendance" on public.driver_attendance;
create policy "scoped insert driver_attendance" on public.driver_attendance
  for insert to authenticated
  with check (
    private.is_admin()
    or (
      private.is_project_supervisor()
      and exists (
        select 1 from public.drivers d
        where d.identity_number = driver_attendance.identity_number
          and d.project = private.app_project()
      )
    )
  );

drop policy if exists "scoped update driver_attendance" on public.driver_attendance;
create policy "scoped update driver_attendance" on public.driver_attendance
  for update to authenticated
  using (
    private.is_admin()
    or (
      private.is_project_supervisor()
      and exists (
        select 1 from public.drivers d
        where d.identity_number = driver_attendance.identity_number
          and d.project = private.app_project()
      )
    )
  )
  with check (
    private.is_admin()
    or (
      private.is_project_supervisor()
      and exists (
        select 1 from public.drivers d
        where d.identity_number = driver_attendance.identity_number
          and d.project = private.app_project()
      )
    )
  );

drop policy if exists "admin delete driver_attendance" on public.driver_attendance;
create policy "admin delete driver_attendance" on public.driver_attendance
  for delete to authenticated
  using (private.is_admin());


-- ---------------------------------------------------------------------
-- 7) submission_reasons  (fleet_manager: READ only)
-- ---------------------------------------------------------------------
drop policy if exists "scoped select submission_reasons" on public.submission_reasons;
create policy "scoped select submission_reasons" on public.submission_reasons
  for select to authenticated
  using (
    private.is_admin()
    or private.is_fleet_manager()
    or (private.is_project_supervisor() and project = private.app_project())
  );

drop policy if exists "scoped insert submission_reasons" on public.submission_reasons;
create policy "scoped insert submission_reasons" on public.submission_reasons
  for insert to authenticated
  with check (
    private.is_admin()
    or (
      private.is_project_supervisor()
      and exists (
        select 1 from public.drivers d
        where d.identity_number = submission_reasons.identity_number
          and d.project = private.app_project()
      )
    )
  );

drop policy if exists "scoped update submission_reasons" on public.submission_reasons;
create policy "scoped update submission_reasons" on public.submission_reasons
  for update to authenticated
  using (
    private.is_admin()
    or (
      private.is_project_supervisor()
      and exists (
        select 1 from public.drivers d
        where d.identity_number = submission_reasons.identity_number
          and d.project = private.app_project()
      )
    )
  )
  with check (
    private.is_admin()
    or (
      private.is_project_supervisor()
      and exists (
        select 1 from public.drivers d
        where d.identity_number = submission_reasons.identity_number
          and d.project = private.app_project()
      )
    )
  );


-- ---------------------------------------------------------------------
-- 8) automatic_fuel_allocations  (READ: admin + fleet_manager + supervisor of the project)
-- ---------------------------------------------------------------------
drop policy if exists "scoped select automatic_fuel_allocations" on public.automatic_fuel_allocations;
create policy "scoped select automatic_fuel_allocations" on public.automatic_fuel_allocations
  for select to authenticated
  using (
    private.is_admin()
    or private.is_fleet_manager()
    or (private.is_project_supervisor() and project = private.app_project())
  );


-- ---------------------------------------------------------------------
-- 9) fuel_invoice_records + fuel_invoice_da_directory
--    READ  : admin and fleet_manager only (was: any signed-in user).
--    WRITE : admin only (fleet_manager is read-only here).
--    Nothing else depends on these tables: only the Fuel & Invoice pages use
--    them (through useFuelInvoiceRecords / useFuelInvoiceDaDirectory), no
--    function, view or public form touches them, and project supervisors have
--    no page for them.
-- ---------------------------------------------------------------------
drop policy if exists "authenticated can view fuel_invoice_records" on public.fuel_invoice_records;
create policy "admin or fleet manager view fuel_invoice_records" on public.fuel_invoice_records
  for select to authenticated
  using (private.is_admin() or private.is_fleet_manager());

drop policy if exists "authenticated can view fuel_invoice_da_directory" on public.fuel_invoice_da_directory;
create policy "admin or fleet manager view fuel_invoice_da_directory" on public.fuel_invoice_da_directory
  for select to authenticated
  using (private.is_admin() or private.is_fleet_manager());

drop policy if exists "admin can insert fuel_invoice_records" on public.fuel_invoice_records;
create policy "admin can insert fuel_invoice_records" on public.fuel_invoice_records
  for insert to authenticated
  with check (private.is_admin());

drop policy if exists "admin can update fuel_invoice_records" on public.fuel_invoice_records;
create policy "admin can update fuel_invoice_records" on public.fuel_invoice_records
  for update to authenticated
  using (private.is_admin())
  with check (private.is_admin());

drop policy if exists "admin can delete fuel_invoice_records" on public.fuel_invoice_records;
create policy "admin can delete fuel_invoice_records" on public.fuel_invoice_records
  for delete to authenticated
  using (private.is_admin());


-- ---------------------------------------------------------------------
-- 10) Guard: nobody but an admin can change is_active on drivers / vehicles
--     directly. A fleet_manager's change has to go through set_active_status()
--     (section 12), which is what records the notification.
--
--     How the guard tells them apart: a direct UPDATE from the dashboard runs
--     as the "authenticated" database role; the same UPDATE issued from inside
--     a SECURITY DEFINER function runs as the function's owner. So the guard
--     only blocks the direct path, and cannot be faked from the browser.
--     SQL Editor / service-role access is not blocked.
-- ---------------------------------------------------------------------
create or replace function private.guard_is_active_change() returns trigger
language plpgsql
as $$
begin
  if new.is_active is distinct from old.is_active
     and current_user in ('authenticated', 'anon')
     and not private.is_admin() then
    raise exception 'is_active can only be changed through set_active_status()'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_is_active_change on public.drivers;
create trigger guard_is_active_change
  before update of is_active on public.drivers
  for each row execute function private.guard_is_active_change();

drop trigger if exists guard_is_active_change on public.vehicles;
create trigger guard_is_active_change
  before update of is_active on public.vehicles
  for each row execute function private.guard_is_active_change();


-- ---------------------------------------------------------------------
-- 11) admin_notifications
--     Written ONLY by set_active_status(); read by admins only; marked as read
--     ONLY through mark_admin_notifications_read(). No direct insert/update/
--     delete for anybody. Every value is set in the database.
-- ---------------------------------------------------------------------
create table if not exists public.admin_notifications (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('deactivate', 'reactivate')),
  target_type    text not null check (target_type in ('driver', 'vehicle')),
  target_key     text not null,   -- drivers.identity_number or vehicles.vehicle_plate
  target_label   text,            -- driver name / plate at the time
  reason         text,
  acted_by       uuid not null default auth.uid(),
  acted_by_email text,
  created_at     timestamptz not null default now(),
  is_read        boolean not null default false,
  read_at        timestamptz,
  read_by        uuid
);

create index if not exists admin_notifications_unread_idx
  on public.admin_notifications (is_read, created_at desc);

alter table public.admin_notifications enable row level security;

revoke all on public.admin_notifications from anon, authenticated;
grant select on public.admin_notifications to authenticated;

drop policy if exists "admin reads admin_notifications" on public.admin_notifications;
create policy "admin reads admin_notifications" on public.admin_notifications
  for select to authenticated
  using (private.is_admin());

-- Live updates for the bell (RLS above still applies to realtime).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'admin_notifications'
  ) then
    alter publication supabase_realtime add table public.admin_notifications;
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 12) set_active_status(): the ONLY way a fleet_manager can deactivate or
--     reactivate a driver or a vehicle. Also usable by an admin.
--       deactivate (p_active = false): reason required, 10+ characters
--       reactivate (p_active = true) : reason optional
--     If the caller is not an admin, a row is added to admin_notifications.
--     Nothing is ever deleted.
-- ---------------------------------------------------------------------
create or replace function public.set_active_status(
  p_target_type text,
  p_target_key  text,
  p_active      boolean,
  p_reason      text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason   text := nullif(btrim(coalesce(p_reason, '')), '');
  v_is_admin boolean := private.is_admin();
  v_label    text;
  v_current  boolean;
begin
  if not (v_is_admin or private.is_fleet_manager()) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_target_type is null or p_target_type not in ('driver', 'vehicle') then
    raise exception 'INVALID_TARGET_TYPE';
  end if;
  if p_active is null then
    raise exception 'INVALID_ACTIVE';
  end if;
  if p_active = false and (v_reason is null or char_length(v_reason) < 10) then
    raise exception 'REASON_REQUIRED';
  end if;

  if p_target_type = 'driver' then
    select d.full_name, d.is_active into v_label, v_current
    from public.drivers d where d.identity_number = p_target_key for update;
  else
    select v.vehicle_plate, v.is_active into v_label, v_current
    from public.vehicles v where v.vehicle_plate = p_target_key for update;
  end if;

  if not found then
    raise exception 'TARGET_NOT_FOUND';
  end if;
  if coalesce(v_current, true) = p_active then
    raise exception 'NO_CHANGE';
  end if;

  if p_target_type = 'driver' then
    update public.drivers set is_active = p_active where identity_number = p_target_key;
  else
    update public.vehicles set is_active = p_active where vehicle_plate = p_target_key;
  end if;

  if not v_is_admin then
    insert into public.admin_notifications
      (kind, target_type, target_key, target_label, reason, acted_by, acted_by_email)
    values
      (case when p_active then 'reactivate' else 'deactivate' end,
       p_target_type, p_target_key, v_label, v_reason, auth.uid(), auth.jwt() ->> 'email');
  end if;
end;
$$;

revoke all on function public.set_active_status(text, text, boolean, text) from public, anon;
grant execute on function public.set_active_status(text, text, boolean, text) to authenticated;


-- ---------------------------------------------------------------------
-- 13) mark_admin_notifications_read(): admin only.
--     p_ids = the notifications to mark; null = all unread. Returns how many.
-- ---------------------------------------------------------------------
create or replace function public.mark_admin_notifications_read(p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not private.is_admin() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  with u as (
    update public.admin_notifications
    set is_read = true, read_at = now(), read_by = auth.uid()
    where is_read = false
      and (p_ids is null or id = any (p_ids))
    returning 1
  )
  select count(*)::integer into v_count from u;

  return v_count;
end;
$$;

revoke all on function public.mark_admin_notifications_read(uuid[]) from public, anon;
grant execute on function public.mark_admin_notifications_read(uuid[]) to authenticated;

notify pgrst, 'reload schema';

commit;


-- =====================================================================
-- VERIFY (run each separately, after the transaction above)
-- =====================================================================

-- (a) No POLICY should still use has_full_access() or user_metadata.  Expect 0 rows.
--   select tablename, policyname from pg_policies
--   where schemaname = 'public'
--     and (coalesce(qual, '') ilike '%has_full_access%' or coalesce(with_check, '') ilike '%has_full_access%'
--          or coalesce(qual, '') ilike '%user_metadata%' or coalesce(with_check, '') ilike '%user_metadata%');
--
-- (b) No FUNCTION should still use has_full_access() (or user_metadata) in its body.
--     Expect 0 rows.  (has_full_access itself is excluded.)
--   select n.nspname as schema, p.proname as function
--   from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname in ('public', 'private')
--     and p.prokind = 'f'
--     and p.proname <> 'has_full_access'
--     and (pg_get_functiondef(p.oid) ilike '%has_full_access%'
--          or pg_get_functiondef(p.oid) ilike '%user_metadata%');
--
-- (c) Nothing else in the database depends on it (policies, defaults, triggers, views...).
--     Expect 0 rows.
--   select classid::regclass as kind, objid, deptype
--   from pg_depend
--   where refobjid = 'private.has_full_access()'::regprocedure
--     and deptype = 'n';
--
-- (d) Only when (a), (b) and (c) are all empty, the old helper can go:
--   drop function if exists private.has_full_access();
--
-- (e) The new functions are not callable by anon.  Expect false, false.
--   select has_function_privilege('anon', 'public.set_active_status(text,text,boolean,text)', 'execute'),
--          has_function_privilege('anon', 'public.mark_admin_notifications_read(uuid[])', 'execute');
--
-- (f) Simulate a fleet manager and a supervisor (read-only checks, rolled back).
--     Expect: fleet manager sees rows in shift_entries and fuel_invoice_records;
--     the supervisor sees 0 rows in fuel_invoice_records.
--   begin;
--     set local role authenticated;
--     select set_config('request.jwt.claims',
--       '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated","app_metadata":{"role":"fleet_manager"}}', true);
--     select (select count(*) from public.shift_entries)       as shift_entries,
--            (select count(*) from public.fuel_invoice_records) as fuel_invoice_records;
--   rollback;
--   begin;
--     set local role authenticated;
--     select set_config('request.jwt.claims',
--       '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated","app_metadata":{"role":"project_supervisor","project":"FDP"}}', true);
--     select (select count(*) from public.fuel_invoice_records) as fuel_invoice_records;   -- expect 0
--   rollback;


-- =====================================================================
-- NOTES
-- =====================================================================
-- * Deactivation by an admin is not logged (only a non-admin's action creates
--   an admin_notifications row).  Say so if you want an audit log for admins too.
-- * Roll back: re-run section 3 of 050_move_roles_to_app_metadata.sql (it
--   restores the has_full_access() policies), and restore the two
--   "authenticated can view ..." policies for the fuel invoice tables, then:
--     drop table if exists public.admin_notifications;
--     drop function if exists public.set_active_status(text, text, boolean, text);
--     drop function if exists public.mark_admin_notifications_read(uuid[]);
--     drop trigger if exists guard_is_active_change on public.drivers;
--     drop trigger if exists guard_is_active_change on public.vehicles;
-- =====================================================================
