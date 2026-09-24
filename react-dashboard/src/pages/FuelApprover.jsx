import { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useDashboard } from "../contexts/DataContext";
import { useLang } from "../contexts/LanguageContext";
import { useToast } from "../contexts/ToastContext";
import { StatusBadge } from "../components/DetailModal";
import ProjectBadge from "../components/ProjectBadge";
import Field from "../components/Field";
import PrevDayFuelSection from "../components/PrevDayFuelSection";
import RejectReasonModal from "../components/RejectReasonModal";
import ApproveConfirmModal from "../components/ApproveConfirmModal";
import { usePrevDayShift } from "../hooks/usePrevDayShift";
import { sb } from "../lib/supabase";
import { compareStatus, formatRequestCode, formatLocalDateTime, localToday } from "../lib/calc";
import { getPageCache, setPageCache } from "../lib/pageCache";
import { OFF_CODES, attendanceLabel, deriveAttendanceStatus } from "../lib/attendanceCodes";

const CACHE_KEY = "fuelApprover.pending";

function shiftStatusOf(g) {
  if (!g || (!g.start && !g.end)) return "not_submitted";
  return compareStatus(g);
}

function EditableField({ label, value, onChange }) {
  return (
    <div className="f">
      <label>{label}</label>
      <input type="number" inputMode="decimal" className="fuel-inline-input" value={value} onChange={e => onChange(e.target.value)} />
    </div>
  );
}

