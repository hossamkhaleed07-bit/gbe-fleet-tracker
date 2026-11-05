import { sb } from "./supabase";

// Automatic Fuel amounts (migration 061): reads, the three admin operations, and
// the pure helpers the page and its tests share.

export const AUTO_FUEL_PROJECT = "FDP";

export const ERROR_CODES = [
  "AUTO_FUEL_ADMIN_ONLY", "AUTO_FUEL_AMOUNT_MUST_BE_POSITIVE", "AUTO_FUEL_REASON_REQUIRED",
  "AUTO_FUEL_UNKNOWN_DRIVER", "AUTO_FUEL_UNKNOWN_ALLOCATION",
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
