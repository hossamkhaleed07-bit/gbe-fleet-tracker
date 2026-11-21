import { useLang } from "../contexts/LanguageContext";
import { perfDriverName } from "../lib/driverPerformance";

// A Driver Performance driver's name with its status: "Left — last working
// day: <date>" for a driver who is no longer active, or "Not in driver list"
// for activity under an ID that is not in the drivers list.
export function LeftBadge({ row }) {
  const { t } = useLang();
  if (row?.notInList) return <span className="badge partial">{t("driverPerformance.notInList")}</span>;
  if (!row?.left) return null;
  return (
    <span className="badge critical">
      {row.lastWorkingDay ? t("driverPerformance.leftLastDay", { date: row.lastWorkingDay }) : t("driverPerformance.left")}
      {row.activityAfterLeaving && <> · {t("driverPerformance.activityAfterLeaving")}</>}
    </span>
  );
}

export default function PerfDriverLabel({ row }) {
  const { t } = useLang();
  return (
    <>
      {row?.notInList ? null : perfDriverName(row, t)}
      {(row?.left || row?.notInList) && <> <LeftBadge row={row} /></>}
    </>
  );
}
