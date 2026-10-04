import { useState } from "react";
import { useLang } from "../contexts/LanguageContext";
import { MIN_DEACTIVATE_REASON } from "../lib/activeStatus";

// Asks for the reason before a driver / vehicle is deactivated (required, 10+
// characters) or reactivated (optional). `notifyAdmins` only changes the hint
// text: the notification itself is created by the database function.
export default function ActiveStatusModal({ kind, label, activate, notifyAdmins, saving, error, onCancel, onConfirm }) {
  const { t } = useLang();
  const [reason, setReason] = useState("");
  const [localError, setLocalError] = useState("");

  const kindKey = kind === "vehicle" ? "Vehicle" : "Driver";
  const title = t(`activeStatus.${activate ? "activate" : "deactivate"}Title${kindKey}`);

  function handleConfirm() {
    const trimmed = reason.trim();
    if (!activate && trimmed.length < MIN_DEACTIVATE_REASON) {
      setLocalError(t("activeStatus.reasonTooShort", { n: MIN_DEACTIVATE_REASON }));
      return;
    }
    setLocalError("");
    onConfirm(trimmed);
  }

  return (
    <div id="compare-detail-backdrop" style={{ display: "flex" }} onClick={e => { if (e.target.id === "compare-detail-backdrop" && !saving) onCancel(); }}>
      <div id="compare-detail-modal" style={{ maxWidth: "440px" }}>
        <button id="compare-detail-close" aria-label={t("detailModal.close")} onClick={onCancel} disabled={saving}>×</button>
        <h2>{title}</h2>
        <p style={{ margin: "0.2rem 0 0.8rem", fontWeight: 600 }}>{label}</p>
        <div className="field">
          <label>{activate ? t("activeStatus.reasonOptional") : t("activeStatus.reasonRequired", { n: MIN_DEACTIVATE_REASON })}</label>
          <textarea
            rows={4}
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder={t("activeStatus.reasonPlaceholder")}
            style={{ width: "100%", resize: "vertical", padding: "0.6rem 0.7rem", borderRadius: "8px", border: "1px solid var(--border)", background: "var(--plane)", color: "var(--ink)", fontFamily: "inherit", fontSize: "0.85rem" }}
          />
        </div>
        {notifyAdmins && <div style={{ color: "var(--ink-muted)", fontSize: "0.78rem", marginTop: "0.4rem" }}>{t("activeStatus.adminNotified")}</div>}
        {(localError || error) && <div style={{ color: "var(--critical)", fontSize: "0.8rem", marginTop: "0.4rem" }}>{localError || error}</div>}
        <div className="modal-form-actions">
          <button className="btn" onClick={onCancel} disabled={saving}>{t("common.cancel")}</button>
          <button
            className={"btn " + (activate ? "btn-primary" : "btn-danger") + (saving ? " btn-loading" : "")}
            onClick={handleConfirm}
            disabled={saving}
          >
            {activate ? t("activeStatus.confirmActivate") : t("activeStatus.confirmDeactivate")}
          </button>
        </div>
      </div>
    </div>
  );
}
