import { useMemo, useState } from "react";
import { useDashboard } from "../contexts/DataContext";
import { useDetailModal } from "../contexts/DetailModalContext";
import ProjectBadge from "../components/ProjectBadge";
import { useAuth } from "../contexts/AuthContext";
import { useLang } from "../contexts/LanguageContext";
import { useUndo } from "../contexts/UndoContext";
import GlobalFilters from "../components/GlobalFilters";
import DataTable from "../components/DataTable";
import { sb } from "../lib/supabase";
import { formatLocalDateTime } from "../lib/calc";
import { PROJECT_LIST } from "../lib/constants";

export default function FormResponse() {
  const { scopedRows, driverProjects, removeShiftEntries, addShiftEntries } = useDashboard();
  const { openDetail } = useDetailModal();
  const { canEditShiftEntries } = useAuth();
  const { t } = useLang();
  const { pushUndo } = useUndo();
  const [search, setSearch] = useState("");
  const [project, setProject] = useState("");
  const [type, setType] = useState("");
  const [busyDelete, setBusyDelete] = useState(null);

  const rows = useMemo(() => {
    let r = scopedRows || [];
    if (project) r = r.filter(x => driverProjects[x.identity_number] === project);
    if (type) r = r.filter(x => x.shift_type === type);
    if (search.trim()) {
      const s = search.trim().toLowerCase();
      r = r.filter(x =>
        (x.full_name || "").toLowerCase().includes(s) ||
        (x.identity_number || "").toLowerCase().includes(s) ||
        (x.vehicle_plate || "").toLowerCase().includes(s)
      );
    }
    return [...r].sort((a, b) =>
      (b.shift_date || "").localeCompare(a.shift_date || "") ||
      (b.created_at || "").localeCompare(a.created_at || "")
    );
  }, [scopedRows, project, type, search, driverProjects]);

  async function handleDelete(r) {
    if (!window.confirm(t("records.confirmDeleteSingle"))) return;
    setBusyDelete(r.id);
    const { error } = await sb.from("shift_entries").delete().eq("id", r.id);
    setBusyDelete(null);
    if (error) { window.alert(t("common.deleteFailed") + error.message); return; }
    removeShiftEntries([r.id]);
    pushUndo(t("records.undoDeleteLabel", { name: r.full_name }), async () => {
      const { error: restoreErr } = await sb.from("shift_entries").insert(r);
      if (restoreErr) throw restoreErr;
      addShiftEntries([r]);
    });
  }

  const columns = useMemo(() => {
    const cols = [
      { accessorKey: "shift_date", header: t("records.colShiftDate") },
      { accessorKey: "created_at", header: t("records.colTimestamp"), cell: ({ getValue }) => formatLocalDateTime(getValue()) },
      {
        id: "type", header: t("records.colType"), enableSorting: false,
        cell: ({ row }) => (
          <span className={"badge " + (row.original.shift_type === "start" ? "start" : "end")}>
            {row.original.shift_type === "start" ? t("records.typeStart") : t("records.typeEnd")}
          </span>
        ),
      },
      { accessorKey: "full_name", header: t("records.colDriver") },
      { accessorKey: "identity_number", header: t("records.colIdNumber") },
      {
        id: "project", header: t("common.project"), accessorFn: r => driverProjects[r.identity_number] || "",
        cell: ({ row }) => driverProjects[row.original.identity_number] ? <ProjectBadge project={driverProjects[row.original.identity_number]} /> : "—",
      },
      { accessorKey: "vehicle_plate", header: t("common.plate") },
      { accessorKey: "station_name", header: t("records.colStation") },
      { accessorKey: "odo_reading", header: t("records.colOdometerSingle"), cell: ({ getValue }) => getValue() ?? "—" },
      {
        id: "media", header: t("records.colMedia"), enableSorting: false,
        cell: ({ row }) => {
          const r = row.original;
          const media = [];
          if (r.odo_photo_url) media.push(<a key="op" className="media-link" href={r.odo_photo_url} target="_blank" rel="noreferrer">{r.shift_type === "start" ? t("records.mediaStartOdo") : t("records.mediaEndOdo")}</a>);
          if (r.condition_video_url) media.push(<a key="cv" className="media-link" href={r.condition_video_url} target="_blank" rel="noreferrer">{t("records.mediaVideo")}</a>);
          if (r.client_screenshot_url) media.push(<a key="cs" className="media-link" href={r.client_screenshot_url} target="_blank" rel="noreferrer">{t("records.mediaScreenshot")}</a>);
          return media.length ? media.reduce((acc, el, idx) => idx === 0 ? [el] : [...acc, " · ", el], []) : "—";
        },
      },
      { accessorKey: "area", header: t("records.colArea") },
    ];
    if (canEditShiftEntries) {
      cols.push({
        id: "actions", header: "", enableSorting: false,
        cell: ({ row }) => (
          <div className="row-actions">
            <button className="btn" onClick={() => openSingleDetail(row.original)}>{t("records.viewEdit")}</button>
            <button className="btn btn-danger" disabled={busyDelete === row.original.id} onClick={() => handleDelete(row.original)}>
              {busyDelete === row.original.id ? "..." : t("common.delete")}
            </button>
          </div>
        ),
      });
    }
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, canEditShiftEntries, busyDelete, driverProjects]);

  function openSingleDetail(r) {
    openDetail({
      day: r.shift_date,
      identity_number: r.identity_number,
      full_name: r.full_name,
      vehicle_plate: r.vehicle_plate,
      project: driverProjects[r.identity_number] || null,
      start: r.shift_type === "start" ? r : null,
      end: r.shift_type === "end" ? r : null,
    });
  }

  return (
    <>
      <div className="content-header">
        <div>
          <div className="breadcrumb">{t("common.dashboard")} &gt; <b>{t("formResponse.breadcrumb")}</b></div>
          <h1 className="page-title">{t("formResponse.breadcrumb")}</h1>
        </div>
      </div>
      <p className="sub" style={{ margin: "-0.6rem 0 1rem" }}>{t("formResponse.subtitle")}</p>
      <GlobalFilters />

      <div className="local-filters">
        <div className="field">
          <label>{t("records.searchLabel")}</label>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder={t("common.typeHere")} />
        </div>
        <div className="field">
          <label>{t("records.colType")}</label>
          <select value={type} onChange={e => setType(e.target.value)}>
            <option value="">{t("common.all")}</option>
            <option value="start">{t("records.typeStart")}</option>
            <option value="end">{t("records.typeEnd")}</option>
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
