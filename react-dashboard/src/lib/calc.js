export function localToday() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

// created_at is stored in UTC; display it in Egypt local time (Africa/Cairo,
// which correctly follows Egypt's DST rules) regardless of the viewing
// browser's own timezone setting.
const DISPLAY_TZ = "Africa/Cairo";

function localParts(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: DISPLAY_TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const get = (t) => parts.find(p => p.type === t)?.value;
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

export function formatLocalTime(iso) {
  const p = iso ? localParts(iso) : null;
  return p ? `${p.hour}:${p.minute}` : "—";
}

export function formatLocalDateTime(iso) {
  const p = iso ? localParts(iso) : null;
  return p ? `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}` : "—";
}

export function formatLocalDate(iso) {
  const p = iso ? localParts(iso) : null;
  return p ? `${p.year}-${p.month}-${p.day}` : "";
}

export function buildDriverComparison(rows, driverProjects) {
  const groups = {};
  for (const r of rows) {
    const day = r.shift_date || formatLocalDate(r.created_at);
    const key = `${r.identity_number}|${day}`;
    if (!groups[key]) {
      groups[key] = {
        day, identity_number: r.identity_number, full_name: r.full_name, vehicle_plate: r.vehicle_plate,
        project: driverProjects[r.identity_number] || null, start: null, end: null,
      };
    }
    const g = groups[key];
    if (r.full_name) g.full_name = r.full_name;
    if (r.vehicle_plate) g.vehicle_plate = r.vehicle_plate;
    if (r.shift_type === "start" && !g.start) g.start = r;
    if (r.shift_type === "end") g.end = r;
  }
  return Object.values(groups).sort((a, b) => b.day.localeCompare(a.day) || (a.full_name || "").localeCompare(b.full_name || ""));
}

export function buildStationReport(rows) {
  const groups = {};
  for (const r of rows) {
    const key = r.station_name || "غير محدد";
    if (!groups[key]) groups[key] = { station: key, total: 0, drivers: new Set(), startCount: 0, endCount: 0, ofd: 0, cod: 0, ppd: 0, picked: 0 };
    const g = groups[key];
    g.total++;
    g.drivers.add(r.identity_number);
    if (r.shift_type === "start") g.startCount++; else g.endCount++;
    g.ofd += Number(r.ofd_count) || 0;
    g.cod += Number(r.cod_delivered) || 0;
    g.ppd += Number(r.ppd_delivered) || 0;
    g.picked += Number(r.picked_up) || 0;
  }
  return Object.values(groups).map(g => ({ ...g, drivers: g.drivers.size })).sort((a, b) => b.total - a.total);
}

export function buildVehicleEndHistory(endHistoryRows) {
  const history = {};
  for (const r of endHistoryRows) {
    const day = r.shift_date || formatLocalDate(r.created_at);
    (history[r.vehicle_plate] ||= []).push({ day, odo: Number(r.odo_reading) });
  }
  for (const plate in history) history[plate].sort((a, b) => a.day.localeCompare(b.day));
  return history;
}

// Off Duty = this shift's start odometer minus the vehicle's MOST RECENT
// prior end-of-day odometer, whichever day that was — not necessarily the
// literal day before, since a driver doesn't submit every single day
// (days off, leave, gaps in service). Requiring exactly "day - 1" meant
// this was almost always "—" for any driver with a day off in between.
export function getOffDuty(g, vehicleEndHistory) {
  if (!g.start || g.start.odo_reading == null || !g.vehicle_plate) return null;
  const history = vehicleEndHistory[g.vehicle_plate];
  if (!history) return null;
  let prevEnd = null;
  for (const entry of history) {
    if (entry.day < g.day) prevEnd = entry; else break;
  }
  if (!prevEnd) return null;
  return g.start.odo_reading - prevEnd.odo;
}

export function expectedFuelLiters(vehiclePlate, distance, vehicleRates) {
  if (distance === "—" || distance == null) return "—";
  const rate = vehicleRates[vehiclePlate];
  if (!rate) return "—";
  return (distance / rate).toFixed(1);
}

export function expectedFuelCost(vehiclePlate, liters, vehicleFuelTypes, stationName, stationRates) {
  if (liters === "—" || liters == null) return "—";
  const fuelType = vehicleFuelTypes[vehiclePlate];
  const prices = stationRates[stationName];
  if (!fuelType || !prices) return "—";
  const price = fuelType === "Diesel" ? prices.diesel : prices.petrol;
  if (price == null) return "—";
  return (Number(liters) * price).toFixed(2);
}

export function actualFuelCost(identityNumber, day, approvedFuelByKey) {
  const val = approvedFuelByKey?.[`${identityNumber}|${day}`];
  return val == null ? "—" : val.toFixed(2);
}

// The FDP automatic-fuel allocation (PetroApp) for a driver-day — kept
// entirely separate from actualFuelCost (approved reinforcement requests
// only). Never merge these into one number; show both plus their sum.
export function automaticFuelCost(identityNumber, day, automaticFuelByKey) {
  const val = automaticFuelByKey?.[`${identityNumber}|${day}`];
  return val == null ? "—" : val.toFixed(2);
}

export function totalFuelCost(actual, automatic) {
  if (actual === "—" && automatic === "—") return "—";
  return ((actual === "—" ? 0 : Number(actual)) + (automatic === "—" ? 0 : Number(automatic))).toFixed(2);
}

// Shared by useDashboardData (unscoped) and DataContext (project-scoped) so
// both compute the Overview's reinforcement/automatic-fuel numbers the same way.
export function summarizeReinforcement(rows) {
  const summary = { pending: 0, approved: 0, rejected: 0, total: 0, totalCost: 0 };
  for (const r of rows) {
    summary.total += 1;
    if (r.status === "pending") summary.pending += 1;
    else if (r.status === "approved") { summary.approved += 1; summary.totalCost += Number(r.amount || 0) + Number(r.loan_adjustment || 0); }
    else if (r.status === "rejected") summary.rejected += 1;
  }
  return summary;
}

export function sumAutomaticFuel(rows) {
  return rows.reduce((sum, r) => sum + Number(r.amount || 0), 0);
}

function periodKeyFor(dateStr, granularity) {
  if (!dateStr) return null;
  if (granularity === "month") return dateStr.slice(0, 7);
  if (granularity !== "week") return dateStr;
  const d = new Date(dateStr + "T00:00:00Z");
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + ((day === 0 ? -6 : 1) - day)); // snap to Monday
  return d.toISOString().slice(0, 10);
}

