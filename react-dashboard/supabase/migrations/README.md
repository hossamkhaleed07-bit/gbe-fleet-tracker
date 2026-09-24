# سجل ترحيلات قاعدة البيانات (Migrations)

كل الملفات دي اتنفذت بالفعل يدويًا في Supabase (SQL Editor) على مراحل مختلفة، ومرتبة هنا بالترتيب الزمني الصحيح اللي اتنفذت بيه (الرقم في اسم الملف = ترتيب التنفيذ). الجدول تحت بيوضح كل ملف بيعمل إيه، وهل هو **نشط/حالي** (يعكس آخر حالة فعلية في القاعدة) ولا **قديم اتجاوزته نسخة تانية**.

**قاعدة البيانات واحدة مشتركة** بين النسخة القديمة (`dashboard.html`) والنسخة الجديدة بـ React — الملفات دي مش خاصة بنسخة معينة من الواجهة.

| # | الملف | بيعمل إيه | الحالة |
|---|---|---|---|
| 001 | `vehicles_migration.sql` | أول نسخة من جدول `vehicles` (عمود `plate_number` فقط) + صلاحية قراءة للزوار | ⚠️ قديم — الجدول اتوسّع كتير بعد كده (عمود `plate_number` نفسه اتستبدل بـ `vehicle_plate`) |
| 002 | `insert_vehicles.sql` | إدخال أول لستة لوحات سيارات (أسماء بس، بدون بيانات) | ⚠️ قديم — البيانات دي اتحدثت بالكامل في #003 |
| 003 | `seed_vehicles_full.sql` | البيانات الحقيقية والكاملة للأسطول (اللوحة، الفيندور، نوع الوقود، معدل الاستهلاك، الموديل) — ده مصدر بيانات الأسطول الفعلي | ✅ نشط |
| 004 | `seed_drivers.sql` | إنشاء جدول `drivers` بكل الأعمدة (الاسم، الجنسية، الموبايل، المحطة، القسم...) + صلاحيات القراءة + إدخال أول 41 سائق ببياناتهم الكاملة من شيت "Driver Data" | ✅ نشط (البيانات الأساسية) |
| 005 | `seed_drivers_fixed.sql` | نسخة احتياطية بتضيف بس السائقين اللي مش موجودين لسه (fallback)، وبتعيد تعريف نفس صلاحيات القراءة | ✅ نشط لكنه تكميلي بس (مفيش جديد لو #004 اتنفذ صح) |
| 006 | `update_driver_projects.sql` | تحديد المشروع (`project`) لكل سائق: FDP / ADM / JDL / MGF | ✅ نشط |
| 007 | `project_access_migration.sql` | ربط كل حساب مدير مشروع (`fdp.manager@`, `adm.manager@`...) بمشروعه في بيانات الحساب (JWT) + قواعد أمان (RLS): كل مدير يشوف بيانات مشروعه بس، التعديل/الحذف للأدمن الرئيسي فقط | ✅ نشط (جزئيًا — بعض قواعد `shift_entries` اتعدلت تاني في #012) |
| 008 | `shift_date_migration.sql` | إضافة عمود `shift_date` (تاريخ الدوام يدويًا، مستقل عن وقت الإرسال) + أول نسخة من دالة `submit_shift_entry` | ⚠️ قديم — الدالة اتستبدلت بالكامل في #011 |
| 009 | `insert_stations.sql` | إدخال أول لستة بمحطات التسليم (15 محطة) | ✅ نشط |
| 010 | `fleet_management_migration.sql` | إضافة عمود `is_active` للعربيات + صلاحيات إضافة/تعديل للأدمن بس | ✅ نشط (الصلاحيات دي اتأكدت تاني بشكل مطابق في المهاجرات اللاحقة) |
| 011 | `driver_management_migration.sql` | إضافة عمود `is_active` للسائقين + صلاحيات إضافة/تعديل للأدمن + **النسخة الحالية والنهائية** من دالة `submit_shift_entry` (بترفض تسجيل دوام لسائق معطّل) | ✅ نشط — ده الإصدار الفعلي الشغال دلوقتي من الدالة |
| 012 | `fleet_manager_role_migration.sql` | أول محاولة لدور "fleet_manager": يقدر يعدل الأسطول والسائقين بس، ممنوع يشوف السجلات خالص | ⚠️ قديم — الصلاحيات دي اتغيّرت مرتين بعد كده (طلب المستخدمة اتغير) |
| 013 | `fleet_manager_redefine_migration.sql` | تعديل الدور: يشوف السجلات (بدون تعديل)، وميقدرش يعدل على الأسطول/السائقين خالص | ⚠️ قديم — اتغيّر تاني في #014 |
| 014 | `fleet_manager_final_migration.sql` | **النسخة النهائية**: يشوف السجلات/تقرير السائقين/تقرير المحطات (بدون تعديل)، ويقدر يعدل بالكامل على الأسطول والسائقين | ✅ نشط |
| 015 | `fleet_manager_email_fix.sql` | تصحيح بريد حساب الـ fleet manager الفعلي (`fleet@gbe.sa.com`) بعد أول محاولة كانت باسم مختلف | ✅ نشط (إصلاح لمرة واحدة) |
| 016 | `driver_delete_migration.sql` | السماح بحذف سائق نهائيًا — للأدمن الرئيسي فقط | ✅ نشط |
| 017 | `station_rates_migration.sql` | إضافة أسعار كل محطة (COD/PPD/Pickup rate + سعر الديزل/البنزين) — مستخدمة في حساب المبيعات | ✅ نشط |
| 018 | `driver_vehicle_assignment_migration.sql` | ربط كل سائق بالعربية المخصصة له (`assigned_vehicle_plate`) من شيت "Driver Data" الأصلي | ✅ نشط |
| 019 | `driver_data_full_sync.sql` | إعادة مزامنة كاملة لبيانات الـ 41 سائق من ملف `Data.xlsx` — إضافة عمودين جددين (`pns_status`, `date_of_hiring`) وتحديث كل الحقول التانية لتطابق الشيت بالظبط | ✅ نشط — لسه محتاج تشغيل |
| 020 | `vehicle_rate_full_sync.sql` | إعادة مزامنة كاملة لمعدلات استهلاك الوقود لكل العربيات (83 عربية) من تبويب "Rate" — بيحل مشكلة العربيات اللي كانت من غير معدل في "نقاط تحتاج معالجة" | ✅ نشط — لسه محتاج تشغيل ⚠️ فيه تعارض بيانات محتاج تأكيد (شوفي أول الملف) |
| 021 | `stations_confirm_sync.sql` | تأكيد إن أسعار الـ 14 محطة الرسمية مطابقة لتبويب "Stations" — تحديث تأكيدي بس، مفيش تغيير متوقع | ✅ نشط — لسه محتاج تشغيل |
| 022 | `reinforcement_requests_migration.sql` | جدول جديد منفصل `reinforcement_requests` لطلبات "التعزيز" من الفورم العمومي (مش جزء من `shift_entries` لأنه مش دوام) + دالة `submit_reinforcement_request` للإدخال العمومي | ✅ نشط |
| 023 | `reinforcement_requests_approval_migration.sql` | إضافة workflow الموافقة على طلبات التعزيز: عمود `status` (pending/approved/rejected) + `reviewed_by`/`reviewed_at` + صلاحية تعديل للأدمن — بيشغّل قسم "Fuel" (Fuel Approver + Approval) في الداشبورد | ✅ نشط — لسه محتاج تشغيل |
| 024 | `reinforcement_requests_code_migration.sql` | إضافة عمود `request_no` (bigserial) لكل طلب تعزيز — تكويد تسلسلي ثابت بيتعرض على شكل "GBE-FR-000001" في بوكس الطلب بصفحة Fuel Approver | ✅ نشط — لسه محتاج تشغيل |
| 025 | `reinforcement_request_amount_fix.sql` | إصلاح مشكلة `amount` بييجي فاضي في الطلبات الجديدة — حذف صريح لأي نسخة قديمة من دالة `submit_reinforcement_request` (لو فيه أكتر من نسخة متضاربة) وإعادة إنشائها نظيفة + إجبار PostgREST يعمل reload للـ schema | ✅ نشط |
| 026 | `reinforcement_loan_adjustment_migration.sql` | إضافة عمود `loan_adjustment` — يسمح للمراجع (Fuel Approver) يعدّل قيمة الطلب قبل الموافقة/الرفض من غير ما يغيّر المبلغ الأصلي اللي طلبه المندوب | ✅ نشط |
| 027 | `driver_petroapp_link_migration.sql` | إضافة عمود `petro_app_link` لجدول `drivers` — لينك PetroApp خاص بكل سائق، بيتضاف من صفحة السائقين وبيظهر في تفاصيل طلب التعزيز | ✅ نشط — لسه محتاج تشغيل |
| 028 | `prevent_duplicate_shift_migration.sql` | دالة `shift_entry_exists(...)` (فحص سريع قبل الرفع) + إعادة تعريف `submit_shift_entry` عشان ترفض تسجيل شيفت مكرر (نفس السائق/التاريخ/النوع) | ✅ نشط — النسخة الحالية من `submit_shift_entry` |
| 029 | `shift_entries_insert_policy_migration.sql` | صلاحية إدخال (INSERT) على `shift_entries` للأدمن — عشان ميزة التراجع (Ctrl+Z) بعد الحذف | ⚠️ قديم — النطاق اتوسّع في #032 |
| 030 | `reinforcement_requests_realtime_migration.sql` | إضافة `reinforcement_requests` لقائمة realtime عشان إشعارات الطلبات الجديدة تظهر لحظيًا في الداشبورد | ✅ نشط |
| 031 | `shift_entries_realtime_migration.sql` | نفس الحاجة لجدول `shift_entries` (كان ناقص من #030) | ✅ نشط |
| 032 | `project_scoped_shift_entries_edit_migration.sql` | مدير المشروع (زي `fdp.manager@gbe.sa`) بقى يقدر يعدّل/يحذف سجلات الشيفت الخاصة بسائقين مشروعه بس، مش الأدمن الرئيسي وبس زي الأول | ✅ نشط — النسخة الحالية |
| 033 | `driver_attendance_migration.sql` | جدول جديد `driver_attendance` — حالة حضور يومية لكل سائق (حاضر/إجازة/غياب)، مستقل عن `shift_entries`. ده الأساس لميزة "تعارض الحضور" (طلب وقود في يوم السائق فيه إجازة/غايب) | ✅ نشط |
| 034 | `reinforcement_rejection_reason_migration.sql` | إضافة عمود `rejection_reason` لجدول `reinforcement_requests` — بيتسجل فيه سبب الرفض من نافذة تأكيد الرفض الجديدة في الداشبورد | ✅ نشط |
| 035 | `reinforcement_cooldown_migration.sql` | فترة انتظار ساعتين بين طلبات التعزيز لنفس السائق — اتفرضت جوه `submit_reinforcement_request` نفسها (مينفعش تتلف عن طريق نداء الـ API مباشرة) + دالة قراءة `get_reinforcement_cooldown` للفورم العام يعرض عداد تنازلي بيها | ✅ نشط |
| 036 | `automatic_fuel_allocations_migration.sql` | جدول جديد `automatic_fuel_allocations` — الوقود التلقائي اليومي لسائقي FDP النشطين (عن طريق PetroApp)، منفصل تمامًا عن "الوقود الفعلي" الحالي. أتمتة بـ pg_cron الساعة 12 ظهرًا بتوقيت الرياض، مضمونة عدم التكرار عن طريق قيد فريد في قاعدة البيانات | ✅ نشط |
| 037 | `reinforcement_requires_shift_start_migration.sql` | طلب التعزيز مينفعش يتقدّم إلا لو السائق سجّل بداية دوام (`shift_entries`, shift_type='start') لنفس تاريخ الطلب — فحص جوه `submit_reinforcement_request` نفسها | ✅ نشط |
| 038 | `automatic_fuel_backfill_support_migration.sql` | `allocate_daily_automatic_fuel()` بقت تقبل تاريخ اختياري — الـ cron لسه بينادي بدون تاريخ (يعني النهاردة زي ما هو)، لكن دلوقتي ممكن تتنادى يدويًا لأي تاريخ فات (backfill) | ✅ نشط |
| 039 | `fix_shc_manager_project_tag_migration.sql` | تصحيح النقطة اللي كانت متسجلة تحت — تعديل `project` بتاع حساب `shc.manager@gbe.sa` من `SHC` لـ `MGF` عشان يتطابق مع بيانات السائقين والكود | ✅ نشط — لسه محتاج تشغيل |
| 040 | `attendance_status_codes_migration.sql` | توسيع `driver_attendance.status` من 3 حالات (حاضر/إجازة/غياب) لـ 20 كود حقيقي (A, WO, OT, OTF, NJ, Left, NM, UP, SL, EA, EF, ND, FD, AL, EL, PH, VI, PNS, P, VM) — عشان صفحة الحضور بقت جدول شهري كامل زي شيت الـ HR، مش تسجيل يوم واحد بس | ⚠️ قديم — تم تقليل الأكواد لـ 6 بس في #041 |
| 041 | `attendance_codes_reduce_migration.sql` | تقليل أكواد الحضور من 20 لـ 6 بس حسب طلب المستخدمة: A, WO, Left, AL, P, VM — أي بيانات كانت باقي الأكواد اتحولت لأقرب كود من الـ 6 (تفاصيل التحويل جوه الملف) | ⚠️ قديم — تمت إضافة NM تاني في #042 |
| 042 | `attendance_add_not_marked_migration.sql` | إضافة كود "NM" (لم يتم التحضير) تاني كسابع كود standard، وبقى هو الافتراضي — ده مرتبط بتعديل في الكود: P/A بقوا يتحسبوا أوتوماتيك من نموذج الدوام (سجّل الفورم = P، عدى اليوم من غير تسجيل = A)، وNM هو الشكل قبل ما الحساب ده يتطبق أو قبل أي استثناء يدوي | ✅ نشط — لسه محتاج تشغيل |

---

## ✅ تم حلها: مشروع "SHC" مقابل "MGF"

كانت متسجلة هنا نقطة إن #006 حط project = **`MGF`** لبيانات السائقين، لكن #007 حط حساب المدير `shc.manager@gbe.sa` بمشروع **`SHC`** — يعني المدير ده كان شايف صفحته فاضية من غير سائقين خالص. تم حلها في #039 بتعديل حساب المدير نفسه لـ `MGF` (من غير أي لمس لبيانات السائقين، لأنها كانت صحيحة من البداية).
