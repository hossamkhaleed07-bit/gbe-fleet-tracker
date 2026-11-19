begin;

-- =====================================================================
-- 064_automatic_fuel_void.sql
-- Void (and restore) an FDP Automatic Fuel day, and a review list of
-- automatic fuel days that have no matching PetroApp / Futurehub invoice.
--
-- Why: a driver works (P), the daily job records automatic fuel for the day,
-- but the driver never withdraws it from PetroApp, so the system total does
-- not match PetroApp at reconciliation.
--
-- 1) Void / restore (admin only)
--   * the row is NEVER deleted: voided_at / voided_by / void_reason are set.
--     A voided day still holds its (driver, day) slot, so the daily job never
--     allocates that day again.
--   * the reason is required, at least 10 characters (void AND restore).
--   * only a past day can be voided (Riyadh time), never today or later.
--   * auto_fuel_void_allocations(ids[], reason) voids one or many days in ONE
--     transaction: all or nothing.  Days already voided are skipped.
--   * auto_fuel_restore_allocation(id, reason) puts a voided day back.
--   * every void and restore is written to the append-only change log
--     (kind 'void': old = amount, new = 0;  kind 'restore': old = 0, new = amount).
--   * auto_fuel_adjust_allocation refuses a voided day (restore it first).
--   * voided amounts are left out of every total: the dashboard only counts
--     rows with voided_at null, and the 063 reports skip them too.
--
-- 2) Review list: auto_fuel_invoice_review(from, to)   (admin only)
--   For every automatic fuel day (not voided, past days only) in the range:
--     need(day)    = automatic fuel + APPROVED reinforcement (amount + loan
--                    adjustment) of that driver on that day
--     invoice(day) = PetroApp + Futurehub invoices (cost, VAT incl.) for that
--                    driver (NID = ID number) on that day
--   status, checked in this order (10% tolerance = 0.9):
--     matched          invoice(day) >= 0.9 * need(day)               (not returned)
--     not_loaded       the day after is later than the last loaded invoice day
--     combined_fill    invoice(day) + invoice(next or previous day)
--                        >= 0.9 * (need(day) + need(that day)), with an invoice
--                        on that day: one larger fill covering both days
--     partial_invoice  some invoice on day-1, day or day+1, but not enough
--     no_invoice       no invoice at all from day-1 to day+1    (suggest void)
--   Each row also carries the final attendance code (063's rule) and the
--   approved reinforcement amount.
--
-- Needs 061 and 063.  ONE transaction: if anything fails, nothing changes.
-- Undo: 064_rollback.sql (refuses while any day is voided).
-- =====================================================================

do $$
begin
  if to_regprocedure('private.auto_fuel_final_attendance(text,date)') is null then
    raise exception 'STOP: run 063 first (private.auto_fuel_final_attendance does not exist).';
  end if;
  if to_regclass('public.reinforcement_requests') is null or to_regclass('public.fuel_invoice_records') is null then
    raise exception 'STOP: public.reinforcement_requests / public.fuel_invoice_records missing.';
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'automatic_fuel_allocations' and column_name = 'voided_at') then
    raise exception 'STOP: 064 is already installed (automatic_fuel_allocations.voided_at exists).';
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 1) Columns and the change-log kinds
-- ---------------------------------------------------------------------

alter table public.automatic_fuel_allocations
  add column voided_at timestamptz,
  add column voided_by text,
  add column void_reason text,
  add constraint automatic_fuel_allocations_void_check check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and char_length(btrim(void_reason)) >= 10)
  );

-- 061 created the kind check inline; drop it by what it checks, not by name.
do $$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.automatic_fuel_amount_changes'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) like '%kind%'
  loop
    execute format('alter table public.automatic_fuel_amount_changes drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.automatic_fuel_amount_changes
  add constraint automatic_fuel_amount_changes_kind_check
  check (kind in ('default', 'driver', 'allocation', 'void', 'restore'));


-- ---------------------------------------------------------------------
-- 2) Helpers
-- ---------------------------------------------------------------------

create function private.auto_fuel_require_reason(p_reason text) returns text
language plpgsql immutable
as $$
begin
  if char_length(coalesce(btrim(p_reason), '')) < 10 then
    raise exception 'AUTO_FUEL_REASON_TOO_SHORT' using errcode = '22023';
  end if;
  return btrim(p_reason);
end;
$$;


-- ---------------------------------------------------------------------
-- 3) Void, restore (admin only; each call is one transaction)
-- ---------------------------------------------------------------------

