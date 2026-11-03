import { buildMissingRows } from "./calc";

// Pure logic behind the RCA / Driver Follow-up table, kept out of the
// component so it can be unit-tested (see rcaFollowup.test.js).

const RIYADH_TZ = "Asia/Riyadh";

// An end entry submitted between 00:00 and this hour (Riyadh time) on the day
// after a Start Only day is treated as that shift's end (see mergeMidnightShifts).
export const MIDNIGHT_CUTOFF_HOUR = 6;

function riyadhParts(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: RIYADH_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hour12: false,
  }).formatToParts(d);
  const get = (t) => parts.find(p => p.type === t)?.value;
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) % 24 };
}

export function riyadhDate(iso) {
  return riyadhParts(iso)?.date || "";
}

export function riyadhHour(iso) {
  const p = riyadhParts(iso);
  return p ? p.hour : null;
}

export function addDays(day, n) {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// "Today"/"yesterday" in Saudi time, whatever timezone the viewing device is set to.
export function riyadhToday(now = new Date()) {
  return riyadhDate(now.toISOString());
}

export function riyadhYesterday(now = new Date()) {
  return addDays(riyadhToday(now), -1);
}

// Both ends inclusive; days are "YYYY-MM-DD" strings so string order is date order.
export function inDayRange(day, from, to) {
  return (!from || day >= from) && (!to || day <= to);
}

const isBlank = (v) => v === null || v === undefined || String(v).trim() === "";

// Why a driver-day's end-of-shift form isn't "complete and valid" — empty
// array means complete. A missing start/end row short-circuits the field checks.
export function endFormIssues(group) {
  if (!group.start && !group.end) return ["no_start", "no_end"];
  if (!group.start) return ["no_start"];
  if (!group.end) return ["no_end"];
  const end = group.end;
  const issues = [];
  if (isBlank(end.odo_reading)) issues.push("missing_odo");
  if (isBlank(end.odo_photo_url)) issues.push("missing_odo_photo");
  if (isBlank(end.client_screenshot_url)) issues.push("missing_client_screenshot");
  if (isBlank(end.cod_delivered)) issues.push("missing_cod");
  if (isBlank(end.ppd_delivered)) issues.push("missing_ppd");
  if (isBlank(end.picked_up)) issues.push("missing_picked_up");
  if (!isBlank(end.odo_reading) && !isBlank(group.start.odo_reading) && Number(end.odo_reading) <= Number(group.start.odo_reading)) {
    issues.push("odo_not_increasing");
  }
  return issues;
}

export function isEndFormComplete(group) {
  return endFormIssues(group).length === 0;
}

// The driver form defaults shift_date to the phone's current date, so a shift
// started on day X and closed after midnight lands as Start Only on X plus
// End Only on X+1. Re-pair them on X when the end was submitted shortly after
// midnight (Riyadh time) on X+1.
export function mergeMidnightShifts(groups) {
  const byKey = new Map(groups.map(g => [`${g.identity_number}|${g.day}`, g]));
  const absorbed = new Set();
  const merged = new Map();
  for (const g of groups) {
    if (!g.start || g.end) continue;
    const next = byKey.get(`${g.identity_number}|${addDays(g.day, 1)}`);
    if (!next || next.start || !next.end) continue;
    const at = next.end.created_at;
    if (riyadhDate(at) !== next.day || riyadhHour(at) >= MIDNIGHT_CUTOFF_HOUR) continue;
    merged.set(g, { ...g, end: next.end, endSubmittedNextDay: true });
    absorbed.add(next);
  }
  return groups.filter(g => !absorbed.has(g)).map(g => merged.get(g) || g);
}

// Rows for the RCA table for one status filter. `groups` should cover from..to
// plus the day after `to` (for the midnight merge); anything outside from..to
// is dropped here.
export function buildRcaRows({ groups, drivers, from, to, status, project, hasReason = () => false }) {
  const projectGroups = mergeMidnightShifts(project ? groups.filter(g => g.project === project) : groups)
    .filter(g => inDayRange(g.day, from, to));
  const projectDrivers = project ? drivers.filter(d => d.project === project) : drivers;
  const missing = () => buildMissingRows(projectDrivers, projectGroups, from, to);

  let base;
  if (status === "start_only") base = projectGroups.filter(g => g.start && !g.end);
  else if (status === "end_only") base = projectGroups.filter(g => !g.start && g.end);
  else if (status === "missing") base = missing();
  else if (status === "all") base = [...projectGroups, ...missing()];
  else if (status === "incomplete_or_missing") base = [...projectGroups.filter(g => !(g.start && g.end)), ...missing()];
  // "followup" (default): everyone whose end-of-shift form isn't complete and
  // valid yet, plus everyone who submitted nothing. A complete form drops out
  // even if a reason/note was filed earlier; it stays visible under "all".
  else base = [...projectGroups.filter(g => !isEndFormComplete(g)), ...missing()];

  return base.map(g => {
    const issues = g.synthetic ? [] : endFormIssues(g);
    return { ...g, issues, formComplete: !g.synthetic && issues.length === 0, reviewedComplete: !g.synthetic && issues.length === 0 && hasReason(g) };
  });
}
