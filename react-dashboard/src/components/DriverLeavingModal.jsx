import { useEffect, useState } from "react";
import { useLang } from "../contexts/LanguageContext";
import { riyadhToday } from "../lib/rcaFollowup";
import {
  activeStatusErrorKey, DEACTIVATION_REASONS, leavingError, loadActivityAfter, NOTE_REQUIRED_REASONS,
  setActiveStatus, setDriverLeavingDetails,
} from "../lib/activeStatus";

// Deactivating a driver (migration 065): last working day (required, not in the
// future, not before the hiring date), reason from a fixed list (required), note
// (optional; required for "other").  Before saving, any activity AFTER the
// chosen day (shift forms, approved reinforcement, automatic fuel) is shown and
// has to be acknowledged.  mode "edit" (admin): fill in / correct the details of
// a driver who is already inactive.  The database checks everything again.
const FIELD_STYLE = {
  width: "100%", padding: "0.55rem 0.7rem", borderRadius: "8px", border: "1px solid var(--border)",
  background: "var(--plane)", color: "var(--ink)", fontFamily: "inherit", fontSize: "0.85rem",
};

export default function DriverLeavingModal({ driver, mode = "deactivate", notifyAdmins, onCancel, onDone }) {
  const { t } = useLang();
  const today = riyadhToday();
  const [day, setDay] = useState(driver.last_working_day || "");
  const [reasonCode, setReasonCode] = useState(driver.deactivation_reason || "");
  const [note, setNote] = useState(driver.deactivation_note || "");
  const [activity, setActivity] = useState({ loading: false, data: null, error: null });
  const [acknowledged, setAcknowledged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const hiredOn = driver.date_of_hiring || null;
  const noteRequired = NOTE_REQUIRED_REASONS.includes(reasonCode);

  // Activity after the chosen day: reloaded when the day changes.
  useEffect(() => {
    setAcknowledged(false);
    if (!day || day > today) { setActivity({ loading: false, data: null, error: null }); return undefined; }
    let live = true;
    setActivity({ loading: true, data: null, error: null });
    loadActivityAfter(driver.identity_number, day).then(r => { if (live) setActivity({ loading: false, ...r }); });
    return () => { live = false; };
  }, [day, driver.identity_number, today]);

  const mustAcknowledge = !!activity.data?.any;

  async function save() {
    const details = { lastWorkingDay: day, reasonCode, note };
    const code = leavingError(details, { today, hiredOn });
    if (code) { setError(t(activeStatusErrorKey(code))); return; }
    if (activity.loading) return;
    if (mustAcknowledge && !acknowledged) { setError(t("activeStatus.ackRequired")); return; }
    setSaving(true);
    setError("");
    const res = mode === "edit"
      ? await setDriverLeavingDetails(driver.identity_number, details)
      : await setActiveStatus("driver", driver.identity_number, false, null, details);
    setSaving(false);
    if (!res.ok) { setError(t(activeStatusErrorKey(res.code))); return; }
    onDone({
      is_active: false,
      last_working_day: day,
      deactivation_reason: reasonCode,
      deactivation_note: note.trim() || null,
    });
  }

  const a = activity.data;
  return (
    <div id="compare-detail-backdrop" style={{ display: "flex" }} onClick={e => { if (e.target.id === "compare-detail-backdrop" && !saving) onCancel(); }}>
      <div id="compare-detail-modal" style={{ maxWidth: "480px" }}>
        <button id="compare-detail-close" aria-label={t("detailModal.close")} onClick={onCancel} disabled={saving}>×</button>
        <h2>{t(mode === "edit" ? "activeStatus.leavingTitle" : "activeStatus.deactivateTitleDriver")}</h2>
        <p style={{ margin: "0.2rem 0 0.8rem", fontWeight: 600 }}>{driver.full_name || driver.identity_number}</p>

        <div className="field">
          <label>{t("activeStatus.lastWorkingDay")}</label>
          <input type="date" value={day} max={today} min={hiredOn || undefined} onChange={e => { setDay(e.target.value); setError(""); }} style={FIELD_STYLE} />
        </div>
        <div className="field" style={{ marginTop: "0.7rem" }}>
          <label>{t("activeStatus.reasonLabel")}</label>
          <select value={reasonCode} onChange={e => { setReasonCode(e.target.value); setError(""); }} style={FIELD_STYLE}>
            <option value="">{t("activeStatus.chooseReason")}</option>
            {DEACTIVATION_REASONS.map(c => <option key={c} value={c}>{t(`activeStatus.reason_${c}`)}</option>)}
          </select>
        </div>
        <div className="field" style={{ marginTop: "0.7rem" }}>
          <label>{t(noteRequired ? "activeStatus.noteRequired" : "activeStatus.noteOptional")}</label>
          <textarea rows={3} value={note} onChange={e => { setNote(e.target.value); setError(""); }}
            placeholder={t("activeStatus.notePlaceholder")} style={{ ...FIELD_STYLE, resize: "vertical" }} />
        </div>

        {activity.loading && <div className="ov-block-sub" style={{ marginTop: "0.6rem" }}>{t("activeStatus.checkingActivity")}</div>}
        {activity.error && <div style={{ color: "var(--ink-muted)", fontSize: "0.78rem", marginTop: "0.6rem" }}>{t("activeStatus.activityCheckFailed")}</div>}
        {a?.any && (
          <div className="leaving-warning" role="alert">
            <b>{t("activeStatus.activityAfterTitle", { date: day })}</b>
            <ul>
              {a.formDays > 0 && <li>{t("activeStatus.activityForms", { n: a.formDays })}</li>}
              {a.reinforcementCount > 0 && <li>{t("activeStatus.activityReinforcement", { n: a.reinforcementCount, sar: a.reinforcementSar.toFixed(2) })}</li>}
              {a.automaticCount > 0 && <li>{t("activeStatus.activityAutomatic", { n: a.automaticCount, sar: a.automaticSar.toFixed(2) })}</li>}
            </ul>
            <div>{t("activeStatus.activityRange", { from: a.firstDay, to: a.lastDay, sar: a.totalSar.toFixed(2) })}</div>
            <label style={{ display: "flex", gap: "0.4rem", alignItems: "center", marginTop: "0.4rem" }}>
              <input type="checkbox" checked={acknowledged} onChange={e => { setAcknowledged(e.target.checked); setError(""); }} />
              {t("activeStatus.ackActivity")}
            </label>
          </div>
        )}

        {notifyAdmins && mode !== "edit" && <div style={{ color: "var(--ink-muted)", fontSize: "0.78rem", marginTop: "0.4rem" }}>{t("activeStatus.adminNotified")}</div>}
        {error && <div style={{ color: "var(--critical)", fontSize: "0.8rem", marginTop: "0.4rem" }}>{error}</div>}
        <div className="modal-form-actions">
          <button className="btn" onClick={onCancel} disabled={saving}>{t("common.cancel")}</button>
          <button className={"btn btn-danger" + (saving ? " btn-loading" : "")} onClick={save}
            disabled={saving || activity.loading || (mustAcknowledge && !acknowledged)}>
            {t(mode === "edit" ? "common.save" : "activeStatus.confirmDeactivate")}
          </button>
        </div>
      </div>
    </div>
  );
}
