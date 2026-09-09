-- ============================================================
-- Add an explicit shift_date the driver picks, independent of
-- submission timestamp (fixes midnight-crossing shifts)
-- ============================================================

alter table public.shift_entries add column if not exists shift_date date;
update public.shift_entries set shift_date = created_at::date where shift_date is null;
alter table public.shift_entries alter column shift_date set not null;
alter table public.shift_entries alter column shift_date set default current_date;

do $$
declare
  r record;
begin
  for r in
    select oid::regprocedure as sig
    from pg_proc
    where proname = 'submit_shift_entry'
      and pronamespace = 'public'::regnamespace
  loop
    execute format('drop function %s', r.sig);
  end loop;
end $$;

create function public.submit_shift_entry(
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

  insert into public.shift_entries (
    identity_number, full_name, vehicle_plate, station_name, shift_type,
    odo_reading, odo_photo_url, condition_video_url, ofd_count,
    cod_delivered, ppd_delivered, picked_up, client_screenshot_url,
    email_address, area, shift_date
  ) values (
    p_identity_number, p_full_name, p_vehicle_plate, p_station_name, p_shift_type,
    p_odo_reading, p_odo_photo_url, p_condition_video_url, p_ofd_count,
    p_cod_delivered, p_ppd_delivered, p_picked_up, p_client_screenshot_url,
    p_email_address, p_area, coalesce(p_shift_date, current_date)
  )
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.submit_shift_entry(
  text, text, text, text, text, numeric, text, text,
  integer, integer, integer, integer, text, text, text, date
) to anon;
