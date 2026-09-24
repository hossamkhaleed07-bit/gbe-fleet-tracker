import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useDashboard } from "../contexts/DataContext";
import { useAuth } from "../contexts/AuthContext";
import { useLang } from "../contexts/LanguageContext";
import { useToast } from "../contexts/ToastContext";
import ProjectBadge from "../components/ProjectBadge";
import FuelRequestModal from "../components/FuelRequestModal";
import RejectReasonModal from "../components/RejectReasonModal";
import ApproveConfirmModal from "../components/ApproveConfirmModal";
import DataTable from "../components/DataTable";
import { sb } from "../lib/supabase";
import { formatLocalDateTime, formatRequestCode, localToday } from "../lib/calc";
import { downloadCsv } from "../lib/csv";
import { PROJECT_LIST } from "../lib/constants";
import { FUEL_STATUS_CLASS as STATUS_CLASS, FUEL_STATUS_KEY as STATUS_KEY } from "../lib/fuelStatus";
import { getPageCache, setPageCache } from "../lib/pageCache";
import { deriveAttendanceStatus } from "../lib/attendanceCodes";

const CACHE_KEY = "fuelApproval.all";

const FUEL_CSV_KEYS = [
  "request_no", "shift_date", "full_name", "identity_number", "project", "vehicle_plate",
  "station_name", "odo_reading", "amount", "loan_adjustment", "total_loan", "status", "reviewed_by", "reviewed_at", "rejection_reason",
];

