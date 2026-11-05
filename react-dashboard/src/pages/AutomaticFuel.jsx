import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useDashboard } from "../contexts/DataContext";
import { useAuth } from "../contexts/AuthContext";
import { useLang } from "../contexts/LanguageContext";
import { useToast } from "../contexts/ToastContext";
import ProjectBadge from "../components/ProjectBadge";
import GlobalFilters from "../components/GlobalFilters";
import DataTable from "../components/DataTable";
import AutomaticFuelAmounts from "../components/AutomaticFuelAmounts";
import { downloadCsv } from "../lib/csv";
import { PROJECT_LIST } from "../lib/constants";
import { formatLocalDateTime } from "../lib/calc";
import { adjustAllocation, autoFuelErrorMessage, parseAmount, STATUSES } from "../lib/automaticFuel";
import HeroPortal from "../components/HeroPortal";
import { useClearFilters } from "../hooks/useClearFilters";
import "../automatic-fuel.css";

const CSV_KEYS = ["allocation_date", "full_name", "identity_number", "project", "vehicle_plate", "amount", "source", "status"];
const TABS = ["allocations", "amounts"];

// Corrects one allocation already made (admin only); the reason is required and
// the database logs old and new amounts (migration 061).
function AdjustAllocationModal({ row, onCancel, onDone }) {
  const { t } = useLang();
  const { showToast } = useToast();
  const [amount, setAmount] = useState(String(Number(row.amount || 0)));
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    const value = parseAmount(amount);
    if (value == null) { setError(t("automaticFuel.errors.AUTO_FUEL_AMOUNT_MUST_BE_POSITIVE")); return; }
    if (!reason.trim()) { setError(t("automaticFuel.errors.AUTO_FUEL_REASON_REQUIRED")); return; }
    setSaving(true);
    const { error: err } = await adjustAllocation(row.id, value, reason.trim());
    setSaving(false);
    if (err) { setError(autoFuelErrorMessage(t, err)); return; }
    showToast(t("automaticFuel.saved"));
    onDone();
  }

  return (
    <div id="compare-detail-backdrop" style={{ display: "flex" }} onClick={e => { if (e.target.id === "compare-detail-backdrop") onCancel(); }}>
      <form id="compare-detail-modal" style={{ maxWidth: "440px" }} onSubmit={submit}>
        <button type="button" id="compare-detail-close" aria-label={t("detailModal.close")} onClick={onCancel}>×</button>
        <h2>{t("automaticFuel.adjustTitle")}</h2>
        <p className="af-summary">
          {row.full_name || row.identity_number} · {row.allocation_date} · {t("automaticFuel.currentAmount")}: {Number(row.amount || 0).toFixed(2)}
        </p>
        <label className="af-field">
          <span>{t("automaticFuel.newAmount")}</span>
          <input type="number" min="0.01" step="0.01" value={amount} autoFocus onChange={e => setAmount(e.target.value)} />
        </label>
        <label className="af-field">
          <span>{t("automaticFuel.reasonLabel")}</span>
          <textarea rows={3} value={reason} onChange={e => setReason(e.target.value)} placeholder={t("automaticFuel.reasonPlaceholder")} />
        </label>
        {error && <div className="af-error" style={{ marginTop: "0.5rem" }}>{error}</div>}
        <div className="modal-form-actions">
          <button type="button" className="btn" onClick={onCancel} disabled={saving}>{t("common.cancel")}</button>
          <button type="submit" className={"btn af-save" + (saving ? " btn-loading" : "")} disabled={saving}>{t("common.save")}</button>
        </div>
      </form>
    </div>
  );
}

