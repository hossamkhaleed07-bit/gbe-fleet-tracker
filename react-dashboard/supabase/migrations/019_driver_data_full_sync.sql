-- NOTE: statements that inserted/updated personal data were removed for privacy; structure kept.
-- ============================================================
-- 019_driver_data_full_sync.sql
-- Full re-sync of driver roster from "Data.xlsx" (Driver Data tab)
-- Adds pns_status + date_of_hiring columns, updates every field
-- for all 41 drivers to match the sheet exactly.
-- ============================================================

alter table public.drivers add column if not exists pns_status text;
alter table public.drivers add column if not exists date_of_hiring date;
alter table public.drivers add column if not exists job_id text;
alter table public.drivers add column if not exists vendor_name text;
alter table public.drivers add column if not exists city_name text;
alter table public.drivers add column if not exists employee_type text;
alter table public.drivers add column if not exists contract_type text;
alter table public.drivers add column if not exists vehicle_type text;
alter table public.drivers add column if not exists department text;
alter table public.drivers add column if not exists job_title text;
alter table public.drivers add column if not exists vehicle_plate text;
alter table public.drivers add column if not exists full_name text;
alter table public.drivers add column if not exists nationality text;
alter table public.drivers add column if not exists mobile_number text;
