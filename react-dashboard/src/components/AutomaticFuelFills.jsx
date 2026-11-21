import { useCallback, useEffect, useMemo, useState } from "react";
import { useLang } from "../contexts/LanguageContext";
import { useToast } from "../contexts/ToastContext";
import { useDashboard } from "../contexts/DataContext";
import DataTable from "./DataTable";
import { ReasonDialog, RestoreDialog } from "./AutomaticFuelVoid";
import {
  autoFuelErrorMessage, clearUnentitled, fillActions, FILL_STATUSES, givesFuelNow, loadFills, markUnentitled,
  markWorked, OPEN_FILL_STATUSES, summarizeFills, undoWorked,
} from "../lib/automaticFuel";

// Admin only (migration 064), list B: PetroApp / Futurehub fills with no
// automatic fuel and no approved reinforcement. Per row: "Worked, forgot the
// form" (attendance P; an old day gets its fuel at once, at that day's amount)
// or "Didn't work" (unentitled withdrawal, for follow-up). Both need a reason,
// are logged and can be undone. The database checks everything again.

const STATUS_BADGE = {
  unexplained: "critical", nearby_auto: "partial", voided_day: "af-badge-muted", fuel_coming: "complete",
  worked_marked: "complete", unentitled: "af-badge-code",
};
const money = (v) => Number(v || 0).toFixed(2);

function ActionDialog({ action, row, onCancel, onDone }) {
  const { t } = useLang();
  const { showToast } = useToast();
  const who = `${row.full_name || row.identity_number} · ${row.fill_date}`;
  const cfg = {
    worked: {
      title: t("automaticFuel.fillWorkedTitle"),
      summary: `${who} · ${t("automaticFuel.colAttendance")}: ${row.attendance_code || "—"} → P. `
        + (givesFuelNow(row.fill_date) ? t("automaticFuel.fillWorkedNow") : t("automaticFuel.fillWorkedJob")),
      confirm: t("automaticFuel.fillWorked"),
      run: (reason) => markWorked(row.identity_number, row.fill_date, reason),
      toast: (v) => (Number(v) > 0 ? t("automaticFuel.fillWorkedToastNow", { sar: money(v) }) : t("automaticFuel.fillWorkedToastJob")),
    },
    unentitled: {
      title: t("automaticFuel.fillUnentitledTitle"),
      summary: `${who} · ${t("automaticFuel.colInvoiceSar")}: ${money(row.invoice_sar)}`,
      confirm: t("automaticFuel.fillUnentitled"), danger: true,
      run: (reason) => markUnentitled(row.identity_number, row.fill_date, reason),
      toast: () => t("automaticFuel.fillUnentitledToast"),
    },
    undoWorked: {
      title: t("automaticFuel.fillUndoWorkedTitle"),
      summary: `${who} · ${t("automaticFuel.fillUndoWorkedHint")}`,
      confirm: t("automaticFuel.fillUndo"), danger: true,
      run: (reason) => undoWorked(row.identity_number, row.fill_date, reason),
      toast: () => t("automaticFuel.fillUndoneToast"),
    },
    clearUnentitled: {
      title: t("automaticFuel.fillClearTitle"),
      summary: `${who} · ${t("automaticFuel.voidedReason")}: ${row.note || "—"}`,
      confirm: t("automaticFuel.fillUndo"),
      run: (reason) => clearUnentitled(row.identity_number, row.fill_date, reason),
      toast: () => t("automaticFuel.fillUndoneToast"),
    },
  }[action];
  return (
    <ReasonDialog
      title={cfg.title}
      summary={cfg.summary}
      danger={cfg.danger}
      confirmLabel={cfg.confirm}
      onCancel={onCancel}
      onSubmit={async (reason) => {
        const { data, error } = await cfg.run(reason);
        if (error) return error;
        showToast(cfg.toast(data));
        onDone();
        return null;
      }}
    />
  );
}

