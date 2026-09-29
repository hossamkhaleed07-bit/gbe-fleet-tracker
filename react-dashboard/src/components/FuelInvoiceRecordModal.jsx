import { useEffect, useState } from "react";
import { FUEL_INVOICE_FIELDS, distinctValues, computeAmountVat, fieldColorKey, money } from "../lib/fuelInvoice";
import { useFuelInvoiceDaDirectory } from "../hooks/useFuelInvoiceDaDirectory";
import PillSelectField from "./PillSelectField";

export default function FuelInvoiceRecordModal({ record, records, isNew, onSave, onCancel, saving, saveError }) {
  const { lookup } = useFuelInvoiceDaDirectory();
  const [form, setForm] = useState(record);

  function set(key, value) {
    setForm(f => ({ ...f, [key]: value }));
  }

  // DA Name is always derived from NID (matches the source sheet's
  // VLOOKUP(NID, 'DA DB'!A:L, 2, FALSE) formula exactly) — never hand-typed.
  useEffect(() => {
    set("da_name", lookup(form.nid));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.nid]);

  const { amount, vat } = computeAmountVat(form.cost);

  return (
    <div className="modal-backdrop" style={{ display: "flex" }} onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="modal-panel" style={{ maxWidth: 560, maxHeight: "85vh", overflowY: "auto" }}>
        <h2>{isNew ? "New Entry" : "Edit Entry"}</h2>

        {FUEL_INVOICE_FIELDS.map(f => (
          <div className="field" key={f.key}>
            <label>{f.label}</label>
            {f.type === "select" ? (
              <PillSelectField
                value={form[f.key]}
                options={distinctValues(records, f.key)}
                colorFor={v => fieldColorKey(f.key, v)}
                onChange={v => set(f.key, v)}
              />
            ) : f.type === "lookup" ? (
              <div className="val" title="Auto-filled from NID, matching the source sheet's lookup">{form.da_name || "—"}</div>
            ) : f.type === "computed" ? (
              <div className="val">{money(f.key === "amount" ? amount : vat)}</div>
            ) : f.type === "date" ? (
              <input type="date" value={form[f.key] || ""} onChange={e => set(f.key, e.target.value)} />
            ) : f.type === "currency" ? (
              <input type="number" inputMode="decimal" value={form[f.key] ?? ""} onChange={e => set(f.key, e.target.value)} />
            ) : f.type === "longtext" ? (
              <textarea rows={3} value={form[f.key] || ""} onChange={e => set(f.key, e.target.value)} />
            ) : (
              <input type="text" value={form[f.key] || ""} onChange={e => set(f.key, e.target.value)} />
            )}
          </div>
        ))}

        {saveError && <div style={{ color: "var(--critical)", fontSize: "0.85rem", marginTop: "0.5rem" }}>{saveError}</div>}

        <div className="modal-form-actions">
          <button className="btn" onClick={onCancel} disabled={saving}>Cancel</button>
          <button className="btn btn-primary" onClick={() => onSave({ ...form, amount, vat })} disabled={saving}>{saving ? "Saving..." : "Save"}</button>
        </div>
      </div>
    </div>
  );
}
