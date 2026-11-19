-- =====================================================================
-- 062_amount_checks.sql   READ ONLY.  Changes nothing.
-- Totals only (no names or IDs).  Run each query on its own.
-- Explains the automatic fuel amounts seen in November 2026.
-- =====================================================================

-- A) Duplicate same-day allocations.
-- A1) The database blocks two rows for the same ID and day: expect one row
--     whose definition is UNIQUE (identity_number, allocation_date)
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.automatic_fuel_allocations'::regclass and contype in ('u', 'p');

-- A2) Duplicates the constraint cannot catch: the same ID written with spaces,
--     or two IDs on the same vehicle the same day.  Expect 0 and 0.
select
  (select count(*) from (
     select btrim(identity_number), allocation_date from public.automatic_fuel_allocations
     group by 1, 2 having count(*) > 1) x)                                 as same_id_trimmed_same_day,
  (select count(*) from (
     select vehicle_plate, allocation_date from public.automatic_fuel_allocations
     where coalesce(btrim(vehicle_plate), '') <> ''
     group by 1, 2 having count(*) > 1) y)                                 as same_vehicle_same_day;

-- B + C) Amounts per day from 1 November: how many drivers got each amount,
--        and how many of those came from a driver's own amount today.
--        (B: 20 SAR after 5 Nov.  C: 30 SAR on 1-4 Nov.)
select a.allocation_date, a.amount, count(*) as drivers,
       count(*) filter (where o.identity_number is not null) as have_own_amount_now,
       count(*) filter (where a.adjusted_at is not null)      as corrected_by_hand
from public.automatic_fuel_allocations a
left join public.automatic_fuel_driver_amounts o on o.identity_number = a.identity_number
where a.allocation_date >= date '2026-11-01'
group by 1, 2
order by 1, 2;

-- B + C) Every amount change ever made (default, driver, day), per day and kind.
--        The time a default or driver amount was set, against the daily job
--        (12:00 Riyadh before 063), tells which days used the old or new amount.
select (changed_at at time zone 'Asia/Riyadh')::date as riyadh_day, kind, old_amount, new_amount,
       count(*) as changes, min(changed_at at time zone 'Asia/Riyadh') as first_at_riyadh,
       max(changed_at at time zone 'Asia/Riyadh') as last_at_riyadh
from public.automatic_fuel_amount_changes
group by 1, 2, 3, 4
order by 1, 5 desc;

-- C) When 061 was run (the settings row is created by 061) and the default now
select updated_by, updated_at at time zone 'Asia/Riyadh' as at_riyadh, default_amount
from public.automatic_fuel_settings;

-- D) The 15 SAR day(s): which days, and whether a correction made them 15
select a.allocation_date, a.amount, count(*) as drivers,
       count(*) filter (where a.adjusted_at is not null) as corrected_by_hand,
       min(a.adjusted_at at time zone 'Asia/Riyadh') as corrected_at_riyadh
from public.automatic_fuel_allocations a
where a.amount = 15
group by 1, 2
order by 1;

-- D) The correction behind it, if there was one (old -> new and the reason)
select allocation_date, old_amount, new_amount, reason, changed_by, changed_at at time zone 'Asia/Riyadh' as at_riyadh
from public.automatic_fuel_amount_changes
where kind = 'allocation' and (new_amount = 15 or old_amount = 15)
order by changed_at;
