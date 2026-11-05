# تشغيل 061: مبالغ Automatic Fuel لكل مندوب

الـmigration دي بتعمل الآتي:
- بتضيف 3 جداول جديدة: المبلغ الافتراضي، ومبلغ خاص لكل مندوب، وسجل التعديلات.
- بتغيّر `allocate_daily_automatic_fuel()` عشان تاخد مبلغ المندوب، ولو ملوش تاخد المبلغ الافتراضي.
- بتضيف عمودين لجدول `automatic_fuel_allocations`: `adjusted_at` و `adjusted_by`.

مش هتغيّر أي تخصيص اتعمل قبل كده. والمبلغ الافتراضي هيبدأ بـ 20، فالتخصيص اليومي هيفضل زي ما هو لحد ما حد يعدّل من الصفحة.

> **وقت التشغيل:** شغّلها بعيد عن الساعة 12 الضهر بتوقيت السعودية، لأن ده وقت الـcron بتاع التخصيص اليومي.

## الخطوة 1: backup
اعمل نفس الخطوة 1 في [060_RUNBOOK.md](060_RUNBOOK.md) بالظبط (1-أ و 1-ب)، مع تغيير أسماء الملفات بس:
- `gbe_before_060.dump` تبقى `gbe_before_061.dump`
- `gbe_before_060_public_data.sql` تبقى `gbe_before_061_public_data.sql`

وفي التأكد من الـbackup (البند 5)، دوّر على الجدول ده:
```bash
pg_restore --list gbe_before_061.dump | Select-String "TABLE DATA public automatic_fuel_allocations"
```
لازم يطبع سطر واحد. لو مطبعش، **وقّف هنا**.

## الخطوة 2: قبل التشغيل (قراءة بس)
شغّل الـquery ده في Supabase SQL Editor واحفظ النتيجة:
```sql
select count(*) as allocations, sum(amount) as total, max(allocation_date) as last_day
from public.automatic_fuel_allocations;
```

## الخطوة 3: التشغيل
1. افتح `061_automatic_fuel_amounts.sql`، وانسخه كله في SQL Editor، واضغط Run.
2. لازم يخلص من غير errors. الملف كله transaction واحدة، فلو حصل أي error مش هيتغيّر حاجة.
3. لو ظهرت رسالة `STOP: 061 is already installed`، يبقى الـmigration اتشغّلت قبل كده. ما تعملش حاجة.

## الخطوة 4: التحقق (قراءة بس)
```sql
-- 1) المبلغ الافتراضي = 20
select default_amount from public.automatic_fuel_settings;

-- 2) التخصيصات القديمة ما اتغيّرتش: نفس أرقام الخطوة 2
select count(*) as allocations, sum(amount) as total, max(allocation_date) as last_day
from public.automatic_fuel_allocations;

-- 3) الـfunction الجديدة بتاخد المبلغ من الإعدادات
select position('automatic_fuel_settings' in pg_get_functiondef('public.allocate_daily_automatic_fuel(date)'::regprocedure)) > 0 as uses_settings;

-- 4) الـcron لسه موجود وشغّال
select jobname, schedule, active from cron.job where jobname = 'daily-fdp-automatic-fuel';
```
المفروض تطلع:
1. `20`
2. نفس أرقام الخطوة 2
3. `true`
4. صف واحد، والـschedule بتاعه `0 9 * * *`، و`active = true`

بعد التخصيص الجاي (12 الضهر بتوقيت السعودية)، اتأكد إن كل مندوب أخد المبلغ الصح:
```sql
select a.identity_number, a.full_name, a.amount,
       coalesce(da.amount, s.default_amount) as expected
from public.automatic_fuel_allocations a
left join public.automatic_fuel_driver_amounts da using (identity_number)
cross join public.automatic_fuel_settings s
where a.allocation_date = (now() at time zone 'Asia/Riyadh')::date
  and a.amount <> coalesce(da.amount, s.default_amount);
```
المفروض ما يطلعش أي صف. الاستثناء الوحيد هو أي تخصيص اتعدّل يدوي من الصفحة.

## لو حاجة غلط: الرجوع
1. لو عايز تحتفظ بسجل التعديلات، صدّره الأول:
   ```sql
   select * from public.automatic_fuel_amount_changes order by changed_at;
   ```
2. شغّل `061_rollback.sql`. ده بيرجّع `allocate_daily_automatic_fuel()` لمبلغ 20 الثابت، ويمسح الجداول الجديدة.
3. التخصيصات اللي اتعملت هتفضل بمبالغها، حتى اللي اتعدّل منها يدوي.
4. لو حصل أكتر من كده، رجّع الـbackup اللي عملته في الخطوة 1.

## ملاحظة على ترتيب النشر
الصفحة بتشتغل قبل الـmigration وبعدها. لو اتنشرت قبل ما تشغّل الـmigration:
- تاب "التخصيصات" هيشتغل عادي، والأعمدة الفاضية هتتصلّح.
- تاب "المبالغ" هيعرض "تعذّر تحميل المبالغ" لحد ما تشغّل الـmigration.
