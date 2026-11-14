-- =====================================================================
-- 063_report_non_p_by_month.sql   READ ONLY.  Changes nothing.
-- Automatic Fuel already given on days whose final attendance code was NOT P,
-- per month and per code.  Totals only (no names or IDs).
-- Works before or after 063 is installed (it does not use the 063 helpers):
-- same rule as 063 — a stored code wins (NM counts as no code); else a shift
-- form that day = P; else a finished day = A; else NM (today, not final).
-- =====================================================================

with final as (
  select a.allocation_date,
         a.amount,
         case
           when att.status is not null and att.status <> 'NM' then att.status
           when exists (select 1 from public.shift_entries s
                        where s.identity_number = a.identity_number and s.shift_date = a.allocation_date) then 'P'
           when a.allocation_date < (now() at time zone 'Asia/Riyadh')::date then 'A'
           else 'NM'
         end as final_code
  from public.automatic_fuel_allocations a
  left join public.driver_attendance att
    on att.identity_number = a.identity_number and att.attendance_date = a.allocation_date
)
-- A) per month: all, P, non-P
select to_char(allocation_date, 'YYYY-MM')                          as month,
       count(*)                                                      as allocations,
       sum(amount)                                                   as total_sar,
       count(*) filter (where final_code = 'P')                      as p_days,
       sum(amount) filter (where final_code = 'P')                   as p_sar,
       count(*) filter (where final_code <> 'P')                     as non_p_days,
       coalesce(sum(amount) filter (where final_code <> 'P'), 0)     as non_p_sar
from final
group by 1
order by 1;

-- B) the non-P part, per month and code (select and run this one on its own)
with final as (
  select a.allocation_date,
         a.amount,
         case
           when att.status is not null and att.status <> 'NM' then att.status
           when exists (select 1 from public.shift_entries s
                        where s.identity_number = a.identity_number and s.shift_date = a.allocation_date) then 'P'
           when a.allocation_date < (now() at time zone 'Asia/Riyadh')::date then 'A'
           else 'NM'
         end as final_code
  from public.automatic_fuel_allocations a
  left join public.driver_attendance att
    on att.identity_number = a.identity_number and att.attendance_date = a.allocation_date
)
select to_char(allocation_date, 'YYYY-MM') as month, final_code, count(*) as days, sum(amount) as sar
from final
where final_code <> 'P'
group by 1, 2
order by 1, 2;
