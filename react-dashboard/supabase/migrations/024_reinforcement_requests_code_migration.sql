-- ============================================================
-- 024_reinforcement_requests_code_migration.sql
-- Adds a stable, human-readable sequential code to each
-- reinforcement request (e.g. GBE-FR-000001), used as the
-- "تكويد" shown on the request box in the Fuel Approver UI.
-- ============================================================

alter table public.reinforcement_requests add column if not exists request_no bigserial;
