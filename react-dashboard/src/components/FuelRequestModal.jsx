import { useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useDashboard } from "../contexts/DataContext";
import { useLang } from "../contexts/LanguageContext";
import ProjectBadge from "./ProjectBadge";
import Field from "./Field";
import PrevDayFuelSection from "./PrevDayFuelSection";
import { usePrevDayShift } from "../hooks/usePrevDayShift";
import { sb } from "../lib/supabase";
import { formatRequestCode, formatLocalDateTime } from "../lib/calc";
import { FUEL_STATUS_CLASS as STATUS_CLASS } from "../lib/fuelStatus";

export default function FuelRequestModal({ request, onClose, onSaved }) {
  const { session, isAdmin } = useAuth();
  const { scopedDrivers } = useDashboard();
  const { t } = useLang();
  const [loanAdjustment, setLoanAdjustment] = useState(request.loan_adjustment ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { prevDayGroup, prevDayLoading } = usePrevDayShift(request.identity_number, request.shift_date, request.vehicle_plate);

  const isPending = request.status === "pending";
  const canEditLoan = isAdmin && !isPending;
  const driver = scopedDrivers.find(d => d.identity_number === request.identity_number);
  const statusLabel = { pending: t("fuel.statusPending"), approved: t("fuel.statusApproved"), rejected: t("fuel.statusRejected") };
  const totalLoan = request.amount != null ? (Number(request.amount) + (Number(loanAdjustment) || 0)) : "—";

  async function handleSave() {
    setSaving(true);
    setError("");
    const newLoanAdjustment = loanAdjustment === "" ? null : Number(loanAdjustment);
    const reviewed_by = session?.user?.email || null;
    const reviewed_at = new Date().toISOString();
    const { error: err } = await sb.from("reinforcement_requests").update({
      loan_adjustment: newLoanAdjustment,
      reviewed_by,
      reviewed_at,
    }).eq("id", request.id);
    setSaving(false);
    if (err) { setError(t("common.saveFailed") + err.message); return; }
    onSaved({ ...request, loan_adjustment: newLoanAdjustment, reviewed_by, reviewed_at });
  }

  return (
    <div id="compare-detail-backdrop" style={{ display: "flex" }} onClick={e => { if (e.target.id === "compare-detail-backdrop") onClose(); }}>
      <div id="compare-detail-modal">
        <button id="compare-detail-close" aria-label={t("detailModal.close")} onClick={onClose}>×</button>
        <h2>{formatRequestCode(request.request_no)}</h2>
        <div className="fuel-detail-grid">
          <Field label={t("fuel.colDriver")} val={request.full_name} />
          <Field label={t("fuel.colIdNumber")} val={request.identity_number} />
          <Field label={t("common.project")} val={driver?.project ? <ProjectBadge project={driver.project} /> : "—"} />
          <Field label={t("fuel.colPlate")} val={request.vehicle_plate} />
          <Field label={t("fuel.colStation")} val={request.station_name} />
          <Field label={t("fuel.colDate")} val={request.shift_date} />
          <Field label={t("fuel.colOdoReading")} val={request.odo_reading} />
          <Field label={t("fuel.colOdoPhoto")} val={request.odo_photo_url ? <a className="media-link" href={request.odo_photo_url} target="_blank" rel="noreferrer">{t("fuel.viewPhoto")}</a> : "—"} />
          <Field label={t("fuel.colAmount")} val={request.amount} />
          {canEditLoan ? (
            <div className="f">
              <label>{t("fuel.colLoanAdjustment")}</label>
              <input type="number" inputMode="decimal" className="fuel-inline-input" value={loanAdjustment} onChange={e => setLoanAdjustment(e.target.value)} />
            </div>
          ) : (
            <Field label={t("fuel.colLoanAdjustment")} val={request.loan_adjustment ?? "—"} />
          )}
          <Field label={t("fuel.colTotalLoan")} val={totalLoan} />
          <Field label={t("fuel.colStatus")} val={<span className={`badge ${STATUS_CLASS[request.status]}`}>{statusLabel[request.status]}</span>} />
          <Field label={t("fuel.colRequestedAt")} val={formatLocalDateTime(request.created_at)} />
          <Field label={t("fuel.colReviewedBy")} val={request.reviewed_by || "—"} />
          <Field label={t("fuel.colReviewedAt")} val={formatLocalDateTime(request.reviewed_at)} />
          <Field label={t("common.petroAppLink")} val={driver?.petro_app_link ? <a className="media-link" href={driver.petro_app_link} target="_blank" rel="noreferrer">{t("common.petroAppLink")}</a> : "—"} />
        </div>

        <PrevDayFuelSection shiftDate={request.shift_date} prevDayGroup={prevDayGroup} loading={prevDayLoading} />

        {error && <div style={{ color: "var(--critical)", fontSize: "0.8rem", marginTop: "0.5rem" }}>{error}</div>}
        {isPending && <div className="ov-empty" style={{ padding: "0.5rem 0" }}>{t("fuel.pendingReviewHint")}</div>}
        <div className="modal-form-actions">
          <button className="btn" onClick={onClose} disabled={saving}>{canEditLoan ? t("common.cancel") : t("common.close")}</button>
          {canEditLoan && (
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? t("common.saving") : t("common.save")}</button>
          )}
        </div>
      </div>
    </div>
  );
}
