begin;

-- =====================================================================
-- 061_automatic_fuel_amounts.sql
-- Per-driver daily Automatic Fuel amounts, instead of a flat 20 for everyone.
--
--   * automatic_fuel_settings       one row: the default amount (starts at 20)
--   * automatic_fuel_driver_amounts a driver's own amount; no row = the default
--   * automatic_fuel_amount_changes the change log (who, when, old, new, reason),
--                                   append-only: the database refuses UPDATE/DELETE
--   * allocate_daily_automatic_fuel() now takes the driver's amount, else the
--     default.  The amount is copied into each allocation row when it is made,
--     so changing an amount never touches allocations already made.  The cron
--     job (daily-fdp-automatic-fuel, 12:00 Riyadh) is unchanged.
--   * one allocation (a driver-day already made) can be corrected, with a
--     required reason; the row records who corrected it and when.
--
-- Writes go only through the SECURITY DEFINER functions below, admin only.
-- Read: whoever can read automatic_fuel_allocations (admin, fleet manager,
-- viewer, FDP project supervisor).
-- Needs 036/038 (allocations + function), 050/053/056 (private.* role helpers).
-- ONE transaction: if anything fails, nothing changes.  Undo: 061_rollback.sql.
-- =====================================================================

do $$
begin
  if to_regclass('public.automatic_fuel_allocations') is null then
    raise exception 'STOP: public.automatic_fuel_allocations does not exist (run 036 and 038 first).';
  end if;
  if to_regclass('public.automatic_fuel_settings') is not null then
    raise exception 'STOP: 061 is already installed (public.automatic_fuel_settings exists).';
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 1) Tables
-- ---------------------------------------------------------------------

create table public.automatic_fuel_settings (
  id boolean primary key default true check (id),
  default_amount numeric(10,2) not null check (default_amount > 0),
  updated_by text,
  updated_at timestamptz not null default now()
);
insert into public.automatic_fuel_settings (default_amount, updated_by) values (20, 'migration 061');

create table public.automatic_fuel_driver_amounts (
  identity_number text primary key,
  amount numeric(10,2) not null check (amount > 0),
  updated_by text,
  updated_at timestamptz not null default now()
);

create table public.automatic_fuel_amount_changes (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('default', 'driver', 'allocation')),
  identity_number text,
  allocation_id uuid,
  allocation_date date,
  old_amount numeric(10,2),
  new_amount numeric(10,2),
  reason text,
  changed_by text,
  changed_at timestamptz not null default now()
);
create index automatic_fuel_amount_changes_at on public.automatic_fuel_amount_changes (changed_at desc);

alter table public.automatic_fuel_allocations
  add column if not exists adjusted_at timestamptz,
  add column if not exists adjusted_by text;


-- ---------------------------------------------------------------------
-- 2) Guards
-- ---------------------------------------------------------------------

create function private.auto_fuel_append_only() returns trigger
language plpgsql
as $$
begin
  raise exception 'AUTO_FUEL_APPEND_ONLY: % rows cannot be changed or deleted', tg_table_name
    using errcode = '42501';
end;
$$;

create trigger automatic_fuel_amount_changes_append_only before update or delete on public.automatic_fuel_amount_changes
  for each row execute function private.auto_fuel_append_only();
create trigger automatic_fuel_amount_changes_no_truncate before truncate on public.automatic_fuel_amount_changes
  for each statement execute function private.auto_fuel_append_only();

create function private.auto_fuel_require_admin() returns void
language plpgsql stable
as $$
begin
  if not coalesce(private.is_admin(), false) then
    raise exception 'AUTO_FUEL_ADMIN_ONLY' using errcode = '42501';
  end if;
end;
$$;

create function private.auto_fuel_actor() returns text
language sql stable
as $$ select coalesce(auth.jwt() ->> 'email', 'system') $$;


-- ---------------------------------------------------------------------
-- 3) Daily allocation: the driver's own amount, else the default
-- ---------------------------------------------------------------------

create or replace function public.allocate_daily_automatic_fuel(p_date date default current_date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.automatic_fuel_allocations (identity_number, full_name, project, vehicle_plate, allocation_date, amount)
  select d.identity_number, d.full_name, d.project, d.assigned_vehicle_plate, p_date,
         coalesce(da.amount, (select s.default_amount from public.automatic_fuel_settings s), 20)
  from public.drivers d
  left join public.automatic_fuel_driver_amounts da on da.identity_number = d.identity_number
  where d.project = 'FDP'
    and d.is_active = true
  on conflict (identity_number, allocation_date) do nothing;
end;
$$;


-- ---------------------------------------------------------------------
-- 4) Operations (admin only; each call is one transaction)
-- ---------------------------------------------------------------------

create function public.auto_fuel_set_default(p_amount numeric)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare v_old numeric;
begin
  perform private.auto_fuel_require_admin();
  if p_amount is null or p_amount <= 0 then
    raise exception 'AUTO_FUEL_AMOUNT_MUST_BE_POSITIVE' using errcode = '22023';
  end if;
  select default_amount into v_old from public.automatic_fuel_settings for update;
  if v_old = p_amount then return p_amount; end if;
  update public.automatic_fuel_settings
     set default_amount = p_amount, updated_by = private.auto_fuel_actor(), updated_at = now();
  insert into public.automatic_fuel_amount_changes (kind, old_amount, new_amount, changed_by)
  values ('default', v_old, p_amount, private.auto_fuel_actor());
  return p_amount;
