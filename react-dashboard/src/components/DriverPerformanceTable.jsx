import { useMemo } from "react";
import { useLang } from "../contexts/LanguageContext";
import DataTable from "./DataTable";
import { buildDriverPerformance } from "../lib/calc";

export default function DriverPerformanceTable({ drivers, compareGroups, reinforcementRows, automaticFuelRows }) {
  const { t } = useLang();

  const rows = useMemo(
    () => buildDriverPerformance(drivers, compareGroups, reinforcementRows, automaticFuelRows)
      .sort((a, b) => b.fuelCost - a.fuelCost),
    [drivers, compareGroups, reinforcementRows, automaticFuelRows]
  );

  const columns = useMemo(() => [
    { accessorKey: "full_name", header: t("compare.colDriver") },
    { accessorKey: "project", header: t("compare.colProject"), cell: ({ getValue }) => getValue() || "—" },
    { accessorKey: "completedShifts", header: t("overview.colCompletedShifts"), meta: { align: "end" } },
    {
      accessorKey: "fuelCost", header: t("overview.colFuelCostTotal"), meta: { align: "end" },
      cell: ({ getValue }) => `${t("fuel.amountPrefix")} ${getValue().toFixed(0)}`,
    },
  ], [t]);

  return (
    <div className="panel">
      <div className="ov-block-head">
        <div>
          <h3>{t("overview.driverPerfTitle")}</h3>
          <span className="ov-block-sub">{t("overview.driverPerfSub")}</span>
        </div>
      </div>
      <DataTable columns={columns} data={rows} pageSize={10} emptyMessage={t("overview.noData")} />
    </div>
  );
}
