begin;

-- =====================================================================
-- 058  Oil changes tracking (متابعة تغيير الزيت)            REVIEW ONLY - NOT RUN YET
--
--  Who:  admin and fleet manager read, record and edit settings.  Nobody else
--        (supervisors and viewers cannot read any of these tables or functions).
--
--  Objects (all new, nothing existing is changed except 4 new NULLABLE columns on vehicles):
--    vehicles                 + project, city, oil_interval_km, oil_time_limit_months
--    oil_model_defaults       default change distance per model (editable)
--    oil_settings             alert thresholds (single row, editable)
--    oil_changes              one row per oil change (+ computed next_odo)
--    oil_driver_notices       log of "notify the driver" (who, when)
--    oil_notifications        bell notifications for admin + fleet manager
--    private/public functions oil_valid_readings() (+ private.oil_plausible_step), oil_fleet_status(), run_oil_alerts(),
--                             mark_oil_notifications_read()
--    pg_cron job              daily-oil-alerts   (05:00 UTC = 08:00 Riyadh)
--    storage bucket           oil-invoices (private) for the invoice photo
--
--  ONE transaction: if anything fails, nothing changes.
--  Needs 053 (private.is_admin / is_fleet_manager). Does NOT need 056: viewer policies are added only if
--  private.is_viewer() exists, and 056 covers these tables itself if it runs afterwards.
--  Run order: 058_verify_before.sql -> THIS FILE -> 058_verify_after.sql ->
--             058_import_report.sql -> (you decide) 058_import_from_sheet.sql
-- =====================================================================


-- 0) Preconditions
do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'private' and p.proname = 'is_admin') then
    raise exception 'STOP: private.is_admin() is missing (053 not run).';
  end if;
  if to_regclass('public.oil_changes') is not null then
    raise exception 'STOP: public.oil_changes already exists - 058 was already run.';
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.vehicles'::regclass and contype in ('u', 'p')
                    and conkey = array[(select attnum from pg_attribute
                                         where attrelid = 'public.vehicles'::regclass and attname = 'vehicle_plate')]) then
    raise exception 'STOP: vehicles.vehicle_plate has no unique constraint (needed for the foreign key).';
  end if;
end $$;

-- every column the new functions read must exist (stops and lists what is missing)
do $$
declare v_missing text;
begin
  select string_agg(t.table_name || '.' || t.column_name, ', ' order by t.table_name, t.column_name) into v_missing
  from (values
    ('vehicles', 'vehicle_plate'), ('vehicles', 'model'), ('vehicles', 'vehicle_vendor'), ('vehicles', 'is_active'),
    ('drivers', 'assigned_vehicle_plate'), ('drivers', 'identity_number'), ('drivers', 'full_name'),
    ('drivers', 'mobile_number'), ('drivers', 'project'), ('drivers', 'city_name'), ('drivers', 'is_active'),
    ('shift_entries', 'vehicle_plate'), ('shift_entries', 'odo_reading'), ('shift_entries', 'shift_date'), ('shift_entries', 'created_at'),
    ('reinforcement_requests', 'vehicle_plate'), ('reinforcement_requests', 'odo_reading'),
    ('reinforcement_requests', 'shift_date'), ('reinforcement_requests', 'created_at')
  ) as t(table_name, column_name)
  where not exists (select 1 from information_schema.columns c
                     where c.table_schema = 'public' and c.table_name = t.table_name and c.column_name = t.column_name);
  if v_missing is not null then
    raise exception 'STOP: these columns do not exist: %', v_missing;
  end if;
end $$;


-- 1) vehicles: project / city (filled from the sheet, editable later) and per-vehicle oil settings.
--    All NULLABLE; nothing reads them yet except the oil page.
--    A vehicle's own interval overrides its model's default; empty time limit = no time limit.
alter table public.vehicles
  add column if not exists project text,
  add column if not exists city text,
  add column if not exists oil_interval_km integer check (oil_interval_km is null or oil_interval_km > 0),
  add column if not exists oil_time_limit_months integer check (oil_time_limit_months is null or oil_time_limit_months > 0);


