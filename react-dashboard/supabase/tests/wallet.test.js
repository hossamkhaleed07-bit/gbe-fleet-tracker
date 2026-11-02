// Wallet ledger (migration 060) against a real Postgres (PGlite): the constraints,
// triggers and functions run exactly as they would on Supabase.  Numbers follow
// wallet-business-rules.md.  After every test, every reconciliation check must hold.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const STUB = readFileSync(here("./supabase-stub.sql"), "utf8");
const MIGRATION = readFileSync(here("../migrations/060_wallet.sql"), "utf8");

const NOV = "2026-11-01";
const DEC = "2026-12-01";
const USERS = {
  admin: { sub: "00000000-0000-0000-0000-00000000000a", email: "admin@gbe.sa", app_metadata: { role: "admin" } },
  fleet: { sub: "00000000-0000-0000-0000-00000000000f", email: "fleet@gbe.sa", app_metadata: { role: "fleet_manager" } },
  viewer: { sub: "00000000-0000-0000-0000-0000000000ee", email: "viewer@gbe.sa", app_metadata: { role: "viewer" } },
};

let db;

// Every call runs as a signed-in user through the authenticated role, like PostgREST does.
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
const today = (d) => db.query("select set_config('wallet.today', $1, false)", [d]);
const num = (v) => (v == null ? v : Number(v));

async function rejects(promise, code) {
  let err;
  try { await promise; } catch (e) { err = e; }
  expect(err, `expected ${code}`).toBeDefined();
  expect(`${err.message} ${err.code}`).toContain(code);
  return err;
}

const budget = (month, amount) => admin("select public.wallet_set_company_budget($1, $2, 'monthly budget')", [month, amount]);
const allocate = (month, cat, amount) => admin("select public.wallet_allocate_category($1, $2, $3)", [month, cat, amount]);
const topUp = async (month, acc, amount) =>
  (await admin("select public.wallet_top_up($1, $2, $3, 'top-up') as r", [month, acc, amount]))[0].r;
const reverse = async (invoiceId, kind, reason = "duplicate invoice") =>
  (await admin("select public.wallet_reverse_invoice($1, $2, $3) as r", [invoiceId, kind, reason]))[0].r;
const balance = async (acc) =>
  num((await admin("select balance_now from public.wallet_account_summary($1) where code = $2", [NOV, acc]))[0].balance_now);
const category = async (month, code) =>
  (await admin("select * from public.wallet_category_summary($1) where code = $2", [month, code]))[0];
const overview = async (month) => (await admin("select public.wallet_overview($1) as o", [month]))[0].o;

async function invoice({ cost, card_type = "Driver FDP", branch = "FDP", entry_date = "2026-11-10", number }) {
  const vat = Math.round((cost - cost / 1.15) * 100) / 100;
  const rows = await admin(
    `insert into public.fuel_invoice_records (invoice_number, cost, amount, vat, card_type, branch, entry_date, status, data_source)
     values ($1, $2, $3, $4, $5, $6, $7, 'Added', 'PetroApp') returning id`,
    [number ?? `INV-${Math.random().toString(36).slice(2, 8)}`, cost, cost - vat, vat, card_type, branch, entry_date]);
  return rows[0].id;
}

