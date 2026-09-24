import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useDashboard } from "../contexts/DataContext";
import { useLang } from "../contexts/LanguageContext";
import ProjectBadge from "../components/ProjectBadge";
import GlobalFilters from "../components/GlobalFilters";
import DataTable from "../components/DataTable";
import { downloadCsv } from "../lib/csv";
import { PROJECT_LIST } from "../lib/constants";

const CSV_KEYS = ["allocation_date", "full_name", "identity_number", "project", "vehicle_plate", "amount", "source", "status"];

export default function AutomaticFuel() {
  const { scopedAutomaticFuelRows: rows } = useDashboard();
  const { t } = useLang();
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [project, setProject] = useState(() => searchParams.get("project") || "");

  const filteredRows = useMemo(() => {
    let r = rows;
    if (project) r = r.filter(row => row.project === project);
    if (search.trim()) {
      const s = search.trim().toLowerCase();
      r = r.filter(row => (row.full_name || "").toLowerCase().includes(s) || (row.identity_number || "").toLowerCase().includes(s));
    }
    return [...r].sort((a, b) => (b.allocation_date || "").localeCompare(a.allocation_date || ""));
  }, [rows, project, search]);

  const totalAmount = useMemo(() => filteredRows.reduce((sum, r) => sum + Number(r.amount || 0), 0), [filteredRows]);

  function handleReset() {
    setSearch("");
    setProject("");
  }

  function handleExport() {
    if (!filteredRows.length) return;
    downloadCsv(`automatic_fuel_${new Date().toISOString().slice(0, 10)}.csv`, CSV_KEYS, filteredRows);
  }

  const columns = useMemo(() => [
    { accessorKey: "allocation_date", header: t("fuel.colDate") },
    { accessorKey: "full_name", header: t("fuel.colDriver") },
    { accessorKey: "identity_number", header: t("fuel.colIdNumber") },
    { accessorKey: "project", header: t("common.project"), cell: ({ getValue }) => getValue() ? <ProjectBadge project={getValue()} /> : "—" },
    { accessorKey: "vehicle_plate", header: t("fuel.colPlate"), cell: ({ getValue }) => getValue() || "—" },
    { accessorKey: "amount", header: t("fuel.colAmount"), meta: { align: "end" }, cell: ({ getValue }) => Number(getValue() || 0).toFixed(2) },
    { accessorKey: "status", header: t("fuel.colStatus"), cell: ({ getValue }) => <span className="badge complete">{getValue()}</span> },
  ], [t]);

  return (
    <>
      <div className="content-header">
        <div>
          <div className="breadcrumb">{t("common.dashboard")} &gt; <b>{t("automaticFuel.breadcrumb")}</b></div>
          <h1 className="page-title">{t("automaticFuel.breadcrumb")}</h1>
        </div>
        <button className="btn" onClick={handleExport}>{t("common.exportCsv")}</button>
      </div>
      <p className="sub" style={{ margin: "-0.6rem 0 1rem" }}>{t("automaticFuel.subtitle")}</p>
      <GlobalFilters />

      <div className="local-filters">
        <div className="field">
          <label>{t("common.searchByNameOrId")}</label>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder={t("common.typeHere")} />
        </div>
        <div className="field">
          <label>{t("common.project")}</label>
          <select value={project} onChange={e => setProject(e.target.value)}>
            <option value="">{t("common.allProjects")}</option>
            {PROJECT_LIST.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <button className="btn" onClick={handleReset}>{t("common.clearFilters")}</button>
      </div>
      <div className="cards-count">{t("automaticFuel.rowsCount", { n: filteredRows.length })} · {t("compare.colAutomaticFuelCost")}: {totalAmount.toFixed(2)}</div>

      <DataTable
        columns={columns}
        data={filteredRows}
        emptyMessage={t("automaticFuel.noRows")}
      />
    </>
  );
}
