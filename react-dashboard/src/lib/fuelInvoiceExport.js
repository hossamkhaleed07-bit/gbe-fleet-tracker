import { FUEL_INVOICE_FIELDS } from "./fuelInvoice";

// Exports exactly the columns the grid shows (everything except the hidden
// 18th "batch" field), in the grid's order. Numbers stay numbers, dates are
// real Excel dates, and identifier-like text (NID, invoice/internal number,
// deduction code) is written as text so leading zeros survive.
const EXPORT_FIELDS = FUEL_INVOICE_FIELDS.filter(f => f.key !== "batch");
const NUMERIC_KEYS = new Set(["cost", "amount", "vat"]);
const WIDTHS = { user_name: 34, da_name: 30, remarks: 32, internal_number: 26, invoice_number: 16 };

function isoToDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || "");
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
}

export async function exportFuelInvoiceXlsx(rows, dateStamp) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Entries", { views: [{ state: "frozen", ySplit: 1 }] });

  ws.columns = EXPORT_FIELDS.map(f => ({ header: f.label, key: f.key, width: WIDTHS[f.key] || 16 }));
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4D3D" } };
  ws.getRow(1).alignment = { vertical: "middle", horizontal: "center" };

  for (const f of EXPORT_FIELDS) {
    const col = ws.getColumn(f.key);
    if (NUMERIC_KEYS.has(f.key)) col.numFmt = "#,##0.00";
    else if (f.key === "entry_date") col.numFmt = "yyyy-mm-dd";
    else col.numFmt = "@"; // text — keeps leading zeros
  }

  let count = 0;
  for (const r of rows) {
    const values = {};
    let hasData = false;
    for (const f of EXPORT_FIELDS) {
      let v = r[f.key];
      if (v === null || v === undefined || v === "") { values[f.key] = null; continue; }
      hasData = true;
      if (NUMERIC_KEYS.has(f.key)) { const n = Number(v); v = Number.isFinite(n) ? n : String(v); }
      else if (f.key === "entry_date") v = isoToDate(v) || String(v);
      else v = String(v);
      values[f.key] = v;
    }
    if (!hasData) continue; // skip untouched blank grid rows
    ws.addRow(values);
    count++;
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: EXPORT_FIELDS.length } };

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Fuel_Invoices_Entries_${dateStamp}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return count;
}
