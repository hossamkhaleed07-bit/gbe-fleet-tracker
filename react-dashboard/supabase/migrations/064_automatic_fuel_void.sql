begin;

-- =====================================================================
-- 064_automatic_fuel_void.sql
-- Void (and restore) an FDP Automatic Fuel day, and two review lists:
--   A) automatic fuel days that have no matching PetroApp / Futurehub invoice
--   B) PetroApp / Futurehub fills with no automatic fuel and no approved
--      reinforcement, with the admin's decision for each day
-- plus the monthly reconciliation line.
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
-- 3) List B: auto_fuel_unexplained_fills(from, to)   (admin only)
--   Some drivers withdraw fuel from PetroApp without submitting the form, so
--   with 063 they get no automatic fuel: the system shows 0, PetroApp shows 30.
--   Per row the admin can choose (reason >= 10 chars, logged, reversible):
--   * "Worked, forgot the form" (auto_fuel_mark_worked): attendance P for that
--     day.  Inside the next 06:30 run's window the job adds the fuel; an older
--     day (invoices arrive weeks late) gets it at once, at the amount IN EFFECT
--     ON THAT DAY (063's private.auto_fuel_amount_on).  Undo:
--     auto_fuel_undo_worked (old code back, that day's fuel voided).
--   * "Didn't work" (auto_fuel_mark_unentitled): an unentitled withdrawal with
--     the invoice SAR, for follow-up.  Undo: auto_fuel_clear_unentitled.
--
-- 4) auto_fuel_reconciliation(from, to): PetroApp total = on automatic fuel /
--    reinforcement days + unentitled + still unexplained.
--
-- Needs 061, 062 and 063 (063's amount on the day).  ONE transaction: if anything fails, nothing changes.
-- Undo: 064_rollback.sql (refuses while any day is voided).
-- =====================================================================

do $$
begin
  if to_regprocedure('private.auto_fuel_final_attendance(text,date)') is null
     or to_regprocedure('private.auto_fuel_amount_on(text,date)') is null then
    raise exception 'STOP: run 063 first (private.auto_fuel_final_attendance / auto_fuel_amount_on do not exist).';
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
  check (kind in ('default', 'driver', 'allocation', 'void', 'restore',
                  'forgot_form', 'forgot_form_undo', 'unentitled', 'unentitled_clear'));


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
-- 5) List B: PetroApp / Futurehub fills with no automatic fuel and no
--    approved reinforcement, and what an admin decided about each
-- ---------------------------------------------------------------------

-- "Worked, forgot the form": one row per driver-day the admin marked.
-- Keeps the attendance code it replaced, so undo can put it back.
create table public.automatic_fuel_forgot_form (
  id uuid primary key default gen_random_uuid(),
  identity_number text not null,
  work_date date not null,
  old_status text,                    -- null = there was no attendance row
  allocation_id uuid,                 -- fuel given at once (day outside the 7-day job window)
  reason text not null check (char_length(btrim(reason)) >= 10),
  marked_by text,
  marked_at timestamptz not null default now(),
  undone_at timestamptz,
  undone_by text,
  undo_reason text,
  check (undone_at is null or char_length(btrim(undo_reason)) >= 10)
);
create unique index automatic_fuel_forgot_form_active
  on public.automatic_fuel_forgot_form (identity_number, work_date) where undone_at is null;

-- "Didn't work": an unentitled withdrawal, kept for follow-up (recovery is
-- outside the system).  The invoices themselves are never changed.
create table public.automatic_fuel_unentitled (
  id uuid primary key default gen_random_uuid(),
  identity_number text not null,
  fill_date date not null,
  invoice_sar numeric(10,2) not null,  -- PetroApp + Futurehub on that day, when marked
  reason text not null check (char_length(btrim(reason)) >= 10),
  marked_by text,
  marked_at timestamptz not null default now(),
  cleared_at timestamptz,
  cleared_by text,
  clear_reason text,
  check (cleared_at is null or char_length(btrim(clear_reason)) >= 10)
);
create unique index automatic_fuel_unentitled_active
  on public.automatic_fuel_unentitled (identity_number, fill_date) where cleared_at is null;

alter table public.automatic_fuel_forgot_form enable row level security;
alter table public.automatic_fuel_unentitled enable row level security;
create policy "admin read automatic_fuel_forgot_form" on public.automatic_fuel_forgot_form
  for select to authenticated using (private.is_admin());
create policy "admin read automatic_fuel_unentitled" on public.automatic_fuel_unentitled
  for select to authenticated using (private.is_admin());
revoke all on public.automatic_fuel_forgot_form, public.automatic_fuel_unentitled from public, anon, authenticated;
grant select on public.automatic_fuel_forgot_form, public.automatic_fuel_unentitled to authenticated;

-- PetroApp + Futurehub SAR of a driver on a day.
create function private.auto_fuel_invoice_sar(p_identity_number text, p_date date)
returns numeric
language sql stable
set search_path = public
as $$
  select coalesce(sum(f.cost), 0) from public.fuel_invoice_records f
  where f.data_source in ('PetroApp', 'Futurehub') and btrim(f.nid) = p_identity_number and f.entry_date = p_date
$$;

-- Approved reinforcement SAR of a driver on a day.
create function private.auto_fuel_reinforcement_sar(p_identity_number text, p_date date)
returns numeric
language sql stable
set search_path = public
as $$
  select coalesce(sum(r.amount + coalesce(r.loan_adjustment, 0)), 0) from public.reinforcement_requests r
  where r.status = 'approved' and r.amount is not null and r.identity_number = p_identity_number and r.shift_date = p_date
$$;

-- "Worked, forgot the form".  Sets the day's attendance to P.  When the day is
-- still inside the window of the next 06:30 run (the last 7 days as of
-- tomorrow), the job adds the fuel; otherwise it is given now, at the amount
-- in effect ON THAT DAY.  Returns the amount given now (0 = left to the job).
create function public.auto_fuel_mark_worked(p_identity_number text, p_date date, p_reason text)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text;
  v_driver public.drivers;
  v_alloc public.automatic_fuel_allocations;
  v_old text;
  v_had_row boolean;
  v_amount numeric := 0;
  v_alloc_id uuid;
begin
  perform private.auto_fuel_require_admin();
  v_reason := private.auto_fuel_require_reason(p_reason);
  if p_date is null or p_date >= private.riyadh_today() then
    raise exception 'AUTO_FUEL_PAST_DAYS_ONLY' using errcode = '22023';
  end if;
  select * into v_driver from public.drivers where identity_number = p_identity_number;
  if not found or v_driver.project <> 'FDP' or not v_driver.is_active then
    raise exception 'AUTO_FUEL_NOT_ACTIVE_FDP' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('auto_fuel_day:' || p_identity_number || ':' || p_date));
  if exists (select 1 from public.automatic_fuel_forgot_form
             where identity_number = p_identity_number and work_date = p_date and undone_at is null) then
    raise exception 'AUTO_FUEL_ALREADY_MARKED' using errcode = '22023';
  end if;
  if exists (select 1 from public.automatic_fuel_unentitled
             where identity_number = p_identity_number and fill_date = p_date and cleared_at is null) then
    raise exception 'AUTO_FUEL_MARKED_UNENTITLED' using errcode = '22023';
  end if;
  select * into v_alloc from public.automatic_fuel_allocations
  where identity_number = p_identity_number and allocation_date = p_date for update;
  if found then
    if v_alloc.voided_at is not null then
      raise exception 'AUTO_FUEL_ALLOCATION_VOIDED' using errcode = '22023';   -- use Restore
    end if;
    raise exception 'AUTO_FUEL_ALREADY_ALLOCATED' using errcode = '22023';
  end if;

  select da.status into v_old from public.driver_attendance da
  where da.identity_number = p_identity_number and da.attendance_date = p_date for update;
  v_had_row := found;
  if v_had_row then
    update public.driver_attendance
       set status = 'P', marked_by = private.auto_fuel_actor(), updated_at = now()
     where identity_number = p_identity_number and attendance_date = p_date;
  else
    insert into public.driver_attendance (identity_number, project, attendance_date, status, marked_by)
    values (p_identity_number, v_driver.project, p_date, 'P', private.auto_fuel_actor());
  end if;

  -- The next 06:30 run covers (tomorrow - 7) .. today; anything older is given now.
  if p_date < private.riyadh_today() - 6 then
    v_amount := private.auto_fuel_amount_on(p_identity_number, p_date);
    insert into public.automatic_fuel_allocations (identity_number, full_name, project, vehicle_plate, allocation_date, amount, source)
    values (p_identity_number, v_driver.full_name, v_driver.project, v_driver.assigned_vehicle_plate, p_date, v_amount, 'admin')
    returning id into v_alloc_id;
  end if;

  insert into public.automatic_fuel_forgot_form (identity_number, work_date, old_status, allocation_id, reason, marked_by)
  values (p_identity_number, p_date, case when v_had_row then v_old end, v_alloc_id, v_reason, private.auto_fuel_actor());
  insert into public.automatic_fuel_amount_changes (kind, identity_number, allocation_id, allocation_date, old_amount, new_amount, reason, changed_by)
  values ('forgot_form', p_identity_number, v_alloc_id, p_date, 0, v_amount,
          v_reason || ' [attendance ' || coalesce(v_old, 'none') || ' -> P]', private.auto_fuel_actor());
  return v_amount;
