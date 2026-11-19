// Migration 064 against a real Postgres (PGlite): void / restore an Automatic Fuel
// day (admin only, past days only, reason >= 10 chars, all or nothing, logged), and
// the review list of automatic fuel days without a matching PetroApp/Futurehub
// invoice, counting approved reinforcement in what the invoice has to cover.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const read = (p) => readFileSync(here(p), "utf8");
const STUB = read("./supabase-stub.sql");
const M061 = read("../migrations/061_automatic_fuel_amounts.sql");
const M063 = read("../migrations/063_automatic_fuel_final_attendance.sql");
const M064 = read("../migrations/064_automatic_fuel_void.sql");
const R064 = read("../migrations/064_rollback.sql");
const REPORT = read("../migrations/063_report_non_p_by_month.sql");
const REPORT_INV = read("../migrations/063_report_non_p_with_invoices.sql");

// Tables as 004/008/022/023/026/033/036/038/042 left them, plus a pg_cron stand-in.
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
alter table public.automatic_fuel_allocations enable row level security;
create policy "scoped select automatic_fuel_allocations" on public.automatic_fuel_allocations
  for select to authenticated using (private.is_admin() or private.is_fleet_manager() or private.is_viewer());
create table public.shift_entries (
  id uuid primary key default gen_random_uuid(),
  identity_number text not null, shift_date date not null, shift_type text not null default 'start'
);
create table public.driver_attendance (
  identity_number text not null, attendance_date date not null, status text not null default 'NM',
  project text, unique (identity_number, attendance_date)
);
create table public.reinforcement_requests (
  id uuid primary key default gen_random_uuid(),
  identity_number text not null, full_name text, vehicle_plate text, amount numeric,
  loan_adjustment numeric, shift_date date not null default current_date,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected'))
);
grant select on public.automatic_fuel_allocations, public.drivers, public.driver_attendance,
  public.shift_entries, public.reinforcement_requests to authenticated;

create schema cron;
create table cron.job (jobid serial primary key, jobname text unique, schedule text, command text, active boolean default true);
create function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint language sql
  as $$ insert into cron.job (jobname, schedule, command) values (p_name, p_schedule, p_command) returning jobid $$;
create function cron.unschedule(p_name text) returns boolean language sql
  as $$ delete from cron.job where jobname = p_name returning true $$;
select cron.schedule('daily-fdp-automatic-fuel', '0 9 * * *', 'select public.allocate_daily_automatic_fuel();');

