import { useCallback, useEffect, useMemo, useState } from "react";
import { useDashboard } from "../contexts/DataContext";
import { useAuth } from "../contexts/AuthContext";
import { useLang } from "../contexts/LanguageContext";
import { useToast } from "../contexts/ToastContext";
import DataTable from "./DataTable";
import { formatLocalDateTime } from "../lib/calc";
import { autoFuelErrorMessage, buildDriverAmountRows, loadAmounts, parseAmount, setDefaultAmount, setDriverAmount } from "../lib/automaticFuel";

// Inline amount editor: a number input plus Save / Cancel. Calls onSave(amount)
// with a parsed positive number.
function AmountEditor({ initial, onSave, onCancel }) {
  const { t } = useLang();
  const [value, setValue] = useState(initial == null ? "" : String(initial));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save(e) {
    e.preventDefault();
    const amount = parseAmount(value);
    if (amount == null) { setError(t("automaticFuel.errors.AUTO_FUEL_AMOUNT_MUST_BE_POSITIVE")); return; }
    setError("");
    setSaving(true);
    // On success the parent closes the editor; on failure it shows a toast and the editor stays open.
    await onSave(amount);
    setSaving(false);
  }

  return (
    <form className="af-editor" onSubmit={save}>
      <input type="number" min="0.01" step="0.01" value={value} autoFocus onChange={e => setValue(e.target.value)} aria-label={t("automaticFuel.dailyAmount")} />
      <button type="submit" className={"btn af-save" + (saving ? " btn-loading" : "")} disabled={saving}>{t("common.save")}</button>
      <button type="button" className="btn" onClick={onCancel} disabled={saving}>{t("common.cancel")}</button>
      {error && <span className="af-error">{error}</span>}
    </form>
  );
}

