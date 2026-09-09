import { useState } from "react";
import { useDetailModal } from "../contexts/DetailModalContext";
import { useLang } from "../contexts/LanguageContext";
import { formatLocalTime } from "../lib/calc";
import Field from "./Field";

const STATUS_KEY = {
  complete: "common.complete", start_only: "detailModal.startOnly", end_only: "detailModal.endOnly",
  not_submitted: "drivers.shiftNotSubmitted",
};
const STATUS_CLASS = { complete: "complete", start_only: "partial", end_only: "partial", not_submitted: "critical" };

export function StatusBadge({ status }) {
  const { t } = useLang();
  return <span className={`badge ${STATUS_CLASS[status]}`}>{t(STATUS_KEY[status])}</span>;
}

export default function DetailModal() {
  const { group: g, editing, setEditing, computed, canEdit, closeDetail, saveEdit, saving, saveError } = useDetailModal();
  const { t } = useLang();
  const [form, setForm] = useState(null);

  if (!g) return null;

  function startEdit() {
    setForm({
      date: g.day || "",
      startOdo: g.start?.odo_reading ?? "",
      ofd: g.start?.ofd_count ?? "",
      endOdo: g.end?.odo_reading ?? "",
      cod: g.end?.cod_delivered ?? "",
      ppd: g.end?.ppd_delivered ?? "",
      pickup: g.end?.picked_up ?? "",
    });
    setEditing(true);
  }

  function updateField(key, value) {
    setForm(f => ({ ...f, [key]: value }));
  }

  return (
    <div id="compare-detail-backdrop" style={{ display: "flex" }} onClick={e => { if (e.target.id === "compare-detail-backdrop") closeDetail(); }}>
      <div id="compare-detail-modal">
        <button id="compare-detail-close" aria-label={t("detailModal.close")} onClick={closeDetail}>×</button>
        {!editing ? (
          <div id="compare-detail-content">
            <div className="compare-card-header" style={{ border: "none", padding: "0 0 0.9rem" }}>
              <div>
                <div className="who">{g.full_name}</div>
                <div className="sub">{g.identity_number} · {g.day}{g.project ? " · " + g.project : ""}</div>
              </div>
              <StatusBadge status={computed.status} />
            </div>
            <div className="compare-card-section" style={{ padding: "0.75rem 0" }}>
              <h4>{t("common.tripData")}</h4>
              <div className="compare-field-grid">
                <Field label={t("common.plate")} val={g.vehicle_plate} />
                <Field label={t("common.startTime")} val={formatLocalTime(g.start?.created_at)} />
                <Field label={t("common.endTime")} val={formatLocalTime(g.end?.created_at)} />
              </div>
            </div>
            <div className="compare-card-section" style={{ padding: "0.75rem 0" }}>
              <h4>{t("common.odometerAndFuel")}</h4>
              <div className="compare-field-grid">
                <Field label={t("common.startOdometer")} val={g.start?.odo_reading} />
                <Field label={t("common.endOdometer")} val={g.end?.odo_reading} />
                <Field label={t("detailModal.distance")} val={computed.dist} />
                <Field label={t("common.expectedFuelLiters")} val={computed.fuelLiters} />
                <Field label={t("compare.colExpectedFuelCost")} val={computed.fuelCost} />
                <Field label={t("compare.colActualFuelCost")} val={computed.actualFuelCost} />
                <Field label="Off Duty" val={computed.offDuty} />
              </div>
            </div>
            <div className="compare-card-section" style={{ padding: "0.75rem 0", borderBottom: "none" }}>
              <h4>{t("common.deliveryAndSales")}</h4>
              <div className="compare-field-grid">
                <Field label="OFD" val={g.start?.ofd_count} />
                <Field label="COD" val={g.end?.cod_delivered} />
                <Field label="PPD" val={g.end?.ppd_delivered} />
                <Field label="Picked Up" val={g.end?.picked_up} />
                <Field label="Delivered" val={computed.delivered} />
                <Field label="Delivery %" val={computed.deliveryPct} />
                <Field label="Sales" val={computed.sales} />
              </div>
            </div>
            {canEdit && <button className="btn btn-primary" style={{ marginTop: "0.5rem" }} onClick={startEdit}>{t("detailModal.editData")}</button>}
          </div>
        ) : (
          <div>
            <div className="compare-card-header" style={{ border: "none", padding: "0 0 0.9rem" }}>
              <div>
                <div className="who">{g.full_name}</div>
                <div className="sub">{g.identity_number} · {g.day}{g.project ? " · " + g.project : ""}</div>
              </div>
            </div>
            <div className="field"><label>{t("common.dateOfShift")}</label><input type="date" value={form.date} onChange={e => updateField("date", e.target.value)} /></div>
            <div className="field"><label>{t("common.plate")}</label><div className="val">{g.vehicle_plate}</div></div>
            {g.start && <>
              <h4 style={{ fontSize: "0.7rem", color: "var(--ink-muted)", margin: "0.8rem 0 0.4rem" }}>{t("detailModal.shiftStart")}</h4>
              <div className="field"><label>{t("common.startOdometer")}</label><input type="number" value={form.startOdo} onChange={e => updateField("startOdo", e.target.value)} /></div>
              <div className="field"><label>OFD</label><input type="number" value={form.ofd} onChange={e => updateField("ofd", e.target.value)} /></div>
            </>}
            {g.end && <>
              <h4 style={{ fontSize: "0.7rem", color: "var(--ink-muted)", margin: "0.8rem 0 0.4rem" }}>{t("detailModal.shiftEnd")}</h4>
              <div className="field"><label>{t("common.endOdometer")}</label><input type="number" value={form.endOdo} onChange={e => updateField("endOdo", e.target.value)} /></div>
              <div className="field"><label>COD</label><input type="number" value={form.cod} onChange={e => updateField("cod", e.target.value)} /></div>
              <div className="field"><label>PPD</label><input type="number" value={form.ppd} onChange={e => updateField("ppd", e.target.value)} /></div>
              <div className="field"><label>Picked Up</label><input type="number" value={form.pickup} onChange={e => updateField("pickup", e.target.value)} /></div>
            </>}
            {saveError && <div style={{ color: "var(--critical)", fontSize: "0.8rem", marginTop: "0.5rem" }}>{saveError}</div>}
            <div className="modal-form-actions">
              <button className="btn" onClick={() => setEditing(false)} disabled={saving}>{t("common.cancel")}</button>
              <button className="btn btn-primary" onClick={() => saveEdit(form)} disabled={saving}>{saving ? t("common.saving") : t("common.save")}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
