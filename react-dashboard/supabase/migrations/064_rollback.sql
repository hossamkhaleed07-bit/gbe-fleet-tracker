begin;

-- =====================================================================
-- 064_rollback.sql   Removes what 064_automatic_fuel_void.sql added.
--
-- REFUSES while any day is voided: dropping the columns would silently put
-- that money back into every total.  Restore those days first (Automatic
-- Fuel page, or auto_fuel_restore_allocation) or decide what to do with them.
--
-- Also REFUSES while any fill is marked "Didn't work" (unentitled withdrawal,
-- still open): that follow-up list would be lost.  Clear them first.
-- "Worked, forgot the form" marks are dropped, but what they did stays: the
-- attendance P and any automatic fuel given (the change log keeps the history).
--
-- auto_fuel_adjust_allocation goes back to 061's version.  The change log
-- keeps its 'void' / 'restore' rows (it is append-only), so its kind check
-- keeps allowing those two kinds.
-- ONE transaction: if anything fails, nothing changes.
-- =====================================================================

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'automatic_fuel_allocations' and column_name = 'voided_at') then
    raise exception 'STOP: 064 is not installed (automatic_fuel_allocations.voided_at does not exist).';
  end if;
  if exists (select 1 from public.automatic_fuel_allocations where voided_at is not null) then
    raise exception 'STOP: % day(s) are voided. Restore them first; rolling back would count them again.',
      (select count(*) from public.automatic_fuel_allocations where voided_at is not null);
  end if;
  if exists (select 1 from public.automatic_fuel_unentitled where cleared_at is null) then
    raise exception 'STOP: % fill(s) are marked as unentitled withdrawals. Clear them first; the follow-up list would be lost.',
      (select count(*) from public.automatic_fuel_unentitled where cleared_at is null);
  end if;
end $$;

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
  if v_row.amount = p_amount then return p_amount; end if;
  update public.automatic_fuel_allocations
     set amount = p_amount, adjusted_at = now(), adjusted_by = private.auto_fuel_actor()
   where id = p_allocation_id;
  insert into public.automatic_fuel_amount_changes (kind, identity_number, allocation_id, allocation_date, old_amount, new_amount, reason, changed_by)
  values ('allocation', v_row.identity_number, v_row.id, v_row.allocation_date, v_row.amount, p_amount, btrim(p_reason), private.auto_fuel_actor());
  return p_amount;
end;
$$;

drop function public.auto_fuel_reconciliation(date, date);
drop function public.auto_fuel_unexplained_fills(date, date);
drop function public.auto_fuel_clear_unentitled(text, date, text);
drop function public.auto_fuel_mark_unentitled(text, date, text);
drop function public.auto_fuel_undo_worked(text, date, text);
drop function public.auto_fuel_mark_worked(text, date, text);
drop function private.auto_fuel_reinforcement_sar(text, date);
drop function private.auto_fuel_invoice_sar(text, date);
drop table public.automatic_fuel_unentitled;
drop table public.automatic_fuel_forgot_form;
drop function public.auto_fuel_invoice_review(date, date);
drop function public.auto_fuel_restore_allocation(uuid, text);
drop function public.auto_fuel_void_allocations(uuid[], text);
drop function private.auto_fuel_require_reason(text);

alter table public.automatic_fuel_allocations
  drop constraint automatic_fuel_allocations_void_check,
  drop column voided_at,
  drop column voided_by,
  drop column void_reason;

commit;
