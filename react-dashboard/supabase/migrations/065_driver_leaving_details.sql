begin;

-- =====================================================================
-- 065_driver_leaving_details.sql
-- When a driver is deactivated: the LAST WORKING DAY, a REASON from a fixed
-- list, and an optional NOTE.  Plus a permanent history of every status,
-- leaving-details and project change of a driver.
--
-- 1) drivers: last_working_day, deactivation_reason (fixed list),
--    deactivation_note, deactivated_at, deactivated_by.  Only filled while
--    the driver is inactive (check constraint).
-- 2) A trigger on drivers captures EVERY path (set_active_status, an admin,
--    the SQL Editor):
--      * deactivate: deactivated_at / deactivated_by are set
--      * reactivate: all five are cleared (the history keeps the old values)
--      * nobody but an admin (or the functions below) can write the leaving
--        fields directly
--    and a second trigger writes driver_status_history (who, when, old/new:
--    active, project, last working day, reason, note).  Append-only.
-- 3) set_active_status(): for a DRIVER deactivation the free-text reason of
--    10+ characters is replaced by: last working day (required, not in the
--    future, not before the hiring date), reason code (required, from the
--    list), note (optional; required for 'other').  Vehicles are unchanged.
-- 4) set_driver_leaving_details(): admin only, corrects (or fills in) the
--    leaving details of a driver who is already inactive.  Logged.
-- 5) driver_activity_after(id, day): shift forms, approved reinforcement and
--    automatic fuel AFTER a day (the dialog warns before saving).
--
-- Additive: no existing value changes.  ONE transaction.  Undo: 065_rollback.sql.
-- =====================================================================

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'drivers' and column_name = 'last_working_day') then
    raise exception 'STOP: 065 is already installed (drivers.last_working_day exists).';
  end if;
  if to_regprocedure('public.set_active_status(text,text,boolean,text)') is null then
    raise exception 'STOP: set_active_status(text,text,boolean,text) from 053 not found.';
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 1) Columns
-- ---------------------------------------------------------------------

alter table public.drivers
  add column last_working_day date,
  add column deactivation_reason text,
  add column deactivation_note text,
  add column deactivated_at timestamptz,
  add column deactivated_by text,
  add constraint drivers_deactivation_reason_check check (deactivation_reason in (
    'resigned', 'terminated', 'absconded', 'contract_ended', 'final_exit',
    'transferred_out', 'medical', 'never_started', 'other')),
  add constraint drivers_leaving_only_when_inactive check (
    is_active = false
    or (last_working_day is null and deactivation_reason is null and deactivation_note is null
        and deactivated_at is null and deactivated_by is null));


-- ---------------------------------------------------------------------
-- 2) History (append-only) and the triggers
-- ---------------------------------------------------------------------

create table public.driver_status_history (
  id uuid primary key default gen_random_uuid(),
  identity_number text not null,
  change text not null check (change in ('deactivate', 'reactivate', 'leaving_details', 'project')),
  old_active boolean, new_active boolean,
  old_project text, new_project text,
  old_last_working_day date, new_last_working_day date,
  old_reason text, new_reason text,
  old_note text, new_note text,
  changed_by text,
  changed_at timestamptz not null default now()
);
create index driver_status_history_driver on public.driver_status_history (identity_number, changed_at desc);

alter table public.driver_status_history enable row level security;
revoke all on public.driver_status_history from public, anon, authenticated;
grant select on public.driver_status_history to authenticated;
create policy "admin and fleet manager read driver_status_history" on public.driver_status_history
  for select to authenticated using (private.is_admin() or private.is_fleet_manager());

create function private.driver_history_append_only() returns trigger
language plpgsql
as $$
begin
  raise exception 'driver_status_history is append-only' using errcode = '42501';
end;
$$;
create trigger driver_status_history_append_only before update or delete on public.driver_status_history
  for each row execute function private.driver_history_append_only();
create trigger driver_status_history_no_truncate before truncate on public.driver_status_history
  for each statement execute function private.driver_history_append_only();

-- Who made the change: the signed-in email, else the database role (SQL Editor).
create function private.driver_actor() returns text
language sql stable
as $$ select coalesce(nullif(auth.jwt() ->> 'email', ''), current_user::text) $$;

