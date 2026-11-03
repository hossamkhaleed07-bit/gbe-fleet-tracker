// RCA "Need to follow" rules and its date filter (see rcaFollowup.js).
import { describe, expect, it } from "vitest";
import { buildDriverComparison } from "./calc";
import { buildRcaRows, endFormIssues, mergeMidnightShifts, riyadhDate, riyadhYesterday } from "./rcaFollowup";

const PROJECT = "P1";
const drivers = [
  { identity_number: "A", full_name: "Ali", project: PROJECT, is_active: true },
  { identity_number: "B", full_name: "Badr", project: PROJECT, is_active: true },
  { identity_number: "C", full_name: "Sami", project: PROJECT, is_active: true },
];
const driverProjects = Object.fromEntries(drivers.map(d => [d.identity_number, d.project]));

const start = (id, day, extra = {}) => ({
  identity_number: id, shift_date: day, shift_type: "start", odo_reading: 1000,
  created_at: `${day}T05:00:00Z`, ...extra,
});
const end = (id, day, extra = {}) => ({
  identity_number: id, shift_date: day, shift_type: "end", odo_reading: 1150,
  odo_photo_url: "https://x/odo.jpg", client_screenshot_url: "https://x/client.jpg",
  cod_delivered: 10, ppd_delivered: 5, picked_up: 0,
  created_at: `${day}T15:00:00Z`, ...extra,
});

function rcaRows(entries, { from, to, status = "followup", reasons = [] }) {
  const groups = buildDriverComparison(entries, driverProjects);
  const reasonKeys = new Set(reasons);
  return buildRcaRows({
    groups, drivers, from, to, status, project: PROJECT,
    hasReason: g => reasonKeys.has(`${g.identity_number}|${g.day}`),
  });
}
const keys = rows => rows.map(r => `${r.identity_number}|${r.day}`).sort();

describe("Need to follow and the end-of-shift form", () => {
  const day = "2026-11-01";

  it("a complete, valid form takes the driver out of the filter, even with a reason on file", () => {
    const entries = [start("A", day), end("A", day), start("B", day), end("B", day), start("C", day), end("C", day)];
    expect(rcaRows(entries, { from: day, to: day, reasons: [`A|${day}`] })).toEqual([]);
    const all = rcaRows(entries, { from: day, to: day, status: "all", reasons: [`A|${day}`] });
    expect(all.find(r => r.identity_number === "A")).toMatchObject({ formComplete: true, reviewedComplete: true });
  });

  it("an incomplete form keeps the driver in the filter with the reason", () => {
    const entries = [
      start("A", day), end("A", day, { odo_photo_url: null }),
      start("B", day), end("B", day, { cod_delivered: null }),
      start("C", day, { odo_reading: 2000 }), end("C", day, { odo_reading: 2000 }),
    ];
    const rows = rcaRows(entries, { from: day, to: day });
    expect(keys(rows)).toEqual([`A|${day}`, `B|${day}`, `C|${day}`]);
    const issues = Object.fromEntries(rows.map(r => [r.identity_number, r.issues]));
    expect(issues).toEqual({ A: ["missing_odo_photo"], B: ["missing_cod"], C: ["odo_not_increasing"] });
  });

  it("zero counts are filled in, not missing", () => {
    expect(endFormIssues({ start: start("A", day), end: end("A", day, { cod_delivered: 0, ppd_delivered: 0, picked_up: 0 }) })).toEqual([]);
  });

  it("a driver who submitted nothing stays as Non Submitted; Start Only stays too", () => {
    const rows = rcaRows([start("A", day), end("A", day), start("B", day)], { from: day, to: day });
    expect(keys(rows)).toEqual([`B|${day}`, `C|${day}`]);
    expect(rows.find(r => r.identity_number === "C")).toMatchObject({ synthetic: true });
    expect(rows.find(r => r.identity_number === "B").issues).toEqual(["no_end"]);
  });
});

describe("RCA date filter", () => {
  const entries = [
    start("A", "2026-10-31"),
    start("A", "2026-11-01"),
    start("A", "2026-11-02"),
    start("A", "2026-11-03"),
  ];
  const completeOthers = ["2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03"]
    .flatMap(d => [start("B", d), end("B", d), start("C", d), end("C", d)]);

  it("a single day shows only that day", () => {
    expect(keys(rcaRows([...entries, ...completeOthers], { from: "2026-11-01", to: "2026-11-01" }))).toEqual(["A|2026-11-01"]);
  });

  it("a range includes its first and last day and nothing outside", () => {
    expect(keys(rcaRows([...entries, ...completeOthers], { from: "2026-11-01", to: "2026-11-02" })))
      .toEqual(["A|2026-11-01", "A|2026-11-02"]);
  });

  it("Non Submitted rows follow the same range", () => {
    expect(keys(rcaRows([], { from: "2026-11-01", to: "2026-11-02", status: "missing" }))).toEqual([
      "A|2026-11-01", "A|2026-11-02", "B|2026-11-01", "B|2026-11-02", "C|2026-11-01", "C|2026-11-02",
    ]);
  });

  it("a shift closed after midnight counts on its start day", () => {
    // Start Nov 1; end entered with date Nov 2 at 01:30 Riyadh (22:30 UTC Nov 1).
    const night = [start("A", "2026-11-01"), end("A", "2026-11-02", { created_at: "2026-11-01T22:30:00Z" })];
    const others = ["2026-11-01", "2026-11-02"].flatMap(d => [start("B", d), end("B", d), start("C", d), end("C", d)]);
    const rows = rcaRows([...night, ...others], { from: "2026-11-01", to: "2026-11-01", status: "all" });
    const a = rows.filter(r => r.identity_number === "A");
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ day: "2026-11-01", formComplete: true, endSubmittedNextDay: true });
    // Out of Need to follow for Nov 1, and no End Only row left on Nov 2.
    expect(rcaRows([...night, ...others], { from: "2026-11-01", to: "2026-11-01" })).toEqual([]);
    expect(rcaRows([...night, ...others], { from: "2026-11-02", to: "2026-11-02", status: "end_only" })).toEqual([]);
  });

  it("an end submitted late the next morning is not merged", () => {
    const groups = buildDriverComparison(
      [start("A", "2026-11-01"), end("A", "2026-11-02", { created_at: "2026-11-02T07:00:00Z" })], driverProjects,
    );
    expect(mergeMidnightShifts(groups)).toHaveLength(2);
  });

  it("dates are taken in Saudi time", () => {
    expect(riyadhDate("2026-10-31T22:30:00Z")).toBe("2026-11-01");
    expect(riyadhDate("2026-10-31T20:59:00Z")).toBe("2026-10-31");
    // 00:30 Riyadh on Nov 3 → yesterday is Nov 2, whatever the machine's timezone.
    expect(riyadhYesterday(new Date("2026-11-02T21:30:00Z"))).toBe("2026-11-02");
  });
});
