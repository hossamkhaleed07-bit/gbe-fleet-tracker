// Driver Performance: project list, daily distance limits, and the start/end choice
// for a day with more than one submission.  Synthetic data only.
import { describe, expect, it } from "vitest";
import { buildDriverComparison, buildGroupMetrics, dailyDistance } from "./calc";
import { MAX_JUMP_KM_PER_DAY, PROJECT_LIST } from "./constants";
import { attachDailyFuel, buildDriverPerfRows, buildProjectSummary, formatDailyFuelPerKm, hasEnoughFuelData, isFuelDiffHigh } from "./driverPerformance";
import { expectedFuelCost } from "./calc";

const CTX = { vehicleRates: {}, vehicleFuelTypes: {}, stationRates: {}, vehicleEndHistory: {}, approvedFuelByKey: {}, automaticFuelByKey: {} };
const entry = (id, day, type, odo, at) => ({ identity_number: id, shift_date: day, shift_type: type, odo_reading: odo, created_at: `${day}T${at}:00Z` });

describe("project list", () => {
  it("Driver Performance uses the shared list, which includes JDL", () => {
    expect(PROJECT_LIST).toContain("JDL");
    expect([...PROJECT_LIST].sort()).toEqual(["ADM", "FDP", "JDL", "LMS", "MGF"]);
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

describe("daily table rows for fuel on days without a shift", () => {
  const from = "2026-11-01", to = "2026-11-30";
  const shiftDay = { day: "2026-11-03", startOdo: 100, endOdo: 131, dist: 31, enteredDist: 31, distInvalid: false, delivered: 10 };
  const reinforcement = [
    { identity_number: "A", shift_date: "2026-11-03", status: "approved", amount: 40, loan_adjustment: -10 },
    { identity_number: "A", shift_date: "2026-11-04", status: "pending", amount: 80, loan_adjustment: 0 },
  ];
  const automatic = [
    { identity_number: "A", allocation_date: "2026-11-01", amount: 20 }, // day off, no shift
    { identity_number: "A", allocation_date: "2026-11-03", amount: 20 },
    { identity_number: "A", allocation_date: "2026-10-31", amount: 20 }, // outside the month
    { identity_number: "B", allocation_date: "2026-11-02", amount: 20 }, // another driver
  ];

  const rows = attachDailyFuel([shiftDay], "A", reinforcement, automatic, from, to);

  it("adds a no-shift row for a day that only has fuel, in date order", () => {
    expect(rows.map(r => [r.day, r.noShift])).toEqual([["2026-11-01", true], ["2026-11-03", false]]);
    expect(rows[0]).toMatchObject({ fuel: 20, dist: 0, delivered: 0, startOdo: null, endOdo: null });
  });

  it("keeps the shift day's fuel (approved amount + loan adjustment + automatic)", () => {
    expect(rows[1].fuel).toBe(40 - 10 + 20);
  });

  it("makes the table add up to the driver's Total Fuel", () => {
    const [summary] = buildDriverPerfRows([{ identity_number: "A", full_name: "x", project: "FDP" }], [], reinforcement, automatic, [], from, to);
    expect(rows.reduce((s, r) => s + r.fuel, 0)).toBe(summary.totalFuel);
  });
});

describe("expected fuel, measured days only", () => {
  const from = "2026-11-01", to = "2026-11-30";
  // 10 km per litre, diesel at 2 SAR/L: 100 km = 10 L = 20 SAR expected
  const rates = { vehicleRates: { V1: 10 }, vehicleFuelTypes: { V1: "Diesel" }, stationRates: { S1: { diesel: 2, petrol: 3 } } };
  const e = (day, type, odo, at) => ({ ...entry("A", day, type, odo, at), vehicle_plate: "V1", station_name: "S1" });
  const rows = [
    e("2026-11-03", "start", 1000, "06:00"), e("2026-11-03", "end", 1100, "18:00"),     // 100 km: measured
    e("2026-11-04", "start", 1100, "06:00"), e("2026-11-04", "end", 11000, "18:00"),    // wrong reading
    e("2026-11-05", "start", 11000, "06:00"),                                         // no end reading
  ];
  const groups = buildDriverComparison(rows, { A: "FDP" });
  const fuel = [
    { identity_number: "A", shift_date: "2026-11-03", status: "approved", amount: 25, loan_adjustment: 0 },
    { identity_number: "A", shift_date: "2026-11-04", status: "approved", amount: 50, loan_adjustment: 0 },
    { identity_number: "A", shift_date: "2026-11-05", status: "approved", amount: 30, loan_adjustment: 0 },
  ];
  const automatic = [{ identity_number: "A", allocation_date: "2026-11-06", amount: 20 }]; // day off
  const driver = [{ identity_number: "A", full_name: "x", project: "FDP" }];
  const [r] = buildDriverPerfRows(driver, groups, fuel, automatic, [], from, to, rates);

  it("adds expected fuel only for days with a counted distance", () => {
    expect(r.expectedFuel).toBeCloseTo(20);
    expect(r.excludedDays).toBe(1);
  });

  it("compares only the actual fuel of those same days", () => {
    expect(r.totalFuel).toBe(25 + 50 + 30 + 20);
    expect(r.measuredFuel).toBe(25);
    expect(r.unmeasuredFuel).toBe(50 + 30 + 20);
    expect(r.fuelDiff).toBeCloseTo(5);
    expect(r.fuelDiffPct).toBeCloseTo(25);
  });

  it("adds up per project", () => {
    const s = buildProjectSummary([r, { ...r, expectedFuel: 30, measuredFuel: 30, totalFuel: 30 }]);
    expect(s.expectedFuel).toBeCloseTo(50);
    expect(s.measuredFuel).toBe(55);
    expect(s.unmeasuredFuel).toBe(155 - 55);
    expect(s.fuelDiffPct).toBeCloseTo(10);
  });

  it("has no % when nothing is expected (no rates)", () => {
    const [noRates] = buildDriverPerfRows(driver, groups, fuel, automatic, [], from, to);
    expect([noRates.expectedFuel, noRates.measuredFuel, noRates.fuelDiffPct]).toEqual([0, 0, null]);
  });

  it("counts measured days and km, and flags too little data", () => {
    expect([r.workingDays, r.measuredDays, r.measuredKm]).toEqual([3, 1, 100]);
    expect(r.coverage).toBeCloseTo(1 / 3);
    expect(r.enoughData).toBe(false);
  });

  it("needs at least 80% of shift days measured and 300 km", () => {
    expect(hasEnoughFuelData(8, 10, 300)).toBe(true);
    expect(hasEnoughFuelData(7, 10, 5000)).toBe(false); // 70% measured
    expect(hasEnoughFuelData(10, 10, 299)).toBe(false); // too few km
    expect(hasEnoughFuelData(0, 0, 0)).toBe(false);     // no shift days
  });

  it("applies the same rule to the project total", () => {
    const full = { ...r, workingDays: 10, measuredDays: 9, measuredKm: 400 };
    expect(buildProjectSummary([full]).enoughData).toBe(true);
    expect(buildProjectSummary([full, r]).coverage).toBeCloseTo(10 / 13);
    expect(buildProjectSummary([full, r]).enoughData).toBe(false);
  });

  it("alerts only above +20%", () => {
    expect([isFuelDiffHigh(20), isFuelDiffHigh(20.5), isFuelDiffHigh(-40), isFuelDiffHigh(null)]).toEqual([false, true, false, false]);
  });

  it("prices a lowercase 'diesel' vehicle as diesel", () => {
    const prices = { S1: { diesel: 2, petrol: 3 } };
    expect(expectedFuelCost("V", "10", { V: "diesel" }, "S1", prices)).toBe("20.00");
    expect(expectedFuelCost("V", "10", { V: "91" }, "S1", prices)).toBe("30.00");
  });
});
