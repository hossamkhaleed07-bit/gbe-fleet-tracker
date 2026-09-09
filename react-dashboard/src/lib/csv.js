import { formatLocalTime } from "./calc";

export function downloadCsv(filename, keys, rows) {
  const csvRows = [keys.join(",")];
  for (const r of rows) csvRows.push(keys.map(c => `"${String(r[c] ?? "").replace(/"/g, '""')}"`).join(","));
  const blob = new Blob(["﻿" + csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const GROUP_CSV_KEYS = [
  "date", "full_name", "identity_number", "project", "vehicle_plate", "station",
  "start_odo", "end_odo", "distance", "expected_fuel_liters", "expected_fuel_cost", "actual_fuel_cost", "off_duty_km",
  "start_time", "end_time", "ofd", "cod", "ppd", "picked_up", "delivered", "delivery_pct", "sales", "status",
];

export function groupToCsvRow(g, { vehicleRates, vehicleFuelTypes, stationRates, vehicleEndHistory, approvedFuelByKey, buildGroupMetrics }) {
  const station = g.end?.station_name || g.start?.station_name || "";
  const m = buildGroupMetrics(g, { vehicleRates, vehicleFuelTypes, stationRates, vehicleEndHistory, approvedFuelByKey });
  return {
    date: g.day, full_name: g.full_name, identity_number: g.identity_number, project: g.project || "", vehicle_plate: g.vehicle_plate,
    station,
    start_odo: g.start?.odo_reading ?? "", end_odo: g.end?.odo_reading ?? "",
    distance: m.dist,
    expected_fuel_liters: m.fuelLiters,
    expected_fuel_cost: m.fuelCost,
    actual_fuel_cost: m.actualFuelCost,
    off_duty_km: m.offDuty ?? "",
    start_time: g.start ? formatLocalTime(g.start.created_at) : "",
    end_time: g.end ? formatLocalTime(g.end.created_at) : "",
    ofd: g.start?.ofd_count ?? "", cod: g.end?.cod_delivered ?? "", ppd: g.end?.ppd_delivered ?? "", picked_up: g.end?.picked_up ?? "",
    delivered: m.delivered, delivery_pct: m.deliveryPct, sales: m.sales,
    status: m.status,
  };
}
