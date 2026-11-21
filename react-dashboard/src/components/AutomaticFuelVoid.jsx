import { useState } from "react";
import { useLang } from "../contexts/LanguageContext";
import { useToast } from "../contexts/ToastContext";
import { autoFuelErrorMessage, MIN_REASON_LENGTH, reasonOk, restoreAllocation, voidAllocations } from "../lib/automaticFuel";

// Void one or many Automatic Fuel days with one reason, or restore a voided day
// (admin only, migration 064). The database checks everything again: admin,
// past days only, reason of at least 10 characters, all or nothing.

export function ReasonDialog({ title, summary, list, confirmLabel, danger, onSubmit, onCancel }) {
  const { t } = useLang();
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!reasonOk(reason)) { setError(t("automaticFuel.errors.AUTO_FUEL_REASON_TOO_SHORT")); return; }
    setSaving(true);
    const err = await onSubmit(reason.trim());
    setSaving(false);
    if (err) setError(autoFuelErrorMessage(t, err));
  }

  const left = MIN_REASON_LENGTH - reason.trim().length;
  return (
    <div id="compare-detail-backdrop" style={{ display: "flex" }} onClick={e => { if (e.target.id === "compare-detail-backdrop" && !saving) onCancel(); }}>
      <form id="compare-detail-modal" style={{ maxWidth: "480px" }} onSubmit={submit}>
        <button type="button" id="compare-detail-close" aria-label={t("detailModal.close")} onClick={onCancel} disabled={saving}>×</button>
        <h2>{title}</h2>
        <p className="af-summary">{summary}</p>
        {list && <ul className="af-void-list">{list}</ul>}
        <label className="af-field">
          <span>{t("automaticFuel.reasonLabel")}</span>
          <textarea rows={3} value={reason} autoFocus onChange={e => { setReason(e.target.value); setError(""); }}
            placeholder={t("automaticFuel.voidReasonPlaceholder")} />
          <small className="af-hint">{left > 0 ? t("automaticFuel.reasonCharsLeft", { n: left }) : t("automaticFuel.reasonOk")}</small>
        </label>
        {error && <div className="af-error" style={{ marginTop: "0.5rem" }}>{error}</div>}
        <div className="modal-form-actions">
          <button type="button" className="btn" onClick={onCancel} disabled={saving}>{t("common.cancel")}</button>
          <button type="submit" className={"btn " + (danger ? "af-danger" : "af-save") + (saving ? " btn-loading" : "")} disabled={saving}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

const LIST_LIMIT = 8;

export function VoidDialog({ rows, onCancel, onDone }) {
  const { t } = useLang();
  const { showToast } = useToast();
  const total = rows.reduce((s, r) => s + Number(r.amount ?? r.automatic_fuel ?? 0), 0);
  const shown = rows.slice(0, LIST_LIMIT);
  const list = (
    <>
      {shown.map(r => (
        <li key={r.id}>{r.allocation_date} · {r.full_name || r.identity_number} · {Number(r.amount ?? r.automatic_fuel ?? 0).toFixed(2)}</li>
      ))}
      {rows.length > LIST_LIMIT && <li>{t("automaticFuel.andMore", { n: rows.length - LIST_LIMIT })}</li>}
    </>
  );
  return (
    <ReasonDialog
      title={t("automaticFuel.voidTitle")}
      summary={t("automaticFuel.voidSummary", { n: rows.length, sar: total.toFixed(2) })}
      list={list}
      danger
      confirmLabel={t("automaticFuel.voidConfirm", { n: rows.length })}
      onCancel={onCancel}
      onSubmit={async (reason) => {
        const { data, error } = await voidAllocations(rows.map(r => r.id), reason);
        if (error) return error;
        showToast(t("automaticFuel.voidedToast", { n: Number(data || 0) }));
        onDone();
        return null;
      }}
    />
  );
}

export function RestoreDialog({ row, onCancel, onDone }) {
  const { t } = useLang();
  const { showToast } = useToast();
  return (
    <ReasonDialog
      title={t("automaticFuel.restoreTitle")}
      summary={`${row.full_name || row.identity_number} · ${row.allocation_date} · ${Number(row.amount || 0).toFixed(2)} · ${t("automaticFuel.voidedReason")}: ${row.void_reason || "—"}`}
      confirmLabel={t("automaticFuel.restore")}
      onCancel={onCancel}
      onSubmit={async (reason) => {
        const { error } = await restoreAllocation(row.id, reason);
        if (error) return error;
        showToast(t("automaticFuel.restoredToast"));
        onDone();
        return null;
      }}
    />
  );
}