end;
$$;

-- p_amount null = remove the driver's own amount (back to the default).
create function public.auto_fuel_set_driver_amount(p_identity_number text, p_amount numeric)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare v_old numeric;
begin
  perform private.auto_fuel_require_admin();
  if p_amount is not null and p_amount <= 0 then
    raise exception 'AUTO_FUEL_AMOUNT_MUST_BE_POSITIVE' using errcode = '22023';
  end if;
  if not exists (select 1 from public.drivers where identity_number = p_identity_number) then
    raise exception 'AUTO_FUEL_UNKNOWN_DRIVER' using errcode = '22023';
  end if;
  select amount into v_old from public.automatic_fuel_driver_amounts where identity_number = p_identity_number for update;
  if v_old is not distinct from p_amount then return p_amount; end if;
  if p_amount is null then
    delete from public.automatic_fuel_driver_amounts where identity_number = p_identity_number;
  else
    insert into public.automatic_fuel_driver_amounts (identity_number, amount, updated_by, updated_at)
    values (p_identity_number, p_amount, private.auto_fuel_actor(), now())
    on conflict (identity_number) do update
      set amount = excluded.amount, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  end if;
  insert into public.automatic_fuel_amount_changes (kind, identity_number, old_amount, new_amount, changed_by)
  values ('driver', p_identity_number, v_old, p_amount, private.auto_fuel_actor());
  return p_amount;
end;
$$;

-- Corrects one allocation already made.  The reason is required.
create function public.auto_fuel_adjust_allocation(p_allocation_id uuid, p_amount numeric, p_reason text)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.automatic_fuel_allocations;
begin
  perform private.auto_fuel_require_admin();
  if p_amount is null or p_amount <= 0 then
    raise exception 'AUTO_FUEL_AMOUNT_MUST_BE_POSITIVE' using errcode = '22023';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'AUTO_FUEL_REASON_REQUIRED' using errcode = '22023';
  end if;
  select * into v_row from public.automatic_fuel_allocations where id = p_allocation_id for update;
  if not found then
    raise exception 'AUTO_FUEL_UNKNOWN_ALLOCATION' using errcode = '22023';
  end if;
  if v_row.amount = p_amount then return p_amount; end if;
  update public.automatic_fuel_allocations
     set amount = p_amount, adjusted_at = now(), adjusted_by = private.auto_fuel_actor()
   where id = p_allocation_id;
  insert into public.automatic_fuel_amount_changes (kind, identity_number, allocation_id, allocation_date, old_amount, new_amount, reason, changed_by)
  values ('allocation', v_row.identity_number, v_row.id, v_row.allocation_date, v_row.amount, p_amount, btrim(p_reason), private.auto_fuel_actor());
  return p_amount;
end;
$$;


-- ---------------------------------------------------------------------
-- 5) Access
-- ---------------------------------------------------------------------

create function private.auto_fuel_can_read() returns boolean
language sql stable
as $$
  select coalesce(private.is_admin(), false)
      or coalesce(private.is_fleet_manager(), false)
      or coalesce(private.is_viewer(), false)
      or (coalesce(private.is_project_supervisor(), false) and private.app_project() = 'FDP')
$$;

alter table public.automatic_fuel_settings enable row level security;
alter table public.automatic_fuel_driver_amounts enable row level security;
alter table public.automatic_fuel_amount_changes enable row level security;

create policy "read automatic_fuel_settings" on public.automatic_fuel_settings
  for select to authenticated using (private.auto_fuel_can_read());
create policy "read automatic_fuel_driver_amounts" on public.automatic_fuel_driver_amounts
  for select to authenticated using (private.auto_fuel_can_read());
create policy "read automatic_fuel_amount_changes" on public.automatic_fuel_amount_changes
  for select to authenticated using (private.auto_fuel_can_read());

-- Read only: every write goes through the functions above.
revoke all on public.automatic_fuel_settings, public.automatic_fuel_driver_amounts, public.automatic_fuel_amount_changes
  from public, anon, authenticated;
grant select on public.automatic_fuel_settings, public.automatic_fuel_driver_amounts, public.automatic_fuel_amount_changes
  to authenticated;

revoke all on function private.auto_fuel_append_only(), private.auto_fuel_require_admin(), private.auto_fuel_actor(),
  private.auto_fuel_can_read() from public, anon;
grant execute on function private.auto_fuel_require_admin(), private.auto_fuel_actor(), private.auto_fuel_can_read() to authenticated;

revoke all on function public.auto_fuel_set_default(numeric), public.auto_fuel_set_driver_amount(text, numeric),
  public.auto_fuel_adjust_allocation(uuid, numeric, text) from public, anon;
grant execute on function public.auto_fuel_set_default(numeric), public.auto_fuel_set_driver_amount(text, numeric),
  public.auto_fuel_adjust_allocation(uuid, numeric, text) to authenticated;

-- The daily job only: nobody signed in can trigger an allocation.
revoke all on function public.allocate_daily_automatic_fuel(date) from public, anon, authenticated;

commit;
