import { useMemo, useState } from "react";
import { useDashboard } from "../contexts/DataContext";
import { useDetailModal } from "../contexts/DetailModalContext";
import { useAuth } from "../contexts/AuthContext";
import { useLang } from "../contexts/LanguageContext";
import { StatusBadge } from "../components/DetailModal";
import ProjectBadge from "../components/ProjectBadge";
import GlobalFilters from "../components/GlobalFilters";
import { compareStatus, buildGroupMetrics, formatLocalTime } from "../lib/calc";
import { downloadCsv, GROUP_CSV_KEYS, groupToCsvRow } from "../lib/csv";
import { PROJECT_LIST } from "../lib/constants";

export default function Compare() {
  const { scopedCompareGroups: allCompareGroups, vehicleEndHistory, vehicleRates, vehicleFuelTypes, stationRates, approvedFuelByKey } = useDashboard();
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
    const ctx = { vehicleRates, vehicleFuelTypes, stationRates, vehicleEndHistory, approvedFuelByKey, buildGroupMetrics };
    downloadCsv(`driver_comparison_${new Date().toISOString().slice(0, 10)}.csv`, GROUP_CSV_KEYS, rows.map(g => groupToCsvRow(g, ctx)));
  }

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
        <div className="table-wrap">
          <table>
            <thead>
              <tr className="group-row">
                <th colSpan={6}>{t("compare.groupTripData")}</th>
                <th colSpan={9} className="group-alt">{t("compare.groupOdometerFuel")}</th>
                <th colSpan={7}>{t("compare.groupDeliverySales")}</th>
                {isAdmin && <th></th>}
              </tr>
              <tr>
                <th>{t("compare.colDate")}</th><th>{t("compare.colDriver")}</th><th>{t("compare.colIdNumber")}</th><th>{t("common.project")}</th><th>{t("compare.colPlate")}</th><th>{t("common.status")}</th>
                <th className="group-alt">{t("common.startOdometer")}</th><th className="group-alt">{t("common.endOdometer")}</th><th className="group-alt">{t("compare.colDistanceCovered")}</th>
                <th className="group-alt">{t("common.expectedFuelLiters")}</th><th className="group-alt">{t("compare.colExpectedFuelCost")}</th><th className="group-alt">{t("compare.colActualFuelCost")}</th><th className="group-alt">{t("compare.colOffDuty")}</th><th className="group-alt">{t("common.startTime")}</th><th className="group-alt">{t("common.endTime")}</th>
                <th>OFD</th><th>COD</th><th>PPD</th><th>Picked Up</th><th>Delivered</th><th>Delivery %</th><th>Sales</th>
                {isAdmin && <th>{t("drivers.colActions")}</th>}
              </tr>
            </thead>
            <tbody>
              {!rows.length ? (
                <tr className="empty-row"><td colSpan={isAdmin ? 23 : 22}>{t("common.noMatchingData")}</td></tr>
              ) : rows.map((g, i) => {
                const m = buildGroupMetrics(g, { vehicleRates, vehicleFuelTypes, stationRates, vehicleEndHistory, approvedFuelByKey });
                return (
                  <tr key={i}>
                    <td>{g.day}</td><td>{g.full_name}</td><td>{g.identity_number}</td>
                    <td>{g.project ? <ProjectBadge project={g.project} /> : "—"}</td>
                    <td>{g.vehicle_plate}</td>
                    <td><StatusBadge status={compareStatus(g)} /></td>
                    <td className="group-alt">{g.start?.odo_reading ?? "—"}</td><td className="group-alt">{g.end?.odo_reading ?? "—"}</td>
                    <td className="group-alt">{m.dist}</td><td className="group-alt">{m.fuelLiters}</td><td className="group-alt">{m.fuelCost}</td><td className="group-alt">{m.actualFuelCost}</td><td className="group-alt">{m.offDuty ?? "—"}</td>
                    <td className="group-alt">{formatLocalTime(g.start?.created_at)}</td><td className="group-alt">{formatLocalTime(g.end?.created_at)}</td>
                    <td>{g.start?.ofd_count ?? "—"}</td><td>{g.end?.cod_delivered ?? "—"}</td>
                    <td>{g.end?.ppd_delivered ?? "—"}</td><td>{g.end?.picked_up ?? "—"}</td>
                    <td>{m.delivered}</td><td>{m.deliveryPct}</td><td>{m.sales}</td>
                    {isAdmin && <td className="row-actions"><button className="btn" onClick={() => openDetail(g)}>{t("common.edit")}</button></td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
