# تشغيل migration 060 (المحفظة) على Supabase

الملفات بالترتيب:

| # | الملف | بيعمل إيه |
|---|---|---|
| 1 | — | backup كامل للـ database (الخطوة 1 تحت) |
| 2 | `060_verify_before.sql` | فحص قبل التشغيل. قراءة بس، ما بيغيّرش حاجة |
| 3 | `060_wallet.sql` | الـ migration نفسها، في transaction واحدة |
| 4 | `060_verify_after.sql` | فحص بعد التشغيل، ومعاه تجربة كاملة على شهر وهمي (2099-01) بتترجع ومش بتسيب أي أثر |
| — | `060_rollback.sql` | للطوارئ بس: بيشيل كل حاجة الـ 060 عملتها، وده ينفع **بس لو المحفظة لسه مفيهاش أي حركة** |

الترتيب ده نفسه متجرّب في `supabase/tests/wallet-scripts.test.js`، بالإضافة لـ 17 test للقواعد في `wallet.test.js`. شغّلهم بـ `npm test`.

---

## قبل ما تبدأ

- اختار وقت مفيش فيه حد بيدخّل فواتير.
- الخطوات كلها هتاخد حوالي 15 دقيقة، أغلبها في الـ backup.
- مش محتاج تعمل deploy للكود. الـ migration ما بتغيّرش أي حاجة ظاهرة في الصفحات الحالية (التفاصيل في الخطوة 6).

---

## الخطوة 1: backup كامل

### 1-أ: الـ backup التلقائي بتاع Supabase

Dashboard ← **Database** ← **Backups**.

- لو الـ plan بتاعك **Pro أو أعلى**: هتلاقي backup يومي. اكتب تاريخ ووقت آخر واحد. ده خط الأمان الأول، بس ما تعتمدش عليه لوحده، وكمّل 1-ب.
- لو الـ plan **Free**: مفيش backups تلقائية تقدر تنزّلها، وعشان كده 1-ب **إجبارية**.

### 1-ب: نسخة كاملة على جهازك بـ `pg_dump`

**1. تثبيت أدوات PostgreSQL** (مرة واحدة بس). محتاج نسخة 17، لأنها تقدر تعمل dump من 15 ومن 17:
- الأسهل: نزّل installer الـ EDB من https://www.postgresql.org/download/windows/ ، وفي شاشة الـ components اختار **Command Line Tools** بس.
- أو بالـ winget. ده هيسطّب الـ server كمان، بس مش هتستخدمه:
  ```bash
  winget install --id PostgreSQL.PostgreSQL.17
  ```
- اقفل الـ terminal وافتحه تاني، وبعدين اتأكد إن الأداة اتسطّبت:
  ```bash
  pg_dump --version
  ```
  لو الأمر مش معروف، ضيف `C:\Program Files\PostgreSQL\17\bin` للـ PATH.

**2. رابط الاتصال:** في الـ Dashboard، اضغط **Connect** فوق، واختار **Session pooler**، وانسخ الـ URI.
- استخدم الـ Session pooler بالذات (port 5432). الـ Direct connection بيشتغل على IPv6 بس، وأغلب الشبكات مش بتدعمه.
- الرابط شكله كده:
  ```
  postgresql://postgres.icgzjqzjmzvhnezpignp:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres
  ```
- **شيل `:[YOUR-PASSWORD]` من الرابط**، عشان `pg_dump` يسألك عن الباسورد بدل ما تفضل مكتوبة في الـ history.
- لو ناسي الباسورد: Settings ← Database ← **Reset database password**. الصفحات نفسها مش هتتأثر، لأنها بتستخدم الـ API keys مش الباسورد. لكن أي أداة خارجية بتستخدم الباسورد القديمة هتحتاج تتحدّث.

**3. الـ dump:** شغّل الأوامر من فولدر `private-data`، لأنه موجود في `.gitignore`، والملف فيه بيانات شخصية زي السواقين والفواتير، فمينفعش يتعمله commit.
```bash
cd C:\dev\gbe-fleet-tracker\private-data
```
بدّل `<region>` في الأمر ده بالمنطقة اللي في الرابط بتاعك:
```bash
pg_dump "postgresql://postgres.icgzjqzjmzvhnezpignp@aws-0-<region>.pooler.supabase.com:5432/postgres" --format=custom --verbose --file=gbe_before_060.dump
```
هيطلب الباسورد. ده بيعمل نسخة كاملة: كل الـ schemas والجداول والبيانات والـ functions والـ policies.

**4. نسخة تانية مقروءة لبيانات `public` بس** (احتياطي، ونفس الكلام عن `<region>`):
```bash
pg_dump "postgresql://postgres.icgzjqzjmzvhnezpignp@aws-0-<region>.pooler.supabase.com:5432/postgres" --data-only --schema=public --file=gbe_before_060_public_data.sql
```

