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

export function getOffDuty(g, vehicleEndHistory) {
  if (!g.start || g.start.odo_reading == null || !g.vehicle_plate) return null;
  const history = vehicleEndHistory[g.vehicle_plate];
  if (!history) return null;
  const d = new Date(g.day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  const prevDay = d.toISOString().slice(0, 10);
  const prevEnd = history.find(entry => entry.day === prevDay);
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
export function buildGroupMetrics(g, { vehicleRates, vehicleFuelTypes, stationRates, vehicleEndHistory, approvedFuelByKey }) {
  const dist = (g.start?.odo_reading != null && g.end?.odo_reading != null) ? (g.end.odo_reading - g.start.odo_reading) : null;
  const fuelLiters = expectedFuelLiters(g.vehicle_plate, dist, vehicleRates);
  const stationName = g.end?.station_name || g.start?.station_name;
  const fuelCost = expectedFuelCost(g.vehicle_plate, fuelLiters, vehicleFuelTypes, stationName, stationRates);
  return {
    dist: dist ?? "—",
    fuelLiters,
    fuelCost,
    actualFuelCost: actualFuelCost(g.identity_number, g.day, approvedFuelByKey),
    offDuty: getOffDuty(g, vehicleEndHistory),
    ...computeDeliveryMetrics(g, stationRates),
    status: compareStatus(g),
  };
}
