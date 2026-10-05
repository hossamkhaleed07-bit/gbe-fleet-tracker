begin;

-- =====================================================================
-- 057  viewer: add Project Performance (Statistics + RCA / Driver Follow-up)
--
--  Project Statistics reads only what the viewer can already read
--  (shift_entries, drivers).  The RCA / Driver Follow-up page also shows the
--  reason and notes that were filed for each driver-day, so the viewer needs
--  READ access to ONE more table:
--
--      submission_reasons     (read only)
--
--  Writing stays blocked: 056 put a restrictive policy on every table with row
--  level security that refuses INSERT / UPDATE / DELETE for a viewer, and the
--  page itself only lets accounts with write access change a reason.
--
--  Still NOT readable by a viewer: fuel_invoice_records, fuel_invoice_da_directory,
--  admin_notifications.
--
--  ONE transaction.  Safe to run again.  Run after 057_verify_before.sql.
-- =====================================================================

-- Safety: 056 must have been run (this relies on its helper and its write block).
do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'private' and p.proname = 'is_viewer') then
    raise exception 'STOP: private.is_viewer() does not exist - run 056 first.';
  end if;
  if not exists (select 1 from pg_policies
                  where schemaname = 'public' and tablename = 'submission_reasons'
                    and policyname = 'viewer is read only (insert)') then
    raise exception 'STOP: the 056 write block is missing on submission_reasons.';
  end if;
end $$;

-- READ: the same policy as 053, plus "or private.is_viewer()".
drop policy if exists "scoped select submission_reasons" on public.submission_reasons;
create policy "scoped select submission_reasons" on public.submission_reasons
  for select to authenticated
  using (
    private.is_admin()
    or private.is_fleet_manager()
    or private.is_viewer()
    or (private.is_project_supervisor() and project = private.app_project())
  );

notify pgrst, 'reload schema';

commit;
