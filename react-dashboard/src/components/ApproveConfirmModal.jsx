import { useLang } from "../contexts/LanguageContext";
import RequestSummary from "./RequestSummary";

export default function ApproveConfirmModal({ request, project, attendanceStatus, loanAdjustment, onCancel, onConfirm, saving }) {
  const { t } = useLang();

  return (
    <div id="compare-detail-backdrop" style={{ display: "flex" }} onClick={e => { if (e.target.id === "compare-detail-backdrop") onCancel(); }}>
      <div id="compare-detail-modal" style={{ maxWidth: "420px" }}>
        <button id="compare-detail-close" aria-label={t("detailModal.close")} onClick={onCancel}>×</button>
        <h2>{t("fuel.approveConfirmTitle")}</h2>
        <RequestSummary request={request} project={project} attendanceStatus={attendanceStatus} loanAdjustment={loanAdjustment} />
        <div className="modal-form-actions">
          <button className="btn" onClick={onCancel} disabled={saving}>{t("common.cancel")}</button>
          <button className={"btn btn-primary" + (saving ? " btn-loading" : "")} onClick={onConfirm} disabled={saving}>{t("fuel.confirmApprove")}</button>
        </div>
      </div>
    </div>
  );
}
