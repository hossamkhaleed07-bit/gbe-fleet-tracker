import { useMemo, useState } from "react";
import { useLang } from "../contexts/LanguageContext";
import { bucketFuelTrend } from "../lib/calc";

const W = 760;
const H = 220;
const PAD_L = 44;
const PAD_R = 12;
const PAD_T = 16;
const PAD_B = 28;

const SERIES = [
  { key: "automatic", color: "var(--c-cyan-ink, #1487ad)", labelKey: "compare.colAutomaticFuelCost" },
  { key: "actual", color: "var(--good)", labelKey: "compare.colActualFuelCost" },
  { key: "total", color: "var(--blue)", labelKey: "compare.colTotalFuelCost" },
];

function formatPeriodLabel(period, granularity, lang) {
  if (granularity === "month") {
    const [y, m] = period.split("-");
    return new Date(`${y}-${m}-01T00:00:00Z`).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
  }
  return period.slice(5); // MM-DD
}

export default function FuelTrendChart({ reinforcementRows, automaticFuelRows }) {
  const { t, lang } = useLang();
  const [granularity, setGranularity] = useState("day");
  const [hover, setHover] = useState(null);

  const points = useMemo(
    () => bucketFuelTrend(reinforcementRows, automaticFuelRows, granularity),
    [reinforcementRows, automaticFuelRows, granularity]
  );

  const maxVal = Math.max(1, ...points.map(p => p.total));
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const stepX = points.length > 1 ? innerW / (points.length - 1) : 0;
  const xAt = i => PAD_L + (points.length > 1 ? i * stepX : innerW / 2);
  const yAt = v => PAD_T + innerH - (v / maxVal) * innerH;

  const linePath = key =>
    points.map((p, i) => `${i === 0 ? "M" : "L"}${xAt(i)},${yAt(p[key])}`).join(" ");

  // Show every Nth x-axis label so long ranges don't overlap.
  const labelStride = Math.max(1, Math.ceil(points.length / 8));

  return (
    <div className="panel">
      <div className="ov-block-head">
        <div>
          <h3>{t("overview.fuelTrendTitle")}</h3>
          <span className="ov-block-sub">{t("overview.fuelTrendSub")}</span>
        </div>
        <div className="date-presets">
          {["day", "week", "month"].map(g => (
            <button
              key={g}
              type="button"
              className={"btn preset-btn" + (granularity === g ? " active" : "")}
              onClick={() => setGranularity(g)}
            >
              {t("overview.gran" + g[0].toUpperCase() + g.slice(1))}
            </button>
          ))}
        </div>
      </div>

      <div className="fuel-trend-legend">
        {SERIES.map(s => (
          <span key={s.key} className="fuel-trend-legend-item">
            <span className="fuel-trend-dot" style={{ background: s.color }} />
            {t(s.labelKey)}
          </span>
        ))}
      </div>

      {!points.length ? (
        <div className="ov-empty">{t("overview.fuelTrendNoData")}</div>
      ) : (
        <div className="fuel-trend-chart-wrap">
          <svg viewBox={`0 0 ${W} ${H}`} className="fuel-trend-svg" preserveAspectRatio="xMidYMid meet">
            {[0, 0.25, 0.5, 0.75, 1].map(f => (
              <line key={f} x1={PAD_L} x2={W - PAD_R} y1={PAD_T + innerH * (1 - f)} y2={PAD_T + innerH * (1 - f)} className="fuel-trend-grid" />
            ))}
            {[0, 0.5, 1].map(f => (
              <text key={f} x={PAD_L - 6} y={PAD_T + innerH * (1 - f) + 3} className="fuel-trend-axis-label" textAnchor="end">
                {Math.round(maxVal * f)}
              </text>
            ))}
            {points.map((p, i) => (
              i % labelStride === 0 && (
                <text key={p.period} x={xAt(i)} y={H - 8} className="fuel-trend-axis-label" textAnchor="middle">
                  {formatPeriodLabel(p.period, granularity, lang)}
                </text>
              )
            ))}
            {SERIES.map(s => (
              <path key={s.key} d={linePath(s.key)} fill="none" stroke={s.color} strokeWidth="2.5" />
            ))}
            {points.map((p, i) => (
              <g key={p.period}>
                <rect
                  x={xAt(i) - stepX / 2} y={PAD_T} width={Math.max(stepX, 8)} height={innerH}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(h => (h === i ? null : h))}
                />
                {SERIES.map(s => (
                  <circle key={s.key} cx={xAt(i)} cy={yAt(p[s.key])} r={hover === i ? 4 : 2.5} fill={s.color} />
                ))}
              </g>
            ))}
          </svg>
          {hover != null && points[hover] && (
            <div
              className="fuel-trend-tooltip"
              style={{ insetInlineStart: `${(xAt(hover) / W) * 100}%`, top: 4 }}
            >
              <div className="fuel-trend-tooltip-title">{formatPeriodLabel(points[hover].period, granularity, lang)}</div>
              {SERIES.map(s => (
                <div key={s.key} className="fuel-trend-tooltip-row">
                  <span className="fuel-trend-dot" style={{ background: s.color }} />
                  {t(s.labelKey)}: {t("fuel.amountPrefix")} {points[hover][s.key].toFixed(0)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
