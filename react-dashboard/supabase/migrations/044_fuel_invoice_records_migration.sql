-- ============================================================
-- 044_fuel_invoice_records_migration.sql
-- New: public.fuel_invoice_records — backs the new, standalone
-- "Fuel & Invoice Management" module (Entries + Data Base pages).
-- Independent of every existing table; nothing here renames or
-- alters any prior table/column.
--
-- Single-select-looking fields (data_source, fuel_type, card_type,
-- status, use_type, branch) are plain `text` columns, NOT a fixed
-- check-constraint enum: the app grows each field's picklist from
-- whatever distinct values already exist in the table plus whatever
-- new value a user types in ("add new option"), since no company-
-- specific option list was provided — avoids inventing business
-- categories, per the explicit instruction not to guess these.
--
-- `nid` is `text` (not numeric) to preserve any leading zeros.
--
-- RLS mirrors the existing vehicles/drivers convention (010/014):
-- any authenticated user can read; only an admin account (no
-- `project` claim in the JWT) can insert/update/delete. Adjust later
-- if project-scoped managers should also be able to add entries.
-- ============================================================

create table if not exists public.fuel_invoice_records (
  id uuid primary key default gen_random_uuid(),
  data_source text,
  invoice_number text,
  internal_number text,
  fuel_type text,
  cost numeric,
  amount numeric,
  vat numeric,
  user_name text,
  entry_date date,
  card_type text,
  status text,
  use_type text,
  branch text,
  nid text,
  da_name text,
  deduction_code text,
  remarks text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text
);

alter table public.fuel_invoice_records enable row level security;

grant select, insert, update, delete on public.fuel_invoice_records to authenticated;

drop policy if exists "authenticated can view fuel_invoice_records" on public.fuel_invoice_records;
create policy "authenticated can view fuel_invoice_records"
on public.fuel_invoice_records for select
to authenticated
using (true);

drop policy if exists "admin can insert fuel_invoice_records" on public.fuel_invoice_records;
create policy "admin can insert fuel_invoice_records"
on public.fuel_invoice_records for insert
to authenticated
with check (coalesce(auth.jwt() -> 'user_metadata' ->> 'project', '') = '');

drop policy if exists "admin can update fuel_invoice_records" on public.fuel_invoice_records;
create policy "admin can update fuel_invoice_records"
on public.fuel_invoice_records for update
to authenticated
using (coalesce(auth.jwt() -> 'user_metadata' ->> 'project', '') = '')
with check (coalesce(auth.jwt() -> 'user_metadata' ->> 'project', '') = '');

drop policy if exists "admin can delete fuel_invoice_records" on public.fuel_invoice_records;
create policy "admin can delete fuel_invoice_records"
on public.fuel_invoice_records for delete
to authenticated
using (coalesce(auth.jwt() -> 'user_metadata' ->> 'project', '') = '');

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'fuel_invoice_records'
  ) then
    alter publication supabase_realtime add table public.fuel_invoice_records;
  end if;
end $$;

notify pgrst, 'reload schema';
