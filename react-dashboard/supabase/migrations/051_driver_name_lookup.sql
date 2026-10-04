-- =====================================================================
-- 051_driver_name_lookup.sql
--
-- The public driver form needs ONE thing from the drivers table: the driver's
-- name for an identity number it has just typed. Until now it read the table
-- directly through the "anon can view drivers" policy, which exposes every
-- column of every driver to anyone holding the public anon key.
--
-- This adds a narrow function instead: it returns full_name for an EXACT
-- identity_number match, or null. Nothing else about drivers is exposed.
--
-- This file does NOT lock the table. Locking happens in 052, which must only be
-- run after the form that calls this function is live.
--
-- Safe to run more than once.
-- =====================================================================

create or replace function public.get_driver_name(p_identity_number text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select d.full_name
  from public.drivers d
  where d.identity_number = p_identity_number
  limit 1
$$;

-- Functions are executable by PUBLIC by default; make the grants explicit.
revoke all on function public.get_driver_name(text) from public;
grant execute on function public.get_driver_name(text) to anon, authenticated;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- Quick check after running (optional, read-only):
--   select public.get_driver_name('0000000000');   -- expect: null (no such driver)
-- ---------------------------------------------------------------------
