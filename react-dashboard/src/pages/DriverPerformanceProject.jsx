import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams, Navigate } from "react-router-dom";
import { useDashboard } from "../contexts/DataContext";
import { useLang } from "../contexts/LanguageContext";
import Field from "../components/Field";
import MonthPicker from "../components/MonthPicker";
import MetricBarList from "../components/MetricBarList";
import DataTable from "../components/DataTable";
import HeroPortal from "../components/HeroPortal";
import { localToday } from "../lib/calc";
import {
  DRIVER_PERFORMANCE_PROJECTS, monthBounds, formatMonthLabel, buildDriverPerfRows, buildProjectSummary, topN,
} from "../lib/driverPerformance";

const money = (v) => `${v.toFixed(0)} SAR`;

export default function DriverPerformanceProject() {
  const { project } = useParams();
  const {
    scopedDrivers, scopedCompareGroups, scopedReinforcementRows, scopedAutomaticFuelRows, scopedAttendanceRows,
    to, setMonthRange,
  } = useDashboard();
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [month, setMonth] = useState(() => (to || localToday()).slice(0, 7));

  useEffect(() => {
    const { from, to: toVal } = monthBounds(month);
    setMonthRange(from, toVal);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const { from, to: toVal } = monthBounds(month);

  const rows = useMemo(() => {
    const drivers = scopedDrivers.filter(d => d.is_active && d.project === project);
    return buildDriverPerfRows(drivers, scopedCompareGroups, scopedReinforcementRows, scopedAutomaticFuelRows, scopedAttendanceRows, from, toVal);
  }, [scopedDrivers, scopedCompareGroups, scopedReinforcementRows, scopedAutomaticFuelRows, scopedAttendanceRows, project, from, toVal]);

  const summary = useMemo(() => buildProjectSummary(rows), [rows]);
  const totalFuel = summary.totalFuel || 1;
  const topDrivers = useMemo(() => topN(rows, "totalFuel", 5), [rows]);

  const columns = useMemo(() => [
    { accessorKey: "full_name", header: t("driverPerformance.colDriver") },
    { accessorKey: "identity_number", header: t("compare.colIdNumber") },
    { accessorKey: "totalFuel", header: t("compare.colTotalFuelCost"), meta: { align: "end" }, cell: ({ getValue }) => money(getValue()) },
    { accessorKey: "totalDist", header: t("driverPerformance.colTotalDistance"), meta: { align: "end" }, cell: ({ getValue }) => getValue().toFixed(0) },
    { accessorKey: "totalDelivered", header: t("driverPerformance.colTotalDelivered"), meta: { align: "end" } },
    { accessorKey: "fuelPerKm", header: t("driverPerformance.colFuelPerKm"), meta: { align: "end" }, cell: ({ getValue }) => getValue().toFixed(2) },
    { accessorKey: "fuelPerShipment", header: t("driverPerformance.colFuelPerShipment"), meta: { align: "end" }, cell: ({ getValue }) => getValue().toFixed(2) },
    { accessorKey: "avgKmPerDay", header: t("driverPerformance.colAvgKmPerDay"), meta: { align: "end" }, cell: ({ getValue }) => getValue().toFixed(1) },
    { accessorKey: "daysOff", header: t("driverPerformance.colDaysOff"), meta: { align: "end" }, cell: ({ getValue }) => <span className={"badge " + (getValue() > 0 ? "critical" : "complete")}>{getValue()}</span> },
  ], [t]);

  function goToDriver(row) {
    navigate({ pathname: `/driver-performance/${project}/${row.identity_number}`, search: searchParams.toString() });
  }

  if (!DRIVER_PERFORMANCE_PROJECTS.includes(project)) {
    return <Navigate to="/driver-performance" replace />;
  }

  return (
    <>
      {/* Not portaled into the hero: these dynamic /:project pages aren't in
          the nav list, so the shared hero title falls back to a generic
          label — show the real title inline in the page body instead. */}
      <div className="content-header">
        <div>
          <div className="breadcrumb">
            <span className="badge-link" onClick={() => navigate({ pathname: "/driver-performance", search: searchParams.toString() })}>{t("driverPerformance.backToOverview")}</span>
            {" > "}<b>{project}</b>
          </div>
          <h1 className="page-title">{t("driverPerformance.projectMonthly", { project, month: formatMonthLabel(month, lang) })}</h1>
        </div>
      </div>
      <HeroPortal className="pill-bar">
        <MonthPicker month={month} onChange={setMonth} />
      </HeroPortal>

      {!rows.length ? (
        <div className="ov-empty">{t("driverPerformance.noDataForMonth")}</div>
      ) : (
        <>
          <div className="panel">
            <div className="compare-field-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
              <Field label={t("compare.colTotalFuelCost")} val={money(summary.totalFuel)} />
              <Field label={t("driverPerformance.colTotalDistance")} val={`${summary.totalDist.toFixed(0)} km`} />
              <Field label={t("driverPerformance.colTotalDelivered")} val={summary.totalDelivered} />
              <Field label={t("driverPerformance.kpiDrivers")} val={summary.activeDrivers} />
              <Field label={t("driverPerformance.kpiAvgFuelPerDriver")} val={money(summary.avgFuelPerDriver)} />
              <Field label={t("driverPerformance.kpiAvgFuelPerShipment")} val={money(summary.avgFuelPerShipment)} />
              <Field label={t("driverPerformance.kpiFuelPerKm")} val={`${summary.avgFuelPerKm.toFixed(2)} SAR/km`} />
            </div>
          </div>

          <div className="panel-grid" style={{ marginTop: "1.2rem", marginBottom: "1.2rem" }}>
            <div className="panel">
              <h3>{t("driverPerformance.topFuelConsumers")}</h3>
              <MetricBarList
                items={topDrivers.map(r => ({ key: r.identity_number, label: r.full_name, value: r.totalFuel }))}
                formatValue={money}
                onItemClick={(item) => goToDriver({ identity_number: item.key })}
              />
            </div>
            <div className="panel">
              <h3>{t("driverPerformance.driverFuelDistribution")}</h3>
              <MetricBarList
                items={rows.map(r => ({ key: r.identity_number, label: r.full_name, value: r.totalFuel }))}
                maxValue={totalFuel}
                formatValue={(v) => `${((v / totalFuel) * 100).toFixed(1)}%`}
                onItemClick={(item) => goToDriver({ identity_number: item.key })}
              />
            </div>
          </div>

          <DataTable columns={columns} data={rows} onRowClick={goToDriver} emptyMessage={t("driverPerformance.noMatchingDrivers")} />
        </>
      )}
    </>
  );
}
