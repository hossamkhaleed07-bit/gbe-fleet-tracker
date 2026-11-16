// Migration 063 against a real Postgres (PGlite): FDP Automatic Fuel only for a
// day whose FINAL attendance code is P, decided for the previous Riyadh day.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const read = (p) => readFileSync(here(p), "utf8");
const STUB = read("./supabase-stub.sql");
const M061 = read("../migrations/061_automatic_fuel_amounts.sql");
const M063 = read("../migrations/063_automatic_fuel_final_attendance.sql");
const R063 = read("../migrations/063_rollback.sql");
const REPORT = read("../migrations/063_report_non_p_by_month.sql");
const REPORT_INV = read("../migrations/063_report_non_p_with_invoices.sql");

// Tables as 004/008/033/036/038/042 left them, plus a stand-in for pg_cron
// (not available in PGlite) holding the 036 schedule.
const BASE = `
create function private.app_project() returns text language sql stable
  as $$ select coalesce((select auth.jwt()) -> 'app_metadata' ->> 'project', '') $$;
create function private.is_project_supervisor() returns boolean language sql stable
  as $$ select private.app_role() = 'project_supervisor' $$;
grant execute on function private.app_project(), private.is_project_supervisor() to authenticated;

create table public.drivers (
  identity_number text primary key, full_name text, project text,
  assigned_vehicle_plate text, is_active boolean not null default true
);
create table public.automatic_fuel_allocations (
  id uuid primary key default gen_random_uuid(),
  identity_number text not null, full_name text, project text not null, vehicle_plate text,
  allocation_date date not null default current_date, amount numeric not null default 20,
  fuel_type text not null default 'automatic', source text not null default 'system',
  status text not null default 'processed' check (status in ('processed', 'failed')),
  created_at timestamptz not null default now(), processed_at timestamptz not null default now(),
  unique (identity_number, allocation_date)
);
create table public.shift_entries (
  id uuid primary key default gen_random_uuid(),
  identity_number text not null, shift_date date not null, shift_type text not null default 'start'
);
create table public.driver_attendance (
  identity_number text not null, attendance_date date not null, status text not null default 'NM',
  project text, unique (identity_number, attendance_date)
);
grant select on public.automatic_fuel_allocations, public.drivers, public.driver_attendance, public.shift_entries to authenticated;

create schema cron;
create table cron.job (jobid serial primary key, jobname text unique, schedule text, command text, active boolean default true);
create function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint language sql
  as $$ insert into cron.job (jobname, schedule, command) values (p_name, p_schedule, p_command) returning jobid $$;
create function cron.unschedule(p_name text) returns boolean language sql
  as $$ delete from cron.job where jobname = p_name returning true $$;
select cron.schedule('daily-fdp-automatic-fuel', '0 9 * * *', 'select public.allocate_daily_automatic_fuel();');

insert into public.drivers values
  ('1001', 'D1', 'FDP', 'P1', true),   -- shift form, no code       -> P
  ('1002', 'D2', 'FDP', 'P2', true),   -- nothing, day over         -> A
  ('1003', 'D3', 'FDP', 'P3', false),  -- inactive                  -> never
  ('1004', 'D4', 'FDP', 'P4', true),   -- WO entered, shift form too -> WO
  ('1005', 'D5', 'FDP', 'P5', true),   -- NM stored, shift form     -> P
  ('1006', 'D6', 'FDP', 'P6', true),   -- VM entered                -> VM
  ('1007', 'D7', 'FDP', 'P7', true),   -- P entered, no shift form  -> P
  ('1008', 'D8', 'FDP', 'P8', true),   -- NM stored, no shift form  -> A
  ('2001', 'J1', 'JDL', 'J1', true);   -- another project           -> never
`;

const USER = { sub: "00000000-0000-0000-0000-0000000000ee", email: "viewer@gbe.sa", app_metadata: { role: "admin" } };

let db;
let today;     // Riyadh "today", as the database sees it
let yesterday;

const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const allocate = (day) => (day === undefined
  ? db.query("select public.allocate_daily_automatic_fuel()")
  : db.query("select public.allocate_daily_automatic_fuel($1::date)", [day]));
