// Driver leaving details (migration 065): the dialog's checks, the reason list
// and its labels, and the activity-after summary.  Synthetic data only.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { translate } from "./i18n";
import {
  activeStatusErrorKey, DEACTIVATION_REASONS, leavingError, normalizeActivityAfter,
} from "./activeStatus";

describe("leaving details: the dialog checks the same rules as the database", () => {
  const ok = { lastWorkingDay: "2026-10-20", reasonCode: "resigned", note: "" };
  const ctx = { today: "2026-11-22", hiredOn: "2026-01-10" };

  it("accepts a valid entry, today included", () => {
    expect(leavingError(ok, ctx)).toBeNull();
    expect(leavingError({ ...ok, lastWorkingDay: "2026-11-22" }, ctx)).toBeNull();
  });

  it("refuses a missing or future date, a date before hiring, no or unknown reason, 'other' without a note", () => {
    expect(leavingError({ ...ok, lastWorkingDay: "" }, ctx)).toBe("LAST_DAY_REQUIRED");
    expect(leavingError({ ...ok, lastWorkingDay: "2026-11-23" }, ctx)).toBe("LAST_DAY_IN_FUTURE");
    expect(leavingError({ ...ok, lastWorkingDay: "2026-01-09" }, ctx)).toBe("LAST_DAY_BEFORE_HIRING");
    expect(leavingError({ ...ok, reasonCode: "" }, ctx)).toBe("REASON_CODE_REQUIRED");
    expect(leavingError({ ...ok, reasonCode: "bored" }, ctx)).toBe("INVALID_REASON_CODE");
    expect(leavingError({ ...ok, reasonCode: "other", note: "  " }, ctx)).toBe("NOTE_REQUIRED");
    expect(leavingError({ ...ok, reasonCode: "other", note: "Moved to the warehouse" }, ctx)).toBeNull();
  });

  it("the reason list matches the database's allowed list, and every reason has a label in both languages", () => {
    const sql = readFileSync(fileURLToPath(new URL("../../supabase/migrations/065_driver_leaving_details.sql", import.meta.url)), "utf8");
    const check = sql.slice(sql.indexOf("drivers_deactivation_reason_check"), sql.indexOf("drivers_leaving_only_when_inactive"));
    expect([...check.matchAll(/'([a-z_]+)'/g)].map(m => m[1])).toEqual(DEACTIVATION_REASONS);
    for (const lang of ["ar", "en"]) {
      for (const c of DEACTIVATION_REASONS) expect(translate(lang, `activeStatus.reason_${c}`)).not.toBe(`activeStatus.reason_${c}`);
    }
  });

  it("every error the database raises has a message in both languages", () => {
    const sql = readFileSync(fileURLToPath(new URL("../../supabase/migrations/065_driver_leaving_details.sql", import.meta.url)), "utf8");
    const codes = new Set([...sql.matchAll(/raise exception '([A-Z_]+)'/g)].map(m => m[1]));
    // wrong arguments from code, never from the dialog
    codes.delete("INVALID_TARGET_TYPE");
    codes.delete("INVALID_ACTIVE");
    for (const c of codes) {
      const key = activeStatusErrorKey(c);
      expect(key, c).not.toBe("activeStatus.errGeneric");
      for (const lang of ["ar", "en"]) expect(translate(lang, key)).not.toBe(key);
    }
  });
});

describe("activity after the last working day", () => {
  it("sums it up and says whether there is any", () => {
    const a = normalizeActivityAfter({ form_days: 2, reinforcement_count: 1, reinforcement_sar: "45", automatic_count: 2, automatic_sar: "60", first_day: "2026-10-21", last_day: "2026-10-26" });
    expect(a).toMatchObject({ formDays: 2, reinforcementSar: 45, automaticSar: 60, totalSar: 105, any: true, firstDay: "2026-10-21" });
    expect(normalizeActivityAfter({ form_days: 0, reinforcement_count: 0, automatic_count: 0 }).any).toBe(false);
    expect(normalizeActivityAfter(undefined).any).toBe(false);
  });
});
