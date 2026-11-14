// Driver Performance: project list, daily distance limits, and the start/end choice
// for a day with more than one submission.  Synthetic data only.
import { describe, expect, it } from "vitest";
import { buildDriverComparison, buildGroupMetrics, dailyDistance } from "./calc";
import { MAX_JUMP_KM_PER_DAY, PROJECT_LIST } from "./constants";
import { buildDriverPerfRows, buildProjectSummary, formatDailyFuelPerKm } from "./driverPerformance";

const CTX = { vehicleRates: {}, vehicleFuelTypes: {}, stationRates: {}, vehicleEndHistory: {}, approvedFuelByKey: {}, automaticFuelByKey: {} };
const entry = (id, day, type, odo, at) => ({ identity_number: id, shift_date: day, shift_type: type, odo_reading: odo, created_at: `${day}T${at}:00Z` });

describe("project list", () => {
  it("Driver Performance uses the shared list, which includes JDL", () => {
    expect(PROJECT_LIST).toContain("JDL");
    expect(PROJECT_LIST).toEqual(expect.arrayContaining(["ADM", "FDP", "LMS", "MGF"]));
  });
});

describe("dailyDistance", () => {
  it("counts 0 up to the limit, inclusive", () => {
    expect(dailyDistance(100, 100)).toEqual({ km: 0, valid: true, reason: null });
    expect(dailyDistance(100, 100 + MAX_JUMP_KM_PER_DAY)).toMatchObject({ km: 1500, valid: true });
  });
  it("never counts a negative delta or one above 1500 km, but keeps the number entered", () => {
    expect(dailyDistance(407842, 40954)).toEqual({ km: -366888, valid: false, reason: "negative" });
    expect(dailyDistance(172227, 1723422)).toEqual({ km: 1551195, valid: false, reason: "tooLarge" });
    expect(dailyDistance(100, 1601)).toMatchObject({ valid: false, reason: "tooLarge" });
  });
  it("is missing when a reading is missing", () => {
    expect(dailyDistance(null, 5)).toMatchObject({ km: null, valid: false, reason: "missing" });
  });
  it("buildGroupMetrics shows the wrong reading but counts nothing for it", () => {
    const m = buildGroupMetrics({ start: { odo_reading: 1000 }, end: { odo_reading: 900 } }, CTX);
    expect(m.dist).toBe(-100);
    expect(m.distCounted).toBeNull();
    expect(m.distInvalid).toBe(true);
    expect(m.fuelLiters).toBe("—"); // no expected-fuel estimate from a wrong distance
  });
});

describe("a day with more than one submission", () => {
  it("runs from the earliest start to the latest end, whatever the row order", () => {
    const rows = [
      entry("A", "2026-11-02", "start", 190700, "06:00"),
      entry("A", "2026-11-02", "start", 190708, "06:30"), // second start, later
      entry("A", "2026-11-02", "end", 190690, "16:00"),   // first end, wrong
      entry("A", "2026-11-02", "end", 190840, "18:00"),   // later end
    ];
    for (const order of [rows, rows.slice().reverse()]) {
      const [g] = buildDriverComparison(order, { A: "LMS" });
      expect(g.start.odo_reading).toBe(190700);
      expect(g.end.odo_reading).toBe(190840);
      expect(buildGroupMetrics(g, CTX).distCounted).toBe(140);
    }
  });
});

describe("driver performance totals", () => {
  it("leave wrong readings out and count them as excluded days", () => {
    const rows = [
      entry("A", "2026-11-03", "start", 172000, "06:00"), entry("A", "2026-11-03", "end", 172227, "18:00"), // 227 km
      entry("A", "2026-11-04", "start", 172227, "06:00"), entry("A", "2026-11-04", "end", 1723422, "18:00"), // typo
      entry("B", "2026-11-07", "start", 407842, "06:00"), entry("B", "2026-11-07", "end", 40954, "18:00"),   // typo
      entry("B", "2026-11-08", "start", 40954, "06:00"), entry("B", "2026-11-08", "end", 41100, "18:00"),    // 146 km
    ];
    const drivers = [{ identity_number: "A", project: "LMS" }, { identity_number: "B", project: "FDP" }];
    const groups = buildDriverComparison(rows, { A: "LMS", B: "FDP" });
    const perf = buildDriverPerfRows(drivers, groups, [], [], [], "2026-11-01", "2026-11-30");
    const a = perf.find(r => r.identity_number === "A");
    const b = perf.find(r => r.identity_number === "B");
    expect([a.totalDist, a.excludedDays]).toEqual([227, 1]);
    expect([b.totalDist, b.excludedDays]).toEqual([146, 1]);
    const summary = buildProjectSummary(perf);
    expect(summary.totalDist).toBe(373);
    expect(summary.excludedDays).toBe(2);
    expect(summary.totalDist).toBeGreaterThanOrEqual(0);
  });

  it("a project with no active drivers summarises to zero drivers", () => {
    expect(buildProjectSummary([]).activeDrivers).toBe(0);
  });
});

describe("daily Fuel/KM display", () => {
  it("shows a dash on a day with no counted distance", () => {
    expect(formatDailyFuelPerKm(0, 0)).toBe("—");
  });
  it("shows 2 decimals on a day with distance", () => {
    expect(formatDailyFuelPerKm(30 / 64, 64)).toBe("0.47");
  });
});
