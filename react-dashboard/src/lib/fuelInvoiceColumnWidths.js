// AutoFit column width for the Fuel & Invoice grid — react-datasheet-grid
// has no built-in autofit or resize (confirmed by reading its source, see
// FuelInvoiceGrid.jsx), so this measures real text width with a canvas
// (same technique browsers/Excel-alikes use) and clamps to sensible bounds.

const MIN_WIDTH = 70;
// User Name (and other long-text columns) routinely need more than this —
// e.g. "SUP - Sadam Abdel Fadeel Mir..." was still clipping at 320.
const MAX_WIDTH = 420;
const CELL_HORIZONTAL_PADDING = 28; // ~14px each side, matches .dsg-cell content padding
// Headers need a bigger buffer than plain data cells: the resize handle
// reserves ~22px of the header's own width (see .dsg-resizable-header /
// .dsg-resize-handle in dashboard-base.css), plus the library's own
// .dsg-cell-header-container wrapper eats a further ~20px that isn't part
// of that reserved padding — measured directly against the real rendered
// DOM, not guessed.
const HEADER_HORIZONTAL_PADDING = 50;
const HEADER_FONT = "700 13px system-ui, -apple-system, 'Segoe UI', Tahoma, sans-serif";
const CELL_FONT = "13px system-ui, -apple-system, 'Segoe UI', Tahoma, sans-serif";

let canvas = null;
function measure(text, font) {
  if (!text) return 0;
  if (!canvas) canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  ctx.font = font;
  return ctx.measureText(String(text)).width;
}

const STORAGE_KEY = "fuelInvoiceColumnWidths";

export function loadStoredColumnWidths() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveStoredColumnWidths(widths) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(widths));
  } catch {
    // best-effort only — a private window or full storage just means
    // widths won't persist, nothing else depends on this succeeding
  }
}

// `formatValue(row)` returns the plain string a cell actually displays, so
// autofit measures what she sees (e.g. the money-formatted Amount, not the
// raw number) — passed in per-column by the caller.
export function computeAutofitWidth(label, rows, formatValue, floor) {
  let target = Math.ceil(measure(label, HEADER_FONT) + HEADER_HORIZONTAL_PADDING);
  for (const row of rows) {
    const w = Math.ceil(measure(formatValue(row), CELL_FONT) + CELL_HORIZONTAL_PADDING);
    if (w > target) target = w;
  }
  return Math.max(floor || MIN_WIDTH, Math.min(MAX_WIDTH, target));
}

export { MIN_WIDTH, MAX_WIDTH };
