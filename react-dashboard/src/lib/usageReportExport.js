import { addInvoicesSheet } from "./fuelInvoiceExport";
import {
  PALETTE, NO_VALUE, MISSING_TIPS, sourceStyle, visibleColumns, periodLabel, branchesLabel, totalLabel, round2, fmt,
} from "./usageReport";

// Excel export and printout: the same lines, columns, colours and centring as the screen.
const TITLE = "Fuels usage report";
const argb = (hex) => "FF" + hex.slice(1).toUpperCase();
const solid = (hex) => ({ type: "pattern", pattern: "solid", fgColor: { argb: argb(hex) } });
const BORDER = { style: "thin", color: { argb: "FFD0D5DD" } };
const ALL_BORDERS = { top: BORDER, left: BORDER, bottom: BORDER, right: BORDER };

function cellText(l, key) {
  const v = l[key];
  return l.missing?.includes(key) ? `⚠ ${NO_VALUE}` : v;
}

// invoiceRows: every invoice of the period and branches (full rows), written to the
// "Invoices" sheet exactly like the Invoices page export does.
export async function exportUsageReportXlsx({ lines, byBranch, hidden, from, to, selectedBranches, invoiceRows }) {
  const ExcelJS = (await import("exceljs")).default;
  const cols = visibleColumns(byBranch, hidden);
  const textCols = cols.filter(c => !c.num);
  const nCols = cols.length + 1; // + "#"
  const labelSpan = 1 + textCols.length;
  const period = periodLabel(from, to);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Summary", {
    pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    views: [{ state: "frozen", ySplit: 3 }],
  });
  ws.columns = [{ width: 6 }, ...cols.map(c => ({ width: c.num ? 18 : c.key === "source" ? 18 : 20 }))];

  const center = { vertical: "middle", horizontal: "center" };
  const style = (row, { fill, bold, color } = {}) => {
    for (let c = 1; c <= nCols; c++) {
      const cell = row.getCell(c);
      cell.border = ALL_BORDERS; cell.alignment = center;
      if (fill) cell.fill = solid(fill);
      cell.font = { bold: !!bold, color: { argb: argb(color || "#111827") } };
    }
  };
  const merge = (row, c1, c2) => { if (c2 > c1) ws.mergeCells(row.number, c1, row.number, c2); };

  // title + period, then the selected branches, then the column headings
  const periodSpan = Math.min(2, nCols - 1);
  const t = ws.addRow([]);
  t.getCell(1).value = TITLE;
  t.getCell(nCols - periodSpan + 1).value = period;
  merge(t, 1, nCols - periodSpan); merge(t, nCols - periodSpan + 1, nCols);
  style(t, { fill: PALETTE.navy, bold: true, color: "#ffffff" }); t.height = 24;
  const b = ws.addRow(["Branches: " + branchesLabel(selectedBranches)]);
  merge(b, 1, nCols);
  style(b, { fill: PALETTE.grand, bold: true, color: PALETTE.navy });
  const head = ws.addRow(["#", ...cols.map(c => c.label)]);
  style(head, { fill: PALETTE.navy, bold: true, color: "#ffffff" });

  for (const l of lines) {
    let row;
    if (l.type === "row") {
      row = ws.addRow([l.n, ...cols.map(c => c.num ? (c.money ? round2(l[c.key]) : l[c.key]) : cellText(l, c.key))]);
      style(row);
      cols.forEach((c, i) => {
        const cell = row.getCell(i + 2);
        if (c.key === "source") {
          const s = sourceStyle(l.source);
          cell.fill = solid(s.badge); cell.font = { bold: true, color: { argb: argb(s.ink) } };
        } else if (l.missing.includes(c.key)) {
          cell.fill = solid(PALETTE.warn); cell.font = { bold: true, color: { argb: argb(PALETTE.warnInk) } };
        }
      });
    } else {
      row = ws.addRow([totalLabel(l), ...Array(labelSpan - 1).fill(null), ...cols.filter(c => c.num).map(c => c.money ? round2(l[c.key]) : l[c.key])]);
      merge(row, 1, labelSpan);
      const s = sourceStyle(l.source);
      if (l.type === "grand") style(row, { fill: PALETTE.grand, bold: true, color: PALETTE.navy });
      else style(row, { fill: l.type === "sourceTotal" ? s.sub : s.branchSub, bold: true, color: s.ink });
    }
    cols.forEach((c, i) => {
      if (c.num) row.getCell(i + 2).numFmt = c.money ? "#,##0.00" : "0";
    });
  }

  if (invoiceRows) addInvoicesSheet(wb, invoiceRows, "Invoices");

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

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