-- 2) Default change distance per model.  A model that is not here (and has no per-vehicle
--    value) is flagged "needs interval" in the page.
create table public.oil_model_defaults (
  model             text primary key,
  interval_km       integer not null check (interval_km > 0),
  updated_at        timestamptz not null default now(),
  updated_by_email  text
);
create unique index oil_model_defaults_model_key on public.oil_model_defaults (lower(btrim(model)));

insert into public.oil_model_defaults (model, interval_km) values
  ('i10', 10000), ('LiteAce', 10000), ('Dzire', 10000),
  ('Expert', 5000), ('Dyna', 5000),
  ('Van', 6500);


-- 3) Settings (exactly one row).
create table public.oil_settings (
  id                    boolean primary key default true check (id),
  alert_km              integer not null default 500   check (alert_km >= 0),
  alert_days            integer not null default 3     check (alert_days >= 0),
  stale_reading_days    integer not null default 3     check (stale_reading_days >= 1),
  notify_repeat_days    integer not null default 2     check (notify_repeat_days >= 1),
  max_jump_km_per_day   integer not null default 1500  check (max_jump_km_per_day > 0),
  avg_window_days       integer not null default 14    check (avg_window_days >= 1),
  avg_min_readings      integer not null default 3     check (avg_min_readings >= 2),
  reading_scan_days     integer not null default 45    check (reading_scan_days >= 14),
  updated_at            timestamptz not null default now(),
  updated_by_email      text
);
insert into public.oil_settings (id) values (true);


-- 4) Oil changes.  next_odo is computed by the database (change_odo + change_interval_km).
create table public.oil_changes (
  id                  uuid primary key default gen_random_uuid(),
  vehicle_plate       text not null references public.vehicles (vehicle_plate) on update cascade on delete restrict,
  change_date         date,                                   -- NULL for old data
  change_odo          numeric not null check (change_odo > 0),
  change_interval_km  integer not null check (change_interval_km > 0),
  next_odo            numeric generated always as (change_odo + change_interval_km) stored,
  notes               text,
  invoice_photo_path  text,                                   -- path in the oil-invoices bucket
  recorded_by         uuid,
  recorded_by_email   text,
  created_at          timestamptz not null default now()
);
-- the same change cannot be saved twice by accident (double click, re-import)
create unique index oil_changes_no_duplicate
  on public.oil_changes (vehicle_plate, coalesce(change_date, date '1900-01-01'), change_odo);
create index oil_changes_vehicle_idx
  on public.oil_changes (vehicle_plate, change_date desc nulls last, created_at desc);

-- Who recorded it is set by the database and cannot be edited from the dashboard.
-- (The SQL editor / service role keeps what it sends: that is how the sheet import labels itself.)
create or replace function private.oil_changes_before_write() returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if current_user in ('authenticated', 'anon') then
      new.recorded_by       := auth.uid();
      new.recorded_by_email := auth.jwt() ->> 'email';
      new.created_at        := now();
    else
      new.created_at := coalesce(new.created_at, now());
    end if;
  elsif current_user in ('authenticated', 'anon') then
    new.recorded_by       := old.recorded_by;
    new.recorded_by_email := old.recorded_by_email;
    new.created_at        := old.created_at;
  end if;
  if new.change_date is not null and new.change_date > current_date + 1 then
    raise exception 'change_date cannot be in the future' using errcode = '22023';
  end if;
  new.notes := nullif(btrim(new.notes), '');
  return new;
end;
$$;

create trigger oil_changes_before_write
  before insert or update on public.oil_changes
  for each row execute function private.oil_changes_before_write();


-- 5) "Notify the driver" log (one row each time the button is used).
create table public.oil_driver_notices (
  id                      uuid primary key default gen_random_uuid(),
  vehicle_plate           text not null references public.vehicles (vehicle_plate) on update cascade on delete cascade,
  cycle_next_odo          numeric,                 -- which oil change cycle it was about
  remaining_km            numeric,
  expected_date           date,
  driver_identity_number  text,
  channel                 text not null default 'whatsapp',
  notified_by             uuid,
  notified_by_email       text,
  notified_at             timestamptz not null default now()
);
create index oil_driver_notices_vehicle_idx on public.oil_driver_notices (vehicle_plate, notified_at desc);

