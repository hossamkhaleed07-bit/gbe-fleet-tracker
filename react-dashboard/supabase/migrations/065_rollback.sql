begin;

-- =====================================================================
-- 065_rollback.sql   Undoes the BEHAVIOUR of 065_driver_leaving_details.sql.
--
-- * set_active_status() goes back to 053 (reason of 10+ characters for any
--   deactivation, no leaving details).
-- * The triggers, set_driver_leaving_details() and driver_activity_after() are
--   removed, and so are the two check constraints on drivers.
-- * The DATA is kept: the five drivers columns (last_working_day,
--   deactivation_reason, deactivation_note, deactivated_at, deactivated_by) and
--   the driver_status_history table stay, with whatever they hold.  Nothing in
--   the old code reads them, so keeping them is harmless.  To also drop them
--   (their values are then lost), run the block at the end separately.
-- ONE transaction.
-- =====================================================================

do $$
begin
  if to_regprocedure('public.set_active_status(text,text,boolean,text,date,text,text)') is null then
    raise exception 'STOP: 065 is not installed (set_active_status with leaving details not found).';
  end if;
end $$;

drop trigger if exists driver_leaving_before_update on public.drivers;
drop trigger if exists driver_status_history_log on public.drivers;
drop function if exists private.driver_leaving_before_update();
drop function if exists private.driver_status_history_log();
drop function if exists public.set_driver_leaving_details(text, date, text, text);
drop function if exists public.driver_activity_after(text, date);
drop function if exists public.set_active_status(text, text, boolean, text, date, text, text);
drop function if exists private.driver_check_leaving(text, date, text, text);

alter table public.drivers
  drop constraint if exists drivers_leaving_only_when_inactive,
  drop constraint if exists drivers_deactivation_reason_check;

-- 053's set_active_status, unchanged
create function public.set_active_status(
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

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------
-- OPTIONAL, run separately and only if you are sure: also remove the data.
-- The leaving details and the whole history are lost.
-- ---------------------------------------------------------------------
-- begin;
-- drop table public.driver_status_history;
-- drop function private.driver_history_append_only();
-- drop function private.driver_actor();
-- alter table public.drivers
--   drop column last_working_day, drop column deactivation_reason, drop column deactivation_note,
--   drop column deactivated_at, drop column deactivated_by;
-- notify pgrst, 'reload schema';
-- commit;
