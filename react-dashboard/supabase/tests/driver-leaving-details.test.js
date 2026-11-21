// Migration 065 against a real Postgres (PGlite): a driver's leaving details
// (last working day, reason from a fixed list, note), captured on every path by
// triggers, the append-only history, the admin correction, the "activity after
// the last working day" check, and the rollback.  Synthetic data only.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const read = (p) => readFileSync(here(p), "utf8");
const STUB = read("./supabase-stub.sql");
const M053 = read("../migrations/053_fleet_manager_permissions.sql");
const M065 = read("../migrations/065_driver_leaving_details.sql");
const R065 = read("../migrations/065_rollback.sql");

// 053's guard, admin_notifications and set_active_status (sections 10-12), as live.
const M053_STATUS = M053.slice(M053.indexOf("-- 10) Guard"), M053.indexOf("-- 13) mark_admin_notifications_read"));

const BASE = `
create publication supabase_realtime;
create table public.drivers (
  identity_number text primary key, full_name text, project text, assigned_vehicle_plate text,
  is_active boolean not null default true, date_of_hiring date
);
create table public.vehicles (vehicle_plate text primary key, is_active boolean not null default true);
create table public.shift_entries (
  id uuid primary key default gen_random_uuid(), identity_number text not null, shift_date date not null,
  shift_type text not null default 'start'
);
create table public.reinforcement_requests (
  id uuid primary key default gen_random_uuid(), identity_number text not null, shift_date date not null,
  amount numeric, loan_adjustment numeric, status text not null default 'pending'
);
create table public.automatic_fuel_allocations (
  id uuid primary key default gen_random_uuid(), identity_number text not null, allocation_date date not null,
  amount numeric not null, voided_at timestamptz
);
grant select, insert, update on public.drivers, public.vehicles to authenticated;
insert into public.drivers (identity_number, full_name, project, date_of_hiring) values
  ('1001', 'D1', 'FDP', '2026-01-10'), ('1002', 'D2', 'JDL', null), ('1003', 'D3', 'FDP', null);
insert into public.vehicles values ('V1', true);
`;

const USERS = {
  admin: { sub: "00000000-0000-0000-0000-00000000000a", email: "admin@gbe.sa", app_metadata: { role: "admin" } },
  fleet: { sub: "00000000-0000-0000-0000-00000000000f", email: "fleet@gbe.sa", app_metadata: { role: "fleet_manager" } },
  viewer: { sub: "00000000-0000-0000-0000-0000000000ee", email: "viewer@gbe.sa", app_metadata: { role: "viewer" } },
};

let db;
let today;
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

const deactivate = (user, idn, day, code, note = null) =>
  as(user, "select public.set_active_status('driver', $1, false, null, $2::date, $3, $4)", [idn, day, code, note]);
const driver = (idn) => one(
  `select is_active, last_working_day::text as day, deactivation_reason as reason, deactivation_note as note,
          deactivated_at is not null as stamped, deactivated_by as by
   from public.drivers where identity_number = $1`, [idn]);
const history = async (idn) => (await db.query(
  `select change, old_active, new_active, old_last_working_day::text as old_day, new_last_working_day::text as new_day,
          old_reason, new_reason, changed_by from public.driver_status_history where identity_number = $1 order by changed_at, change`, [idn])).rows;

beforeEach(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(BASE);
  await db.exec(M053_STATUS);
  await db.exec(M065);
  ({ today } = await one("select ((now() at time zone 'Asia/Riyadh')::date)::text as today"));
});

