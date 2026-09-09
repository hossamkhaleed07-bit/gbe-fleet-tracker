import { useDashboard } from "../contexts/DataContext";
import { useLang } from "../contexts/LanguageContext";
import { StatusBadge } from "./DetailModal";
import Field from "./Field";
import { compareStatus, buildGroupMetrics, formatLocalTime } from "../lib/calc";
import { prevDay } from "../hooks/usePrevDayShift";

export default function PrevDayFuelSection({ shiftDate, prevDayGroup, loading }) {
  const { t } = useLang();
  const { vehicleRates, vehicleFuelTypes, stationRates, vehicleEndHistory, approvedFuelByKey } = useDashboard();
  const stationName = prevDayGroup?.end?.station_name || prevDayGroup?.start?.station_name;
  const m = prevDayGroup
    ? buildGroupMetrics(prevDayGroup, { vehicleRates, vehicleFuelTypes, stationRates, vehicleEndHistory, approvedFuelByKey })
    : { dist: "—", fuelLiters: "—", fuelCost: "—", actualFuelCost: "—", offDuty: null, delivered: "—", deliveryPct: "—", sales: "—" };

  return (
    <div className="compare-card-section" style={{ padding: "0 0 1rem" }}>
      <h4>{t("fuel.previousDayTitle", { day: prevDay(shiftDate) })}</h4>
      {loading || !prevDayGroup ? (
        <div className="ov-empty">{t("common.loading")}</div>
      ) : prevDayGroup.empty ? (
        <div className="ov-empty">{t("fuel.noPreviousDayData")}</div>
      ) : (
        <div className="fuel-detail-grid">
          <Field label={t("compare.colPlate")} val={prevDayGroup.vehicle_plate} />
          <Field label={t("common.status")} val={<StatusBadge status={compareStatus(prevDayGroup)} />} />
          <Field label={t("fuel.colStation")} val={stationName} />
          <Field label={t("common.startOdometer")} val={prevDayGroup.start?.odo_reading} />
          <Field label={t("common.endOdometer")} val={prevDayGroup.end?.odo_reading} />
          <Field label={t("compare.colDistanceCovered")} val={m.dist} />
          <Field label={t("common.expectedFuelLiters")} val={m.fuelLiters} />
          <Field label={t("compare.colExpectedFuelCost")} val={m.fuelCost} />
          <Field label={t("compare.colActualFuelCost")} val={m.actualFuelCost} />
          <Field label={t("compare.colOffDuty")} val={m.offDuty ?? "—"} />
          <Field label={t("common.startTime")} val={formatLocalTime(prevDayGroup.start?.created_at)} />
          <Field label={t("common.endTime")} val={formatLocalTime(prevDayGroup.end?.created_at)} />
          <Field label="OFD" val={prevDayGroup.start?.ofd_count} />
          <Field label="COD" val={prevDayGroup.end?.cod_delivered} />
          <Field label="PPD" val={prevDayGroup.end?.ppd_delivered} />
          <Field label="Picked Up" val={prevDayGroup.end?.picked_up} />
          <Field label="Delivered" val={m.delivered} />
          <Field label="Delivery %" val={m.deliveryPct} />
          <Field label="Sales" val={m.sales} />
        </div>
      )}
    </div>
  );
}
