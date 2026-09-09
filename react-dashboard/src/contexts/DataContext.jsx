import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useDashboardData } from "../hooks/useDashboardData";
import { useAuth } from "./AuthContext";
import { buildStationReport } from "../lib/calc";

const DataContext = createContext(null);

export function DataProvider({ children }) {
  const { session } = useAuth();
  const data = useDashboardData();
  const [searchParams, setSearchParams] = useSearchParams();
  const from = searchParams.get("from") || "";
  const to = searchParams.get("to") || "";
  const [viewingProject, setViewingProject] = useState(null); // null = "Main account" (all projects)

  useEffect(() => {
    if (session) data.loadData(from, to);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  function setFrom(value) {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (value) next.set("from", value); else next.delete("from");
      return next;
    }, { replace: true });
  }

  function setTo(value) {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (value) next.set("to", value); else next.delete("to");
      return next;
    }, { replace: true });
  }

  function applyFilter() {
    data.loadData(from, to);
  }

  function resetFilter() {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete("from");
      next.delete("to");
      return next;
    }, { replace: true });
    data.loadData("", "");
  }

  const scoped = useMemo(() => {
    if (!viewingProject) {
      return {
        scopedRows: data.allRows,
        scopedCompareGroups: data.allCompareGroups,
        scopedStationRows: data.stationRows,
        scopedDrivers: data.allDrivers,
        scopedVehicles: data.allVehicles,
      };
    }
    const rows = data.allRows.filter(r => data.driverProjects[r.identity_number] === viewingProject);
    const compareGroups = data.allCompareGroups.filter(g => g.project === viewingProject);
    const drivers = data.allDrivers.filter(d => d.project === viewingProject);
    const vehicles = data.allVehicles.filter(v => {
      const drv = data.vehicleDriverMap[v.vehicle_plate];
      return drv && data.driverProjects[drv.identity_number] === viewingProject;
    });
    return {
      scopedRows: rows,
      scopedCompareGroups: compareGroups,
      scopedStationRows: buildStationReport(rows),
      scopedDrivers: drivers,
      scopedVehicles: vehicles,
    };
  }, [viewingProject, data.allRows, data.allCompareGroups, data.stationRows, data.allDrivers, data.allVehicles, data.driverProjects, data.vehicleDriverMap]);

  return (
    <DataContext.Provider value={{ ...data, ...scoped, from, to, setFrom, setTo, applyFilter, resetFilter, viewingProject, setViewingProject }}>
      {children}
    </DataContext.Provider>
  );
}

export function useDashboard() {
  return useContext(DataContext);
}
