import { useState } from "react";
import { useLang } from "../contexts/LanguageContext";
import RequestSummary from "./RequestSummary";

export default function RejectReasonModal({ request, project, attendanceStatus, loanAdjustment, onCancel, onConfirm, saving }) {
  const { t } = useLang();
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");

  function handleConfirm() {
    if (!reason.trim()) { setError(t("fuel.rejectReasonRequired")); return; }
    setError("");
    onConfirm(reason.trim());
  }

  return (
    <div id="compare-detail-backdrop" style={{ display: "flex" }} onClick={e => { if (e.target.id === "compare-detail-backdrop") onCancel(); }}>
      <div id="compare-detail-modal" style={{ maxWidth: "420px" }}>
        <button id="compare-detail-close" aria-label={t("detailModal.close")} onClick={onCancel}>×</button>
        <h2>{t("fuel.rejectConfirmTitle")}</h2>
        {request && <RequestSummary request={request} project={project} attendanceStatus={attendanceStatus} loanAdjustment={loanAdjustment} />}
        <div className="field">
          <label>{t("fuel.rejectReasonLabel")}</label>
          <textarea
            rows={4}
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder={t("fuel.rejectReasonPlaceholder")}
            style={{ width: "100%", resize: "vertical", padding: "0.6rem 0.7rem", borderRadius: "8px", border: "1px solid var(--border)", background: "var(--plane)", color: "var(--ink)", fontFamily: "inherit", fontSize: "0.85rem" }}
          />
        </div>
        {error && <div style={{ color: "var(--critical)", fontSize: "0.8rem", marginTop: "0.4rem" }}>{error}</div>}
        <div className="modal-form-actions">
          <button className="btn" onClick={onCancel} disabled={saving}>{t("common.cancel")}</button>
          <button className={"btn btn-danger" + (saving ? " btn-loading" : "")} onClick={handleConfirm} disabled={saving}>{t("fuel.confirmReject")}</button>
        </div>
      </div>
    </div>
  );
}
