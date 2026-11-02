-- =====================================================================
-- 060_verify_after.sql   Run right AFTER 060_wallet.sql.  Leaves nothing behind.
--
-- One result table: every row must show ok = true.
--   * the objects 060 creates are all there, nothing else changed in the invoices;
--   * a DRY RUN on a test month (2099-01) as a pretend main admin: budget, allocation,
--     account, top-up, refused top-up, reallocation, reconciliation.  It runs inside a
--     block that is rolled back, so no row of it stays in the database.
-- Compare invoices_count / invoices_total_cost with what 060_verify_before printed.
-- =====================================================================
drop table if exists pg_temp.wallet_verify;
create temp table wallet_verify (check_name text, value text, ok boolean);

do $$
declare
  v_undistributed numeric; v_refused text := 'not refused'; v_recon_ok boolean; v_recon_rows int;
  v_realloc numeric; v_dry_error text;
begin
  -- the dry run: everything inside this block is undone by the exception at its end
  begin
    perform set_config('request.jwt.claims',
      '{"sub":"00000000-0000-0000-0000-000000000060","email":"dry-run@060","app_metadata":{"role":"admin"}}', true);
    perform public.wallet_set_company_budget(date '2099-01-01', 100000, 'dry run');
    perform public.wallet_allocate_category(date '2099-01-01', 'projects', 65000);
    perform public.wallet_allocate_category(date '2099-01-01', 'supervisors', 25000);
    insert into public.wallet_accounts (category_id, code, name)
      select id, 'DRY-RUN-060', 'dry run' from public.wallet_categories where code = 'projects';
    perform public.wallet_top_up(date '2099-01-01', 'DRY-RUN-060', 15000, 'dry run');
    begin
      perform public.wallet_top_up(date '2099-01-01', 'DRY-RUN-060', 60000, 'dry run');
    exception when others then
      v_refused := sqlerrm;
    end;
    perform public.wallet_reallocate(date '2099-01-01', 'supervisors', 'projects', 5000, 'dry run');
    select undistributed into v_undistributed from public.wallet_category_summary(date '2099-01-01') where code = 'projects';
    select bool_and(ok), count(*) into v_recon_ok, v_recon_rows from public.wallet_reconciliation(date '2099-01-01');
    v_realloc := v_undistributed;
    raise exception 'DRY_RUN_DONE';
  exception when others then
    if sqlerrm <> 'DRY_RUN_DONE' then
      v_dry_error := sqlerrm;
    end if;
  end;

  insert into wallet_verify values
    ('dry run finished without error', coalesce(v_dry_error, 'yes'), v_dry_error is null),
    ('dry run: projects undistributed 65000 - 15000 + 5000 = 55000', coalesce(v_realloc::text, '-'), v_realloc = 55000),
    ('dry run: top-up above undistributed refused', v_refused, v_refused like 'WALLET_TOPUP_EXCEEDS_UNDISTRIBUTED%'),
    ('dry run: reconciliation all ok', coalesce(v_recon_ok::text, '-') || ' (' || coalesce(v_recon_rows, 0) || ' checks)', coalesce(v_recon_ok, false)),
    ('dry run left nothing behind',
       (select count(*) from public.wallet_periods where month = date '2099-01-01')::text
         || ' period rows / ' || (select count(*) from public.wallet_accounts where code = 'DRY-RUN-060')::text || ' accounts',
       not exists (select 1 from public.wallet_periods where month = date '2099-01-01')
         and not exists (select 1 from public.wallet_accounts where code = 'DRY-RUN-060'));
end $$;

with inv as (
  select count(*) as n, coalesce(sum(cost), 0) as total_cost from public.fuel_invoice_records
)
select * from wallet_verify
union all
select 'wallet tables (8)',
       (select count(*) from pg_tables where schemaname = 'public' and tablename like 'wallet!_%' escape '!')::text,
       (select count(*) from pg_tables where schemaname = 'public' and tablename like 'wallet!_%' escape '!') = 8
union all
select 'row level security on every wallet table',
       (select count(*) from pg_tables where schemaname = 'public' and tablename like 'wallet!_%' escape '!' and rowsecurity)::text,
       not exists (select 1 from pg_tables where schemaname = 'public' and tablename like 'wallet!_%' escape '!' and not rowsecurity)
union all
select 'categories', (select string_agg(code, ', ' order by sort) from public.wallet_categories),
       (select string_agg(code, ', ' order by sort) from public.wallet_categories) = 'management, projects, supervisors'
union all
select 'wallet start month', (select start_month::text from public.wallet_settings),
       (select start_month from public.wallet_settings) = date '2026-11-01'
union all
select 'ledger is empty', (select count(*) from public.wallet_transactions)::text,
       not exists (select 1 from public.wallet_transactions)
union all
select 'unique: one expense / one reversal per invoice',
       (select string_agg(indexname, ', ' order by indexname) from pg_indexes
         where tablename = 'wallet_transactions' and indexname in ('wallet_one_expense_per_invoice', 'wallet_one_reversal_per_invoice', 'wallet_one_reversal_per_expense')),
       (select count(*) from pg_indexes
         where tablename = 'wallet_transactions' and indexname in ('wallet_one_expense_per_invoice', 'wallet_one_reversal_per_invoice', 'wallet_one_reversal_per_expense')) = 3
union all
select 'new triggers on fuel_invoice_records',
       (select string_agg(tgname, ', ' order by tgname) from pg_trigger
         where tgrelid = 'public.fuel_invoice_records'::regclass and tgname like 'wallet!_%' escape '!'),
       (select count(*) from pg_trigger
         where tgrelid = 'public.fuel_invoice_records'::regclass and tgname in ('wallet_invoice_guard', 'wallet_invoice_post')) = 2
union all
select 'existing invoice triggers still enabled',
       coalesce((select string_agg(tgname || '=' || tgenabled::text, ', ' order by tgname) from pg_trigger
                  where tgrelid = 'public.fuel_invoice_records'::regclass and not tgisinternal and tgname not like 'wallet!_%' escape '!'), '(none)'),
       not exists (select 1 from pg_trigger
                    where tgrelid = 'public.fuel_invoice_records'::regclass and not tgisinternal and tgenabled = 'D')
union all
select 'invoices_count (same as before)', (select n from inv)::text, true
union all
select 'invoices_total_cost (same as before)', (select total_cost from inv)::text, true
union all
select 'no invoice posted yet (no accounts or rules)',
       (select count(*) from public.wallet_transactions where tx_type = 'expense')::text,
       not exists (select 1 from public.wallet_transactions where tx_type = 'expense');
