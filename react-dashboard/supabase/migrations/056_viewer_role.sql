begin;

-- =====================================================================
-- 056  viewer role (read only)
--
--  A "viewer" is an account with app_metadata.role = 'viewer'.  It can READ, for
--  ALL projects, exactly what the seven pages it may open need:
--
--     Overview, Form Response, Records, Attendance, Driver Report,
--     Driver Performance (+ project / driver detail), Station Report
--
--     shift_entries              (every one of the seven)
--     drivers                    (Overview, Form Response, Records, Attendance, Driver Report,
--                                 Driver Performance)
--     vehicles                   (Overview, Records, Driver Report)    - already readable
--     stations                   (Overview, Records, Driver Report)    - already readable
--     reinforcement_requests     (Overview, Records, Driver Report, Driver Performance:
--                                 approved fuel and loan adjustments)
--     automatic_fuel_allocations (Overview, Records, Driver Report, Driver Performance)
--     driver_attendance          (Overview, Attendance, Driver Performance)
--
--  NOT readable by a viewer:  fuel_invoice_records, fuel_invoice_da_directory,
--  admin_notifications, submission_reasons (no page of the seven uses it).
--
--  A viewer can NOT write anything:
--   * a RESTRICTIVE policy on every table with row level security blocks INSERT,
--     UPDATE and DELETE for a viewer, even if some other policy would allow it;
--   * the two public-form functions (submit_shift_entry, submit_reinforcement_request)
--     run as the function owner, so a trigger on shift_entries and reinforcement_requests
--     refuses a viewer there;
--   * set_active_status and mark_admin_notifications_read already refuse every role
--     except admin / fleet manager / admin respectively.
--
--  ONE transaction: if anything fails, nothing changes.   Safe to run again.
--  Run it after 056_verify_before.sql looked right.
-- =====================================================================


-- 1) Helper
create or replace function private.is_viewer() returns boolean
language sql stable
as $$
  select private.app_role() = 'viewer'
$$;

revoke all on function private.is_viewer() from public, anon;
grant execute on function private.is_viewer() to authenticated;


-- 2) READ access: the same policies as 053, plus "or private.is_viewer()".

-- drivers
drop policy if exists "scoped view drivers" on public.drivers;
create policy "scoped view drivers" on public.drivers
  for select to authenticated
  using (
    private.is_admin()
    or private.is_fleet_manager()
    or private.is_viewer()
    or (private.is_project_supervisor() and project = private.app_project())
  );

-- shift_entries
drop policy if exists "scoped view shift_entries" on public.shift_entries;
create policy "scoped view shift_entries" on public.shift_entries
  for select to authenticated
  using (
    private.is_admin()
    or private.is_fleet_manager()
    or private.is_viewer()
    or (
      private.is_project_supervisor()
      and exists (
        select 1 from public.drivers d
        where d.identity_number = shift_entries.identity_number
          and d.project = private.app_project()
      )
    )
  );

-- reinforcement_requests
drop policy if exists "scoped view reinforcement_requests" on public.reinforcement_requests;
create policy "scoped view reinforcement_requests" on public.reinforcement_requests
  for select to authenticated
  using (
    private.is_admin()
    or private.is_fleet_manager()
    or private.is_viewer()
    or (
      private.is_project_supervisor()
      and exists (
        select 1 from public.drivers d
        where d.identity_number = reinforcement_requests.identity_number
          and d.project = private.app_project()
      )
    )
  );

-- driver_attendance
drop policy if exists "scoped select driver_attendance" on public.driver_attendance;
create policy "scoped select driver_attendance" on public.driver_attendance
  for select to authenticated
  using (
    private.is_admin()
    or private.is_fleet_manager()
    or private.is_viewer()
    or (private.is_project_supervisor() and project = private.app_project())
  );

-- automatic_fuel_allocations
drop policy if exists "scoped select automatic_fuel_allocations" on public.automatic_fuel_allocations;
create policy "scoped select automatic_fuel_allocations" on public.automatic_fuel_allocations
  for select to authenticated
  using (
    private.is_admin()
    or private.is_fleet_manager()
    or private.is_viewer()
    or (private.is_project_supervisor() and project = private.app_project())
  );

-- vehicles and stations: "authenticated can view ..." policies already let any signed-in
-- user read them, so a viewer needs nothing new there (056_verify_after.sql checks it).


-- 3) WRITE block: a restrictive policy per command on EVERY public table that has row
--    level security on.  Restrictive policies are AND-ed with the existing ones, so a
--    viewer is refused whatever else is (or will be) allowed on that table.
--    For everybody else the condition is simply true.
do $$
declare t record;
begin
  for t in
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
  loop
    execute format('drop policy if exists "viewer is read only (insert)" on public.%I', t.relname);
    execute format('create policy "viewer is read only (insert)" on public.%I as restrictive for insert to authenticated with check (not private.is_viewer())', t.relname);

    execute format('drop policy if exists "viewer is read only (update)" on public.%I', t.relname);
    execute format('create policy "viewer is read only (update)" on public.%I as restrictive for update to authenticated using (not private.is_viewer()) with check (not private.is_viewer())', t.relname);

    execute format('drop policy if exists "viewer is read only (delete)" on public.%I', t.relname);
    execute format('create policy "viewer is read only (delete)" on public.%I as restrictive for delete to authenticated using (not private.is_viewer())', t.relname);
  end loop;
end $$;


-- 4) READ block on the tables a viewer must never see (belt and braces: their normal
--    policies do not include a viewer anyway).
drop policy if exists "viewer cannot read fuel_invoice_records" on public.fuel_invoice_records;
create policy "viewer cannot read fuel_invoice_records" on public.fuel_invoice_records
  as restrictive for select to authenticated using (not private.is_viewer());

drop policy if exists "viewer cannot read fuel_invoice_da_directory" on public.fuel_invoice_da_directory;
create policy "viewer cannot read fuel_invoice_da_directory" on public.fuel_invoice_da_directory
  as restrictive for select to authenticated using (not private.is_viewer());

drop policy if exists "viewer cannot read admin_notifications" on public.admin_notifications;
create policy "viewer cannot read admin_notifications" on public.admin_notifications
  as restrictive for select to authenticated using (not private.is_viewer());


-- 5) The public-form functions are SECURITY DEFINER (they write as the table owner, so
--    row level security does not apply inside them).  These triggers refuse a viewer
--    at the table itself.  SECURITY DEFINER here too: the check needs no privileges
--    from whoever is calling.
create or replace function private.block_viewer_write() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.is_viewer() then
    raise exception 'VIEWER_READ_ONLY' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function private.block_viewer_write() from public, anon, authenticated;

drop trigger if exists block_viewer_write on public.shift_entries;
create trigger block_viewer_write
  before insert or update or delete on public.shift_entries
  for each row execute function private.block_viewer_write();

drop trigger if exists block_viewer_write on public.reinforcement_requests;
create trigger block_viewer_write
  before insert or update or delete on public.reinforcement_requests
  for each row execute function private.block_viewer_write();

notify pgrst, 'reload schema';

commit;
