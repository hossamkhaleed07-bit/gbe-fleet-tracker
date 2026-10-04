import { sb } from "./supabase";

// Deactivating / reactivating a driver or a vehicle goes through the database
// function set_active_status (migration 053). It checks the role, enforces the
// reason rules, and — when a fleet manager does it — creates the notification
// for the admins. The browser never writes is_active (or the notification)
// directly.
export const MIN_DEACTIVATE_REASON = 10;

const KNOWN_CODES = ["REASON_REQUIRED", "NOT_ALLOWED", "TARGET_NOT_FOUND", "NO_CHANGE", "INVALID_TARGET_TYPE", "INVALID_ACTIVE"];

// targetType: "driver" | "vehicle"; targetKey: identity_number | vehicle_plate.
// Resolves to { ok: true } or { ok: false, code, message } — never throws.
export async function setActiveStatus(targetType, targetKey, active, reason) {
  const { error } = await sb.rpc("set_active_status", {
    p_target_type: targetType,
    p_target_key: String(targetKey),
    p_active: active,
    p_reason: reason && reason.trim() ? reason.trim() : null,
  });
  if (!error) return { ok: true };
  const message = error.message || "";
  const code = KNOWN_CODES.find(c => message.includes(c)) || "UNKNOWN";
  return { ok: false, code, message };
}

// i18n key (under activeStatus.*) for an error code returned above.
export function activeStatusErrorKey(code) {
  switch (code) {
    case "REASON_REQUIRED": return "activeStatus.errReason";
    case "NOT_ALLOWED": return "activeStatus.errNotAllowed";
    case "TARGET_NOT_FOUND": return "activeStatus.errNotFound";
    case "NO_CHANGE": return "activeStatus.errNoChange";
    default: return "activeStatus.errGeneric";
  }
}
