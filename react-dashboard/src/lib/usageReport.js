import { computeAmountVat } from "./fuelInvoice";

export const NO_VALUE = "—";

export const COLUMNS = [
  { key: "source", label: "Data Source" },
  { key: "branch", label: "Branch" },
  { key: "use", label: "Use type" },
  { key: "fuel", label: "Type of Fuel" },
  { key: "count", label: "Count of Invoice", num: true },
  { key: "amount", label: "Total Amount", num: true, money: true },
  { key: "vat", label: "VAT 15%", num: true, money: true },
  { key: "cost", label: "Total Cost", num: true, money: true },
];
// Data Source is always shown (it anchors the grouping); the rest can be hidden.
export const HIDEABLE = COLUMNS.filter(c => c.key !== "source");
export const visibleColumns = (byBranch, hidden) =>
  COLUMNS.filter(c => (c.key !== "branch" || byBranch) && (c.key === "source" || !hidden.has(c.key)));

// Colours shared by the screen, the Excel export and the printout.
export const SOURCE_STYLES = {
  Futurehub: { badge: "#ede0fa", ink: "#6b21a8", sub: "#ecdffa", branchSub: "#f6effc" },
  PetroApp: { badge: "#dbeafe", ink: "#1d4ed8", sub: "#dbe9fc", branchSub: "#eef5fe" },
};
export const DEFAULT_SOURCE_STYLE = { badge: "#e5e7eb", ink: "#374151", sub: "#e5e7eb", branchSub: "#f3f4f6" };
export const sourceStyle = (s) => SOURCE_STYLES[s] || DEFAULT_SOURCE_STYLE;
export const PALETTE = { navy: "#1e2a4a", grand: "#dce6f5", warn: "#fef3c7", warnInk: "#92400e" };

const cmp = (a, b) => a.localeCompare(b, "en", { numeric: true });
const blank = (v) => (v == null ? "" : String(v)).trim() || NO_VALUE;

