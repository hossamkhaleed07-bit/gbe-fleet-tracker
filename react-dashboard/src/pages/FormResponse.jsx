import { useMemo, useState } from "react";
import { useDashboard } from "../contexts/DataContext";
import { useDetailModal } from "../contexts/DetailModalContext";
import ProjectBadge from "../components/ProjectBadge";
import { useAuth } from "../contexts/AuthContext";
import { useLang } from "../contexts/LanguageContext";
import { useUndo } from "../contexts/UndoContext";
import GlobalFilters from "../components/GlobalFilters";
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

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("records.colShiftDate")}</th><th>{t("records.colTimestamp")}</th><th>{t("records.colType")}</th><th>{t("records.colDriver")}</th><th>{t("records.colIdNumber")}</th><th>{t("common.project")}</th><th>{t("common.plate")}</th>
              <th>{t("records.colStation")}</th><th>{t("records.colOdometerSingle")}</th><th>{t("records.colMedia")}</th><th>{t("records.colArea")}</th>{canEditShiftEntries && <th></th>}
            </tr>
          </thead>
          <tbody>
            {!rows.length ? (
              <tr className="empty-row"><td colSpan={12}>{t("records.noMatchingRecords")}</td></tr>
            ) : rows.map(r => {
              const media = [];
              if (r.odo_photo_url) media.push(<a key="op" className="media-link" href={r.odo_photo_url} target="_blank" rel="noreferrer">{r.shift_type === "start" ? t("records.mediaStartOdo") : t("records.mediaEndOdo")}</a>);
              if (r.condition_video_url) media.push(<a key="cv" className="media-link" href={r.condition_video_url} target="_blank" rel="noreferrer">{t("records.mediaVideo")}</a>);
              if (r.client_screenshot_url) media.push(<a key="cs" className="media-link" href={r.client_screenshot_url} target="_blank" rel="noreferrer">{t("records.mediaScreenshot")}</a>);
              return (
                <tr key={r.id}>
                  <td>{r.shift_date}</td>
                  <td>{formatLocalDateTime(r.created_at)}</td>
                  <td><span className={"badge " + (r.shift_type === "start" ? "start" : "end")}>{r.shift_type === "start" ? t("records.typeStart") : t("records.typeEnd")}</span></td>
                  <td>{r.full_name}</td>
                  <td>{r.identity_number}</td>
                  <td>{driverProjects[r.identity_number] ? <ProjectBadge project={driverProjects[r.identity_number]} /> : "—"}</td>
                  <td>{r.vehicle_plate}</td>
                  <td>{r.station_name}</td>
                  <td>{r.odo_reading ?? "—"}</td>
                  <td>{media.length ? media.reduce((acc, el, idx) => idx === 0 ? [el] : [...acc, " · ", el], []) : "—"}</td>
                  <td>{r.area}</td>
                  {canEditShiftEntries && (
                    <td className="row-actions">
                      <button className="btn" onClick={() => openSingleDetail(r)}>{t("records.viewEdit")}</button>
                      <button className="btn btn-danger" disabled={busyDelete === r.id} onClick={() => handleDelete(r)}>
                        {busyDelete === r.id ? "..." : t("common.delete")}
                      </button>
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