end;
$$;

-- Undo "Worked, forgot the form": the attendance code goes back to what it was
-- (only if it is still the P this action set), and the day's automatic fuel,
-- given now or later by the job, is voided with the same reason.
create function public.auto_fuel_undo_worked(p_identity_number text, p_date date, p_reason text)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text;
  v_mark public.automatic_fuel_forgot_form;
  v_alloc public.automatic_fuel_allocations;
  v_status text;
begin
  perform private.auto_fuel_require_admin();
  v_reason := private.auto_fuel_require_reason(p_reason);
  perform pg_advisory_xact_lock(hashtext('auto_fuel_day:' || p_identity_number || ':' || p_date));
  select * into v_mark from public.automatic_fuel_forgot_form
  where identity_number = p_identity_number and work_date = p_date and undone_at is null for update;
  if not found then
    raise exception 'AUTO_FUEL_NOT_MARKED' using errcode = '22023';
  end if;

  select da.status into v_status from public.driver_attendance da
  where da.identity_number = p_identity_number and da.attendance_date = p_date for update;
  if v_status = 'P' then
    if v_mark.old_status is null then
      delete from public.driver_attendance where identity_number = p_identity_number and attendance_date = p_date;
    else
      update public.driver_attendance
         set status = v_mark.old_status, marked_by = private.auto_fuel_actor(), updated_at = now()
       where identity_number = p_identity_number and attendance_date = p_date;
    end if;
  end if;

  -- There was no allocation for this day when it was marked, so any row now is from this action.
  select * into v_alloc from public.automatic_fuel_allocations
  where identity_number = p_identity_number and allocation_date = p_date and voided_at is null for update;
  if found then
    update public.automatic_fuel_allocations
       set voided_at = now(), voided_by = private.auto_fuel_actor(), void_reason = v_reason
     where id = v_alloc.id;
    insert into public.automatic_fuel_amount_changes (kind, identity_number, allocation_id, allocation_date, old_amount, new_amount, reason, changed_by)
    values ('void', p_identity_number, v_alloc.id, p_date, v_alloc.amount, 0, v_reason, private.auto_fuel_actor());
  end if;

  update public.automatic_fuel_forgot_form
     set undone_at = now(), undone_by = private.auto_fuel_actor(), undo_reason = v_reason
   where id = v_mark.id;
  insert into public.automatic_fuel_amount_changes (kind, identity_number, allocation_id, allocation_date, old_amount, new_amount, reason, changed_by)
  values ('forgot_form_undo', p_identity_number, v_alloc.id, p_date, coalesce(v_alloc.amount, 0), 0,
          v_reason || ' [attendance P -> ' || case when v_status = 'P' then coalesce(v_mark.old_status, 'none') else v_status || ' (left as is)' end || ']',
          private.auto_fuel_actor());
  return coalesce(v_alloc.amount, 0);
