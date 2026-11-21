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

// buildGroupMetrics() needs a vehicle-rates/station-rates ctx to compute its
// "expected fuel" estimate — we only ever read .dist/.delivered from it here
// (this feature's own fuel figures come from reinforcement/automatic rows
// directly, not that estimate), so an all-empty ctx is safe and correct.
const METRICS_CTX = { vehicleRates: {}, vehicleFuelTypes: {}, stationRates: {}, vehicleEndHistory: {}, approvedFuelByKey: {}, automaticFuelByKey: {} };

// Project key for activity under an ID that is not in the drivers list and has
// no project saved on any of its rows: shown on its own card so no money is lost.
export const UNLISTED_PROJECT = "__unlisted";

// The last day with any activity per driver: shift forms, approved
// reinforcement, automatic fuel (not voided).  Used as "last working day" for
// a driver who left (no deactivation date is stored yet).
export function buildLastActivityByDriver({ shiftRows = [], reinforcementRows = [], automaticFuelRows = [] }) {
  const last = {};
  const see = (idn, day) => { if (idn && day && (!last[idn] || day > last[idn])) last[idn] = day; };
  for (const r of shiftRows) see(r.identity_number, r.shift_date);
  for (const r of reinforcementRows) if (r.status === "approved") see(r.identity_number, r.shift_date);
  for (const r of automaticFuelRows) see(r.identity_number, r.allocation_date);
  return last;
}

// Who is in a month's report: every ACTIVE driver of the listed projects (as
// before), plus every driver with activity in [from, to] (a shift form, approved
// reinforcement or automatic fuel), active or not, plus activity under an ID
// that is not in the drivers list.  Project = the driver's current project; an
// unlisted ID takes the project saved on its automatic fuel rows, else
// UNLISTED_PROJECT (listed only when `projects` includes it).  Each entry carries left / lastWorkingDay / notInList.
export function selectPerfDrivers(drivers, compareGroups, reinforcementRows, automaticFuelRows, from, to, { projects, lastActivityByDriver = {} } = {}) {
  const active = new Map();     // idn -> true (activity in range)
  const savedProject = {};      // unlisted ID -> project on its automatic fuel rows
  for (const g of compareGroups) if (inRange(g.day, from, to) && (g.start || g.end)) active.set(g.identity_number, true);
  for (const r of reinforcementRows) if (r.status === "approved" && r.shift_date && inRange(r.shift_date, from, to)) active.set(r.identity_number, true);
  for (const r of automaticFuelRows) {
    if (!r.allocation_date || !inRange(r.allocation_date, from, to)) continue;
    active.set(r.identity_number, true);
    if (r.project && !savedProject[r.identity_number]) savedProject[r.identity_number] = r.project;
  }
  const inProjects = (p) => !projects || projects.includes(p);
  const out = [];
  const known = new Set();
  for (const d of drivers) {
    known.add(d.identity_number);
    if (!inProjects(d.project)) continue;
    if (d.is_active) { out.push({ ...d, left: false, notInList: false, lastWorkingDay: null }); continue; }
    if (!active.has(d.identity_number)) continue;   // left, and nothing this month (incl. after leaving)
    // last working day: the one recorded when the driver was deactivated
    // (migration 065), else the last day with any activity
    const lastActivity = lastActivityByDriver[d.identity_number] || null;
    out.push({
      ...d, left: true, notInList: false,
      lastWorkingDay: d.last_working_day || lastActivity,
      activityAfterLeaving: !!(d.last_working_day && lastActivity && lastActivity > d.last_working_day),
    });
  }
  for (const idn of active.keys()) {
    if (!idn || known.has(idn)) continue;
    const project = savedProject[idn] || UNLISTED_PROJECT;
    if (!inProjects(project)) continue;   // UNLISTED_PROJECT only where asked for (the overview)
    out.push({ identity_number: idn, full_name: null, project, is_active: false, left: false, notInList: true, lastWorkingDay: null });
  }
  return out;
}

