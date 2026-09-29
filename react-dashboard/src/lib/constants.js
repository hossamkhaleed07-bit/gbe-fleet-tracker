export const PROJECT_LIST = ["FDP", "ADM", "LMS", "JDL", "MGF"];

export const PROJECT_MANAGERS = {
  FDP: "Mohammed Alfared",
  ADM: "Mahmoud Jamal",
  LMS: "Abdelhuq Ayob",
  JDL: "Mirza Akbar",
  MGF: "Shoiab Mohammed",
};

// Official "Reason" dropdown for an incomplete/missing shift submission
// (Start Only / End Only / Non Submitted) — exact wording per operations'
// spec, never rename/remove/reword these or existing saved rows become
// inconsistent with the list shown in the dropdown.
export const SUBMISSION_REASON_OPTIONS = [
  "Driver forgot to submit",
  "Client app issue",
  "Driver absent",
  "Driver did not understand the form",
  "Driver had no internet connection",
  "Driver on vacation",
  "Driver phone issue",
  "Driver resigned / inactive",
  "Driver unable to access the form",
  "Driver was not trained on the form",
  "Driver was off duty",
  "Duplicate / already submitted",
  "Emergency case",
  "Google Form link not received",
  "Late shift closure",
  "No shipments assigned",
  "Operation team failed to share instructions",
  "Shift cancelled",
  "Submitted with wrong details",
  "Supervisor failed to follow up",
  "Vehicle breakdown",
  "Vehicle not assigned",
  "Wrong or invalid form link",
  "Other",
  "Driver Left",
];

// Deterministic color per Reason (cycling through the app's existing 6
// badge hues, same tokens ProjectBadge uses) so each option always renders
// the same color everywhere — an Airtable-style colored select-field look.
const REASON_COLOR_KEYS = ["c-blue", "c-green", "c-purple", "c-orange", "c-cyan", "c-pink"];
export function reasonColorKey(reason) {
  const idx = SUBMISSION_REASON_OPTIONS.indexOf(reason);
  if (idx === -1) return null;
  return REASON_COLOR_KEYS[idx % REASON_COLOR_KEYS.length];
}
