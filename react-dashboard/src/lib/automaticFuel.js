import { sb } from "./supabase";
import { addDays, riyadhToday } from "./rcaFollowup";

// Automatic Fuel amounts (migration 061), void / restore and the invoice review
// list (migration 064): reads, the admin operations, and the pure helpers the
// page and its tests share.

export const AUTO_FUEL_PROJECT = "FDP";

export const ERROR_CODES = [
  "AUTO_FUEL_ADMIN_ONLY", "AUTO_FUEL_AMOUNT_MUST_BE_POSITIVE", "AUTO_FUEL_REASON_REQUIRED",
  "AUTO_FUEL_UNKNOWN_DRIVER", "AUTO_FUEL_UNKNOWN_ALLOCATION",
  "AUTO_FUEL_REASON_TOO_SHORT", "AUTO_FUEL_VOID_PAST_DAYS_ONLY", "AUTO_FUEL_NO_ROWS",
  "AUTO_FUEL_NOT_VOIDED", "AUTO_FUEL_ALLOCATION_VOIDED", "AUTO_FUEL_BAD_RANGE",
  "AUTO_FUEL_PAST_DAYS_ONLY", "AUTO_FUEL_NOT_ACTIVE_FDP", "AUTO_FUEL_ALREADY_MARKED", "AUTO_FUEL_MARKED_UNENTITLED",
  "AUTO_FUEL_MARKED_WORKED", "AUTO_FUEL_ALREADY_ALLOCATED", "AUTO_FUEL_NOT_MARKED", "AUTO_FUEL_HAS_AUTOMATIC_FUEL",
  "AUTO_FUEL_HAS_REINFORCEMENT", "AUTO_FUEL_NO_INVOICE",
];

export const STATUSES = ["processed", "failed"];

export function autoFuelErrorMessage(t, error) {
  const text = `${error?.message || ""} ${error?.details || ""}`;
  const code = ERROR_CODES.find(c => text.includes(c));
  return code ? t(`automaticFuel.errors.${code}`) : (error?.message || t("automaticFuel.errors.UNKNOWN"));
}

// One row per active FDP driver with the amount the next allocation will use.
export function buildDriverAmountRows(drivers, driverAmounts, defaultAmount) {
  const own = Object.fromEntries(driverAmounts.map(a => [a.identity_number, a]));
  return drivers
    .filter(d => d.project === AUTO_FUEL_PROJECT && d.is_active)
    .map(d => {
      const a = own[d.identity_number];
      return {
        identity_number: d.identity_number,
        full_name: d.full_name,
        vehicle_plate: d.assigned_vehicle_plate || null,
        ownAmount: a ? Number(a.amount) : null,
        amount: a ? Number(a.amount) : defaultAmount,
        isDefault: !a,
        updated_by: a?.updated_by || null,
        updated_at: a?.updated_at || null,
      };
    })
    .sort((x, y) => (x.full_name || "").localeCompare(y.full_name || ""));
}

