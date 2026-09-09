create table if not exists public.drivers (
  id uuid primary key default gen_random_uuid(),
  identity_number text not null unique,
  full_name text,
  nationality text,
  mobile_number text,
  vehicle_plate text,
  city_name text,
  job_title text,
  vendor_name text,
  department text,
  job_id text,
  vehicle_type text,
  contract_type text,
  employee_type text,
  created_at timestamptz not null default now()
);

alter table public.drivers enable row level security;

drop policy if exists "anon can view drivers" on public.drivers;
create policy "anon can view drivers" on public.drivers for select to anon using (true);
grant select on public.drivers to anon;

drop policy if exists "authenticated can view drivers" on public.drivers;
create policy "authenticated can view drivers" on public.drivers for select to authenticated using (true);
grant select on public.drivers to authenticated;

insert into public.drivers (identity_number, full_name, nationality, mobile_number, vehicle_plate, city_name, job_title, vendor_name, department, job_id, vehicle_type, contract_type, employee_type) values
('2633654682', 'Osama Omar Mohamed Amin', 'Sudan', '573550129', 'GBE-FLT-TXA-3236-109', 'Jeddah Manar Station', 'Delivery associate', 'GBE', 'JDL', '100006086', 'VAN', 'FS', '3PL'),
('2493281246', 'MUAAAMAR SADEQ ALI MOHAMMED AL SHEHARI', 'Yemen', '547275504', 'GBE-FLT-JTA-9940-112', 'Jeddah', 'Delivery associate', 'GBE', 'JDL', '100006531', 'VAN', 'FS', '3PL'),
('2373494505', 'Ousman Daoud Leham Kone', 'Mali', '563076546', 'GBE-FLT-STA-2913-134', 'Mecca', 'Delivery associate', 'GBE', 'JDL', '100006504', 'VAN', 'FS', '3PL'),
('2545740710', 'OMAR MUHAMMED MAWLANA GULAM', 'Bangladesh', '537156057', 'GBE-FLT-DGB-2707-149', 'Medina', 'Delivery associate', 'GBE', 'JDL', '100000560', 'VAN', 'FS', '3PL'),
('2209243712', 'Yasser Dal Mohammed Mohammed', 'Pakistan', '503318460', 'GBE-FLT-STA-2905-129', 'Makkah', 'Delivery associate', 'GBE', 'JDL', '100006512', 'VAN', 'FS', '3PL'),
('2478725571', 'Suhail Abdu Al Bashir', 'Sudan', '551354517', 'GBE-FLT-STA-1192-168', 'Al Khurma', 'Delivery associate', 'GBE', 'ADM', 'D2106183201', 'Hiace', 'FS', '3PL'),
('2597655642', 'Ahmed Al Sadiq Mohamed', 'Sudan', '560202970', 'GBE-FLT-DXA-3502-59', 'Al Arfa', 'Linehaul driver', 'GBE', 'ADM', 'GBE00113', 'VAN', 'FS', '3PL'),
('2478176270', 'Imran Ahmed', 'Bangladesh', '503647845', 'GBE-FLT-ZTA-9105-169', 'Al Khurma', 'Delivery associate', 'GBE', 'ADM', 'D21022337101', 'LiteAce', 'FS', '3PL'),
('2440841183', 'Mohamed Saif Aldin Ahmed Mohamed', 'Sudan', '544307922', 'GBE-FLT-STA-1183-172', 'Al Arfa', 'Delivery associate', 'GBE', 'ADM', 'D21022066001', 'Hiace', 'FS', '3PL'),
('2411231901', 'Idris Muhammad Idris Yacoub', 'Sudan', '535740717', 'GBE-FLT-ZTA-9140-171', 'Al Arfa', 'Delivery associate', 'GBE', 'ADM', 'D21016160301', 'Hiace', 'FS', '3PL'),
('2517070245', 'Shoaib Shahid Muhammad Shahid Iqbal', 'Pakistan', '550970655', 'GBE-FLT-DXA-3015-6', 'Al Khurma', 'Delivery associate', 'GBE', 'ADM', 'D21032586401', 'Lite-Ace', 'FS', '3PL'),
('2523468854', 'Khalil Ali Mohammed Saleh Al Daghbashi', 'Yemen', '546905160', 'GBE-FLT-NTB-9213-4', 'Al Khurma', 'Delivery Associate', 'GBE', 'ADM', 'D21032892501', 'Hi-Ace', 'FS', '3PL'),
('2603268810', 'Sidr Rahman Rakib', 'Pakistan', '554202649', 'GBE-FLT-BTA-5034-84', 'Riyadh', 'Delivery Associate', 'GBE', 'FDP', 'GBE00202', 'i10', 'FS', 'OWN'),
('2624520058', 'Mehedi Hasan Robin', 'Bangladesh', '536838145', 'GBE-FLT-BTA-5039-85', 'Riyadh', 'Delivery Associate', 'GBE', 'FDP', 'GBE00203', 'i10', 'FS', 'OWN'),
('2624520066', 'Md Alomgir Hosen', 'Bangladesh', '538573165', 'GBE-FLT-ZRS-1205-139', 'Riyadh', 'Delivery Associate', 'GBE', 'FDP', 'GBE00204', 'i10', 'FS', 'OWN'),
('2622057210', 'Ikhtiaz Hossain Tanvir', 'Bangladesh', '571270544', 'GBE-FLT-BTA-5038-91', 'Riyadh', 'Delivery Associate', 'GBE', 'FDP', 'GBE00205', 'i10', 'FS', 'OWN'),
('2624019366', 'Md Naiem Hossen', 'Bangladesh', '530394739', 'GBE-FLT-NBS-3493-138', 'Riyadh', 'Delivery Associate', 'GBE', 'FDP', 'GBE00206', 'i10', 'FS', 'OWN'),
('2623843170', 'MD Rubel Pramanik', 'Bangladesh', '575456587', 'GBE-FLT-XAS-2311-137', 'Riyadh', 'Delivery Associate', 'GBE', 'FDP', 'GBE00207', 'i10', 'FS', 'OWN'),
('2624520215', 'MD Mominur Isla', 'Bangladesh', '538626192', 'GBE-FLT-LRS-4583-143', 'Riyadh', 'Delivery Associate', 'GBE', 'FDP', 'GBE00208', 'i10', 'FS', 'OWN'),
('2621479241', 'MD Rohan Miah', 'Bangladesh', '505767959', 'GBE-FLT-BTA-5042-93', 'Riyadh', 'Delivery Associate', 'GBE', 'FDP', 'GBE00209', 'i10', 'FS', 'OWN'),
('2622009583', 'Mohamed Zaidal Islam', 'Bangladesh', '511469683', 'GBE-FLT-LRS-4582-141', 'Riyadh', 'Delivery Associate', 'GBE', 'FDP', 'GBE00210', 'i10', 'FS', 'OWN'),
('2622858559', 'Liton Md Salauddin', 'Bangladesh', '575200367', 'GBE-FLT-LRS-4722-146', 'Riyadh', 'Delivery Associate', 'GBE', 'FDP', 'GBE00213', 'i10', 'FS', 'OWN'),
('2622846752', 'Md Suzon Suzon', 'Bangladesh', '574652001', 'GBE-FLT-BTA-5036-87', 'Riyadh', 'Delivery Associate', 'GBE', 'FDP', 'GBE00212', 'i10', 'FS', 'OWN'),
('2522444146', 'Mohamed Ali bin Khams Belhafi', 'Tunisia', '594612472', 'GBE-FLT-BTA-5040-90', 'Riyadh', 'Delivery Associate', 'GBE', 'FDP', 'GBE00157', 'i10', 'FS', 'OWN'),
('2583022161', 'Mohammed Hassan Mahboub', 'Egypt', '570526013', 'GBE-FLT-BTA-5041-88', 'Riyadh', 'Delivery Associate', 'GBE', 'FDP', 'GBE00159', 'i10', 'FS', 'OWN'),
('2449955117', 'Hashim Abdelraziq Ali', 'Yemen', '536214308', 'GBE-FLT-BTA-5035-86', 'Riyadh', 'Delivery Associate', 'GBE', 'FDP', 'GBE00160', 'i10', 'FS', 'OWN'),
('2624520082', 'MD MOBASIRUL ISLAM', 'Bangladesh', '538544875', 'GBE-FLT-BTA-5037-92', 'Riyadh', 'Delivery Associate', 'GBE', 'FDP', 'GBE00214', 'i10', 'FS', 'OWN'),
('2625168055', 'Md Mithu Pramanik', 'Bangladesh', '533749501', 'GBE-FLT-BTA-5846-89', 'Riyadh', 'Delivery Associate', 'GBE', 'FDP', 'GBE00215', 'i10', 'FS', 'OWN'),
('2625119371', 'Md Hasib Miah', 'Bangladesh', '553717895', 'GBE-FLT-LRS-4596-140', 'Riyadh', 'Delivery Associate', 'GBE', 'FDP', 'GBE00216', 'i10', 'FS', 'OWN'),
('2625260837', 'Shajiduzzaman Shamsul Alam', 'Bangladesh', '563436198', 'GBE-FLT-HBS-1008-142', 'Riyadh', 'Delivery associate', 'GBE', 'FDP', 'GBE00219', 'i10', 'FS', 'OWN'),
('2590917460', 'Mohamed Alfred Abu Baker Mohamed Khier', 'Sudan', '0', 'GBE-FLT-TXA-1156-36', 'Riyadh', 'Project Manager', 'GBE', 'FDP', 'GBE00111', 'Dizier', 'FS', 'OWN'),
('2130114420', 'MIRZA AKBAR', 'Pakistan', '551057292', 'GBE-FLT-XHA-1676-166', 'Jeddah', 'Assistant Manager', 'GBE', 'JDL', 'GBE00255', 'i10', 'Project-Based', 'Assistant Manager'),
('2570515078', 'Babar khan yousaf khan', 'Pakistan', '562314163', 'GBE-FLT-GGB-6560-113', 'Jeddah', 'Delivery associate', 'GBE', 'JDL', '100005796', 'VAN', 'FS', '3PL'),
('2632593576', 'Mohammad ali omar Mohammad', 'Sudan', '546816629', 'GBE-FLT-JTA-9941-157', 'Jeddah', 'Delivery associate', 'GBE', 'JDL', '100006713', 'VAN', 'FS', '3PL'),
('2097453308', 'FARUQ ATIF', 'Palestinian', '0566342733‬', 'GBE-FLT-TXA-3237-122', 'Jeddah', 'Delivery associate', 'GBE', 'JDL', '100006660', 'VAN', 'FS', '3PL'),
('2145618886', 'MOHAMMED ILYA YAHYA HAROON', 'Nigeria', '569144282', 'GBE-FLT-TXA-3220-150', 'Makkah', 'Delivery associate', 'GBE', 'JDL', '100006597', 'VAN', 'FS', '3PL'),
('2623975527', 'Mohamed Abdulhai Kambal Othman', 'Sudan', '545620418', 'GBE-FLT-KXA-2148-170', 'Medina', 'Delivery associate', 'GBE', 'JDL', 'JDL', 'VAN', 'FS', '3PL'),
('2144047038', 'BAKUR MOHAMMED ABUBAKAR', 'Nigeria', '580342387', 'GBE-FLT-STA-2622-305', 'Makkah', 'Delivery associate', 'GBE', 'JDL', 'JDL', 'VAN', 'FS', '3PL'),
('2629027562', 'AJMAL SHAHZAD MUHAMMAD ANSAR', 'Pakistan', '538634815', 'GBE-FLT-KXA-2185-154', 'Damam', 'Delivery associate', 'GBE', 'JDL', 'JDL', 'VAN', 'FS', '3PL'),
('2046117384', 'HASHAM MOHAMMAD YAQOOB SULTAN AHMED', 'Pakistan', '502704062', 'GBE-FLT-ZEB-8973-123', 'Makkah', 'Delivery associate', 'GBE', 'JDL', '100006629', 'VAN', 'FS', '3PL'),
('2168811582', 'Khaled Ibrahim Sale', 'Yemen', '590949620', 'SHC-FLT-KJR-2655-167', 'Al khobar', 'Delivery associate', 'SHC', 'MGF', 'SHC00254', 'Carg', 'FS', '3PL')
on conflict (identity_number) do update set full_name=excluded.full_name, nationality=excluded.nationality, mobile_number=excluded.mobile_number, vehicle_plate=excluded.vehicle_plate, city_name=excluded.city_name, job_title=excluded.job_title, vendor_name=excluded.vendor_name, department=excluded.department, job_id=excluded.job_id, vehicle_type=excluded.vehicle_type, contract_type=excluded.contract_type, employee_type=excluded.employee_type;
