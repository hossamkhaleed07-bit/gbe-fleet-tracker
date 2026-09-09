import { useCallback, useRef, useState } from "react";
import { sb } from "../lib/supabase";
import { buildDriverComparison, buildStationReport, buildVehicleEndHistory } from "../lib/calc";
import { PROJECT_LIST } from "../lib/constants";

export function useDashboardData() {
  const [allRows, setAllRows] = useState([]);
  const [allCompareGroups, setAllCompareGroups] = useState([]);
  const [stationRows, setStationRows] = useState([]);
  const [vehicleEndHistory, setVehicleEndHistory] = useState({});
  const [vehicleRates, setVehicleRates] = useState({});
  const [vehicleFuelTypes, setVehicleFuelTypes] = useState({});
  const [stationRates, setStationRates] = useState({});
  const [driverProjects, setDriverProjects] = useState({});
  const [vehicleDriverMap, setVehicleDriverMap] = useState({});
  const [allDrivers, setAllDrivers] = useState([]);
  const [allVehicles, setAllVehicles] = useState([]);
  const [approvedFuelByKey, setApprovedFuelByKey] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const allRowsRef = useRef([]);
  const allDriversRef = useRef([]);
  const driverProjectsRef = useRef({});

  const recomputeVehicleDriverMap = useCallback((drivers, rows) => {
    const vDriverMap = {};
    for (const d of drivers) {
      if (d.assigned_vehicle_plate) vDriverMap[d.assigned_vehicle_plate] = { identity_number: d.identity_number, full_name: d.full_name };
    }
    for (const r of rows) {
      if (r.vehicle_plate && !vDriverMap[r.vehicle_plate]) {
        vDriverMap[r.vehicle_plate] = { identity_number: r.identity_number, full_name: r.full_name };
      }
    }
    setVehicleDriverMap(vDriverMap);
  }, []);

  // Recomputes every value derived from the raw shift_entries rows, without
  // hitting the network — used both after loadData() and after local
  // optimistic edits so a save doesn't require refetching the whole dataset.
  const recomputeFromRows = useCallback((rows) => {
    allRowsRef.current = rows;
    setAllRows(rows);
    setAllCompareGroups(buildDriverComparison(rows, driverProjectsRef.current));
    setStationRows(buildStationReport(rows));
    setVehicleEndHistory(buildVehicleEndHistory(
      rows.filter(r => r.shift_type === "end" && r.vehicle_plate && r.odo_reading != null)
    ));
  }, []);

  const loadData = useCallback(async (from, to) => {
    setLoading(true);
    setError(null);

    let query = sb.from("shift_entries").select("*").order("created_at", { ascending: true }).limit(2000);
    if (from) query = query.gte("shift_date", from);
    if (to) query = query.lte("shift_date", to);

    const endHistoryQuery = sb.from("shift_entries")
      .select("vehicle_plate,shift_date,odo_reading,created_at")
      .eq("shift_type", "end")
      .not("vehicle_plate", "is", null)
      .not("odo_reading", "is", null)
      .order("shift_date", { ascending: true })
      .limit(5000);

    const vehicleRatesQuery = sb.from("vehicles").select("vehicle_plate,avg_per_liter,fuel_type");
    const stationRatesQuery = sb.from("stations").select("station_name,cod_rate,ppd_rate,pickup_rate,diesel_price,petrol_price");
    const driversQuery = sb.from("drivers").select("*").order("identity_number");
    const vehiclesQuery = sb.from("vehicles").select("*").order("vehicle_plate");
    const approvedFuelQuery = sb.from("reinforcement_requests").select("identity_number,shift_date,amount,loan_adjustment").eq("status", "approved");

    const [
      { data, error: err },
      { data: endHistoryData },
      { data: vehicleRatesData },
      { data: stationRatesData },
      { data: driversData },
      { data: vehiclesData },
      { data: approvedFuelData },
    ] = await Promise.all([query, endHistoryQuery, vehicleRatesQuery, stationRatesQuery, driversQuery, vehiclesQuery, approvedFuelQuery]);

    if (err) {
      setError(err.message);
      setLoading(false);
      return;
    }

    const rows = data || [];
    const drivers = driversData || [];
    const vehicles = vehiclesData || [];

    const dProjects = {};
    const vDriverMap = {};
    for (const d of drivers) {
      if (d.identity_number && d.project) dProjects[d.identity_number] = d.project;
      if (d.assigned_vehicle_plate) vDriverMap[d.assigned_vehicle_plate] = { identity_number: d.identity_number, full_name: d.full_name };
    }
    for (const r of rows) {
      if (r.vehicle_plate && !vDriverMap[r.vehicle_plate]) {
        vDriverMap[r.vehicle_plate] = { identity_number: r.identity_number, full_name: r.full_name };
      }
    }

    const vRates = {};
    const vFuelTypes = {};
    for (const v of vehicleRatesData || []) {
      if (v.vehicle_plate && v.avg_per_liter != null) vRates[v.vehicle_plate] = Number(v.avg_per_liter);
      if (v.vehicle_plate && v.fuel_type) vFuelTypes[v.vehicle_plate] = v.fuel_type;
    }
    const sRates = {};
    for (const s of stationRatesData || []) {
      if (s.station_name) {
        sRates[s.station_name] = {
          cod: Number(s.cod_rate) || 0, ppd: Number(s.ppd_rate) || 0, pickup: Number(s.pickup_rate) || 0,
          diesel: s.diesel_price != null ? Number(s.diesel_price) : null,
          petrol: s.petrol_price != null ? Number(s.petrol_price) : null,
        };
      }
    }

    driverProjectsRef.current = dProjects;
    allDriversRef.current = drivers;
    recomputeFromRows(rows);
    setDriverProjects(dProjects);
    setVehicleDriverMap(vDriverMap);
    setVehicleRates(vRates);
    setVehicleFuelTypes(vFuelTypes);
    setStationRates(sRates);
    setAllDrivers(drivers);
    setAllVehicles(vehicles);

    const fuelByKey = {};
    for (const r of approvedFuelData || []) {
      if (!r.identity_number || !r.shift_date || r.amount == null) continue;
      const key = `${r.identity_number}|${r.shift_date}`;
      const totalLoan = Number(r.amount) + (Number(r.loan_adjustment) || 0);
      fuelByKey[key] = (fuelByKey[key] || 0) + totalLoan;
    }
    setApprovedFuelByKey(fuelByKey);

    setLastUpdated(new Date());
    setLoading(false);
  }, [recomputeFromRows]);

  // ---- Local/optimistic updates: patch state in-memory instead of refetching
  // the whole dashboard dataset after every save, so edits feel instant. ----

  const patchShiftEntries = useCallback((patches) => {
    const map = new Map(patches.map(p => [p.id, p.changes]));
    const rows = allRowsRef.current.map(r => map.has(r.id) ? { ...r, ...map.get(r.id) } : r);
    recomputeFromRows(rows);
    setLastUpdated(new Date());
  }, [recomputeFromRows]);

  const removeShiftEntries = useCallback((ids) => {
    const idSet = new Set(ids);
    const rows = allRowsRef.current.filter(r => !idSet.has(r.id));
    recomputeFromRows(rows);
    setLastUpdated(new Date());
  }, [recomputeFromRows]);

  const addShiftEntries = useCallback((newRows) => {
    const rows = [...allRowsRef.current, ...newRows].sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
    recomputeFromRows(rows);
    setLastUpdated(new Date());
  }, [recomputeFromRows]);

  const upsertDriver = useCallback((driver) => {
    const idx = allDriversRef.current.findIndex(d => d.identity_number === driver.identity_number);
    const nextDrivers = idx === -1
      ? [...allDriversRef.current, driver]
      : allDriversRef.current.map((d, i) => i === idx ? { ...d, ...driver } : d);
    nextDrivers.sort((a, b) => (a.identity_number || "").localeCompare(b.identity_number || ""));
    allDriversRef.current = nextDrivers;
    setAllDrivers(nextDrivers);

    if (driver.project) driverProjectsRef.current[driver.identity_number] = driver.project;
    else delete driverProjectsRef.current[driver.identity_number];
    setDriverProjects({ ...driverProjectsRef.current });

    recomputeVehicleDriverMap(nextDrivers, allRowsRef.current);
    recomputeFromRows(allRowsRef.current); // driver's project may have changed -> refresh compare groups' project field
    setLastUpdated(new Date());
  }, [recomputeFromRows, recomputeVehicleDriverMap]);

  const removeDriver = useCallback((identityNumber) => {
    const nextDrivers = allDriversRef.current.filter(d => d.identity_number !== identityNumber);
    allDriversRef.current = nextDrivers;
    setAllDrivers(nextDrivers);
    delete driverProjectsRef.current[identityNumber];
    setDriverProjects({ ...driverProjectsRef.current });
    recomputeVehicleDriverMap(nextDrivers, allRowsRef.current);
    setLastUpdated(new Date());
  }, [recomputeVehicleDriverMap]);

  const upsertVehicle = useCallback((vehicle) => {
    setAllVehicles(prev => {
      const idx = prev.findIndex(v => v.vehicle_plate === vehicle.vehicle_plate);
      const next = idx === -1 ? [...prev, vehicle] : prev.map((v, i) => i === idx ? { ...v, ...vehicle } : v);
      return [...next].sort((a, b) => (a.vehicle_plate || "").localeCompare(b.vehicle_plate || ""));
    });
    setVehicleRates(prev => {
      const next = { ...prev };
      if (vehicle.avg_per_liter != null) next[vehicle.vehicle_plate] = Number(vehicle.avg_per_liter); else delete next[vehicle.vehicle_plate];
      return next;
    });
    setVehicleFuelTypes(prev => {
      const next = { ...prev };
      if (vehicle.fuel_type) next[vehicle.vehicle_plate] = vehicle.fuel_type; else delete next[vehicle.vehicle_plate];
      return next;
    });
    setLastUpdated(new Date());
  }, []);

  return {
    allRows, allCompareGroups, stationRows, vehicleEndHistory, vehicleRates, vehicleFuelTypes, stationRates,
    driverProjects, vehicleDriverMap, allDrivers, allVehicles, approvedFuelByKey, loading, error, lastUpdated,
    loadData, patchShiftEntries, removeShiftEntries, addShiftEntries, upsertDriver, removeDriver, upsertVehicle,
    PROJECT_LIST,
  };
}