// "" or anything not a positive number → null (the caller shows an error).
export function parseAmount(value) {
  const n = Number(String(value ?? "").trim());
  return String(value ?? "").trim() !== "" && Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

export async function loadAmounts() {
  const [settings, driverAmounts, changes] = await Promise.all([
    sb.from("automatic_fuel_settings").select("default_amount,updated_by,updated_at").maybeSingle(),
    sb.from("automatic_fuel_driver_amounts").select("*"),
    sb.from("automatic_fuel_amount_changes").select("*").order("changed_at", { ascending: false }).limit(500),
  ]);
  const error = settings.error || driverAmounts.error || changes.error;
  if (error) return { error };
  return {
    defaultAmount: settings.data ? Number(settings.data.default_amount) : null,
    settings: settings.data,
    driverAmounts: driverAmounts.data || [],
    changes: changes.data || [],
    error: null,
  };
}

export const setDefaultAmount = (amount) => sb.rpc("auto_fuel_set_default", { p_amount: amount });
export const setDriverAmount = (identityNumber, amount) =>
  sb.rpc("auto_fuel_set_driver_amount", { p_identity_number: identityNumber, p_amount: amount });
export const adjustAllocation = (id, amount, reason) =>
  sb.rpc("auto_fuel_adjust_allocation", { p_allocation_id: id, p_amount: amount, p_reason: reason });

// ---------------------------------------------------------------------------
// Void / restore (migration 064)
// ---------------------------------------------------------------------------

// Same minimum as the database (private.auto_fuel_require_reason).
export const MIN_REASON_LENGTH = 10;
export const reasonOk = (reason) => String(reason ?? "").trim().length >= MIN_REASON_LENGTH;

export const isVoided = (row) => !!row?.voided_at;

// Active rows count in every total; voided rows are only shown on the Automatic
// Fuel page.
export function splitVoided(rows) {
  const active = [];
  const voided = [];
  for (const r of rows || []) (isVoided(r) ? voided : active).push(r);
  return { active, voided };
}

// Only a day that is over in Riyadh time can be voided (the database checks too).
export const canVoidDay = (day, today = riyadhToday()) => !!day && day < today;

export const voidAllocations = (ids, reason) =>
  sb.rpc("auto_fuel_void_allocations", { p_ids: ids, p_reason: reason });
export const restoreAllocation = (id, reason) =>
  sb.rpc("auto_fuel_restore_allocation", { p_allocation_id: id, p_reason: reason });

// ---------------------------------------------------------------------------
// Review list: automatic fuel days without a matching invoice (migration 064)
// ---------------------------------------------------------------------------

// In the order the database checks them; "matched" days are never returned.
export const REVIEW_STATUSES = ["no_invoice", "partial_invoice", "combined_fill", "not_loaded"];
// Statuses an admin can tick for a bulk void. A combined fill is only flagged, and
// a day whose invoices are not loaded yet cannot be judged.
export const VOIDABLE_REVIEW_STATUSES = ["no_invoice", "partial_invoice"];
export const SUGGESTED_REVIEW_STATUS = "no_invoice";

const REVIEW_PAGE = 1000;

// Paged: Supabase returns at most 1000 rows per call.
export async function loadReview(from, to) {
  const rows = [];
  for (let start = 0; ; start += REVIEW_PAGE) {
    const { data, error } = await sb.rpc("auto_fuel_invoice_review", { p_from: from, p_to: to })
      .range(start, start + REVIEW_PAGE - 1);
    if (error) return { rows: null, error };
    rows.push(...(data || []));
    if (!data || data.length < REVIEW_PAGE) break;
  }
  return { rows, error: null };
}

// Per status: days and automatic fuel SAR, plus the last loaded invoice day.
export function summarizeReview(rows) {
  const byStatus = Object.fromEntries(REVIEW_STATUSES.map(s => [s, { days: 0, sar: 0 }]));
  let lastInvoiceDate = null;
  for (const r of rows || []) {
    const b = byStatus[r.status];
    if (b) { b.days += 1; b.sar += Number(r.automatic_fuel || 0); }
    if (r.last_invoice_date && (!lastInvoiceDate || r.last_invoice_date > lastInvoiceDate)) lastInvoiceDate = r.last_invoice_date;
  }
  return { byStatus, lastInvoiceDate };
}

// ---------------------------------------------------------------------------
// List B: PetroApp / Futurehub fills with no automatic fuel and no approved
// reinforcement (migration 064), the two admin decisions, and the monthly
// reconciliation line
// ---------------------------------------------------------------------------

// In the order the database checks them.
export const FILL_STATUSES = ["unexplained", "nearby_auto", "voided_day", "fuel_coming", "worked_marked", "unentitled"];
// Shown unless the admin picks a status: everything still open.
export const OPEN_FILL_STATUSES = FILL_STATUSES.filter(s => s !== "unentitled");

// Which buttons a row gets.
export function fillActions(row) {
  switch (row?.status) {
    case "unexplained":
    case "nearby_auto":
      return row.is_active ? ["worked", "unentitled"] : ["unentitled"];
    case "voided_day": return ["restore", "unentitled"];
    case "worked_marked": return ["undoWorked"];
    case "unentitled": return ["clearUnentitled"];
    default: return [];
  }
}

// The next 06:30 run covers (tomorrow - 7) .. today, so "Worked, forgot the form"
// gives an older day its fuel at once (the database decides the same way).
export const givesFuelNow = (day, today = riyadhToday()) => !!day && day < addDays(today, -6);

export const markWorked = (identityNumber, day, reason) =>
  sb.rpc("auto_fuel_mark_worked", { p_identity_number: identityNumber, p_date: day, p_reason: reason });
export const undoWorked = (identityNumber, day, reason) =>
  sb.rpc("auto_fuel_undo_worked", { p_identity_number: identityNumber, p_date: day, p_reason: reason });
export const markUnentitled = (identityNumber, day, reason) =>
  sb.rpc("auto_fuel_mark_unentitled", { p_identity_number: identityNumber, p_date: day, p_reason: reason });
export const clearUnentitled = (identityNumber, day, reason) =>
  sb.rpc("auto_fuel_clear_unentitled", { p_identity_number: identityNumber, p_date: day, p_reason: reason });

// Paged: Supabase returns at most 1000 rows per call.
export async function loadFills(from, to) {
  const rows = [];
  for (let start = 0; ; start += REVIEW_PAGE) {
    const { data, error } = await sb.rpc("auto_fuel_unexplained_fills", { p_from: from, p_to: to })
      .range(start, start + REVIEW_PAGE - 1);
    if (error) return { rows: null, error };
    rows.push(...(data || []));
    if (!data || data.length < REVIEW_PAGE) break;
  }
  return { rows, error: null };
}

// Per status: days and invoice SAR.
export function summarizeFills(rows) {
  const byStatus = Object.fromEntries(FILL_STATUSES.map(s => [s, { days: 0, sar: 0 }]));
  for (const r of rows || []) {
    const b = byStatus[r.status];
    if (b) { b.days += 1; b.sar += Number(r.invoice_sar || 0); }
  }
  return byStatus;
}

export async function loadReconciliation(from, to) {
  const { data, error } = await sb.rpc("auto_fuel_reconciliation", { p_from: from, p_to: to });
  if (error) return { data: null, error };
  const r = (data || [])[0] || null;
  if (!r) return { data: null, error: null };
  const n = (v) => Number(v || 0);
  return {
    data: {
      invoicesTotal: n(r.invoices_total), onFuelDays: n(r.on_fuel_days), unentitled: n(r.unentitled),
      unexplained: n(r.unexplained), unexplainedDays: n(r.unexplained_days), automaticFuel: n(r.automatic_fuel),
      reinforcement: n(r.reinforcement), voidedAutomaticFuel: n(r.voided_automatic_fuel),
      lastInvoiceDate: r.last_invoice_date || null,
    },
    error: null,
  };
}

// First and last day of a "YYYY-MM" month.
export function monthRange(month) {
  if (!/^\d{4}-\d{2}$/.test(month || "")) return null;
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}