export default function FuelApproval() {
  const { driverProjects } = useDashboard();
  const { session, isAdmin } = useAuth();
  const { t } = useLang();
  const { showToast } = useToast();
  const cached = getPageCache(CACHE_KEY);
  const [rows, setRows] = useState(cached?.rows ?? []);
  const [loading, setLoading] = useState(!cached);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [approveTarget, setApproveTarget] = useState(null);
  const [targetAttendance, setTargetAttendance] = useState(null);
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [date, setDate] = useState("");
  const [project, setProject] = useState(() => searchParams.get("project") || "");
  const [status, setStatus] = useState(() => searchParams.get("status") || "");

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

  function handleStatusSelect(row, newStatus) {
    if (newStatus === row.status) return;
    if (newStatus === "rejected") { setRejectTarget(row); return; }
    if (newStatus === "approved") { setApproveTarget(row); return; }
    changeStatus(row, newStatus);
  }

  const confirmTarget = rejectTarget || approveTarget;
  useEffect(() => {
    if (!confirmTarget) { setTargetAttendance(null); return; }
    (async () => {
      const { data } = await sb.from("driver_attendance").select("status")
        .eq("identity_number", confirmTarget.identity_number).eq("attendance_date", confirmTarget.shift_date).maybeSingle();
      // A reinforcement request always has a shift-start for its day (#037),
      // so with no explicit override the effective status is always "P".
      setTargetAttendance(deriveAttendanceStatus({ explicitStatus: data?.status, hasShiftEntry: true, day: confirmTarget.shift_date, today: localToday() }));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmTarget?.id]);

  async function changeStatus(row, newStatus, rejectionReason) {
    setSavingId(row.id);
    setError("");
    const reviewed_by = session?.user?.email || null;
    const reviewed_at = new Date().toISOString();
    const payload = { status: newStatus, reviewed_by, reviewed_at, ...(newStatus === "rejected" ? { rejection_reason: rejectionReason } : {}) };
    const { error: err } = await sb.from("reinforcement_requests").update(payload).eq("id", row.id);
    setSavingId(null);
    if (err) {
      setError(t("common.saveFailed") + err.message);
      showToast(t("fuel.actionFailed") + err.message, "error");
      return;
    }
    updateRows(rs => rs.map(r => (r.id === row.id ? { ...r, ...payload } : r)));
    setRejectTarget(null);
    setApproveTarget(null);
    showToast(newStatus === "approved" ? t("fuel.toastApproved") : t("fuel.toastRejected"), newStatus === "approved" ? "success" : "error");
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

  const columns = useMemo(() => [
    { accessorKey: "request_no", header: t("fuel.colRequestNo"), cell: ({ getValue }) => <b>{formatRequestCode(getValue())}</b> },
    { accessorKey: "shift_date", header: t("fuel.colDate") },
    { accessorKey: "full_name", header: t("fuel.colDriver") },
    { accessorKey: "identity_number", header: t("fuel.colIdNumber") },
    {
      id: "project", header: t("common.project"),
      accessorFn: r => driverProjects[r.identity_number] || "",
      cell: ({ row }) => driverProjects[row.original.identity_number] ? <ProjectBadge project={driverProjects[row.original.identity_number]} /> : "—",
    },
    { accessorKey: "vehicle_plate", header: t("fuel.colPlate") },
    { accessorKey: "station_name", header: t("fuel.colStation"), cell: ({ getValue }) => getValue() || "—" },
    { accessorKey: "odo_reading", header: t("fuel.colOdoReading"), meta: { align: "end" }, cell: ({ getValue }) => getValue() ?? "—" },
    {
      id: "odo_photo", header: t("fuel.colOdoPhoto"), enableSorting: false,
      cell: ({ row }) => row.original.odo_photo_url
        ? <a className="media-link" href={row.original.odo_photo_url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}>{t("fuel.viewPhoto")}</a>
        : "—",
    },
    { accessorKey: "amount", header: t("fuel.colAmount"), meta: { align: "end" }, cell: ({ getValue }) => getValue() ?? "—" },
    { accessorKey: "loan_adjustment", header: t("fuel.colLoanAdjustment"), meta: { align: "end" }, cell: ({ getValue }) => getValue() ?? "—" },
    {
      id: "total_loan", header: t("fuel.colTotalLoan"), meta: { align: "end" },
      accessorFn: r => r.amount != null ? (Number(r.amount) + (Number(r.loan_adjustment) || 0)) : null,
      cell: ({ getValue }) => getValue() ?? "—",
    },
    {
      accessorKey: "status", header: t("fuel.colStatus"),
      cell: ({ row }) => {
        const r = row.original;
        return isAdmin && r.status !== "pending" ? (
          <select
            className={`badge ${STATUS_CLASS[r.status]}`}
            value={r.status}
            disabled={savingId === r.id}
            onClick={e => e.stopPropagation()}
            onChange={e => handleStatusSelect(r, e.target.value)}
          >
            <option value="approved">{t("fuel.statusApproved")}</option>
            <option value="rejected">{t("fuel.statusRejected")}</option>
          </select>
        ) : (
          <span className={`badge ${STATUS_CLASS[r.status]}`}>{t(STATUS_KEY[r.status])}</span>
        );
      },
    },
    { accessorKey: "reviewed_by", header: t("fuel.colReviewedBy"), cell: ({ getValue }) => getValue() || "—" },
    { accessorKey: "reviewed_at", header: t("fuel.colReviewedAt"), cell: ({ getValue }) => formatLocalDateTime(getValue()) },
    { accessorKey: "rejection_reason", header: t("fuel.rejectReasonTitle"), cell: ({ getValue }) => getValue() || "—" },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, driverProjects, isAdmin, savingId]);

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
      rejection_reason: r.rejection_reason || "",
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

      <DataTable
        columns={columns}
        data={filteredRows}
        onRowClick={r => setViewing(r)}
        emptyMessage={loading ? t("common.loading") : t("fuel.noRequestsFound")}
      />

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

      {approveTarget && (
        <ApproveConfirmModal
          request={approveTarget}
          project={driverProjects[approveTarget.identity_number]}
          attendanceStatus={targetAttendance}
          saving={savingId === approveTarget.id}
          onCancel={() => setApproveTarget(null)}
          onConfirm={() => changeStatus(approveTarget, "approved")}
        />
      )}

      {rejectTarget && (
        <RejectReasonModal
          request={rejectTarget}
          project={driverProjects[rejectTarget.identity_number]}
          attendanceStatus={targetAttendance}
          saving={savingId === rejectTarget.id}
          onCancel={() => setRejectTarget(null)}
          onConfirm={reason => changeStatus(rejectTarget, "rejected", reason)}
        />
      )}
    </>
  );
}