// The document's November: 100,000 -> Management 10,000 / Projects 65,000 / Supervisors 25,000,
// project accounts with their monthly allocations, one supervisor account, one management account.
async function seedNovember({ companyBudget = 100000 } = {}) {
  await today("2026-11-15");
  await budget(NOV, companyBudget);
  await allocate(NOV, "management", 10000);
  await allocate(NOV, "projects", 65000);
  await allocate(NOV, "supervisors", 25000);
  await admin(`insert into public.wallet_accounts (category_id, code, name)
    select c.id, a.code, a.name from (values
      ('projects', 'FDP', 'FDP'), ('projects', 'JDL', 'JDL'), ('projects', 'ADM', 'ADM'), ('projects', 'LMS', 'LMS'),
      ('supervisors', 'SUP', 'Supervisor'), ('management', 'MGMT', 'Management')) a(cat, code, name)
    join public.wallet_categories c on c.code = a.cat`);
  for (const [acc, amount] of [["FDP", 20000], ["JDL", 20000], ["ADM", 15000], ["LMS", 10000]]) {
    await admin("select public.wallet_set_account_allocation($1, $2, $3)", [NOV, acc, amount]);
  }
  await admin(`insert into public.wallet_invoice_rules (match_column, match_value, action, account_id)
    select 'branch', a.code, 'post', a.id from public.wallet_accounts a where a.code in ('FDP', 'JDL', 'ADM', 'LMS')
    union all select 'card_type', 'Supervisor', 'post', id from public.wallet_accounts where code = 'SUP'
    union all select 'card_type', 'Management', 'post', id from public.wallet_accounts where code = 'MGMT'`);
  await admin("insert into public.wallet_invoice_rules (match_column, match_value, action) values ('card_type', 'Company vehicle', 'exclude')");
}

async function projectTopUps() {
  await topUp(NOV, "FDP", 15000);
  await topUp(NOV, "JDL", 10000);
  await topUp(NOV, "ADM", 10000);
  await topUp(NOV, "LMS", 5000);
}

async function expectReconciled() {
  for (const month of [NOV, DEC]) {
    const rows = await as("fleet", "select * from public.wallet_reconciliation($1)", [month]);
    expect(rows.length).toBeGreaterThan(0);
    const broken = rows.filter((r) => !r.ok).map((r) => `${month} ${r.check_code}/${r.scope}: ${r.left_value} vs ${r.right_value}`);
    expect(broken).toEqual([]);
  }
}

beforeEach(async () => {
  db = new PGlite();
  await db.exec(STUB);
  await db.exec(MIGRATION);
});

afterEach(async () => {
  await expectReconciled();
  await db.close();
});

describe("budget allocation vs top-up", () => {
  it("Projects 65,000 with 40,000 of top-ups leaves 25,000 undistributed", async () => {
    await seedNovember();
    await projectTopUps();

    const projects = await category(NOV, "projects");
    expect(num(projects.effective_allocation)).toBe(65000);
    expect(num(projects.top_ups)).toBe(40000);
    expect(num(projects.undistributed)).toBe(25000);

    const o = await overview(NOV);
    expect(num(o.company_budget)).toBe(100000);
    expect(num(o.total_category_allocations)).toBe(100000);
    expect(num(o.total_distributed_to_accounts)).toBe(40000);
    expect(num(o.total_undistributed)).toBe(60000); // 10,000 + 25,000 + 25,000
    expect(num(o.total_account_balances)).toBe(40000);
    expect(num(o.total_expenses)).toBe(0); // allocations and top-ups are not expenses
  });

  it("a top-up above the account allocation goes through and is flagged (FDP 22,000 of 20,000)", async () => {
    await seedNovember();
    const r = await topUp(NOV, "FDP", 22000);
    expect(r.over_allocation).toBe(true);
    expect(num(r.allocation)).toBe(20000);
    expect(num(r.top_ups)).toBe(22000);

    const fdp = (await admin("select * from public.wallet_account_summary($1) where code = 'FDP'", [NOV]))[0];
    expect(fdp.over_allocation).toBe(true);
    expect(num(fdp.balance)).toBe(22000);
    expect((await overview(NOV)).accounts_over_allocation).toBe(1);
  });

  it("a top-up above the category's undistributed budget is refused, with the amount available", async () => {
    await seedNovember();
    await topUp(NOV, "FDP", 15000);
    const err = await rejects(topUp(NOV, "JDL", 60000), "WALLET_TOPUP_EXCEEDS_UNDISTRIBUTED");
    expect(err.hint).toBe("50000.00");
    expect(num((await category(NOV, "projects")).undistributed)).toBe(50000); // nothing moved
    expect(await balance("JDL")).toBe(0);
  });

  it("reallocating 5,000 from Supervisors to Projects moves undistributed budget and nothing else", async () => {
    await seedNovember();
    await projectTopUps();
    const before = await overview(NOV);

    await admin("select public.wallet_reallocate($1, 'supervisors', 'projects', 5000, 'Projects need more this month')", [NOV]);

    expect(num((await category(NOV, "projects")).undistributed)).toBe(30000);
    expect(num((await category(NOV, "supervisors")).undistributed)).toBe(20000);
    expect(num((await category(NOV, "projects")).effective_allocation)).toBe(70000);
    const after = await overview(NOV);
    expect(num(after.company_budget)).toBe(num(before.company_budget));
    expect(num(after.total_category_allocations)).toBe(num(before.total_category_allocations));
    expect(num(after.total_undistributed)).toBe(num(before.total_undistributed));

    const tx = (await admin("select * from public.wallet_transactions where tx_type = 'reallocation'"))[0];
    expect(tx.reason).toBe("Projects need more this month");
    expect(tx.created_by).toBe(USERS.admin.sub);
    expect(tx.created_by_email).toBe("admin@gbe.sa");
  });

  it("a reallocation above the source category's undistributed budget is refused", async () => {
    await seedNovember();
    await rejects(admin("select public.wallet_reallocate($1, 'management', 'projects', 10000.01, 'too much')", [NOV]),
      "WALLET_REALLOCATION_EXCEEDS_UNDISTRIBUTED");
  });
});

