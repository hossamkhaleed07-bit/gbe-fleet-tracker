-- ============================================================
-- 021_stations_confirm_sync.sql
-- Confirms the official 14-station list + rates from "Data.xlsx"
-- (Stations tab) exactly match the database. No new stations added
-- or removed — this is a verification/re-assert pass only.
-- ============================================================

update public.stations as s set
  cod_rate = v.cod_rate,
  ppd_rate = v.ppd_rate,
  pickup_rate = v.pickup_rate,
  diesel_price = v.diesel_price,
  petrol_price = v.petrol_price
from (values
  ('Saour Holding Company - GMF', 4.5, 4, 4, 1.79, 2.18),
  ('Hungerstation - Riyadh', 4.5, 4, 4, 1.79, 2.18),
  ('Hungerstation - Jeddah', 4.5, 4, 4, 1.79, 2.18),
  ('JDL - Al Manar Station', 4.5, 4, 4, 1.79, 2.18),
  ('JDL - Nakheel Station', 4.5, 4, 4, 1.79, 2.18),
  ('JDL - Makkah Station', 4.5, 4, 4, 1.79, 2.18),
  ('JDL - Medina Station', 4.5, 4, 4, 1.79, 2.18),
  ('JDL - Taif Station', 4.5, 4, 4, 1.79, 2.18),
  ('JDL - Tuwaiq station', 4.5, 4, 4, 1.79, 2.18),
  ('JDL - Sulay Station', 4.5, 4, 4, 1.79, 2.18),
  ('JDL - Khamis mushait', 4.5, 4, 4, 1.79, 2.18),
  ('iMile - Alkhurmah Station', 7, 7, 7, 1.79, 2.18),
  ('iMile - Taif Station', 6.5, 4.5, 4.5, 1.79, 2.18),
  ('SMSA - Taif Station', 6, 6, 6, 1.79, 2.18)
) as v(station_name, cod_rate, ppd_rate, pickup_rate, diesel_price, petrol_price)
where s.station_name = v.station_name;