export default function FuelApprover() {
  const { session, isAdmin } = useAuth();
  const { scopedDrivers } = useDashboard();
  const { t, lang } = useLang();
  const { showToast } = useToast();
  const cached = getPageCache(CACHE_KEY);
  const [rows, setRows] = useState(cached?.rows ?? []);
  const [selectedId, setSelectedId] = useState(cached?.selectedId ?? null);
  const [loading, setLoading] = useState(!cached);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [todayGroup, setTodayGroup] = useState(null);
  const [todayLoading, setTodayLoading] = useState(false);
  const [loanAdjustment, setLoanAdjustment] = useState("");
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [approveModalOpen, setApproveModalOpen] = useState(false);
  const [attendanceStatus, setAttendanceStatus] = useState(null);

  async function load(keepSelection) {
    if (!getPageCache(CACHE_KEY)) setLoading(true);
    const { data, error: err } = await sb.from("reinforcement_requests").select("*").eq("status", "pending").order("created_at", { ascending: false });
    if (err) { setError(err.message); setLoading(false); return; }
    setError("");
    const list = data || [];
    setRows(list);
    let nextSelected = selectedId;
    if (!keepSelection || !list.some(r => r.id === selectedId)) {
      nextSelected = list[0]?.id ?? null;
      setSelectedId(nextSelected);
    }
    setPageCache(CACHE_KEY, { rows: list, selectedId: nextSelected });
    setLoading(false);
  }

  useEffect(() => { load(true); }, []);

  const selected = rows.find(r => r.id === selectedId) || null;
  const selectedDriver = selected ? scopedDrivers.find(d => d.identity_number === selected.identity_number) : null;

  useEffect(() => {
    setLoanAdjustment(selected?.loan_adjustment ?? "");
  }, [selected?.id]);

  const { prevDayGroup, prevDayLoading } = usePrevDayShift(selected?.identity_number, selected?.shift_date, selected?.vehicle_plate);

  useEffect(() => {
    if (!selected) { setAttendanceStatus(null); return; }
    (async () => {
      const { data } = await sb.from("driver_attendance").select("status")
        .eq("identity_number", selected.identity_number).eq("attendance_date", selected.shift_date).maybeSingle();
      // A reinforcement request always has a shift-start for its day (#037),
      // so with no explicit override the effective status is always "P".
      setAttendanceStatus(deriveAttendanceStatus({ explicitStatus: data?.status, hasShiftEntry: true, day: selected.shift_date, today: localToday() }));
    })();
  }, [selected?.id]);

  useEffect(() => {
    if (!selected) { setTodayGroup(null); return; }
    (async () => {
      setTodayLoading(true);
      const { data } = await sb.from("shift_entries").select("*").eq("identity_number", selected.identity_number).eq("shift_date", selected.shift_date);
      const entries = data || [];
      const start = entries.find(r => r.shift_type === "start") || null;
      const end = entries.find(r => r.shift_type === "end") || null;
      setTodayGroup({ start, end });
      setTodayLoading(false);
    })();
  }, [selected?.id]);

  async function decide(status, rejectionReason) {
    if (!selected) return;
    const decidedId = selected.id;
    setBusy(true);
    setError("");
    const { error: err } = await sb.from("reinforcement_requests").update({
      status,
      reviewed_by: session?.user?.email || null,
      reviewed_at: new Date().toISOString(),
      loan_adjustment: loanAdjustment === "" ? null : Number(loanAdjustment),
      ...(status === "rejected" ? { rejection_reason: rejectionReason } : {}),
    }).eq("id", decidedId);
    setBusy(false);
    if (err) { setError(t("fuel.actionFailed") + err.message); return; }
    setRejectModalOpen(false);
    setApproveModalOpen(false);
    const remaining = rows.filter(r => r.id !== decidedId);
    const nextSelected = remaining[0]?.id ?? null;
    setRows(remaining);
    setSelectedId(nextSelected);
    setPageCache(CACHE_KEY, { rows: remaining, selectedId: nextSelected });
    showToast(status === "approved" ? t("fuel.toastApproved") : t("fuel.toastRejected"), status === "approved" ? "success" : "error");
  }

  function handleRejectClick() {
    setRejectModalOpen(true);
  }

  return (
    <>
      <div className="content-header">
        <div>
          <div className="breadcrumb">{t("common.dashboard")} &gt; <b>{t("fuel.approverBreadcrumb")}</b></div>
          <h1 className="page-title">{t("fuel.approverBreadcrumb")}</h1>
        </div>
      </div>
      {error && <div style={{ color: "var(--critical)", fontSize: "0.85rem", marginBottom: "1rem" }}>{error}</div>}

      <div className="fuel-layout">
        <div className="fuel-list">
          {loading ? (
            <div className="empty-cards">{t("common.loading")}</div>
          ) : !rows.length ? (
            <div className="empty-cards">{t("fuel.noPendingRequests")}</div>
          ) : rows.map(r => (
            <div key={r.id} className={"fuel-box" + (r.id === selectedId ? " active" : "")} onClick={() => setSelectedId(r.id)}>
              <div className="fuel-box-thumb">⛽</div>
              <div className="fuel-box-body">
                <div className="fuel-box-code">{formatRequestCode(r.request_no)}</div>
                <div className="fuel-box-name">{r.full_name}</div>
                <div className="fuel-box-amount">{r.amount ?? "—"}</div>
              </div>
            </div>
          ))}
        </div>

        {selected ? (
          <div className="fuel-detail">
            <h2>{formatRequestCode(selected.request_no)}</h2>
            <div className="fuel-detail-grid">
              <Field label={t("fuel.colDriver")} val={selected.full_name} />
              <Field label={t("fuel.colIdNumber")} val={selected.identity_number} />
              <Field label={t("common.project")} val={selectedDriver?.project ? <ProjectBadge project={selectedDriver.project} /> : "—"} />
              <Field label={t("fuel.colPlate")} val={selected.vehicle_plate} />
              <Field label={t("fuel.colStation")} val={selected.station_name} />
              <Field label={t("fuel.colDate")} val={selected.shift_date} />
              <Field label={t("fuel.colShiftStatusToday")} val={todayLoading ? t("common.loading") : <StatusBadge status={shiftStatusOf(todayGroup)} />} />
              <Field label={t("fuel.colOdoReading")} val={selected.odo_reading} />
              <Field label={t("fuel.colOdoPhoto")} val={selected.odo_photo_url ? <a className="media-link" href={selected.odo_photo_url} target="_blank" rel="noreferrer">{t("fuel.viewPhoto")}</a> : "—"} />
              <Field label={t("fuel.colAmount")} val={selected.amount} />
              {isAdmin ? (
                <EditableField label={t("fuel.colLoanAdjustment")} value={loanAdjustment} onChange={setLoanAdjustment} />
              ) : (
                <Field label={t("fuel.colLoanAdjustment")} val={selected.loan_adjustment ?? "—"} />
              )}
              <Field label={t("fuel.colTotalLoan")} val={selected.amount != null ? (Number(selected.amount) + (Number(loanAdjustment) || 0)) : "—"} />
              <Field label={t("fuel.colRequestedAt")} val={formatLocalDateTime(selected.created_at)} />
              <Field label={t("common.petroAppLink")} val={selectedDriver?.petro_app_link ? <a className="media-link" href={selectedDriver.petro_app_link} target="_blank" rel="noreferrer">{t("common.petroAppLink")}</a> : "—"} />
            </div>

            {OFF_CODES.has(attendanceStatus) && (
              <div className="attendance-conflict-banner">
                ⚠ {t("fuel.attendanceConflictTitle")}
                <br />
                {t("fuel.attendanceConflictGeneric", { name: selected.full_name, status: attendanceLabel(attendanceStatus, lang), date: selected.shift_date })}
              </div>
            )}

            <PrevDayFuelSection shiftDate={selected.shift_date} prevDayGroup={prevDayGroup} loading={prevDayLoading} />

            {isAdmin && (
              <div className="fuel-detail-actions">
                <button className="btn btn-primary" disabled={busy} onClick={() => setApproveModalOpen(true)}>{t("fuel.approve")}</button>
                <button className="btn btn-danger" disabled={busy} onClick={handleRejectClick}>{t("fuel.reject")}</button>
              </div>
            )}
          </div>
        ) : !loading && (
          <div className="fuel-empty-detail">{t("fuel.noPendingRequests")}</div>
        )}
      </div>

      {approveModalOpen && selected && (
        <ApproveConfirmModal
          request={selected}
          project={selectedDriver?.project}
          attendanceStatus={attendanceStatus}
          loanAdjustment={loanAdjustment}
          saving={busy}
          onCancel={() => setApproveModalOpen(false)}
          onConfirm={() => decide("approved")}
        />
      )}

      {rejectModalOpen && selected && (
        <RejectReasonModal
          request={selected}
          project={selectedDriver?.project}
          attendanceStatus={attendanceStatus}
          loanAdjustment={loanAdjustment}
          saving={busy}
          onCancel={() => setRejectModalOpen(false)}
          onConfirm={reason => decide("rejected", reason)}
        />
      )}
    </>
  );
}