describe("invoice cancellation and automatic reversal", () => {
  async function supervisorWith2000() {
    await seedNovember();
    await topUp(NOV, "SUP", 2000);
    expect(await balance("SUP")).toBe(2000);
  }

  it("balance 2,000 -> invoice 575 -> 1,425 -> cancelled -> 2,000", async () => {
    await supervisorWith2000();
    const inv = await invoice({ cost: 575, card_type: "Supervisor", branch: "Supervisor" });
    expect(await balance("SUP")).toBe(1425);

    const r = await reverse(inv, "cancelled", "entered by mistake");
    expect(num(r.balance_after)).toBe(2000);
    expect(await balance("SUP")).toBe(2000);

    const [expense, reversal] = await admin("select * from public.wallet_transactions where invoice_id = $1 order by id", [inv]);
    expect(expense.tx_type).toBe("expense");
    expect(reversal.tx_type).toBe("reversal");
    expect(reversal.reverses_tx_id).toBe(expense.id);
    expect(reversal.reversal_kind).toBe("cancelled");
    expect(reversal.reason).toBe("entered by mistake");
    expect(reversal.created_by).toBe(USERS.admin.sub);
    expect(reversal.created_at).toBeInstanceOf(Date);
    expect(num(reversal.invoice_snapshot.cost)).toBe(575);
    // the original invoice and its expense are still there
    expect((await admin("select count(*)::int as n from public.fuel_invoice_records where id = $1", [inv]))[0].n).toBe(1);
    const o = await overview(NOV);
    expect(num(o.total_expenses)).toBe(575);
    expect(num(o.total_reversed_expenses)).toBe(575);
  });

  it("the same invoice cannot be reversed twice, by the function or straight in the database", async () => {
    await supervisorWith2000();
    const inv = await invoice({ cost: 575, card_type: "Supervisor", branch: "Supervisor" });
    await reverse(inv, "cancelled");
    await rejects(reverse(inv, "cancelled"), "WALLET_INVOICE_ALREADY_REVERSED");
    await rejects(reverse(inv, "rejected"), "WALLET_INVOICE_ALREADY_REVERSED");

    // bypass the function as the database owner: the unique index still refuses it
    const [exp] = await db.query(
      "select id, account_id, category_id, period_id, amount from public.wallet_transactions where invoice_id = $1 and tx_type = 'expense'", [inv])
      .then((r) => r.rows);
    await rejects(db.query(
      `insert into public.wallet_transactions (tx_type, period_id, amount, reason, account_id, category_id, invoice_id,
         invoice_snapshot, reverses_tx_id, reversal_kind)
       values ('reversal', $1, $2, 'again', $3, $4, $5, '{}'::jsonb, $6, 'rejected')`,
      [exp.period_id, exp.amount, exp.account_id, exp.category_id, inv, exp.id]), "23505");
    expect(await balance("SUP")).toBe(2000);
  });

  it("Rejected makes exactly the same reversal as Cancelled, with a different kind", async () => {
    await supervisorWith2000();
    const a = await invoice({ cost: 575, card_type: "Supervisor", branch: "Supervisor" });
    const b = await invoice({ cost: 575, card_type: "Supervisor", branch: "Supervisor" });
    expect(await balance("SUP")).toBe(850);

    await reverse(a, "cancelled");
    await reverse(b, "rejected");
    expect(await balance("SUP")).toBe(2000);

    const rows = await admin(
      `select t.reversal_kind, t.amount, t.period_id, t.account_id, p.pool, p.amount as posted
         from public.wallet_transactions t join public.wallet_postings p on p.tx_id = t.id
        where t.tx_type = 'reversal' order by t.reversal_kind, p.pool`);
    const shape = (kind) => rows.filter((r) => r.reversal_kind === kind).map(({ reversal_kind, ...rest }) => rest);
    expect(shape("cancelled")).toEqual(shape("rejected"));
    expect(rows.map((r) => r.reversal_kind)).toEqual(["cancelled", "cancelled", "rejected", "rejected"]);
  });

  it("cancelling an invoice of a closed month is an adjustment now; the closed month does not change", async () => {
    await supervisorWith2000();
    const inv = await invoice({ cost: 575, card_type: "Supervisor", branch: "Supervisor" });
    await admin("select public.wallet_close_period($1, 'November closed')", [NOV]);
    const novBefore = await overview(NOV);
    const novReconBefore = await admin("select * from public.wallet_reconciliation($1)", [NOV]);

    await today("2026-12-03");
    const r = await reverse(inv, "cancelled", "cancelled after closing");
    expect(r.is_adjustment).toBe(true);
    expect(r.period_month).toBe("2026-12-01");
    expect(await balance("SUP")).toBe(2000);

    const rev = (await admin("select * from public.wallet_transactions where tx_type = 'reversal'"))[0];
    const [nov, dec] = await admin("select id from public.wallet_periods order by month");
    expect(rev.period_id).toBe(dec.id);
    expect(rev.original_period_id).toBe(nov.id);
    expect(rev.is_adjustment).toBe(true);

    expect(await overview(NOV)).toEqual(novBefore);
    expect(await admin("select * from public.wallet_reconciliation($1)", [NOV])).toEqual(novReconBefore);
    expect(num(novBefore.total_reversed_expenses)).toBe(0);
    expect(num((await overview(DEC)).total_reversed_expenses)).toBe(575);

    // and nothing can be written into the closed month
    await rejects(topUp(NOV, "SUP", 1), "WALLET_PERIOD_CLOSED");
  });

  it("an account may go below zero from an invoice, and is flagged", async () => {
    await seedNovember();
    await topUp(NOV, "SUP", 500);
    await invoice({ cost: 575, card_type: "Supervisor", branch: "Supervisor" });
    expect(await balance("SUP")).toBe(-75);
    expect((await overview(NOV)).accounts_negative).toBe(1);
  });
});

