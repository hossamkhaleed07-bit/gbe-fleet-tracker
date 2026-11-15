import { useLang } from "../contexts/LanguageContext";
import { isFuelDiffHigh, MIN_MEASURED_COVERAGE, MIN_MEASURED_KM } from "../lib/driverPerformance";

// Actual − Expected fuel, in SAR and %, for a driver row or a project summary
// (data: fuelDiff, fuelDiffPct, enoughData, coverage, measuredKm).
// - "—" when nothing is expected (no measured day)
// - grey "Not enough data" when too little of the month was measured; the
//   numbers are still in the tooltip
// - red when more than FUEL_DIFF_ALERT_PCT above expected
export default function FuelDiff({ data, show = "both" }) {
  const { t } = useLang();
  const { fuelDiff: diff, fuelDiffPct: pct } = data;
  if (pct == null) return <span>—</span>;
  // rounded first, so a small negative shows as 0, never "-0"
  const fmt = (v) => {
    const r = Math.round(v);
    return `${r > 0 ? "+" : ""}${r === 0 ? 0 : r}`;
  };
  const sar = `${fmt(diff)} SAR`;
  const percent = `${fmt(pct)}%`;
  const text = show === "sar" ? sar : show === "pct" ? percent : `${sar} (${percent})`;
  if (!data.enoughData) {
    const title = t("driverPerformance.notEnoughDataTitle", {
      diff: `${sar} (${percent})`,
      cov: Math.round((data.coverage || 0) * 100),
      km: Math.round(data.measuredKm || 0),
      minCov: MIN_MEASURED_COVERAGE * 100,
      minKm: MIN_MEASURED_KM,
    });
    return <span className="badge muted" title={title}>{t("driverPerformance.notEnoughData")}</span>;
  }
  return isFuelDiffHigh(pct) ? <span className="badge critical">{text}</span> : <span>{text}</span>;
}