-- BEFORE UPDATE: stamp a deactivation, clear on reactivation, and keep the
-- leaving fields out of reach of a direct (non-admin) update from the browser.
-- A direct UPDATE from the dashboard runs as "authenticated"; one from inside a
-- SECURITY DEFINER function runs as its owner (same rule as 053's guard).
create function private.driver_leaving_before_update() returns trigger
language plpgsql
as $$
begin
  if old.is_active is distinct from new.is_active then
    if new.is_active = false then
      new.deactivated_at := now();
      new.deactivated_by := private.driver_actor();
    else
      new.last_working_day := null;
      new.deactivation_reason := null;
      new.deactivation_note := null;
      new.deactivated_at := null;
      new.deactivated_by := null;
    end if;
  elsif (new.last_working_day, new.deactivation_reason, new.deactivation_note, new.deactivated_at, new.deactivated_by)
        is distinct from
        (old.last_working_day, old.deactivation_reason, old.deactivation_note, old.deactivated_at, old.deactivated_by)
     and current_user in ('authenticated', 'anon')
     and not private.is_admin() then
    raise exception 'leaving details can only be changed through set_active_status() / set_driver_leaving_details()'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger driver_leaving_before_update before update on public.drivers
  for each row execute function private.driver_leaving_before_update();

-- AFTER UPDATE: one history row per change (SECURITY DEFINER: the person
-- changing the driver cannot write the history table themselves).
create function private.driver_status_history_log() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_change text;
begin
  if old.is_active is distinct from new.is_active then
    v_change := case when new.is_active then 'reactivate' else 'deactivate' end;
  elsif (old.last_working_day, old.deactivation_reason, old.deactivation_note)
        is distinct from (new.last_working_day, new.deactivation_reason, new.deactivation_note) then
    v_change := 'leaving_details';
  elsif old.project is distinct from new.project then
    v_change := 'project';
  else
    return null;
  end if;
  insert into public.driver_status_history (
    identity_number, change, old_active, new_active, old_project, new_project,
    old_last_working_day, new_last_working_day, old_reason, new_reason, old_note, new_note, changed_by)
  values (
    new.identity_number, v_change, old.is_active, new.is_active, old.project, new.project,
    old.last_working_day, new.last_working_day, old.deactivation_reason, new.deactivation_reason,
    old.deactivation_note, new.deactivation_note, private.driver_actor());
  return null;
end;
$$;
create trigger driver_status_history_log after update on public.drivers
  for each row execute function private.driver_status_history_log();


-- ---------------------------------------------------------------------
-- 3) set_active_status(): drivers get the leaving details; vehicles as in 053
-- ---------------------------------------------------------------------

-- Checks a driver's leaving details; returns the trimmed note.
create function private.driver_check_leaving(p_identity_number text, p_last_working_day date, p_reason_code text, p_note text)
returns text
language plpgsql stable
set search_path = public
as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_hired date;
begin
  if p_last_working_day is null then
    raise exception 'LAST_DAY_REQUIRED' using errcode = '22023';
  end if;
  if p_last_working_day > (now() at time zone 'Asia/Riyadh')::date then
    raise exception 'LAST_DAY_IN_FUTURE' using errcode = '22023';
  end if;
  select d.date_of_hiring into v_hired from public.drivers d where d.identity_number = p_identity_number;
  if v_hired is not null and p_last_working_day < v_hired then
    raise exception 'LAST_DAY_BEFORE_HIRING' using errcode = '22023';
  end if;
  if p_reason_code is null then
    raise exception 'REASON_CODE_REQUIRED' using errcode = '22023';
  end if;
  if p_reason_code not in ('resigned', 'terminated', 'absconded', 'contract_ended', 'final_exit',
                           'transferred_out', 'medical', 'never_started', 'other') then
    raise exception 'INVALID_REASON_CODE' using errcode = '22023';
  end if;
  if p_reason_code = 'other' and v_note is null then
    raise exception 'NOTE_REQUIRED' using errcode = '22023';
  end if;
  return v_note;
end;
$$;

drop function public.set_active_status(text, text, boolean, text);