export default function AutomaticFuelAmounts() {
  const { allDrivers } = useDashboard();
  const { isAdmin } = useAuth();
  const { t } = useLang();
  const { showToast } = useToast();

  const [state, setState] = useState({ loading: true, error: null, defaultAmount: null, settings: null, driverAmounts: [], changes: [] });
  const [editingDefault, setEditingDefault] = useState(false);
  const [editingDriver, setEditingDriver] = useState(null);
  const [search, setSearch] = useState("");

  const reload = useCallback(async () => {
    const res = await loadAmounts();
    setState(s => res.error ? { ...s, loading: false, error: res.error } : { ...res, loading: false });
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const namesById = useMemo(() => Object.fromEntries(allDrivers.map(d => [d.identity_number, d.full_name])), [allDrivers]);

  const rows = useMemo(() => {
    const all = buildDriverAmountRows(allDrivers, state.driverAmounts, state.defaultAmount);
    const s = search.trim().toLowerCase();
    return s ? all.filter(r => (r.full_name || "").toLowerCase().includes(s) || (r.identity_number || "").includes(s)) : all;
  }, [allDrivers, state.driverAmounts, state.defaultAmount, search]);

  // Runs one admin operation; on success reloads amounts + log and shows a toast.
  const run = useCallback(async (promise) => {
    const { error } = await promise;
    if (error) { showToast(autoFuelErrorMessage(t, error), "error"); return false; }
    showToast(t("automaticFuel.saved"));
    await reload();
    return true;
  }, [reload, showToast, t]);

  const driverColumns = useMemo(() => [
    { accessorKey: "full_name", header: t("fuel.colDriver"), cell: ({ getValue }) => getValue() || "—" },
    { accessorKey: "identity_number", header: t("fuel.colIdNumber") },
    { accessorKey: "vehicle_plate", header: t("fuel.colPlate"), cell: ({ getValue }) => getValue() || "—" },
    {
      accessorKey: "amount", header: t("automaticFuel.dailyAmount"), meta: { align: "end" },
      cell: ({ row }) => {
        const r = row.original;
        if (editingDriver === r.identity_number) {
          return (
            <AmountEditor
              initial={r.amount}
              onCancel={() => setEditingDriver(null)}
              onSave={async (amount) => { const ok = await run(setDriverAmount(r.identity_number, amount)); if (ok) setEditingDriver(null); return ok; }}
            />
          );
        }
        return (
          <span className="af-amount">
            {r.amount == null ? "—" : r.amount.toFixed(2)}
            <span className={"badge " + (r.isDefault ? "af-badge-default" : "af-badge-own")}>
              {r.isDefault ? t("automaticFuel.badgeDefault") : t("automaticFuel.badgeOwn")}
            </span>
          </span>
        );
      },
    },
    {
      id: "updated", header: t("automaticFuel.lastChange"), enableSorting: false,
      cell: ({ row }) => row.original.updated_at ? `${formatLocalDateTime(row.original.updated_at)} · ${row.original.updated_by || "—"}` : "—",
    },
    ...(isAdmin ? [{
      id: "actions", header: "", enableSorting: false,
      cell: ({ row }) => {
        const r = row.original;
        if (editingDriver === r.identity_number) return null;
        return (
          <div className="af-actions">
            <button className="btn" onClick={() => setEditingDriver(r.identity_number)}>{t("automaticFuel.edit")}</button>
            {!r.isDefault && (
              <button className="btn" onClick={() => {
                if (window.confirm(t("automaticFuel.resetConfirm", { name: r.full_name || r.identity_number, amount: Number(state.defaultAmount).toFixed(2) }))) {
                  run(setDriverAmount(r.identity_number, null));
                }
              }}>{t("automaticFuel.resetToDefault")}</button>
            )}
          </div>
        );
      },
    }] : []),
  ], [t, isAdmin, editingDriver, run, state.defaultAmount]);

  const changeColumns = useMemo(() => [
    { id: "changed_at", header: t("automaticFuel.colChangedAt"), accessorFn: c => c.changed_at, cell: ({ getValue }) => formatLocalDateTime(getValue()) },
    { id: "kind", header: t("automaticFuel.colKind"), accessorFn: c => c.kind, cell: ({ getValue }) => <span className="badge af-badge-kind">{t(`automaticFuel.kind_${getValue()}`)}</span> },
    { id: "driver", header: t("fuel.colDriver"), accessorFn: c => c.identity_number ? (namesById[c.identity_number] || c.identity_number) : "—" },
    { id: "allocation_date", header: t("automaticFuel.colAllocationDay"), accessorFn: c => c.allocation_date || "—" },
    {
      id: "amounts", header: t("automaticFuel.colOldNew"), enableSorting: false,
      cell: ({ row }) => {
        const c = row.original;
        const fmt = (v) => v == null ? t("automaticFuel.badgeDefault") : Number(v).toFixed(2);
        return <span className="af-old-new">{t("automaticFuel.oldToNew", { old: fmt(c.old_amount), new: fmt(c.new_amount) })}</span>;
      },
    },
    { id: "reason", header: t("automaticFuel.colReason"), accessorFn: c => c.reason || "—" },
    { id: "changed_by", header: t("automaticFuel.colChangedBy"), accessorFn: c => c.changed_by || "—" },
  ], [t, namesById]);

  if (state.loading) return <div className="af-panel">{t("common.loading")}</div>;
  if (state.error) {
    return (
      <div role="alert" className="af-alert">
        {t("automaticFuel.loadFailed")}: {autoFuelErrorMessage(t, state.error)}
      </div>
    );
  }

  return (
    <div className="af-amounts">
      <section className="af-panel af-default">
        <div>
          <div className="af-label">{t("automaticFuel.defaultAmount")}</div>
          {editingDefault ? (
            <AmountEditor
              initial={state.defaultAmount}
              onCancel={() => setEditingDefault(false)}
              onSave={async (amount) => { const ok = await run(setDefaultAmount(amount)); if (ok) setEditingDefault(false); return ok; }}
            />
          ) : (
            <div className="af-default-value">{state.defaultAmount == null ? "—" : state.defaultAmount.toFixed(2)}</div>
          )}
          <p className="af-hint">{t("automaticFuel.defaultHint")}</p>
          {state.settings?.updated_at && (
            <p className="af-hint">{t("automaticFuel.lastChange")}: {formatLocalDateTime(state.settings.updated_at)} · {state.settings.updated_by || "—"}</p>
          )}
        </div>
        {isAdmin && !editingDefault && <button className="btn" onClick={() => setEditingDefault(true)}>{t("automaticFuel.edit")}</button>}
      </section>

      <p className="af-hint">{isAdmin ? t("automaticFuel.appliesToFuture") : t("automaticFuel.readOnly")}</p>

      <div className="af-section-head">
        <h2>{t("automaticFuel.driversTitle", { n: rows.length })}</h2>
        <input type="text" className="af-search" value={search} onChange={e => setSearch(e.target.value)} placeholder={t("common.searchByNameOrId")} />
      </div>
      <DataTable columns={driverColumns} data={rows} emptyMessage={t("automaticFuel.noDrivers")} pageSize={25} />

      <div className="af-section-head">
        <h2>{t("automaticFuel.changesTitle")}</h2>
      </div>
      <DataTable columns={changeColumns} data={state.changes} emptyMessage={t("automaticFuel.noChanges")} pageSize={15} />
    </div>
  );
}