describe("carry forward", () => {
  it("what is left at month end appears as carry-forward movements at the start of the next month", async () => {
    await seedNovember({ companyBudget: 105000 }); // 5,000 never given to a category
    await projectTopUps();
    await topUp(NOV, "SUP", 2000);
    await invoice({ cost: 575, card_type: "Supervisor", branch: "Supervisor" });
    const balancesBefore = await admin("select code, balance from public.wallet_account_summary($1)", [NOV]);

    const closed = await admin("select public.wallet_close_period($1, 'month end') as r", [NOV]);
    expect(closed[0].r.carried).toEqual([
      { category: "management", amount: 10000 },
      { category: "projects", amount: 25000 },
      { category: "supervisors", amount: 23000 },
      { category: null, amount: 5000 },
    ]);

    const cf = await admin(
      `select c.code, t.amount, ps.month as from_month, pt.month as in_month
         from public.wallet_transactions t
         join public.wallet_periods ps on ps.id = t.source_period_id
         join public.wallet_periods pt on pt.id = t.period_id
         left join public.wallet_categories c on c.id = t.category_id
        where t.tx_type = 'carry_forward' order by c.sort nulls last`);
    expect(cf.map((r) => [r.code, num(r.amount)])).toEqual([["management", 10000], ["projects", 25000], ["supervisors", 23000], [null, 5000]]);
    expect(cf.every((r) => r.from_month.toISOString().startsWith("2026-11-01") && r.in_month.toISOString().startsWith("2026-12-01"))).toBe(true);

    // November keeps its numbers; December starts with them as carry forward, not as a silent budget
    expect(num((await category(NOV, "projects")).carried_out)).toBe(25000);
    const dec = await overview(DEC);
    expect(num(dec.company_budget)).toBe(0);
    expect(num(dec.company_carried_in)).toBe(5000);
    expect(num(dec.company_unallocated)).toBe(5000);
    expect(num((await category(DEC, "projects")).carried_in)).toBe(25000);
    expect(num((await category(DEC, "projects")).undistributed)).toBe(25000);
    // account balances do not move
    expect(await admin("select code, balance from public.wallet_account_summary($1)", [NOV])).toEqual(balancesBefore);

    // a second close of the same month is refused
    await rejects(admin("select public.wallet_close_period($1)", [NOV]), "WALLET_PERIOD_CLOSED");
  });
});

