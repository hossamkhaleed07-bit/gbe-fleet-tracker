do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.vehicles'::regclass and contype = 'u'
      and array_to_string(conkey, ',') = (
        select attnum::text from pg_attribute
        where attrelid = 'public.vehicles'::regclass and attname = 'vehicle_plate'
      )
  ) then
    alter table public.vehicles add constraint vehicles_vehicle_plate_key unique (vehicle_plate);
  end if;
end $$;

insert into public.vehicles (vehicle_plate, vehicle_vendor, fuel_type, avg_per_liter, model) values
('GBE-FLT-DXA-3018-3', 'GBE', '91', 10, 'LiteAce'),
('GBE-FLT-NTB-9213-4', 'GBE', '91', 10, 'LiteAce'),
('GBE-FLT-DXA-3020-5', 'GBE', '91', 10, 'LiteAce'),
('GBE-FLT-DXA-3015-6', 'GBE', '91', 10, 'LiteAce'),
('GBE-FLT-NTB-9203-7', 'GBE', '91', 10, 'LiteAce'),
('GBE-FLT-NTB-9216-10', 'GBE', '91', 10, 'LiteAce'),
('GBE-FLT-DXA-3017-13', 'GBE', '91', 10, 'LiteAce'),
('GBE-FLT-TXA-1156-36', 'GBE', '91', 13, 'Dzire'),
('GBE-FLT-DXA-3502-59', 'GBE', 'Diesel', 7, 'Dyna'),
('GBE-FLT-LSB-9545-75', 'LAFASTA', 'Diesel', 7, 'Hiace'),
('GBE-FLT-SXB-8102-77', 'LAFASTA', 'Diesel', 7, 'Hiace'),
('GBE-FLT-SXB-8106-79', 'LAFASTA', 'Diesel', 7, 'Hiace'),
('GBE-FLT-LSB-9542-80', 'LAFASTA', 'Diesel', 7, 'Hiace'),
('GBE-FLT-BTA-5034-84', 'GBE', '91', 12, 'i10'),
('GBE-FLT-BTA-5039-85', 'GBE', '91', 12, 'i10'),
('GBE-FLT-BTA-5035-86', 'GBE', '91', 12, 'i10'),
('GBE-FLT-BTA-5036-87', 'GBE', '91', 12, 'i10'),
('GBE-FLT-BTA-5041-88', 'GBE', '91', 12, 'i10'),
('GBE-FLT-BTA-5846-89', 'GBE', '91', 12, 'i10'),
('GBE-FLT-BTA-5040-90', 'GBE', '91', 12, 'i10'),
('GBE-FLT-BTA-5038-91', 'GBE', '91', 12, 'i10'),
('GBE-FLT-BTA-5037-92', 'GBE', '91', 12, 'i10'),
('GBE-FLT-BTA-5042-93', 'GBE', '91', 12, 'i10'),
('GBE-FLT-TXA-3235-105', 'JDL', 'Diesel', 8, 'Master'),
('GBE-FLT-KXA-2145-106', 'JDL', 'Diesel', 8, 'Master'),
('GBE-FLT-JTA-9913-107', 'JDL', 'Diesel', 8, 'Master'),
('GBE-FLT-JTA-9912-108', 'JDL', 'Diesel', 8, 'Master'),
('GBE-FLT-TXA-3236-109', 'JDL', 'Diesel', 8, 'Master'),
('GBE-FLT-JTA-9938-111', 'JDL', 'Diesel', 8, 'Master'),
('GBE-FLT-JTA-9940-112', 'JDL', 'Diesel', 8, 'Master'),
('GBE-FLT-GGB-6560-113', 'JDL', 'Diesel', 9, 'Touring'),
('GBE-FLT-DGB-2699-115', 'JDL', 'Diesel', 9, 'Touring'),
('GBE-FLT-JTA-9935-116', 'JDL', 'Diesel', 8, 'Master'),
('GBE-FLT-TXA-3257-117', 'JDL', 'Diesel', 8, 'Master'),
('GBE-FLT-TXA-3261-118', 'JDL', 'Diesel', 8, 'Master'),
('GBE-FLT-ZEB-8975-119', 'JDL', 'Diesel', 8, 'Master'),
('GBE-FLT-TXA-3233-120', 'JDL', 'Diesel', 8, 'Master'),
('GBE-FLT-GGB-5139-121', 'JDL', 'Diesel', 8, 'Master'),
('GBE-FLT-TXA-3237-122', 'JDL', 'Diesel', 8, 'Master'),
('GBE-FLT-ZEB-8973-123', 'JDL', 'Diesel', 12, 'Eccho'),
('GBE-FLT-JTA-9910-124', 'JDL', 'Diesel', 8, 'Master'),
('GBE-FLT-TXA-3239-126', 'JDL', 'Diesel', 8, 'Master'),
('GBE-FLT-HHR-8522-127', 'JDL', '91', 12, 'i10'),
('GBE-FLT-STA-2906-128', 'JDL', 'Diesel', 8, 'Master'),
('GBE-FLT-KXA-2158-130', 'JDL', 'Diesel', 8, 'Master'),
('GBE-FLT-KXA-2177-131', 'JDL', 'Diesel', 8, 'Master'),
('GBE-FLT-KXA-2194-132', 'JDL', 'Diesel', 8, 'Master'),
('GBE-FLT-LSA-7402-133', 'JDL', 'Diesel', 7, 'Urvan'),
('GBE-FLT-STA-2913-134', 'JDL', 'Diesel', 8, 'Master'),
('GBE-FLT-TXA-3213-135', 'JDL', 'Diesel', 8, 'Master'),
('GBE-FLT-XAS-2311-137', 'QCR', '91', 12, 'i10'),
('GBE-FLT-NBS-3493-138', 'QCR', '91', 12, 'i10'),
('GBE-FLT-ZRS-1205-139', 'QCR', '91', 12, 'i10'),
('GBE-FLT-LRS-4596-140', 'QCR', '91', 12, 'i10'),
('GBE-FLT-LRS-4582-141', 'QCR', '91', 12, 'i10'),
('GBE-FLT-HBS-1008-142', 'QCR', '91', 12, 'i10'),
('GBE-FLT-LRS-4583-143', 'QCR', '91', 12, 'i10'),
('GBE-FLT-KXA-2188-144', 'JDL', 'Diesel', 8, 'Master'),
('GBE-FLT-ZXA-4945-145', 'JDL', 'Diesel', 9, 'Staria'),
('GBE-FLT-LRS-4722-146', 'QCR', '91', 12, 'i10'),
('GBE-FLT-DXA-8006-147', 'JDL', 'Diesel', 7, 'Hiace'),
('GBE-FLT-TXA-3258-148', 'JDL', 'Diesel', 8, 'Master'),
('GBE-FLT-DGB-2707-149', 'JDL', 'Diesel', 9, 'Touring'),
('GBE-FLT-TXA-3220-150', 'JDL', 'Diesel', 8, 'Master'),
('GBE-FLT-STA-2912-151', 'JDL', 'Diesel', 8, 'Master'),
('GBE-FLT-STA-2909-152', 'JDL', 'Diesel', 8, 'Master'),
('GBE-FLT-ZXA-4944-153', 'JDL', 'Diesel', 9, 'Staria'),
('GBE-FLT-KXA-2185-154', 'JDL', 'Diesel', 8, 'Master'),
('GBE-FLT-NTB-9215-9', 'GBE', '91', 10, 'LiteAce'),
('GBE-FLT-BXA-4801-155', 'JDL', 'Diesel', 7, 'Hiace'),
('GBE-FLT-DXA-3210-156', 'JDL', 'Diesel', 7, 'Hiace')
on conflict (vehicle_plate) do update set vehicle_vendor=excluded.vehicle_vendor, fuel_type=excluded.fuel_type, avg_per_liter=excluded.avg_per_liter, model=excluded.model;

-- عربيات موجودة في اللستة اللي بعتيها بس مفيهاش معدل استهلاك (rate) في شيت Rate
-- بتتضاف بس بلوحة العربية عشان تظهر في الـ dropdown، وتقدري تضيفي المعدل بتاعها بعدين من Table Editor
insert into public.vehicles (vehicle_plate) values
('GBE-FLT-STA-2905-129'),
('GBE-FLT-STA-1192-168'),
('GBE-FLT-ZTA-9105-169'),
('GBE-FLT-STA-1183-172'),
('GBE-FLT-ZTA-9140-171'),
('GBE-FLT-XHA-1676-166'),
('GBE-FLT-JTA-9941-157'),
('GBE-FLT-KXA-2148-170'),
('GBE-FLT-STA-2622-305'),
('SHC-FLT-KJR-2655-167')
on conflict (vehicle_plate) do nothing;
