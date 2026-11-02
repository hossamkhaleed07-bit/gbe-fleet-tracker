import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { useLang } from "../contexts/LanguageContext";
import { useToast } from "../contexts/ToastContext";
import { sb } from "../lib/supabase";
import { fmtMoney, loadSettings, monthLabel, reverseInvoice, runAction, walletErrorMessage } from "../lib/wallet";

export function WalletModal({ title, sub, onClose, wide, children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="wlt-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={"wlt-modal" + (wide ? " wide" : "")} role="dialog" aria-modal="true" aria-label={title}>
        <div className="wlt-modal-head">
          <h2>{title} {sub && <span className="muted">· {sub}</span>}</h2>
          <button type="button" className="wlt-x" onClick={onClose} aria-label={title}><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

const NEEDS_REASON = new Set(["reallocate", "transfer"]);

// One dialog for every money operation.  `data` is the loaded month (categories,
// accounts, overview) so each field can show what is available.
export function WalletActionDialog({ type, month, data, onClose, onDone }) {
  const { t, lang } = useLang();
  const { showToast } = useToast();
  const catName = (c) => (lang === "ar" ? c.name_ar : c.name_en);
  const [f, setF] = useState({ amount: "", reason: "", category: "", fromCategory: "", toCategory: "", account: "", fromAccount: "", toAccount: "", confirm: "" });
  const set = (k) => (e) => setF(s => ({ ...s, [k]: e.target.value }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const cats = data.categories;
  const accounts = data.accounts.filter(a => a.is_active);
  const account = (code) => data.accounts.find(a => a.code === code);
  const category = (code) => cats.find(c => c.code === code);
  const fromAcc = account(f.fromAccount);
  const transferTargets = fromAcc ? accounts.filter(a => a.category_code === fromAcc.category_code && a.code !== fromAcc.code) : [];
  const topUpAcc = account(f.account);
  const word = t("wallet.dialog.closeWord");

  const hint = useMemo(() => {
    const amount = (v) => fmtMoney(v);
    if (type === "allocate") return t("wallet.dialog.available", { amount: amount(data.overview.company_unallocated) });
    if (type === "topUp" && topUpAcc) return t("wallet.dialog.available", { amount: amount(category(topUpAcc.category_code)?.undistributed) });
    if (type === "accountAllocation" && topUpAcc) return t("wallet.dialog.allocationNow", { amount: amount(topUpAcc.allocation) });
    if (type === "reallocate" && f.fromCategory) return t("wallet.dialog.available", { amount: amount(category(f.fromCategory)?.undistributed) });
    if (type === "transfer" && fromAcc) return t("wallet.dialog.balance", { amount: amount(fromAcc.balance_now) });
    return "";
  }, [type, f, data]); // eslint-disable-line react-hooks/exhaustive-deps

  const reasonRequired = NEEDS_REASON.has(type);
  const accountField = (key, label, list) => (
    <label className="wlt-field">
      <span>{t(label)}</span>
      <select value={f[key]} onChange={set(key)} required>
        <option value="">{t("wallet.dialog.choose")}</option>
        {list.map(a => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
      </select>
    </label>
  );
  const categoryField = (key, label) => (
    <label className="wlt-field">
      <span>{t(label)}</span>
      <select value={f[key]} onChange={set(key)} required>
        <option value="">{t("wallet.dialog.choose")}</option>
        {cats.map(c => <option key={c.code} value={c.code}>{catName(c)}</option>)}
      </select>
    </label>
  );

  async function submit(e) {
    e.preventDefault();
    setError("");
    if (reasonRequired && !f.reason.trim()) return setError(t("wallet.errors.WALLET_REASON_REQUIRED"));
    if (type === "close" && f.confirm.trim().toLowerCase() !== word.toLowerCase()) return setError(t("wallet.dialog.closeConfirm", { word }));
    setSaving(true);
    const { data: res, error: err } = await runAction[type]({
      month, amount: f.amount === "" ? null : Number(f.amount), reason: f.reason.trim() || null,
      category: f.category, fromCategory: f.fromCategory, toCategory: f.toCategory,
      account: f.account, fromAccount: f.fromAccount, toAccount: f.toAccount,
    });
    setSaving(false);
    if (err) return setError(walletErrorMessage(t, err));
    if (type === "topUp" && res?.over_allocation) {
      showToast(t("wallet.dialog.topUpOverAllocation", { account: f.account, topUps: fmtMoney(res.top_ups), allocation: fmtMoney(res.allocation) }), "error");
    } else if (type === "close") {
      showToast(t("wallet.dialog.closed", { month: monthLabel(month, lang), n: (res?.carried || []).length }));
    } else {
      showToast(t("wallet.dialog.done"));
    }
    onDone();
  }

  return (
    <WalletModal title={t(`wallet.actions.${type}`)} sub={type === "transfer" ? null : monthLabel(month, lang)} onClose={onClose}>
      <form className="wlt-modal-body" onSubmit={submit}>
        <p className="wlt-help">{t(`wallet.dialog.${type}Help`)}</p>
        {type === "allocate" && categoryField("category", "wallet.dialog.category")}
        {(type === "topUp" || type === "accountAllocation") && accountField("account", "wallet.dialog.account", accounts)}
        {type === "reallocate" && (
          <div className="wlt-row2">
            {categoryField("fromCategory", "wallet.dialog.fromCategory")}
            {categoryField("toCategory", "wallet.dialog.toCategory")}
          </div>
        )}
        {type === "transfer" && (
          <div className="wlt-row2">
            {accountField("fromAccount", "wallet.dialog.fromAccount", accounts)}
            {accountField("toAccount", "wallet.dialog.toAccount", transferTargets)}
          </div>
        )}
        {type !== "close" && (
          <label className="wlt-field">
            <span>{t("wallet.dialog.amount")}</span>
            <input type="number" inputMode="decimal" min="0" step="0.01" value={f.amount} onChange={set("amount")} required />
            {hint && <small>{hint}</small>}
          </label>
        )}
        <label className="wlt-field">
          <span>{t(reasonRequired ? "wallet.dialog.reasonRequired" : "wallet.dialog.reasonOptional")}</span>
          <textarea value={f.reason} onChange={set("reason")} required={reasonRequired} maxLength={500} />
        </label>
        {type === "close" && (
          <label className="wlt-field">
            <span>{t("wallet.dialog.closeConfirm", { word })}</span>
            <input value={f.confirm} onChange={set("confirm")} autoComplete="off" />
          </label>
        )}
        {error && <div className="wlt-error" role="alert">{error}</div>}
        <div className="wlt-modal-foot">
          <button type="button" className="btn" onClick={onClose}>{t("wallet.dialog.cancel")}</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? t("wallet.dialog.saving") : t("wallet.dialog.save")}</button>
        </div>
      </form>
    </WalletModal>
  );
}

// Accounts and invoice matching rules: configuration, not money (main admin).
export function WalletSettingsDialog({ onClose, onChanged }) {
  const { t, lang } = useLang();
  const { showToast } = useToast();
  const [s, setS] = useState(null);
  const [error, setError] = useState("");
  const [acc, setAcc] = useState({ category_id: "", code: "", name: "" });
  const [rule, setRule] = useState({ match_column: "card_type", match_value: "", action: "post", account_id: "", priority: "100" });

  const reload = () => loadSettings().then(r => (r.error ? setError(walletErrorMessage(t, r.error)) : setS(r)));
  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(promise) {
    setError("");
    const { error: err } = await promise;
    if (err) {
      setError(err.code === "23505" ? t("wallet.settings.duplicate") : walletErrorMessage(t, err));
      return false;
    }
    showToast(t("wallet.settings.saved"));
    await reload();
    onChanged();
    return true;
  }

  async function addAccount(e) {
    e.preventDefault();
    const ok = await run(sb.from("wallet_accounts").insert({ category_id: Number(acc.category_id), code: acc.code.trim(), name: acc.name.trim() }));
    if (ok) setAcc({ category_id: acc.category_id, code: "", name: "" });
  }
  async function addRule(e) {
    e.preventDefault();
    const ok = await run(sb.from("wallet_invoice_rules").insert({
      match_column: rule.match_column, match_value: rule.match_value.trim(), action: rule.action,
      account_id: rule.action === "post" ? Number(rule.account_id) : null, priority: Number(rule.priority) || 100,
    }));
    if (ok) setRule(r => ({ ...r, match_value: "" }));
  }

  const catName = (id) => { const c = s?.categories.find(x => x.id === id); return c ? (lang === "ar" ? c.name_ar : c.name_en) : ""; };
  const accCode = (id) => s?.accounts.find(a => a.id === id)?.code || "";

  return (
    <WalletModal title={t("wallet.settings.title")} onClose={onClose} wide>
      <div className="wlt-modal-body wlt-settings">
        {error && <div className="wlt-error" role="alert">{error}</div>}
        {!s ? <div className="wlt-empty">{t("wallet.loading")}</div> : (
          <>
            <h3>{t("wallet.settings.accounts")}</h3>
            <div className="table-wrap">
              <table>
                <thead><tr><th>{t("wallet.settings.code")}</th><th>{t("wallet.settings.name")}</th><th>{t("wallet.settings.category")}</th><th>{t("wallet.settings.active")}</th></tr></thead>
                <tbody>
                  {!s.accounts.length && <tr><td colSpan={4} className="wlt-empty">{t("wallet.settings.empty")}</td></tr>}
                  {s.accounts.map(a => (
                    <tr key={a.id}>
                      <td><b>{a.code}</b></td><td>{a.name}</td><td>{catName(a.category_id)}</td>
                      <td><input type="checkbox" checked={a.is_active} aria-label={t("wallet.settings.active")}
                        onChange={() => run(sb.from("wallet_accounts").update({ is_active: !a.is_active }).eq("id", a.id))} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <form className="wlt-inline" onSubmit={addAccount}>
              <select value={acc.category_id} onChange={e => setAcc(x => ({ ...x, category_id: e.target.value }))} required aria-label={t("wallet.settings.category")}>
                <option value="">{t("wallet.settings.category")}</option>
                {s.categories.map(c => <option key={c.id} value={c.id}>{lang === "ar" ? c.name_ar : c.name_en}</option>)}
              </select>
              <input value={acc.code} onChange={e => setAcc(x => ({ ...x, code: e.target.value }))} placeholder={t("wallet.settings.code")} required maxLength={40} />
              <input value={acc.name} onChange={e => setAcc(x => ({ ...x, name: e.target.value }))} placeholder={t("wallet.settings.name")} required maxLength={80} />
              <button type="submit" className="btn btn-primary">{t("wallet.settings.addAccount")}</button>
            </form>

            <h3>{t("wallet.settings.rules")}</h3>
            <p className="wlt-help">{t("wallet.settings.rulesHelp")}</p>
            <div className="table-wrap">
              <table>
                <thead><tr>
                  <th>{t("wallet.settings.matchColumn")}</th><th>{t("wallet.settings.matchValue")}</th><th>{t("wallet.settings.action")}</th>
                  <th>{t("wallet.settings.account")}</th><th>{t("wallet.settings.priority")}</th><th>{t("wallet.settings.active")}</th><th />
                </tr></thead>
                <tbody>
                  {!s.rules.length && <tr><td colSpan={7} className="wlt-empty">{t("wallet.settings.empty")}</td></tr>}
                  {s.rules.map(r => (
                    <tr key={r.id}>
                      <td>{t(`wallet.settings.columns.${r.match_column}`)}</td><td><b>{r.match_value}</b></td>
                      <td>{t(r.action === "post" ? "wallet.settings.actionPost" : "wallet.settings.actionExclude")}</td>
                      <td>{accCode(r.account_id)}</td><td className="num-cell">{r.priority}</td>
                      <td><input type="checkbox" checked={r.is_active} aria-label={t("wallet.settings.active")}
                        onChange={() => run(sb.from("wallet_invoice_rules").update({ is_active: !r.is_active }).eq("id", r.id))} /></td>
                      <td><button type="button" className="wlt-link-btn"
                        onClick={() => window.confirm(t("wallet.settings.deleteConfirm")) && run(sb.from("wallet_invoice_rules").delete().eq("id", r.id))}>
                        {t("wallet.settings.delete")}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <form className="wlt-inline" onSubmit={addRule}>
              <select value={rule.match_column} onChange={e => setRule(x => ({ ...x, match_column: e.target.value }))} aria-label={t("wallet.settings.matchColumn")}>
                <option value="card_type">{t("wallet.settings.columns.card_type")}</option>
                <option value="branch">{t("wallet.settings.columns.branch")}</option>
              </select>
              <input value={rule.match_value} onChange={e => setRule(x => ({ ...x, match_value: e.target.value }))} placeholder={t("wallet.settings.matchValue")} required maxLength={80} />
              <select value={rule.action} onChange={e => setRule(x => ({ ...x, action: e.target.value }))} aria-label={t("wallet.settings.action")}>
                <option value="post">{t("wallet.settings.actionPost")}</option>
                <option value="exclude">{t("wallet.settings.actionExclude")}</option>
              </select>
              {rule.action === "post" && (
                <select value={rule.account_id} onChange={e => setRule(x => ({ ...x, account_id: e.target.value }))} required aria-label={t("wallet.settings.account")}>
                  <option value="">{t("wallet.settings.account")}</option>
                  {s.accounts.filter(a => a.is_active).map(a => <option key={a.id} value={a.id}>{a.code}</option>)}
                </select>
              )}
              <input type="number" value={rule.priority} onChange={e => setRule(x => ({ ...x, priority: e.target.value }))} aria-label={t("wallet.settings.priority")} style={{ width: "5.5rem" }} />
              <button type="submit" className="btn btn-primary">{t("wallet.settings.addRule")}</button>
            </form>
          </>
        )}
      </div>
    </WalletModal>
  );
}

// Cancel or reject a posted invoice (from the invoices grid).  The reason is required;
// the database records who and when, and refuses a second reversal.
export function ReverseInvoiceDialog({ invoice, onClose, onDone }) {
  const { t } = useLang();
  const { showToast } = useToast();
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const action = t(invoice.kind === "cancelled" ? "wallet.invoice.cancel" : "wallet.invoice.reject");

  async function submit(e) {
    e.preventDefault();
    if (!reason.trim()) return setError(t("wallet.errors.WALLET_REASON_REQUIRED"));
    setSaving(true);
    const { error: err } = await reverseInvoice(invoice.id, invoice.kind, reason.trim());
    setSaving(false);
    if (err) return setError(walletErrorMessage(t, err));
    showToast(t("wallet.invoice.done", { kind: t(`wallet.invoice.${invoice.kind}`) }));
    onDone();
  }

  return (
    <WalletModal title={action} sub={invoice.number || ""} onClose={onClose}>
      <form className="wlt-modal-body" onSubmit={submit}>
        <label className="wlt-field">
          <span>{t("wallet.invoice.reasonPrompt", { action })}</span>
          <textarea value={reason} onChange={e => setReason(e.target.value)} required maxLength={500} autoFocus />
        </label>
        {error && <div className="wlt-error" role="alert">{error}</div>}
        <div className="wlt-modal-foot">
          <button type="button" className="btn" onClick={onClose}>{t("wallet.dialog.cancel")}</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? t("wallet.dialog.saving") : action}</button>
        </div>
      </form>
    </WalletModal>
  );
}