export const fmt = (n) => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ---- dates (ISO yyyy-mm-dd strings; "today" is the browser's local day) ----
export const localISO = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const monthStart = (iso) => iso.slice(0, 7) + "-01";
export const monthEnd = (iso) => {
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
export function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
export function daysBetween(a, b) {
  const t = (s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((t(b) - t(a)) / 86400000);
}
export function prevMonthRange(iso) {
  const last = addDays(monthStart(iso), -1);
  return { from: monthStart(last), to: last };
}
// The period right before [from, to] with the same length: a whole calendar
// month compares with the previous calendar month, anything else with the
// same number of days directly before it (one day vs. the day before).
// A month that has not finished yet (the "This month" button) is compared with
// the same number of days at the start of the previous month, not the whole of it.
export function previousPeriod(from, to, today = localISO()) {
  if (from === monthStart(from) && to === monthEnd(from)) {
    const prev = prevMonthRange(from);
    if (to > today && today >= from) {
      const end = addDays(prev.from, daysBetween(from, today));
      return { from: prev.from, to: end < prev.to ? end : prev.to };
    }
    return prev;
  }
  const len = daysBetween(from, to) + 1;
  return { from: addDays(from, -len), to: addDays(from, -1) };
}
const dmy = (iso) => { const [y, m, d] = iso.split("-"); return `${Number(d)}/${Number(m)}/${y}`; };
const my = (iso) => { const [y, m] = iso.split("-"); return `${Number(m)}/${y}`; };

// one day → d/m/yyyy, a whole calendar month → m/yyyy, anything else → "from – to"
export function periodLabel(from, to) {
  if (!from || !to) return "";
  if (from === to) return dmy(from);
  if (from === monthStart(from) && to === monthEnd(from)) return my(from);
  return `${dmy(from)} – ${dmy(to)}`;
}

export function branchesLabel(selected) {
  return selected ? [...selected].sort(cmp).join(", ") || NO_VALUE : "All";
}

// ---- summary cards ----
const inBranches = (r, selectedBranches) => !selectedBranches || selectedBranches.has(blank(r.branch));

export function summarizeRows(rows, selectedBranches) {
  const t = { count: 0, amount: 0, vat: 0, cost: 0 };
  for (const r of rows) {
    if (!inBranches(r, selectedBranches)) continue;
    const cost = Number(r.cost) || 0;
    const calc = computeAmountVat(cost);
    t.count += 1;
    t.cost += cost;
    t.amount += r.amount != null && r.amount !== "" ? Number(r.amount) : (calc.amount ?? 0);
    t.vat += r.vat != null && r.vat !== "" ? Number(r.vat) : (calc.vat ?? 0);
  }
  return t;
}

// % change of cur against prev; null when there is nothing to compare with
export function pctChange(cur, prev, prevCount) {
  if (!prevCount || !prev) return null;
  return ((cur - prev) / prev) * 100;
}

// invoices missing a use type, a fuel type or a branch
export function incompleteCount(rows, selectedBranches) {
  let n = 0;
  for (const r of rows) {
    if (!inBranches(r, selectedBranches)) continue;
    if (blank(r.use_type) === NO_VALUE || blank(r.fuel_type) === NO_VALUE || blank(r.branch) === NO_VALUE) n++;
  }
  return n;
}

export const MISSING_TIPS = { use: "Use type is missing", fuel: "Type of fuel is missing", branch: "Branch is missing" };

// ---- aggregation ----
// Lines drawn identically by the screen table, the Excel export and the printout:
//   { type: "row", n, source, branch?, use, fuel, count, amount, vat, cost, missing: ["use"|"fuel"|"branch"...] }
//   { type: "branchTotal", source, branch, count, amount, vat, cost }   (branch breakdown only)
//   { type: "sourceTotal", source, count, amount, vat, cost }
//   { type: "grand", count, amount, vat, cost }
// `sort` ({ key, dir }) orders the groups of that level (sources, branches) or the
// rows inside each innermost group; `search` keeps only rows containing the text.
export function buildReport(rows, { byBranch, selectedBranches, search = "", sort = null }) {
  const groups = new Map();
  for (const r of rows) {
    if (!inBranches(r, selectedBranches)) continue;
    const branch = blank(r.branch);
    const source = blank(r.data_source), use = blank(r.use_type), fuel = blank(r.fuel_type);
    const key = (byBranch ? [source, branch, use, fuel] : [source, use, fuel]).join("|");
    let g = groups.get(key);
    if (!g) groups.set(key, g = { type: "row", source, branch: byBranch ? branch : undefined, use, fuel, count: 0, amount: 0, vat: 0, cost: 0, missing: [] });
    const cost = Number(r.cost) || 0;
    const calc = computeAmountVat(cost);
    g.count += 1;
    g.cost += cost;
    g.amount += r.amount != null && r.amount !== "" ? Number(r.amount) : (calc.amount ?? 0);
    g.vat += r.vat != null && r.vat !== "" ? Number(r.vat) : (calc.vat ?? 0);
  }

  const q = search.trim().toLowerCase();
  let list = [...groups.values()];
  for (const g of list) {
    if (g.use === NO_VALUE) g.missing.push("use");
    if (g.fuel === NO_VALUE) g.missing.push("fuel");
    if (byBranch && g.branch === NO_VALUE) g.missing.push("branch");
  }
  if (q) list = list.filter(g => [g.source, g.branch, g.use, g.fuel].some(v => v && v.toLowerCase().includes(q)));

  const dir = sort?.dir === "desc" ? -1 : 1;
  const cmpBy = (key) => (a, b) => {
    const x = a[key], y = b[key];
    const r = typeof x === "number" && typeof y === "number" ? x - y : cmp(String(x), String(y));
    return r * dir;
  };
  const natural = (key) => (a, b) => cmp(String(a[key]), String(b[key]));
  const order = (key) => (sort?.key === key ? cmpBy(key) : natural(key));
  const rowCmp = (a, b) => {
    if (sort && !["source", "branch"].includes(sort.key)) return cmpBy(sort.key)(a, b);
    return natural("use")(a, b) || natural("fuel")(a, b);
  };

  const bySource = new Map();
  for (const g of list) {
    if (!bySource.has(g.source)) bySource.set(g.source, []);
    bySource.get(g.source).push(g);
  }
  const zero = () => ({ count: 0, amount: 0, vat: 0, cost: 0 });
  const add = (t, g) => { t.count += g.count; t.amount += g.amount; t.vat += g.vat; t.cost += g.cost; };
  const grand = { type: "grand", ...zero() };
  const lines = [];
  let n = 0;
  const sources = [...bySource.keys()].sort((a, b) => order("source")({ source: a }, { source: b }));
  for (const source of sources) {
    const srcRows = bySource.get(source);
    const srcTotal = { type: "sourceTotal", source, ...zero() };
    if (byBranch) {
      const byBr = new Map();
      for (const g of srcRows) {
        if (!byBr.has(g.branch)) byBr.set(g.branch, []);
        byBr.get(g.branch).push(g);
      }
      const branches = [...byBr.keys()].sort((a, b) => order("branch")({ branch: a }, { branch: b }));
      for (const branch of branches) {
        const total = { type: "branchTotal", source, branch, ...zero() };
        for (const g of byBr.get(branch).sort(rowCmp)) { g.n = ++n; lines.push(g); add(total, g); }
        lines.push(total);
        add(srcTotal, total);
      }
    } else {
      for (const g of srcRows.sort(rowCmp)) { g.n = ++n; lines.push(g); add(srcTotal, g); }
    }
    lines.push(srcTotal);
    add(grand, srcTotal);
  }
  lines.push(grand);
  return lines;
}

// the label of a subtotal line: "Futurehub Total" / "Riyadh Total"
export const totalLabel = (l) => l.type === "grand" ? "Grand Total" : l.type === "sourceTotal" ? `${l.source} Total` : `${l.branch === NO_VALUE ? "No branch" : l.branch} Total`;