describe("deactivating a driver through set_active_status", () => {
  it("records the last working day, reason and note, stamps who/when, notifies the admins and logs history", async () => {
    await deactivate("fleet", "1001", "2026-10-20", "resigned", "  Handed in the car  ");
    expect(await driver("1001")).toEqual({
      is_active: false, day: "2026-10-20", reason: "resigned", note: "Handed in the car", stamped: true, by: "fleet@gbe.sa",
    });
    const n = await one("select kind, reason from public.admin_notifications");
    expect(n).toEqual({ kind: "deactivate", reason: "resigned | 2026-10-20 | Handed in the car" });
    expect(await history("1001")).toEqual([{
      change: "deactivate", old_active: true, new_active: false, old_day: null, new_day: "2026-10-20",
      old_reason: null, new_reason: "resigned", changed_by: "fleet@gbe.sa",
    }]);
  });

  it("refuses: no date, a future date, before hiring, no reason, an unknown reason, 'other' without a note", async () => {
    const { tomorrow } = await one("select (((now() at time zone 'Asia/Riyadh')::date) + 1)::text as tomorrow");
    await rejects(deactivate("admin", "1001", null, "resigned"), "LAST_DAY_REQUIRED");
    await rejects(deactivate("admin", "1001", tomorrow, "resigned"), "LAST_DAY_IN_FUTURE");
    await rejects(deactivate("admin", "1001", "2026-01-09", "resigned"), "LAST_DAY_BEFORE_HIRING");
    await rejects(deactivate("admin", "1001", "2026-10-20", null), "REASON_CODE_REQUIRED");
    await rejects(deactivate("admin", "1001", "2026-10-20", "bored"), "INVALID_REASON_CODE");
    await rejects(deactivate("admin", "1001", "2026-10-20", "other", "   "), "NOTE_REQUIRED");
    expect((await driver("1001")).is_active).toBe(true);
    // today itself is fine, and 'other' with a note
    await deactivate("admin", "1001", today, "other", "Moved to the warehouse");
    expect(await driver("1001")).toMatchObject({ is_active: false, day: today, reason: "other" });
  });

  it("the old free-text reason is no longer needed for a driver; vehicles keep the 10-character rule", async () => {
    await deactivate("admin", "1002", "2026-10-01", "absconded");
    expect((await driver("1002")).reason).toBe("absconded");
    await rejects(as("admin", "select public.set_active_status('vehicle', 'V1', false, 'short')"), "REASON_REQUIRED");
    await as("admin", "select public.set_active_status('vehicle', 'V1', false, 'Sold to a dealer')");
    expect((await one("select is_active from public.vehicles")).is_active).toBe(false);
  });

  it("viewer and anyone without a role are refused", async () => {
    await rejects(deactivate("viewer", "1001", "2026-10-20", "resigned"), "NOT_ALLOWED");
  });
});

describe("reactivating", () => {
  it("clears the five fields; the history keeps the old values", async () => {
    await deactivate("admin", "1001", "2026-10-20", "terminated", "Contract issue");
    await as("fleet", "select public.set_active_status('driver', '1001', true)");
    expect(await driver("1001")).toEqual({ is_active: true, day: null, reason: null, note: null, stamped: false, by: null });
    const h = await history("1001");
    expect(h.map(r => [r.change, r.old_day, r.new_day, r.old_reason, r.new_reason])).toEqual([
      ["deactivate", null, "2026-10-20", null, "terminated"],
      ["reactivate", "2026-10-20", null, "terminated", null],
    ]);
  });
});

describe("every path is captured", () => {
  it("an admin's direct update of is_active (or the SQL Editor) is stamped and logged, details left empty", async () => {
    await as("admin", "update public.drivers set is_active = false where identity_number = '1003'");
    expect(await driver("1003")).toEqual({ is_active: false, day: null, reason: null, note: null, stamped: true, by: "admin@gbe.sa" });
    await db.exec("update public.drivers set is_active = true where identity_number = '1003'");   // SQL Editor
    expect((await history("1003")).map(r => [r.change, r.changed_by])).toEqual([["deactivate", "admin@gbe.sa"], ["reactivate", "postgres"]]);
  });

  it("a fleet manager cannot write the leaving fields directly; nobody can set them on an active driver", async () => {
    await deactivate("admin", "1001", "2026-10-20", "resigned");
    await rejects(as("fleet", "update public.drivers set last_working_day = '2026-10-25' where identity_number = '1001'"), "leaving details can only be changed");
    await rejects(as("admin", "update public.drivers set deactivation_reason = 'resigned' where identity_number = '1002'"), "drivers_leaving_only_when_inactive");
    await rejects(as("admin", "update public.drivers set deactivation_reason = 'bored' where identity_number = '1001'"), "drivers_deactivation_reason_check");
  });

  it("a project change is logged too", async () => {
    await as("admin", "update public.drivers set project = 'JDL' where identity_number = '1001'");
    expect(await one("select change, old_project, new_project from public.driver_status_history"))
      .toEqual({ change: "project", old_project: "FDP", new_project: "JDL" });
  });
});

