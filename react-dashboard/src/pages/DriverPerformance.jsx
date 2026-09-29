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
import {
  DRIVER_PERFORMANCE_PROJECTS, monthBounds, buildDriverPerfRows, buildProjectSummary, topN,
} from "../lib/driverPerformance";

const money = (v) => `${v.toFixed(0)} SAR`;

export default function DriverPerformance() {
  const {
    scopedDrivers, scopedCompareGroups, scopedReinforcementRows, scopedAutomaticFuelRows, scopedAttendanceRows,
    to, setMonthRange,
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

  // One driver-performance row per active driver across all 4 projects, then
  // grouped by project — this is the single computation everything else
  // (cards, charts, top consumers) reads from.
  const allRows = useMemo(() => {
    const drivers = scopedDrivers.filter(d => d.is_active && DRIVER_PERFORMANCE_PROJECTS.includes(d.project));
    return buildDriverPerfRows(drivers, scopedCompareGroups, scopedReinforcementRows, scopedAutomaticFuelRows, scopedAttendanceRows, from, toVal);
  }, [scopedDrivers, scopedCompareGroups, scopedReinforcementRows, scopedAutomaticFuelRows, scopedAttendanceRows, from, toVal]);

  const projectSummaries = useMemo(() => {
    return DRIVER_PERFORMANCE_PROJECTS.map(p => ({
      project: p,
      rows: allRows.filter(r => r.project === p),
    })).map(({ project, rows }) => ({ project, ...buildProjectSummary(rows) }));
  }, [allRows]);

  const totalFuelAllProjects = projectSummaries.reduce((s, p) => s + p.totalFuel, 0);

  function goToProject(project) {
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

      {/* 4 clickable project cards, each with the 7 established KPIs */}
      <div className="cards-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
        {projectSummaries.map(s => (
          <div key={s.project} className="panel driver-perf-card" style={{ cursor: "pointer" }} onClick={() => goToProject(s.project)}>
            <div className="ov-block-head">
              <div>
                <h3><ProjectBadge project={s.project} /></h3>
                <span className="ov-block-sub">{t("driverPerformance.viewDetails")}</span>
              </div>
            </div>
            <div className="compare-field-grid" style={{ gridTemplateColumns: "repeat(2, 1fr)" }}>
              <Field label={t("compare.colTotalFuelCost")} val={money(s.totalFuel)} />
              <Field label={t("driverPerformance.colTotalDistance")} val={`${s.totalDist.toFixed(0)} km`} />
              <Field label={t("driverPerformance.colTotalDelivered")} val={s.totalDelivered} />
              <Field label={t("driverPerformance.kpiDrivers")} val={s.activeDrivers} />
              <Field label={t("driverPerformance.kpiAvgFuelPerDriver")} val={money(s.avgFuelPerDriver)} />
              <Field label={t("driverPerformance.kpiAvgFuelPerShipment")} val={money(s.avgFuelPerShipment)} />
              <Field label={t("driverPerformance.kpiFuelPerKm")} val={money(s.avgFuelPerKm)} />
            </div>
          </div>
        ))}
      </div>

      <div className="panel-grid" style={{ marginTop: "1.2rem" }}>
        <div className="panel">
          <h3>{t("driverPerformance.chartFuelByProject")}</h3>
          <MetricBarList
            items={projectSummaries.map(s => ({ key: s.project, label: s.project, value: s.totalFuel }))}
            formatValue={money}
            onItemClick={(item) => goToProject(item.key)}
          />
        </div>
        <div className="panel">
          <h3>{t("driverPerformance.chartShipmentsByProject")}</h3>
          <MetricBarList
            items={projectSummaries.map(s => ({ key: s.project, label: s.project, value: s.totalDelivered }))}
            onItemClick={(item) => goToProject(item.key)}
          />
        </div>
        <div className="panel">
          <h3>{t("driverPerformance.chartDistanceByProject")}</h3>
          <MetricBarList
            items={projectSummaries.map(s => ({ key: s.project, label: s.project, value: s.totalDist }))}
            formatValue={(v) => `${v.toFixed(0)} km`}
            onItemClick={(item) => goToProject(item.key)}
          />
        </div>
        <div className="panel">
          <h3>{t("driverPerformance.chartEfficiencyByProject")}</h3>
          <MetricBarList
            items={projectSummaries.map(s => ({ key: s.project, label: s.project, value: s.avgFuelPerKm }))}
            formatValue={(v) => `${v.toFixed(2)} SAR/km`}
            onItemClick={(item) => goToProject(item.key)}
          />
        </div>
        <div className="panel">
          <h3>{t("driverPerformance.topFuelConsumers")}</h3>
          <MetricBarList
            items={topDrivers.map(r => ({ key: r.identity_number, label: r.full_name, value: r.totalFuel }))}
            formatValue={money}
            onItemClick={(item) => {
              const row = topDrivers.find(r => r.identity_number === item.key);
              if (row) navigate({ pathname: `/driver-performance/${row.project}/${row.identity_number}`, search: searchParams.toString() });
            }}
          />
        </div>
        <div className="panel">
          <h3>{t("driverPerformance.fuelDistribution")}</h3>
          <MetricBarList
            items={projectSummaries.map(s => ({ key: s.project, label: s.project, value: s.totalFuel }))}
            maxValue={totalFuelAllProjects || 1}
            formatValue={(v) => `${((v / (totalFuelAllProjects || 1)) * 100).toFixed(1)}%`}
            onItemClick={(item) => goToProject(item.key)}
          />
        </div>
      </div>
    </>
  );
}