insert into public.drivers (identity_number, full_name, project, assigned_vehicle_plate)
select n::text, 'D' || n, 'FDP', 'P' || n from generate_series(1001, 1007) n;
`;

const USERS = {
  admin: { sub: "00000000-0000-0000-0000-00000000000a", email: "admin@gbe.sa", app_metadata: { role: "admin" } },
  fleet: { sub: "00000000-0000-0000-0000-00000000000f", email: "fleet@gbe.sa", app_metadata: { role: "fleet_manager" } },
  viewer: { sub: "00000000-0000-0000-0000-0000000000ee", email: "viewer@gbe.sa", app_metadata: { role: "viewer" } },
};
const REASON = "Not withdrawn from PetroApp";

let db;
let today;
let yesterday;

const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];

async function as(user, sql, params = []) {
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(USERS[user])]);
  await db.exec("set role authenticated");
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claims', '', false)");
  }
}

async function rejects(promise, code) {
  let err;
  try { await promise; } catch (e) { err = e; }
  expect(err, `expected ${code}`).toBeDefined();
  expect(`${err.message} ${err.code}`).toContain(code);
}

async function allocation(idn, day, amount = 30) {
  return (await one(
    "insert into public.automatic_fuel_allocations (identity_number, full_name, project, allocation_date, amount) values ($1, 'D', 'FDP', $2::date, $3) returning id",
    [idn, day, amount],
  )).id;
}

const voidRows = (ids, reason = REASON, user = "admin") =>
  as(user, "select public.auto_fuel_void_allocations($1::uuid[], $2) as n", [ids, reason]);
const restore = (id, reason = "Driver did withdraw it", user = "admin") =>
  as(user, "select public.auto_fuel_restore_allocation($1::uuid, $2) as amount", [id, reason]);
const voided = async () => (await db.query(
  "select identity_number, allocation_date::text as day from public.automatic_fuel_allocations where voided_at is not null order by 1, 2",
)).rows;

beforeEach(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(BASE);
  await db.exec(M061);
  await db.exec(M063);
  await db.exec(M064);
  ({ today } = await one("select private.riyadh_today()::text as today"));
  ({ yesterday } = await one("select (private.riyadh_today() - 1)::text as yesterday"));
});

describe("void", () => {
  it("voids several past days in one call, keeps the rows, records who/when/why and logs each", async () => {
    const a = await allocation("1001", "2026-10-05");
    const b = await allocation("1002", "2026-10-06", 25);
    expect((await voidRows([a, b, a], `  ${REASON}  `)).rows[0].n).toBe(2);
    const { rows } = await db.query(
      "select identity_number, voided_by, void_reason, voided_at is not null as has_time, amount::float as amount from public.automatic_fuel_allocations order by 1",
    );
    expect(rows).toEqual([
      { identity_number: "1001", voided_by: "admin@gbe.sa", void_reason: REASON, has_time: true, amount: 30 },
      { identity_number: "1002", voided_by: "admin@gbe.sa", void_reason: REASON, has_time: true, amount: 25 },
    ]);
    const log = await db.query(
      "select kind, identity_number, old_amount::float as old, new_amount::float as new, reason, changed_by from public.automatic_fuel_amount_changes order by identity_number",
    );
    expect(log.rows).toEqual([
      { kind: "void", identity_number: "1001", old: 30, new: 0, reason: REASON, changed_by: "admin@gbe.sa" },
      { kind: "void", identity_number: "1002", old: 25, new: 0, reason: REASON, changed_by: "admin@gbe.sa" },
    ]);
  });

  it("skips days already voided (no second log row)", async () => {
    const a = await allocation("1001", "2026-10-05");
    await voidRows([a]);
    expect((await voidRows([a])).rows[0].n).toBe(0);
    expect((await one("select count(*)::int as n from public.automatic_fuel_amount_changes")).n).toBe(1);
  });

  it("needs a reason of at least 10 characters", async () => {
    const a = await allocation("1001", "2026-10-05");
    for (const bad of ["", "   ", "too short", "  123456789  ", null]) {
      await rejects(voidRows([a], bad), "AUTO_FUEL_REASON_TOO_SHORT");
    }
    expect(await voided()).toEqual([]);
  });

  it("only past days: today or later is refused, and then nothing at all is voided", async () => {
    const past = await allocation("1001", yesterday);
    const now = await allocation("1002", today);
    await rejects(voidRows([past, now]), "AUTO_FUEL_VOID_PAST_DAYS_ONLY");
    expect(await voided()).toEqual([]);
    expect((await voidRows([past])).rows[0].n).toBe(1);
  });

  it("an unknown id or an empty list voids nothing", async () => {
    const a = await allocation("1001", "2026-10-05");
    await rejects(voidRows([a, "00000000-0000-0000-0000-000000000099"]), "AUTO_FUEL_UNKNOWN_ALLOCATION");
    await rejects(voidRows([]), "AUTO_FUEL_NO_ROWS");
    expect(await voided()).toEqual([]);
  });

  it("admin only; nobody can write the columns directly; the database checks the reason too", async () => {
    const a = await allocation("1001", "2026-10-05");
    await rejects(voidRows([a], REASON, "fleet"), "AUTO_FUEL_ADMIN_ONLY");
    await rejects(voidRows([a], REASON, "viewer"), "AUTO_FUEL_ADMIN_ONLY");
    await rejects(as("admin", "update public.automatic_fuel_allocations set voided_at = now() where id = $1", [a]), "permission denied");
    await rejects(db.query("update public.automatic_fuel_allocations set voided_at = now(), void_reason = 'short' where id = $1", [a]), "automatic_fuel_allocations_void_check");
    expect(await voided()).toEqual([]);
  });

  it("the daily job never gives a voided day again", async () => {
    await db.exec(`insert into public.shift_entries (identity_number, shift_date) values ('1001', '${yesterday}')`);
    await db.query("select public.allocate_daily_automatic_fuel($1::date)", [yesterday]);
    const { id } = await one("select id from public.automatic_fuel_allocations where identity_number = '1001'");
    await voidRows([id]);
    await db.query("select public.allocate_daily_automatic_fuel($1::date)", [yesterday]);
    expect((await one("select count(*)::int as n, bool_and(voided_at is not null) as v from public.automatic_fuel_allocations")))
      .toEqual({ n: 1, v: true });
  });

  it("a voided day cannot be corrected (restore it first)", async () => {
    const a = await allocation("1001", "2026-10-05");
    await voidRows([a]);
    await rejects(as("admin", "select public.auto_fuel_adjust_allocation($1::uuid, 15, 'half day')", [a]), "AUTO_FUEL_ALLOCATION_VOIDED");
  });
});

describe("restore", () => {
  it("puts a voided day back, clears the columns and logs it", async () => {
    const a = await allocation("1001", "2026-10-05");
    await voidRows([a]);
    expect(Number((await restore(a)).rows[0].amount)).toBe(30);
    expect(await one("select voided_at, voided_by, void_reason from public.automatic_fuel_allocations"))
      .toEqual({ voided_at: null, voided_by: null, void_reason: null });
    const { rows } = await db.query("select kind, old_amount::float as old, new_amount::float as new from public.automatic_fuel_amount_changes order by changed_at, kind desc");
    expect(rows).toEqual([{ kind: "void", old: 30, new: 0 }, { kind: "restore", old: 0, new: 30 }]);
    await as("admin", "select public.auto_fuel_adjust_allocation($1::uuid, 15, 'half day')", [a]);
  });

  it("refuses a day that is not voided, a short reason, and anyone but the admin", async () => {
    const a = await allocation("1001", "2026-10-05");
    await rejects(restore(a), "AUTO_FUEL_NOT_VOIDED");
    await voidRows([a]);
    await rejects(restore(a, "short"), "AUTO_FUEL_REASON_TOO_SHORT");
    await rejects(restore(a, "Driver did withdraw it", "fleet"), "AUTO_FUEL_ADMIN_ONLY");
    await rejects(restore("00000000-0000-0000-0000-000000000099"), "AUTO_FUEL_UNKNOWN_ALLOCATION");
    expect(await voided()).toEqual([{ identity_number: "1001", day: "2026-10-05" }]);
  });
});

describe("review list: automatic fuel without a matching invoice", () => {
  const D = "2026-10-10";
  const review = (from = "2026-10-01", to = "2026-10-31", user = "admin") =>
    as(user, "select * from public.auto_fuel_invoice_review($1::date, $2::date)", [from, to]);

  beforeEach(async () => {
    await db.exec(`
      insert into public.shift_entries (identity_number, shift_date) values ('1001', '${D}');
      insert into public.driver_attendance (identity_number, attendance_date, status) values ('1004', '${D}', 'WO');
      insert into public.reinforcement_requests (identity_number, shift_date, amount, loan_adjustment, status) values
        ('1002', '${D}', 60, -10, 'approved'),   -- approved 50
        ('1004', '${D}', 100, null, 'pending'),  -- not approved: not counted
        ('1005', '${D}', 100, null, 'rejected');
      insert into public.fuel_invoice_records (data_source, cost, entry_date, nid) values
        ('PetroApp',  30, '${D}', '1001'),          -- exactly covers                 -> matched
        ('PetroApp',  60, '${D}', ' 1002 '),        -- 60 < 0.9 * (30 + 50)           -> partial
        ('Futurehub', 60, '2026-10-11', '1003'),    -- 2 x 30 the next day            -> combined
        ('Other',     30, '${D}', '1004'),          -- not PetroApp/Futurehub         -> no invoice
        ('PetroApp',  10, '2026-10-09', '1005'),    -- small fill the day before      -> partial
        ('PetroApp',  28, '2026-10-12', '1006'),    -- within 10%                     -> matched
        ('PetroApp',  99, '2026-10-13', '9999');    -- last loaded invoice day = 10-13
    `);
    for (const idn of ["1001", "1002", "1003", "1004", "1005", "1007"]) await allocation(idn, D);
    await allocation("1003", "2026-10-11");
    await allocation("1006", "2026-10-12");
    await allocation("1006", "2026-10-13");   // the day after is not loaded yet
    await allocation("1006", "2026-10-20");   // well after the last invoice
    const { id } = await one("select id from public.automatic_fuel_allocations where identity_number = '1007'");
    await voidRows([id]);                      // voided: never listed
  });

  it("classifies every day; matched days are not returned", async () => {
    const { rows } = await review();
    const got = rows.map(r => [
      r.identity_number, r.allocation_date.toISOString().slice(0, 10), r.status, r.attendance_code,
      Number(r.automatic_fuel), Number(r.reinforcement), Number(r.need),
      Number(r.invoice_prev), Number(r.invoice_day), Number(r.invoice_next),
      r.related_date && r.related_date.toISOString().slice(0, 10),
    ]).sort((x, y) => (x[0] + x[1]).localeCompare(y[0] + y[1]));
    expect(got).toEqual([
      ["1002", D, "partial_invoice", "A", 30, 50, 80, 0, 60, 0, null],
      ["1003", D, "combined_fill", "A", 30, 0, 30, 0, 0, 60, "2026-10-11"],
      ["1004", D, "no_invoice", "WO", 30, 0, 30, 0, 0, 0, null],
      ["1005", D, "partial_invoice", "A", 30, 0, 30, 10, 0, 0, null],
      ["1006", "2026-10-13", "not_loaded", "A", 30, 0, 30, 28, 0, 0, null],
      ["1006", "2026-10-20", "not_loaded", "A", 30, 0, 30, 0, 0, 0, null],
    ]);
    expect(rows.every(r => r.last_invoice_date.toISOString().slice(0, 10) === "2026-10-13")).toBe(true);
  });

  it("reinforcement raises what the invoice must cover; enough invoice = matched", async () => {
    await db.exec(`insert into public.fuel_invoice_records (data_source, cost, entry_date, nid) values ('PetroApp', 15, '${D}', '1002')`);
    // 75 >= 0.9 * 80
    expect((await review()).rows.map(r => r.identity_number)).not.toContain("1002");
  });

  it("a combined fill must cover both days' needs, including the next day's reinforcement", async () => {
    await db.exec(`insert into public.reinforcement_requests (identity_number, shift_date, amount, status) values ('1003', '2026-10-11', 40, 'approved')`);
    // next day needs 30 + 40; 60 covers neither (60 < 0.9 * 100) -> partial, and the next day itself is partial too
    const rows = (await review()).rows.filter(r => r.identity_number === "1003");
    expect(rows.map(r => [r.allocation_date.toISOString().slice(0, 10), r.status]).sort())
      .toEqual([["2026-10-10", "partial_invoice"], ["2026-10-11", "partial_invoice"]]);
  });

  it("only the range asked for, past days only; admin only; a bad range is refused", async () => {
    expect((await review(D, D)).rows.map(r => r.identity_number).sort()).toEqual(["1002", "1003", "1004", "1005"]);
    await allocation("1001", today);
    expect((await review(today, today)).rows).toEqual([]);
    await rejects(review(undefined, undefined, "fleet"), "AUTO_FUEL_ADMIN_ONLY");
    await rejects(review("2026-10-31", "2026-10-01"), "AUTO_FUEL_BAD_RANGE");
    await rejects((async () => {
      await db.exec("set role anon");
      try { await db.query("select * from public.auto_fuel_invoice_review('2026-10-01', '2026-10-31')"); } finally { await db.exec("reset role"); }
    })(), "permission denied");
  });

  it("with no invoices loaded at all, every day is 'not loaded yet'", async () => {
    await db.exec("delete from public.fuel_invoice_records");
    const { rows } = await review();
    expect(new Set(rows.map(r => r.status))).toEqual(new Set(["not_loaded"]));
  });
});

describe("totals and reports skip voided days", () => {
  it("063 reports leave voided days out", async () => {
    const day = "2026-10-05";
    const ids = [];
    for (const idn of ["1001", "1002", "1003"]) ids.push(await allocation(idn, day, 20));
    await db.exec(`insert into public.fuel_invoice_records (data_source, cost, entry_date, nid) values ('PetroApp', 20, '${day}', '1002')`);
    await voidRows([ids[1]]);
    const [summary] = await db.exec(REPORT);
    expect(summary.rows.map(r => [r.allocations, Number(r.total_sar)])).toEqual([[2, 40]]);
    const [, b] = await db.exec(REPORT_INV);
    const total = b.rows.find(r => r.month === null);
    expect([Number(total.non_p_days), Number(total.days_with_invoice)]).toEqual([2, 0]);
  });
});

describe("install and rollback", () => {
  it("refuses to run twice", async () => {
    await rejects(db.exec(M064), "064 is already installed");
  });

  it("rollback refuses while a day is voided; after restoring, it removes 064 and the 061 correction still works", async () => {
    const a = await allocation("1001", "2026-10-05");
    await voidRows([a]);
    await rejects(db.exec(R064), "are voided");
    await db.exec("rollback"); // the refused script left its transaction open
    expect(await voided()).toEqual([{ identity_number: "1001", day: "2026-10-05" }]);
    await restore(a);
    await db.exec(R064);
    expect((await one("select count(*)::int as n from information_schema.columns where table_name = 'automatic_fuel_allocations' and column_name like 'void%'")).n).toBe(0);
    expect((await one("select to_regprocedure('public.auto_fuel_invoice_review(date,date)') as f")).f).toBeNull();
    await as("admin", "select public.auto_fuel_adjust_allocation($1::uuid, 15, 'half day')", [a]);
    // the log keeps its void/restore rows
    expect((await one("select count(*)::int as n from public.automatic_fuel_amount_changes where kind in ('void', 'restore')")).n).toBe(2);
  });
});
