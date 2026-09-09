import { useEffect, useMemo, useState } from "react";
import { useDashboard } from "../contexts/DataContext";
import { useAuth } from "../contexts/AuthContext";
import { useLang } from "../contexts/LanguageContext";
import ProjectBadge from "../components/ProjectBadge";
import FuelRequestModal from "../components/FuelRequestModal";
import { sb } from "../lib/supabase";
import { formatLocalDateTime, formatRequestCode } from "../lib/calc";
import { downloadCsv } from "../lib/csv";
import { PROJECT_LIST } from "../lib/constants";
import { FUEL_STATUS_CLASS as STATUS_CLASS, FUEL_STATUS_KEY as STATUS_KEY } from "../lib/fuelStatus";
import { getPageCache, setPageCache } from "../lib/pageCache";

const CACHE_KEY = "fuelApproval.all";

const FUEL_CSV_KEYS = [
  "request_no", "shift_date", "full_name", "identity_number", "project", "vehicle_plate",
  "station_name", "odo_reading", "amount", "loan_adjustment", "total_loan", "status", "reviewed_by", "reviewed_at",
];

export default function FuelApproval() {
  const { driverProjects } = useDashboard();
  const { session, isAdmin } = useAuth();
  const { t } = useLang();
  const cached = getPageCache(CACHE_KEY);
  const [rows, setRows] = useState(cached?.rows ?? []);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [search, setSearch] = useState("");
  const [date, setDate] = useState("");
  const [project, setProject] = useState("");
  const [status, setStatus] = useState("");

  function updateRows(updater) {
    setRows(prev => {
      const next = updater(prev);
      setPageCache(CACHE_KEY, { rows: next });
      return next;
    });
  }

  useEffect(() => {
    (async () => {
      if (!getPageCache(CACHE_KEY)) setLoading(true);
      const { data, error: err } = await sb.from("reinforcement_requests").select("*").order("created_at", { ascending: false });
      if (err) { setError(err.message); setLoading(false); return; }
      updateRows(() => data || []);
      setLoading(false);
    })();
  }, []);

  async function changeStatus(row, newStatus) {
    if (newStatus === row.status) return;
    setSavingId(row.id);
    setError("");
    const reviewed_by = session?.user?.email || null;
    const reviewed_at = new Date().toISOString();
    const { error: err } = await sb.from("reinforcement_requests").update({ status: newStatus, reviewed_by, reviewed_at }).eq("id", row.id);
    setSavingId(null);
    if (err) { setError(t("common.saveFailed") + err.message); return; }
    updateRows(rs => rs.map(r => (r.id === row.id ? { ...r, status: newStatus, reviewed_by, reviewed_at } : r)));
  }

  const filteredRows = useMemo(() => {
    let r = rows;
    if (search.trim()) {
      const s = search.trim().toLowerCase();
      r = r.filter(row => (row.full_name || "").toLowerCase().includes(s) || (row.identity_number || "").toLowerCase().includes(s));
    }
    if (date) r = r.filter(row => row.shift_date === date);
    if (project) r = r.filter(row => driverProjects[row.identity_number] === project);
    if (status) r = r.filter(row => row.status === status);
    return r;
  }, [rows, search, date, project, status, driverProjects]);

  function handleReset() {
    setSearch("");
    setDate("");
    setProject("");
    setStatus("");
  }

  function handleExport() {
    if (!filteredRows.length) return;
    const csvRows = filteredRows.map(r => ({
      request_no: formatRequestCode(r.request_no),
      shift_date: r.shift_date,
      full_name: r.full_name,
      identity_number: r.identity_number,
      project: driverProjects[r.identity_number] || "",
      vehicle_plate: r.vehicle_plate,
      station_name: r.station_name || "",
      odo_reading: r.odo_reading ?? "",
      amount: r.amount ?? "",
      loan_adjustment: r.loan_adjustment ?? "",
      total_loan: r.amount != null ? (Number(r.amount) + (Number(r.loan_adjustment) || 0)) : "",
      status: t(STATUS_KEY[r.status]),
      reviewed_by: r.reviewed_by || "",
      reviewed_at: r.reviewed_at ? formatLocalDateTime(r.reviewed_at) : "",
    }));
    downloadCsv(`fuel_requests_${new Date().toISOString().slice(0, 10)}.csv`, FUEL_CSV_KEYS, csvRows);
  }

  return (
    <>
      <div className="content-header">
        <div>
          <div className="breadcrumb">{t("common.dashboard")} &gt; <b>{t("fuel.approvalBreadcrumb")}</b></div>
          <h1 className="page-title">{t("fuel.approvalBreadcrumb")}</h1>
        </div>
        <button className="btn" onClick={handleExport}>{t("common.exportCsv")}</button>
      </div>
      {error && <div style={{ color: "var(--critical)", fontSize: "0.85rem", marginBottom: "1rem" }}>{error}</div>}

      <div className="local-filters">
        <div className="field">
          <label>{t("common.searchByNameOrId")}</label>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder={t("common.typeHere")} />
        </div>
        <div className="field">
          <label>{t("fuel.colDate")}</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
        <div className="field">
          <label>{t("common.project")}</label>
          <select value={project} onChange={e => setProject(e.target.value)}>
            <option value="">{t("common.allProjects")}</option>
            {PROJECT_LIST.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div className="field">
          <label>{t("common.status")}</label>
          <select value={status} onChange={e => setStatus(e.target.value)}>
            <option value="">{t("common.all")}</option>
            <option value="pending">{t("fuel.statusPending")}</option>
            <option value="approved">{t("fuel.statusApproved")}</option>
            <option value="rejected">{t("fuel.statusRejected")}</option>
          </select>
        </div>
        <button className="btn" onClick={handleReset}>{t("common.clearFilters")}</button>
      </div>
      <div className="cards-count">{t("compare.recordsCount", { n: filteredRows.length })}</div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("fuel.colRequestNo")}</th><th>{t("fuel.colDate")}</th><th>{t("fuel.colDriver")}</th><th>{t("fuel.colIdNumber")}</th><th>{t("common.project")}</th><th>{t("fuel.colPlate")}</th>
              <th>{t("fuel.colStation")}</th><th>{t("fuel.colOdoReading")}</th><th>{t("fuel.colOdoPhoto")}</th><th>{t("fuel.colAmount")}</th>
              <th>{t("fuel.colLoanAdjustment")}</th><th>{t("fuel.colTotalLoan")}</th><th>{t("fuel.colStatus")}</th><th>{t("fuel.colReviewedBy")}</th><th>{t("fuel.colReviewedAt")}</th><th>{t("fuel.colActions")}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr className="empty-row"><td colSpan={16}>{t("common.loading")}</td></tr>
            ) : !filteredRows.length ? (
              <tr className="empty-row"><td colSpan={16}>{t("fuel.noRequestsFound")}</td></tr>
            ) : filteredRows.map(r => (
              <tr key={r.id}>
                <td><b>{formatRequestCode(r.request_no)}</b></td>
                <td>{r.shift_date}</td>
                <td>{r.full_name}</td>
                <td>{r.identity_number}</td>
                <td>{driverProjects[r.identity_number] ? <ProjectBadge project={driverProjects[r.identity_number]} /> : "—"}</td>
                <td>{r.vehicle_plate}</td>
                <td>{r.station_name || "—"}</td>
                <td>{r.odo_reading ?? "—"}</td>
                <td>{r.odo_photo_url ? <a className="media-link" href={r.odo_photo_url} target="_blank" rel="noreferrer">{t("fuel.viewPhoto")}</a> : "—"}</td>
                <td>{r.amount ?? "—"}</td>
                <td>{r.loan_adjustment ?? "—"}</td>
                <td>{r.amount != null ? (Number(r.amount) + (Number(r.loan_adjustment) || 0)) : "—"}</td>
                <td>
                  {isAdmin && r.status !== "pending" ? (
                    <select
                      className={`badge ${STATUS_CLASS[r.status]}`}
                      value={r.status}
                      disabled={savingId === r.id}
                      onChange={e => changeStatus(r, e.target.value)}
                    >
                      <option value="approved">{t("fuel.statusApproved")}</option>
                      <option value="rejected">{t("fuel.statusRejected")}</option>
                    </select>
                  ) : (
                    <span className={`badge ${STATUS_CLASS[r.status]}`}>{t(STATUS_KEY[r.status])}</span>
                  )}
                </td>
                <td>{r.reviewed_by || "—"}</td>
                <td>{formatLocalDateTime(r.reviewed_at)}</td>
                <td className="row-actions"><button className="btn" onClick={() => setViewing(r)}>{t("fuel.openRequest")}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {viewing && (
        <FuelRequestModal
          request={viewing}
          onClose={() => setViewing(null)}
          onSaved={updated => {
            updateRows(rs => rs.map(r => (r.id === updated.id ? updated : r)));
            setViewing(null);
          }}
        />
      )}
    </>
  );
}
