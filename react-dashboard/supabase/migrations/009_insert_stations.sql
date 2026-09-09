insert into public.stations (station_name)
select v.station_name from (values
('Saour Holding Company - GMF'),
('Hungerstation - Riyadh'),
('Hungerstation - Jeddah'),
('JDL - Al Manar Station'),
('JDL - Nakheel Station'),
('JDL - Makkah Station'),
('JDL - Medina Station'),
('JDL - Taif Station'),
('JDL - Tuwaiq station'),
('JDL - Sulay Station'),
('JDL - Khamis mushait'),
('iMile - Alkhurmah Station'),
('iMile - Taif Station'),
('SMSA - Taif Station'),
('JDL - Jeddah Station')
) as v(station_name)
where not exists (
  select 1 from public.stations s where s.station_name = v.station_name
);
