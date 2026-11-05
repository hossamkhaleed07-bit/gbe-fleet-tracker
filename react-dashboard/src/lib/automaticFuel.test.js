// Automatic Fuel amounts page: which amount each driver shows, input parsing, and
// that every text has Arabic and English and the styles use theme tokens only.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { translate, translations } from "./i18n";
import { buildDriverAmountRows, ERROR_CODES, parseAmount, STATUSES } from "./automaticFuel";

const SRC = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(SRC + p, "utf8");
const SOURCES = ["pages/AutomaticFuel.jsx", "components/AutomaticFuelAmounts.jsx", "lib/automaticFuel.js", "automatic-fuel.css"];
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
    for (const k of ["default", "driver", "allocation"]) used.add(`automaticFuel.kind_${k}`);
    for (const k of ["allocations", "amounts"]) used.add(`automaticFuel.tab_${k}`);
    const missing = [...used].filter(k => ["ar", "en"].some(lang => translate(lang, k) === k));
    expect(missing).toEqual([]);
  });

  it("every AUTO_FUEL_* code the migration raises has a message", () => {
    const sql = readFileSync(fileURLToPath(new URL("../../supabase/migrations/061_automatic_fuel_amounts.sql", import.meta.url)), "utf8");
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
