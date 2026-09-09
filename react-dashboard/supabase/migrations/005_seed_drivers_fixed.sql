alter table public.drivers enable row level security;

drop policy if exists "anon can view drivers" on public.drivers;
create policy "anon can view drivers" on public.drivers for select to anon using (true);
grant select on public.drivers to anon;

drop policy if exists "authenticated can view drivers" on public.drivers;
create policy "authenticated can view drivers" on public.drivers for select to authenticated using (true);
grant select on public.drivers to authenticated;

insert into public.drivers (identity_number, full_name, nationality, mobile_number)
select * from (values
('2633654682', 'Osama Omar Mohamed Amin', 'Sudan', '573550129'),
('2493281246', 'MUAAAMAR SADEQ ALI MOHAMMED AL SHEHARI', 'Yemen', '547275504'),
('2373494505', 'Ousman Daoud Leham Kone', 'Mali', '563076546'),
('2545740710', 'OMAR MUHAMMED MAWLANA GULAM', 'Bangladesh', '537156057'),
('2209243712', 'Yasser Dal Mohammed Mohammed', 'Pakistan', '503318460'),
('2478725571', 'Suhail Abdu Al Bashir', 'Sudan', '551354517'),
('2597655642', 'Ahmed Al Sadiq Mohamed', 'Sudan', '560202970'),
('2478176270', 'Imran Ahmed', 'Bangladesh', '503647845'),
('2440841183', 'Mohamed Saif Aldin Ahmed Mohamed', 'Sudan', '544307922'),
('2411231901', 'Idris Muhammad Idris Yacoub', 'Sudan', '535740717'),
('2517070245', 'Shoaib Shahid Muhammad Shahid Iqbal', 'Pakistan', '550970655'),
('2523468854', 'Khalil Ali Mohammed Saleh Al Daghbashi', 'Yemen', '546905160'),
('2603268810', 'Sidr Rahman Rakib', 'Pakistan', '554202649'),
('2624520058', 'Mehedi Hasan Robin', 'Bangladesh', '536838145'),
('2624520066', 'Md Alomgir Hosen', 'Bangladesh', '538573165'),
('2622057210', 'Ikhtiaz Hossain Tanvir', 'Bangladesh', '571270544'),
('2624019366', 'Md Naiem Hossen', 'Bangladesh', '530394739'),
('2623843170', 'MD Rubel Pramanik', 'Bangladesh', '575456587'),
('2624520215', 'MD Mominur Isla', 'Bangladesh', '538626192'),
('2621479241', 'MD Rohan Miah', 'Bangladesh', '505767959'),
('2622009583', 'Mohamed Zaidal Islam', 'Bangladesh', '511469683'),
('2622858559', 'Liton Md Salauddin', 'Bangladesh', '575200367'),
('2622846752', 'Md Suzon Suzon', 'Bangladesh', '574652001'),
('2522444146', 'Mohamed Ali bin Khams Belhafi', 'Tunisia', '594612472'),
('2583022161', 'Mohammed Hassan Mahboub', 'Egypt', '570526013'),
('2449955117', 'Hashim Abdelraziq Ali', 'Yemen', '536214308'),
('2624520082', 'MD MOBASIRUL ISLAM', 'Bangladesh', '538544875'),
('2625168055', 'Md Mithu Pramanik', 'Bangladesh', '533749501'),
('2625119371', 'Md Hasib Miah', 'Bangladesh', '553717895'),
('2625260837', 'Shajiduzzaman Shamsul Alam', 'Bangladesh', '563436198'),
('2590917460', 'Mohamed Alfred Abu Baker Mohamed Khier', 'Sudan', '0'),
('2130114420', 'MIRZA AKBAR', 'Pakistan', '551057292'),
('2570515078', 'Babar khan yousaf khan', 'Pakistan', '562314163'),
('2632593576', 'Mohammad ali omar Mohammad', 'Sudan', '546816629'),
('2097453308', 'FARUQ ATIF', 'Palestinian', '0566342733'),
('2145618886', 'MOHAMMED ILYA YAHYA HAROON', 'Nigeria', '569144282'),
('2623975527', 'Mohamed Abdulhai Kambal Othman', 'Sudan', '545620418'),
('2144047038', 'BAKUR MOHAMMED ABUBAKAR', 'Nigeria', '580342387'),
('2629027562', 'AJMAL SHAHZAD MUHAMMAD ANSAR', 'Pakistan', '538634815'),
('2046117384', 'HASHAM MOHAMMAD YAQOOB SULTAN AHMED', 'Pakistan', '502704062'),
('2168811582', 'Khaled Ibrahim Sale', 'Yemen', '590949620')
) as v(identity_number, full_name, nationality, mobile_number)
where not exists (select 1 from public.drivers d where d.identity_number = v.identity_number);
