import { useDashboard } from "../contexts/DataContext";
import { useLang } from "../contexts/LanguageContext";
import { localToday } from "../lib/calc";

function addDays(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function startOfMonth(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export default function GlobalFilters() {
  const { from, to, setFrom, setTo, applyFilter, resetFilter, loadData } = useDashboard();
  const { t } = useLang();
  const today = localToday();

  // setFrom/setTo only update the URL (async re-render); loadData(from, to)
  // is called directly here with the new values so a preset click reloads
  // data immediately instead of waiting on next render's stale closure.
  function applyPreset(presetFrom, presetTo) {
    setFrom(presetFrom);
    setTo(presetTo);
    loadData(presetFrom, presetTo);
  }

  const isActivePreset = (presetFrom, presetTo) => from === presetFrom && to === presetTo;

  return (
    <div id="global-filters">
      <div className="date-presets">
        <button type="button" className={"btn preset-btn" + (isActivePreset(today, today) ? " active" : "")} onClick={() => applyPreset(today, today)}>{t("globalFilters.presetToday")}</button>
        <button type="button" className={"btn preset-btn" + (isActivePreset(addDays(today, -1), addDays(today, -1)) ? " active" : "")} onClick={() => applyPreset(addDays(today, -1), addDays(today, -1))}>{t("globalFilters.presetYesterday")}</button>
        <button type="button" className={"btn preset-btn" + (isActivePreset(addDays(today, -6), today) ? " active" : "")} onClick={() => applyPreset(addDays(today, -6), today)}>{t("globalFilters.presetLast7Days")}</button>
        <button type="button" className={"btn preset-btn" + (isActivePreset(startOfMonth(today), today) ? " active" : "")} onClick={() => applyPreset(startOfMonth(today), today)}>{t("globalFilters.presetThisMonth")}</button>
      </div>
      <div className="field">
        <label>{t("globalFilters.fromDate")}</label>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} />
      </div>
      <div className="field">
        <label>{t("globalFilters.toDate")}</label>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} />
      </div>
      <div className="field"><button className="btn" onClick={applyFilter}>{t("common.apply")}</button></div>
      <div className="field"><button className="btn" onClick={resetFilter}>{t("common.clearFilters")}</button></div>
    </div>
  );
}
