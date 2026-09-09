-- ============================================================
-- 027_driver_petroapp_link_migration.sql
-- Per-driver PetroApp link, managed from the Drivers page and
-- shown as a quick-open link on the Fuel Approver detail panel.
-- ============================================================

alter table public.drivers add column if not exists petro_app_link text;
