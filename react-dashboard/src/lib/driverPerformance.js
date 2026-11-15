// Calculation layer for the Driver Performance analytics feature
// (Driver Performance → project → driver → daily detail).
//
// "Fuel" throughout this module means MONEY (SAR) — approved reinforcement
// (actual) + automatic (FDP) allocations — the same "Total Fuel Cost"
// definition already used everywhere else in the dashboard. It is NOT an
// estimate from distance/vehicle-efficiency (that estimate exists elsewhere
// as "Expected Fuel", a different, already-distinct concept).
import { buildGroupMetrics, formatLocalDate } from "./calc";
import { deriveAttendanceStatus, OFF_CODES } from "./attendanceCodes";

export function monthBounds(monthStr) {
  const [y, m] = monthStr.split("-").map(Number);
  const from = `${monthStr}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const to = `${monthStr}-${String(lastDay).padStart(2, "0")}`;
  return { from, to };
}

export function formatMonthLabel(monthStr, lang) {
  const [y, m] = monthStr.split("-");
  return new Date(`${y}-${m}-01T00:00:00Z`)
    .toLocaleDateString(lang === "ar" ? "ar-EG" : "en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function addMonths(monthStr, delta) {
  const [y, m] = monthStr.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function inRange(dateStr, from, to) {
  return (!from || dateStr >= from) && (!to || dateStr <= to);
}

function safeDiv(a, b) {
  return b > 0 ? a / b : 0;
}

// buildGroupMetrics() needs a vehicle-rates/station-rates ctx for its
// "expected fuel" estimate. The daily table only reads .dist/.delivered from
// it, so an all-empty ctx is enough there; the driver totals pass the real
// rates (see buildDriverPerfRows) to add up Expected Fuel.
const METRICS_CTX = { vehicleRates: {}, vehicleFuelTypes: {}, stationRates: {}, vehicleEndHistory: {}, approvedFuelByKey: {}, automaticFuelByKey: {} };

// Actual fuel more than this % above expected is shown as an alert.
export const FUEL_DIFF_ALERT_PCT = 20;

export function isFuelDiffHigh(pct) {
  return pct != null && pct > FUEL_DIFF_ALERT_PCT;
}

// The Difference is only trusted (and can turn red) when enough of the month
// was measured: at least this share of shift days with a valid distance and an
// expected cost, and at least this many measured km. Otherwise "not enough data".
// Checked on Sep–Oct 2026: median Difference 0% for driver-months that pass.
export const MIN_MEASURED_COVERAGE = 0.8;
export const MIN_MEASURED_KM = 300;

export function hasEnoughFuelData(measuredDays, shiftDays, measuredKm) {
  return shiftDays > 0 && measuredDays / shiftDays >= MIN_MEASURED_COVERAGE && measuredKm >= MIN_MEASURED_KM;
}

// Difference (actual − expected) as a % of expected; null when nothing is expected.
function diffPct(actual, expected) {
  return expected > 0 ? ((actual - expected) / expected) * 100 : null;
}

// One row per driver: total fuel cost, distance, deliveries, working/off days
// and the efficiency ratios derived from them, all scoped to [from, to].
//
// Expected Fuel (rates = { vehicleRates, vehicleFuelTypes, stationRates }) is
// compared on MEASURED DAYS only: driver-days with a counted distance and a
// known expected cost. A day with a wrong odometer reading, a missing start or
// end reading, or fuel but no shift has no expected fuel, so its actual fuel is
// left out of the comparison too (measuredFuel) and reported as unmeasuredFuel.
// totalFuel stays every fuel row in [from, to].
export function buildDriverPerfRows(drivers, compareGroups, reinforcementRows, automaticFuelRows, attendanceRows, from, to, rates = {}) {
  const metricsCtx = { ...METRICS_CTX, ...rates };
  const fuelByKey = {};
  const addFuel = (id, day, amount) => {
    const k = `${id}|${day}`;
    fuelByKey[k] = (fuelByKey[k] || 0) + amount;
  };
  const byDriver = {};
  for (const d of drivers) {
    byDriver[d.identity_number] = {
      identity_number: d.identity_number,
      full_name: d.full_name,
      project: d.project,
      totalFuel: 0,
      totalDist: 0,
      totalDelivered: 0,
      excludedDays: 0,
      expectedFuel: 0,
      measuredFuel: 0,
      measuredDays: 0,
      measuredKm: 0,
      workingDays: 0,
      daysOff: 0,
      startOdo: null,
      endOdo: null,
    };
  }

  for (const r of reinforcementRows) {
    if (r.status !== "approved") continue;
    if (!inRange(r.shift_date, from, to)) continue;
    const row = byDriver[r.identity_number];
    if (!row) continue;
    const amount = Number(r.amount || 0) + Number(r.loan_adjustment || 0);
    row.totalFuel += amount;
    addFuel(r.identity_number, r.shift_date, amount);
  }
  for (const r of automaticFuelRows) {
    if (!inRange(r.allocation_date, from, to)) continue;
    const row = byDriver[r.identity_number];
    if (!row) continue;
    row.totalFuel += Number(r.amount || 0);
    addFuel(r.identity_number, r.allocation_date, Number(r.amount || 0));
  }

  const groupsByDriver = {};
  for (const g of compareGroups) {
    if (!inRange(g.day, from, to)) continue;
    (groupsByDriver[g.identity_number] ||= []).push(g);
  }

  const attByKey = {};
  for (const r of attendanceRows) {
    if (!inRange(r.attendance_date, from, to)) continue;
    attByKey[`${r.identity_number}|${r.attendance_date}`] = r.status;
  }
  const today = formatLocalDate(new Date().toISOString());

  for (const identity_number in byDriver) {
    const row = byDriver[identity_number];
    const groups = (groupsByDriver[identity_number] || []).slice().sort((a, b) => a.day.localeCompare(b.day));

    const readings = [];
    const workingDaySet = new Set();
    const measuredDays = new Set();
    for (const g of groups) {
      if (g.start?.odo_reading != null) readings.push(g.start.odo_reading);
      if (g.end?.odo_reading != null) readings.push(g.end.odo_reading);
      if (g.start || g.end) workingDaySet.add(g.day);
      const m = buildGroupMetrics(g, metricsCtx);
      if (m.distCounted != null) row.totalDist += m.distCounted;
      if (m.distCounted != null && m.fuelCost !== "—") {
        row.expectedFuel += Number(m.fuelCost);
        row.measuredKm += m.distCounted;
        measuredDays.add(g.day);
      }
      if (m.distInvalid) row.excludedDays++;
      if (m.delivered !== "—") row.totalDelivered += Number(m.delivered);
    }
    row.startOdo = readings.length ? readings[0] : null;
    row.endOdo = readings.length ? readings[readings.length - 1] : null;
    row.workingDays = workingDaySet.size;
    row.measuredDays = measuredDays.size;
    for (const day of measuredDays) row.measuredFuel += fuelByKey[`${identity_number}|${day}`] || 0;

    if (from && to) {
      const d = new Date(from + "T00:00:00Z");
      const endD = new Date(to + "T00:00:00Z");
      let count = 0;
      while (d <= endD && count < 62) {
        const day = d.toISOString().slice(0, 10);
        const st = deriveAttendanceStatus({
          explicitStatus: attByKey[`${identity_number}|${day}`],
          hasShiftEntry: workingDaySet.has(day),
          day, today,
        });
        if (OFF_CODES.has(st)) row.daysOff++;
        d.setUTCDate(d.getUTCDate() + 1);
        count++;
      }
    }
  }

  return Object.values(byDriver).map(row => ({
    ...row,
    fuelPerKm: safeDiv(row.totalFuel, row.totalDist),
    fuelPerShipment: safeDiv(row.totalFuel, row.totalDelivered),
    avgKmPerDay: safeDiv(row.totalDist, row.workingDays),
    unmeasuredFuel: row.totalFuel - row.measuredFuel,
    fuelDiff: row.measuredFuel - row.expectedFuel,
    fuelDiffPct: diffPct(row.measuredFuel, row.expectedFuel),
    coverage: safeDiv(row.measuredDays, row.workingDays),
    enoughData: hasEnoughFuelData(row.measuredDays, row.workingDays, row.measuredKm),
  }));
}

// Aggregates a set of already-built driver rows (see above) into one
// project-level summary — used both for the project overview cards and the top of
// each project's detail page.
export function buildProjectSummary(rows) {
  const totalFuel = rows.reduce((s, r) => s + r.totalFuel, 0);
  const totalDist = rows.reduce((s, r) => s + r.totalDist, 0);
  const totalDelivered = rows.reduce((s, r) => s + r.totalDelivered, 0);
  const excludedDays = rows.reduce((s, r) => s + r.excludedDays, 0);
  const expectedFuel = rows.reduce((s, r) => s + (r.expectedFuel || 0), 0);
  const measuredFuel = rows.reduce((s, r) => s + (r.measuredFuel || 0), 0);
  const measuredDays = rows.reduce((s, r) => s + (r.measuredDays || 0), 0);
  const measuredKm = rows.reduce((s, r) => s + (r.measuredKm || 0), 0);
  const shiftDays = rows.reduce((s, r) => s + (r.workingDays || 0), 0);
  const activeDrivers = rows.length;
  return {
    totalFuel, totalDist, totalDelivered, excludedDays, activeDrivers,
    expectedFuel, measuredFuel,
    unmeasuredFuel: totalFuel - measuredFuel,
    fuelDiff: measuredFuel - expectedFuel,
    fuelDiffPct: diffPct(measuredFuel, expectedFuel),
    measuredDays, measuredKm,
    coverage: safeDiv(measuredDays, shiftDays),
    enoughData: hasEnoughFuelData(measuredDays, shiftDays, measuredKm),
    avgFuelPerDriver: safeDiv(totalFuel, activeDrivers),
    avgFuelPerShipment: safeDiv(totalFuel, totalDelivered),
    avgFuelPerKm: safeDiv(totalFuel, totalDist),
  };
}

// Per-day breakdown for a single driver (Driver Detail page).
export function buildDriverDailyRows(compareGroups, identityNumber, from, to) {
  return compareGroups
    .filter(g => g.identity_number === identityNumber && inRange(g.day, from, to))
    .slice()
    .sort((a, b) => a.day.localeCompare(b.day))
    .map(g => {
      const m = buildGroupMetrics(g, METRICS_CTX);
      return {
        day: g.day,
        startOdo: g.start?.odo_reading ?? null,
        endOdo: g.end?.odo_reading ?? null,
        // a wrong reading counts as 0 km; the difference as entered is kept to show it
        dist: m.distCounted ?? 0,
        enteredDist: typeof m.dist === "number" ? m.dist : null,
        distInvalid: m.distInvalid,
        delivered: m.delivered !== "—" ? Number(m.delivered) : 0,
      };
    });
}

// Attaches each day's fuel cost (reinforcement + automatic) to the daily rows
// above, and each day's fuel/km — called separately since fuel isn't part of
// buildGroupMetrics's "cost" fields the way this feature defines fuel.
//
// Fuel dated on a day with no shift entry (e.g. FDP automatic fuel on a day
// off) gets a row of its own, marked noShift, so the table's fuel adds up to
// the driver's Total Fuel (buildDriverPerfRows counts every fuel row in
// [from, to], not only shift days). Uses the same filters as that function.
export function attachDailyFuel(dailyRows, identityNumber, reinforcementRows, automaticFuelRows, from, to) {
  const feeByDay = {};
  for (const r of reinforcementRows) {
    if (r.status !== "approved" || r.identity_number !== identityNumber) continue;
    if (!r.shift_date || !inRange(r.shift_date, from, to)) continue;
    feeByDay[r.shift_date] = (feeByDay[r.shift_date] || 0) + Number(r.amount || 0) + Number(r.loan_adjustment || 0);
  }
  for (const r of automaticFuelRows) {
    if (r.identity_number !== identityNumber) continue;
    if (!r.allocation_date || !inRange(r.allocation_date, from, to)) continue;
    feeByDay[r.allocation_date] = (feeByDay[r.allocation_date] || 0) + Number(r.amount || 0);
  }
  const shiftDays = new Set(dailyRows.map(r => r.day));
  const fuelOnlyRows = Object.keys(feeByDay)
    .filter(day => !shiftDays.has(day))
    .map(day => ({
      day, startOdo: null, endOdo: null, dist: 0, enteredDist: null, distInvalid: false, delivered: 0, noShift: true,
    }));
  return [...dailyRows, ...fuelOnlyRows]
    .sort((a, b) => a.day.localeCompare(b.day))
    .map(row => {
      const fuel = feeByDay[row.day] || 0;
      return { noShift: false, ...row, fuel, fuelPerKm: safeDiv(fuel, row.dist) };
    });
}

// Fuel/KM for one day of the Driver Detail table. A day with no counted
// distance (no movement, or a wrong odometer reading counted as 0 km) has no
// meaningful ratio, so it shows "—" rather than a misleading 0.00.
export function formatDailyFuelPerKm(fuelPerKm, dist) {
  return dist > 0 ? fuelPerKm.toFixed(2) : "—";
}

export function topN(rows, key, n = 5, ascending = false) {
  return rows.slice().sort((a, b) => ascending ? a[key] - b[key] : b[key] - a[key]).slice(0, n);
}
