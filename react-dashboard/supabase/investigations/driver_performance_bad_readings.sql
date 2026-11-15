-- =====================================================================
-- READ ONLY - changes nothing.  Driver Performance investigation, point 2 (distance).
-- Run in the Supabase SQL Editor.  One result table: every driver-day whose distance
-- (end odometer - start odometer) is negative or above 1500 km.
--
-- It picks the two readings exactly the way the page does today
-- (src/lib/calc.js buildDriverComparison, rows loaded newest first):
--   start = the NEWEST start entry of the day, end = the OLDEST end entry of the day.
-- The start_id / end_id columns are the shift_entries rows to check and correct.
-- n_start / n_end > 1 means the driver submitted more than once that day; on those days
-- the small negatives (-1 .. -20 km) usually come from that choice, not a wrong reading.
-- =====================================================================
with e as (
  select s.id, s.identity_number, s.shift_type, s.odo_reading, s.created_at,
         coalesce(s.shift_date, (s.created_at at time zone 'Asia/Riyadh')::date) as day,
         d.project, d.is_active
    from public.shift_entries s
    join public.drivers d on d.identity_number = s.identity_number
),
g as (
  select identity_number, day, project, is_active,
         (array_agg(id          order by created_at desc) filter (where shift_type = 'start'))[1] as start_id,
         (array_agg(odo_reading order by created_at desc) filter (where shift_type = 'start'))[1] as start_odo,
         (array_agg(id          order by created_at asc)  filter (where shift_type = 'end'))[1]   as end_id,
         (array_agg(odo_reading order by created_at asc)  filter (where shift_type = 'end'))[1]   as end_odo,
         count(*) filter (where shift_type = 'start') as n_start,
         count(*) filter (where shift_type = 'end')   as n_end
    from e
   group by identity_number, day, project, is_active
)
select day, project, is_active,
       start_id, start_odo, end_id, end_odo,
       end_odo - start_odo as delta_km,
       case when end_odo - start_odo < 0 then 'negative' else 'over 1500 km' end as problem,
       n_start, n_end
  from g
 where start_odo is not null and end_odo is not null
   and (end_odo - start_odo < 0 or end_odo - start_odo > 1500)
 order by day, project;
