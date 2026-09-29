import { useLang } from "../contexts/LanguageContext";
import { addMonths, formatMonthLabel } from "../lib/driverPerformance";

// A single "pick a month" control (e.g. "September 2026") — used by the
// Driver Performance pages instead of the generic GlobalFilters date range.
export default function MonthPicker({ month, onChange }) {
  const { lang } = useLang();
  return (
    <div className="att-month-nav">
      <button type="button" className="btn" onClick={() => onChange(addMonths(month, -1))}>‹</button>
      <span style={{ fontWeight: 700, fontSize: "0.9rem", minWidth: 150, textAlign: "center" }}>
        {formatMonthLabel(month, lang)}
      </span>
      <button type="button" className="btn" onClick={() => onChange(addMonths(month, 1))}>›</button>
    </div>
  );
}
