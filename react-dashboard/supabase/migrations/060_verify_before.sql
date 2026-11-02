-- =====================================================================
-- 060_verify_before.sql   READ ONLY - changes nothing.
-- Run in the Supabase SQL Editor BEFORE 060_wallet.sql.  One result table:
-- every row must show ok = true.  Write down the "invoices_*" values: 060_verify_after
-- prints the same numbers, and they must match.
-- =====================================================================
with inv as (
  select count(*) as n, coalesce(sum(cost), 0) as total_cost,
         count(*) filter (where entry_date >= date '2026-11-01') as from_nov
    from public.fuel_invoice_records
)
select 'postgres_version' as check_name, current_setting('server_version') as value, true as ok
union all
select 'private.is_admin exists (053)',
       exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'private' and p.proname = 'is_admin')::text,
       exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'private' and p.proname = 'is_admin')
union all
select 'private.is_fleet_manager exists (053)',
       exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'private' and p.proname = 'is_fleet_manager')::text,
       exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'private' and p.proname = 'is_fleet_manager')
union all
select 'private.is_viewer exists (056, optional)',
       exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'private' and p.proname = 'is_viewer')::text,
       true
union all
select 'wallet not installed yet', (to_regclass('public.wallet_transactions') is null)::text,
       to_regclass('public.wallet_transactions') is null
union all
select 'no wallet_* functions yet',
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname in ('public', 'private') and p.proname like 'wallet!_%' escape '!')::text,
       not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname in ('public', 'private') and p.proname like 'wallet!_%' escape '!')
union all
select 'invoices_count', (select n from inv)::text, true
union all
select 'invoices_total_cost', (select total_cost from inv)::text, true
union all
select 'invoices_from_2026_11', (select from_nov from inv)::text, true
union all
select 'triggers on fuel_invoice_records',
       coalesce((select string_agg(tgname, ', ' order by tgname) from pg_trigger
                  where tgrelid = 'public.fuel_invoice_records'::regclass and not tgisinternal), '(none)'),
       true;
