// Wallet (migration 060).  All money logic lives in the database; this file only
// calls its functions and turns its error codes into translated messages.
import { sb } from "./supabase";

export const TX_TYPES = [
  "company_budget", "category_allocation", "reallocation", "top_up", "expense", "reversal", "internal_transfer", "carry_forward",
];
export const RECON_CHECKS = ["company_budget", "category_allocation", "top_ups_vs_balances", "transfers_net_zero", "unbalanced_movements"];
export const UNPOSTED_REASONS = ["no_rule", "inactive_account", "missing_cost", "not_posted"];
export const ACTIONS = ["budget", "allocate", "accountAllocation", "topUp", "reallocate", "transfer", "close"];

// Every WALLET_* code the database can raise.  The page shows wallet.errors.<CODE>;
// codes that carry an amount pass it as {available}.
export const ERROR_CODES = [
  "WALLET_ADMIN_ONLY", "WALLET_NO_ACCESS", "WALLET_REASON_REQUIRED", "WALLET_AMOUNT_MUST_BE_POSITIVE",
  "WALLET_AMOUNT_MAX_TWO_DECIMALS", "WALLET_AMOUNT_MUST_NOT_BE_NEGATIVE", "WALLET_MONTH_REQUIRED", "WALLET_BEFORE_START",
  "WALLET_PERIOD_CLOSED", "WALLET_BUDGET_ALREADY_SET", "WALLET_ALLOCATION_EXCEEDS_COMPANY_BUDGET",
  "WALLET_TOPUP_EXCEEDS_UNDISTRIBUTED", "WALLET_REALLOCATION_EXCEEDS_UNDISTRIBUTED", "WALLET_TRANSFER_EXCEEDS_BALANCE",
  "WALLET_TRANSFER_ACROSS_CATEGORIES", "WALLET_SAME_CATEGORY", "WALLET_SAME_ACCOUNT", "WALLET_ACCOUNT_INACTIVE",
  "WALLET_UNKNOWN_ACCOUNT", "WALLET_UNKNOWN_CATEGORY", "WALLET_INVOICE_NOT_POSTED", "WALLET_INVOICE_ALREADY_REVERSED",
  "WALLET_BAD_REVERSAL_KIND", "WALLET_INVOICE_POSTED_CANNOT_DELETE", "WALLET_INVOICE_POSTED_LOCKED",
  "WALLET_ACCOUNT_CATEGORY_LOCKED", "WALLET_ACCOUNT_CODE_LOCKED", "WALLET_APPEND_ONLY",
  "WALLET_PERIOD_CANNOT_BE_DELETED", "WALLET_PERIOD_ONLY_OPEN_TO_CLOSED",
];

// "Wallet is not installed" (060 not run yet): PostgREST cannot find the function or table.
export function isNotInstalled(error) {
  return !!error && (error.code === "PGRST202" || error.code === "PGRST205" || error.code === "42P01" || error.code === "42883");
}

// The translation key and values for a database error, or null for an unknown error.
export function walletError(error) {
  if (!error) return null;
  if (isNotInstalled(error)) return { key: "wallet.errors.NOT_INSTALLED", vars: {} };
  const msg = `${error.message || ""} ${error.details || ""}`;
  const code = ERROR_CODES.find(c => msg.includes(c));
  if (!code) return null;
  return { key: `wallet.errors.${code}`, vars: { available: fmtMoney(error.hint), value: error.hint ?? "" } };
}

export function walletErrorMessage(t, error) {
  const e = walletError(error);
  return e ? t(e.key, e.vars) : (error?.message || t("wallet.errors.UNKNOWN"));
}

