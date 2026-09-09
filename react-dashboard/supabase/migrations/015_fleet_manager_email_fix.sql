update auth.users set raw_user_meta_data = raw_user_meta_data || '{"role":"fleet_manager"}'::jsonb where email = 'fleet@gbe.sa.com';

select email, raw_user_meta_data from auth.users where email = 'fleet@gbe.sa.com';