// One row per driver: total fuel cost, distance, deliveries, working/off days
// and the efficiency ratios derived from them, all scoped to [from, to].
export function buildDriverPerfRows(drivers, compareGroups, reinforcementRows, automaticFuelRows, attendanceRows, from, to) {
  const byDriver = {};
  for (const d of drivers) {
    byDriver[d.identity_number] = {
      identity_number: d.identity_number,
      full_name: d.full_name,
      project: d.project,
      left: !!d.left,
      notInList: !!d.notInList,
      lastWorkingDay: d.lastWorkingDay || null,
      activityAfterLeaving: !!d.activityAfterLeaving,
      totalFuel: 0,
      totalDist: 0,
      totalDelivered: 0,
      excludedDays: 0,
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
    if (row) row.totalFuel += Number(r.amount || 0) + Number(r.loan_adjustment || 0);
  }
  for (const r of automaticFuelRows) {
    if (!inRange(r.allocation_date, from, to)) continue;
    const row = byDriver[r.identity_number];
    if (row) row.totalFuel += Number(r.amount || 0);
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
    for (const g of groups) {
      if (g.start?.odo_reading != null) readings.push(g.start.odo_reading);
      if (g.end?.odo_reading != null) readings.push(g.end.odo_reading);
      if (g.start || g.end) workingDaySet.add(g.day);
      const m = buildGroupMetrics(g, METRICS_CTX);
      if (m.distCounted != null) row.totalDist += m.distCounted;
      if (m.distInvalid) row.excludedDays++;
      if (m.delivered !== "—") row.totalDelivered += Number(m.delivered);
    }
    row.startOdo = readings.length ? readings[0] : null;
    row.endOdo = readings.length ? readings[readings.length - 1] : null;
    row.workingDays = workingDaySet.size;

    // Days off: not for an unlisted ID (it has no attendance), and for a driver
    // who left only up to the last working day (later days are not "off").
    const offTo = row.left && row.lastWorkingDay && row.lastWorkingDay < to ? row.lastWorkingDay : to;
    if (from && to && !row.notInList) {
      const d = new Date(from + "T00:00:00Z");
      const endD = new Date(offTo + "T00:00:00Z");
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
    hasActivity: row.workingDays > 0 || row.totalFuel !== 0 || row.totalDelivered > 0,
    fuelPerKm: safeDiv(row.totalFuel, row.totalDist),
    fuelPerShipment: safeDiv(row.totalFuel, row.totalDelivered),
    avgKmPerDay: safeDiv(row.totalDist, row.workingDays),
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
  // Drivers with activity in the period (a form, fuel or shipments), and of
  // those, how many have left.  Active drivers with no activity are not counted.
  const withActivity = rows.filter(r => r.hasActivity ?? true);
  const activeDrivers = withActivity.length;
  const leftDrivers = withActivity.filter(r => r.left).length;
  const notInListDrivers = withActivity.filter(r => r.notInList).length;
  return {
    totalFuel, totalDist, totalDelivered, excludedDays, activeDrivers, leftDrivers, notInListDrivers,
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

// Display name: the driver's name, or a label for activity under an unknown ID.
export const perfDriverName = (row, t) => (row?.notInList ? t("driverPerformance.notInList") : row?.full_name || row?.identity_number || "—");

// CSV of a project's driver rows (Driver Performance project page).
export const PERF_CSV_KEYS = [
  "full_name", "identity_number", "status", "last_working_day", "total_fuel_sar", "total_km", "shipments",
  "fuel_per_km", "fuel_per_shipment", "avg_km_per_day", "working_days", "days_off",
];
export function perfCsvRows(rows) {
  return rows.map(r => ({
    full_name: r.notInList ? "" : (r.full_name || ""),
    identity_number: r.identity_number,
    status: r.notInList ? "not in driver list" : r.left ? "left" : "active",
    last_working_day: r.left ? (r.lastWorkingDay || "") : "",
    total_fuel_sar: r.totalFuel.toFixed(2),
    total_km: r.totalDist.toFixed(0),
    shipments: r.totalDelivered,
    fuel_per_km: r.fuelPerKm.toFixed(2),
    fuel_per_shipment: r.fuelPerShipment.toFixed(2),
    avg_km_per_day: r.avgKmPerDay.toFixed(1),
    working_days: r.workingDays,
    days_off: r.daysOff,
  }));
}