describe("ledger rules the database enforces", () => {
  it("ledger rows can never be changed or deleted", async () => {
    await seedNovember();
    await topUp(NOV, "FDP", 1000);
    await rejects(db.query("update public.wallet_transactions set amount = 1"), "WALLET_APPEND_ONLY");
    await rejects(db.query("delete from public.wallet_postings"), "WALLET_APPEND_ONLY");
    await rejects(db.query("delete from public.wallet_account_allocations"), "WALLET_APPEND_ONLY");
    await rejects(db.query("truncate public.wallet_transactions cascade"), "WALLET_APPEND_ONLY");
  });

  it("a movement whose postings do not add up is refused at commit", async () => {
    await seedNovember();
    const [p] = (await db.query("select id from public.wallet_periods")).rows;
    await rejects(db.exec(`begin;
      insert into public.wallet_transactions (tx_type, period_id, amount, category_id) values ('category_allocation', ${p.id}, 100, 1);
      insert into public.wallet_postings (tx_id, pool, period_id, category_id, amount)
        values (currval(pg_get_serial_sequence('public.wallet_transactions', 'id')), 'category', ${p.id}, 1, 100);
      commit;`), "WALLET_UNBALANCED_MOVEMENT");
    await db.exec("rollback").catch(() => {});
  });

  it("a posted invoice cannot be deleted, and its amount and account cannot change; remarks can", async () => {
    await seedNovember();
    await topUp(NOV, "FDP", 1000);
    const inv = await invoice({ cost: 100 });
    await rejects(admin("delete from public.fuel_invoice_records where id = $1", [inv]), "WALLET_INVOICE_POSTED_CANNOT_DELETE");
    await rejects(admin("update public.fuel_invoice_records set cost = 90 where id = $1", [inv]), "WALLET_INVOICE_POSTED_LOCKED");
    await rejects(admin("update public.fuel_invoice_records set branch = 'JDL' where id = $1", [inv]), "WALLET_INVOICE_POSTED_LOCKED");
    await admin("update public.fuel_invoice_records set remarks = 'checked', row_color = 'green' where id = $1", [inv]);
    expect(await balance("FDP")).toBe(900);
  });

  it("only invoices from the wallet start, with a rule, are posted; the rest wait in the unposted list", async () => {
    await seedNovember();
    await invoice({ cost: 100, entry_date: "2026-10-31" });                       // before the start: never posted
    await invoice({ cost: 100, card_type: "Company vehicle", branch: "GBE-CRD-23" }); // excluded by rule
    const lost = await invoice({ cost: 100, card_type: "DA Use", branch: "jazzan" });   // no rule yet
    await invoice({ cost: 100 });                                                   // FDP

    expect(num((await overview(NOV)).total_expenses)).toBe(100);
    const unposted = await admin("select invoice_id, reason from public.wallet_unposted_invoices()");
    expect(unposted).toEqual([{ invoice_id: lost, reason: "no_rule" }]);

    // the October invoice can still be deleted (it was never posted)
    await admin("delete from public.fuel_invoice_records where entry_date = '2026-10-31'");

    // once a rule exists the waiting invoice is posted, once
    await admin("insert into public.wallet_invoice_rules (match_column, match_value, action, account_id) select 'branch', 'jazzan', 'post', id from public.wallet_accounts where code = 'JDL'");
    expect((await admin("select public.wallet_post_pending_invoices() as n"))[0].n).toBe(1);
    expect((await admin("select public.wallet_post_pending_invoices() as n"))[0].n).toBe(0);
    expect(num((await overview(NOV)).total_expenses)).toBe(200);
  });

  it("internal transfers stay inside one category and never change the company total", async () => {
    await seedNovember();
    await projectTopUps();
    const before = await overview(NOV);
    await admin("select public.wallet_transfer('FDP', 'LMS', 3000, 'LMS ran short')");
    expect(await balance("FDP")).toBe(12000);
    expect(await balance("LMS")).toBe(8000);
    const after = await overview(NOV);
    expect(num(after.total_account_balances)).toBe(num(before.total_account_balances));
    expect(num(after.total_internal_transfers)).toBe(3000);
    await rejects(admin("select public.wallet_transfer('FDP', 'SUP', 1, 'x')"), "WALLET_TRANSFER_ACROSS_CATEGORIES");
    await rejects(admin("select public.wallet_transfer('FDP', 'JDL', 12000.01, 'x')"), "WALLET_TRANSFER_EXCEEDS_BALANCE");
    await rejects(admin("select public.wallet_transfer('FDP', 'JDL', 10, '  ')"), "WALLET_REASON_REQUIRED");
  });

  it("only the main admin writes; fleet manager and viewer can read", async () => {
    await seedNovember();
    for (const user of ["fleet", "viewer"]) {
      await rejects(as(user, "select public.wallet_top_up($1, 'FDP', 1)", [NOV]), "WALLET_ADMIN_ONLY");
      await rejects(as(user, "select public.wallet_close_period($1)", [NOV]), "WALLET_ADMIN_ONLY");
      await rejects(as(user, "insert into public.wallet_transactions (tx_type, period_id, amount) values ('top_up', 1, 1)"), "permission denied");
      expect(num((await as(user, "select public.wallet_overview($1) as o", [NOV]))[0].o.company_budget)).toBe(100000);
    }
    // the unposted list shows invoice details: not for a viewer (who still gets the count)
    await invoice({ cost: 100, card_type: "DA Use", branch: "jazzan" });
    await rejects(as("viewer", "select * from public.wallet_unposted_invoices()"), "WALLET_NO_ACCESS");
    expect((await as("fleet", "select * from public.wallet_unposted_invoices()")).length).toBe(1);
    expect((await as("viewer", "select public.wallet_overview($1) as o", [NOV]))[0].o.unposted_invoices).toBe(1);
  });
});
