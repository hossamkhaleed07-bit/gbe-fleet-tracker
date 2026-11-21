// Driver Performance: project list, daily distance limits, and the start/end choice
// for a day with more than one submission.  Synthetic data only.
import { describe, expect, it } from "vitest";
import { buildDriverComparison, buildGroupMetrics, dailyDistance } from "./calc";
import { MAX_JUMP_KM_PER_DAY, PROJECT_LIST } from "./constants";
import {
  attachDailyFuel, buildDriverPerfRows, buildLastActivityByDriver, buildProjectSummary, formatDailyFuelPerKm, perfCsvRows,
  perfDriverName, selectPerfDrivers, UNLISTED_PROJECT,
} from "./driverPerformance";

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

describe("drivers who left and IDs not in the driver list", () => {
  const FROM = "2026-10-01";
  const TO = "2026-10-31";
  const drivers = [
    { identity_number: "A1", full_name: "Active one", project: "FDP", is_active: true },
    { identity_number: "A2", full_name: "Active idle", project: "FDP", is_active: true },
    { identity_number: "L1", full_name: "Left in October", project: "FDP", is_active: false },
    { identity_number: "L2", full_name: "Left in September", project: "FDP", is_active: false },
    { identity_number: "J1", full_name: "Other project", project: "JDL", is_active: false },
  ];
  const group = (id, day, start, end, delivered = 0) => ({
    identity_number: id, day, project: "FDP",
    start: { odo_reading: start }, end: { odo_reading: end, cod_delivered: delivered, ppd_delivered: 0 },
  });
  const groups = [
    group("A1", "2026-10-02", 100, 200, 10),
    group("L1", "2026-10-03", 500, 650, 7),
    group("L1", "2026-10-10", 650, 700, 3),
    { identity_number: "X9", day: "2026-10-04", project: null, start: { odo_reading: 1 }, end: { odo_reading: 41, cod_delivered: 2, ppd_delivered: 0 } },
  ];
  const reinforcement = [
    { identity_number: "L1", shift_date: "2026-10-10", amount: 50, loan_adjustment: -5, status: "approved" },
    { identity_number: "L2", shift_date: "2026-09-20", amount: 40, status: "approved" },
    { identity_number: "L2", shift_date: "2026-10-05", amount: 40, status: "pending" },   // not approved: no activity
  ];
  const automatic = [
    { identity_number: "A1", allocation_date: "2026-10-02", amount: 20, project: "FDP" },
    { identity_number: "L1", allocation_date: "2026-10-03", amount: 20, project: "FDP" },
    { identity_number: "Y8", allocation_date: "2026-10-06", amount: 20, project: "FDP" },  // unknown ID, project saved on the row
  ];
  const last = buildLastActivityByDriver({ shiftRows: [{ identity_number: "L1", shift_date: "2026-10-10" }], reinforcementRows: reinforcement, automaticFuelRows: automatic });
  const pick = (projects) => selectPerfDrivers(drivers, groups, reinforcement, automatic, FROM, TO, { projects, lastActivityByDriver: last });

  it("last working day = the last day with any activity (pending reinforcement does not count)", () => {
    expect(last.L1).toBe("2026-10-10");
    expect(last.L2).toBe("2026-09-20");
  });

  it("includes every active driver, drivers who left with activity this month, and unknown IDs", () => {
    const got = pick(["FDP", "JDL", UNLISTED_PROJECT]).map(d => [d.identity_number, d.project, d.left, d.notInList, d.lastWorkingDay]);
    expect(got).toEqual([
      ["A1", "FDP", false, false, null],
      ["A2", "FDP", false, false, null],
      ["L1", "FDP", true, false, "2026-10-10"],
      ["X9", UNLISTED_PROJECT, false, true, null],   // shift form only: no project known
      ["Y8", "FDP", false, true, null],              // project from its automatic fuel row
    ]);
  });

  it("a driver who left does not appear in a month with no activity", () => {
    const sept = selectPerfDrivers(drivers, [], reinforcement, [], "2026-09-01", "2026-09-30", { projects: ["FDP"], lastActivityByDriver: last });
    expect(sept.map(d => d.identity_number)).toEqual(["A1", "A2", "L2"]);
    const nov = selectPerfDrivers(drivers, [], reinforcement, [], "2026-11-01", "2026-11-30", { projects: ["FDP"], lastActivityByDriver: last });
    expect(nov.map(d => d.identity_number)).toEqual(["A1", "A2"]);
  });

  it("their fuel, km and shipments count in the project totals; the card counts drivers with activity", () => {
    const rows = buildDriverPerfRows(pick(["FDP", UNLISTED_PROJECT]), groups, reinforcement, automatic, [], FROM, TO);
    const fdp = buildProjectSummary(rows.filter(r => r.project === "FDP"));
    expect(fdp.totalFuel).toBe(20 + 20 + 45 + 20);          // A1 auto, L1 auto + reinforcement, Y8 auto
    expect(fdp.totalDist).toBe(100 + 150 + 50);
    expect(fdp.totalDelivered).toBe(10 + 7 + 3);
    expect([fdp.activeDrivers, fdp.leftDrivers, fdp.notInListDrivers]).toEqual([3, 1, 1]);   // A2 had no activity
    const unlisted = buildProjectSummary(rows.filter(r => r.project === UNLISTED_PROJECT));
    expect([unlisted.totalDist, unlisted.totalDelivered, unlisted.activeDrivers]).toEqual([40, 2, 1]);
  });

  it("days off for a driver who left stop at the last working day; none for an unknown ID", () => {
    const rows = buildDriverPerfRows(pick(["FDP"]), groups, reinforcement, automatic, [], FROM, TO);
    const byId = Object.fromEntries(rows.map(r => [r.identity_number, r]));
    expect(byId.L1.daysOff).toBe(8);     // 1..10 Oct without a form: 8 days (A), nothing after the 10th
    expect(byId.Y8.daysOff).toBe(0);
  });

  it("names, and the CSV marks each driver's status", () => {
    const t = (k) => ({ "driverPerformance.notInList": "Not in driver list" }[k] || k);
    const rows = buildDriverPerfRows(pick(["FDP"]), groups, reinforcement, automatic, [], FROM, TO);
    expect(perfDriverName(rows.find(r => r.identity_number === "Y8"), t)).toBe("Not in driver list");
    const csv = perfCsvRows(rows);
    expect(csv.map(r => [r.status, r.last_working_day])).toEqual([
      ["active", ""], ["active", ""], ["left", "2026-10-10"], ["not in driver list", ""],
    ]);
    // a project page never shows an ID with no known project
    expect(pick(["FDP"]).some(d => d.project === UNLISTED_PROJECT)).toBe(false);
    expect(csv.find(r => r.status === "left").total_fuel_sar).toBe("65.00");
  });
});
