import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useDashboard } from "../contexts/DataContext";
import { useDetailModal } from "../contexts/DetailModalContext";
import { StatusBadge } from "../components/DetailModal";
import ProjectBadge from "../components/ProjectBadge";
import { useAuth } from "../contexts/AuthContext";
import { useLang } from "../contexts/LanguageContext";
import { useUndo } from "../contexts/UndoContext";
import GlobalFilters from "../components/GlobalFilters";
import { sb } from "../lib/supabase";
import { compareStatus, buildGroupMetrics, localToday } from "../lib/calc";
import { downloadCsv, GROUP_CSV_KEYS, groupToCsvRow } from "../lib/csv";
import { PROJECT_LIST } from "../lib/constants";

function daysInRange(fromStr, toStr) {
  const start = fromStr || toStr || localToday();
  const end = toStr || localToday();
  const days = [];
  const d = new Date(start + "T00:00:00Z");
  const endD = new Date(end + "T00:00:00Z");
  while (d <= endD && days.length < 62) {
    days.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return days;
}

export default function Records() {
  const {
    scopedCompareGroups: allCompareGroups, scopedDrivers, vehicleEndHistory, vehicleRates, vehicleFuelTypes,
    stationRates, approvedFuelByKey, removeShiftEntries, addShiftEntries, from, to,
  } = useDashboard();
  const { openDetail } = useDetailModal();
  const { canEditShiftEntries } = useAuth();
  const { t } = useLang();
  const { pushUndo } = useUndo();
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(searchParams.get("status") || "");
  const [project, setProject] = useState("");
  const [busyDelete, setBusyDelete] = useState(null);

  const missingRows = useMemo(() => {
    if (status !== "incomplete_or_missing") return [];
    const days = daysInRange(from, to);
    const submitted = new Set(allCompareGroups.map(g => `${g.identity_number}|${g.day}`));
    const rows = [];
    for (const d of scopedDrivers) {
      if (!d.is_active) continue;
      for (const day of days) {
        if (!submitted.has(`${d.identity_number}|${day}`)) {
          rows.push({
            day, identity_number: d.identity_number, full_name: d.full_name,
            vehicle_plate: d.assigned_vehicle_plate || null, project: d.project || null,
            start: null, end: null, synthetic: true,
          });
        }
      }
    }
    return rows;
  }, [status, from, to, allCompareGroups, scopedDrivers]);

  const rows = useMemo(() => {
    let r = allCompareGroups;
    if (status === "complete") r = r.filter(g => g.start && g.end);
    if (status === "partial") r = r.filter(g => !(g.start && g.end));
    if (status === "incomplete_or_missing") r = [...r.filter(g => !(g.start && g.end)), ...missingRows];
    if (project) r = r.filter(g => g.project === project);
    if (search.trim()) {
      const s = search.trim().toLowerCase();
      r = r.filter(g =>
        (g.full_name || "").toLowerCase().includes(s) ||
        (g.identity_number || "").toLowerCase().includes(s) ||
        (g.vehicle_plate || "").toLowerCase().includes(s)
      );
    }
    return [...r].sort((a, b) => b.day.localeCompare(a.day) || (a.full_name || "").localeCompare(b.full_name || ""));
  }, [allCompareGroups, missingRows, status, project, search]);

  async function handleDelete(g) {
    if (!window.confirm(t("records.confirmDelete"))) return;
    const toRestore = [g.start, g.end].filter(Boolean);
    const ids = toRestore.map(r => r.id);
    setBusyDelete(ids.join(","));
    const { error } = await sb.from("shift_entries").delete().in("id", ids);
    setBusyDelete(null);
    if (error) { window.alert(t("common.deleteFailed") + error.message); return; }
    removeShiftEntries(ids);
    pushUndo(t("records.undoDeleteLabel", { name: g.full_name }), async () => {
      const { error: restoreErr } = await sb.from("shift_entries").insert(toRestore);
      if (restoreErr) throw restoreErr;
      addShiftEntries(toRestore);
    });
  }

  function handleExport() {
    if (!rows.length) return;
    const ctx = { vehicleRates, vehicleFuelTypes, stationRates, vehicleEndHistory, approvedFuelByKey, buildGroupMetrics };
    downloadCsv(`shift_entries_${new Date().toISOString().slice(0, 10)}.csv`, GROUP_CSV_KEYS, rows.map(g => groupToCsvRow(g, ctx)));
  }

  return (
    <>
      <div className="content-header">
        <div>
          <div className="breadcrumb">{t("common.dashboard")} &gt; <b>{t("records.breadcrumb")}</b></div>
          <h1 className="page-title">{t("records.breadcrumb")}</h1>
        </div>
        <button className="btn" onClick={handleExport}>{t("common.exportCsv")}</button>
      </div>
      <GlobalFilters />

      <div className="local-filters">
        <div className="field">
          <label>{t("records.searchLabel")}</label>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder={t("common.typeHere")} />
        </div>
        <div className="field">
          <label>{t("common.status")}</label>
          <select value={status} onChange={e => setStatus(e.target.value)}>
            <option value="">{t("common.all")}</option>
            <option value="complete">{t("common.complete")}</option>
            <option value="partial">{t("common.incomplete")}</option>
            <option value="incomplete_or_missing">{t("records.statusIncompleteOrMissing")}</option>
          </select>
        </div>
        <div className="field">
          <label>{t("common.project")}</label>
          <select value={project} onChange={e => setProject(e.target.value)}>
            <option value="">{t("common.allProjects")}</option>
            {PROJECT_LIST.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("records.colShiftDate")}</th><th>{t("common.status")}</th><th>{t("records.colDriver")}</th><th>{t("records.colIdNumber")}</th><th>{t("common.project")}</th><th>{t("common.plate")}</th>
              <th>{t("records.colStation")}</th><th>{t("records.colOdometer")}</th><th>{t("records.colMedia")}</th><th>{t("records.colArea")}</th>{canEditShiftEntries && <th></th>}
            </tr>
          </thead>
          <tbody>
            {!rows.length ? (
              <tr className="empty-row"><td colSpan={11}>{t("records.noMatchingRecords")}</td></tr>
            ) : rows.map((g, i) => {
              const media = [];
              if (g.start?.odo_photo_url) media.push(<a key="op" className="media-link" href={g.start.odo_photo_url} target="_blank" rel="noreferrer">{t("records.mediaStartOdo")}</a>);
              if (g.start?.condition_video_url) media.push(<a key="cv" className="media-link" href={g.start.condition_video_url} target="_blank" rel="noreferrer">{t("records.mediaVideo")}</a>);
              if (g.end?.odo_photo_url) media.push(<a key="oe" className="media-link" href={g.end.odo_photo_url} target="_blank" rel="noreferrer">{t("records.mediaEndOdo")}</a>);
              if (g.end?.client_screenshot_url) media.push(<a key="cs" className="media-link" href={g.end.client_screenshot_url} target="_blank" rel="noreferrer">{t("records.mediaScreenshot")}</a>);
              const station = g.end?.station_name || g.start?.station_name;
              const area = g.end?.area || g.start?.area;
              const ids = [g.start?.id, g.end?.id].filter(Boolean).join(",");
              return (
                <tr key={`${g.identity_number}-${g.day}-${i}`}>
                  <td>{g.day}</td>
                  <td><StatusBadge status={compareStatus(g)} /></td>
                  <td>{g.full_name}</td>
                  <td>{g.identity_number}</td>
                  <td>{g.project ? <ProjectBadge project={g.project} /> : "—"}</td>
                  <td>{g.vehicle_plate || "—"}</td>
                  <td>{station || "—"}</td>
                  <td>{g.start?.odo_reading ?? "—"} → {g.end?.odo_reading ?? "—"}</td>
                  <td>{media.length ? media.reduce((acc, el, idx) => idx === 0 ? [el] : [...acc, " · ", el], []) : "—"}</td>
                  <td>{area || "—"}</td>
                  {canEditShiftEntries && (
                    <td className="row-actions">
                      {g.synthetic ? "—" : (
                        <>
                          <button className="btn" onClick={() => openDetail(g)}>{t("records.viewEdit")}</button>
                          <button className="btn btn-danger" disabled={busyDelete === ids} onClick={() => handleDelete(g)}>
                            {busyDelete === ids ? "..." : t("common.delete")}
                          </button>
                        </>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