const allocatedOn = async (day) => (await db.query(
  "select identity_number from public.automatic_fuel_allocations where allocation_date = $1::date order by 1", [day],
)).rows.map(r => r.identity_number);

async function rejects(promise, code) {
  let err;
  try { await promise; } catch (e) { err = e; }
  expect(err, `expected ${code}`).toBeDefined();
  expect(`${err.message} ${err.code}`).toContain(code);
}

async function seedDay(day) {
  await db.query(`
    insert into public.shift_entries (identity_number, shift_date) values
      ('1001', $1::date), ('1004', $1::date), ('1005', $1::date), ('2001', $1::date);
    `.replace(/\$1::date/g, `'${day}'::date`));
  await db.exec(`
    insert into public.driver_attendance (identity_number, attendance_date, status) values
      ('1004', '${day}', 'WO'), ('1005', '${day}', 'NM'), ('1006', '${day}', 'VM'),
      ('1007', '${day}', 'P'),  ('1008', '${day}', 'NM');
  `);
}

beforeEach(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(BASE);
  await db.exec(M061);
  await db.exec(M063);
  ({ today } = await one("select private.riyadh_today()::text as today"));
  ({ yesterday } = await one("select (private.riyadh_today() - 1)::text as yesterday"));
});

describe("final attendance code", () => {
  it("entered code wins; else a shift form = P; else a finished day = A; NM counts as no code", async () => {
    await seedDay(yesterday);
    const { rows } = await db.query(
      "select identity_number, private.auto_fuel_final_attendance(identity_number, $1::date) as code from public.drivers order by 1",
      [yesterday],
    );
    expect(Object.fromEntries(rows.map(r => [r.identity_number, r.code]))).toEqual({
      1001: "P", 1002: "A", 1003: "A", 1004: "WO", 1005: "P", 1006: "VM", 1007: "P", 1008: "A", 2001: "P",
    });
  });

  it("today is not final yet: no code and no shift form = NM", async () => {
    expect((await one("select private.auto_fuel_final_attendance('1002', $1::date) as c", [today])).c).toBe("NM");
  });
});

describe("daily allocation", () => {
  it("gives fuel only to active FDP drivers whose final code is P", async () => {
    await seedDay(yesterday);
    await allocate(yesterday);
    expect(await allocatedOn(yesterday)).toEqual(["1001", "1005", "1007"]);
  });

  it("with no date, allocates the previous Riyadh day", async () => {
    await seedDay(yesterday);
    await allocate();
    expect(await allocatedOn(yesterday)).toEqual(["1001", "1005", "1007"]);
    expect(await allocatedOn(today)).toEqual([]);
  });

  it("refuses today and future days (attendance is not final yet)", async () => {
    await rejects(allocate(today), "AUTO_FUEL_DAY_NOT_FINAL");
    const { tomorrow } = await one("select (private.riyadh_today() + 1)::text as tomorrow");
    await rejects(allocate(tomorrow), "AUTO_FUEL_DAY_NOT_FINAL");
  });

  it("keeps the 061 amounts and never touches rows already made (switch-over day)", async () => {
    await seedDay(yesterday);
    // The old 12:00 job already gave everyone fuel for that day.
    await db.query(
      "insert into public.automatic_fuel_allocations (identity_number, project, allocation_date, amount) values ('1002', 'FDP', $1::date, 20)",
      [yesterday],
    );
    await db.exec("update public.automatic_fuel_settings set default_amount = 25 where id");
    await allocate(yesterday);
    await allocate(yesterday); // a second run changes nothing
    const { rows } = await db.query(
      "select identity_number, amount::float as amount from public.automatic_fuel_allocations where allocation_date = $1::date order by 1",
      [yesterday],
    );
    expect(rows).toEqual([
      { identity_number: "1001", amount: 25 }, { identity_number: "1002", amount: 20 },
      { identity_number: "1005", amount: 25 }, { identity_number: "1007", amount: 25 },
    ]);
  });
});

