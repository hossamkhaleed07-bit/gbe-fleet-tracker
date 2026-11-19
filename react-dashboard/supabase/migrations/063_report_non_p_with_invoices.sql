-- =====================================================================
-- 063_report_non_p_with_invoices.sql   READ ONLY.  Changes nothing.
-- Totals only (no names or IDs).  September, October and November 2026.
-- Run each query on its own in the Supabase SQL Editor (select it, Run).
--
-- A) Automatic Fuel RECORDED on days whose final attendance code was not P,
--    per month and code.
-- B) Real fuel invoices (PetroApp / Futurehub, fuel_invoice_records) for the
--    SAME driver on the SAME non-P day: was fuel actually filled that day?
--
-- Final code, same rule as 063: a code entered in attendance wins (A, WO, AL,
-- Left, VM, P); otherwise a shift form that day = P; otherwise the day is over
-- and counts as A.  For this report that last case is split in two:
--   'NM (past day)'      - an NM row was stored and never changed
--   'no code (past day)' - no attendance row at all
-- Today and later are not final and are left out.
-- An invoice is matched on its NID = the driver's ID number and its date.
-- Days voided with 064 are left out (works with or without 064 installed).
-- =====================================================================

-- A) Automatic Fuel on non-P days, per month and code
with final as (
  select a.allocation_date, a.amount,
         case
           when att.status is not null and att.status <> 'NM' then att.status
           when exists (select 1 from public.shift_entries s
                        where s.identity_number = a.identity_number and s.shift_date = a.allocation_date) then 'P'
           when att.status = 'NM' then 'NM (past day)'
           else 'no code (past day)'
         end as final_code
  from public.automatic_fuel_allocations a
  left join public.driver_attendance att
    on att.identity_number = a.identity_number and att.attendance_date = a.allocation_date
  where a.allocation_date >= date '2026-09-01' and a.allocation_date < date '2026-12-01'
    and a.allocation_date < (now() at time zone 'Asia/Riyadh')::date
    and (to_jsonb(a) ->> 'voided_at') is null   -- 064: voided days are not counted
)
select to_char(allocation_date, 'YYYY-MM') as month, final_code,
       count(*) as days, sum(amount) as automatic_fuel_sar
from final
where final_code <> 'P'
group by rollup (1, 2)
order by 1 nulls last, 2 nulls last;

-- B) The same non-P days: invoices for the same driver on the same day
with final as (
  select a.identity_number, a.allocation_date, a.amount,
         case
           when att.status is not null and att.status <> 'NM' then att.status
           when exists (select 1 from public.shift_entries s
                        where s.identity_number = a.identity_number and s.shift_date = a.allocation_date) then 'P'
           when att.status = 'NM' then 'NM (past day)'
           else 'no code (past day)'
         end as final_code
  from public.automatic_fuel_allocations a
  left join public.driver_attendance att
    on att.identity_number = a.identity_number and att.attendance_date = a.allocation_date
  where a.allocation_date >= date '2026-09-01' and a.allocation_date < date '2026-12-01'
    and a.allocation_date < (now() at time zone 'Asia/Riyadh')::date
    and (to_jsonb(a) ->> 'voided_at') is null   -- 064: voided days are not counted
),
inv as (
  select trim(nid) as nid, entry_date,
         count(*) as invoices,
         sum(cost) as invoice_sar,
         sum(cost) filter (where use_type = 'FDP use') as fdp_use_sar
  from public.fuel_invoice_records
  where data_source in ('PetroApp', 'Futurehub')
    and entry_date >= date '2026-09-01' and entry_date < date '2026-12-01'
  group by 1, 2
)
select to_char(f.allocation_date, 'YYYY-MM')               as month,
       f.final_code,
       count(*)                                            as non_p_days,
       sum(f.amount)                                       as automatic_fuel_sar,
       count(i.nid)                                        as days_with_invoice,
       coalesce(sum(f.amount) filter (where i.nid is not null), 0) as automatic_fuel_sar_on_those_days,
       coalesce(sum(i.invoices), 0)                        as invoices,
       coalesce(round(sum(i.invoice_sar), 2), 0)           as invoice_sar,
       coalesce(round(sum(i.fdp_use_sar), 2), 0)           as invoice_sar_fdp_use
from final f
left join inv i on i.nid = f.identity_number and i.entry_date = f.allocation_date
where f.final_code <> 'P'
group by rollup (1, 2)
order by 1 nulls last, 2 nulls last;

-- C) How far the invoices go (November may not be loaded yet)
select to_char(entry_date, 'YYYY-MM') as month, count(*) as invoices, max(entry_date) as last_day
from public.fuel_invoice_records
where entry_date >= date '2026-09-01'
group by 1 order by 1;
