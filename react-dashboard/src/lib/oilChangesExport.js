import { STATUS, FLAG_TEXT, localISO } from "./oilChanges";

const NAVY = "FF1E2A4A";
const FILLS = { overdue: "FFFDE2E2", soon: "FFFEF0D5", ok: "FFE2F5E9", no_reading: "FFEDEFF3", needs_setup: "FFE8EEFB" };
const BORDER = { style: "thin", color: { argb: "FFD0D5DD" } };
const date = (v) => (/^\d{4}-\d{2}-\d{2}/.test(v || "") ? new Date(v.slice(0, 10) + "T00:00:00Z") : null);

const COLUMNS = [
  ["Vehicle", 24, r => r.vehicle_plate],
  ["Project", 10, r => r.project],
  ["City", 12, r => r.city],
  ["Model", 11, r => r.model],
  ["Last change date", 14, r => date(r.last_change_date)],
  ["Last change odometer", 15, r => (r.last_change_odo == null ? null : Number(r.last_change_odo))],
  ["Next change odometer", 15, r => (r.next_change_odo == null ? null : Number(r.next_change_odo))],
  ["Current odometer", 14, r => (r.current_odo == null ? null : Number(r.current_odo))],
  ["Reading date", 13, r => date(r.current_odo_date)],
  ["Remaining km", 13, r => (r.remaining_km == null ? null : Number(r.remaining_km))],
  ["Avg km / day", 12, r => (r.avg_daily_km == null ? null : Number(r.avg_daily_km))],
  ["Expected date", 13, r => date(r.expected_date)],
  ["Driver", 24, r => r.driver_name],
  ["Notified", 18, r => (r.notice_at ? new Date(r.notice_at) : null)],
  ["Status", 13, r => STATUS[r.status]?.label || r.status],
  ["Notes", 60, r => (r.flags || []).map(f => FLAG_TEXT[f] || f).join(" | ")],
];

// rows = what the table shows now (filters and sort applied)
export async function exportOilChangesXlsx(rows) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Oil changes", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = COLUMNS.map(([header, width]) => ({ header, width }));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  head.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  head.height = 30;

  for (const r of rows) {
    const row = ws.addRow(COLUMNS.map(([, , get]) => get(r)));
    row.alignment = { vertical: "middle", horizontal: "center" };
    row.getCell(COLUMNS.length).alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    row.getCell(COLUMNS.length - 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILLS[r.status] || FILLS.ok } };
    row.getCell(COLUMNS.length - 1).font = { bold: true };
  }
  const dateCols = [5, 9, 12];
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    row.eachCell({ includeEmpty: true }, (cell) => { cell.border = { top: BORDER, left: BORDER, bottom: BORDER, right: BORDER }; });
    if (n === 1) return;
    dateCols.forEach(c => { row.getCell(c).numFmt = "d/m/yyyy"; });
    row.getCell(14).numFmt = "d/m/yyyy hh:mm";
    [6, 7, 8, 10].forEach(c => { row.getCell(c).numFmt = "#,##0"; });
    row.getCell(11).numFmt = "#,##0.0";
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUMNS.length } };

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Oil_Changes_${localISO()}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return rows.length;
}
