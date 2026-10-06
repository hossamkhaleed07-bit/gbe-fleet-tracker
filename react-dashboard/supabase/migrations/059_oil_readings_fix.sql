begin;

-- =====================================================================
-- 059  oil_valid_readings(): fix for vehicles whose last oil change has NO DATE (the sheet import)
--
--  What went wrong (seen on real data, e.g. BTA-5036-87: 118 of 122 readings marked suspect_baseline):
--    * the change odometer is known but its date is not, so readings from BEFORE the change (normal,
--      and lower than the change odometer) were treated as errors;
--    * the reset rule then accepted them as a "group", and a later spike made the 058 version mark the
--      whole group and everything after it as suspect.
--
--  What changes (this file replaces the function public.oil_valid_readings and adds ONE column,
--  oil_settings.back_tolerance_km; other tables, functions, policies and the cron job are untouched;
--  safe to run again):
--    1. When the last change has no date: the readings that are lower than the change odometer AND come
--       before the first reading at or above it belong to the PREVIOUS cycle - they are left out, like the
--       readings dated before a known change date.  If no reading ever reaches the change odometer, nothing is
--       left out (the page shows current_below_change, as before).
--    2. When the reset rule overrules the reference, that reading is marked suspect_baseline - and, only if no
--       reading was accepted normally after the group it belongs to, the rest of that reset group with it
--       (two spike readings in a row go together).  Readings accepted normally are never swept up: the 058
--       version marked a whole earlier group AND everything accepted after it, which wiped out a month.
--    3. A reading that is LOWER than the reference by up to back_tolerance_km (a new setting, 100 km) is just
--       noise (e.g. the end-of-shift reading of one day is a few km above the start of the next day): it is
--       NOT marked as wrong and it does NOT become the reference (the higher value stays the reference).
--       This is for the oil calculation only; nothing else in the app uses it.
--    Everything else is as in 058: start point = the last change odometer, lower_than_last_change,
--    lower_than_previous, jump_too_large, and the reset when two or more rejected readings agree.
-- =====================================================================

do $$
begin
  if to_regclass('public.oil_changes') is null then
    raise exception 'STOP: 058 has not been run (public.oil_changes is missing).';
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'private' and p.proname = 'oil_plausible_step') then
    raise exception 'STOP: private.oil_plausible_step() is missing (058 not run).';
  end if;
end $$;

-- 100 km of "going back" is tolerated (editable later from the settings, like the other thresholds)
alter table public.oil_settings
  add column if not exists back_tolerance_km integer not null default 100 check (back_tolerance_km >= 0);

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
  v_tol    numeric;
  v_noise  boolean;
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
  v_grp_start integer := 0; -- first and last reading of the last reset group (0 = none yet)
  v_grp_end   integer := 0;
  v_why    text;
  v_s      integer;
  k        integer;
begin
  if current_user in ('authenticated', 'anon') and not (private.is_admin() or private.is_fleet_manager()) then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  select s.reading_scan_days, s.max_jump_km_per_day, s.back_tolerance_km into v_scan, v_jump, v_tol
    from public.oil_settings s where s.id;
  v_scan := coalesce(v_scan, 45);
  v_jump := coalesce(v_jump, 1500);
  v_tol  := coalesce(v_tol, 100);

  for r in
    with raw as (
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
    ),
    lc as (
      select distinct on (c.vehicle_plate) c.vehicle_plate as plate, c.change_odo, c.change_date
      from public.oil_changes c
      order by c.vehicle_plate, coalesce(c.change_date, date '1900-01-01') desc, c.created_at desc
    ),
    -- change date unknown: the first reading at or above the change odometer (earlier, lower ones are the previous cycle)
    fc as (
      select distinct on (x.plate) x.plate, x.dt, x.ts
      from raw x join lc on lc.plate = x.plate
      where lc.change_date is null and x.odo_value >= lc.change_odo
      order by x.plate, x.dt, x.ts, x.odo_value
    )
    select x.plate, x.odo_value, x.dt, x.ts, x.src, lc.change_odo as base_odo, lc.change_date as base_day
    from raw x
    left join lc on lc.plate = x.plate
    left join fc on fc.plate = x.plate
    where x.dt >= coalesce(lc.change_date, date '1900-01-01')
      and (lc.change_date is not null or fc.plate is null or (x.dt, x.ts) >= (fc.dt, fc.ts))
    order by x.plate, x.dt, x.ts, x.odo_value
  loop
    if v_prev is distinct from r.plate then
      if n > 0 then   -- the previous vehicle is finished: write its rows out
        return query select v_prev, a_odo[g], a_day[g], a_ts[g], a_src[g], a_ok[g], a_why[g] from generate_series(1, n) g;
      end if;
      v_prev := r.plate;
      n := 0; a_odo := '{}'; a_day := '{}'; a_ts := '{}'; a_src := '{}'; a_ok := '{}'; a_why := '{}';
      v_ref_odo := r.base_odo; v_ref_day := r.base_day; v_ref_idx := 0; v_ok_idx := 0; v_grp_start := 0; v_grp_end := 0;
    end if;

    n := n + 1;
    a_odo[n] := r.odo_value; a_day[n] := r.dt; a_ts[n] := r.ts; a_src[n] := r.src;

    v_why := null;
    v_noise := false;
    if v_ref_odo is not null then
      if r.odo_value < v_ref_odo then
        if v_ref_odo - r.odo_value <= v_tol then
          v_noise := true;     -- a small step back: not wrong, but never the reference
        else
          v_why := case when v_ref_idx = 0 then 'lower_than_last_change' else 'lower_than_previous' end;
        end if;
      elsif v_ref_day is not null and (r.odo_value - v_ref_odo) > v_jump * greatest(1, r.dt - v_ref_day) then
        v_why := 'jump_too_large';
      end if;
    end if;

    if v_noise then
      a_ok[n] := true; a_why[n] := null;
      v_ok_idx := n;           -- it breaks a run of rejected readings, but the reference stays where it was
    elsif v_why is null then
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
          -- the old reference is marked.  If it is still part of the previous reset group (no normal reading was
          -- accepted after that group), the whole group is marked with it: two spike readings in a row are
          -- accepted together by a reset and must go together.  Readings accepted normally are never swept up.
          for k in (case when v_grp_start > 0 and v_ref_idx <= v_grp_end then v_grp_start else v_ref_idx end) .. v_ref_idx loop
            a_ok[k] := false; a_why[k] := 'suspect_baseline';
          end loop;
        end if;
        v_grp_start := v_s; v_grp_end := n;
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

notify pgrst, 'reload schema';

commit;