create or replace function private.oil_driver_notices_before_write() returns trigger
language plpgsql
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.notified_by       := auth.uid();
    new.notified_by_email := auth.jwt() ->> 'email';
    new.notified_at       := now();
  else
    new.notified_at := coalesce(new.notified_at, now());
  end if;
  return new;
end;
$$;

create trigger oil_driver_notices_before_write
  before insert on public.oil_driver_notices
  for each row execute function private.oil_driver_notices_before_write();


-- 6) Notifications for the bell.  A separate table (not admin_notifications): that one
--    only allows kind deactivate/reactivate and is readable by admins only, and the
--    oil alerts must also reach the fleet manager.
create table public.oil_notifications (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('soon', 'overdue', 'unanswered')),
  vehicle_plate   text not null,
  cycle_next_odo  numeric,
  remaining_km    numeric,
  expected_date   date,
  project         text,
  model           text,
  notice_id       uuid,                      -- only for 'unanswered'
  created_at      timestamptz not null default now(),
  is_read         boolean not null default false,
  read_at         timestamptz,
  read_by         uuid
);
-- once per vehicle and cycle for "soon" and for "overdue"; once per notice for "unanswered"
create unique index oil_notifications_cycle_key
  on public.oil_notifications (vehicle_plate, cycle_next_odo, kind) where kind in ('soon', 'overdue');
create unique index oil_notifications_notice_key
  on public.oil_notifications (notice_id) where kind = 'unanswered';
create index oil_notifications_unread_idx on public.oil_notifications (is_read, created_at desc);


-- 7) Row level security.
alter table public.oil_model_defaults enable row level security;
alter table public.oil_settings       enable row level security;
alter table public.oil_changes        enable row level security;
alter table public.oil_driver_notices enable row level security;
alter table public.oil_notifications  enable row level security;

revoke all on public.oil_model_defaults, public.oil_settings, public.oil_changes,
              public.oil_driver_notices, public.oil_notifications from anon, authenticated;

grant select, insert, update, delete on public.oil_model_defaults to authenticated;
grant select, update                 on public.oil_settings       to authenticated;
grant select, insert, update, delete on public.oil_changes        to authenticated;
grant select, insert                 on public.oil_driver_notices to authenticated;
grant select                         on public.oil_notifications  to authenticated;   -- written only by run_oil_alerts / mark read

-- admin + fleet manager: read everything
create policy "admin or fleet manager read oil_model_defaults" on public.oil_model_defaults
  for select to authenticated using (private.is_admin() or private.is_fleet_manager());
create policy "admin or fleet manager read oil_settings" on public.oil_settings
  for select to authenticated using (private.is_admin() or private.is_fleet_manager());
create policy "admin or fleet manager read oil_changes" on public.oil_changes
  for select to authenticated using (private.is_admin() or private.is_fleet_manager());
create policy "admin or fleet manager read oil_driver_notices" on public.oil_driver_notices
  for select to authenticated using (private.is_admin() or private.is_fleet_manager());
create policy "admin or fleet manager read oil_notifications" on public.oil_notifications
  for select to authenticated using (private.is_admin() or private.is_fleet_manager());

-- admin + fleet manager: write
create policy "admin or fleet manager insert oil_model_defaults" on public.oil_model_defaults
  for insert to authenticated with check (private.is_admin() or private.is_fleet_manager());
create policy "admin or fleet manager update oil_model_defaults" on public.oil_model_defaults
  for update to authenticated using (private.is_admin() or private.is_fleet_manager())
  with check (private.is_admin() or private.is_fleet_manager());
create policy "admin deletes oil_model_defaults" on public.oil_model_defaults
  for delete to authenticated using (private.is_admin());

create policy "admin or fleet manager update oil_settings" on public.oil_settings
  for update to authenticated using (private.is_admin() or private.is_fleet_manager())
  with check (private.is_admin() or private.is_fleet_manager());