create function public.set_active_status(
  p_target_type      text,
  p_target_key       text,
  p_active           boolean,
  p_reason           text default null,   -- vehicles: free text (10+ to deactivate); drivers: not used to deactivate
  p_last_working_day date default null,   -- drivers, deactivate: required
  p_reason_code      text default null,   -- drivers, deactivate: required, from the list
  p_note             text default null    -- drivers: optional ('other': required)
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
  v_note     text;
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
  if p_target_type = 'vehicle' and p_active = false and (v_reason is null or char_length(v_reason) < 10) then
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

  if p_target_type = 'driver' and p_active = false then
    v_note := private.driver_check_leaving(p_target_key, p_last_working_day, p_reason_code, p_note);
    update public.drivers
       set is_active = false, last_working_day = p_last_working_day,
           deactivation_reason = p_reason_code, deactivation_note = v_note
     where identity_number = p_target_key;
    v_reason := p_reason_code || ' | ' || to_char(p_last_working_day, 'YYYY-MM-DD') || coalesce(' | ' || v_note, '');
  elsif p_target_type = 'driver' then
    update public.drivers set is_active = true where identity_number = p_target_key;   -- the trigger clears the details
  elsif p_target_type = 'vehicle' then
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

revoke all on function public.set_active_status(text, text, boolean, text, date, text, text) from public, anon;
grant execute on function public.set_active_status(text, text, boolean, text, date, text, text) to authenticated;


-- ---------------------------------------------------------------------
-- 4) Correct / fill in the leaving details of an inactive driver (admin)
-- ---------------------------------------------------------------------

create function public.set_driver_leaving_details(p_identity_number text, p_last_working_day date, p_reason_code text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_active boolean;
  v_note text;
begin
  if not private.is_admin() then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  select d.is_active into v_active from public.drivers d where d.identity_number = p_identity_number for update;
  if not found then
    raise exception 'TARGET_NOT_FOUND';
  end if;
  if v_active then
    raise exception 'NOT_INACTIVE' using errcode = '22023';
  end if;
  v_note := private.driver_check_leaving(p_identity_number, p_last_working_day, p_reason_code, p_note);
  update public.drivers
     set last_working_day = p_last_working_day, deactivation_reason = p_reason_code, deactivation_note = v_note
   where identity_number = p_identity_number;
end;
$$;

revoke all on function public.set_driver_leaving_details(text, date, text, text) from public, anon;
grant execute on function public.set_driver_leaving_details(text, date, text, text) to authenticated;


-- ---------------------------------------------------------------------
-- 5) Activity after a day (the dialog's warning).  Admin / fleet manager.
--    Automatic fuel: voided days (064) are left out when 064 is installed.
-- ---------------------------------------------------------------------

create function public.driver_activity_after(p_identity_number text, p_day date)
returns table (
  form_days integer,
  reinforcement_count integer,
  reinforcement_sar numeric,
  automatic_count integer,
  automatic_sar numeric,
  first_day date,
  last_day date
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (private.is_admin() or private.is_fleet_manager()) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;
  if p_day is null then
    raise exception 'LAST_DAY_REQUIRED' using errcode = '22023';
  end if;
  return query
  with f as (
    select distinct s.shift_date as d from public.shift_entries s
    where s.identity_number = p_identity_number and s.shift_date > p_day
  ), r as (
    select r.shift_date as d, r.amount + coalesce(r.loan_adjustment, 0) as sar from public.reinforcement_requests r
    where r.identity_number = p_identity_number and r.shift_date > p_day and r.status = 'approved' and r.amount is not null
  ), a as (
    select a.allocation_date as d, a.amount as sar from public.automatic_fuel_allocations a
    where a.identity_number = p_identity_number and a.allocation_date > p_day
      and (to_jsonb(a) ->> 'voided_at') is null
  )
  select (select count(*) from f)::integer,
         (select count(*) from r)::integer,
         (select coalesce(sum(sar), 0) from r),
         (select count(*) from a)::integer,
         (select coalesce(sum(sar), 0) from a),
         (select min(d) from (select d from f union all select d from r union all select d from a) x),
         (select max(d) from (select d from f union all select d from r union all select d from a) x);
end;
$$;

revoke all on function public.driver_activity_after(text, date) from public, anon;
grant execute on function public.driver_activity_after(text, date) to authenticated;

revoke all on function private.driver_check_leaving(text, date, text, text), private.driver_actor()
  from public, anon, authenticated;
-- the BEFORE trigger runs as the caller and needs the actor helper
grant execute on function private.driver_actor() to authenticated;

notify pgrst, 'reload schema';

commit;