export default function AutomaticFuelFills({ from, to, onChanged }) {
  const { t } = useLang();
  const { applyFilter } = useDashboard();
  const [state, setState] = useState({ loading: true, rows: [], error: null });
  const [status, setStatus] = useState("");
  const [dialog, setDialog] = useState(null);

  const load = useCallback(async () => {
    if (!from || !to || from > to) { setState({ loading: false, rows: [], error: { message: "AUTO_FUEL_BAD_RANGE" } }); return; }
    setState(s => ({ ...s, loading: true, error: null }));
    const { rows, error } = await loadFills(from, to);
    setState({ loading: false, rows: rows || [], error });
  }, [from, to]);

  useEffect(() => { load(); }, [load]);

  const summary = useMemo(() => summarizeFills(state.rows), [state.rows]);
  const visible = useMemo(
    () => state.rows.filter(r => (status ? r.status === status : OPEN_FILL_STATUSES.includes(r.status))),
    [state.rows, status],
  );

  function done() {
    setDialog(null);
    load();
    applyFilter();
    onChanged?.();
  }

  const columns = useMemo(() => [
    { accessorKey: "fill_date", header: t("fuel.colDate") },
    { accessorKey: "full_name", header: t("fuel.colDriver"), cell: ({ getValue }) => getValue() || "—" },
    { accessorKey: "identity_number", header: t("fuel.colIdNumber") },
    { accessorKey: "vehicle_plate", header: t("fuel.colPlate"), cell: ({ getValue }) => getValue() || "—" },
    {
      accessorKey: "attendance_code", header: t("automaticFuel.colAttendance"),
      cell: ({ getValue }) => <span className={"badge " + (getValue() === "P" ? "complete" : "af-badge-code")}>{getValue() || "—"}</span>,
    },
    {
      accessorKey: "invoice_sar", header: t("automaticFuel.colInvoiceSar"), meta: { align: "end" },
      cell: ({ row }) => <span className="af-invoices">{money(row.original.invoice_sar)} <small>({row.original.invoice_count})</small></span>,
    },
    {
      id: "nearby", header: t("automaticFuel.colNearbyAuto"), enableSorting: false, meta: { align: "end" },
      cell: ({ row }) => <span className="af-invoices" title={t("automaticFuel.nearbyHint")}>{money(row.original.auto_prev)} / {money(row.original.auto_next)}</span>,
    },
    {
      accessorKey: "status", header: t("fuel.colStatus"),
      cell: ({ row }) => {
        const r = row.original;
        return (
          <>
            <span className={"badge " + (STATUS_BADGE[r.status] || "")}>{t(`automaticFuel.fill_${r.status}`)}</span>
            {r.status === "nearby_auto" && r.related_date && <div className="af-hint">{t("automaticFuel.nearbyDay", { date: r.related_date })}</div>}
            {!r.is_active && <div className="af-hint">{t("automaticFuel.inactiveDriver")}</div>}
            {r.note && <div className="af-hint">{r.note}</div>}
          </>
        );
      },
    },
    {
      id: "actions", header: "", enableSorting: false,
      cell: ({ row }) => {
        const r = row.original;
        return (
          <div className="af-actions">
            {fillActions(r).map(a => (
              <button key={a} type="button" className={"btn " + (a === "unentitled" ? "af-danger" : "")}
                onClick={() => setDialog({ action: a, row: r })}>
                {t(`automaticFuel.fillAction_${a}`)}
              </button>
            ))}
          </div>
        );
      },
    },
  ], [t]);

  return (
    <>
      <div className="af-panel">
        <p className="af-hint">{t("automaticFuel.fillsHint")}</p>
        <div className="af-review-head">
          <label className="af-field af-inline">
            <span>{t("fuel.colStatus")}</span>
            <select value={status} onChange={e => setStatus(e.target.value)}>
              <option value="">{t("automaticFuel.fillsOpen")}</option>
              {FILL_STATUSES.map(s => <option key={s} value={s}>{t(`automaticFuel.fill_${s}`)}</option>)}
            </select>
          </label>
        </div>
        <div className="af-review-chips">
          {FILL_STATUSES.map(s => (
            <button key={s} type="button" className="af-chip" aria-pressed={status === s} onClick={() => setStatus(status === s ? "" : s)}>
              <span className={"badge " + (STATUS_BADGE[s] || "")}>{t(`automaticFuel.fill_${s}`)}</span>
              <span>{t("automaticFuel.daysSar", { n: summary[s].days, sar: money(summary[s].sar) })}</span>
            </button>
          ))}
        </div>
      </div>

      {state.error && <div className="af-alert">{t("automaticFuel.reviewLoadFailed")}: {autoFuelErrorMessage(t, state.error)}</div>}

      <div className="af-section-head">
        <h2>{t("automaticFuel.fillsTitle", { n: visible.length })}</h2>
      </div>

      <DataTable
        columns={columns}
        data={visible}
        emptyMessage={state.loading ? t("automaticFuel.loading") : t("automaticFuel.fillsEmpty")}
        pageSize={50}
      />

      {dialog && dialog.action === "restore" && (
        <RestoreDialog
          row={{ id: dialog.row.voided_allocation_id, full_name: dialog.row.full_name, identity_number: dialog.row.identity_number,
            allocation_date: dialog.row.fill_date, amount: dialog.row.voided_amount, void_reason: dialog.row.note }}
          onCancel={() => setDialog(null)}
          onDone={done}
        />
      )}
      {dialog && dialog.action !== "restore" && (
        <ActionDialog action={dialog.action} row={dialog.row} onCancel={() => setDialog(null)} onDone={done} />
      )}
    </>
  );
}
