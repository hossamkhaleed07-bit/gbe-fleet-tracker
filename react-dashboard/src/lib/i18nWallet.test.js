// Every wallet text exists in Arabic and English, every key the code asks for exists,
// and the wallet's styles use only theme tokens (no fixed colors).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { translate } from "./i18n";
import { WALLET_I18N } from "./i18nWallet";
import { ACTIONS, ERROR_CODES, RECON_CHECKS, TX_TYPES, UNPOSTED_REASONS } from "./wallet";

const SRC = fileURLToPath(new URL("..", import.meta.url));
const leaves = (obj, prefix = "") => Object.entries(obj).flatMap(([k, v]) =>
  v && typeof v === "object" ? leaves(v, `${prefix}${k}.`) : [`${prefix}${k}`]);
const files = (dir) => readdirSync(dir).flatMap(f => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : [p];
});
const walletSources = files(SRC).filter(p => /\.(jsx?|css)$/.test(p) && !p.endsWith(".test.js"))
  .filter(p => /wallet/i.test(p) || readFileSync(p, "utf8").includes("wallet."));

describe("wallet translations", () => {
  it("Arabic and English have exactly the same keys, none empty", () => {
    expect(leaves(WALLET_I18N.ar).sort()).toEqual(leaves(WALLET_I18N.en).sort());
    for (const lang of ["ar", "en"]) {
      for (const key of leaves(WALLET_I18N[lang])) expect(translate(lang, `wallet.${key}`).trim(), `${lang} wallet.${key}`).not.toBe("");
    }
  });

  it("every literal t(\"wallet.…\") key in the code exists", () => {
    const used = new Set();
    for (const p of walletSources) {
      for (const m of readFileSync(p, "utf8").matchAll(/\bt\(\s*["'`](wallet\.[A-Za-z0-9_.]+)["'`]/g)) used.add(m[1]);
    }
    expect(used.size).toBeGreaterThan(20);
    const missing = [...used].filter(k => ["ar", "en"].some(lang => translate(lang, k) === k));
    expect(missing).toEqual([]);
  });

  it("every key built from database values exists (types, checks, reasons, actions, errors)", () => {
    const keys = [
      ...TX_TYPES.map(x => `wallet.tx.${x}`),
      ...RECON_CHECKS.flatMap(x => ["label", "left", "right"].map(s => `wallet.recon.checks.${x}.${s}`)),
      ...UNPOSTED_REASONS.map(x => `wallet.unposted.reasons.${x}`),
      ...ACTIONS.map(x => `wallet.actions.${x}`),
      ...ERROR_CODES.map(x => `wallet.errors.${x}`),
      "wallet.errors.NOT_INSTALLED", "wallet.errors.UNKNOWN",
      "wallet.reversalKind.cancelled", "wallet.reversalKind.rejected",
      "wallet.periodStatus.open", "wallet.periodStatus.closed", "wallet.periodStatus.none",
      "wallet.settings.columns.card_type", "wallet.settings.columns.branch",
    ];
    const missing = keys.filter(k => ["ar", "en"].some(lang => translate(lang, k) === k));
    expect(missing).toEqual([]);
  });

  it("every WALLET_* code raised by the migration has a message", () => {
    const sql = readFileSync(fileURLToPath(new URL("../../supabase/migrations/060_wallet.sql", import.meta.url)), "utf8");
    const raised = new Set([...sql.matchAll(/raise exception '(WALLET_[A-Z_]+)/g)].map(m => m[1]));
    raised.delete("WALLET_UNBALANCED_MOVEMENT"); // an integrity failure, never expected in the page
    expect([...raised].filter(c => !ERROR_CODES.includes(c))).toEqual([]);
  });
});

describe("wallet styles", () => {
  it("use theme tokens only: no hex, rgb/hsl or named colors", () => {
    const offenders = [];
    for (const p of walletSources) {
      const text = readFileSync(p, "utf8");
      const isCss = p.endsWith(".css");
      // in JS only look inside style={{ … }} and className strings are fine
      const chunks = isCss ? [text] : [...text.matchAll(/style=\{\{([^}]*)\}\}/g)].map(m => m[1]);
      for (const c of chunks) {
        const bad = c.match(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(|:\s*(?:white|black|red|green|blue|gray|grey|orange|yellow)\b/g);
        if (bad) offenders.push(`${p.replace(SRC, "")}: ${bad.join(", ")}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
