-- =====================================================================
-- 050_move_roles_to_app_metadata.sql
--
-- الهدف: سد ثغرة رفع الصلاحيات.
-- الصلاحيات حالياً مبنية على user_metadata، والمستخدم يقدر يعدّلها بنفسه.
-- هننقلها لـ app_metadata، ودي ماحدش يقدر يعدّلها غير من السيرفر أو SQL Editor.
--
-- مهم: الملف ده بيحافظ على نفس الصلاحيات الحالية بالظبط، وبيسد الثغرة بس.
--       (fleet_manager بياخد نفس صلاحياته الحالية، وتقليلها خطوة لاحقة)
--
-- طريقة التشغيل: شغّل كل جزء لوحده بالترتيب في SQL Editor.
-- قبل أي حاجة: خد نسخة احتياطية.
-- =====================================================================


-- =====================================================================
-- الجزء 0: معاينة (مابيغيّرش أي حاجة)
-- راجع عمود new_role كويس.
-- أي حساب مش عارفه ومكتوب له admin: وقّف هنا وماتكملش.
-- =====================================================================
select email,
       raw_user_meta_data ->> 'project' as old_project,
       raw_user_meta_data ->> 'role'    as old_role,
       case
         when raw_user_meta_data ->> 'role' = 'fleet_manager' then 'fleet_manager'
         when coalesce(raw_user_meta_data ->> 'project', '') <> '' then 'project_supervisor'
         else 'admin'
       end as new_role,
       created_at,
       last_sign_in_at
from auth.users
order by created_at;


-- =====================================================================
-- الجزء 1: نسخ الصلاحيات لـ app_metadata
-- آمن: مفيش حاجة بتقرا app_metadata لسه، فالموقع مش هيتأثر.
-- =====================================================================
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
  || jsonb_build_object(
       'role', case
         when raw_user_meta_data ->> 'role' = 'fleet_manager' then 'fleet_manager'
         when coalesce(raw_user_meta_data ->> 'project', '') <> '' then 'project_supervisor'
         else 'admin'
       end,
       'project', nullif(raw_user_meta_data ->> 'project', '')
     );


-- =====================================================================
-- الجزء 2: دوال مساعدة
-- موجودة في schema اسمها private، فمش ظاهرة كـ API للعامة.
-- آمن: مجرد إضافة، مش بتغيّر أي سلوك.
-- =====================================================================
create schema if not exists private;
grant usage on schema private to anon, authenticated;

-- الدور: admin / project_supervisor / fleet_manager (أو فاضي)
create or replace function private.app_role() returns text
language sql stable
as $$
  select coalesce((select auth.jwt()) -> 'app_metadata' ->> 'role', '')
$$;

-- مشروع المستخدم (null لو مالوش)
create or replace function private.app_project() returns text
language sql stable
as $$
  select nullif((select auth.jwt()) -> 'app_metadata' ->> 'project', '')
$$;

-- بديل الشرط القديم "مالوش project"
-- الشرط القديم كان بيشمل admin و fleet_manager مع بعض، فبنحافظ على ده.
-- الفرق: أي حساب ناقص البيانات بقى ممنوع، بدل ما ياخد كل الصلاحيات.
create or replace function private.has_full_access() returns boolean
language sql stable
as $$
  select private.app_role() in ('admin', 'fleet_manager')
$$;

grant execute on function private.app_role()        to anon, authenticated;
grant execute on function private.app_project()     to anon, authenticated;
grant execute on function private.has_full_access() to anon, authenticated;


-- =====================================================================
-- الجزء 3: إعادة كتابة السياسات
-- شغّله بعد ما تنشر تعديل AuthContext.
-- بعده لازم كل المستخدمين يعملوا تسجيل خروج ودخول.
-- كله في transaction: لو حصل أي خطأ، مفيش حاجة هتتغيّر.
-- =====================================================================
begin;

-- ---------- vehicles ----------
-- ("anon can view vehicles" و "authenticated can view vehicles" زي ما هم)
drop policy if exists "admin can insert vehicles" on public.vehicles;
create policy "admin can insert vehicles" on public.vehicles
  for insert to authenticated
  with check (private.has_full_access());

