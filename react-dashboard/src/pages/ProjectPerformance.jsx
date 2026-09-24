import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useDashboard } from "../contexts/DataContext";
import { useLang } from "../contexts/LanguageContext";
import GlobalFilters from "../components/GlobalFilters";
import DataTable from "../components/DataTable";
import { PROJECT_LIST } from "../lib/constants";

const PROJECT_MANAGERS = {
  FDP: "Mohammed Alfared",
  ADM: "Mahmoud Jamal",
  LMS: "Abdelhuq Ayob",
  JDL: "Mirza Akbar",
  MGF: "Shoiab Mohammed",
};

export default function ProjectPerformance() {
  const { allRows, allCompareGroups, allDrivers, from, to } = useDashboard();
  const { t } = useLang();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  function goToRecords(project, status) {
    const next = new URLSearchParams(searchParams);
    next.set("project", project);
    if (status) next.set("status", status); else next.delete("status");
    navigate({ pathname: "/records", search: next.toString() });
  }

  function goToDrivers(project) {
    const next = new URLSearchParams(searchParams);
    next.set("project", project);
    navigate({ pathname: "/drivers", search: next.toString() });
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
    return PROJECT_LIST.map(p => {
      const total = allDrivers.filter(d => d.project === p).length;
      const projectGroups = allCompareGroups.filter(g => g.project === p);
      const complete = projectGroups.filter(g => g.start && g.end).length;
      const startOnly = projectGroups.filter(g => g.start && !g.end).length;
      const endOnly = projectGroups.filter(g => !g.start && g.end).length;
      const submitted = complete + startOnly + endOnly;
      const expectedTotal = total * daysInRange;
      // Both rates share the same denominator (expected total, not just "submitted")
      // so they always complement each other to 100%.
      const rate = expectedTotal ? Math.round((complete / expectedTotal) * 100) : 0;
      const noRecord = Math.max(expectedTotal - submitted, 0);
      const failRate = expectedTotal ? 100 - rate : 0;
      return { p, manager: PROJECT_MANAGERS[p] || "—", total, complete, startOnly, endOnly, rate, failRate };
    });
  }, [allRows, allCompareGroups, allDrivers, daysInRange]);

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
      cell: ({ row }) => <span className="badge partial clickable-badge" onClick={() => goToRecords(row.original.p, "start_only")}>{row.original.startOnly}</span>,
    },
    {
      accessorKey: "endOnly", header: t("projectPerformance.colEndOnly"), meta: { align: "end" },
      cell: ({ row }) => <span className="badge partial clickable-badge" onClick={() => goToRecords(row.original.p, "end_only")}>{row.original.endOnly}</span>,
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
      <div className="content-header">
        <div>
          <div className="breadcrumb">{t("common.dashboard")} &gt; <b>{t("projectPerformance.breadcrumb")}</b></div>
          <h1 className="page-title">{t("projectPerformance.breadcrumb")}</h1>
        </div>
      </div>
      <GlobalFilters />
      <p className="sub" style={{ margin: "-0.6rem 0 1rem" }}>
        {from || to
          ? t("projectPerformance.subWithRange", { from: from || t("projectPerformance.fromFallback"), to: to || t("projectPerformance.toFallback") })
          : t("projectPerformance.subNoRange")}
      </p>

      <DataTable columns={columns} data={rows} emptyMessage={t("common.loading")} />
    </>
  );
}
