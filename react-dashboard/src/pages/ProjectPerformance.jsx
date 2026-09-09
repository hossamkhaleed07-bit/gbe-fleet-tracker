import { useMemo } from "react";
import { useDashboard } from "../contexts/DataContext";
import { useLang } from "../contexts/LanguageContext";
import GlobalFilters from "../components/GlobalFilters";
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

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("projectPerformance.colManager")}</th>
              <th>{t("projectPerformance.colProject")}</th>
              <th>{t("projectPerformance.colTotalDrivers")}</th>
              <th>{t("projectPerformance.colComplete")}</th>
              <th>{t("projectPerformance.colStartOnly")}</th>
              <th>{t("projectPerformance.colEndOnly")}</th>
              <th>{t("projectPerformance.colCompletionRate")}</th>
              <th>{t("projectPerformance.colFailureRate")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.p}>
                <td>{r.manager}</td>
                <td><b>{r.p}</b></td>
                <td>{r.total}</td>
                <td><span className="badge complete">{r.complete}</span></td>
                <td><span className="badge partial">{r.startOnly}</span></td>
                <td><span className="badge partial">{r.endOnly}</span></td>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                    <div className="bar-track" style={{ width: 90 }}><div className="bar-fill" style={{ width: r.rate + "%" }}></div></div>
                    <span style={{ fontWeight: 700, fontSize: "0.85rem" }}>{r.rate}%</span>
                  </div>
                </td>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                    <div className="bar-track" style={{ width: 90 }}><div className="bar-fill critical" style={{ width: r.failRate + "%" }}></div></div>
                    <span style={{ fontWeight: 700, fontSize: "0.85rem" }}>{r.failRate}%</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
