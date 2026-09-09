-- ============================================================
-- 025_reinforcement_request_amount_fix.sql
-- The "amount" value was arriving as null on new reinforcement
-- requests despite the form sending it and the column existing.
-- Likely cause: an older overload of submit_reinforcement_request
-- (without p_amount) is still registered alongside the new one,
-- and PostgREST/Postgres picked the wrong one. This drops every
-- possible prior signature explicitly, then recreates a single
-- clean version, and forces PostgREST to reload its schema cache.
-- ============================================================

drop function if exists public.submit_reinforcement_request(
  text, text, text, text, numeric, text, date
);
drop function if exists public.submit_reinforcement_request(
  text, text, text, text, numeric, text, numeric, date
);

create function public.submit_reinforcement_request(
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

  insert into public.reinforcement_requests (
    identity_number, full_name, vehicle_plate, station_name,
    odo_reading, odo_photo_url, amount, shift_date
  ) values (
    p_identity_number, p_full_name, p_vehicle_plate, p_station_name,
    p_odo_reading, p_odo_photo_url, p_amount, coalesce(p_shift_date, current_date)
  )
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.submit_reinforcement_request(
  text, text, text, text, numeric, text, numeric, date
) to anon;

notify pgrst, 'reload schema';