end;
$$;

-- "Didn't work": mark the day's fill as an unentitled withdrawal.  Only for a
-- day with PetroApp / Futurehub invoices, no active automatic fuel and no
-- approved reinforcement.  Returns the invoice SAR recorded.
create function public.auto_fuel_mark_unentitled(p_identity_number text, p_date date, p_reason text)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text;
  v_sar numeric;
begin
  perform private.auto_fuel_require_admin();
  v_reason := private.auto_fuel_require_reason(p_reason);
  if p_date is null or p_date >= private.riyadh_today() then
    raise exception 'AUTO_FUEL_PAST_DAYS_ONLY' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('auto_fuel_day:' || p_identity_number || ':' || p_date));
  if exists (select 1 from public.automatic_fuel_unentitled
             where identity_number = p_identity_number and fill_date = p_date and cleared_at is null) then
    raise exception 'AUTO_FUEL_ALREADY_MARKED' using errcode = '22023';
  end if;
  if exists (select 1 from public.automatic_fuel_forgot_form
             where identity_number = p_identity_number and work_date = p_date and undone_at is null) then
    raise exception 'AUTO_FUEL_MARKED_WORKED' using errcode = '22023';
  end if;
  if exists (select 1 from public.automatic_fuel_allocations
             where identity_number = p_identity_number and allocation_date = p_date and voided_at is null) then
    raise exception 'AUTO_FUEL_HAS_AUTOMATIC_FUEL' using errcode = '22023';
  end if;
  if private.auto_fuel_reinforcement_sar(p_identity_number, p_date) > 0 then
    raise exception 'AUTO_FUEL_HAS_REINFORCEMENT' using errcode = '22023';
  end if;
  v_sar := private.auto_fuel_invoice_sar(p_identity_number, p_date);
  if v_sar <= 0 then
    raise exception 'AUTO_FUEL_NO_INVOICE' using errcode = '22023';
  end if;
  insert into public.automatic_fuel_unentitled (identity_number, fill_date, invoice_sar, reason, marked_by)
  values (p_identity_number, p_date, v_sar, v_reason, private.auto_fuel_actor());
  insert into public.automatic_fuel_amount_changes (kind, identity_number, allocation_date, old_amount, new_amount, reason, changed_by)
  values ('unentitled', p_identity_number, p_date, 0, v_sar, v_reason, private.auto_fuel_actor());
  return v_sar;
