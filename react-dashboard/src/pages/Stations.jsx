import { useDashboard } from "../contexts/DataContext";
import { useLang } from "../contexts/LanguageContext";
import GlobalFilters from "../components/GlobalFilters";
import { downloadCsv } from "../lib/csv";

export default function Stations() {
  const { scopedStationRows: stationRows } = useDashboard();
  const { t } = useLang();

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
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t("stations.colStation")}</th><th>{t("stations.colRecordCount")}</th><th>{t("stations.colDriverCount")}</th><th>{t("stations.colStartRecords")}</th>
              <th>{t("stations.colEndRecords")}</th><th>{t("stations.colTotalOfd")}</th><th>{t("stations.colTotalCod")}</th><th>{t("stations.colTotalPpd")}</th><th>{t("stations.colTotalPickedUp")}</th>
            </tr>
          </thead>
          <tbody>
            {!stationRows.length ? (
              <tr className="empty-row"><td colSpan={9}>{t("common.loading")}</td></tr>
            ) : stationRows.map(g => (
              <tr key={g.station}>
                <td>{g.station}</td><td>{g.total}</td><td>{g.drivers}</td><td>{g.startCount}</td>
                <td>{g.endCount}</td><td>{g.ofd}</td><td>{g.cod}</td><td>{g.ppd}</td><td>{g.picked}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
