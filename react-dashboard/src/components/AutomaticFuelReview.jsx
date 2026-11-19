import { useCallback, useEffect, useMemo, useState } from "react";
import { useLang } from "../contexts/LanguageContext";
import { useDashboard } from "../contexts/DataContext";
import DataTable from "./DataTable";
import { VoidDialog } from "./AutomaticFuelVoid";
import { addDays, riyadhYesterday } from "../lib/rcaFollowup";
import {
  autoFuelErrorMessage, canVoidDay, loadReview, REVIEW_STATUSES, SUGGESTED_REVIEW_STATUS, summarizeReview,
  VOIDABLE_REVIEW_STATUSES,
} from "../lib/automaticFuel";

// Admin only (migration 064): automatic fuel days whose PetroApp / Futurehub
// invoices do not cover automatic fuel + approved reinforcement for that day.
// The database decides the status; this tab shows it and voids in bulk.

const STATUS_BADGE = {
  no_invoice: "critical", partial_invoice: "partial", combined_fill: "complete", not_loaded: "af-badge-muted",
};
const money = (v) => Number(v || 0).toFixed(2);

export default function AutomaticFuelReview() {
  const { t } = useLang();
  const { applyFilter } = useDashboard();
  const [from, setFrom] = useState(() => addDays(riyadhYesterday(), -60));
  const [to, setTo] = useState(() => riyadhYesterday());
  const [state, setState] = useState({ loading: true, rows: [], error: null });
  const [status, setStatus] = useState("");
  const [selected, setSelected] = useState(() => new Set());
  const [voiding, setVoiding] = useState(null);

  const load = useCallback(async () => {
    if (!from || !to || from > to) { setState({ loading: false, rows: [], error: { message: "AUTO_FUEL_BAD_RANGE" } }); return; }
    setState(s => ({ ...s, loading: true, error: null }));
    const { rows, error } = await loadReview(from, to);
    setState({ loading: false, rows: rows || [], error });
    setSelected(new Set());
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  const summary = useMemo(() => summarizeReview(state.rows), [state.rows]);
  const visible = useMemo(() => (status ? state.rows.filter(r => r.status === status) : state.rows), [state.rows, status]);
  const canSelect = (r) => VOIDABLE_REVIEW_STATUSES.includes(r.status) && canVoidDay(r.allocation_date);
  const selectedRows = useMemo(() => state.rows.filter(r => selected.has(r.allocation_id)), [state.rows, selected]);
  const selectedSar = selectedRows.reduce((s, r) => s + Number(r.automatic_fuel || 0), 0);

  function toggle(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function selectSuggested() {
    setSelected(new Set(visible.filter(r => r.status === SUGGESTED_REVIEW_STATUS && canSelect(r)).map(r => r.allocation_id)));
  }

  const columns = useMemo(() => [
    {
      id: "pick", header: "", enableSorting: false,
      cell: ({ row }) => canSelect(row.original)
        ? <input type="checkbox" aria-label={t("automaticFuel.selectRow")} checked={selected.has(row.original.allocation_id)}
            onChange={() => toggle(row.original.allocation_id)} />
        : null,
    },
    { accessorKey: "allocation_date", header: t("fuel.colDate") },
    { accessorKey: "full_name", header: t("fuel.colDriver"), cell: ({ getValue }) => getValue() || "—" },
    { accessorKey: "identity_number", header: t("fuel.colIdNumber") },
    { accessorKey: "vehicle_plate", header: t("fuel.colPlate"), cell: ({ getValue }) => getValue() || "—" },
    {
      accessorKey: "attendance_code", header: t("automaticFuel.colAttendance"),
      cell: ({ getValue }) => <span className={"badge " + (getValue() === "P" ? "complete" : "af-badge-code")}>{getValue() || "—"}</span>,
    },
    { accessorKey: "automatic_fuel", header: t("automaticFuel.colAutomatic"), meta: { align: "end" }, cell: ({ getValue }) => money(getValue()) },
    { accessorKey: "reinforcement", header: t("automaticFuel.colReinforcement"), meta: { align: "end" }, cell: ({ getValue }) => money(getValue()) },
    { accessorKey: "need", header: t("automaticFuel.colNeed"), meta: { align: "end" }, cell: ({ getValue }) => money(getValue()) },
    {
      id: "invoices", header: t("automaticFuel.colInvoices"), enableSorting: false, meta: { align: "end" },
      cell: ({ row }) => {
        const r = row.original;
        return (
          <span className="af-invoices" title={t("automaticFuel.invoicesHint")}>
            {money(r.invoice_prev)} / <b>{money(r.invoice_day)}</b> / {money(r.invoice_next)}
          </span>
        );
      },
    },
    {
      accessorKey: "status", header: t("fuel.colStatus"),
      cell: ({ row }) => {
        const r = row.original;
        return (
          <>
            <span className={"badge " + (STATUS_BADGE[r.status] || "")}>{t(`automaticFuel.review_${r.status}`)}</span>
            {r.status === "combined_fill" && r.related_date && (
              <div className="af-hint">{t("automaticFuel.combinedWith", { date: r.related_date })}</div>
            )}
          </>
        );
      },
    },
  ], [t, selected]);

  return (
    <div className="af-amounts">
      <div className="af-panel">
        <div className="af-review-head">
          <label className="af-field af-inline">
            <span>{t("automaticFuel.reviewFrom")}</span>
            <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} />
          </label>
          <label className="af-field af-inline">
            <span>{t("automaticFuel.reviewTo")}</span>
            <input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} />
          </label>
          <label className="af-field af-inline">
            <span>{t("fuel.colStatus")}</span>
            <select value={status} onChange={e => setStatus(e.target.value)}>
              <option value="">{t("automaticFuel.reviewAllStatuses")}</option>
              {REVIEW_STATUSES.map(s => <option key={s} value={s}>{t(`automaticFuel.review_${s}`)}</option>)}
            </select>
          </label>
        </div>
        <p className="af-hint">{t("automaticFuel.reviewHint")}</p>
        <p className="af-hint">
          {summary.lastInvoiceDate
            ? t("automaticFuel.invoicesLoadedUntil", { date: summary.lastInvoiceDate })
            : t("automaticFuel.noInvoicesLoaded")}
        </p>
        <div className="af-review-chips">
          {REVIEW_STATUSES.map(s => (
            <button key={s} type="button" className="af-chip" aria-pressed={status === s} onClick={() => setStatus(status === s ? "" : s)}>
              <span className={"badge " + (STATUS_BADGE[s] || "")}>{t(`automaticFuel.review_${s}`)}</span>
              <span>{t("automaticFuel.daysSar", { n: summary.byStatus[s].days, sar: money(summary.byStatus[s].sar) })}</span>
            </button>
          ))}
        </div>
      </div>

      {state.error && <div className="af-alert">{t("automaticFuel.reviewLoadFailed")}: {autoFuelErrorMessage(t, state.error)}</div>}

      <div className="af-section-head">
        <h2>{t("automaticFuel.reviewTitle", { n: visible.length })}</h2>
        <div className="af-actions">
          <button type="button" className="btn" onClick={selectSuggested} disabled={state.loading}>{t("automaticFuel.selectSuggested")}</button>
          <button type="button" className="btn" onClick={() => setSelected(new Set())} disabled={!selected.size}>{t("automaticFuel.clearSelection")}</button>
          <button type="button" className="btn af-danger" onClick={() => setVoiding(selectedRows.map(r => ({ ...r, id: r.allocation_id, amount: r.automatic_fuel })))}
            disabled={!selected.size}>
            {t("automaticFuel.voidSelected", { n: selected.size, sar: money(selectedSar) })}
          </button>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={visible}
        emptyMessage={state.loading ? t("automaticFuel.loading") : t("automaticFuel.reviewEmpty")}
        pageSize={50}
      />

      {voiding && (
        <VoidDialog
          rows={voiding}
          onCancel={() => setVoiding(null)}
          onDone={() => { setVoiding(null); load(); applyFilter(); }}
        />
      )}
    </div>
  );
}
