import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import {
  ArrowLeftRight, Banknote, CircleAlert, CircleCheck, Coins, Info, Landmark, Layers, PiggyBank, Receipt, RefreshCw, Settings,
  TriangleAlert, Undo2, Wallet,
} from "lucide-react";
import HeroPortal from "../components/HeroPortal";
import { WalletActionDialog, WalletSettingsDialog } from "../components/WalletDialogs";
import { useAuth } from "../contexts/AuthContext";
import { useLang } from "../contexts/LanguageContext";
import { useToast } from "../contexts/ToastContext";
import {
  ACTIONS, fmtMoney, isNotInstalled, loadWallet, monthLabel, monthOptions, monthStart, postPendingInvoices, walletErrorMessage,
} from "../lib/wallet";
import "../wallet.css";

const LEDGER_SHOWN = 300;
const UNPOSTED_SHOWN = 200;

export default function WalletOverview() {
  const { isAdmin, isFleetManager, isViewer } = useAuth();
  const { t, lang } = useLang();
  const { showToast } = useToast();
  const [month, setMonth] = useState(() => monthStart());
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState(null);
  const [posting, setPosting] = useState(false);
  const canSeeInvoices = isAdmin || isFleetManager;

  const load = useCallback(async () => {
    setLoading(true);
    const r = await loadWallet(month, { canSeeInvoices });
    setLoading(false);
    if (r.error) { setError(r.error); return; }
    setError(null);
    setData(r);
  }, [month, canSeeInvoices]);
  useEffect(() => { load(); }, [load]);

  const money = (v) => <><small>{t("fuel.amountPrefix")}</small>{fmtMoney(v)}</>;
  const catName = (c) => (c ? (lang === "ar" ? c.name_ar : c.name_en) : "");
  const dateTime = (v) => (v ? new Date(v).toLocaleString(lang === "ar" ? "ar-EG" : "en-US", { dateStyle: "medium", timeStyle: "short" }) : "");

  const maps = useMemo(() => {
    if (!data) return null;
    return {
      cat: Object.fromEntries(data.categories.map(c => [c.category_id, c])),
      catByCode: Object.fromEntries(data.categories.map(c => [c.code, c])),
      acc: Object.fromEntries(data.accounts.map(a => [a.account_id, a])),
      period: Object.fromEntries(data.periods.map(p => [p.id, p])),
    };
  }, [data]);

  if (!isAdmin && !isFleetManager && !isViewer) return <Navigate to="/overview" replace />;

  const header = (
    <HeroPortal target="fx-hero-actions" className="content-header">
      <div>
        <div className="breadcrumb">{t("wallet.breadcrumb")} &gt; <b>{t("wallet.nav")}</b></div>
        <h1 className="page-title">{t("wallet.title")}</h1>
      </div>
    </HeroPortal>
  );

  if (error) {
    const notInstalled = isNotInstalled(error);
    return (
      <div className="wlt">
        {header}
        <div className="panel wlt-blank">
          <h3>{notInstalled ? t("wallet.notInstalledTitle") : t("wallet.errors.UNKNOWN")}</h3>
          <p>{notInstalled ? t("wallet.notInstalledBody") : walletErrorMessage(t, error)}</p>
          <p><button type="button" className="btn" style={{ width: "auto", marginTop: "1rem" }} onClick={load}>{t("wallet.retry")}</button></p>
        </div>
      </div>
    );
  }
  if (!data) return <div className="wlt">{header}<div className="panel wlt-empty">{t("wallet.loading")}</div></div>;

  const o = data.overview;
  const status = o.period_status;
  const closed = status === "closed";
  const brokenRecon = data.reconciliation.filter(r => !r.ok);
  const over = data.accounts.filter(a => a.over_allocation);
  const negative = data.accounts.filter(a => a.negative_balance);
  const names = (list) => list.map(a => a.code).join("، ");

  async function postPending() {
    setPosting(true);
    const { data: n, error: err } = await postPendingInvoices();
    setPosting(false);
    if (err) return showToast(walletErrorMessage(t, err), "error");
    showToast(t("wallet.unposted.posted", { n }));
    load();
  }

  // What a ledger row is about, in words.
  function details(tx) {
    const acc = (id) => maps.acc[id]?.code || "—";
    const cat = (id) => catName(maps.cat[id]);
    const arrow = <span className="arrow">{lang === "ar" ? "←" : "→"}</span>;
    const inv = tx.invoice_snapshot?.invoice_number;
    const adj = tx.is_adjustment && (
      <span className="badge info">{t("wallet.ledger.adjustment", { month: monthLabel(maps.period[tx.original_period_id]?.month || "", lang) })}</span>
    );
    switch (tx.tx_type) {
      case "company_budget": return t("wallet.ledger.external");
      case "category_allocation": return <>{t("wallet.ledger.company")}{arrow}{cat(tx.category_id)}</>;
      case "reallocation": return <>{cat(tx.category_id)}{arrow}{cat(tx.to_category_id)}</>;
      case "top_up": return <>{cat(tx.category_id)}{arrow}<b>{acc(tx.account_id)}</b></>;
      case "internal_transfer": return <><b>{acc(tx.account_id)}</b>{arrow}<b>{acc(tx.to_account_id)}</b></>;
      case "expense": return <><b>{acc(tx.account_id)}</b> · {t("wallet.ledger.invoice", { n: inv || "—" })} {adj}</>;
      case "reversal": return (
        <><b>{acc(tx.account_id)}</b> · {t("wallet.ledger.invoice", { n: inv || "—" })}{" "}
          <span className={"badge " + (tx.reversal_kind === "rejected" ? "bad" : "warn")}>{t(`wallet.reversalKind.${tx.reversal_kind}`)}</span> {adj}</>
      );
      case "carry_forward": return (
        <>{tx.category_id ? cat(tx.category_id) : t("wallet.ledger.company")} ·{" "}
          {t("wallet.ledger.fromMonth", { month: monthLabel(maps.period[tx.source_period_id]?.month || "", lang) })}</>
      );
      default: return "";
    }
  }

  const kpis = [
    { key: "companyBudget", icon: <Landmark size={19} />, tone: "blue", value: o.company_budget,
      sub: [Number(o.company_carried_in) > 0 && t("wallet.kpi.companyCarried", { amount: fmtMoney(o.company_carried_in) }),
            Number(o.company_unallocated) > 0 && t("wallet.kpi.companyUnallocated", { amount: fmtMoney(o.company_unallocated) })].filter(Boolean).join(" · ") },
    { key: "categoryAllocations", icon: <Layers size={19} />, tone: "purple", value: o.total_category_allocations },
    { key: "undistributed", icon: <PiggyBank size={19} />, tone: "cyan", value: o.total_undistributed, sub: t("wallet.kpi.undistributedHint") },
    { key: "distributed", icon: <Coins size={19} />, tone: "green", value: o.total_distributed_to_accounts },
    { key: "balances", icon: <Wallet size={19} />, tone: "blue", value: o.total_account_balances, sub: t("wallet.kpi.balancesAsOf") },
    { key: "expenses", icon: <Receipt size={19} />, tone: "orange", value: o.total_expenses },
    { key: "transfers", icon: <ArrowLeftRight size={19} />, tone: "purple", value: o.total_internal_transfers },
    { key: "reversed", icon: <Undo2 size={19} />, tone: "red", value: o.total_reversed_expenses },
  ];

  const checkScope = (r) => (r.scope === "company" ? t("wallet.recon.company") : r.scope === "total" ? t("wallet.recon.total") : catName(maps.catByCode[r.scope]) || r.scope);
  const periodInfo = data.period;

  return (
    <div className="wlt">
      {header}

      <div className="wlt-toolbar">
        <label className="wlt-field" style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
          <span>{t("wallet.month")}</span>
          <select value={month} onChange={e => setMonth(e.target.value)}>
            {monthOptions(data.periods).map(m => <option key={m} value={m}>{monthLabel(m, lang)}</option>)}
          </select>
        </label>
        <span className={"wlt-status " + status}>{t(`wallet.periodStatus.${status}`)}</span>
        <button type="button" className="btn" style={{ width: "auto" }} onClick={load} disabled={loading} aria-label={t("wallet.refresh")} title={t("wallet.refresh")}>
          <RefreshCw size={15} />
        </button>
        <span className="spacer" />
        {isAdmin && (
          <div className="wlt-actions">
            {ACTIONS.filter(a => a !== "close").map(a => (
              <button key={a} type="button" className="btn" disabled={closed && a !== "transfer"} onClick={() => setDialog({ type: a })}>{t(`wallet.actions.${a}`)}</button>
            ))}
            <button type="button" className="btn" disabled={closed} onClick={() => setDialog({ type: "close" })}>{t("wallet.actions.close")}</button>
            <button type="button" className="btn" onClick={() => setDialog({ type: "settings" })}><Settings size={14} /> {t("wallet.actions.settings")}</button>
          </div>
        )}
      </div>

      <div className="wlt-alerts">
        {closed && periodInfo && (
          <div className="wlt-alert neutral"><Info size={16} />{t("wallet.closedInfo", { by: periodInfo.closed_by_email || "—", at: dateTime(periodInfo.closed_at) })}</div>
        )}
        {brokenRecon.length > 0 && <div className="wlt-alert danger" role="alert"><CircleAlert size={16} />{t("wallet.alerts.reconBroken")}</div>}
        {over.length > 0 && <div className="wlt-alert warning"><TriangleAlert size={16} />{t("wallet.alerts.overAllocation", { n: over.length, names: names(over) })}</div>}
        {negative.length > 0 && <div className="wlt-alert warning"><TriangleAlert size={16} />{t("wallet.alerts.negative", { n: negative.length, names: names(negative) })}</div>}
        {o.unposted_invoices > 0 && <div className="wlt-alert info"><Receipt size={16} />{t("wallet.alerts.unposted", { n: o.unposted_invoices })}</div>}
        {o.adjustments > 0 && <div className="wlt-alert info"><Info size={16} />{t("wallet.alerts.adjustments", { n: o.adjustments })}</div>}
      </div>

      <div className="kpi-dot-grid">
        {kpis.map(k => (
          <div key={k.key} className="kpi-dot-card no-dot">
            <div className={"icon-wrap " + k.tone}>{k.icon}</div>
            <div className="label">{t(`wallet.kpi.${k.key}`)}</div>
            <div className="num">{money(k.value)}</div>
            {k.sub && <div className="sub">{k.sub}</div>}
          </div>
        ))}
      </div>

      <div className="panel wlt-section">
        <div className="ov-block-head"><div><h3>{t("wallet.recon.title")}</h3><span className="ov-block-sub">{t("wallet.recon.sub")}</span></div></div>
        <div className="table-wrap">
          <table>
            <thead><tr>
              <th>{t("wallet.recon.colCheck")}</th><th className="num-cell">{t("wallet.recon.colLeft")}</th>
              <th className="num-cell" aria-hidden="true" /><th className="num-cell">{t("wallet.recon.colRight")}</th><th>{t("wallet.recon.colStatus")}</th>
            </tr></thead>
            <tbody>
              {data.reconciliation.map((r, i) => (
                <tr key={i} className={"wlt-recon-row" + (r.ok ? "" : " broken")}>
                  <td><b>{t(`wallet.recon.checks.${r.check_code}.label`)}</b><span className="wlt-recon-formula">{checkScope(r)}</span></td>
                  <td className="num-cell"><span className="wlt-recon-formula">{t(`wallet.recon.checks.${r.check_code}.left`)}</span>{fmtMoney(r.left_value)}</td>
                  <td className="num-cell muted">=</td>
                  <td className="num-cell"><span className="wlt-recon-formula">{t(`wallet.recon.checks.${r.check_code}.right`)}</span>{fmtMoney(r.right_value)}</td>
                  <td>{r.ok
                    ? <span className="wlt-ok"><CircleCheck size={15} />{t("wallet.recon.ok")}</span>
                    : <span className="wlt-bad"><CircleAlert size={15} />{t("wallet.recon.broken")} · {t("wallet.recon.difference", { amount: fmtMoney(Number(r.left_value) - Number(r.right_value)) })}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel wlt-section">
        <div className="ov-block-head"><h3>{t("wallet.categories.title")}</h3></div>
        <div className="table-wrap">
          <table>
            <thead><tr>
              <th>{t("wallet.categories.colCategory")}</th>
              <th className="num-cell">{t("wallet.categories.colAllocated")}</th>
              <th className="num-cell">{t("wallet.categories.colCarriedIn")}</th>
              <th className="num-cell">{t("wallet.categories.colRealloc")}</th>
              <th className="num-cell">{t("wallet.categories.colEffective")}</th>
              <th className="num-cell">{t("wallet.categories.colTopUps")}</th>
              <th className="num-cell">{t("wallet.categories.colUndistributed")}</th>
              <th className="num-cell">{t("wallet.categories.colCarriedOut")}</th>
            </tr></thead>
            <tbody>
              {data.categories.map(c => {
                const net = Number(c.reallocated_in) - Number(c.reallocated_out);
                return (
                  <tr key={c.code}>
                    <td><b>{catName(c)}</b></td>
                    <td className="num-cell">{fmtMoney(c.allocated)}</td>
                    <td className="num-cell">{fmtMoney(c.carried_in)}</td>
                    <td className="num-cell">{net > 0 ? "+" : ""}{fmtMoney(net)}</td>
                    <td className="num-cell"><b>{fmtMoney(c.effective_allocation)}</b></td>
                    <td className="num-cell">{fmtMoney(c.top_ups)}</td>
                    <td className="num-cell"><b>{fmtMoney(c.undistributed)}</b></td>
                    <td className="num-cell">{fmtMoney(c.carried_out)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel wlt-section">
        <div className="ov-block-head"><h3>{t("wallet.accounts.title")}</h3></div>
        <div className="table-wrap">
          <table>
            <thead><tr>
              <th>{t("wallet.accounts.colAccount")}</th><th>{t("wallet.accounts.colCategory")}</th>
              <th className="num-cell">{t("wallet.accounts.colAllocation")}</th>
              <th className="num-cell">{t("wallet.accounts.colTopUps")}</th>
              <th className="num-cell">{t("wallet.accounts.colExpenses")}</th>
              <th className="num-cell">{t("wallet.accounts.colReversals")}</th>
              <th className="num-cell">{t("wallet.accounts.colTransfers")}</th>
              <th className="num-cell">{t("wallet.accounts.colBalance")}</th>
              <th className="num-cell">{t("wallet.accounts.colBalanceNow")}</th>
              <th />
            </tr></thead>
            <tbody>
              {!data.accounts.length && <tr><td colSpan={10} className="wlt-empty">{t("wallet.accounts.empty")}</td></tr>}
              {data.accounts.map(a => {
                const net = Number(a.transfers_in) - Number(a.transfers_out);
                return (
                  <tr key={a.account_id} className={a.over_allocation || a.negative_balance ? "flagged" : ""}>
                    <td><b>{a.code}</b> <span className="muted">{a.name !== a.code ? a.name : ""}</span></td>
                    <td>{catName(maps.catByCode[a.category_code])}</td>
                    <td className="num-cell">{a.allocation == null ? <span className="muted">{t("wallet.accounts.noAllocation")}</span> : fmtMoney(a.allocation)}</td>
                    <td className="num-cell">{fmtMoney(a.top_ups)}</td>
                    <td className="num-cell">{fmtMoney(a.expenses)}</td>
                    <td className="num-cell">{fmtMoney(a.reversals)}</td>
                    <td className="num-cell">{net > 0 ? "+" : ""}{fmtMoney(net)}</td>
                    <td className={"num-cell" + (Number(a.balance) < 0 ? " neg" : "")}><b>{fmtMoney(a.balance)}</b></td>
                    <td className={"num-cell" + (Number(a.balance_now) < 0 ? " neg" : "")}>{fmtMoney(a.balance_now)}</td>
                    <td>
                      {a.over_allocation && <span className="badge warn">{t("wallet.accounts.overAllocation")}</span>}
                      {a.negative_balance && <span className="badge bad">{t("wallet.accounts.negative")}</span>}
                      {!a.is_active && <span className="badge neutral">{t("wallet.accounts.inactive")}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {canSeeInvoices && (
        <div className="panel wlt-section">
          <div className="ov-block-head">
            <div><h3>{t("wallet.unposted.title")} ({data.unposted.length})</h3><span className="ov-block-sub">{t("wallet.unposted.sub")}</span></div>
            {isAdmin && data.unposted.length > 0 && (
              <button type="button" className="btn btn-primary" style={{ width: "auto" }} onClick={postPending} disabled={posting}>
                <Banknote size={15} /> {t("wallet.unposted.postPending")}
              </button>
            )}
          </div>
          {!data.unposted.length ? <div className="wlt-empty">{t("wallet.unposted.none")}</div> : (
            <div className="table-wrap">
              <table>
                <thead><tr>
                  <th>{t("wallet.unposted.colInvoice")}</th><th>{t("wallet.unposted.colDate")}</th>
                  <th>{t("wallet.unposted.colCardType")}</th><th>{t("wallet.unposted.colBranch")}</th>
                  <th className="num-cell">{t("wallet.unposted.colCost")}</th><th>{t("wallet.unposted.colReason")}</th>
                </tr></thead>
                <tbody>
                  {data.unposted.slice(0, UNPOSTED_SHOWN).map(u => (
                    <tr key={u.invoice_id}>
                      <td><b>{u.invoice_number || "—"}</b></td><td>{u.entry_date || "—"}</td>
                      <td>{u.card_type || "—"}</td><td>{u.branch || "—"}</td>
                      <td className="num-cell">{fmtMoney(u.cost)}</td>
                      <td><span className={"badge " + (u.reason === "not_posted" ? "info" : "warn")}>{t(`wallet.unposted.reasons.${u.reason}`)}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.unposted.length > UNPOSTED_SHOWN && <p className="wlt-note">{t("wallet.unposted.more", { n: UNPOSTED_SHOWN })}</p>}
        </div>
      )}

      <div className="panel wlt-section">
        <div className="ov-block-head"><div><h3>{t("wallet.ledger.title")}</h3><span className="ov-block-sub">{t("wallet.ledger.sub")}</span></div></div>
        {!data.ledger.length ? <div className="wlt-empty">{t("wallet.ledger.empty")}</div> : (
          <div className="table-wrap">
            <table>
              <thead><tr>
                <th>{t("wallet.ledger.colDate")}</th><th>{t("wallet.ledger.colType")}</th><th>{t("wallet.ledger.colDetails")}</th>
                <th className="num-cell">{t("wallet.ledger.colAmount")}</th><th>{t("wallet.ledger.colBy")}</th><th>{t("wallet.ledger.colReason")}</th>
              </tr></thead>
              <tbody>
                {data.ledger.map(tx => (
                  <tr key={tx.id}>
                    <td>{dateTime(tx.created_at)}</td>
                    <td>{t(`wallet.tx.${tx.tx_type}`)}</td>
                    <td className="details">{details(tx)}</td>
                    <td className="num-cell"><b>{fmtMoney(tx.amount)}</b></td>
                    <td className="muted">{tx.created_by_email || "—"}</td>
                    <td className="reason">{tx.reason || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.ledger.length >= LEDGER_SHOWN && <p className="wlt-note">{t("wallet.ledger.more", { n: LEDGER_SHOWN })}</p>}
      </div>

      {dialog?.type === "settings" && <WalletSettingsDialog onClose={() => setDialog(null)} onChanged={load} />}
      {dialog && dialog.type !== "settings" && (
        <WalletActionDialog type={dialog.type} month={month} data={data} onClose={() => setDialog(null)} onDone={() => { setDialog(null); load(); }} />
      )}
    </div>
  );
}