drop policy if exists "admin can update vehicles" on public.vehicles;
create policy "admin can update vehicles" on public.vehicles
  for update to authenticated
  using (private.has_full_access())
  with check (private.has_full_access());

-- ---------- drivers ----------
-- ("anon can view drivers" زي ما هي مؤقتاً، والفورم محتاجها؛ هتتقفل في خطوة لاحقة)
drop policy if exists "scoped view drivers" on public.drivers;
create policy "scoped view drivers" on public.drivers
  for select to authenticated
  using (private.has_full_access() or project = private.app_project());

drop policy if exists "admin can insert drivers" on public.drivers;
create policy "admin can insert drivers" on public.drivers
  for insert to authenticated
  with check (private.has_full_access());

drop policy if exists "admin can update drivers" on public.drivers;
create policy "admin can update drivers" on public.drivers
  for update to authenticated
  using (private.has_full_access())
  with check (private.has_full_access());

drop policy if exists "admin can delete drivers" on public.drivers;
create policy "admin can delete drivers" on public.drivers
  for delete to authenticated
  using (private.has_full_access());

-- ---------- automatic_fuel_allocations ----------
drop policy if exists "scoped select automatic_fuel_allocations" on public.automatic_fuel_allocations;
create policy "scoped select automatic_fuel_allocations" on public.automatic_fuel_allocations
  for select to authenticated
  using (private.has_full_access() or project = private.app_project());

-- ---------- shift_entries ----------
drop policy if exists "scoped view shift_entries" on public.shift_entries;
create policy "scoped view shift_entries" on public.shift_entries
  for select to authenticated
  using (
    private.app_role() <> 'fleet_manager'
    and (
      private.has_full_access()
      or exists (
        select 1 from public.drivers d
        where d.identity_number = shift_entries.identity_number
          and d.project = private.app_project()
      )
    )
  );

drop policy if exists "scoped update shift_entries" on public.shift_entries;
create policy "scoped update shift_entries" on public.shift_entries
  for update to authenticated
  using (
    private.has_full_access()
    or exists (
      select 1 from public.drivers d
      where d.identity_number = shift_entries.identity_number
        and d.project = private.app_project()
    )
  )
  with check (
    private.has_full_access()
    or exists (
      select 1 from public.drivers d
      where d.identity_number = shift_entries.identity_number
        and d.project = private.app_project()
    )
  );

drop policy if exists "scoped delete shift_entries" on public.shift_entries;
create policy "scoped delete shift_entries" on public.shift_entries
  for delete to authenticated
  using (
    private.has_full_access()
    or exists (
      select 1 from public.drivers d
      where d.identity_number = shift_entries.identity_number
        and d.project = private.app_project()
    )
  );

drop policy if exists "scoped insert shift_entries" on public.shift_entries;
create policy "scoped insert shift_entries" on public.shift_entries
  for insert to authenticated
  with check (
    private.has_full_access()
    or exists (
      select 1 from public.drivers d
      where d.identity_number = shift_entries.identity_number
        and d.project = private.app_project()
    )
  );

-- ---------- fuel_invoice_records ----------
-- ("authenticated can view fuel_invoice_records" زي ما هي)
drop policy if exists "admin can insert fuel_invoice_records" on public.fuel_invoice_records;
create policy "admin can insert fuel_invoice_records" on public.fuel_invoice_records
  for insert to authenticated
  with check (private.has_full_access());

drop policy if exists "admin can update fuel_invoice_records" on public.fuel_invoice_records;
create policy "admin can update fuel_invoice_records" on public.fuel_invoice_records
  for update to authenticated
  using (private.has_full_access())
  with check (private.has_full_access());

drop policy if exists "admin can delete fuel_invoice_records" on public.fuel_invoice_records;
create policy "admin can delete fuel_invoice_records" on public.fuel_invoice_records
  for delete to authenticated
  using (private.has_full_access());

-- ---------- reinforcement_requests ----------
drop policy if exists "scoped view reinforcement_requests" on public.reinforcement_requests;
create policy "scoped view reinforcement_requests" on public.reinforcement_requests
  for select to authenticated
  using (
    private.has_full_access()
    or exists (
      select 1 from public.drivers d
      where d.identity_number = reinforcement_requests.identity_number
        and d.project = private.app_project()
    )
  );

