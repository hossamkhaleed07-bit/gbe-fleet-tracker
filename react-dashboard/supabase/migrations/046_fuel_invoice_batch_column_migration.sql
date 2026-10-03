-- ============================================================
-- 046_fuel_invoice_batch_column_migration.sql
-- The real source sheet ("Fuels Master Sheet 2026.xlsx", "September" tab)
-- has an 18th column, "Batch", after Remarks — not part of the original
-- 17-field spec, discovered only once the real file was inspected. Adding
-- it now, before the real data import (047), so that migration doesn't
-- need to reference a nonexistent column.
-- ============================================================

alter table public.fuel_invoice_records add column if not exists batch text;

notify pgrst, 'reload schema';
