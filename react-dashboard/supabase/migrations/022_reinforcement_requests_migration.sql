-- ============================================================
-- 022_reinforcement_requests_migration.sql
-- New standalone table for "طلب تعزيز" (reinforcement request)
-- submissions from the public form. Kept separate from
-- shift_entries since a reinforcement request isn't a shift.
-- ============================================================

create table if not exists public.reinforcement_requests (
  id uuid primary key default gen_random_uuid(),
  identity_number text not null,
  full_name text not null,
  vehicle_plate text not null,
  station_name text,
  odo_reading numeric,
  odo_photo_url text,
  amount numeric,
  shift_date date not null default current_date,
  created_at timestamptz not null default now()
);

alter table public.reinforcement_requests enable row level security;

drop policy if exists "scoped view reinforcement_requests" on public.reinforcement_requests;
create policy "scoped view reinforcement_requests"
on public.reinforcement_requests for select
to authenticated
using (
  coalesce(auth.jwt() -> 'user_metadata' ->> 'project', '') = ''
  or exists (
    select 1 from public.drivers d
    where d.identity_number = reinforcement_requests.identity_number
      and d.project = (auth.jwt() -> 'user_metadata' ->> 'project')
  )
);

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