create policy "admin or fleet manager insert oil_changes" on public.oil_changes
  for insert to authenticated with check (private.is_admin() or private.is_fleet_manager());
create policy "admin or fleet manager update oil_changes" on public.oil_changes
  for update to authenticated using (private.is_admin() or private.is_fleet_manager())
  with check (private.is_admin() or private.is_fleet_manager());
create policy "admin deletes oil_changes" on public.oil_changes
  for delete to authenticated using (private.is_admin());

create policy "admin or fleet manager insert oil_driver_notices" on public.oil_driver_notices
  for insert to authenticated with check (private.is_admin() or private.is_fleet_manager());

-- the viewer role (056): refused everywhere on these tables, on top of the policies above.
-- Added only when private.is_viewer() exists.  If 056 is run LATER, its loop over every table with row level
-- security covers these tables too, so nothing is left open in either order.
do $$
declare t text;
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'private' and p.proname = 'is_viewer') then
    raise notice '058: private.is_viewer() does not exist yet - viewer policies on the oil tables are skipped (056 adds them when it runs).';
    return;
  end if;
  foreach t in array array['oil_model_defaults', 'oil_settings', 'oil_changes', 'oil_driver_notices', 'oil_notifications']
  loop
    execute format('create policy "viewer cannot read %1$s" on public.%1$I as restrictive for select to authenticated using (not private.is_viewer())', t);
    execute format('create policy "viewer is read only (insert)" on public.%I as restrictive for insert to authenticated with check (not private.is_viewer())', t);
    execute format('create policy "viewer is read only (update)" on public.%I as restrictive for update to authenticated using (not private.is_viewer()) with check (not private.is_viewer())', t);
    execute format('create policy "viewer is read only (delete)" on public.%I as restrictive for delete to authenticated using (not private.is_viewer())', t);
  end loop;
end $$;

-- the bell gets new rows live (RLS above still applies to realtime)
do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'oil_notifications') then
    alter publication supabase_realtime add table public.oil_notifications;
  end if;
end $$;


-- 8) Readings with validity.  Every odometer reading of the last reading_scan_days days from
--    shift_entries (start + end) and reinforcement_requests, per vehicle, in date/time order.
--
--    START POINT = the odometer of the vehicle's LAST OIL CHANGE (not its first reading), so one wrong
--    first reading cannot spoil the vehicle.  Readings dated BEFORE that change are left out (they belong to
--    the previous cycle).  A vehicle with no oil change yet starts from its first reading.
--
--    A reading is IGNORED (is_valid = false) when it is
--      * lower than the odometer of the last oil change (the reference is still the change) -> 'lower_than_last_change'
--      * lower than the reference reading                                                    -> 'lower_than_previous'
--      * more than max_jump_km_per_day above the reference (x days since it, at least 1;
--        not checked against a change whose date is unknown)                                 -> 'jump_too_large'
--
--    RESET: when two or more rejected readings in a row agree with EACH OTHER (each is not lower than the one
--    before it and within the daily limit of it), they are accepted and the last of them becomes the
--    reference.  If the reference before them was a reading, that reading is marked
--    is_valid = false, reason 'suspect_baseline' (so a first reading with an extra zero is dropped as soon as
--    two normal readings follow); if that reference itself came from an earlier reset, the whole earlier reset
--    group (and what was accepted after it) is marked.  If it was the oil change itself, the page shows the flag
--    current_below_change instead (the change odometer is above every reading: one of them is wrong).
--    SECURITY INVOKER: the caller's own row level security applies.   p_plate: limit to one vehicle.
create or replace function private.oil_plausible_step(a_odo numeric, a_day date, b_odo numeric, b_day date, p_jump numeric)
returns boolean
language sql
immutable
as $$
  select b_odo >= a_odo and (b_odo - a_odo) <= p_jump * greatest(1, b_day - a_day)
$$;

