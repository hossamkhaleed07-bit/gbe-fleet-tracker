// Automatic Fuel amounts (migration 061) against a real Postgres (PGlite): the daily
// allocation takes each driver's own amount or the default, changing an amount never
// touches allocations already made, and only the admin can change anything.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const STUB = readFileSync(here("./supabase-stub.sql"), "utf8");
const MIGRATION = readFileSync(here("../migrations/061_automatic_fuel_amounts.sql"), "utf8");

// drivers and automatic_fuel_allocations as 004/011/036/038 left them (no cron or
// realtime in PGlite), plus the project-supervisor helpers of 050/053.
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
grant select on public.automatic_fuel_allocations, public.drivers to authenticated;

insert into public.drivers values
  ('1001', 'Ali',  'FDP', 'ABC 123', true),
  ('1002', 'Badr', 'FDP', null,      true),
  ('1003', 'Sami', 'FDP', 'XYZ 9',   false),
  ('2001', 'Omar', 'JDL', 'JDL 1',   true);
`;

const USERS = {
  admin: { sub: "00000000-0000-0000-0000-00000000000a", email: "admin@gbe.sa", app_metadata: { role: "admin" } },
  fleet: { sub: "00000000-0000-0000-0000-00000000000f", email: "fleet@gbe.sa", app_metadata: { role: "fleet_manager" } },
  viewer: { sub: "00000000-0000-0000-0000-0000000000ee", email: "viewer@gbe.sa", app_metadata: { role: "viewer" } },
  fdpSupervisor: { sub: "00000000-0000-0000-0000-0000000000b1", email: "sup@gbe.sa", app_metadata: { role: "project_supervisor", project: "FDP" } },
  jdlSupervisor: { sub: "00000000-0000-0000-0000-0000000000b2", email: "jdl@gbe.sa", app_metadata: { role: "project_supervisor", project: "JDL" } },
};

let db;

async function as(user, sql, params = []) {
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(USERS[user])]);
  await db.exec("set role authenticated");
  try {
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec("reset role");
  }
}
const admin = (sql, params) => as("admin", sql, params);

async function rejects(promise, code) {
  let err;
  try { await promise; } catch (e) { err = e; }
  expect(err, `expected ${code}`).toBeDefined();
  expect(`${err.message} ${err.code}`).toContain(code);
}

// The cron job runs as the database owner, not as a signed-in user.
const allocate = (day) => db.query("select public.allocate_daily_automatic_fuel($1::date)", [day]);
const amounts = async (day) => Object.fromEntries((await db.query(
  "select identity_number, amount from public.automatic_fuel_allocations where allocation_date = $1 order by identity_number", [day],
)).rows.map(r => [r.identity_number, Number(r.amount)]));
const changes = () => db.query("select * from public.automatic_fuel_amount_changes order by changed_at, kind").then(r => r.rows);

beforeEach(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(BASE);
  await db.exec(MIGRATION);
});

describe("daily allocation amounts", () => {
  it("starts with the default of 20 for every active FDP driver", async () => {
    await allocate("2026-11-01");
    expect(await amounts("2026-11-01")).toEqual({ 1001: 20, 1002: 20 });
  });

  it("a driver with their own amount gets it; a driver without one gets the default", async () => {
    await admin("select public.auto_fuel_set_driver_amount('1001', 35.5)");
    await admin("select public.auto_fuel_set_default(25)");
    await allocate("2026-11-02");
    expect(await amounts("2026-11-02")).toEqual({ 1001: 35.5, 1002: 25 });
  });

  it("removing a driver's own amount puts them back on the default", async () => {
    await admin("select public.auto_fuel_set_driver_amount('1001', 35)");
    await admin("select public.auto_fuel_set_driver_amount('1001', null)");
    await allocate("2026-11-03");
    expect(await amounts("2026-11-03")).toEqual({ 1001: 20, 1002: 20 });
  });

  it("changing amounts does not change allocations already made", async () => {
    await allocate("2026-11-01");
    await admin("select public.auto_fuel_set_driver_amount('1001', 40)");
    await admin("select public.auto_fuel_set_default(30)");
    await allocate("2026-11-02");
    // Running the job again for a day already done changes nothing either.
    await allocate("2026-11-01");
    expect(await amounts("2026-11-01")).toEqual({ 1001: 20, 1002: 20 });
    expect(await amounts("2026-11-02")).toEqual({ 1001: 40, 1002: 30 });
  });

  it("logs who changed what, from what, to what", async () => {
    await admin("select public.auto_fuel_set_default(25)");
    await admin("select public.auto_fuel_set_driver_amount('1001', 35)");
    await admin("select public.auto_fuel_set_driver_amount('1001', 35)"); // no change, no log row
    const log = await changes();
    expect(log.map(c => [c.kind, c.identity_number, c.old_amount && Number(c.old_amount), Number(c.new_amount), c.changed_by])).toEqual([
      ["default", null, 20, 25, "admin@gbe.sa"],
      ["driver", "1001", null, 35, "admin@gbe.sa"],
    ]);
  });

  it("refuses zero, negative and unknown drivers", async () => {
    await rejects(admin("select public.auto_fuel_set_default(0)"), "AUTO_FUEL_AMOUNT_MUST_BE_POSITIVE");
    await rejects(admin("select public.auto_fuel_set_driver_amount('1001', -5)"), "AUTO_FUEL_AMOUNT_MUST_BE_POSITIVE");
    await rejects(admin("select public.auto_fuel_set_driver_amount('9999', 10)"), "AUTO_FUEL_UNKNOWN_DRIVER");
  });
});

describe("correcting one day's allocation", () => {
  const allocationId = async (identity, day) => (await db.query(
    "select id from public.automatic_fuel_allocations where identity_number = $1 and allocation_date = $2", [identity, day],
  )).rows[0].id;

  it("needs a reason, then changes only that row and logs old and new", async () => {
    await allocate("2026-11-01");
    const id = await allocationId("1001", "2026-11-01");
    await rejects(admin("select public.auto_fuel_adjust_allocation($1, 15, '  ')", [id]), "AUTO_FUEL_REASON_REQUIRED");
    await admin("select public.auto_fuel_adjust_allocation($1, 15, 'half day')", [id]);
    expect(await amounts("2026-11-01")).toEqual({ 1001: 15, 1002: 20 });
    const row = (await db.query("select adjusted_by, adjusted_at from public.automatic_fuel_allocations where id = $1", [id])).rows[0];
    expect(row.adjusted_by).toBe("admin@gbe.sa");
    expect(row.adjusted_at).not.toBeNull();
    const [log] = await changes();
    expect([log.kind, log.identity_number, log.allocation_date.toISOString().slice(0, 10), Number(log.old_amount), Number(log.new_amount), log.reason])
      .toEqual(["allocation", "1001", "2026-11-01", 20, 15, "half day"]);
  });
});

describe("permissions", () => {
  it("only the admin can change amounts", async () => {
    await allocate("2026-11-01");
    const id = (await db.query("select id from public.automatic_fuel_allocations limit 1")).rows[0].id;
    for (const user of ["fleet", "viewer", "fdpSupervisor"]) {
      await rejects(as(user, "select public.auto_fuel_set_default(30)"), "AUTO_FUEL_ADMIN_ONLY");
      await rejects(as(user, "select public.auto_fuel_set_driver_amount('1001', 30)"), "AUTO_FUEL_ADMIN_ONLY");
      await rejects(as(user, "select public.auto_fuel_adjust_allocation($1, 30, 'x')", [id]), "AUTO_FUEL_ADMIN_ONLY");
    }
  });

  it("nobody writes the tables directly, and nobody signed in can run the daily job", async () => {
    await rejects(admin("update public.automatic_fuel_settings set default_amount = 99"), "permission denied");
    await rejects(admin("insert into public.automatic_fuel_driver_amounts (identity_number, amount) values ('1001', 5)"), "permission denied");
    await rejects(admin("select public.allocate_daily_automatic_fuel('2026-11-05')"), "permission denied");
  });

  it("the change log cannot be edited or deleted", async () => {
    await admin("select public.auto_fuel_set_default(25)");
    await rejects(db.query("update public.automatic_fuel_amount_changes set new_amount = 1"), "AUTO_FUEL_APPEND_ONLY");
    await rejects(db.query("delete from public.automatic_fuel_amount_changes"), "AUTO_FUEL_APPEND_ONLY");
  });

  it("admin, fleet manager, viewer and the FDP supervisor can read; another project's supervisor cannot", async () => {
    for (const user of ["admin", "fleet", "viewer", "fdpSupervisor"]) {
      expect(await as(user, "select default_amount from public.automatic_fuel_settings")).toHaveLength(1);
    }
    expect(await as("jdlSupervisor", "select default_amount from public.automatic_fuel_settings")).toHaveLength(0);
  });
});
