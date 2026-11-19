// Automatic Fuel amounts page: which amount each driver shows, input parsing, and
// that every text has Arabic and English and the styles use theme tokens only.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { translate, translations } from "./i18n";
import {
  buildDriverAmountRows, canVoidDay, ERROR_CODES, isVoided, parseAmount, reasonOk, REVIEW_STATUSES, splitVoided, STATUSES,
  summarizeReview, VOIDABLE_REVIEW_STATUSES,
} from "./automaticFuel";
import { sumAutomaticFuel } from "./calc";

const SRC = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(SRC + p, "utf8");
const SOURCES = [
  "pages/AutomaticFuel.jsx", "components/AutomaticFuelAmounts.jsx", "components/AutomaticFuelVoid.jsx",
  "components/AutomaticFuelReview.jsx", "lib/automaticFuel.js", "automatic-fuel.css",
];
const leaves = (obj, prefix = "") => Object.entries(obj).flatMap(([k, v]) =>
  v && typeof v === "object" ? leaves(v, `${prefix}${k}.`) : [`${prefix}${k}`]);

describe("driver amounts", () => {
  const drivers = [
    { identity_number: "1001", full_name: "Ali", project: "FDP", is_active: true, assigned_vehicle_plate: "ABC 123" },
    { identity_number: "1002", full_name: "Badr", project: "FDP", is_active: true, assigned_vehicle_plate: null },
    { identity_number: "1003", full_name: "Sami", project: "FDP", is_active: false },
    { identity_number: "2001", full_name: "Omar", project: "JDL", is_active: true },
  ];

  it("a driver with their own amount shows it; a driver without one shows the default", () => {
    const rows = buildDriverAmountRows(drivers, [{ identity_number: "1001", amount: "35.50" }], 20);
    expect(rows.map(r => [r.identity_number, r.amount, r.isDefault, r.vehicle_plate])).toEqual([
      ["1001", 35.5, false, "ABC 123"],
      ["1002", 20, true, null],
    ]);
  });

  it("only active FDP drivers are listed", () => {
    expect(buildDriverAmountRows(drivers, [], 20).map(r => r.identity_number)).toEqual(["1001", "1002"]);
  });

  it("parses amounts: positive numbers only, two decimals", () => {
    expect(parseAmount("25")).toBe(25);
    expect(parseAmount(" 17.456 ")).toBe(17.46);
    for (const bad of ["", "0", "-3", "abc", null]) expect(parseAmount(bad)).toBeNull();
  });
});

