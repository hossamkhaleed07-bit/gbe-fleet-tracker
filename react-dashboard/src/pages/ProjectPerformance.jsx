import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useDashboard } from "../contexts/DataContext";
import { useAuth } from "../contexts/AuthContext";
import { useLang } from "../contexts/LanguageContext";
import GlobalFilters from "../components/GlobalFilters";
import DataTable from "../components/DataTable";
import { PROJECT_LIST, PROJECT_MANAGERS } from "../lib/constants";
import { buildMissingRows } from "../lib/calc";
import HeroPortal from "../components/HeroPortal";

export default function ProjectPerformance() {
  const { allRows, allCompareGroups, allDrivers, from, to } = useDashboard();
  const { currentUserProject, isViewer } = useAuth();
  const { t } = useLang();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // A project-scoped account only ever gets its own project's rows back from
  // Supabase (RLS), so showing the other 4 as always-zero rows would just be
  // confusing — restrict the Statistics table itself to what they can see.
  // Admin/fleet-manager accounts (no project claim) keep seeing all 5.
  const visibleProjects = useMemo(
    () => (currentUserProject ? [currentUserProject] : PROJECT_LIST),
    [currentUserProject]
  );

  function goToRecords(project, status) {
    const next = new URLSearchParams(searchParams);
    next.set("project", project);
    if (status) next.set("status", status); else next.delete("status");
    navigate({ pathname: "/records", search: next.toString() });
  }

  function goToDrivers(project) {
    if (isViewer) return; // the Drivers page is not one of a viewer's pages
    const next = new URLSearchParams(searchParams);
    next.set("project", project);
    // "Total Drivers" counts only active drivers, so land on the same subset.
    next.set("status", "active");
    navigate({ pathname: "/drivers", search: next.toString() });
  }

  // Start Only / End Only / Non Submitted navigate to the RCA / Driver
  // Follow-up page (its own nav destination, see Layout.jsx) — Records stays
  // as the drill-through for the Complete count, unchanged. rcaFrom/rcaTo
  // (distinct from the shared from/to) carry over the CURRENT Statistics
  // date range so the RCA table lands on exactly the rows that made up the
  // clicked count, instead of RCA's own default of "yesterday".
  function openRCA(project, status) {
    const next = new URLSearchParams(searchParams);
    next.set("project", project);
    next.set("status", status);
    next.set("rcaFrom", from);
    next.set("rcaTo", to);
    navigate({ pathname: "/project-performance/rca", search: next.toString() });
  }

  // A driver can submit shifts on more than one day within the selected range, so
  // "expected submissions" must scale by the number of distinct days covered, not
  // just the driver headcount, otherwise submitted counts can exceed "total" and
  // percentages blow past 100%.
  const daysInRange = useMemo(() => {
    const days = new Set(allRows.map(r => r.shift_date).filter(Boolean));
    return days.size || 1;
  }, [allRows]);

  const rows = useMemo(() => {
    return visibleProjects.map(p => {
      // Only active drivers are expected to submit shifts — an inactive driver
      // shouldn't inflate the headcount or the expected-submissions total below.
      const projectDrivers = allDrivers.filter(d => d.project === p && d.is_active);
      const total = projectDrivers.length;
      const projectGroups = allCompareGroups.filter(g => g.project === p);
      const complete = projectGroups.filter(g => g.start && g.end).length;
      const startOnly = projectGroups.filter(g => g.start && !g.end).length;
      const endOnly = projectGroups.filter(g => !g.start && g.end).length;
      const expectedTotal = total * daysInRange;
      // Both rates share the same denominator (expected total, not just "submitted")
      // so they always complement each other to 100%.
      const rate = expectedTotal ? Math.round((complete / expectedTotal) * 100) : 0;
      // Uses the SAME row-builder as the RCA view's table (and Records.jsx),
      // not a separate arithmetic derivation, so this count always matches
      // exactly how many rows switching to RCA lands on.
      const nonSubmitted = buildMissingRows(projectDrivers, projectGroups, from, to).length;
      const failRate = expectedTotal ? 100 - rate : 0;
      return { p, manager: PROJECT_MANAGERS[p] || "—", total, complete, startOnly, endOnly, nonSubmitted, rate, failRate };
    });
  }, [visibleProjects, allCompareGroups, allDrivers, daysInRange, from, to]);

  const columns = useMemo(() => [
    { accessorKey: "manager", header: t("projectPerformance.colManager") },
    { accessorKey: "p", header: t("projectPerformance.colProject"), cell: ({ getValue }) => <b>{getValue()}</b> },
    {
      accessorKey: "total", header: t("projectPerformance.colTotalDrivers"), meta: { align: "end" },
      cell: ({ row }) => <span className="badge-link" onClick={() => goToDrivers(row.original.p)}>{row.original.total}</span>,
    },
    {
      accessorKey: "complete", header: t("projectPerformance.colComplete"), meta: { align: "end" },
      cell: ({ row }) => <span className="badge complete clickable-badge" onClick={() => goToRecords(row.original.p, "complete")}>{row.original.complete}</span>,
    },
    {
      accessorKey: "startOnly", header: t("projectPerformance.colStartOnly"), meta: { align: "end" },
      cell: ({ row }) => <span className="badge partial clickable-badge" onClick={() => openRCA(row.original.p, "start_only")}>{row.original.startOnly}</span>,
    },
    {
      accessorKey: "endOnly", header: t("projectPerformance.colEndOnly"), meta: { align: "end" },
      cell: ({ row }) => <span className="badge partial clickable-badge" onClick={() => openRCA(row.original.p, "end_only")}>{row.original.endOnly}</span>,
    },
    {
      // Drivers expected to submit a shift for a given day but who submitted
      // nothing at all (not even a partial start/end) — distinct from the
      // Start Only / End Only counts above.
      accessorKey: "nonSubmitted", header: t("projectPerformance.colNonSubmitted"), meta: { align: "end" },
      cell: ({ row }) => <span className="badge critical clickable-badge" onClick={() => openRCA(row.original.p, "missing")}>{row.original.nonSubmitted}</span>,
    },
    {
      accessorKey: "rate", header: t("projectPerformance.colCompletionRate"),
      cell: ({ row }) => (
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <div className="bar-track" style={{ width: 90 }}><div className="bar-fill" style={{ width: row.original.rate + "%" }}></div></div>
          <span style={{ fontWeight: 700, fontSize: "0.85rem" }}>{row.original.rate}%</span>
        </div>
      ),
    },
    {
      accessorKey: "failRate", header: t("projectPerformance.colFailureRate"),
      cell: ({ row }) => (
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <div className="bar-track" style={{ width: 90 }}><div className="bar-fill critical" style={{ width: row.original.failRate + "%" }}></div></div>
          <span style={{ fontWeight: 700, fontSize: "0.85rem" }}>{row.original.failRate}%</span>
        </div>
      ),
    },
  ], [t]);

  return (
    <>
      <HeroPortal target="fx-hero-actions" className="content-header">
        <div>
          <div className="breadcrumb">{t("common.dashboard")} &gt; <b>{t("projectPerformance.breadcrumb")}</b></div>
          <h1 className="page-title">{t("projectPerformance.breadcrumb")}</h1>
        </div>
      </HeroPortal>
      <GlobalFilters />
      <HeroPortal target="fx-hero-note" className="fx-hero-note">
        {from || to
          ? t("projectPerformance.subWithRange", { from: from || t("projectPerformance.fromFallback"), to: to || t("projectPerformance.toFallback") })
          : t("projectPerformance.subNoRange")}
      </HeroPortal>

      <DataTable columns={columns} data={rows} emptyMessage={t("common.loading")} />
    </>
  );
}