// Buckets reinforcement (approved only, amount+loan_adjustment) and automatic
// fuel rows into one chronologically-sorted series per period, for the
// Overview fuel trend chart. Mirrors summarizeReinforcement/sumAutomaticFuel's
// cost logic so the chart totals always agree with the KPI cards above it.
export function bucketFuelTrend(reinforcementRows, automaticFuelRows, granularity = "day") {
  const buckets = {};
  for (const r of reinforcementRows) {
    if (r.status !== "approved") continue;
    const key = periodKeyFor(r.shift_date, granularity);
    if (!key) continue;
    (buckets[key] ||= { period: key, actual: 0, automatic: 0 }).actual += Number(r.amount || 0) + Number(r.loan_adjustment || 0);
  }
  for (const r of automaticFuelRows) {
    const key = periodKeyFor(r.allocation_date, granularity);
    if (!key) continue;
    (buckets[key] ||= { period: key, actual: 0, automatic: 0 }).automatic += Number(r.amount || 0);
  }
  return Object.values(buckets)
    .map(b => ({ ...b, total: b.actual + b.automatic }))
    .sort((a, b) => a.period.localeCompare(b.period));
}

// Per-driver rollup for the Overview "Driver Performance" table — completed
// shifts (start+end) and total fuel cost (actual + automatic), both scoped to
// whatever compareGroups/reinforcementRows/automaticFuelRows were passed in.
export function buildDriverPerformance(drivers, compareGroups, reinforcementRows, automaticFuelRows) {
  const completedByDriver = {};
  for (const g of compareGroups) {
    if (g.start && g.end) completedByDriver[g.identity_number] = (completedByDriver[g.identity_number] || 0) + 1;
  }
  const fuelByDriver = {};
  for (const r of reinforcementRows) {
    if (r.status !== "approved") continue;
    fuelByDriver[r.identity_number] = (fuelByDriver[r.identity_number] || 0) + Number(r.amount || 0) + Number(r.loan_adjustment || 0);
  }
  for (const r of automaticFuelRows) {
    fuelByDriver[r.identity_number] = (fuelByDriver[r.identity_number] || 0) + Number(r.amount || 0);
  }
  return drivers.map(d => ({
    identity_number: d.identity_number,
    full_name: d.full_name,
    project: d.project,
    completedShifts: completedByDriver[d.identity_number] || 0,
    fuelCost: fuelByDriver[d.identity_number] || 0,
  }));
}

export function computeDeliveryMetrics(g, stationRates) {
  if (!g.end) return { delivered: "—", deliveryPct: "—", sales: "—" };
  const cod = Number(g.end.cod_delivered) || 0;
  const ppd = Number(g.end.ppd_delivered) || 0;
  const pickup = Number(g.end.picked_up) || 0;
  const delivered = cod + ppd;
  const ofd = Number(g.start?.ofd_count);
  const deliveryPct = ofd ? ((delivered / ofd) * 100).toFixed(1) + "%" : "—";
  const stationName = g.end.station_name || g.start?.station_name;
  const rate = stationRates[stationName];
  const sales = rate ? (cod * rate.cod + ppd * rate.ppd + pickup * rate.pickup).toFixed(2) : "—";
  return { delivered, deliveryPct, sales };
}

export function formatRequestCode(requestNo) {
  return "GBE-FR-" + String(requestNo ?? 0).padStart(6, "0");
}

export function compareStatus(g) {
  if (g.synthetic) return "not_submitted";
  if (g.start && g.end) return "complete";
  if (g.start) return "start_only";
  return "end_only";
}

// Single source of truth for the odometer/fuel/delivery figures shown for a
// driver-day group (used by Compare, FuelApprover, DetailModal and CSV export)
// so every place that displays a group shows the same numbers.
export function buildGroupMetrics(g, { vehicleRates, vehicleFuelTypes, stationRates, vehicleEndHistory, approvedFuelByKey, automaticFuelByKey }) {
  const dist = (g.start?.odo_reading != null && g.end?.odo_reading != null) ? (g.end.odo_reading - g.start.odo_reading) : null;
  const fuelLiters = expectedFuelLiters(g.vehicle_plate, dist, vehicleRates);
  const stationName = g.end?.station_name || g.start?.station_name;
  const fuelCost = expectedFuelCost(g.vehicle_plate, fuelLiters, vehicleFuelTypes, stationName, stationRates);
  const actualCost = actualFuelCost(g.identity_number, g.day, approvedFuelByKey);
  const automaticCost = automaticFuelCost(g.identity_number, g.day, automaticFuelByKey);
  return {
    dist: dist ?? "—",
    fuelLiters,
    fuelCost,
    actualFuelCost: actualCost,
    automaticFuelCost: automaticCost,
    totalFuelCost: totalFuelCost(actualCost, automaticCost),
    offDuty: getOffDuty(g, vehicleEndHistory),
    ...computeDeliveryMetrics(g, stationRates),
    status: compareStatus(g),
  };
}
