import { useLang } from "../contexts/LanguageContext";

// "Drivers with activity: N (of which left: M)" on the Driver Performance cards.
export default function DriversCount({ summary }) {
  const { t } = useLang();
  return (
    <>
      {summary.activeDrivers}
      {summary.leftDrivers > 0 && <span className="ov-block-sub"> {t("driverPerformance.ofWhichLeft", { n: summary.leftDrivers })}</span>}
      {summary.notInListDrivers > 0 && <span className="ov-block-sub"> {t("driverPerformance.ofWhichNotInList", { n: summary.notInListDrivers })}</span>}
    </>
  );
}
