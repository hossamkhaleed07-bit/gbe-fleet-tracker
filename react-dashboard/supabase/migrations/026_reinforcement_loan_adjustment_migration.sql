-- ============================================================
-- 026_reinforcement_loan_adjustment_migration.sql
-- Lets the fuel approver adjust the amount the driver requested
-- (e.g. reduce it) before approving/rejecting a reinforcement
-- request, without altering the original requested amount.
-- ============================================================

alter table public.reinforcement_requests add column if not exists loan_adjustment numeric;
