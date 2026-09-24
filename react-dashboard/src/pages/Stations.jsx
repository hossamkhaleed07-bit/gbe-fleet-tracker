import { useMemo } from "react";
import { useDashboard } from "../contexts/DataContext";
import { useLang } from "../contexts/LanguageContext";
import GlobalFilters from "../components/GlobalFilters";
import DataTable from "../components/DataTable";
import { downloadCsv } from "../lib/csv";

export default function Stations() {
  const { scopedStationRows: stationRows } = useDashboard();
  const { t } = useLang();

  const columns = useMemo(() => [
    { accessorKey: "station", header: t("stations.colStation") },
    { accessorKey: "total", header: t("stations.colRecordCount"), meta: { align: "end" } },
    { accessorKey: "drivers", header: t("stations.colDriverCount"), meta: { align: "end" } },
    { accessorKey: "startCount", header: t("stations.colStartRecords"), meta: { align: "end" } },
    { accessorKey: "endCount", header: t("stations.colEndRecords"), meta: { align: "end" } },
    { accessorKey: "ofd", header: t("stations.colTotalOfd"), meta: { align: "end" } },
    { accessorKey: "cod", header: t("stations.colTotalCod"), meta: { align: "end" } },
    { accessorKey: "ppd", header: t("stations.colTotalPpd"), meta: { align: "end" } },
    { accessorKey: "picked", header: t("stations.colTotalPickedUp"), meta: { align: "end" } },
  ], [t]);

  function handleExport() {
    if (!stationRows.length) return;
    const keys = ["station", "total_records", "drivers", "start_count", "end_count", "ofd", "cod", "ppd", "picked_up"];
    const rows = stationRows.map(g => ({
      station: g.station, total_records: g.total, drivers: g.drivers, start_count: g.startCount, end_count: g.endCount,
      ofd: g.ofd, cod: g.cod, ppd: g.ppd, picked_up: g.picked,
    }));
    downloadCsv(`station_report_${new Date().toISOString().slice(0, 10)}.csv`, keys, rows);
  }

  return (
    <>
      <div className="content-header">
        <div>
          <div className="breadcrumb">{t("common.dashboard")} &gt; <b>{t("stations.breadcrumb")}</b></div>
          <h1 className="page-title">{t("stations.breadcrumb")}</h1>
        </div>
        <button className="btn" onClick={handleExport}>{t("common.exportCsv")}</button>
      </div>
      <GlobalFilters />
      <DataTable columns={columns} data={stationRows} emptyMessage={t("common.loading")} />
    </>
  );
}