describe("correcting the leaving details (admin)", () => {
  it("fills in or corrects an inactive driver's details, logged; refused for an active driver or a fleet manager", async () => {
    await as("admin", "update public.drivers set is_active = false where identity_number = '1003'");   // old-style, no details
    await as("admin", "select public.set_driver_leaving_details('1003', '2026-09-30', 'contract_ended', null)");
    expect(await driver("1003")).toMatchObject({ day: "2026-09-30", reason: "contract_ended" });
    expect((await history("1003")).at(-1)).toMatchObject({ change: "leaving_details", old_day: null, new_day: "2026-09-30" });
    await rejects(as("fleet", "select public.set_driver_leaving_details('1003', '2026-09-29', 'resigned', null)"), "NOT_ALLOWED");
    await rejects(as("admin", "select public.set_driver_leaving_details('1001', '2026-09-29', 'resigned', null)"), "NOT_INACTIVE");
    await rejects(as("admin", "select public.set_driver_leaving_details('1003', '2026-09-29', 'other', '')"), "NOTE_REQUIRED");
  });
});

describe("activity after the last working day", () => {
  it("counts form days, approved reinforcement and automatic fuel (not voided) after the day", async () => {
    await db.exec(`
      insert into public.shift_entries (identity_number, shift_date, shift_type) values
        ('1001', '2026-10-20', 'start'), ('1001', '2026-10-22', 'start'), ('1001', '2026-10-22', 'end'), ('1001', '2026-10-25', 'start');
      insert into public.reinforcement_requests (identity_number, shift_date, amount, loan_adjustment, status) values
        ('1001', '2026-10-22', 50, -5, 'approved'), ('1001', '2026-10-23', 60, null, 'pending'), ('1001', '2026-10-19', 40, null, 'approved');
      insert into public.automatic_fuel_allocations (identity_number, allocation_date, amount, voided_at) values
        ('1001', '2026-10-21', 30, null), ('1001', '2026-10-24', 30, now()), ('1001', '2026-10-26', 30, null), ('1002', '2026-10-26', 30, null);
    `);
    const r = (await as("fleet", "select * from public.driver_activity_after('1001', '2026-10-20')")).rows[0];
    expect({ ...r, reinforcement_sar: Number(r.reinforcement_sar), automatic_sar: Number(r.automatic_sar),
      first_day: r.first_day.toISOString().slice(0, 10), last_day: r.last_day.toISOString().slice(0, 10) }).toEqual({
      form_days: 2, reinforcement_count: 1, reinforcement_sar: 45, automatic_count: 2, automatic_sar: 60,
      first_day: "2026-10-21", last_day: "2026-10-26",
    });
    const none = (await as("admin", "select * from public.driver_activity_after('1001', '2026-10-30')")).rows[0];
    expect([none.form_days, none.reinforcement_count, none.automatic_count, none.first_day]).toEqual([0, 0, 0, null]);
    await rejects(as("viewer", "select * from public.driver_activity_after('1001', '2026-10-20')"), "NOT_ALLOWED");
  });
});

describe("history table", () => {
  it("is append-only and readable by admin and fleet manager only", async () => {
    await deactivate("admin", "1001", "2026-10-20", "resigned");
    await rejects(db.exec("update public.driver_status_history set changed_by = 'x'"), "append-only");
    await rejects(db.exec("delete from public.driver_status_history"), "append-only");
    expect((await as("fleet", "select count(*)::int as n from public.driver_status_history")).rows[0].n).toBe(1);
    expect((await as("viewer", "select count(*)::int as n from public.driver_status_history")).rows[0].n).toBe(0);
    await rejects(as("admin", "insert into public.driver_status_history (identity_number, change) values ('1001', 'project')"), "permission denied");
  });
});

describe("install and rollback", () => {
  it("refuses to run twice", async () => {
    await rejects(db.exec(M065), "065 is already installed");
  });

  it("rollback restores 053's behaviour and keeps the data", async () => {
    await deactivate("admin", "1001", "2026-10-20", "resigned");
    await db.exec(R065);
    expect(await driver("1001")).toMatchObject({ day: "2026-10-20", reason: "resigned" });
    expect((await one("select count(*)::int as n from public.driver_status_history")).n).toBe(1);
    await rejects(as("admin", "select public.set_active_status('driver', '1002', false, 'short')"), "REASON_REQUIRED");
    await as("admin", "select public.set_active_status('driver', '1002', false, 'Left the company')");
    await as("admin", "select public.set_active_status('driver', '1001', true)");   // no constraint left in the way
    expect((await driver("1001")).is_active).toBe(true);
    expect((await one("select to_regprocedure('public.driver_activity_after(text,date)') as f")).f).toBeNull();
  });
});