end;
$$;

create function public.auto_fuel_clear_unentitled(p_identity_number text, p_date date, p_reason text)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text;
  v_row public.automatic_fuel_unentitled;
begin
  perform private.auto_fuel_require_admin();
  v_reason := private.auto_fuel_require_reason(p_reason);
  select * into v_row from public.automatic_fuel_unentitled
  where identity_number = p_identity_number and fill_date = p_date and cleared_at is null for update;
  if not found then
    raise exception 'AUTO_FUEL_NOT_MARKED' using errcode = '22023';
  end if;
  update public.automatic_fuel_unentitled
     set cleared_at = now(), cleared_by = private.auto_fuel_actor(), clear_reason = v_reason
   where id = v_row.id;
  insert into public.automatic_fuel_amount_changes (kind, identity_number, allocation_date, old_amount, new_amount, reason, changed_by)
  values ('unentitled_clear', p_identity_number, p_date, v_row.invoice_sar, 0, v_reason, private.auto_fuel_actor());
  return v_row.invoice_sar;
end;
$$;

-- List B for a range of days (admin only).  One row per FDP driver-day with
-- PetroApp / Futurehub invoices, no active automatic fuel and no approved
-- reinforcement.  Status, checked in this order:
--   unentitled     already marked "Didn't work"                  (undo possible)
--   worked_marked  already marked "Worked, forgot the form"      (undo; listed even
--                  after its fuel is given, so the undo stays reachable)
--   voided_day     that day's automatic fuel was voided           (Restore, or "Didn't work")
--   fuel_coming    final code P and inside the next 06:30 run's window: nothing to do
--   nearby_auto    the day before or after has automatic fuel whose own invoices
--                  do not cover it (auto + reinforcement, 10% tolerance): probably an
--                  early or late fill for that day                (flag only)
--   unexplained    none of the above                              (action needed)
create function public.auto_fuel_unexplained_fills(p_from date, p_to date)
returns table (
  identity_number text,
  full_name text,
  vehicle_plate text,
  is_active boolean,
  fill_date date,
  attendance_code text,
  invoice_sar numeric,
  invoice_count integer,
  auto_prev numeric,
  auto_next numeric,
  status text,
  related_date date,
  voided_allocation_id uuid,
  voided_amount numeric,
  note text
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  perform private.auto_fuel_require_admin();
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'AUTO_FUEL_BAD_RANGE' using errcode = '22023';
  end if;

  return query
  with inv as (
    select btrim(f.nid) as idn, f.entry_date as d, sum(f.cost) as sar, count(*)::integer as n
    from public.fuel_invoice_records f
    where f.data_source in ('PetroApp', 'Futurehub')
      and f.entry_date between p_from - 1 and p_to + 1
    group by 1, 2
  ), marked as (
    select w.identity_number as idn, w.work_date as d from public.automatic_fuel_forgot_form w
    where w.undone_at is null and w.work_date between p_from and p_to
  ), fills as (
    -- an open fill, OR a day marked "Worked, forgot the form" (kept after its fuel
    -- is given, so the admin can still undo it)
    select k.idn, k.d, coalesce(i.sar, 0) as sar, coalesce(i.n, 0) as n,
           dr.full_name, dr.assigned_vehicle_plate, dr.is_active
    from (select inv.idn, inv.d from inv union select marked.idn, marked.d from marked) k
    join public.drivers dr on dr.identity_number = k.idn and dr.project = 'FDP'
    left join inv i on i.idn = k.idn and i.d = k.d
    where k.d between p_from and p_to
      and k.d < private.riyadh_today()
      and (exists (select 1 from marked m where m.idn = k.idn and m.d = k.d)
           or (coalesce(i.sar, 0) > 0
               and not exists (select 1 from public.automatic_fuel_allocations a
                               where a.identity_number = k.idn and a.allocation_date = k.d and a.voided_at is null)
               and private.auto_fuel_reinforcement_sar(k.idn, k.d) = 0))
  ), nb as (
    select f.*,
      (select a.amount from public.automatic_fuel_allocations a
        where a.identity_number = f.idn and a.allocation_date = f.d - 1 and a.voided_at is null) as a_prev,
      (select a.amount from public.automatic_fuel_allocations a
        where a.identity_number = f.idn and a.allocation_date = f.d + 1 and a.voided_at is null) as a_next,
      (select a.id from public.automatic_fuel_allocations a
        where a.identity_number = f.idn and a.allocation_date = f.d and a.voided_at is not null) as voided_id,
      (select a.amount from public.automatic_fuel_allocations a
        where a.identity_number = f.idn and a.allocation_date = f.d and a.voided_at is not null) as voided_amt,
      (select a.void_reason from public.automatic_fuel_allocations a
        where a.identity_number = f.idn and a.allocation_date = f.d and a.voided_at is not null) as void_reason,
      (select u.reason from public.automatic_fuel_unentitled u
        where u.identity_number = f.idn and u.fill_date = f.d and u.cleared_at is null) as unentitled_reason,
      (select w.reason from public.automatic_fuel_forgot_form w
        where w.identity_number = f.idn and w.work_date = f.d and w.undone_at is null) as worked_reason,
      private.auto_fuel_final_attendance(f.idn, f.d) as code
    from fills f
  ), judged as (
    select nb.*,
      -- a neighbour whose own invoices do not cover its automatic fuel + reinforcement
      case
        when nb.a_prev is not null
         and coalesce((select i.sar from inv i where i.idn = nb.idn and i.d = nb.d - 1), 0)
             < 0.9 * (nb.a_prev + private.auto_fuel_reinforcement_sar(nb.idn, nb.d - 1)) then nb.d - 1
        when nb.a_next is not null
         and coalesce((select i.sar from inv i where i.idn = nb.idn and i.d = nb.d + 1), 0)
             < 0.9 * (nb.a_next + private.auto_fuel_reinforcement_sar(nb.idn, nb.d + 1)) then nb.d + 1
      end as uncovered_neighbour
    from nb
  )
  select j.idn, j.full_name, j.assigned_vehicle_plate, j.is_active, j.d, j.code,
         round(j.sar, 2), j.n, coalesce(j.a_prev, 0), coalesce(j.a_next, 0),
         case
           when j.unentitled_reason is not null then 'unentitled'
           when j.worked_reason is not null then 'worked_marked'
           when j.voided_id is not null then 'voided_day'
           when j.code = 'P' and j.d >= private.riyadh_today() - 6 then 'fuel_coming'
           when j.uncovered_neighbour is not null then 'nearby_auto'
           else 'unexplained'
         end,
         j.uncovered_neighbour,
         j.voided_id,
         j.voided_amt,
         coalesce(j.unentitled_reason, j.worked_reason, j.void_reason)
  from judged j
  order by j.d desc, j.idn;
end;
$$;

-- The monthly reconciliation line (admin only), for FDP drivers' PetroApp /
-- Futurehub invoices in the range:
--   invoices_total = on_fuel_days (a day with active automatic fuel or approved
--                    reinforcement) + unentitled (marked "Didn't work")
--                    + unexplained (list B, not marked unentitled)
-- When unexplained is 0, every SAR withdrawn is explained.  Also returned:
-- the system's automatic fuel (active rows) and approved reinforcement for
-- comparison, and how many list B days are still open.
create function public.auto_fuel_reconciliation(p_from date, p_to date)
returns table (
  invoices_total numeric,
  on_fuel_days numeric,
  unentitled numeric,
  unexplained numeric,
  unexplained_days integer,
  automatic_fuel numeric,
  reinforcement numeric,
  voided_automatic_fuel numeric,
  last_invoice_date date
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform private.auto_fuel_require_admin();
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'AUTO_FUEL_BAD_RANGE' using errcode = '22023';
  end if;
  return query
  with inv as (
    select btrim(f.nid) as idn, f.entry_date as d, sum(f.cost) as sar
    from public.fuel_invoice_records f
    join public.drivers dr on dr.identity_number = btrim(f.nid) and dr.project = 'FDP'
    where f.data_source in ('PetroApp', 'Futurehub') and f.entry_date between p_from and p_to
    group by 1, 2
  ), k as (
    select i.sar,
      exists (select 1 from public.automatic_fuel_allocations a
              where a.identity_number = i.idn and a.allocation_date = i.d and a.voided_at is null)
      or private.auto_fuel_reinforcement_sar(i.idn, i.d) > 0 as covered,
      exists (select 1 from public.automatic_fuel_unentitled u
              where u.identity_number = i.idn and u.fill_date = i.d and u.cleared_at is null) as unent
    from inv i
  )
  select
    round(coalesce(sum(k.sar), 0), 2),
    round(coalesce(sum(k.sar) filter (where k.covered), 0), 2),
    round(coalesce(sum(k.sar) filter (where not k.covered and k.unent), 0), 2),
    round(coalesce(sum(k.sar) filter (where not k.covered and not k.unent), 0), 2),
    (count(*) filter (where not k.covered and not k.unent and k.sar > 0))::integer,
    (select round(coalesce(sum(a.amount), 0), 2) from public.automatic_fuel_allocations a
      where a.project = 'FDP' and a.voided_at is null and a.allocation_date between p_from and p_to),
    (select round(coalesce(sum(r.amount + coalesce(r.loan_adjustment, 0)), 0), 2)
       from public.reinforcement_requests r
       join public.drivers dr on dr.identity_number = r.identity_number and dr.project = 'FDP'
      where r.status = 'approved' and r.amount is not null and r.shift_date between p_from and p_to),
    (select round(coalesce(sum(a.amount), 0), 2) from public.automatic_fuel_allocations a
      where a.project = 'FDP' and a.voided_at is not null and a.allocation_date between p_from and p_to),
    (select max(f.entry_date) from public.fuel_invoice_records f where f.data_source in ('PetroApp', 'Futurehub'))
  from k;
end;
$$;


-- ---------------------------------------------------------------------
-- 6) Access: the admin check is inside each function
-- ---------------------------------------------------------------------

revoke all on function private.auto_fuel_require_reason(text), private.auto_fuel_invoice_sar(text, date),
  private.auto_fuel_reinforcement_sar(text, date) from public, anon, authenticated;
revoke all on function public.auto_fuel_mark_worked(text, date, text), public.auto_fuel_undo_worked(text, date, text),
  public.auto_fuel_mark_unentitled(text, date, text), public.auto_fuel_clear_unentitled(text, date, text),
  public.auto_fuel_unexplained_fills(date, date), public.auto_fuel_reconciliation(date, date) from public, anon;
grant execute on function public.auto_fuel_mark_worked(text, date, text), public.auto_fuel_undo_worked(text, date, text),
  public.auto_fuel_mark_unentitled(text, date, text), public.auto_fuel_clear_unentitled(text, date, text),
  public.auto_fuel_unexplained_fills(date, date), public.auto_fuel_reconciliation(date, date) to authenticated;
revoke all on function public.auto_fuel_void_allocations(uuid[], text), public.auto_fuel_restore_allocation(uuid, text),
  public.auto_fuel_invoice_review(date, date) from public, anon;
grant execute on function public.auto_fuel_void_allocations(uuid[], text), public.auto_fuel_restore_allocation(uuid, text),
  public.auto_fuel_invoice_review(date, date) to authenticated;
-- create or replace keeps 061's grants on auto_fuel_adjust_allocation; repeated to be sure.
revoke all on function public.auto_fuel_adjust_allocation(uuid, numeric, text) from public, anon;
grant execute on function public.auto_fuel_adjust_allocation(uuid, numeric, text) to authenticated;

commit;
