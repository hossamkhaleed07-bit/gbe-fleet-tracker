-- ============================================================
-- 037_reinforcement_requires_shift_start_migration.sql
-- A reinforcement request may only be submitted for a driver/day
-- that already has a logged shift-start (public.shift_entries,
-- shift_type = 'start') for that same shift_date — reuses the
-- existing shift_entries table directly rather than adding new
-- plumbing (same idea as the existing shift_entry_exists() check
-- from migration 028).
-- ============================================================

create or replace function public.submit_reinforcement_request(
  p_identity_number text,
  p_full_name text,
  p_vehicle_plate text,
  p_station_name text default null,
  p_odo_reading numeric default null,
  p_odo_photo_url text default null,
  p_amount numeric default null,
  p_shift_date date default current_date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_driver_active boolean;
  v_last_request_at timestamptz;
  v_effective_date date;
begin
  if coalesce(trim(p_identity_number), '') = '' then
    raise exception 'identity_number is required';
  end if;

  if coalesce(trim(p_full_name), '') = '' then
    raise exception 'full_name is required';
  end if;

  if coalesce(trim(p_vehicle_plate), '') = '' then
    raise exception 'vehicle_plate is required';
  end if;

  select is_active into v_driver_active
  from public.drivers
  where identity_number = p_identity_number;

  if v_driver_active is not null and v_driver_active = false then
    raise exception 'هذا السائق غير مفعّل حاليًا، تواصل مع الإدارة';
  end if;

  v_effective_date := coalesce(p_shift_date, current_date);

  if not exists (
    select 1 from public.shift_entries
    where identity_number = p_identity_number
      and shift_date = v_effective_date
      and shift_type = 'start'
  ) then
    raise exception 'NO_SHIFT_START';
  end if;

  perform pg_advisory_xact_lock(hashtext('reinforcement_cooldown:' || p_identity_number));

  select max(created_at) into v_last_request_at
  from public.reinforcement_requests
  where identity_number = p_identity_number;

  if v_last_request_at is not null and now() < v_last_request_at + interval '2 hours' then
    raise exception 'REINFORCEMENT_COOLDOWN_ACTIVE:%', (v_last_request_at + interval '2 hours')::text;
  end if;

  insert into public.reinforcement_requests (
    identity_number, full_name, vehicle_plate, station_name,
    odo_reading, odo_photo_url, amount, shift_date
  ) values (
    p_identity_number, p_full_name, p_vehicle_plate, p_station_name,
    p_odo_reading, p_odo_photo_url, p_amount, v_effective_date
  )
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.submit_reinforcement_request(
  text, text, text, text, numeric, text, numeric, date
) to anon;

notify pgrst, 'reload schema';
