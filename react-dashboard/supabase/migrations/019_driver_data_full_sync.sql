-- ============================================================
-- 019_driver_data_full_sync.sql
-- Full re-sync of driver roster from "Data.xlsx" (Driver Data tab)
-- Adds pns_status + date_of_hiring columns, updates every field
-- for all 41 drivers to match the sheet exactly.
-- ============================================================

alter table public.drivers add column if not exists pns_status text;
alter table public.drivers add column if not exists date_of_hiring date;
alter table public.drivers add column if not exists job_id text;
alter table public.drivers add column if not exists vendor_name text;
alter table public.drivers add column if not exists city_name text;
alter table public.drivers add column if not exists employee_type text;
alter table public.drivers add column if not exists contract_type text;
alter table public.drivers add column if not exists vehicle_type text;
alter table public.drivers add column if not exists department text;
alter table public.drivers add column if not exists job_title text;
alter table public.drivers add column if not exists vehicle_plate text;
alter table public.drivers add column if not exists full_name text;
alter table public.drivers add column if not exists nationality text;
alter table public.drivers add column if not exists mobile_number text;

update public.drivers as d set
  job_id = v.job_id,
  vendor_name = v.vendor_name,
  city_name = v.city_name,
  employee_type = v.employee_type,
  contract_type = v.contract_type,
  full_name = v.full_name,
  nationality = v.nationality,
  mobile_number = v.mobile_number,
  pns_status = v.pns_status,
  date_of_hiring = v.date_of_hiring::date,
  vehicle_type = v.vehicle_type,
  vehicle_plate = v.vehicle_plate,
  department = v.department,
  job_title = v.job_title
