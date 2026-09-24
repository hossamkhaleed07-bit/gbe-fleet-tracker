-- ============================================================
-- Fix the SHC/MGF naming drift flagged in the migrations README:
-- the driver table has always used project = 'MGF' (#006), but the
-- 5th manager account was tagged 'SHC' instead of 'MGF' in #007.
-- This left that manager scoped to a project that no driver ever
-- has, so their dashboard would show no drivers/records at all.
-- ============================================================
update auth.users
set raw_user_meta_data = raw_user_meta_data || '{"project":"MGF"}'::jsonb
where email = 'shc.manager@gbe.sa';