-- One or many days, one reason.  All or nothing.  Returns how many were voided.
create function public.auto_fuel_void_allocations(p_ids uuid[], p_reason text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text;
  v_ids uuid[];
  v_found integer;
  v_count integer;
begin
  perform private.auto_fuel_require_admin();
  v_reason := private.auto_fuel_require_reason(p_reason);
  select array_agg(distinct x) into v_ids from unnest(p_ids) x where x is not null;
  if v_ids is null then
    raise exception 'AUTO_FUEL_NO_ROWS' using errcode = '22023';
  end if;

  -- lock every row first, then check them all before changing anything
  select count(*) into v_found
  from (select 1 from public.automatic_fuel_allocations where id = any (v_ids) for update) l;
  if v_found <> cardinality(v_ids) then
    raise exception 'AUTO_FUEL_UNKNOWN_ALLOCATION' using errcode = '22023';
  end if;
  if exists (select 1 from public.automatic_fuel_allocations
             where id = any (v_ids) and allocation_date >= private.riyadh_today()) then
    raise exception 'AUTO_FUEL_VOID_PAST_DAYS_ONLY' using errcode = '22023';
  end if;

  with v as (
    update public.automatic_fuel_allocations
       set voided_at = now(), voided_by = private.auto_fuel_actor(), void_reason = v_reason
     where id = any (v_ids) and voided_at is null
    returning id, identity_number, allocation_date, amount
  ), log as (
    insert into public.automatic_fuel_amount_changes (kind, identity_number, allocation_id, allocation_date, old_amount, new_amount, reason, changed_by)
    select 'void', identity_number, id, allocation_date, amount, 0, v_reason, private.auto_fuel_actor() from v
    returning 1
  )
  select count(*) into v_count from log;
  return v_count;
end;
$$;

create function public.auto_fuel_restore_allocation(p_allocation_id uuid, p_reason text)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text;
  v_row public.automatic_fuel_allocations;
begin
  perform private.auto_fuel_require_admin();
  v_reason := private.auto_fuel_require_reason(p_reason);
  select * into v_row from public.automatic_fuel_allocations where id = p_allocation_id for update;
  if not found then
    raise exception 'AUTO_FUEL_UNKNOWN_ALLOCATION' using errcode = '22023';
  end if;
  if v_row.voided_at is null then
    raise exception 'AUTO_FUEL_NOT_VOIDED' using errcode = '22023';
  end if;
  update public.automatic_fuel_allocations
     set voided_at = null, voided_by = null, void_reason = null
   where id = p_allocation_id;
  insert into public.automatic_fuel_amount_changes (kind, identity_number, allocation_id, allocation_date, old_amount, new_amount, reason, changed_by)
  values ('restore', v_row.identity_number, v_row.id, v_row.allocation_date, 0, v_row.amount, v_reason, private.auto_fuel_actor());
  return v_row.amount;
end;
$$;

-- 061's correction, unchanged except that a voided day is refused.
create or replace function public.auto_fuel_adjust_allocation(p_allocation_id uuid, p_amount numeric, p_reason text)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.automatic_fuel_allocations;
begin
  perform private.auto_fuel_require_admin();
  if p_amount is null or p_amount <= 0 then
    raise exception 'AUTO_FUEL_AMOUNT_MUST_BE_POSITIVE' using errcode = '22023';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'AUTO_FUEL_REASON_REQUIRED' using errcode = '22023';
  end if;
  select * into v_row from public.automatic_fuel_allocations where id = p_allocation_id for update;
  if not found then
    raise exception 'AUTO_FUEL_UNKNOWN_ALLOCATION' using errcode = '22023';
  end if;
  if v_row.voided_at is not null then
    raise exception 'AUTO_FUEL_ALLOCATION_VOIDED' using errcode = '22023';
  end if;
  if v_row.amount = p_amount then return p_amount; end if;
  update public.automatic_fuel_allocations
     set amount = p_amount, adjusted_at = now(), adjusted_by = private.auto_fuel_actor()
   where id = p_allocation_id;
  insert into public.automatic_fuel_amount_changes (kind, identity_number, allocation_id, allocation_date, old_amount, new_amount, reason, changed_by)
  values ('allocation', v_row.identity_number, v_row.id, v_row.allocation_date, v_row.amount, p_amount, btrim(p_reason), private.auto_fuel_actor());
  return p_amount;
end;
$$;


-- ---------------------------------------------------------------------
-- 4) Review list: automatic fuel days without a matching invoice
-- ---------------------------------------------------------------------