export default function AutomaticFuel() {
  const { scopedAutomaticFuelRows: rows, applyFilter } = useDashboard();
  const { isAdmin } = useAuth();
  const { t } = useLang();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [project, setProject] = useState(() => searchParams.get("project") || "");
  const [adjusting, setAdjusting] = useState(null);
  const tab = TABS.includes(searchParams.get("tab")) ? searchParams.get("tab") : "allocations";

  function setTab(next) {
    setSearchParams(prev => {
      const p = new URLSearchParams(prev);
      if (next === "allocations") p.delete("tab"); else p.set("tab", next);
      return p;
    }, { replace: true });
  }

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
  useClearFilters(handleReset);

  function handleExport() {
    if (!filteredRows.length) return;
    downloadCsv(`automatic_fuel_${new Date().toISOString().slice(0, 10)}.csv`, CSV_KEYS, filteredRows);
  }

  const columns = useMemo(() => [
    { accessorKey: "allocation_date", header: t("fuel.colDate") },
    { accessorKey: "full_name", header: t("fuel.colDriver"), cell: ({ getValue }) => getValue() || "—" },
    { accessorKey: "identity_number", header: t("fuel.colIdNumber") },
    { accessorKey: "project", header: t("common.project"), cell: ({ getValue }) => getValue() ? <ProjectBadge project={getValue()} /> : "—" },
    { accessorKey: "vehicle_plate", header: t("fuel.colPlate"), cell: ({ getValue }) => getValue() || "—" },
    { accessorKey: "amount", header: t("fuel.colAmount"), meta: { align: "end" }, cell: ({ getValue }) => Number(getValue() || 0).toFixed(2) },
    {
      accessorKey: "status", header: t("fuel.colStatus"),
      cell: ({ row }) => {
        const r = row.original;
        const status = STATUSES.includes(r.status) ? r.status : null;
        return (
          <>
            <span className={"badge " + (status === "failed" ? "critical" : "complete")}>
              {status ? t(`automaticFuel.status_${status}`) : (r.status || "—")}
            </span>
            {r.adjusted_at && (
              <span className="badge af-badge-adjusted" title={`${formatLocalDateTime(r.adjusted_at)} · ${r.adjusted_by || "—"}`}>
                {t("automaticFuel.adjusted")}
              </span>
            )}
          </>
        );
      },
    },
    ...(isAdmin ? [{
      id: "actions", header: "", enableSorting: false,
      cell: ({ row }) => row.original.id
        ? <button className="btn" onClick={() => setAdjusting(row.original)}>{t("automaticFuel.edit")}</button>
        : null,
    }] : []),
  ], [t, isAdmin]);

  return (
    <>
      <HeroPortal target="fx-hero-actions" className="content-header">
        <div>
          <div className="breadcrumb">{t("common.dashboard")} &gt; <b>{t("automaticFuel.breadcrumb")}</b></div>
          <h1 className="page-title">{t("automaticFuel.breadcrumb")}</h1>
        </div>
        {tab === "allocations" && <button className="btn" onClick={handleExport}>{t("common.exportCsv")}</button>}
      </HeroPortal>
      <HeroPortal target="fx-hero-note" className="fx-hero-note">{t("automaticFuel.subtitle")}</HeroPortal>

      <div className="af-tabs" role="tablist" aria-label={t("automaticFuel.breadcrumb")}>
        {TABS.map(k => (
          <button key={k} type="button" role="tab" className="af-tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {t(`automaticFuel.tab_${k}`)}
          </button>
        ))}
      </div>

      {tab === "amounts" ? <AutomaticFuelAmounts /> : (
        <>
          <GlobalFilters />
          <HeroPortal className="local-filters">
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
            <button className="btn local-clear-btn" onClick={handleReset}>{t("common.clearFilters")}</button>
          </HeroPortal>
          <div className="cards-count">{t("automaticFuel.rowsCount", { n: filteredRows.length })} · {t("compare.colAutomaticFuelCost")}: {totalAmount.toFixed(2)}</div>

          <DataTable
            columns={columns}
            data={filteredRows}
            emptyMessage={t("automaticFuel.noRows")}
          />
        </>
      )}

      {adjusting && (
        <AdjustAllocationModal
          row={adjusting}
          onCancel={() => setAdjusting(null)}
          onDone={() => { setAdjusting(null); applyFilter(); }}
        />
      )}
    </>
  );
}
