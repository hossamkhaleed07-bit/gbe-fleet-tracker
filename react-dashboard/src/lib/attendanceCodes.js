// The 6 attendance codes GBE actually uses day-by-day. `category` drives
// every place that used to branch on "leave"/"absent": present-like codes
// count as on-duty, leave/absent codes both count as "off" for the
// attendance-conflict rule. A driver with no row for a given date is
// treated as "P" (present) by convention — no need to mark everyone
// every day, only exceptions need a row.
export const ATTENDANCE_CODES = [
  { code: "P", labelAr: "الحضور لسائقين الدينات", labelEn: "Present", category: "present", bg: "var(--c-green-bg)", ink: "var(--c-green-ink)" },
  { code: "VM", labelAr: "تغيير مركبة", labelEn: "Vehicle Moved", category: "present", bg: "var(--c-purple-bg)", ink: "var(--c-purple-ink)" },
  { code: "WO", labelAr: "إجازة اسبوعية", labelEn: "Week Off", category: "leave", bg: "var(--c-orange-bg)", ink: "var(--c-orange-ink)" },
  { code: "AL", labelAr: "أجازة سنوية", labelEn: "Annual Leave", category: "leave", bg: "var(--c-orange-bg)", ink: "var(--c-orange-ink)" },
  { code: "A", labelAr: "غياب", labelEn: "Absent", category: "absent", bg: "var(--c-red-bg)", ink: "var(--c-red-ink)" },
  { code: "Left", labelAr: "غادر العمل", labelEn: "Left", category: "absent", bg: "var(--grid)", ink: "var(--ink-2)" },
  { code: "NM", labelAr: "لم يتم التحضير", labelEn: "Not Marked", category: "neutral", bg: "var(--plane)", ink: "var(--ink-muted)" },
];

export const ATTENDANCE_CODE_MAP = Object.fromEntries(ATTENDANCE_CODES.map(c => [c.code, c]));

// The standard/default code — used whenever a driver-day has no explicit
// row and can't be auto-derived from shift submissions either (see
// deriveAttendanceStatus below).
export const DEFAULT_ATTENDANCE_CODE = "NM";

// Any code whose category is leave/absent counts as "off" for the
// attendance-conflict rule (a reinforcement request landing on a day the
// driver wasn't actually working).
export const OFF_CODES = new Set(ATTENDANCE_CODES.filter(c => c.category === "leave" || c.category === "absent").map(c => c.code));
export const LEAVE_CODES = new Set(ATTENDANCE_CODES.filter(c => c.category === "leave").map(c => c.code));
export const ABSENT_CODES = new Set(ATTENDANCE_CODES.filter(c => c.category === "absent").map(c => c.code));

export function attendanceLabel(code, lang) {
  const c = ATTENDANCE_CODE_MAP[code];
  if (!c) return code || "—";
  return lang === "ar" ? c.labelAr : c.labelEn;
}

// A manager only ever marks exceptions (WO/AL/A/Left/VM) — everything else
// is derived from whether the driver actually submitted a shift form:
// submitted -> P, day already over with nothing submitted -> A, otherwise
// (today/future, not due yet) -> NM. An explicit row always wins.
export function deriveAttendanceStatus({ explicitStatus, hasShiftEntry, day, today }) {
  if (explicitStatus) return explicitStatus;
  if (hasShiftEntry) return "P";
  if (day < today) return "A";
  return DEFAULT_ATTENDANCE_CODE;
}
