import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useDashboard } from "../contexts/DataContext";
import { useLang } from "../contexts/LanguageContext";
import { CLEAR_FILTERS_EVENT } from "../hooks/useClearFilters";

export default function GlobalFilters() {
  const { from, to, setFrom, setTo, applyFilter, resetFilter } = useDashboard();
  const { t } = useLang();

  // One "Clear filters" for the whole combined filter box: resets the date
  // range here and tells the page to reset its own search/status/project.
  function clearAll() {
    resetFilter();
    window.dispatchEvent(new Event(CLEAR_FILTERS_EVENT));
  }

  // Render inside the page hero (Layout provides #fx-hero-slot) so the filters sit
  // in the dark header; falls back to rendering in place if the slot is missing.
  const [heroSlot, setHeroSlot] = useState(null);
  useLayoutEffect(() => {
    setHeroSlot(document.getElementById("fx-hero-slot"));
  }, []);

  const filters = (
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
      <div className="field"><button className="btn" onClick={clearAll}>{t("common.clearFilters")}</button></div>
    </div>
  );

  return heroSlot ? createPortal(filters, heroSlot) : filters;
}
