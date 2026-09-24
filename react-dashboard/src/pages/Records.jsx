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
import DataTable from "../components/DataTable";
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
    stationRates, approvedFuelByKey, automaticFuelByKey, removeShiftEntries, addShiftEntries, from, to,
  } = useDashboard();
  const { openDetail } = useDetailModal();
  const { canEditShiftEntries } = useAuth();
  const { t } = useLang();
  const { pushUndo } = useUndo();
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(searchParams.get("status") || "");
  const [project, setProject] = useState(searchParams.get("project") || "");
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
    if (status === "start_only") r = r.filter(g => g.start && !g.end);
    if (status === "end_only") r = r.filter(g => !g.start && g.end);
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
    const ctx = { vehicleRates, vehicleFuelTypes, stationRates, vehicleEndHistory, approvedFuelByKey, automaticFuelByKey, buildGroupMetrics };
    downloadCsv(`shift_entries_${new Date().toISOString().slice(0, 10)}.csv`, GROUP_CSV_KEYS, rows.map(g => groupToCsvRow(g, ctx)));
  }

  const columns = useMemo(() => {
    const cols = [
      { accessorKey: "day", header: t("records.colShiftDate") },
      {
        id: "status", header: t("common.status"), enableSorting: false,
        cell: ({ row }) => <StatusBadge status={compareStatus(row.original)} />,
      },
      { accessorKey: "full_name", header: t("records.colDriver") },
      { accessorKey: "identity_number", header: t("records.colIdNumber") },
      {
        id: "project", header: t("common.project"), accessorFn: g => g.project || "",
        cell: ({ row }) => row.original.project ? <ProjectBadge project={row.original.project} /> : "—",
      },
      { id: "vehicle_plate", header: t("common.plate"), accessorFn: g => g.vehicle_plate || "—" },
      { id: "station", header: t("records.colStation"), accessorFn: g => g.end?.station_name || g.start?.station_name || "—" },
      {
        id: "odometer", header: t("records.colOdometer"), enableSorting: false,
        cell: ({ row }) => `${row.original.start?.odo_reading ?? "—"} → ${row.original.end?.odo_reading ?? "—"}`,
      },
      {
        id: "media", header: t("records.colMedia"), enableSorting: false,
        cell: ({ row }) => {
          const g = row.original;
          const media = [];
          if (g.start?.odo_photo_url) media.push(<a key="op" className="media-link" href={g.start.odo_photo_url} target="_blank" rel="noreferrer">{t("records.mediaStartOdo")}</a>);
          if (g.start?.condition_video_url) media.push(<a key="cv" className="media-link" href={g.start.condition_video_url} target="_blank" rel="noreferrer">{t("records.mediaVideo")}</a>);
          if (g.end?.odo_photo_url) media.push(<a key="oe" className="media-link" href={g.end.odo_photo_url} target="_blank" rel="noreferrer">{t("records.mediaEndOdo")}</a>);
          if (g.end?.client_screenshot_url) media.push(<a key="cs" className="media-link" href={g.end.client_screenshot_url} target="_blank" rel="noreferrer">{t("records.mediaScreenshot")}</a>);
          return media.length ? media.reduce((acc, el, idx) => idx === 0 ? [el] : [...acc, " · ", el], []) : "—";
        },
      },
      { id: "area", header: t("records.colArea"), accessorFn: g => g.end?.area || g.start?.area || "—" },
    ];
    if (canEditShiftEntries) {
      cols.push({
        id: "actions", header: "", enableSorting: false,
        cell: ({ row }) => {
          const g = row.original;
          if (g.synthetic) return "—";
          const ids = [g.start?.id, g.end?.id].filter(Boolean).join(",");
          return (
            <div className="row-actions">
              <button className="btn" onClick={() => openDetail(g)}>{t("records.viewEdit")}</button>
              <button className="btn btn-danger" disabled={busyDelete === ids} onClick={() => handleDelete(g)}>
                {busyDelete === ids ? "..." : t("common.delete")}
              </button>
            </div>
          );
        },
      });
    }
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, canEditShiftEntries, busyDelete]);

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
            <option value="start_only">{t("detailModal.startOnly")}</option>
            <option value="end_only">{t("detailModal.endOnly")}</option>
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

      <DataTable columns={columns} data={rows} emptyMessage={t("records.noMatchingRecords")} />
    </>
  );
}