// Prints the report on A4 landscape through a hidden iframe (no popup to be blocked).
export function printUsageReport({ lines, byBranch, hidden, from, to, selectedBranches }) {
  const cols = visibleColumns(byBranch, hidden);
  const labelSpan = 1 + cols.filter(c => !c.num).length;
  const nCols = cols.length + 1;
  const period = periodLabel(from, to);
  const periodSpan = Math.min(2, nCols - 1);

  const body = lines.filter(l => l.type !== "grand").map(l => {
    if (l.type === "row") {
      const tds = cols.map(c => {
        if (c.num) return `<td class="num">${c.money ? fmt(l[c.key]) : l[c.key]}</td>`;
        if (c.key === "source") { const s = sourceStyle(l.source); return `<td style="background:${s.badge};color:${s.ink};font-weight:700">${esc(l.source)}</td>`; }
        if (l.missing.includes(c.key)) return `<td class="warn" title="${esc(MISSING_TIPS[c.key])}">⚠ ${NO_VALUE}</td>`;
        return `<td>${esc(l[c.key])}</td>`;
      }).join("");
      return `<tr><td class="idx">${l.n}</td>${tds}</tr>`;
    }
    const s = sourceStyle(l.source);
    const bg = l.type === "sourceTotal" ? s.sub : s.branchSub;
    const nums = cols.filter(c => c.num).map(c => `<td class="num">${c.money ? fmt(l[c.key]) : l[c.key]}</td>`).join("");
    return `<tr class="sub" style="background:${bg};color:${s.ink}"><td colspan="${labelSpan}">${esc(totalLabel(l))}</td>${nums}</tr>`;
  }).join("");
  const g = lines[lines.length - 1];
  const grandNums = cols.filter(c => c.num).map(c => `<td class="num">${c.money ? fmt(g[c.key]) : g[c.key]}</td>`).join("");

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(TITLE)} ${esc(period)}</title><style>
    @page { size: A4 landscape; margin: 10mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111827; margin: 0; font-size: 11px; }
    table { width: 100%; border-collapse: collapse; text-align: center; }
    th, td { border: 1px solid #d0d5dd; padding: 5px 8px; vertical-align: middle; }
    thead th { background: ${PALETTE.navy}; color: #fff; font-weight: 700; }
    thead .info th { background: ${PALETTE.grand}; color: ${PALETTE.navy}; }
    thead .ttl th { font-size: 15px; padding: 8px; }
    .num { font-variant-numeric: tabular-nums; }
    .idx { color: #6b7280; width: 28px; }
    .warn { background: ${PALETTE.warn}; color: ${PALETTE.warnInk}; font-weight: 700; }
    .sub td { font-weight: 700; }
    tfoot td { background: ${PALETTE.grand}; color: ${PALETTE.navy}; font-weight: 800; font-size: 12px; }
    tr { page-break-inside: avoid; }
    thead { display: table-header-group; }
  </style></head><body><table>
    <thead>
      <tr class="ttl"><th colspan="${nCols - periodSpan}">${esc(TITLE)}</th>${periodSpan ? `<th colspan="${periodSpan}">${esc(period)}</th>` : ""}</tr>
      <tr class="info"><th colspan="${nCols}">Branches: ${esc(branchesLabel(selectedBranches))}</th></tr>
      <tr><th>#</th>${cols.map(c => `<th>${esc(c.label)}</th>`).join("")}</tr>
    </thead>
    <tbody>${body}</tbody>
    <tfoot><tr><td colspan="${labelSpan}">Grand Total</td>${grandNums}</tr></tfoot>
  </table></body></html>`;

  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  doc.open(); doc.write(html); doc.close();
  const cleanup = () => setTimeout(() => frame.remove(), 500);
  frame.contentWindow.addEventListener("afterprint", cleanup);
  // give the iframe a tick to lay out before the print dialog opens
  setTimeout(() => { frame.contentWindow.focus(); frame.contentWindow.print(); }, 100);
}
