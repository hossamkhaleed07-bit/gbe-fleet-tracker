// Pages a read-only "viewer" account may open (all projects, no editing). Everything else
// is hidden from the menu and redirects to Overview. The database enforces the same
// limits (migration 056); this only keeps the interface honest.
const EXACT = [
  "/overview", "/form-response", "/records", "/attendance", "/compare", "/stations",
  "/project-performance", "/project-performance/rca",
];

export function isViewerPath(pathname) {
  const p = String(pathname || "").replace(/\/+$/, "") || "/";
  return EXACT.includes(p) || p === "/driver-performance" || p.startsWith("/driver-performance/");
}