drop policy if exists "admin can update reinforcement_requests" on public.reinforcement_requests;
create policy "admin can update reinforcement_requests" on public.reinforcement_requests
  for update to authenticated
  using (private.has_full_access())
  with check (private.has_full_access());

-- ---------- driver_attendance ----------
drop policy if exists "scoped select driver_attendance" on public.driver_attendance;
create policy "scoped select driver_attendance" on public.driver_attendance
  for select to authenticated
  using (private.has_full_access() or project = private.app_project());

drop policy if exists "scoped insert driver_attendance" on public.driver_attendance;
create policy "scoped insert driver_attendance" on public.driver_attendance
  for insert to authenticated
  with check (
    private.has_full_access()
    or exists (
      select 1 from public.drivers d
      where d.identity_number = driver_attendance.identity_number
        and d.project = private.app_project()
    )
  );

drop policy if exists "scoped update driver_attendance" on public.driver_attendance;
create policy "scoped update driver_attendance" on public.driver_attendance
  for update to authenticated
  using (
    private.has_full_access()
    or exists (
      select 1 from public.drivers d
      where d.identity_number = driver_attendance.identity_number
        and d.project = private.app_project()
    )
  )
  with check (
    private.has_full_access()
    or exists (
      select 1 from public.drivers d
      where d.identity_number = driver_attendance.identity_number
        and d.project = private.app_project()
    )
  );

drop policy if exists "admin delete driver_attendance" on public.driver_attendance;
create policy "admin delete driver_attendance" on public.driver_attendance
  for delete to authenticated
  using (private.has_full_access());

-- ---------- submission_reasons ----------
drop policy if exists "scoped select submission_reasons" on public.submission_reasons;
create policy "scoped select submission_reasons" on public.submission_reasons
  for select to authenticated
  using (private.has_full_access() or project = private.app_project());

drop policy if exists "scoped insert submission_reasons" on public.submission_reasons;
create policy "scoped insert submission_reasons" on public.submission_reasons
  for insert to authenticated
  with check (
    private.has_full_access()
    or exists (
      select 1 from public.drivers d
      where d.identity_number = submission_reasons.identity_number
        and d.project = private.app_project()
    )
  );

drop policy if exists "scoped update submission_reasons" on public.submission_reasons;
create policy "scoped update submission_reasons" on public.submission_reasons
  for update to authenticated
  using (
    private.has_full_access()
    or exists (
      select 1 from public.drivers d
      where d.identity_number = submission_reasons.identity_number
        and d.project = private.app_project()
    )
  )
  with check (
    private.has_full_access()
    or exists (
      select 1 from public.drivers d
      where d.identity_number = submission_reasons.identity_number
        and d.project = private.app_project()
    )
  );

commit;


-- =====================================================================
-- الجزء 4: تأكيد
-- الاستعلامين دول لازم يرجعوا صفر صفوف.
-- =====================================================================

-- أي سياسة لسه بتعتمد على user_metadata
select tablename, policyname
from pg_policies
where schemaname = 'public'
  and (coalesce(qual, '') ilike '%user_metadata%'
       or coalesce(with_check, '') ilike '%user_metadata%');

-- أي function في قاعدة البيانات لسه بتعتمد على user_metadata
select n.nspname as schema, p.proname as function_name
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'private')
  and p.prosrc ilike '%user_metadata%';


-- =====================================================================
-- مرجع: إضافة مستخدم جديد بعد كده
-- 1) اعمل الحساب من Authentication > Users > Add user
-- 2) حدّد صلاحيته (غيّر الإيميل والقيم):
-- =====================================================================
-- مشرف مشروع:
-- update auth.users
-- set raw_app_meta_data = raw_app_meta_data
--   || '{"role":"project_supervisor","project":"اسم المشروع"}'::jsonb
-- where email = 'name@example.com';
--
-- أدمن:
-- update auth.users
-- set raw_app_meta_data = raw_app_meta_data || '{"role":"admin"}'::jsonb
-- where email = 'name@example.com';
