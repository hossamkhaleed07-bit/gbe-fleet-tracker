-- ============================================================
-- 035_reinforcement_cooldown_migration.sql
-- Enforces a 2-hour cooldown between reinforcement requests for
-- the same driver (identity_number), regardless of the previous
-- request's status — pending/approved/rejected all start the
-- clock, since the cooldown is about submission frequency, not
-- review outcome (explicit assumption, confirmed with the user).
--
-- Enforced INSIDE submit_reinforcement_request itself — the only
-- insert path into reinforcement_requests, security definer,
-- called anonymously from the public form — so it can't be
-- bypassed by calling the REST/RPC API directly. A per-driver
-- advisory lock closes the race where two devices/tabs submit for
-- the same driver at nearly the same instant.
--
-- get_reinforcement_cooldown() is a read-only companion RPC the
-- public form calls to render the countdown UI before the driver
-- even attempts to submit — the real gate is still the check
-- inside submit_reinforcement_request above.
-- ============================================================

create or replace function public.get_reinforcement_cooldown(p_identity_number text)
returns table(allowed boolean, last_request_at timestamptz, next_allowed_at timestamptz, remaining_seconds integer)
language sql
stable
security definer
set search_path = public
as $$
  select
    (s.last_at is null or now() >= s.last_at + interval '2 hours') as allowed,
    s.last_at as last_request_at,
    case when s.last_at is null then null else s.last_at + interval '2 hours' end as next_allowed_at,
    case when s.last_at is null then 0
         else greatest(0, ceil(extract(epoch from ((s.last_at + interval '2 hours') - now()))))::integer
    end as remaining_seconds
  from (
    select max(created_at) as last_at
    from public.reinforcement_requests
    where identity_number = p_identity_number
  ) s;
$$;

grant execute on function public.get_reinforcement_cooldown(text) to anon, authenticated;

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

  -- Serialize concurrent submissions for the same driver before checking
  -- the cooldown, so two near-simultaneous requests can't both pass.
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
