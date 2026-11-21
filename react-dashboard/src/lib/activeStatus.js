import { sb } from "./supabase";

// Deactivating / reactivating a driver or a vehicle goes through the database
// function set_active_status (migration 053, extended by 065). It checks the
// role, enforces the rules, and — when a fleet manager does it — creates the
// notification for the admins. The browser never writes is_active (or the
// notification) directly.
//   vehicles: a reason of 10+ characters to deactivate (053)
//   drivers : last working day + a reason from a fixed list + optional note (065)
export const MIN_DEACTIVATE_REASON = 10;

// Longest first, so a code that contains another (REASON_CODE_REQUIRED vs
// REASON_REQUIRED) is matched correctly.
const KNOWN_CODES = [
  "REASON_CODE_REQUIRED", "LAST_DAY_BEFORE_HIRING", "INVALID_REASON_CODE", "LAST_DAY_IN_FUTURE", "LAST_DAY_REQUIRED",
  "TARGET_NOT_FOUND", "REASON_REQUIRED", "NOTE_REQUIRED", "NOT_INACTIVE", "NOT_ALLOWED", "NO_CHANGE",
  "INVALID_TARGET_TYPE", "INVALID_ACTIVE",
];

// Why a driver left (migration 065): the codes the database accepts, in the
// order the dialog lists them.  Labels: activeStatus.reason_<code>.
export const DEACTIVATION_REASONS = [
  "resigned", "terminated", "absconded", "contract_ended", "final_exit",
  "transferred_out", "medical", "never_started", "other",
];
export const NOTE_REQUIRED_REASONS = ["other"];

function toResult({ error }) {
  if (!error) return { ok: true };
  const message = error.message || "";
  const code = KNOWN_CODES.find(c => message.includes(c)) || "UNKNOWN";
  return { ok: false, code, message };
}

// targetType: "driver" | "vehicle"; targetKey: identity_number | vehicle_plate.
// leaving (a driver being deactivated): { lastWorkingDay, reasonCode, note }.
// Resolves to { ok: true } or { ok: false, code, message } — never throws.
export async function setActiveStatus(targetType, targetKey, active, reason, leaving = null) {
  const params = {
    p_target_type: targetType,
    p_target_key: String(targetKey),
    p_active: active,
    p_reason: reason && reason.trim() ? reason.trim() : null,
  };
  if (leaving) {
    params.p_last_working_day = leaving.lastWorkingDay || null;
    params.p_reason_code = leaving.reasonCode || null;
    params.p_note = leaving.note && leaving.note.trim() ? leaving.note.trim() : null;
  }
  return toResult(await sb.rpc("set_active_status", params));
}

// Admin: fill in / correct the leaving details of a driver who is already inactive.
export async function setDriverLeavingDetails(identityNumber, { lastWorkingDay, reasonCode, note }) {
  return toResult(await sb.rpc("set_driver_leaving_details", {
    p_identity_number: String(identityNumber),
    p_last_working_day: lastWorkingDay || null,
    p_reason_code: reasonCode || null,
    p_note: note && note.trim() ? note.trim() : null,
  }));
}

export function normalizeActivityAfter(r) {
  const n = (v) => Number(v || 0);
  const out = {
    formDays: n(r?.form_days), reinforcementCount: n(r?.reinforcement_count), reinforcementSar: n(r?.reinforcement_sar),
    automaticCount: n(r?.automatic_count), automaticSar: n(r?.automatic_sar),
    firstDay: r?.first_day || null, lastDay: r?.last_day || null,
  };
  out.any = out.formDays + out.reinforcementCount + out.automaticCount > 0;
  out.totalSar = out.reinforcementSar + out.automaticSar;
  return out;
}

// Shift forms, approved reinforcement and automatic fuel AFTER a day, for the
// dialog's warning.  Resolves to { data, error } — never throws.
export async function loadActivityAfter(identityNumber, day) {
  const { data, error } = await sb.rpc("driver_activity_after", { p_identity_number: String(identityNumber), p_day: day });
  if (error) return { data: null, error };
  return { data: normalizeActivityAfter((data || [])[0]), error: null };
}

// The same checks as the database (private.driver_check_leaving), so the
// dialog can say what is wrong before saving.  Returns an error code or null.
export function leavingError({ lastWorkingDay, reasonCode, note }, { today, hiredOn } = {}) {
  if (!lastWorkingDay) return "LAST_DAY_REQUIRED";
  if (today && lastWorkingDay > today) return "LAST_DAY_IN_FUTURE";
  if (hiredOn && lastWorkingDay < hiredOn) return "LAST_DAY_BEFORE_HIRING";
  if (!reasonCode) return "REASON_CODE_REQUIRED";
  if (!DEACTIVATION_REASONS.includes(reasonCode)) return "INVALID_REASON_CODE";
  if (NOTE_REQUIRED_REASONS.includes(reasonCode) && !(note && note.trim())) return "NOTE_REQUIRED";
  return null;
}

// i18n key (under activeStatus.*) for an error code returned above.
export function activeStatusErrorKey(code) {
  switch (code) {
    case "REASON_REQUIRED": return "activeStatus.errReason";
    case "NOT_ALLOWED": return "activeStatus.errNotAllowed";
    case "TARGET_NOT_FOUND": return "activeStatus.errNotFound";
    case "NO_CHANGE": return "activeStatus.errNoChange";
    case "LAST_DAY_REQUIRED": return "activeStatus.errLastDayRequired";
    case "LAST_DAY_IN_FUTURE": return "activeStatus.errLastDayFuture";
    case "LAST_DAY_BEFORE_HIRING": return "activeStatus.errLastDayBeforeHiring";
    case "REASON_CODE_REQUIRED":
    case "INVALID_REASON_CODE": return "activeStatus.errReasonCode";
    case "NOTE_REQUIRED": return "activeStatus.errNoteRequired";
    case "NOT_INACTIVE": return "activeStatus.errNotInactive";
    default: return "activeStatus.errGeneric";
  }
}