export function fmtMoney(v) {
  const n = Number(v);
  if (v == null || v === "" || Number.isNaN(n)) return "—";
  // the left-to-right mark keeps a minus sign in front of the number on Arabic (RTL) pages
  return "‎" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// First day of the month, as YYYY-MM-DD, in Riyadh (the database's "today").
export function monthStart(date = new Date()) {
  const d = new Date(date.toLocaleString("en-US", { timeZone: "Asia/Riyadh" }));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export const WALLET_START = "2026-11-01";

export function monthLabel(month, lang) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

// Months to choose from: from the wallet start through the latest of today and any period row.
export function monthOptions(periods, today = monthStart()) {
  const last = [today, ...periods.map(p => p.month)].sort().at(-1);
  const out = [];
  let [y, m] = WALLET_START.split("-").map(Number);
  for (;;) {
    const key = `${y}-${String(m).padStart(2, "0")}-01`;
    out.push(key);
    if (key >= last) break;
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return out.reverse();
}

const rpc = (name, args) => sb.rpc(name, args);

// Everything the Wallet Overview shows for one month, in parallel.  `canSeeInvoices`:
// the unposted list is for admin and fleet manager only.
export async function loadWallet(month, { canSeeInvoices }) {
  const [overview, categories, accounts, reconciliation, periods, unposted] = await Promise.all([
    rpc("wallet_overview", { p_month: month }),
    rpc("wallet_category_summary", { p_month: month }),
    rpc("wallet_account_summary", { p_month: month }),
    rpc("wallet_reconciliation", { p_month: month }),
    sb.from("wallet_periods").select("id,month,status,closed_at,closed_by_email,close_reason").order("month"),
    canSeeInvoices ? rpc("wallet_unposted_invoices") : Promise.resolve({ data: [], error: null }),
  ]);
  const error = [overview, categories, accounts, reconciliation, periods, unposted].map(r => r.error).find(Boolean);
  if (error) return { error };

  const period = periods.data.find(p => p.month === month) || null;
  let ledger = [];
  if (period) {
    const { data, error: e } = await sb.from("wallet_transactions")
      .select("id,tx_type,amount,reason,created_at,created_by_email,category_id,to_category_id,account_id,to_account_id,invoice_id,invoice_snapshot,reverses_tx_id,reversal_kind,is_adjustment,original_period_id,source_period_id")
      .eq("period_id", period.id)
      .order("id", { ascending: false })
      .limit(300);
    if (e) return { error: e };
    ledger = data;
  }
  return {
    overview: overview.data, categories: categories.data, accounts: accounts.data,
    reconciliation: reconciliation.data, periods: periods.data, period, unposted: unposted.data, ledger,
  };
}

export const loadSettings = () => Promise.all([
  sb.from("wallet_categories").select("id,code,name_en,name_ar,sort").order("sort"),
  sb.from("wallet_accounts").select("id,category_id,code,name,is_active").order("code"),
  sb.from("wallet_invoice_rules").select("id,match_column,match_value,action,account_id,priority,is_active").order("match_column").order("match_value"),
]).then(([c, a, r]) => ({ error: c.error || a.error || r.error, categories: c.data || [], accounts: a.data || [], rules: r.data || [] }));

// The operations of the action dialog; each returns { data, error } from the database.
export const runAction = {
  budget: ({ month, amount, reason }) => rpc("wallet_set_company_budget", { p_month: month, p_amount: amount, p_reason: reason }),
  allocate: ({ month, category, amount, reason }) => rpc("wallet_allocate_category", { p_month: month, p_category: category, p_amount: amount, p_reason: reason }),
  accountAllocation: ({ month, account, amount, reason }) => rpc("wallet_set_account_allocation", { p_month: month, p_account: account, p_amount: amount, p_reason: reason }),
  topUp: ({ month, account, amount, reason }) => rpc("wallet_top_up", { p_month: month, p_account: account, p_amount: amount, p_reason: reason }),
  reallocate: ({ month, fromCategory, toCategory, amount, reason }) => rpc("wallet_reallocate", { p_month: month, p_from_category: fromCategory, p_to_category: toCategory, p_amount: amount, p_reason: reason }),
  transfer: ({ fromAccount, toAccount, amount, reason }) => rpc("wallet_transfer", { p_from_account: fromAccount, p_to_account: toAccount, p_amount: amount, p_reason: reason }),
  close: ({ month, reason }) => rpc("wallet_close_period", { p_month: month, p_reason: reason }),
};

export const postPendingInvoices = () => rpc("wallet_post_pending_invoices");
export const reverseInvoice = (invoiceId, kind, reason) => rpc("wallet_reverse_invoice", { p_invoice_id: invoiceId, p_kind: kind, p_reason: reason });

// The wallet state of invoices, for the invoices grid: { [invoice_id]: { posted, reversal } }.
// Returns null when the wallet is not installed.
export async function loadInvoiceWalletState() {
  const PAGE = 1000; // PostgREST returns at most 1000 rows per request
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from("wallet_transactions")
      .select("id,invoice_id,tx_type,reversal_kind,reason,created_at,created_by_email")
      .in("tx_type", ["expense", "reversal"])
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) return isNotInstalled(error) ? null : {};
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  const map = {};
  for (const r of rows) {
    const s = (map[r.invoice_id] ||= { posted: false, reversal: null });
    if (r.tx_type === "expense") s.posted = true;
    else s.reversal = { kind: r.reversal_kind, reason: r.reason, at: r.created_at, by: r.created_by_email };
  }
  return map;
}