from (values
  ('2633654682', '100006086', 'GBE', 'Jeddah Manar Station', '3PL', 'FS', 'Osama Omar Mohamed Amin', 'Sudan', '573550129', 'Created', '2026-05-21', 'VAN', 'GBE-FLT-TXA-3236-109', 'JDL', 'Delivery associate'),
  ('2493281246', '100006531', 'GBE', 'Jeddah', '3PL', 'FS', 'MUAAAMAR SADEQ ALI MOHAMMED AL SHEHARI', 'Yemen', '547275504', 'Created', '2026-06-15', 'VAN', 'GBE-FLT-JTA-9940-112', 'JDL', 'Delivery associate'),
  ('2373494505', '100006504', 'GBE', 'Mecca', '3PL', 'FS', 'Ousman Daoud Leham Kone', 'Mali', '563076546', 'Created', '2026-06-18', 'VAN', 'GBE-FLT-STA-2913-134', 'JDL', 'Delivery associate'),
  ('2545740710', '100000560', 'GBE', 'Medina', '3PL', 'FS', 'OMAR MUHAMMED MAWLANA GULAM', 'Bangladesh', '537156057', 'Created', '2026-06-27', 'VAN', 'GBE-FLT-DGB-2707-149', 'JDL', 'Delivery associate'),
  ('2209243712', '100006512', 'GBE', 'Makkah', '3PL', 'FS', 'Yasser Dal Mohammed Mohammed', 'Pakistan', '503318460', 'Created', '2026-06-29', 'VAN', 'GBE-FLT-STA-2905-129', 'JDL', 'Delivery associate'),
  ('2478725571', 'D2106183201', 'GBE', 'Al Khurma', '3PL', 'FS', 'Suhail Abdu Al Bashir', 'Sudan', '551354517', 'Created', '2024-05-20', 'Hiace', 'GBE-FLT-STA-1192-168', 'ADM', 'Delivery associate'),
  ('2597655642', 'GBE00113', 'GBE', 'Al Arfa', '3PL', 'FS', 'Ahmed Al Sadiq Mohamed', 'Sudan', '560202970', 'Created', '2025-04-14', 'VAN', 'GBE-FLT-DXA-3502-59', 'ADM', 'Linehaul driver'),
  ('2478176270', 'D21022337101', 'GBE', 'Al Khurma', '3PL', 'FS', 'Imran Ahmed', 'Bangladesh', '503647845', 'Created', '2025-09-21', 'LiteAce', 'GBE-FLT-ZTA-9105-169', 'ADM', 'Delivery associate'),
  ('2440841183', 'D21022066001', 'GBE', 'Al Arfa', '3PL', 'FS', 'Mohamed Saif Aldin Ahmed Mohamed', 'Sudan', '544307922', 'Created', '2025-01-12', 'Hiace', 'GBE-FLT-STA-1183-172', 'ADM', 'Delivery associate'),
  ('2411231901', 'D21016160301', 'GBE', 'Al Arfa', '3PL', 'FS', 'Idris Muhammad Idris Yacoub', 'Sudan', '535740717', 'Created', '2025-12-23', 'Hiace', 'GBE-FLT-ZTA-9140-171', 'ADM', 'Delivery associate'),
  ('2517070245', 'D21032586401', 'GBE', 'Al Khurma', '3PL', 'FS', 'Shoaib Shahid Muhammad Shahid Iqbal', 'Pakistan', '550970655', 'Created', '2026-02-01', 'Lite-Ace', 'GBE-FLT-DXA-3015-6', 'ADM', 'Delivery associate'),
  ('2523468854', 'D21032892501', 'GBE', 'Al Khurma', '3PL', 'FS', 'Khalil Ali Mohammed Saleh Al Daghbashi', 'Yemen', '546905160', 'Created', '2026-08-01', 'Hi-Ace', 'GBE-FLT-NTB-9213-4', 'ADM', 'Delivery Associate'),
  ('2603268810', 'GBE00202', 'GBE', 'Riyadh', 'OWN', 'FS', 'Sidr Rahman Rakib', 'Pakistan', '554202649', 'Created', '2025-12-05', 'i10', 'GBE-FLT-BTA-5034-84', 'FDP', 'Delivery Associate'),
  ('2624520058', 'GBE00203', 'GBE', 'Riyadh', 'OWN', 'FS', 'Mehedi Hasan Robin', 'Bangladesh', '536838145', 'Created', '2025-12-24', 'i10', 'GBE-FLT-BTA-5039-85', 'FDP', 'Delivery Associate'),
  ('2624520066', 'GBE00204', 'GBE', 'Riyadh', 'OWN', 'FS', 'Md Alomgir Hosen', 'Bangladesh', '538573165', 'Created', '2025-12-24', 'i10', 'GBE-FLT-ZRS-1205-139', 'FDP', 'Delivery Associate'),
  ('2622057210', 'GBE00205', 'GBE', 'Riyadh', 'OWN', 'FS', 'Ikhtiaz Hossain Tanvir', 'Bangladesh', '571270544', 'Created', '2025-12-22', 'i10', 'GBE-FLT-BTA-5038-91', 'FDP', 'Delivery Associate'),
  ('2624019366', 'GBE00206', 'GBE', 'Riyadh', 'OWN', 'FS', 'Md Naiem Hossen', 'Bangladesh', '530394739', 'Created', '2025-12-22', 'i10', 'GBE-FLT-NBS-3493-138', 'FDP', 'Delivery Associate'),
  ('2623843170', 'GBE00207', 'GBE', 'Riyadh', 'OWN', 'FS', 'MD Rubel Pramanik', 'Bangladesh', '575456587', 'Created', '2025-12-22', 'i10', 'GBE-FLT-XAS-2311-137', 'FDP', 'Delivery Associate'),
  ('2624520215', 'GBE00208', 'GBE', 'Riyadh', 'OWN', 'FS', 'MD Mominur Isla', 'Bangladesh', '538626192', 'Created', '2025-12-24', 'i10', 'GBE-FLT-LRS-4583-143', 'FDP', 'Delivery Associate'),
  ('2621479241', 'GBE00209', 'GBE', 'Riyadh', 'OWN', 'FS', 'MD Rohan Miah', 'Bangladesh', '505767959', 'Created', '2025-12-24', 'i10', 'GBE-FLT-BTA-5042-93', 'FDP', 'Delivery Associate'),
  ('2622009583', 'GBE00210', 'GBE', 'Riyadh', 'OWN', 'FS', 'Mohamed Zaidal Islam', 'Bangladesh', '511469683', 'Created', '2025-12-25', 'i10', 'GBE-FLT-LRS-4582-141', 'FDP', 'Delivery Associate'),
  ('2622858559', 'GBE00213', 'GBE', 'Riyadh', 'OWN', 'FS', 'Liton Md Salauddin', 'Bangladesh', '575200367', 'Created', '2025-12-26', 'i10', 'GBE-FLT-LRS-4722-146', 'FDP', 'Delivery Associate'),
  ('2622846752', 'GBE00212', 'GBE', 'Riyadh', 'OWN', 'FS', 'Md Suzon Suzon', 'Bangladesh', '574652001', 'Created', '2025-12-26', 'i10', 'GBE-FLT-BTA-5036-87', 'FDP', 'Delivery Associate'),
  ('2522444146', 'GBE00157', 'GBE', 'Riyadh', 'OWN', 'FS', 'Mohamed Ali bin Khams Belhafi', 'Tunisia', '594612472', 'Created', '2025-10-14', 'i10', 'GBE-FLT-BTA-5040-90', 'FDP', 'Delivery Associate'),
  ('2583022161', 'GBE00159', 'GBE', 'Riyadh', 'OWN', 'FS', 'Mohammed Hassan Mahboub', 'Egypt', '570526013', 'Created', '2025-10-21', 'i10', 'GBE-FLT-BTA-5041-88', 'FDP', 'Delivery Associate'),
  ('2449955117', 'GBE00160', 'GBE', 'Riyadh', 'OWN', 'FS', 'Hashim Abdelraziq Ali', 'Yemen', '536214308', 'Created', '2025-10-21', 'i10', 'GBE-FLT-BTA-5035-86', 'FDP', 'Delivery Associate'),
  ('2624520082', 'GBE00214', 'GBE', 'Riyadh', 'OWN', 'FS', 'MD MOBASIRUL ISLAM', 'Bangladesh', '538544875', 'Created', '2026-01-02', 'i10', 'GBE-FLT-BTA-5037-92', 'FDP', 'Delivery Associate'),
  ('2625168055', 'GBE00215', 'GBE', 'Riyadh', 'OWN', 'FS', 'Md Mithu Pramanik', 'Bangladesh', '533749501', 'Created', '2025-12-29', 'i10', 'GBE-FLT-BTA-5846-89', 'FDP', 'Delivery Associate'),
  ('2625119371', 'GBE00216', 'GBE', 'Riyadh', 'OWN', 'FS', 'Md Hasib Miah', 'Bangladesh', '553717895', 'Created', '2025-12-29', 'i10', 'GBE-FLT-LRS-4596-140', 'FDP', 'Delivery Associate'),
  ('2625260837', 'GBE00219', 'GBE', 'Riyadh', 'OWN', 'FS', 'Shajiduzzaman Shamsul Alam', 'Bangladesh', '563436198', 'Created', '2026-01-04', 'i10', 'GBE-FLT-HBS-1008-142', 'FDP', 'Delivery associate'),
  ('2590917460', 'GBE00111', 'GBE', 'Riyadh', 'OWN', 'FS', 'Mohamed Alfred Abu Baker Mohamed Khier', 'Sudan', '0', 'Approved, register without PN', '2025-06-04', 'Dizier', 'GBE-FLT-TXA-1156-36', 'FDP', 'Project Manager'),
  ('2130114420', 'GBE00255', 'GBE', 'Jeddah', 'Assistant Manager', 'Project-Based', 'MIRZA AKBAR', 'Pakistan', '551057292', 'Created', '2026-04-06', 'i10', 'GBE-FLT-XHA-1676-166', 'JDL', 'Assistant Manager'),
  ('2570515078', '100005796', 'GBE', 'Jeddah', '3PL', 'FS', 'Babar khan yousaf khan', 'Pakistan', '562314163', 'Created', '2026-07-14', 'VAN', 'GBE-FLT-GGB-6560-113', 'JDL', 'Delivery associate'),
  ('2632593576', '100006713', 'GBE', 'Jeddah', '3PL', 'FS', 'Mohammad ali omar Mohammad', 'Sudan', '546816629', 'Created', '2026-07-14', 'VAN', 'GBE-FLT-JTA-9941-157', 'JDL', 'Delivery associate'),
  ('2097453308', '100006660', 'GBE', 'Jeddah', '3PL', 'FS', 'FARUQ ATIF', 'Palestinian', '0566342733‬', 'Created', '2026-11-07', 'VAN', 'GBE-FLT-TXA-3237-122', 'JDL', 'Delivery associate'),
  ('2145618886', '100006597', 'GBE', 'Makkah', '3PL', 'FS', 'MOHAMMED ILYA YAHYA HAROON', 'Nigeria', '569144282', 'Created', '2026-02-07', 'VAN', 'GBE-FLT-TXA-3220-150', 'JDL', 'Delivery associate'),
  ('2623975527', 'JDL', 'GBE', 'Medina', '3PL', 'FS', 'Mohamed Abdulhai Kambal Othman', 'Sudan', '545620418', 'Created', '2026-07-20', 'VAN', 'GBE-FLT-KXA-2148-170', 'JDL', 'Delivery associate'),
  ('2144047038', 'JDL', 'GBE', 'Makkah', '3PL', 'FS', 'BAKUR MOHAMMED ABUBAKAR', 'Nigeria', '580342387', 'Created', '2026-01-08', 'VAN', 'GBE-FLT-STA-2622-305', 'JDL', 'Delivery associate'),
  ('2629027562', 'JDL', 'GBE', 'Damam', '3PL', 'FS', 'AJMAL SHAHZAD MUHAMMAD ANSAR', 'Pakistan', '538634815', 'Created', '2026-09-08', 'VAN', 'GBE-FLT-KXA-2185-154', 'JDL', 'Delivery associate'),
  ('2046117384', '100006629', 'GBE', 'Makkah', '3PL', 'FS', 'HASHAM MOHAMMAD YAQOOB SULTAN AHMED', 'Pakistan', '502704062', 'Created', '2026-04-07', 'VAN', 'GBE-FLT-ZEB-8973-123', 'JDL', 'Delivery associate'),
  ('2168811582', 'SHC00254', 'SHC', 'Al khobar', '3PL', 'FS', 'Khaled Ibrahim Sale', 'Yemen', '590949620', 'Created', '2026-05-19', 'Carg', 'SHC-FLT-KJR-2655-167', 'MGF', 'Delivery associate')
) as v(identity_number, job_id, vendor_name, city_name, employee_type, contract_type, full_name, nationality, mobile_number, pns_status, date_of_hiring, vehicle_type, vehicle_plate, department, job_title)
where d.identity_number = v.identity_number;
