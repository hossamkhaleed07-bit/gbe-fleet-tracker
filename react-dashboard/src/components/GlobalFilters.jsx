import { useDashboard } from "../contexts/DataContext";
import { useLang } from "../contexts/LanguageContext";

export default function GlobalFilters() {
  const { from, to, setFrom, setTo, applyFilter, resetFilter } = useDashboard();
  const { t } = useLang();
  return (
    <div id="global-filters">
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