create function public.auto_fuel_invoice_review(p_from date, p_to date)
returns table (
  allocation_id uuid,
  identity_number text,
  full_name text,
  vehicle_plate text,
  allocation_date date,
  attendance_code text,
  automatic_fuel numeric,
  reinforcement numeric,
  need numeric,
  invoice_prev numeric,
  invoice_day numeric,
  invoice_next numeric,
  status text,
  related_date date,
  last_invoice_date date
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare v_last date;
begin
  perform private.auto_fuel_require_admin();
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'AUTO_FUEL_BAD_RANGE' using errcode = '22023';
  end if;
  select max(f.entry_date) into v_last
  from public.fuel_invoice_records f where f.data_source in ('PetroApp', 'Futurehub');

  return query
  with inv as (
    select btrim(f.nid) as nid, f.entry_date as d, sum(f.cost) as sar
    from public.fuel_invoice_records f
    where f.data_source in ('PetroApp', 'Futurehub')
      and f.entry_date between p_from - 1 and p_to + 1
    group by 1, 2
  ), reinf as (
    select r.identity_number as idn, r.shift_date as d, sum(r.amount + coalesce(r.loan_adjustment, 0)) as sar
    from public.reinforcement_requests r
    where r.status = 'approved' and r.amount is not null
      and r.shift_date between p_from - 1 and p_to + 1
    group by 1, 2
  ), auto as (
    select a.identity_number as idn, a.allocation_date as d, sum(a.amount) as sar
    from public.automatic_fuel_allocations a
    where a.voided_at is null and a.allocation_date between p_from - 1 and p_to + 1
    group by 1, 2
  ), need as (
    select coalesce(x.idn, y.idn) as idn, coalesce(x.d, y.d) as d,
           coalesce(x.sar, 0) + coalesce(y.sar, 0) as sar
    from auto x full join reinf y on y.idn = x.idn and y.d = x.d
  ), days as (
    select a.id, a.identity_number, a.full_name, a.vehicle_plate, a.allocation_date, a.amount,
           coalesce((select y.sar from reinf y where y.idn = a.identity_number and y.d = a.allocation_date), 0) as reinf_sar,
           coalesce((select n.sar from need n where n.idn = a.identity_number and n.d = a.allocation_date), 0) as need0,
           coalesce((select n.sar from need n where n.idn = a.identity_number and n.d = a.allocation_date - 1), 0) as need_prev,
           coalesce((select n.sar from need n where n.idn = a.identity_number and n.d = a.allocation_date + 1), 0) as need_next,
           coalesce((select i.sar from inv i where i.nid = a.identity_number and i.d = a.allocation_date - 1), 0) as inv_prev,
           coalesce((select i.sar from inv i where i.nid = a.identity_number and i.d = a.allocation_date), 0) as inv0,
           coalesce((select i.sar from inv i where i.nid = a.identity_number and i.d = a.allocation_date + 1), 0) as inv_next
    from public.automatic_fuel_allocations a
    where a.voided_at is null
      and a.allocation_date between p_from and p_to
      and a.allocation_date < private.riyadh_today()
  ), judged as (
    select d.*,
      case
        when d.inv0 >= 0.9 * d.need0 then 'matched'
        when v_last is null or d.allocation_date + 1 > v_last then 'not_loaded'
        when d.inv_next > 0 and d.inv0 + d.inv_next >= 0.9 * (d.need0 + d.need_next) then 'combined_fill'
        when d.inv_prev > 0 and d.inv0 + d.inv_prev >= 0.9 * (d.need0 + d.need_prev) then 'combined_fill'
        when d.inv_prev + d.inv0 + d.inv_next > 0 then 'partial_invoice'
        else 'no_invoice'
      end as st
    from days d
  )
  select j.id, j.identity_number, j.full_name, j.vehicle_plate, j.allocation_date,
         private.auto_fuel_final_attendance(j.identity_number, j.allocation_date),
         j.amount, j.reinf_sar, j.need0,
         round(j.inv_prev, 2), round(j.inv0, 2), round(j.inv_next, 2),
         j.st,
         case when j.st = 'combined_fill' then
           case when j.inv_next > 0 and j.inv0 + j.inv_next >= 0.9 * (j.need0 + j.need_next)
                then j.allocation_date + 1 else j.allocation_date - 1 end
         end,
         v_last
  from judged j
  where j.st <> 'matched'
  order by j.allocation_date desc, j.identity_number, j.id;
end;
$$;


-- ---------------------------------------------------------------------
-- 5) Access: the admin check is inside each function
-- ---------------------------------------------------------------------

revoke all on function private.auto_fuel_require_reason(text) from public, anon, authenticated;
revoke all on function public.auto_fuel_void_allocations(uuid[], text), public.auto_fuel_restore_allocation(uuid, text),
  public.auto_fuel_invoice_review(date, date) from public, anon;
grant execute on function public.auto_fuel_void_allocations(uuid[], text), public.auto_fuel_restore_allocation(uuid, text),
  public.auto_fuel_invoice_review(date, date) to authenticated;
-- create or replace keeps 061's grants on auto_fuel_adjust_allocation; repeated to be sure.
revoke all on function public.auto_fuel_adjust_allocation(uuid, numeric, text) from public, anon;
grant execute on function public.auto_fuel_adjust_allocation(uuid, numeric, text) to authenticated;

commit;
