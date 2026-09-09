import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useDashboard } from "../contexts/DataContext";
import { useDetailModal } from "../contexts/DetailModalContext";
import { useLang } from "../contexts/LanguageContext";
import { StatusBadge } from "../components/DetailModal";
import GlobalFilters from "../components/GlobalFilters";
import { localToday, compareStatus } from "../lib/calc";

const KPI_COLORS = ["c-blue", "c-green", "c-purple", "c-orange", "c-cyan", "c-pink"];

export default function Overview() {
  const {
    scopedRows: allRows, scopedCompareGroups: allCompareGroups, scopedStationRows: stationRows, scopedDrivers: allDrivers,
    scopedVehicles: allVehicles, stationRates, loading, error, lastUpdated,
  } = useDashboard();
  const { openDetail } = useDetailModal();
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const today = localToday();

  const stats = useMemo(() => {
    const startCount = allRows.filter(r => r.shift_type === "start").length;
    const endCount = allRows.filter(r => r.shift_type === "end").length;
    const drivers = new Set(allRows.map(r => r.identity_number)).size;
    const completedToday = allCompareGroups.filter(g => g.day === today && g.start && g.end).length;
    return [
      { label: t("overview.totalDrivers"), num: allDrivers.length },
      { label: t("overview.totalRecords"), num: allRows.length },
      { label: t("overview.shiftStarts"), num: startCount },
      { label: t("overview.shiftEnds"), num: endCount },
      { label: t("overview.distinctDrivers"), num: drivers },
      { label: t("overview.driversCompletedToday"), num: completedToday },
    ];
  }, [allRows, allCompareGroups, allDrivers, today, t]);

  const quickGlance = useMemo(() => {
    const total = allCompareGroups.length;
    const completedAll = allCompareGroups.filter(g => g.start && g.end).length;
    const incomplete = total - completedAll;
    const rate = total ? Math.round((completedAll / total) * 100) : 0;
    return { total, completedAll, incomplete, rate };
  }, [allCompareGroups]);

  const todayGroups = useMemo(() => allCompareGroups.filter(g => g.day === today), [allCompareGroups, today]);
  const started = todayGroups.filter(g => g.start).length;
  const completed = todayGroups.filter(g => g.start && g.end).length;
  const partial = started - completed;
  const pct = started ? Math.round((completed / started) * 100) : 0;

  const attentionRows = useMemo(() => todayGroups.filter(g => !(g.start && g.end)), [todayGroups]);
  const reviewRows = useMemo(() => allCompareGroups.slice(0, 8), [allCompareGroups]);

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

  function goToRecords(filterPartial) {
    const next = new URLSearchParams(searchParams);
    if (filterPartial) next.set("status", "partial"); else next.delete("status");
    navigate({ pathname: "/records", search: next.toString() });
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

      <div className="kpi-dot-grid">
        <div className="kpi-dot-card"><span className="dot blue" /><div className="label">{t("overview.totalRecords")}</div><div className="num">{quickGlance.total}</div><div className="sub">{t("overview.allAvailableRecords")}</div></div>
        <div className="kpi-dot-card"><span className="dot green" /><div className="label">{t("overview.completedRecords")}</div><div className="num">{quickGlance.completedAll}</div><div className="sub">{t("overview.pctOfTotalRecords", { rate: quickGlance.rate })}</div></div>
        <div className="kpi-dot-card clickable" onClick={() => goToRecords(true)}><span className="dot red" /><div className="label">{t("overview.needsReview")}</div><div className="num">{quickGlance.incomplete}</div><div className="sub">{t("overview.clickToViewCases")}</div></div>
        <div className="kpi-dot-card"><span className="dot orange" /><div className="label">{t("overview.completionRate")}</div><div className="num">{quickGlance.rate}%</div><div className="sub">{t("overview.suggestedTarget")}</div></div>
      </div>

      <div id="stats">
        {stats.map((s, i) => (
          <div key={s.label} className="kpi-card" style={{ background: `var(--${KPI_COLORS[i % KPI_COLORS.length]}-bg)`, color: `var(--${KPI_COLORS[i % KPI_COLORS.length]}-ink)` }}>
            <div className="num">{s.num}</div><div className="label">{s.label}</div>
          </div>
        ))}
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
              <div><h3>{t("overview.attentionTitle")}</h3><span className="ov-block-sub">{t("overview.attentionSub")}</span></div>
              <button className="btn" onClick={() => goToRecords(true)}>{t("overview.viewAll")}</button>
            </div>
            {!attentionRows.length ? (
              <div className="ov-empty">{t("overview.noAttentionCases")}</div>
            ) : attentionRows.map((g, i) => (
              <div key={i} className="ov-row danger" onClick={() => openDetail(g)}>
                <div>
                  <div className="who">{g.full_name}</div>
                  <div className="meta">{g.identity_number}{g.project ? " · " + g.project : ""} · 🚗 {g.vehicle_plate || "—"}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <StatusBadge status={compareStatus(g)} />
                  <button className="ov-row-action" onClick={e => { e.stopPropagation(); openDetail(g); }}>{t("overview.review")}</button>
                </div>
              </div>
            ))}
          </div>
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

        <div className="panel">
          <div className="ov-block-head">
            <div><h3>{t("overview.interactiveReviewTitle")}</h3><span className="ov-block-sub">{t("overview.interactiveReviewSub")}</span></div>
          </div>
          {!reviewRows.length ? (
            <div className="ov-empty">{t("overview.noRecordsYet")}</div>
          ) : reviewRows.map((g, i) => (
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
