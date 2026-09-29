import { useState } from "react";
import { stringColorKey } from "../lib/fuelInvoice";

const ADD_NEW = "__add_new__";

// A single-select rendered as a colored pill (reuses the same
// .reason-pill-select idiom as the Project Performance RCA Reason cell),
// generalized to ANY value via a deterministic string→color hash instead of
// a fixed value→color map — because these fields' option lists aren't fixed,
// they grow from whatever's typed ("+ Add new value"), per the Fuel & Invoice
// module's "don't invent company-specific options" requirement.
export default function PillSelectField({ value, options, onChange, placeholder = "— Select —", disabled, colorFor = stringColorKey }) {
  const [addingNew, setAddingNew] = useState(false);
  const [draft, setDraft] = useState("");

  if (addingNew) {
    return (
      <input
        autoFocus
        type="text"
        className="notes-cell-input"
        value={draft}
        placeholder="Type new value..."
        onChange={e => setDraft(e.target.value)}
        onBlur={() => {
          const v = draft.trim();
          setAddingNew(false);
          setDraft("");
          if (v) onChange(v);
        }}
        onKeyDown={e => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") { setAddingNew(false); setDraft(""); }
        }}
      />
    );
  }

  const colorKey = colorFor(value);
  const style = colorKey === "neutral"
    ? { backgroundColor: "var(--plane)", color: "var(--ink-2)" }
    : colorKey ? { backgroundColor: `var(--${colorKey}-bg)`, color: `var(--${colorKey}-ink)` } : undefined;
  const allOptions = value && !options.includes(value) ? [value, ...options] : options;

  return (
    <select
      className="reason-pill-select"
      style={style}
      value={value || ""}
      disabled={disabled}
      onChange={e => {
        if (e.target.value === ADD_NEW) { setAddingNew(true); return; }
        onChange(e.target.value);
      }}
    >
      <option value="">{placeholder}</option>
      {allOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
      <option value={ADD_NEW}>+ Add new value…</option>
    </select>
  );
}
