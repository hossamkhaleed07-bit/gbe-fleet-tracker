-- ============================================================
-- 028_prevent_duplicate_shift_migration.sql
-- Reject a start/end shift submission when the driver already has
-- one for the same identity_number + shift_date + shift_type, so
-- admins don't have to manually clean up duplicates afterwards
-- (previously only caught after the fact in "Form Response").
--
-- Two layers:
--   1. shift_entry_exists() — a cheap pre-check the public form
--      calls BEFORE uploading any photos/video, so a duplicate is
--      rejected without wasting the driver's data/time on uploads
--      that would just be thrown away.
--   2. The same check inside submit_shift_entry() itself, as a
--      safety net against a race between the pre-check and the
--      actual insert (e.g. two submits in quick succession).
-- ============================================================

create or replace function public.shift_entry_exists(
  p_identity_number text,
  p_shift_date date,
  p_shift_type text
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.shift_entries
    where identity_number = p_identity_number
      and shift_date = p_shift_date
      and shift_type = p_shift_type
  );
$$;

grant execute on function public.shift_entry_exists(text, date, text) to anon;

create or replace function public.submit_shift_entry(
  p_identity_number text,
  p_full_name text,
  p_vehicle_plate text,
  p_station_name text default null,
  p_shift_type text default 'start',
  p_odo_reading numeric default null,
  p_odo_photo_url text default null,
  p_condition_video_url text default null,
  p_ofd_count integer default null,
  p_cod_delivered integer default null,
  p_ppd_delivered integer default null,
  p_picked_up integer default null,
  p_client_screenshot_url text default null,
  p_email_address text default null,
  p_area text default null,
  p_shift_date date default current_date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_shift_date date := coalesce(p_shift_date, current_date);
begin
  if p_shift_type not in ('start', 'end') then
    raise exception 'invalid shift_type: %', p_shift_type;
  end if;

  if coalesce(trim(p_identity_number), '') = '' then
    raise exception 'identity_number is required';
  end if;

  if coalesce(trim(p_full_name), '') = '' then
    raise exception 'full_name is required';
  end if;

  if coalesce(trim(p_vehicle_plate), '') = '' then
    raise exception 'vehicle_plate is required';
  end if;

  if public.shift_entry_exists(p_identity_number, v_shift_date, p_shift_type) then
    raise exception 'DUPLICATE_SHIFT';
  end if;

  insert into public.shift_entries (
    identity_number, full_name, vehicle_plate, station_name, shift_type,
    odo_reading, odo_photo_url, condition_video_url, ofd_count,
    cod_delivered, ppd_delivered, picked_up, client_screenshot_url,
    email_address, area, shift_date
  ) values (
    p_identity_number, p_full_name, p_vehicle_plate, p_station_name, p_shift_type,
    p_odo_reading, p_odo_photo_url, p_condition_video_url, p_ofd_count,
    p_cod_delivered, p_ppd_delivered, p_picked_up, p_client_screenshot_url,
    p_email_address, p_area, v_shift_date
  )
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.submit_shift_entry(
  text, text, text, text, text, numeric, text, text,
  integer, integer, integer, integer, text, text, text, date
) to anon;
