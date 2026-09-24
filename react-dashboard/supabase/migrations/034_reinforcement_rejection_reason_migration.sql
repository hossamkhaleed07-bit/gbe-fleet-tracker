-- ============================================================
-- 034_reinforcement_rejection_reason_migration.sql
-- Adds an optional rejection_reason so an admin rejecting a fuel
-- reinforcement request can record why (surfaced in the new
-- reject-reason confirmation modal in the dashboard).
-- ============================================================

alter table public.reinforcement_requests add column if not exists rejection_reason text;
