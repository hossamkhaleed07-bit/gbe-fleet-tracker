// The run order of the 060 scripts on a copy of the database shape (PGlite):
// verify_before -> 060_wallet -> verify_after -> rollback -> verify_before -> 060_wallet.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it } from "vitest";

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const STUB = read("./supabase-stub.sql");
const BEFORE = read("../migrations/060_verify_before.sql");
const MIGRATION = read("../migrations/060_wallet.sql");
const AFTER = read("../migrations/060_verify_after.sql");
const ROLLBACK = read("../migrations/060_rollback.sql");

let db;

// The SQL Editor shows the last statement's result; so does this.
async function lastResult(sql) {
  const results = await db.exec(sql);
  return results.at(-1).rows;
}
const failing = (rows) => rows.filter((r) => !r.ok).map((r) => `${r.check_name}: ${r.value}`);

beforeEach(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(`insert into public.fuel_invoice_records (invoice_number, cost, amount, vat, card_type, branch, entry_date)
    values ('A', 115, 100, 15, 'Driver FDP', 'FDP', '2026-10-05'), ('B', 230, 200, 30, 'Supervisor', 'Supervisor', '2026-11-01')`);
});
afterEach(() => db.close());

it("runs before -> migration -> after -> rollback -> before -> migration, all checks ok", async () => {
  const before = await lastResult(BEFORE);
  expect(failing(before)).toEqual([]);
  expect(before.find((r) => r.check_name === "invoices_count").value).toBe("2");
  expect(before.find((r) => r.check_name === "invoices_total_cost").value).toBe("345");

  await db.exec(MIGRATION);
  const after = await lastResult(AFTER);
  expect(failing(after)).toEqual([]);
  expect(after.find((r) => r.check_name === "invoices_count (same as before)").value).toBe("2");
  expect(after.find((r) => r.check_name === "invoices_total_cost (same as before)").value).toBe("345");
  expect(after.find((r) => r.check_name.startsWith("dry run: reconciliation")).value).toMatch(/^true \(\d+ checks\)$/);

  // the after-check can be run again (it left nothing behind)
  expect(failing(await lastResult(AFTER))).toEqual([]);

  // a second run of the migration is refused
  await expect(db.exec(MIGRATION)).rejects.toThrow(/already exists - 060 was already run/);
  await db.exec("rollback").catch(() => {});

  await db.exec(ROLLBACK);
  expect(failing(await lastResult(BEFORE))).toEqual([]);
  expect((await db.query("select count(*)::int as n from public.fuel_invoice_records")).rows[0].n).toBe(2);

  await db.exec(MIGRATION);
  expect(failing(await lastResult(AFTER))).toEqual([]);
});

it("rollback refuses once the wallet holds a money movement", async () => {
  await db.exec(MIGRATION);
  await db.exec(`select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","app_metadata":{"role":"admin"}}', false);
                 select set_config('wallet.today', '2026-11-15', false);
                 select public.wallet_set_company_budget('2026-11-01', 1000, 'real budget');`);
  await expect(db.exec(ROLLBACK)).rejects.toThrow(/STOP: the wallet already has 1 money movements/);
  await db.exec("rollback").catch(() => {});
  expect((await db.query("select count(*)::int as n from public.wallet_transactions")).rows[0].n).toBe(1);
});
