-- =====================================================================
-- 052_revoke_anon_drivers.sql
--
-- Closes the public read access to public.drivers (national IDs, phones, etc.).
--
-- RUN THIS ONLY AFTER BOTH OF THESE ARE TRUE:
--   1) 051_driver_name_lookup.sql has been run, and
--   2) the form that calls rpc/get_driver_name is live on
--      https://gbe-fleet-tracker.vercel.app/form/ and the name lookup works.
-- If the old form is still being served, its name lookup will stop working.
--
-- What keeps working (nothing below reads drivers as anon):
--   * the form's RPCs (submit_shift_entry, submit_reinforcement_request,
--     get_reinforcement_cooldown, shift_entry_exists) are SECURITY DEFINER, so
--     they run with the function owner's rights, not anon's;
--   * the dashboard reads drivers as "authenticated" (separate policies);
--   * RLS policies on other tables that look up drivers apply to authenticated.
--
-- Not covered here: the Edge Function upload-to-drive (its code is not in this
-- repo). If it queried drivers with the anon key it would stop working — it
-- almost certainly doesn't, but check its code once.
--
-- Note: migrations 004 and 005 contain the statements that created the anon
-- policy. Do NOT re-run them after this, or the table is exposed again.
-- =====================================================================


-- ---------------------------------------------------------------------
-- STEP 0 — pre-checks (read-only). Run these first and look at the results.
-- ---------------------------------------------------------------------

-- (a) Which policies exist on drivers, and for which roles?
--     Expect the anon one ("anon can view drivers") to be the only anon policy.
select policyname, roles, cmd
from pg_policies
where schemaname = 'public' and tablename = 'drivers'
order by policyname;

-- (b) Who has table privileges on drivers? (anon / PUBLIC should be the only
--     unwanted ones; authenticated must keep its own.)
select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'drivers'
order by grantee, privilege_type;

-- (c) Functions that anon can execute AND that mention "drivers".
--     Every row here must have prosecdef = true (SECURITY DEFINER). A row with
--     prosecdef = false would break after the revoke — stop and tell me.
select p.proname, p.prosecdef
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prokind = 'f'
  and pg_get_functiondef(p.oid) ilike '%drivers%'
  and has_function_privilege('anon', p.oid, 'execute')
order by p.proname;


-- ---------------------------------------------------------------------
-- STEP 1 — the change
-- ---------------------------------------------------------------------
begin;

drop policy if exists "anon can view drivers" on public.drivers;
revoke select on public.drivers from anon;

commit;

notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------
-- STEP 2 — verify (run each separately)
-- ---------------------------------------------------------------------
-- (a) Should now return NO anon policy and NO anon/PUBLIC grant:
--       select policyname, roles from pg_policies
--         where schemaname = 'public' and tablename = 'drivers';
--       select grantee, privilege_type from information_schema.role_table_grants
--         where table_schema = 'public' and table_name = 'drivers'
--           and grantee in ('anon', 'PUBLIC');
--
-- (b) Pretending to be anon must now fail with "permission denied":
--       begin;
--         set local role anon;
--         select count(*) from public.drivers;      -- expect: permission denied
--       rollback;
--
-- (c) The lookup function must still work for anon:
--       begin;
--         set local role anon;
--         select public.get_driver_name('0000000000');   -- expect: null, no error
--       rollback;


-- ---------------------------------------------------------------------
-- ROLLBACK (only if something unexpected breaks) — restores the old exposure:
-- ---------------------------------------------------------------------
-- create policy "anon can view drivers" on public.drivers for select to anon using (true);
-- grant select on public.drivers to anon;
-- notify pgrst, 'reload schema';
