import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useDashboard } from "../contexts/DataContext";
import { useLang } from "../contexts/LanguageContext";
import ProjectBadge from "../components/ProjectBadge";
import Field from "../components/Field";
import MonthPicker from "../components/MonthPicker";
import MetricBarList from "../components/MetricBarList";
import HeroPortal from "../components/HeroPortal";
import { localToday } from "../lib/calc";
import { MAX_JUMP_KM_PER_DAY, PROJECT_LIST } from "../lib/constants";
import {
  monthBounds, buildDriverPerfRows, buildProjectSummary, topN, selectPerfDrivers, UNLISTED_PROJECT, perfDriverName,
} from "../lib/driverPerformance";
import DriversCount from "../components/DriversCount";

const money = (v) => `${v.toFixed(0)} SAR`;
const money2 = (v) => `${v.toFixed(2)} SAR`;

export default function DriverPerformance() {
  const {
    scopedDrivers, scopedCompareGroups, scopedReinforcementRows, scopedAutomaticFuelRows, scopedAttendanceRows,
    lastActivityByDriver, to, setMonthRange, loading,
  } = useDashboard();
  const { t } = useLang();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [month, setMonth] = useState(() => (to || localToday()).slice(0, 7));

  useEffect(() => {
    const { from, to: toVal } = monthBounds(month);
    setMonthRange(from, toVal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const { from, to: toVal } = monthBounds(month);

  // One driver-performance row per driver across every project, then grouped
  // by project — this is the single computation everything else (cards,
  // charts, top consumers) reads from.  Every active driver, plus everyone with
  // activity this month who has left, plus activity under an ID that is not in
  // the drivers list (selectPerfDrivers), so no fuel is missing from the totals.
  const allRows = useMemo(() => {
    const drivers = selectPerfDrivers(scopedDrivers, scopedCompareGroups, scopedReinforcementRows, scopedAutomaticFuelRows, from, toVal,
      { projects: [...PROJECT_LIST, UNLISTED_PROJECT], lastActivityByDriver });
    return buildDriverPerfRows(drivers, scopedCompareGroups, scopedReinforcementRows, scopedAutomaticFuelRows, scopedAttendanceRows, from, toVal);
  }, [scopedDrivers, scopedCompareGroups, scopedReinforcementRows, scopedAutomaticFuelRows, scopedAttendanceRows, lastActivityByDriver, from, toVal]);

  const projectSummaries = useMemo(() => {
    const unlisted = allRows.filter(r => r.project === UNLISTED_PROJECT);
    return [...PROJECT_LIST, ...(unlisted.length ? [UNLISTED_PROJECT] : [])].map(p => ({
      project: p,
      rows: allRows.filter(r => r.project === p),
    })).map(({ project, rows }) => ({ project, ...buildProjectSummary(rows) }));
  }, [allRows]);
  const projectLabel = (p) => (p === UNLISTED_PROJECT ? t("driverPerformance.notInList") : p);

  const totalFuelAllProjects = projectSummaries.reduce((s, p) => s + p.totalFuel, 0);

  function goToProject(project) {
    if (project === UNLISTED_PROJECT) return;
    navigate({ pathname: `/driver-performance/${project}`, search: searchParams.toString() });
  }

  const topDrivers = useMemo(() => topN(allRows, "totalFuel", 5), [allRows]);

  return (
    <>
      <HeroPortal target="fx-hero-actions" className="content-header">
        <div>
          <div className="breadcrumb">{t("common.dashboard")} &gt; <b>{t("driverPerformance.breadcrumb")}</b></div>
          <h1 className="page-title">{t("driverPerformance.breadcrumb")}</h1>
        </div>
      </HeroPortal>
      <HeroPortal target="fx-hero-note" className="fx-hero-note">
        {t("driverPerformance.subtitle")}
      </HeroPortal>

      <HeroPortal className="pill-bar">
        <MonthPicker month={month} onChange={setMonth} />
      </HeroPortal>

      {/* one clickable card per project, each with the 7 established KPIs */}
      <div className="cards-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
        {projectSummaries.map(s => (
          <div key={s.project} className="panel driver-perf-card" style={{ cursor: s.project === UNLISTED_PROJECT ? "default" : "pointer" }} onClick={() => goToProject(s.project)}>
            <div className="ov-block-head">
              <div>
                <h3>{s.project === UNLISTED_PROJECT ? t("driverPerformance.notInList") : <ProjectBadge project={s.project} />}</h3>
                <span className="ov-block-sub">{t(s.project === UNLISTED_PROJECT ? "driverPerformance.notInListHint" : "driverPerformance.viewDetails")}</span>
              </div>
            </div>
            {loading && !s.activeDrivers ? (
              <div className="ov-empty">{t("common.loading")}</div>
            ) : !s.activeDrivers ? (
              <div className="ov-empty">{t("driverPerformance.noActiveDrivers")}</div>
            ) : (
              <>
                <div className="compare-field-grid" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
                  <Field label={t("compare.colTotalFuelCost")} val={money(s.totalFuel)} />
                  <Field label={t("driverPerformance.colTotalDistance")} val={`${s.totalDist.toFixed(0)} km`} />
                  <Field label={t("driverPerformance.colTotalDelivered")} val={s.totalDelivered} />
                  <Field label={t("driverPerformance.kpiDrivers")} val={<DriversCount summary={s} />} />
                  <Field label={t("driverPerformance.kpiAvgFuelPerDriver")} val={money(s.avgFuelPerDriver)} />
                  <Field label={t("driverPerformance.kpiAvgFuelPerShipment")} val={money2(s.avgFuelPerShipment)} />
                  <Field label={t("driverPerformance.kpiFuelPerKm")} val={`${s.avgFuelPerKm.toFixed(2)} SAR/km`} />
                </div>
                {s.excludedDays > 0 && (
                  <div className="ov-block-sub" style={{ marginTop: "0.6rem" }}>⚠ {t("driverPerformance.excludedDays", { n: s.excludedDays, max: MAX_JUMP_KM_PER_DAY })}</div>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      <div className="panel-grid" style={{ marginTop: "1.2rem" }}>
        <div className="panel">
          <h3>{t("driverPerformance.chartFuelByProject")}</h3>
          <MetricBarList
            items={projectSummaries.map(s => ({ key: s.project, label: projectLabel(s.project), value: s.totalFuel }))}
            formatValue={money}
            onItemClick={(item) => goToProject(item.key)}
          />
        </div>
        <div className="panel">
          <h3>{t("driverPerformance.chartShipmentsByProject")}</h3>
          <MetricBarList
            items={projectSummaries.map(s => ({ key: s.project, label: projectLabel(s.project), value: s.totalDelivered }))}
            onItemClick={(item) => goToProject(item.key)}
          />
        </div>
        <div className="panel">
          <h3>{t("driverPerformance.chartDistanceByProject")}</h3>
          <MetricBarList
            items={projectSummaries.map(s => ({ key: s.project, label: projectLabel(s.project), value: s.totalDist }))}
            formatValue={(v) => `${v.toFixed(0)} km`}
            onItemClick={(item) => goToProject(item.key)}
          />
        </div>
        <div className="panel">
          <h3>{t("driverPerformance.chartEfficiencyByProject")}</h3>
          <MetricBarList
            items={projectSummaries.map(s => ({ key: s.project, label: projectLabel(s.project), value: s.avgFuelPerKm }))}
            formatValue={(v) => `${v.toFixed(2)} SAR/km`}
            onItemClick={(item) => goToProject(item.key)}
          />
        </div>
        <div className="panel">
          <h3>{t("driverPerformance.topFuelConsumers")}</h3>
          <MetricBarList
            items={topDrivers.map(r => ({ key: r.identity_number, label: perfDriverName(r, t), value: r.totalFuel }))}
            formatValue={money}
            onItemClick={(item) => {
              const row = topDrivers.find(r => r.identity_number === item.key);
              if (row && row.project !== UNLISTED_PROJECT) navigate({ pathname: `/driver-performance/${row.project}/${row.identity_number}`, search: searchParams.toString() });
            }}
          />
        </div>
        <div className="panel">
          <h3>{t("driverPerformance.fuelDistribution")}</h3>
          <MetricBarList
            items={projectSummaries.map(s => ({ key: s.project, label: projectLabel(s.project), value: s.totalFuel }))}
            maxValue={totalFuelAllProjects || 1}
            formatValue={(v) => `${((v / (totalFuelAllProjects || 1)) * 100).toFixed(1)}%`}
            onItemClick={(item) => goToProject(item.key)}
          />
        </div>
      </div>
    </>
  );
}