**5. اتأكد إن الـ backup سليم قبل ما تكمّل:**
```bash
pg_restore --list gbe_before_060.dump | Select-String "TABLE DATA public fuel_invoice_records"
```
لازم يطبع سطر واحد. ولو مطبعش حاجة أو طلع error، **وقّف هنا وما تكمّلش**.
- كمان حجم `gbe_before_060.dump` لازم يكون بالـ MB، مش كام KB.
- انسخ الملفين لمكان تاني آمن وخاص، زي Drive شخصي.

### 1-ج: احتياطي سريع إضافي (اختياري)

Table Editor ← `fuel_invoice_records` ← **Export** ← CSV.

---

## الخطوة 2: الفحص قبل التشغيل

1. Dashboard ← **SQL Editor** ← **New query**.
2. الصق محتوى `060_verify_before.sql` كله واضغط **Run**.
3. لازم كل الصفوف يكون فيها `ok = true`. لو فيه صف `false`، وقّف وابعتلي النتيجة.
4. **اكتب** القيم دي عشان هتقارنها بعدين:
   - `invoices_count`
   - `invoices_total_cost`
   - `triggers on fuel_invoice_records`

## الخطوة 3: تشغيل الـ migration

1. New query، والصق محتوى `060_wallet.sql` كله، واضغط **Run**.
2. المتوقع رسالة **Success. No rows returned**.
3. لو طلع error: **مفيش حاجة اتغيّرت**، لأن الملف كله transaction واحدة. ابعتلي نص الـ error بالظبط.

## الخطوة 4: الفحص بعد التشغيل

1. New query، والصق `060_verify_after.sql` كله، واضغط **Run**.
2. لازم كل الصفوف تكون `ok = true`، ومن ضمنها:
   - صفوف **dry run**: دي تجربة كاملة على شهر 2099-01 (ميزانية، توزيع، شحن، شحن مرفوض، reallocation، reconciliation)، واتعملها rollback.
   - **dry run left nothing behind**: معناها إن التجربة ما سابتش أي أثر.
3. قارن `invoices_count` و`invoices_total_cost` بالأرقام اللي كتبتها في الخطوة 2. **لازم يكونوا نفس الأرقام بالظبط.**
4. تقدر تشغّل الملف ده أكتر من مرة من غير أي ضرر.

## الخطوة 5: لو حاجة باظت

- **لو لسه مفيش ولا حركة في المحفظة** (وده الطبيعي لحد المرحلة 3): شغّل `060_rollback.sql`، وبعده `060_verify_before.sql`، ولازم كل حاجة تبقى `ok` تاني.
  - الـ rollback ما بيلمسش أي فاتورة. بيشيل بس الـ triggers والجداول والـ functions اللي الـ 060 ضافتها.
  - الـ SQL Editor ممكن يحذّرك إن العملية destructive. وافق، لأنها بتشيل حاجات المحفظة بس.
- **لو المحفظة فيها حركات فعلًا:** الـ rollback هيرفض يشتغل عن قصد، لأن الـ ledger هو سجل المراجعة ومينفعش يتمسح. الحل ساعتها الرجوع للـ backup، وده بيرجّع الـ database **كلها** لوقت الـ backup، يعني أي حاجة اتدخلت بعده هتضيع. ما تعملهوش لوحدك، كلّمني الأول.

## الخطوة 6: إيه اللي اتغيّر بعد التشغيل

- **مفيش حاجة ظاهرة.** لسه مفيش حسابات ولا قواعد ربط، فمفيش فاتورة هتترحّل. صفحة Invoices هتشتغل زي ما هي، والـ delete هيشتغل عادي.
- اتضاف triggerين على `fuel_invoice_records`:
  - `wallet_invoice_post`: بيرحّل الفاتورة لو ليها قاعدة.
  - `wallet_invoice_guard`: بيمنع حذف أو تعديل مبلغ أو حساب فاتورة **مرحّلة**.
  - الاتنين مش هيعملوا أي حاجة لحد ما يتضاف حسابات وقواعد.
- الفواتير اللي قبل 2026-11-01 عمرها ما هتترحّل.

## ما تعملش دلوقتي

- **ما تضيفش حسابات ولا قواعد ربط ولا ميزانيات** قبل ما المرحلة 3 تتعمل deploy والفريق يعرف بالتغيير. أول ما فاتورة تترحّل، زرار الحذف الحالي في صفحة Invoices هيطلّع error (`WALLET_INVOICE_POSTED_CANNOT_DELETE`)، وزرار الإلغاء لسه مش موجود.
- تقسيم الحسابات (سؤال 1) لسه محتاج يتحدد. بعد ما يتحدد، هجهزلك ملف `060_seed_accounts.sql` بالحسابات والقواعد، وبيتشغّل بعد المرحلة 3.
