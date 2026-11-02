begin;

-- =====================================================================
-- 060_rollback.sql   Removes everything 060_wallet.sql created.
--
-- ONLY while the wallet holds no money movements and no account allocations.  Once
-- real movements exist this refuses: the ledger is the audit trail, and dropping it
-- would lose it.  In that case restore the backup taken before 060 instead.
--
-- fuel_invoice_records keeps every row and column; only the two wallet triggers on it
-- are removed.  ONE transaction: if anything fails, nothing changes.
-- =====================================================================

do $$
begin
  if to_regclass('public.wallet_transactions') is null then
    raise exception 'STOP: 060 is not installed (public.wallet_transactions does not exist).';
  end if;
  if exists (select 1 from public.wallet_transactions) then
    raise exception 'STOP: the wallet already has % money movements. Restore the backup taken before 060 instead.',
      (select count(*) from public.wallet_transactions);
  end if;
  if exists (select 1 from public.wallet_account_allocations) then
    raise exception 'STOP: the wallet already has account allocations. Restore the backup taken before 060 instead.';
  end if;
end $$;

drop trigger if exists wallet_invoice_guard on public.fuel_invoice_records;
drop trigger if exists wallet_invoice_post  on public.fuel_invoice_records;

-- Functions first: several take wallet row types, which would block DROP TABLE.  CASCADE
-- only reaches the wallet's own triggers and read policies (nothing else uses these).
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname in ('public', 'private') and p.proname like 'wallet!_%' escape '!' loop
    execute format('drop function if exists %s cascade', f.sig);
  end loop;
end $$;

-- Children first.  DROP TABLE does not fire the append-only triggers.
drop table public.wallet_postings;
drop table public.wallet_transactions;
drop table public.wallet_account_allocations;
drop table public.wallet_invoice_rules;
drop table public.wallet_accounts;
drop table public.wallet_categories;
drop table public.wallet_periods;
drop table public.wallet_settings;

notify pgrst, 'reload schema';

commit;