describe("automatic fuel translations and styles", () => {
  it("Arabic and English have exactly the same keys, none empty", () => {
    expect(leaves(translations.ar.automaticFuel).sort()).toEqual(leaves(translations.en.automaticFuel).sort());
    for (const lang of ["ar", "en"]) {
      for (const key of leaves(translations[lang].automaticFuel)) expect(translate(lang, `automaticFuel.${key}`).trim()).not.toBe("");
    }
  });

  it("every key the code asks for exists, including ones built from database values", () => {
    const used = new Set();
    for (const p of SOURCES.filter(p => p.endsWith("x") || p.endsWith(".js"))) {
      for (const m of read(p).matchAll(/\bt\(\s*["'`]([a-zA-Z]+\.[A-Za-z0-9_.]+)["'`]/g)) used.add(m[1]);
    }
    for (const c of ERROR_CODES) used.add(`automaticFuel.errors.${c}`);
    for (const s of STATUSES) used.add(`automaticFuel.status_${s}`);
    for (const k of ["default", "driver", "allocation", "void", "restore"]) used.add(`automaticFuel.kind_${k}`);
    for (const k of ["allocations", "amounts", "review"]) used.add(`automaticFuel.tab_${k}`);
    for (const k of ["active", "voided", "all"]) used.add(`automaticFuel.view_${k}`);
    for (const k of REVIEW_STATUSES) used.add(`automaticFuel.review_${k}`);
    const missing = [...used].filter(k => ["ar", "en"].some(lang => translate(lang, k) === k));
    expect(missing).toEqual([]);
  });

  it("every AUTO_FUEL_* code the migrations raise has a message", () => {
    const sql = ["061_automatic_fuel_amounts.sql", "064_automatic_fuel_void.sql"]
      .map(f => readFileSync(fileURLToPath(new URL(`../../supabase/migrations/${f}`, import.meta.url)), "utf8")).join(" ");
    const raised = new Set([...sql.matchAll(/raise exception '(AUTO_FUEL_[A-Z_]+)/g)].map(m => m[1]));
    raised.delete("AUTO_FUEL_APPEND_ONLY"); // a guard on the log table, never reached from the page
    expect([...raised].filter(c => !ERROR_CODES.includes(c))).toEqual([]);
  });

  it("styles use theme tokens only: no hex, rgb/hsl or named colors", () => {
    const offenders = [];
    for (const p of SOURCES) {
      const text = read(p);
      const chunks = p.endsWith(".css") ? [text] : [...text.matchAll(/style=\{\{([^}]*)\}\}/g)].map(m => m[1]);
      for (const c of chunks) {
        const bad = c.match(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(|:\s*(?:white|black|red|green|blue|gray|grey|orange|yellow)\b/g);
        if (bad) offenders.push(`${p}: ${bad.join(", ")}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("void and the invoice review (064)", () => {
  const rows = [
    { id: "a", amount: 30, allocation_date: "2026-10-01", voided_at: null },
    { id: "b", amount: 25, allocation_date: "2026-10-02", voided_at: "2026-11-19T08:00:00Z" },
    { id: "c", amount: "20", allocation_date: "2026-10-03" },
  ];

  it("voided rows are kept apart, so totals count active rows only", () => {
    const { active, voided } = splitVoided(rows);
    expect(active.map(r => r.id)).toEqual(["a", "c"]);
    expect(voided.map(r => r.id)).toEqual(["b"]);
    expect(sumAutomaticFuel(active)).toBe(50);
    expect([isVoided(rows[1]), isVoided(rows[0]), isVoided(null)]).toEqual([true, false, false]);
    expect(splitVoided(null)).toEqual({ active: [], voided: [] });
  });

  it("only a past day (Riyadh) can be voided", () => {
    expect(canVoidDay("2026-11-18", "2026-11-19")).toBe(true);
    expect(canVoidDay("2026-11-19", "2026-11-19")).toBe(false);
    expect(canVoidDay("2026-11-20", "2026-11-19")).toBe(false);
    expect(canVoidDay(null, "2026-11-19")).toBe(false);
  });

  it("a reason needs 10 characters after trimming", () => {
    expect(reasonOk("Not withdrawn")).toBe(true);
    expect(reasonOk("  123456789  ")).toBe(false);
    expect(reasonOk(null)).toBe(false);
  });

  it("combined fills and days without loaded invoices cannot be bulk voided", () => {
    expect(VOIDABLE_REVIEW_STATUSES).toEqual(["no_invoice", "partial_invoice"]);
    expect(VOIDABLE_REVIEW_STATUSES.every(s => REVIEW_STATUSES.includes(s))).toBe(true);
  });

  it("summarizes the review per status with the last loaded invoice day", () => {
    const sum = summarizeReview([
      { status: "no_invoice", automatic_fuel: "30", last_invoice_date: "2026-10-28" },
      { status: "no_invoice", automatic_fuel: 20, last_invoice_date: "2026-10-28" },
      { status: "not_loaded", automatic_fuel: 30, last_invoice_date: "2026-10-28" },
    ]);
    expect(sum.byStatus.no_invoice).toEqual({ days: 2, sar: 50 });
    expect(sum.byStatus.not_loaded).toEqual({ days: 1, sar: 30 });
    expect(sum.byStatus.combined_fill).toEqual({ days: 0, sar: 0 });
    expect(sum.lastInvoiceDate).toBe("2026-10-28");
    expect(summarizeReview([]).lastInvoiceDate).toBeNull();
  });

  it("the review statuses match the ones the database returns", () => {
    const sql = readFileSync(fileURLToPath(new URL("../../supabase/migrations/064_automatic_fuel_void.sql", import.meta.url)), "utf8");
    const body = sql.slice(sql.indexOf("create function public.auto_fuel_invoice_review"));
    const returned = new Set([...body.matchAll(/(?:then|else) '([a-z_]+)'/g)].map(m => m[1]));
    returned.delete("matched");
    expect([...returned].sort()).toEqual([...REVIEW_STATUSES].sort());
  });
});
