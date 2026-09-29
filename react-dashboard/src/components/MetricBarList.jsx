// Reusable hand-rolled horizontal bar list — no charting library, matching
// the app's existing FuelTrendChart/bar-track convention. Used for every
// "X by project"/"Top N drivers"/percentage-distribution chart in the
// Driver Performance feature.
export default function MetricBarList({ items, formatValue, onItemClick, maxValue }) {
  const max = maxValue ?? Math.max(1, ...items.map(i => i.value));
  if (!items.length) return null;
  return (
    <div className="perf-bar-list">
      {items.map((item, i) => (
        <div
          key={item.key ?? item.label}
          className={"perf-bar-row" + (onItemClick ? " clickable" : "")}
          onClick={onItemClick ? () => onItemClick(item) : undefined}
        >
          <div className="perf-bar-label">{item.label}</div>
          <div className="bar-track">
            <div className={`bar-fill region-bar-${(i % 5) + 1}`} style={{ width: `${Math.min(100, (item.value / max) * 100)}%` }} />
          </div>
          <div className="perf-bar-value">{formatValue ? formatValue(item.value) : item.value}</div>
        </div>
      ))}
    </div>
  );
}
