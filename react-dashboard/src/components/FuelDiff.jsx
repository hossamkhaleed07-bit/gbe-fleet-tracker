import { isFuelDiffHigh } from "../lib/driverPerformance";

// Actual − Expected fuel, in SAR and %. More than FUEL_DIFF_ALERT_PCT above
// expected shows as a red badge; "—" when nothing is expected (no measured day).
export default function FuelDiff({ diff, pct, show = "both" }) {
  if (pct == null) return <span>—</span>;
  // rounded first, so a small negative shows as 0, never "-0"
  const fmt = (v) => {
    const r = Math.round(v);
    return `${r > 0 ? "+" : ""}${r === 0 ? 0 : r}`;
  };
  const sar = `${fmt(diff)} SAR`;
  const percent = `${fmt(pct)}%`;
  const text = show === "sar" ? sar : show === "pct" ? percent : `${sar} (${percent})`;
  return isFuelDiffHigh(pct) ? <span className="badge critical">{text}</span> : <span>{text}</span>;
}
