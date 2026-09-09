import { useEffect, useMemo, useState } from "react";
import { useDashboard } from "../contexts/DataContext";
import { useLang } from "../contexts/LanguageContext";
import ProjectBadge from "../components/ProjectBadge";
import GlobalFilters from "../components/GlobalFilters";
import { sb } from "../lib/supabase";
import { formatLocalDateTime, formatRequestCode } from "../lib/calc";
import { downloadCsv } from "../lib/csv";
import { PROJECT_LIST } from "../lib/constants";
import { FUEL_STATUS_CLASS, FUEL_STATUS_KEY } from "../lib/fuelStatus";
import { getPageCache, setPageCache } from "../lib/pageCache";

const CSV_KEYS = [
  "request_no", "shift_date", "full_name", "identity_number", "project", "vehicle_plate",
  "station_name", "amount", "status", "requested_at",
];

export default function FuelMissingForm() {
  const { scopedRows, driverProjects, from, to } = useDashboard();
  const { t } = useLang();
  const cacheKey = `fuelMissingForm:${from}|${to}`;
  const cached = getPageCache(cacheKey);
  const [requests, setRequests] = useState(cached?.requests ?? []);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [project, setProject] = useState("");

  useEffect(() => {
    (async () => {
      const key = `fuelMissingForm:${from}|${to}`;
      if (!getPageCache(key)) setLoading(true);
      let q = sb.from("reinforcement_requests").select("*").order("shift_date", { ascending: false });
      if (from) q = q.gte("shift_date", from);
      if (to) q = q.lte("shift_date", to);
      const { data, error: err } = await q;
      if (err) { setError(err.message); setLoading(false); return; }
      const list = data || [];
      setRequests(list);
      setPageCache(key, { requests: list });
      setLoading(false);
    })();
  }, [from, to]);

  const formKeys = useMemo(() => {
    const set = new Set();
    for (const r of scopedRows || []) set.add(`${r.identity_number}|${r.shift_date}`);
    return set;
  }, [scopedRows]);

  const missingRows = useMemo(() => {
    let r = requests.filter(req => !formKeys.has(`${req.identity_number}|${req.shift_date}`));
    if (project) r = r.filter(row => driverProjects[row.identity_number] === project);
    if (search.trim()) {
      const s = search.trim().toLowerCase();
      r = r.filter(row => (row.full_name || "").toLowerCase().includes(s) || (row.identity_number || "").toLowerCase().includes(s));
    }
    return r;
  }, [requests, formKeys, project, search, driverProjects]);

  function handleReset() {
    setSearch("");
    setProject("");
  }

  function handleExport() {
    if (!missingRows.length) return;
    const csvRows = missingRows.map(r => ({
      request_no: formatRequestCode(r.request_no),
      shift_date: r.shift_date,
      full_name: r.full_name,
      identity_number: r.identity_number,
      project: driverProjects[r.identity_number] || "",
      vehicle_plate: r.vehicle_plate,
      station_name: r.station_name || "",
      amount: r.amount ?? "",
      status: t(FUEL_STATUS_KEY[r.status]),
      requested_at: formatLocalDateTime(r.created_at),
    }));
    downloadCsv(`fuel_requests_missing_form_${new Date().toISOString().slice(0, 10)}.csv`, CSV_KEYS, csvRows);
  }

  return (
    <>
      <div className="content-header">
        <div>
          <div className="breadcrumb">{t("common.dashboard")} &gt; <b>{t("fuel.missingFormBreadcrumb")}</b></div>
          <h1 className="page-title">{t("fuel.missingFormBreadcrumb")}</h1>
        </div>
        <button className="btn" onClick={handleExport}>{t("common.exportCsv")}</button>
      </div>
      <p className="sub" style={{ margin: "-0.6rem 0 1rem" }}>{t("fuel.missingFormSubtitle")}</p>
      <GlobalFilters />

      <div className="local-filters">
        <div className="field">
          <label>{t("common.searchByNameOrId")}</label>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder={t("common.typeHere")} />
        </div>
        <div className="field">
          <label>{t("common.project")}</label>
          <select value={project} onChange={e => setProject(e.target.value)}>
            <option value="">{t("common.allProjects")}</option>
            {PROJECT_LIST.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <button className="btn" onClick={handleReset}>{t("common.clearFilters")}</button>
      </div>
      <div className="cards-count">{t("compare.recordsCount", { n: missingRows.length })}</div>

      {error && <div style={{ color: "var(--critical)", fontSize: "0.85rem", marginBottom: "1rem" }}>{error}</div>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("fuel.colRequestNo")}</th><th>{t("fuel.colDate")}</th><th>{t("fuel.colDriver")}</th><th>{t("fuel.colIdNumber")}</th><th>{t("common.project")}</th><th>{t("fuel.colPlate")}</th>
              <th>{t("fuel.colStation")}</th><th>{t("fuel.colAmount")}</th><th>{t("fuel.colStatus")}</th><th>{t("fuel.colRequestedAt")}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr className="empty-row"><td colSpan={10}>{t("common.loading")}</td></tr>
            ) : !missingRows.length ? (
              <tr className="empty-row"><td colSpan={10}>{t("fuel.noMissingForm")}</td></tr>
            ) : missingRows.map(r => (
              <tr key={r.id}>
                <td><b>{formatRequestCode(r.request_no)}</b></td>
                <td>{r.shift_date}</td>
                <td>{r.full_name}</td>
                <td>{r.identity_number}</td>
                <td>{driverProjects[r.identity_number] ? <ProjectBadge project={driverProjects[r.identity_number]} /> : "—"}</td>
                <td>{r.vehicle_plate}</td>
                <td>{r.station_name || "—"}</td>
                <td>{r.amount ?? "—"}</td>
                <td><span className={`badge ${FUEL_STATUS_CLASS[r.status]}`}>{t(FUEL_STATUS_KEY[r.status])}</span></td>
                <td>{formatLocalDateTime(r.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
