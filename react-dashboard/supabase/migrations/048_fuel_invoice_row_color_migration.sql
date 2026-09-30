-- ============================================================
-- 048_fuel_invoice_row_color_migration.sql
-- Manual row highlighting for the Fuel & Invoice Management grid (Entries /
-- Data Base) — she clicks a row number, picks a color from a small fixed
-- palette (matching the app's existing badge hues), and the whole row gets
-- a light tint. Stored per-record so it persists across reloads and is
-- visible to any admin who opens the grid, not just a local/per-browser
-- preference.
-- ============================================================

alter table public.fuel_invoice_records add column if not exists row_color text;

notify pgrst, 'reload schema';
