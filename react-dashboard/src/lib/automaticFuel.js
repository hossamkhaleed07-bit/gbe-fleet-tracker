import { sb } from "./supabase";
import { riyadhToday } from "./rcaFollowup";

// Automatic Fuel amounts (migration 061), void / restore and the invoice review
// list (migration 064): reads, the admin operations, and the pure helpers the
// page and its tests share.

export const AUTO_FUEL_PROJECT = "FDP";

export const ERROR_CODES = [
  "AUTO_FUEL_ADMIN_ONLY", "AUTO_FUEL_AMOUNT_MUST_BE_POSITIVE", "AUTO_FUEL_REASON_REQUIRED",
  "AUTO_FUEL_UNKNOWN_DRIVER", "AUTO_FUEL_UNKNOWN_ALLOCATION",
  "AUTO_FUEL_REASON_TOO_SHORT", "AUTO_FUEL_VOID_PAST_DAYS_ONLY", "AUTO_FUEL_NO_ROWS",
  "AUTO_FUEL_NOT_VOIDED", "AUTO_FUEL_ALLOCATION_VOIDED", "AUTO_FUEL_BAD_RANGE",
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