create or replace function public.oil_valid_readings(p_plate text default null)
returns table (
  vehicle_plate text,
  odo           numeric,
  reading_date  date,
  reading_at    timestamptz,
  source        text,
  is_valid      boolean,
  reason        text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_scan   integer;
  v_jump   numeric;
  r        record;
  v_prev   text := null;
  n        integer := 0;
  a_odo    numeric[] := '{}';
  a_day    date[] := '{}';
  a_ts     timestamptz[] := '{}';
  a_src    text[] := '{}';
  a_ok     boolean[] := '{}';
  a_why    text[] := '{}';
  v_ref_odo  numeric;
  v_ref_day  date;
  v_ref_idx  integer;      -- 0 = the oil change is the reference
  v_ok_idx   integer;      -- index of the last accepted reading
  v_grp_start integer := 0; -- first reading of the last reset group (0 = none yet)
  v_why    text;
  v_s      integer;
  k        integer;
begin
  if current_user in ('authenticated', 'anon') and not (private.is_admin() or private.is_fleet_manager()) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  select s.reading_scan_days, s.max_jump_km_per_day into v_scan, v_jump from public.oil_settings s where s.id;
  v_scan := coalesce(v_scan, 45);
  v_jump := coalesce(v_jump, 1500);

  for r in
    select x.plate, x.odo_value, x.dt, x.ts, x.src, lc.change_odo as base_odo, lc.change_date as base_day
    from (
      select se.vehicle_plate as plate, se.odo_reading::numeric as odo_value, se.shift_date as dt,
             se.created_at as ts, 'shift'::text as src
        from public.shift_entries se
       where se.odo_reading is not null and se.odo_reading > 0
         and nullif(btrim(se.vehicle_plate), '') is not null
         and se.shift_date >= current_date - v_scan
         and (p_plate is null or se.vehicle_plate = p_plate)
      union all
      select rr.vehicle_plate, rr.odo_reading::numeric, rr.shift_date, rr.created_at, 'reinforcement'::text
        from public.reinforcement_requests rr
       where rr.odo_reading is not null and rr.odo_reading > 0
         and nullif(btrim(rr.vehicle_plate), '') is not null
         and rr.shift_date >= current_date - v_scan
         and (p_plate is null or rr.vehicle_plate = p_plate)
    ) x
    left join (
      select distinct on (c.vehicle_plate) c.vehicle_plate as plate, c.change_odo, c.change_date
      from public.oil_changes c
      order by c.vehicle_plate, coalesce(c.change_date, date '1900-01-01') desc, c.created_at desc
    ) lc on lc.plate = x.plate
    where x.dt >= coalesce(lc.change_date, date '1900-01-01')
    order by x.plate, x.dt, x.ts, x.odo_value
  loop
    if v_prev is distinct from r.plate then
      if n > 0 then   -- the previous vehicle is finished: write its rows out
        return query select v_prev, a_odo[g], a_day[g], a_ts[g], a_src[g], a_ok[g], a_why[g] from generate_series(1, n) g;
      end if;
      v_prev := r.plate;
      n := 0; a_odo := '{}'; a_day := '{}'; a_ts := '{}'; a_src := '{}'; a_ok := '{}'; a_why := '{}';
      v_ref_odo := r.base_odo; v_ref_day := r.base_day; v_ref_idx := 0; v_ok_idx := 0; v_grp_start := 0;
    end if;

    n := n + 1;
    a_odo[n] := r.odo_value; a_day[n] := r.dt; a_ts[n] := r.ts; a_src[n] := r.src;

    v_why := null;
    if v_ref_odo is not null then
      if r.odo_value < v_ref_odo then
        v_why := case when v_ref_idx = 0 then 'lower_than_last_change' else 'lower_than_previous' end;
      elsif v_ref_day is not null and (r.odo_value - v_ref_odo) > v_jump * greatest(1, r.dt - v_ref_day) then
        v_why := 'jump_too_large';
      end if;
    end if;

    if v_why is null then
      a_ok[n] := true; a_why[n] := null;
      v_ref_odo := r.odo_value; v_ref_day := r.dt; v_ref_idx := n; v_ok_idx := n;
    else
      a_ok[n] := false; a_why[n] := v_why;
      -- reset: this rejected reading and the one before it (also rejected) agree with each other
      if n - 1 > v_ok_idx and private.oil_plausible_step(a_odo[n - 1], a_day[n - 1], a_odo[n], a_day[n], v_jump) then
        v_s := n - 1;
        while v_s - 1 > v_ok_idx
              and private.oil_plausible_step(a_odo[v_s - 1], a_day[v_s - 1], a_odo[v_s], a_day[v_s], v_jump) loop
          v_s := v_s - 1;
        end loop;
        for k in v_s .. n loop
          a_ok[k] := true; a_why[k] := null;
        end loop;
        if v_ref_idx > 0 then
          -- the old reference is contradicted; if it belonged to an earlier reset group, the whole group is
          for k in (case when v_grp_start > 0 and v_ref_idx >= v_grp_start then v_grp_start else v_ref_idx end) .. v_ref_idx loop
            a_ok[k] := false; a_why[k] := 'suspect_baseline';
          end loop;
        end if;
        v_grp_start := v_s;
        v_ref_odo := r.odo_value; v_ref_day := r.dt; v_ref_idx := n; v_ok_idx := n;
      end if;
    end if;
  end loop;

  if n > 0 then
    return query select v_prev, a_odo[g], a_day[g], a_ts[g], a_src[g], a_ok[g], a_why[g] from generate_series(1, n) g;
  end if;
end;
$$;

revoke all on function public.oil_valid_readings(text) from public, anon;
grant execute on function public.oil_valid_readings(text) to authenticated;


-- 9) The page's table: one row per ACTIVE vehicle.   SECURITY INVOKER.
--    status:  overdue | soon | ok | no_reading | needs_setup   (priority in that order)
--      needs_setup : no oil change recorded yet (nothing to count from)
--      overdue     : remaining km <= 0, or the time limit has passed
--      soon        : remaining km <= alert_km, or expected date within alert_days
--                    (or the time limit within alert_days) - whichever comes first
--      no_reading  : otherwise fine, but no valid reading for stale_reading_days or more
--    remaining_km = next change odometer - current odometer
--    avg_daily_km = (newest - oldest valid reading of the last avg_window_days) / days between,
--                   only with at least avg_min_readings valid readings, otherwise NULL
--    expected_date = today + remaining / avg daily distance
--    flags: no_baseline, needs_interval, no_reading, current_below_change (current odometer is
--           below the odometer of the last change: a wrong entry somewhere), ignored_readings
create or replace function public.oil_fleet_status()
returns table (
  vehicle_plate           text,
  model                   text,
  vendor                  text,
  project                 text,
  city                    text,
  driver_identity_number  text,
  driver_name             text,
  driver_mobile           text,
  last_change_id          uuid,
  last_change_date        date,
  last_change_odo         numeric,
  last_change_interval    integer,
  next_change_odo         numeric,
  default_interval_km     integer,
  time_limit_months       integer,
  due_by_date             date,
  current_odo             numeric,
  current_odo_date        date,
  current_odo_source      text,
  remaining_km            numeric,
  avg_daily_km            numeric,
  expected_date           date,
  ignored_readings        integer,
  notice_id               uuid,
  notice_at               timestamptz,
  notice_by_email         text,
  notice_unanswered       boolean,
  status                  text,
  flags                   text[]
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  s public.oil_settings;
begin
  if current_user in ('authenticated', 'anon') and not (private.is_admin() or private.is_fleet_manager()) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  select * into s from public.oil_settings o where o.id;

  return query
  with valid as (
    select * from public.oil_valid_readings(null)
  ),
  cur as (
    select distinct on (v.vehicle_plate) v.vehicle_plate as plate, v.odo, v.reading_date, v.source
    from valid v where v.is_valid
    order by v.vehicle_plate, v.reading_date desc, v.reading_at desc, v.odo desc
  ),
  ign as (
    select v.vehicle_plate as plate, count(*)::integer as n from valid v where not v.is_valid group by v.vehicle_plate
  ),
  win as (
    select v.vehicle_plate as plate, count(*) as n, min(v.odo) as lo, max(v.odo) as hi,
           min(v.reading_date) as d0, max(v.reading_date) as d1
    from valid v
    where v.is_valid and v.reading_date >= current_date - s.avg_window_days
    group by v.vehicle_plate
  ),
  lc as (
    select distinct on (c.vehicle_plate) c.id, c.vehicle_plate as plate, c.change_date, c.change_odo,
           c.change_interval_km, c.next_odo, c.created_at
    from public.oil_changes c
    order by c.vehicle_plate, coalesce(c.change_date, date '1900-01-01') desc, c.created_at desc
  ),
  drv as (
    select distinct on (d.assigned_vehicle_plate) d.assigned_vehicle_plate as plate, d.identity_number,
           d.full_name, d.mobile_number, d.project, d.city_name
    from public.drivers d
    where d.assigned_vehicle_plate is not null
    order by d.assigned_vehicle_plate, d.is_active desc, d.full_name
  ),
  nt as (
    select distinct on (n.vehicle_plate) n.id, n.vehicle_plate as plate, n.notified_at, n.notified_by_email
    from public.oil_driver_notices n
    order by n.vehicle_plate, n.notified_at desc
  ),
  base as (
    select v.vehicle_plate as plate, v.model as model, v.vehicle_vendor as vendor,
           coalesce(drv.project, v.project) as project,
           coalesce(v.city, drv.city_name) as city,
           drv.identity_number as drv_id, drv.full_name as drv_name, drv.mobile_number as drv_mobile,
           lc.id as lc_id, lc.change_date as lc_date, lc.change_odo as lc_odo, lc.change_interval_km as lc_interval,
           lc.next_odo as lc_next, lc.created_at as lc_created,
           coalesce(v.oil_interval_km, md.interval_km) as def_interval,
           v.oil_time_limit_months as months,
           case when lc.change_date is not null and v.oil_time_limit_months is not null
                then (lc.change_date + make_interval(months => v.oil_time_limit_months))::date end as due_by,
           cur.odo as cur_odo, cur.reading_date as cur_date, cur.source as cur_src,
           coalesce(ign.n, 0) as ign_n,
           case when win.n >= s.avg_min_readings and win.d1 > win.d0
                then round((win.hi - win.lo) / (win.d1 - win.d0), 1) end as avg_km,
           nt.id as nt_id, nt.notified_at as nt_at, nt.notified_by_email as nt_by
    from public.vehicles v
    left join public.oil_model_defaults md on lower(btrim(md.model)) = lower(btrim(v.model))
    left join lc  on lc.plate  = v.vehicle_plate
    left join cur on cur.plate = v.vehicle_plate
    left join ign on ign.plate = v.vehicle_plate
    left join win on win.plate = v.vehicle_plate
    left join drv on drv.plate = v.vehicle_plate
    left join nt  on nt.plate  = v.vehicle_plate
    where coalesce(v.is_active, true)
  ),
  calc as (
    select b.*,
           case when b.lc_next is not null and b.cur_odo is not null then b.lc_next - b.cur_odo end as rem,
           case when b.lc_next is not null and b.cur_odo is not null and b.lc_next - b.cur_odo > 0 and b.avg_km > 0
                then current_date + ceil((b.lc_next - b.cur_odo) / b.avg_km)::integer end as exp_date
    from base b
  )
  select c.plate, c.model, c.vendor, c.project, c.city, c.drv_id, c.drv_name, c.drv_mobile,
         c.lc_id, c.lc_date, c.lc_odo, c.lc_interval, c.lc_next, c.def_interval, c.months, c.due_by,
         c.cur_odo, c.cur_date, c.cur_src, c.rem, c.avg_km, c.exp_date, c.ign_n::integer,
         c.nt_id, c.nt_at, c.nt_by,
         (c.nt_at is not null and (c.lc_created is null or c.lc_created < c.nt_at)),
         case
           when c.lc_id is null then 'needs_setup'
           when (c.rem is not null and c.rem <= 0) or (c.due_by is not null and c.due_by <= current_date) then 'overdue'
           when (c.rem is not null and c.rem <= s.alert_km)
             or (c.exp_date is not null and c.exp_date - current_date <= s.alert_days)
             or (c.due_by is not null and c.due_by - current_date <= s.alert_days) then 'soon'
           when c.cur_date is null or current_date - c.cur_date >= s.stale_reading_days then 'no_reading'
           else 'ok'
         end,
         array_remove(array[
           case when c.lc_id is null then 'no_baseline' end,
           case when c.def_interval is null then 'needs_interval' end,
           case when c.cur_odo is null then 'no_reading' end,
           case when c.cur_odo is not null and c.lc_odo is not null and c.cur_odo < c.lc_odo then 'current_below_change' end,
           case when c.ign_n > 0 then 'ignored_readings' end
         ], null)
  from calc c;
end;
$$;

revoke all on function public.oil_fleet_status() from public, anon;
grant execute on function public.oil_fleet_status() to authenticated;


-- 10) Daily alerts.  Run by pg_cron (as the database owner), never by a browser.
--     One notification per vehicle the first time it is "soon" in a cycle, one the first time it is
--     "overdue" in a cycle, and one more when the driver was notified, notify_repeat_days passed and
--     no oil change has been recorded since.   Returns how many notifications it created.
create or replace function public.run_oil_alerts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  s   public.oil_settings;
  st  record;
  n   integer := 0;
  k   integer;
