-- =====================================================================
-- READ ONLY - changes nothing.  Driver Performance investigation, point 3 (MGF).
-- Run in the Supabase SQL Editor.  One result table.
--
-- 039 fixed the MGF manager's tag in raw_user_meta_data ('SHC' -> 'MGF'), but the
-- site reads roles from raw_app_meta_data since 050.  If 050 copied the tag before
-- 039 ran, app_metadata still says 'SHC'.  This shows, for every account that has a
-- project tag, what each place holds, and whether any tag matches no driver at all.
-- =====================================================================
with tags as (
  select u.email,
         u.raw_user_meta_data ->> 'project' as user_meta_project,
         u.raw_app_meta_data  ->> 'project' as app_meta_project,
         u.raw_app_meta_data  ->> 'role'    as app_role
    from auth.users u
   where coalesce(u.raw_user_meta_data ->> 'project', u.raw_app_meta_data ->> 'project') is not null
),
driver_projects as (
  select project, count(*) as drivers, count(*) filter (where is_active) as active_drivers
    from public.drivers group by project
)
select t.email, t.app_role, t.user_meta_project, t.app_meta_project,
       coalesce(dp.drivers, 0)        as drivers_with_that_project,
       coalesce(dp.active_drivers, 0) as active_drivers_with_that_project,
       case when t.app_meta_project is distinct from t.user_meta_project then 'MISMATCH user_meta vs app_meta'
            when dp.project is null then 'NO DRIVER HAS THIS PROJECT'
            else 'ok' end as finding
  from tags t
  left join driver_projects dp on dp.project = t.app_meta_project
 order by t.app_meta_project nulls first, t.email;
