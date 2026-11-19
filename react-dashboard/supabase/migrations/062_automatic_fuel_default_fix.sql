begin;

-- =====================================================================
-- 062_automatic_fuel_default_fix.sql
-- Fix for 061: changing the default amount failed with
-- "UPDATE requires a WHERE clause".  Supabase rejects an UPDATE without
-- WHERE on API calls, and auto_fuel_set_default() updated the single
-- settings row without one.  Same function, with `where id` added.
-- Changes no data.  Safe to run again.
-- =====================================================================

do $$
begin
  if to_regprocedure('public.auto_fuel_set_default(numeric)') is null then
    raise exception 'STOP: run 061 first (public.auto_fuel_set_default does not exist).';
  end if;
end $$;

create or replace function public.auto_fuel_set_default(p_amount numeric)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare v_old numeric;
begin
  perform private.auto_fuel_require_admin();
  if p_amount is null or p_amount <= 0 then
    raise exception 'AUTO_FUEL_AMOUNT_MUST_BE_POSITIVE' using errcode = '22023';
  end if;
  select default_amount into v_old from public.automatic_fuel_settings for update;
  if v_old = p_amount then return p_amount; end if;
  update public.automatic_fuel_settings
     set default_amount = p_amount, updated_by = private.auto_fuel_actor(), updated_at = now()
   where id;  -- the single row; Supabase rejects an UPDATE without WHERE
  insert into public.automatic_fuel_amount_changes (kind, old_amount, new_amount, changed_by)
  values ('default', v_old, p_amount, private.auto_fuel_actor());
  return p_amount;
end;
$$;

-- create or replace keeps the existing grants (execute: authenticated only).

notify pgrst, 'reload schema';

commit;
