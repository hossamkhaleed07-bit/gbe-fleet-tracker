// "Fuel & Invoice Management" module — field definitions and small helpers.
// Standalone from the rest of the app's fuel/attendance business logic on
// purpose (a completely separate module per the request that created it).
//
// Column order, the Cost/Amount/VAT formula, and the DA Name lookup all
// match the real source file ("Fuels Master Sheet 2026.xlsx", "September"
// sheet) inspected for this module — not guessed.

// Column order is significant — it's the exact order in the source sheet,
// and both the Entries and Data Base pages render columns in this order.
// "Batch" (18th field) exists in the real sheet after Remarks even though
// it wasn't in the original 17-field spec — added once the real file was
// inspected, currently unused/empty in every real row.
export const FUEL_INVOICE_FIELDS = [
  { key: "data_source", label: "Data Source", type: "select" },
  { key: "invoice_number", label: "Invoice Number", type: "text" },
  { key: "internal_number", label: "Internal number", type: "text" },
  { key: "fuel_type", label: "Type of fuel", type: "select" },
  { key: "cost", label: "Cost", type: "currency" },
  { key: "amount", label: "Amount", type: "computed" },
  { key: "vat", label: "VAT", type: "computed" },
  { key: "user_name", label: "User Name", type: "text" },
  { key: "entry_date", label: "Date", type: "date" },
  { key: "card_type", label: "Card Type", type: "select" },
  { key: "status", label: "Status", type: "select" },
  { key: "use_type", label: "Use type", type: "select" },
  { key: "branch", label: "Branch", type: "select" },
  { key: "nid", label: "NID", type: "text" },
  { key: "da_name", label: "DA Name", type: "lookup" },
  { key: "deduction_code", label: "Deduction code", type: "text" },
  { key: "remarks", label: "Remarks", type: "longtext" },
  { key: "batch", label: "Batch", type: "text" },
];

export const SELECT_FIELD_KEYS = FUEL_INVOICE_FIELDS.filter(f => f.type === "select").map(f => f.key);

export function emptyFuelInvoiceForm() {
  const form = {};
  for (const f of FUEL_INVOICE_FIELDS) form[f.key] = "";
  return form;
}

// Source sheet's own formula: Cost is VAT-inclusive; Amount is the net
// pre-VAT amount backed out at Saudi Arabia's 15% VAT rate, VAT is the
// remainder — confirmed from the actual workbook (=Cost/1.15, =Cost-Amount
// on every row), not assumed. Kept as a single helper so both the modal
// (on save) and any future recompute always agree.
export function computeAmountVat(cost) {
  const c = Number(cost);
  if (!Number.isFinite(c)) return { amount: null, vat: null };
  const amount = c / 1.15;
  return { amount, vat: c - amount };
}

// No company-specific option lists were provided for most select fields
// (Type of fuel / Card Type / Branch) — rather than invent business
// categories, each field's picklist is whatever distinct values already
// exist in the table, growing as someone types a new one ("+ Add new
// value"), same idea as Airtable's own "create option". Data Source /
// Status / Use type DO have a real, fixed, exhaustive set of values found
// in the source sheet, though — see FIXED_OPTIONS below.
export function distinctValues(records, key) {
  const seen = new Set(FIXED_OPTIONS[key] || []);
  for (const r of records) {
    const v = (r[key] || "").toString().trim();
    if (v) seen.add(v);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

// Exact values found in the real sheet for these 3 fields (Data Source: 2,
// Status: 3, Use type: 7) — seeded so the dropdown always offers the full
// real set even before any record using a given value has been loaded/typed.
export const FIXED_OPTIONS = {
  data_source: ["PetroApp", "Futurehub"],
  status: ["Added", "Being Processed", "Not Required"],
  use_type: ["DA Use", "FDP use", "GBE Vehicle", "JDL Vehicle", "LH use", "Management Use", "SUP Use"],
};

// Deterministic color per string (stable hash → one of the app's existing 6
// badge hues) — the fallback used for select fields with no fixed palette
// (Type of fuel / Card Type / Branch), so the same typed value always
// renders the same color everywhere even though its option list can grow.
const COLOR_KEYS = ["c-blue", "c-green", "c-purple", "c-orange", "c-cyan", "c-pink"];
export function stringColorKey(value) {
  const v = (value || "").toString();
  if (!v) return null;
  let hash = 0;
  for (let i = 0; i < v.length; i++) hash = (hash * 31 + v.charCodeAt(i)) >>> 0;
  return COLOR_KEYS[hash % COLOR_KEYS.length];
}

// Explicit color per value for Data Source / Status / Use type, matching
// (as closely as the app's existing 6-hue design-system palette allows) the
// colors already used for these dropdowns in the source Google Sheet
// screenshot — a best-effort approximation using the app's own tokens
// rather than introducing brand-new arbitrary hex colors. Anything not
// listed here (a newly-typed value, or any other select field) falls back
// to the generic hash above.
const FIXED_COLORS = {
  data_source: { PetroApp: "c-purple", Futurehub: "c-pink" },
  status: { "Being Processed": "c-orange", Added: "c-green" }, // "Not Required" intentionally left neutral/gray, not one of the 6 hues
  use_type: {
    "LH use": "c-purple", "FDP use": "c-blue", "GBE Vehicle": "c-green",
    "JDL Vehicle": "c-orange", "DA Use": "c-pink",
  },
};
export function fieldColorKey(fieldKey, value) {
  if (!value) return null;
  const fixed = FIXED_COLORS[fieldKey]?.[value];
  if (fixed) return fixed;
  if (fieldKey === "status" && value === "Not Required") return "neutral";
  return stringColorKey(value);
}

export function money(v) {
  return v == null || v === "" ? "—" : `${Number(v).toFixed(2)} SAR`;
}