describe("cron and access", () => {
  it("moves the job to 03:30 UTC (06:30 Riyadh), calling the function with no date", async () => {
    const { rows } = await db.query("select schedule, command from cron.job where jobname = 'daily-fdp-automatic-fuel'");
    expect(rows).toEqual([{ schedule: "30 3 * * *", command: "select public.allocate_daily_automatic_fuel();" }]);
  });

  it("nobody signed in can run the job or the attendance helper", async () => {
    await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(USER)]);
    await db.exec("set role authenticated");
    try {
      await rejects(db.query("select public.allocate_daily_automatic_fuel($1::date)", [yesterday]), "permission denied");
      await rejects(db.query("select private.auto_fuel_final_attendance('1001', $1::date)", [yesterday]), "permission denied");
    } finally {
      await db.exec("reset role");
    }
  });

  it("refuses to run twice", async () => {
    await rejects(db.exec(M063), "063 is already installed");
  });
});

describe("rollback", () => {
  it("restores the 12:00 job and the no-attendance allocation for today", async () => {
    await db.exec(R063);
    const { rows } = await db.query("select schedule from cron.job where jobname = 'daily-fdp-automatic-fuel'");
    expect(rows).toEqual([{ schedule: "0 9 * * *" }]);
    await db.query("select public.allocate_daily_automatic_fuel($1::date)", [today]);
    expect(await allocatedOn(today)).toEqual(["1001", "1002", "1004", "1005", "1006", "1007", "1008"]);
    expect((await one("select to_regprocedure('private.auto_fuel_final_attendance(text,date)') as f")).f).toBeNull();
  });
});

describe("report of fuel already given on non-P days", () => {
  it("counts non-P allocations per month", async () => {
    await seedDay(yesterday);
    // As the old job did: every active FDP driver got 20.
    await db.query(`
      insert into public.automatic_fuel_allocations (identity_number, project, allocation_date, amount)
      select identity_number, 'FDP', $1::date, 20 from public.drivers where project = 'FDP' and is_active`, [yesterday]);
    const [summary] = await db.exec(REPORT);
    expect(summary.rows).toEqual([{
      // 7 active FDP drivers; P = 1001, 1005, 1007; non-P = 1002 A, 1004 WO, 1006 VM, 1008 A
      month: yesterday.slice(0, 7), allocations: 7, total_sar: "140", p_days: 3, p_sar: "60", non_p_days: 4, non_p_sar: "80",
    }]);
  });
});

describe("report of non-P days with invoices (Sep–Nov 2026)", () => {
  it("splits the codes and matches PetroApp/Futurehub invoices by driver and day", async () => {
    const day = "2026-10-05";
    await seedDay(day);
    await db.query(`
      insert into public.automatic_fuel_allocations (identity_number, project, allocation_date, amount)
      select identity_number, 'FDP', $1::date, 20 from public.drivers where project = 'FDP' and is_active`, [day]);
    await db.exec(`
      insert into public.fuel_invoice_records (data_source, cost, entry_date, use_type, nid) values
        ('PetroApp',  30, '${day}', 'FDP use', '1004'),     -- WO day: fuel filled anyway
        ('Futurehub', 10, '${day}', 'DA Use',  ' 1008 '),   -- NM day, NID with spaces
        ('Other',     99, '${day}', 'FDP use', '1006'),     -- not PetroApp/Futurehub
        ('PetroApp',  50, '${day}', 'FDP use', '1001'),     -- a P day: not reported
        ('PetroApp',  40, '2026-10-06', 'FDP use', '1002'); -- another day
    `);
    const [a, b] = await db.exec(REPORT_INV);
    const codes = Object.fromEntries(
      a.rows.filter(r => r.month && r.final_code).map(r => [r.final_code, [r.days, Number(r.automatic_fuel_sar)]]),
    );
    // 1002: no row, no form; 1004 WO; 1006 VM; 1008 NM stored, no form
    expect(codes).toEqual({ WO: [1, 20], VM: [1, 20], "NM (past day)": [1, 20], "no code (past day)": [1, 20] });
    const total = b.rows.find(r => r.month === null);
    expect([
      Number(total.non_p_days), Number(total.days_with_invoice), Number(total.automatic_fuel_sar_on_those_days),
      Number(total.invoices), Number(total.invoice_sar), Number(total.invoice_sar_fdp_use),
    ]).toEqual([4, 2, 40, 2, 40, 30]);
  });
});
