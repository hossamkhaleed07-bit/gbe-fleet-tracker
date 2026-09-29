import { useCallback, useRef, useState } from "react";
import { sb } from "../lib/supabase";
import { buildDriverComparison, buildStationReport, buildVehicleEndHistory, summarizeReinforcement, sumAutomaticFuel } from "../lib/calc";
import { PROJECT_LIST } from "../lib/constants";

const PAGE_SIZE = 1000;

// Fetches every matching row via Supabase's .range() paging, looping until a
// short page signals the end — replaces a fixed .limit(N) that silently
// dropped rows (in whatever order the query used) once a table grew past N.
// A full calendar month across the whole driver roster (Driver Performance's
// typical query) already exceeds 1000, let alone the flat 5000 caps this
// used to have, so a bigger fixed number would only postpone the same bug.
// `buildQuery` must return a FRESH query builder each call (so a distinct
// .range() can be layered on per page) — pass a function, not a built query.
async function fetchAllPages(buildQuery, pageSize = PAGE_SIZE) {
  const rows = [];
  let start = 0;
  for (;;) {
    const { data, error } = await buildQuery().range(start, start + pageSize - 1);
    if (error) return { data: null, error };
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
    start += pageSize;
  }
  return { data: rows, error: null };
}

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
  const [automaticFuelByKey, setAutomaticFuelByKey] = useState({});
  const [automaticFuelRows, setAutomaticFuelRows] = useState([]);
  const [automaticFuelTotal, setAutomaticFuelTotal] = useState(0);
  const [reinforcementRows, setReinforcementRows] = useState([]);
  const [reinforcementSummary, setReinforcementSummary] = useState({ pending: 0, approved: 0, rejected: 0, total: 0, totalCost: 0 });
  const [attendanceRows, setAttendanceRows] = useState([]);
  const [submissionReasonByKey, setSubmissionReasonByKey] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const allRowsRef = useRef([]);
  const allDriversRef = useRef([]);
  const driverProjectsRef = useRef({});
  // Kept separately from allRowsRef because it must stay UNBOUNDED (see the
  // endHistoryQuery comment in loadData) while allRows/rows is scoped to the
  // currently-selected date range — Off Duty needs "the day before" the
  // range even when that day falls outside it.
  const endHistoryRowsRef = useRef([]);
  // loadData is called independently from several places that can legitimately
  // fire close together on first mount — e.g. DataProvider's own
  // session-ready effect, and a page like Driver Performance that forces its
  // own month range on every mount. Two in-flight requests race, and without
  // this guard, whichever NETWORK RESPONSE happens to arrive last silently
  // wins — even if it was for an older, different (or unbounded) range. A
  // request whose generation isn't the latest by the time it resolves is
  // discarded instead of touching state, so only the most recently CALLED
  // loadData ever wins, regardless of response order.
  const loadGenerationRef = useRef(0);

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

  const recomputeVehicleEndHistory = useCallback(() => {
    setVehicleEndHistory(buildVehicleEndHistory(endHistoryRowsRef.current));
  }, []);

  // Recomputes every value derived from the raw shift_entries rows, without
  // hitting the network — used both after loadData() and after local
  // optimistic edits so a save doesn't require refetching the whole dataset.
  const recomputeFromRows = useCallback((rows) => {
    allRowsRef.current = rows;
    setAllRows(rows);
    setAllCompareGroups(buildDriverComparison(rows, driverProjectsRef.current));
    setStationRows(buildStationReport(rows));
  }, []);

  const loadData = useCallback(async (from, to) => {
    const requestId = ++loadGenerationRef.current;
    setLoading(true);
    setError(null);

    // Paginated (see fetchAllPages above) so a full month across the whole
    // roster — Driver Performance's normal query shape — can never silently
    // lose rows, however many there turn out to be.
    const shiftEntriesFactory = () => {
      let q = sb.from("shift_entries").select("*").order("created_at", { ascending: false });
      if (from) q = q.gte("shift_date", from);
      if (to) q = q.lte("shift_date", to);
      return q;
    };

    const endHistoryFactory = () => sb.from("shift_entries")
      .select("id,vehicle_plate,shift_date,odo_reading,created_at")
      .eq("shift_type", "end")
      .not("vehicle_plate", "is", null)
      .not("odo_reading", "is", null)
      .order("shift_date", { ascending: false });

    const vehicleRatesQuery = sb.from("vehicles").select("vehicle_plate,avg_per_liter,fuel_type");
    const stationRatesQuery = sb.from("stations").select("station_name,cod_rate,ppd_rate,pickup_rate,diesel_price,petrol_price");
    const driversQuery = sb.from("drivers").select("*").order("identity_number");
    const vehiclesQuery = sb.from("vehicles").select("*").order("vehicle_plate");
    // These three are deliberately fetched UNBOUNDED (no from/to filter) —
    // approvedFuelByKey/automaticFuelByKey are looked up for arbitrary
    // driver-days (e.g. PrevDayFuelSection's "day before" can fall just
    // outside the selected range), and the Overview needs "today" numbers
    // regardless of whatever range is currently selected. Range-scoping for
    // the Overview's summaries is done client-side (see below), not here.
    const reinforcementFactory = () => sb.from("reinforcement_requests")
      .select("identity_number,shift_date,amount,loan_adjustment,status,full_name")
      .order("shift_date", { ascending: false });
    const automaticFuelFactory = () => sb.from("automatic_fuel_allocations").select("identity_number,allocation_date,amount,project")
      .order("allocation_date", { ascending: false });
    const attendanceFactory = () => sb.from("driver_attendance").select("identity_number,attendance_date,status,project")
      .order("attendance_date", { ascending: false });
    // Unbounded like the three above — an exception note filed for a driver-day
    // can be looked up regardless of whatever range is currently selected.
    const submissionReasonsFactory = () => sb.from("submission_reasons")
      .select("identity_number,shift_date,reason,notes,updated_at")
      .order("shift_date", { ascending: false });

    const [
      { data, error: err },
      { data: endHistoryData },
      { data: vehicleRatesData },
      { data: stationRatesData },
      { data: driversData },
      { data: vehiclesData },
      { data: reinforcementData },
      { data: automaticFuelData },
      { data: attendanceData },
      { data: submissionReasonsData },
    ] = await Promise.all([
      fetchAllPages(shiftEntriesFactory), fetchAllPages(endHistoryFactory), vehicleRatesQuery, stationRatesQuery, driversQuery, vehiclesQuery,
      fetchAllPages(reinforcementFactory), fetchAllPages(automaticFuelFactory), fetchAllPages(attendanceFactory), fetchAllPages(submissionReasonsFactory),
    ]);

    // A newer loadData call has since started (see loadGenerationRef above) —
    // this response is stale, drop it silently rather than let it overwrite
    // whatever the newer call is about to (or already did) produce.
    if (requestId !== loadGenerationRef.current) return;

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
    endHistoryRowsRef.current = endHistoryData || [];
    recomputeFromRows(rows);
    recomputeVehicleEndHistory();
    setDriverProjects(dProjects);
    setVehicleDriverMap(vDriverMap);
    setVehicleRates(vRates);
    setVehicleFuelTypes(vFuelTypes);
    setStationRates(sRates);
    setAllDrivers(drivers);
    setAllVehicles(vehicles);

    const allReinforcement = reinforcementData || [];
    const fuelByKey = {};
    for (const r of allReinforcement) {
      if (r.status !== "approved" || !r.identity_number || !r.shift_date || r.amount == null) continue;
      const key = `${r.identity_number}|${r.shift_date}`;
      const totalLoan = Number(r.amount) + (Number(r.loan_adjustment) || 0);
      fuelByKey[key] = (fuelByKey[key] || 0) + totalLoan;
    }
    setApprovedFuelByKey(fuelByKey);

    const allAutomaticFuel = automaticFuelData || [];
    const autoFuelByKey = {};
    for (const r of allAutomaticFuel) {
      if (!r.identity_number || !r.allocation_date || r.amount == null) continue;
      const key = `${r.identity_number}|${r.allocation_date}`;
      autoFuelByKey[key] = (autoFuelByKey[key] || 0) + Number(r.amount);
    }
    setAutomaticFuelByKey(autoFuelByKey);

    // Range-scoped views for the Overview page — the three unbounded fetches
    // above are filtered here by the currently-selected from/to, computed
    // client-side to avoid a second round-trip per table.
    const inRange = (dateStr) => (!from || dateStr >= from) && (!to || dateStr <= to);

    const rangedReinforcement = allReinforcement.filter(r => r.shift_date && inRange(r.shift_date));
    setReinforcementRows(rangedReinforcement);
    setReinforcementSummary(summarizeReinforcement(rangedReinforcement));

    const rangedAutomaticFuel = allAutomaticFuel.filter(r => r.allocation_date && inRange(r.allocation_date));
    setAutomaticFuelRows(rangedAutomaticFuel);
    setAutomaticFuelTotal(sumAutomaticFuel(rangedAutomaticFuel));

    setAttendanceRows(attendanceData || []);

    const srByKey = {};
    for (const r of submissionReasonsData || []) {
      if (!r.identity_number || !r.shift_date) continue;
      srByKey[`${r.identity_number}|${r.shift_date}`] = { reason: r.reason || "", notes: r.notes || "", updated_at: r.updated_at };
    }
    setSubmissionReasonByKey(srByKey);

    setLastUpdated(new Date());
    setLoading(false);
  }, [recomputeFromRows, recomputeVehicleEndHistory]);

  // Optimistic local patch after a successful submission_reasons upsert —
  // avoids refetching the whole dashboard dataset just to reflect one edit.
  const upsertSubmissionReason = useCallback((identityNumber, shiftDate, patch) => {
    const key = `${identityNumber}|${shiftDate}`;
    setSubmissionReasonByKey(prev => ({ ...prev, [key]: { ...(prev[key] || { reason: "", notes: "" }), ...patch } }));
    setLastUpdated(new Date());
  }, []);

  // ---- Local/optimistic updates: patch state in-memory instead of refetching
  // the whole dashboard dataset after every save, so edits feel instant.
  // endHistoryRowsRef mirrors the same mutation so Off Duty (which reads
  // from it, not from the range-bounded rows) doesn't go stale either. ----

  const patchShiftEntries = useCallback((patches) => {
    const map = new Map(patches.map(p => [p.id, p.changes]));
    const rows = allRowsRef.current.map(r => map.has(r.id) ? { ...r, ...map.get(r.id) } : r);
    recomputeFromRows(rows);
    endHistoryRowsRef.current = endHistoryRowsRef.current.map(r => map.has(r.id) ? { ...r, ...map.get(r.id) } : r);
    recomputeVehicleEndHistory();
    setLastUpdated(new Date());
  }, [recomputeFromRows, recomputeVehicleEndHistory]);

  const removeShiftEntries = useCallback((ids) => {
    const idSet = new Set(ids);
    const rows = allRowsRef.current.filter(r => !idSet.has(r.id));
    recomputeFromRows(rows);
    endHistoryRowsRef.current = endHistoryRowsRef.current.filter(r => !idSet.has(r.id));
    recomputeVehicleEndHistory();
    setLastUpdated(new Date());
  }, [recomputeFromRows, recomputeVehicleEndHistory]);

  const addShiftEntries = useCallback((newRows) => {
    const rows = [...allRowsRef.current, ...newRows].sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
    recomputeFromRows(rows);
    const newEndRows = newRows.filter(r => r.shift_type === "end" && r.vehicle_plate && r.odo_reading != null);
    if (newEndRows.length) {
      endHistoryRowsRef.current = [...endHistoryRowsRef.current, ...newEndRows];
      recomputeVehicleEndHistory();
    }
    setLastUpdated(new Date());
  }, [recomputeFromRows, recomputeVehicleEndHistory]);

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
    driverProjects, vehicleDriverMap, allDrivers, allVehicles, approvedFuelByKey, automaticFuelByKey, automaticFuelRows, automaticFuelTotal,
    reinforcementRows, reinforcementSummary, attendanceRows, submissionReasonByKey, loading, error, lastUpdated,
    loadData, patchShiftEntries, removeShiftEntries, addShiftEntries, upsertDriver, removeDriver, upsertVehicle, upsertSubmissionReason,
    PROJECT_LIST,
  };
}