begin
  select * into s from public.oil_settings o where o.id;

  for st in select * from public.oil_fleet_status() loop
    if st.status in ('soon', 'overdue') then
      insert into public.oil_notifications (kind, vehicle_plate, cycle_next_odo, remaining_km, expected_date, project, model)
      values (st.status, st.vehicle_plate, st.next_change_odo, st.remaining_km, st.expected_date, st.project, st.model)
      on conflict do nothing;
      get diagnostics k = row_count;
      n := n + k;
    end if;

    if st.notice_unanswered and st.notice_at <= now() - make_interval(days => s.notify_repeat_days) then
      insert into public.oil_notifications (kind, vehicle_plate, cycle_next_odo, remaining_km, expected_date, project, model, notice_id)
      values ('unanswered', st.vehicle_plate, st.next_change_odo, st.remaining_km, st.expected_date, st.project, st.model, st.notice_id)
      on conflict do nothing;
      get diagnostics k = row_count;
      n := n + k;
    end if;
  end loop;

  return n;
end;
$$;

revoke all on function public.run_oil_alerts() from public, anon, authenticated;   -- the cron job runs as postgres

do $$
begin
  if exists (select 1 from cron.job where jobname = 'daily-oil-alerts') then
    perform cron.unschedule('daily-oil-alerts');
  end if;
