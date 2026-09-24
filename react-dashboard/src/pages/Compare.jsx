import { useMemo, useState } from "react";
import { useDashboard } from "../contexts/DataContext";
import { useDetailModal } from "../contexts/DetailModalContext";
import { useAuth } from "../contexts/AuthContext";
import { useLang } from "../contexts/LanguageContext";
import { StatusBadge } from "../components/DetailModal";
import ProjectBadge from "../components/ProjectBadge";
import GlobalFilters from "../components/GlobalFilters";
import DataTable from "../components/DataTable";
import { compareStatus, buildGroupMetrics, formatLocalTime } from "../lib/calc";
import { downloadCsv, GROUP_CSV_KEYS, groupToCsvRow } from "../lib/csv";
import { PROJECT_LIST } from "../lib/constants";

export default function Compare() {
  const { scopedCompareGroups: allCompareGroups, vehicleEndHistory, vehicleRates, vehicleFuelTypes, stationRates, approvedFuelByKey, automaticFuelByKey } = useDashboard();
  const { openDetail } = useDetailModal();
  const { isAdmin } = useAuth();
  const { t } = useLang();
  const [search, setSearch] = useState("");
  const [project, setProject] = useState("");
  const [shiftStatus, setShiftStatus] = useState("");
  const [view, setView] = useState("gallery");

  const rows = useMemo(() => {
    let r = allCompareGroups;
    if (project) r = r.filter(g => g.project === project);
    if (shiftStatus === "incomplete") r = r.filter(g => compareStatus(g) !== "complete");
    else if (shiftStatus) r = r.filter(g => compareStatus(g) === shiftStatus);
    if (search.trim()) {
      const s = search.trim().toLowerCase();
      r = r.filter(g => (g.full_name || "").toLowerCase().includes(s) || (g.identity_number || "").toLowerCase().includes(s));
    }
    return r;
  }, [allCompareGroups, project, shiftStatus, search]);

  function handleReset() {
    setSearch("");
    setProject("");
    setShiftStatus("");
  }

  function handleExport() {
    if (!rows.length) return;
    const ctx = { vehicleRates, vehicleFuelTypes, stationRates, vehicleEndHistory, approvedFuelByKey, automaticFuelByKey, buildGroupMetrics };
    downloadCsv(`driver_comparison_${new Date().toISOString().slice(0, 10)}.csv`, GROUP_CSV_KEYS, rows.map(g => groupToCsvRow(g, ctx)));
  }

  // Pre-compute each row's metrics once (rather than inside every cell renderer)
  // so the 8 odometer/fuel columns that all need buildGroupMetrics() don't
  // recompute it redundantly.
  const tableRows = useMemo(() => {
    const ctx = { vehicleRates, vehicleFuelTypes, stationRates, vehicleEndHistory, approvedFuelByKey, automaticFuelByKey };
    return rows.map(g => ({ ...g, _m: buildGroupMetrics(g, ctx) }));
  }, [rows, vehicleRates, vehicleFuelTypes, stationRates, vehicleEndHistory, approvedFuelByKey, automaticFuelByKey]);

  const columns = useMemo(() => {
    const tripData = {
      header: t("compare.groupTripData"),
      columns: [
        { accessorKey: "day", header: t("compare.colDate") },
        { accessorKey: "full_name", header: t("compare.colDriver") },
        { accessorKey: "identity_number", header: t("compare.colIdNumber") },
        {
          id: "project", header: t("common.project"), enableSorting: false,
          cell: ({ row }) => row.original.project ? <ProjectBadge project={row.original.project} /> : "—",
        },
        { accessorKey: "vehicle_plate", header: t("compare.colPlate") },
        {
          id: "status", header: t("common.status"), enableSorting: false,
          cell: ({ row }) => <StatusBadge status={compareStatus(row.original)} />,
        },
      ],
    };
    const odoFuel = {
      header: t("compare.groupOdometerFuel"),
      meta: { groupAlt: true },
      columns: [
        { id: "startOdo", header: t("common.startOdometer"), meta: { groupAlt: true }, enableSorting: false, cell: ({ row }) => row.original.start?.odo_reading ?? "—" },
        { id: "endOdo", header: t("common.endOdometer"), meta: { groupAlt: true }, enableSorting: false, cell: ({ row }) => row.original.end?.odo_reading ?? "—" },
        { id: "dist", header: t("compare.colDistanceCovered"), meta: { groupAlt: true }, enableSorting: false, cell: ({ row }) => row.original._m.dist },
        { id: "fuelLiters", header: t("common.expectedFuelLiters"), meta: { groupAlt: true }, enableSorting: false, cell: ({ row }) => row.original._m.fuelLiters },
        { id: "fuelCost", header: t("compare.colExpectedFuelCost"), meta: { groupAlt: true }, enableSorting: false, cell: ({ row }) => row.original._m.fuelCost },
        { id: "automaticFuelCost", header: t("compare.colAutomaticFuelCost"), meta: { groupAlt: true }, enableSorting: false, cell: ({ row }) => row.original._m.automaticFuelCost },
        { id: "actualFuelCost", header: t("compare.colActualFuelCost"), meta: { groupAlt: true }, enableSorting: false, cell: ({ row }) => row.original._m.actualFuelCost },
        { id: "totalFuelCost", header: t("compare.colTotalFuelCost"), meta: { groupAlt: true }, enableSorting: false, cell: ({ row }) => row.original._m.totalFuelCost },
        { id: "offDuty", header: t("compare.colOffDuty"), meta: { groupAlt: true }, enableSorting: false, cell: ({ row }) => row.original._m.offDuty ?? "—" },
        { id: "startTime", header: t("common.startTime"), meta: { groupAlt: true }, enableSorting: false, cell: ({ row }) => formatLocalTime(row.original.start?.created_at) },
        { id: "endTime", header: t("common.endTime"), meta: { groupAlt: true }, enableSorting: false, cell: ({ row }) => formatLocalTime(row.original.end?.created_at) },
      ],
    };
    const deliverySales = {
      header: t("compare.groupDeliverySales"),
      columns: [
        { id: "ofd", header: "OFD", enableSorting: false, cell: ({ row }) => row.original.start?.ofd_count ?? "—" },
        { id: "cod", header: "COD", enableSorting: false, cell: ({ row }) => row.original.end?.cod_delivered ?? "—" },
        { id: "ppd", header: "PPD", enableSorting: false, cell: ({ row }) => row.original.end?.ppd_delivered ?? "—" },
        { id: "pickedUp", header: "Picked Up", enableSorting: false, cell: ({ row }) => row.original.end?.picked_up ?? "—" },
        { id: "delivered", header: "Delivered", enableSorting: false, cell: ({ row }) => row.original._m.delivered },
        { id: "deliveryPct", header: "Delivery %", enableSorting: false, cell: ({ row }) => row.original._m.deliveryPct },
        { id: "sales", header: "Sales", enableSorting: false, cell: ({ row }) => row.original._m.sales },
      ],
    };
    const cols = [tripData, odoFuel, deliverySales];
    if (isAdmin) {
      cols.push({
        id: "actions", header: t("drivers.colActions"), enableSorting: false,
        cell: ({ row }) => <div className="row-actions"><button className="btn" onClick={() => openDetail(row.original)}>{t("common.edit")}</button></div>,
      });
    }
    return cols;
  }, [t, isAdmin, openDetail]);

  return (
    <>
      <div className="content-header">
        <div>
          <div className="breadcrumb">{t("common.dashboard")} &gt; <b>{t("compare.breadcrumb")}</b></div>
          <h1 className="page-title">{t("compare.breadcrumb")}</h1>
        </div>
        <button className="btn" onClick={handleExport}>{t("common.exportCsv")}</button>
      </div>
      <GlobalFilters />

      <div className="pill-bar">
        <div className="pill-search">
          <span className="pill-search-ic">🔍</span>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder={t("common.searchByNameOrId")} />
        </div>
        <div className="pill-select-wrap">
          <select value={project} onChange={e => setProject(e.target.value)}>
            <option value="">{t("common.allProjects")}</option>
            {PROJECT_LIST.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="pill-select-wrap">
          <select value={shiftStatus} onChange={e => setShiftStatus(e.target.value)}>
            <option value="">{t("drivers.allShiftStatuses")}</option>
            <option value="incomplete">{t("drivers.shiftIncomplete")}</option>
            <option value="complete">{t("common.complete")}</option>
            <option value="start_only">{t("detailModal.startOnly")}</option>
            <option value="end_only">{t("detailModal.endOnly")}</option>
          </select>
        </div>
        <button className="btn" onClick={handleReset}>{t("common.clearFilters")}</button>
        <div className="view-toggle">
          <button className={"view-btn" + (view === "gallery" ? " active" : "")} title={t("common.galleryView")} onClick={() => setView("gallery")}>🖼️</button>
          <button className={"view-btn" + (view === "table" ? " active" : "")} title={t("common.gridView")} onClick={() => setView("table")}>📋</button>
        </div>
      </div>
      <div className="cards-count">{t("compare.recordsCount", { n: rows.length })}</div>

      {view === "gallery" ? (
        <div className="cards-grid compare-cards-grid">
          {!rows.length ? <div className="empty-cards">{t("common.noMatchingData")}</div> : rows.map((g, i) => (
            <div key={i} className="compare-card">
              <div className="compare-card-mini" onClick={() => openDetail(g)}>
                <div className="who">{g.full_name}</div>
                <div className="sub">{g.identity_number} · {g.day}</div>
                <div className="plate">🚗 {g.vehicle_plate || "—"}</div>
                <div className="mini-badges">
                  <ProjectBadge project={g.project} />
                  <StatusBadge status={compareStatus(g)} />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <DataTable columns={columns} data={tableRows} emptyMessage={t("common.noMatchingData")} />
      )}
    </>
  );
}
