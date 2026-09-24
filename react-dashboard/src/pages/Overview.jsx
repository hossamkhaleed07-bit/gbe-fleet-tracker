import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useDashboard } from "../contexts/DataContext";
import { useDetailModal } from "../contexts/DetailModalContext";
import { useLang } from "../contexts/LanguageContext";
import { StatusBadge } from "../components/DetailModal";
import GlobalFilters from "../components/GlobalFilters";
import FuelTrendChart from "../components/FuelTrendChart";
import DriverPerformanceTable from "../components/DriverPerformanceTable";
import { localToday, compareStatus } from "../lib/calc";
import { LEAVE_CODES, ABSENT_CODES, OFF_CODES } from "../lib/attendanceCodes";

export default function Overview() {
  const {
    scopedRows: allRows, scopedCompareGroups: allCompareGroups, scopedStationRows: stationRows, scopedDrivers: allDrivers,
    scopedVehicles: allVehicles, scopedReinforcementRows, scopedReinforcementSummary, scopedAutomaticFuelRows, scopedAutomaticFuelTotal,
    scopedAttendanceRows, stationRates, loading, error, lastUpdated,
  } = useDashboard();
  const { openDetail } = useDetailModal();
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const today = localToday();

  const activeDrivers = useMemo(() => allDrivers.filter(d => d.is_active), [allDrivers]);

  const todayGroups = useMemo(() => allCompareGroups.filter(g => g.day === today), [allCompareGroups, today]);
  const started = todayGroups.filter(g => g.start).length;
  const completed = todayGroups.filter(g => g.start && g.end).length;
  const partial = started - completed;
  const pct = started ? Math.round((completed / started) * 100) : 0;

  // "Today" numbers are always pinned to the real current date, independent
  // of whatever date range is selected via GlobalFilters — matches the
  // explicit "Today's Operations" spec (always today, not the active filter).
  const todayAttendanceRows = useMemo(() => scopedAttendanceRows.filter(r => r.attendance_date === today), [scopedAttendanceRows, today]);
  const todayLeaveCount = useMemo(() => new Set(todayAttendanceRows.filter(r => LEAVE_CODES.has(r.status)).map(r => r.identity_number)).size, [todayAttendanceRows]);
  const todayAbsentCount = useMemo(() => new Set(todayAttendanceRows.filter(r => ABSENT_CODES.has(r.status)).map(r => r.identity_number)).size, [todayAttendanceRows]);
  const todayPresentCount = Math.max(0, activeDrivers.length - todayLeaveCount - todayAbsentCount);

  const driversWithFormTodaySet = useMemo(() => new Set(todayGroups.map(g => g.identity_number)), [todayGroups]);
  const missingFormsToday = useMemo(() => activeDrivers.filter(d => !driversWithFormTodaySet.has(d.identity_number)), [activeDrivers, driversWithFormTodaySet]);

  const todayStartSet = useMemo(() => new Set(allRows.filter(r => r.shift_type === "start" && r.shift_date === today).map(r => r.identity_number)), [allRows, today]);
  const driversWithoutStartToday = useMemo(() => activeDrivers.filter(d => !todayStartSet.has(d.identity_number)), [activeDrivers, todayStartSet]);

  const todayReinforcement = useMemo(() => scopedReinforcementRows.filter(r => r.shift_date === today), [scopedReinforcementRows, today]);
  const todayPendingCount = todayReinforcement.filter(r => r.status === "pending").length;

  // Attendance conflict = a (non-rejected) reinforcement request landing on a
  // day the same driver was marked leave/absent — scoped to whatever range/
  // project is currently active, unlike the sidebar's always-global badge.
  const conflictCount = useMemo(() => {
    const nonPresentSet = new Set(
      scopedAttendanceRows.filter(r => OFF_CODES.has(r.status)).map(r => `${r.identity_number}|${r.attendance_date}`)
    );
    return scopedReinforcementRows.filter(r => r.status !== "rejected" && nonPresentSet.has(`${r.identity_number}|${r.shift_date}`)).length;
  }, [scopedAttendanceRows, scopedReinforcementRows]);

  const rangeAttendance = useMemo(() => {
    const leave = scopedAttendanceRows.filter(r => LEAVE_CODES.has(r.status)).length;
    const absent = scopedAttendanceRows.filter(r => ABSENT_CODES.has(r.status)).length;
    return { leave, absent };
  }, [scopedAttendanceRows]);

  const avgReinforcementPerDriver = useMemo(() => {
    const driversWithApproved = new Set(scopedReinforcementRows.filter(r => r.status === "approved").map(r => r.identity_number));
    return driversWithApproved.size ? (scopedReinforcementSummary.totalCost / driversWithApproved.size) : 0;
  }, [scopedReinforcementRows, scopedReinforcementSummary]);

  const totalFuelCost = scopedAutomaticFuelTotal + scopedReinforcementSummary.totalCost;

  const stationTotal = stationRows.reduce((a, g) => a + g.total, 0) || 1;
  const topStations = stationRows.slice(0, 5);

  const systemIssues = useMemo(() => {
    const vehiclesNoRate = allVehicles.filter(v => v.is_active && v.avg_per_liter == null);
    const driversNoVehicle = allDrivers.filter(d => d.is_active && !d.assigned_vehicle_plate);
    const stationsNoRate = stationRows.filter(s => {
      const r = stationRates[s.station];
      return !r || (r.cod === 0 && r.ppd === 0 && r.pickup === 0);
    });
    return { vehiclesNoRate, driversNoVehicle, stationsNoRate };
  }, [allVehicles, allDrivers, stationRows, stationRates]);

  const totalSystemIssues = systemIssues.vehiclesNoRate.length + systemIssues.driversNoVehicle.length + systemIssues.stationsNoRate.length;

  function goTo(pathname, params) {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(params || {})) {
      if (v === undefined || v === null || v === "") next.delete(k); else next.set(k, v);
    }
    navigate({ pathname, search: next.toString() });
  }

  function goToRecords(filterPartial) {
    goTo("/records", { status: filterPartial ? "partial" : undefined });
  }

  function goToRecordsToday(status) {
    goTo("/records", { status, from: today, to: today });
  }

  function goToAttendanceToday(status) {
    goTo("/attendance", { status, date: today });
  }

  return (
    <>
      <div className="content-header">
        <div>
          <div className="breadcrumb">{t("common.dashboard")} &gt; <b>{t("overview.breadcrumb")}</b></div>
          <h1 className="page-title">{t("overview.breadcrumb")}</h1>
        </div>
      </div>
      <div id="status-msg" className={error ? "err" : ""} style={{ display: error ? "block" : "none" }}>{error}</div>
      <GlobalFilters />

      <div className="ov-updated-row">
        <span className="ov-updated-badge">
          {loading ? t("common.loading") : lastUpdated ? t("overview.lastUpdatedPrefix") + lastUpdated.toLocaleTimeString(lang === "ar" ? "ar-EG" : "en-US", { hour: "2-digit", minute: "2-digit" }) : ""}
        </span>
      </div>

      {/* Level 1 — what is happening right now (always today) */}
      <div className="ov-section-title">{t("overview.todaysOpsTitle")}</div>
      <div className="kpi-dot-grid kpi-dot-grid-6">
        <div className="kpi-dot-card clickable" onClick={() => navigate({ pathname: "/drivers", search: searchParams.toString() })}>
          <span className="dot blue" /><div className="label">{t("overview.kpiDrivers")}</div><div className="num">{activeDrivers.length}</div>
        </div>
        <div className="kpi-dot-card clickable" onClick={() => goToAttendanceToday("present")}>
          <span className="dot green" /><div className="label">{t("attendance.present")}</div><div className="num">{todayPresentCount}</div>
        </div>
        <div className="kpi-dot-card clickable" onClick={() => goToAttendanceToday("leave")}>
          <span className="dot orange" /><div className="label">{t("attendance.leave")}</div><div className="num">{todayLeaveCount}</div>
        </div>
        <div className="kpi-dot-card clickable" onClick={() => goToAttendanceToday("absent")}>
          <span className="dot red" /><div className="label">{t("attendance.absent")}</div><div className="num">{todayAbsentCount}</div>
        </div>
        <div className="kpi-dot-card clickable" onClick={() => goToRecordsToday("incomplete_or_missing")}>
          <span className="dot orange" /><div className="label">{t("overview.kpiMissingForms")}</div><div className="num">{missingFormsToday.length}</div>
        </div>
        <div className="kpi-dot-card clickable" onClick={() => navigate({ pathname: "/fuel-approver", search: searchParams.toString() })}>
          <span className="dot purple" /><div className="label">{t("overview.kpiPendingRequests")}</div><div className="num">{todayPendingCount}</div>
        </div>
      </div>

      {/* Level 2 — what requires action */}
      <div className="ov-section-title">{t("overview.actionRequiredTitle")}</div>
      <div className="panel">
        {!(todayPendingCount || missingFormsToday.length || conflictCount || driversWithoutStartToday.length) ? (
          <div className="ov-empty">{t("overview.noActionRequired")}</div>
        ) : (
          <>
            {todayPendingCount > 0 && (
              <div className="ov-row danger" onClick={() => navigate({ pathname: "/fuel-approver", search: searchParams.toString() })}>
                <div><span className="ov-alert-dot red" />{t("overview.alertPendingReinforcement", { n: todayPendingCount })}</div>
              </div>
            )}
            {missingFormsToday.length > 0 && (
              <div className="ov-row danger" onClick={() => goToRecordsToday("incomplete_or_missing")}>
                <div><span className="ov-alert-dot orange" />{t("overview.alertMissingForms", { n: missingFormsToday.length })}</div>
              </div>
            )}
            {conflictCount > 0 && (
              <div className="ov-row danger" onClick={() => navigate({ pathname: "/fuel-approval", search: searchParams.toString() })}>
                <div><span className="ov-alert-dot yellow" />{t("overview.alertAttendanceConflicts", { n: conflictCount })}</div>
              </div>
            )}
            {driversWithoutStartToday.length > 0 && (
              <div className="ov-row danger" onClick={() => goToRecordsToday("incomplete_or_missing")}>
                <div><span className="ov-alert-dot blue" />{t("overview.alertNoStartForm", { n: driversWithoutStartToday.length })}</div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Level 3 — money / fuel, respects the selected date range */}
      <div className="ov-section-title">{t("overview.fuelOverviewTitle")}</div>
      <div className="kpi-dot-grid">
        <div className="kpi-dot-card clickable" onClick={() => navigate({ pathname: "/automatic-fuel", search: searchParams.toString() })}>
          <span className="dot cyan" /><div className="label">{t("compare.colAutomaticFuelCost")}</div><div className="num">{t("fuel.amountPrefix")} {scopedAutomaticFuelTotal.toFixed(0)}</div>
        </div>
        <div className="kpi-dot-card clickable" onClick={() => goTo("/fuel-approval", { status: "approved" })}>
          <span className="dot green" /><div className="label">{t("compare.colActualFuelCost")}</div><div className="num">{t("fuel.amountPrefix")} {scopedReinforcementSummary.totalCost.toFixed(0)}</div>
        </div>
        <div className="kpi-dot-card clickable" onClick={() => navigate({ pathname: "/fuel-approval", search: searchParams.toString() })}>
          <span className="dot blue" /><div className="label">{t("compare.colTotalFuelCost")}</div><div className="num">{t("fuel.amountPrefix")} {totalFuelCost.toFixed(0)}</div>
        </div>
      </div>

      {/* Level 3 — reinforcement request workflow, respects the selected date range */}
      <div className="ov-section-title">{t("overview.reinforcementOverviewTitle")}</div>
      <div className="kpi-dot-grid">
        <div className="kpi-dot-card clickable" onClick={() => navigate({ pathname: "/fuel-approver", search: searchParams.toString() })}>
          <span className="dot purple" /><div className="label">{t("fuel.statusPending")}</div><div className="num">{scopedReinforcementSummary.pending}</div>
        </div>
        <div className="kpi-dot-card clickable" onClick={() => goTo("/fuel-approval", { status: "approved" })}>
          <span className="dot green" /><div className="label">{t("fuel.statusApproved")}</div><div className="num">{scopedReinforcementSummary.approved}</div>
        </div>
        <div className="kpi-dot-card clickable" onClick={() => goTo("/fuel-approval", { status: "rejected" })}>
          <span className="dot red" /><div className="label">{t("fuel.statusRejected")}</div><div className="num">{scopedReinforcementSummary.rejected}</div>
        </div>
        <div className="kpi-dot-card clickable" onClick={() => goTo("/fuel-approval", { status: "" })}>
          <span className="dot blue" /><div className="label">{t("overview.kpiTotalRequests")}</div><div className="num">{scopedReinforcementSummary.total}</div>
        </div>
        <div className="kpi-dot-card no-dot">
          <div className="label">{t("overview.kpiAvgReinforcement")}</div><div className="num">{t("fuel.amountPrefix")} {avgReinforcementPerDriver.toFixed(0)}</div>
        </div>
      </div>

      {/* Level 3 — attendance breakdown for today (drill-down needs one concrete date) */}
      <div className="ov-section-title">{t("overview.attendanceOverviewTitle")}</div>
      <div className="kpi-dot-grid">
        <div className="kpi-dot-card clickable" onClick={() => goToAttendanceToday("present")}>
          <span className="dot green" /><div className="label">{t("attendance.present")}</div><div className="num">{todayPresentCount}</div>
        </div>
        <div className="kpi-dot-card clickable" onClick={() => goToAttendanceToday("leave")}>
          <span className="dot orange" /><div className="label">{t("attendance.leave")}</div><div className="num">{todayLeaveCount}</div>
        </div>
        <div className="kpi-dot-card clickable" onClick={() => goToAttendanceToday("absent")}>
          <span className="dot red" /><div className="label">{t("attendance.absent")}</div><div className="num">{todayAbsentCount}</div>
        </div>
        <div className="kpi-dot-card no-dot">
          <div className="label">{t("overview.kpiRangeAttendanceMarks")}</div><div className="num">{rangeAttendance.leave + rangeAttendance.absent}</div>
          <div className="sub">{t("overview.kpiRangeAttendanceSub")}</div>
        </div>
      </div>

      <div className="ov-stack">
        <div className="panel-grid">
          <div className="panel">
            <div className="ov-block-head">
              <div><h3>{t("overview.formTrackingTitle")}</h3><span className="ov-block-sub">{t("overview.formTrackingSub")}</span></div>
              <button className="btn btn-primary" style={{ width: "auto" }} onClick={() => goToRecords(false)}>{t("overview.openRecords")}</button>
            </div>
            <div className="panel-summary">
              <div><div className="n">{completed}</div><div className="l">{t("overview.completedLabel")}</div></div>
              <div><div className="n">{started}</div><div className="l">{t("overview.totalStartedTodayLabel")}</div></div>
              <div><div className="n">{partial}</div><div className="l">{t("overview.stillIncompleteLabel")}</div></div>
            </div>
            <div className="bar-track"><div className="bar-fill" style={{ width: pct + "%" }}></div></div>
          </div>
          <div className="panel">
            <div className="ov-block-head">
              <div><h3>{t("overview.systemIssuesTitle")}</h3><span className="ov-block-sub">{t("overview.systemIssuesSub")}</span></div>
            </div>
            {!totalSystemIssues ? (
              <div className="ov-empty">{t("overview.noSystemIssues")}</div>
            ) : (
              <>
                {systemIssues.vehiclesNoRate.length > 0 && (
                  <div className="ov-row danger" onClick={() => navigate({ pathname: "/fleet", search: searchParams.toString() })}>
                    <div>
                      <div className="who">{t("overview.vehiclesNoRate")}</div>
                      <div className="meta">{systemIssues.vehiclesNoRate.slice(0, 4).map(v => v.vehicle_plate).join(" · ")}{systemIssues.vehiclesNoRate.length > 4 ? " ..." : ""}</div>
                    </div>
                    <span className="badge partial">{systemIssues.vehiclesNoRate.length}</span>
                  </div>
                )}
                {systemIssues.driversNoVehicle.length > 0 && (
                  <div className="ov-row danger" onClick={() => navigate({ pathname: "/drivers", search: searchParams.toString() })}>
                    <div>
                      <div className="who">{t("overview.driversNoVehicle")}</div>
                      <div className="meta">{systemIssues.driversNoVehicle.slice(0, 4).map(d => d.full_name).join(" · ")}{systemIssues.driversNoVehicle.length > 4 ? " ..." : ""}</div>
                    </div>
                    <span className="badge partial">{systemIssues.driversNoVehicle.length}</span>
                  </div>
                )}
                {systemIssues.stationsNoRate.length > 0 && (
                  <div className="ov-row danger" onClick={() => navigate({ pathname: "/stations", search: searchParams.toString() })}>
                    <div>
                      <div className="who">{t("overview.stationsNoRate")}</div>
                      <div className="meta">{systemIssues.stationsNoRate.slice(0, 4).map(s => s.station).join(" · ")}{systemIssues.stationsNoRate.length > 4 ? " ..." : ""}</div>
                    </div>
                    <span className="badge partial">{systemIssues.stationsNoRate.length}</span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <FuelTrendChart reinforcementRows={scopedReinforcementRows} automaticFuelRows={scopedAutomaticFuelRows} />

        <div className="panel">
          <h3>{t("overview.distributionByStation")}</h3>
          {!topStations.length ? <p className="sub" style={{ margin: 0 }}>{t("overview.noData")}</p> : topStations.map((g, i) => {
            const pct2 = Math.round((g.total / stationTotal) * 100);
            return (
              <div key={g.station} className="bar-row">
                <div className="bar-row-top"><span>{g.station}</span><span className="cnt">{g.total} / {stationTotal}</span></div>
                <div className="bar-track"><div className={`bar-fill region-bar-${(i % 5) + 1}`} style={{ width: pct2 + "%" }}></div></div>
                <div className="bar-row-pct">{pct2}%</div>
              </div>
            );
          })}
        </div>

        <DriverPerformanceTable
          drivers={allDrivers}
          compareGroups={allCompareGroups}
          reinforcementRows={scopedReinforcementRows}
          automaticFuelRows={scopedAutomaticFuelRows}
        />

        <div className="panel">
          <div className="ov-block-head">
            <div><h3>{t("overview.interactiveReviewTitle")}</h3><span className="ov-block-sub">{t("overview.interactiveReviewSub")}</span></div>
          </div>
          {!allCompareGroups.length ? (
            <div className="ov-empty">{t("overview.noRecordsYet")}</div>
          ) : allCompareGroups.slice(0, 8).map((g, i) => (
            <div key={i} className="ov-row" onClick={() => openDetail(g)}>
              <div>
                <div className="who">{g.full_name}</div>
                <div className="meta">{g.identity_number} · {g.day}{g.project ? " · " + g.project : ""} · 🚗 {g.vehicle_plate || "—"}</div>
              </div>
              <StatusBadge status={compareStatus(g)} />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