end $$;

-- 05:00 UTC = 08:00 Riyadh (UTC+3)
select cron.schedule('daily-oil-alerts', '0 5 * * *', $$select public.run_oil_alerts();$$);


-- 11) Marking notifications read (admin + fleet manager). p_ids null = all unread.
create or replace function public.mark_oil_notifications_read(p_ids uuid[] default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not (private.is_admin() or private.is_fleet_manager()) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  with u as (
    update public.oil_notifications
       set is_read = true, read_at = now(), read_by = auth.uid()
     where is_read = false and (p_ids is null or id = any (p_ids))
    returning 1
  )
  select count(*)::integer into v_count from u;
  return v_count;
end;
$$;

revoke all on function public.mark_oil_notifications_read(uuid[]) from public, anon;
grant execute on function public.mark_oil_notifications_read(uuid[]) to authenticated;


-- 12) Invoice photos: a PRIVATE bucket.  Admin + fleet manager can upload and read; nobody can
--     overwrite or delete through the API (no update / delete policy).  The page shows photos
--     through short-lived signed links.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('oil-invoices', 'oil-invoices', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

drop policy if exists "oil invoices: admin or fleet manager read" on storage.objects;
create policy "oil invoices: admin or fleet manager read" on storage.objects
  for select to authenticated
  using (bucket_id = 'oil-invoices' and (private.is_admin() or private.is_fleet_manager()));

drop policy if exists "oil invoices: admin or fleet manager upload" on storage.objects;
create policy "oil invoices: admin or fleet manager upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'oil-invoices' and (private.is_admin() or private.is_fleet_manager()));

notify pgrst, 'reload schema';

commit;
