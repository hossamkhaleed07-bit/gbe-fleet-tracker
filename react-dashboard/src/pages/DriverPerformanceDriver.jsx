import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useDashboard } from "../contexts/DataContext";
import { useLang } from "../contexts/LanguageContext";
import Field from "../components/Field";
import MonthPicker from "../components/MonthPicker";
import DataTable from "../components/DataTable";
import HeroPortal from "../components/HeroPortal";
import { localToday } from "../lib/calc";
import {
  monthBounds, formatMonthLabel, buildDriverPerfRows, buildDriverDailyRows, attachDailyFuel,
} from "../lib/driverPerformance";

const money = (v) => `${v.toFixed(0)} SAR`;

export default function DriverPerformanceDriver() {
  const { project, identityNumber } = useParams();
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

  const driver = useMemo(
    () => scopedDrivers.find(d => d.identity_number === identityNumber),
    [scopedDrivers, identityNumber]
  );

  const summary = useMemo(() => {
    const drivers = driver ? [driver] : [{ identity_number: identityNumber, full_name: identityNumber, project }];
    const rows = buildDriverPerfRows(drivers, scopedCompareGroups, scopedReinforcementRows, scopedAutomaticFuelRows, scopedAttendanceRows, from, toVal);
    return rows[0];
  }, [driver, identityNumber, project, scopedCompareGroups, scopedReinforcementRows, scopedAutomaticFuelRows, scopedAttendanceRows, from, toVal]);

  const dailyRows = useMemo(() => {
    const base = buildDriverDailyRows(scopedCompareGroups, identityNumber, from, toVal);
    return attachDailyFuel(base, identityNumber, scopedReinforcementRows, scopedAutomaticFuelRows);
  }, [scopedCompareGroups, identityNumber, from, toVal, scopedReinforcementRows, scopedAutomaticFuelRows]);

  const columns = useMemo(() => [
    { accessorKey: "day", header: t("compare.colDate") },
    { accessorKey: "startOdo", header: t("common.startOdometer"), meta: { align: "end" }, cell: ({ getValue }) => getValue() ?? "—" },
    { accessorKey: "endOdo", header: t("common.endOdometer"), meta: { align: "end" }, cell: ({ getValue }) => getValue() ?? "—" },
    { accessorKey: "dist", header: t("compare.colDistanceCovered"), meta: { align: "end" }, cell: ({ getValue }) => getValue().toFixed(0) },
    { accessorKey: "fuel", header: t("driverPerformance.colFuel"), meta: { align: "end" }, cell: ({ getValue }) => money(getValue()) },
    { accessorKey: "delivered", header: t("driverPerformance.colTotalDelivered"), meta: { align: "end" } },
    { accessorKey: "fuelPerKm", header: t("driverPerformance.colFuelPerKm"), meta: { align: "end" }, cell: ({ getValue }) => getValue().toFixed(2) },
  ], [t]);

  return (
    <>
      {/* Not portaled into the hero — see the same note in DriverPerformanceProject.jsx */}
      <div className="content-header">
        <div>
          <div className="breadcrumb">
            <span className="badge-link" onClick={() => navigate({ pathname: "/driver-performance", search: searchParams.toString() })}>{t("driverPerformance.backToOverview")}</span>
            {" > "}
            <span className="badge-link" onClick={() => navigate({ pathname: `/driver-performance/${project}`, search: searchParams.toString() })}>{project}</span>
            {" > "}<b>{driver?.full_name || identityNumber}</b>
          </div>
          <h1 className="page-title">{driver?.full_name || identityNumber}</h1>
        </div>
      </div>
      <HeroPortal className="pill-bar">
        <MonthPicker month={month} onChange={setMonth} />
      </HeroPortal>

      {!dailyRows.length ? (
        <div className="ov-empty">{t("driverPerformance.noDataForMonth")}</div>
      ) : (
        <>
          <div className="panel" style={{ marginBottom: "1.2rem" }}>
            <h3>{t("driverPerformance.driverSummary")} — {formatMonthLabel(month, lang)}</h3>
            <div className="compare-field-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
              <Field label={t("compare.colTotalFuelCost")} val={money(summary.totalFuel)} />
              <Field label={t("driverPerformance.colTotalDistance")} val={`${summary.totalDist.toFixed(0)} km`} />
              <Field label={t("driverPerformance.colTotalDelivered")} val={summary.totalDelivered} />
              <Field label={t("driverPerformance.colWorkingDays")} val={summary.workingDays} />
              <Field label={t("driverPerformance.kpiFuelPerKm")} val={`${summary.fuelPerKm.toFixed(2)} SAR/km`} />
              <Field label={t("driverPerformance.colFuelPerShipment")} val={`${summary.fuelPerShipment.toFixed(2)} SAR`} />
              <Field label={t("driverPerformance.colAvgKmPerDay")} val={`${summary.avgKmPerDay.toFixed(1)} km`} />
              <Field label={t("driverPerformance.colDaysOff")} val={<span className={"badge " + (summary.daysOff > 0 ? "critical" : "complete")}>{summary.daysOff}</span>} />
            </div>
          </div>

          <h3 style={{ marginBottom: "0.7rem" }}>{t("driverPerformance.dailyBreakdown")}</h3>
          <DataTable columns={columns} data={dailyRows} emptyMessage={t("driverPerformance.noDataForMonth")} />
        </>
      )}
    </>
  );
}
