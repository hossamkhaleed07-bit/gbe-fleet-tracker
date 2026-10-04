import { computeAmountVat } from "./fuelInvoice";

export const NO_VALUE = "—";
export const SOURCE_COLORS = { Futurehub: "#7030a0", PetroApp: "#0070c0" };

const cmp = (a, b) => a.localeCompare(b, "en", { numeric: true });
const blank = (v) => (v == null ? "" : String(v)).trim() || NO_VALUE;

export const fmt = (n) => Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ---- dates (all ISO yyyy-mm-dd strings; "today" is the browser's local day) ----
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
export function prevMonthRange(iso) {
  const last = addDays(monthStart(iso), -1);
  return { from: monthStart(last), to: last };
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

// ---- aggregation ----
// Returns the exact lines both the screen table and the Excel export draw:
//   { type: "row", source, branch?, use, fuel, count, amount, vat, cost }
//   { type: "sub", source, branch, count, amount, vat, cost }   (branch breakdown only)
//   { type: "grand", count, amount, vat, cost }
export function buildReport(rows, { byBranch, selectedBranches }) {
  const groups = new Map();
  for (const r of rows) {
    const branch = blank(r.branch);
    if (selectedBranches && !selectedBranches.has(branch)) continue;
    const source = blank(r.data_source), use = blank(r.use_type), fuel = blank(r.fuel_type);
    const key = (byBranch ? [source, branch, use, fuel] : [source, use, fuel]).join("|");
    let g = groups.get(key);
    if (!g) groups.set(key, g = { type: "row", source, branch: byBranch ? branch : undefined, use, fuel, count: 0, amount: 0, vat: 0, cost: 0 });
    const cost = Number(r.cost) || 0;
    // stored values first; backed out of Cost (the invoices grid's formula) when missing
    const calc = computeAmountVat(cost);
    g.count += 1;
    g.cost += cost;
    g.amount += r.amount != null && r.amount !== "" ? Number(r.amount) : (calc.amount ?? 0);
    g.vat += r.vat != null && r.vat !== "" ? Number(r.vat) : (calc.vat ?? 0);
  }
  const rowsSorted = [...groups.values()].sort((a, b) =>
    cmp(a.source, b.source) || (byBranch ? cmp(a.branch, b.branch) : 0) || cmp(a.use, b.use) || cmp(a.fuel, b.fuel));

  const add = (t, g) => { t.count += g.count; t.amount += g.amount; t.vat += g.vat; t.cost += g.cost; };
  const grand = { type: "grand", count: 0, amount: 0, vat: 0, cost: 0 };
  const lines = [];
  let sub = null;
  const flush = () => { if (sub) lines.push(sub); sub = null; };
  for (const g of rowsSorted) {
    if (byBranch && (!sub || sub.source !== g.source || sub.branch !== g.branch)) {
      flush();
      sub = { type: "sub", source: g.source, branch: g.branch, count: 0, amount: 0, vat: 0, cost: 0 };
    }
    lines.push(g);
    if (sub) add(sub, g);
    add(grand, g);
  }
  flush();
  lines.push(grand);
  return lines;
}

// ---- Excel export: same layout as the on-screen table ----
const BORDER = { style: "thin", color: { argb: "FF333333" } };
const ALL_BORDERS = { top: BORDER, left: BORDER, bottom: BORDER, right: BORDER };
const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF9DC3E6" } };
const SUB_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDDEBF7" } };
const argb = (hex) => "FF" + hex.slice(1).toUpperCase();

export async function exportUsageReportXlsx({ lines, byBranch, from, to, selectedBranches }) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Usage Report");
  const heads = byBranch
    ? ["Data Source", "Branch", "Use type", "Type of fuel", "Count of Invoice", "Total Amount", "VAT 15%", "Total Cost"]
    : ["Data Source", "Use type", "Type of fuel", "Count of Invoice", "Total Amount", "VAT 15%", "Total Cost"];
  const nCols = heads.length;
  const labelCols = nCols - 4;           // text columns before the count
  const period = periodLabel(from, to);
  ws.columns = heads.map((h, i) => ({ width: i < labelCols ? 18 : 17 }));

  const center = { vertical: "middle", horizontal: "center" };
  const styleRow = (row, fill, bold = true) => {
    for (let c = 1; c <= nCols; c++) {
      const cell = row.getCell(c);
      cell.border = ALL_BORDERS; cell.alignment = center;
      if (fill) cell.fill = fill;
      if (bold) cell.font = { bold: true };
    }
  };

  // title + period
  const t = ws.addRow([]);
  t.getCell(1).value = "Fuels usage report";
  t.getCell(nCols - 1).value = period;
  ws.mergeCells(t.number, 1, t.number, nCols - 2);
  ws.mergeCells(t.number, nCols - 1, t.number, nCols);
  styleRow(t, HEADER_FILL); t.height = 22;
  // selected branches
  const b = ws.addRow(["Branches: " + branchesLabel(selectedBranches)]);
  ws.mergeCells(b.number, 1, b.number, nCols);
  styleRow(b, HEADER_FILL, false);
  // column heads
  styleRow(ws.addRow(heads), HEADER_FILL);

  for (const l of lines) {
    let row;
    if (l.type === "row") {
      row = ws.addRow(byBranch
        ? [l.source, l.branch, l.use, l.fuel, l.count, round2(l.amount), round2(l.vat), round2(l.cost)]
        : [l.source, l.use, l.fuel, l.count, round2(l.amount), round2(l.vat), round2(l.cost)]);
      styleRow(row, null, false);
      const color = SOURCE_COLORS[l.source];
      if (color) {
        const c = row.getCell(1);
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(color) } };
        c.font = { color: { argb: "FFFFFFFF" } };
      }
    } else {
      const label = l.type === "grand" ? "Grand Total" : `${l.branch} total`;
      row = ws.addRow([label, ...Array(labelCols - 1).fill(null), l.count, round2(l.amount), round2(l.vat), round2(l.cost)]);
      ws.mergeCells(row.number, 1, row.number, labelCols);
      styleRow(row, l.type === "grand" ? HEADER_FILL : SUB_FILL);
    }
    row.getCell(labelCols + 1).numFmt = "0";
    for (let c = labelCols + 2; c <= nCols; c++) row.getCell(c).numFmt = "0.00";
  }

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Fuel_Usage_Report_${(period || "report").replace(/[\/\s–]+/g, "-")}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
