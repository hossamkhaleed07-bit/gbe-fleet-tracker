-- NOTE: statements that inserted/updated personal data were removed for privacy; structure kept.
alter table public.drivers add column if not exists assigned_vehicle_plate text;
