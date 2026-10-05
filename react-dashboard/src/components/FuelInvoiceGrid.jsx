import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, Maximize2, X, ChevronDown, Download } from "lucide-react";
import { DataSheetGrid, keyColumn, textColumn, floatColumn, createTextColumn, createContextMenuComponent, renderContextMenuItem } from "react-datasheet-grid";
import "react-datasheet-grid/dist/style.css";
import HeroPortal from "./HeroPortal";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import { exportFuelInvoiceXlsx } from "../lib/fuelInvoiceExport";
import { useFuelInvoiceRecords } from "../hooks/useFuelInvoiceRecords";
import { useLang } from "../contexts/LanguageContext";
import { FUEL_INVOICE_FIELDS, SELECT_FIELD_KEYS, distinctValues, computeAmountVat, money, ROW_COLOR_OPTIONS, missingRequiredFields, isBlankRow, invoiceKey } from "../lib/fuelInvoice";
import { makeSelectDsgColumn, makeReadOnlyDsgColumn, dsgDateColumn } from "./fuelInvoiceDsgColumns";
import { STAT_KEYS, buildClipboardTable, writeClipboard, stripPastedHeadingRow } from "../lib/fuelInvoiceClipboard";
import { computeAutofitWidth, loadStoredColumnWidths, saveStoredColumnWidths, MIN_WIDTH, MAX_WIDTH } from "../lib/fuelInvoiceColumnWidths";

// Right-click menu: the grid's own items plus "Copy with headers" right after "Copy".
// The grid renders this component itself, so it reaches the page's copy function
// through this small holder (set on every render of FuelInvoiceGrid).
const copyWithHeadersRef = { current: null };
const BaseContextMenu = createContextMenuComponent(item => (item.type === "COPY_WITH_HEADERS" ? "Copy with headers" : renderContextMenuItem(item)));
function FiContextMenu(props) {
  const items = [];
  for (const it of props.items) {
    items.push(it);
    if (it.type === "COPY") items.push({ type: "COPY_WITH_HEADERS", action: () => { copyWithHeadersRef.current?.(); props.close(); } });
  }
  return <BaseContextMenu {...props} items={items} />;
}

const NID_TEXT_COLUMN = createTextColumn(); // plain text — never coerced to a number, so leading zeros survive
const GROUPABLE_FIELDS = FUEL_INVOICE_FIELDS.filter(f => SELECT_FIELD_KEYS.includes(f.key));

// Fixed strips under the grid: the totals row and the bottom bar. The grid's own
// height is whatever is left of the window after these two.
// The fields a user edits and the grid saves (everything else on a row is derived).
const SAVED_FIELD_KEYS = [
  "data_source", "invoice_number", "internal_number", "fuel_type", "cost", "user_name",
  "entry_date", "card_type", "status", "use_type", "branch", "nid", "deduction_code", "remarks", "row_color",
];
const TOTALS_ROW_H = 40;
const BOTTOM_BAR_H = 46;

// Column labels/minimums + how each one's displayed text is derived, shared
// between building the actual react-datasheet-grid columns and AutoFit's
// measurement pass (so AutoFit measures exactly what's rendered).
const COLUMN_DEFS = [
  { key: "data_source", title: "Data Source", minWidth: 130 },
  { key: "invoice_number", title: "Invoice Number", minWidth: 130 },
  { key: "internal_number", title: "Internal number", minWidth: 150 },
  { key: "fuel_type", title: "Type of fuel", minWidth: 110 },
  { key: "cost", title: "Cost", minWidth: 100 },
  { key: "amount", title: "Amount", minWidth: 110, format: r => money(r.amount) },
  { key: "vat", title: "VAT", minWidth: 100, format: r => money(r.vat) },
  { key: "user_name", title: "User Name", minWidth: 220 },
  { key: "entry_date", title: "Date", minWidth: 140 },
  { key: "card_type", title: "Card Type", minWidth: 130 },
  { key: "status", title: "Status", minWidth: 140 },
  { key: "use_type", title: "Use type", minWidth: 130 },
  { key: "branch", title: "Branch", minWidth: 120 },
  { key: "nid", title: "NID", minWidth: 130 },
  { key: "da_name", title: "DA Name", minWidth: 220 },
  { key: "deduction_code", title: "Deduction code", minWidth: 150 },
  { key: "remarks", title: "Remarks", minWidth: 200 },
];
for (const def of COLUMN_DEFS) if (!def.format) def.format = r => r[def.key] ?? "";

// A stable per-row key that exists from the moment a row is created — even
// before it's ever been saved (and so has no database `id` yet). Needed so
// filtering can show a subset of rows to react-datasheet-grid while still
// correctly reconciling edits back into the FULL row list by identity
// rather than by array position (which the filtered view can't provide).
function rowKey(row) {
  return row.id ?? row.__tempId;
}

// Column header: label + a drag handle at the right edge (manual resize,
// Excel-style) and double-click-to-autofit-this-column. Defined once at
// module scope (not inside FuelInvoiceGrid) so its identity never changes
// across renders — if it were recreated per-render, React would remount it
// on any unrelated state change, which would abort an in-progress drag
// (the pointermove/pointerup listeners are attached to `document` for the
// duration of the gesture).
function ResizableHeader({ label, colKey, width, onResize, onAutofit }) {
  // react-datasheet-grid's own column-width virtualizer does not reliably
  // pick up a live basis change while it's mounted (confirmed by direct DOM
  // inspection: correct `basis` values reach the columns prop every time,
  // but the rendered inline width stays stuck at the library's internal
  // 100px default) — the grid has to actually remount to recompute real
  // widths (see the `key` on <DataSheetGrid> in FuelInvoiceGrid). So the
  // drag only shows a lightweight guideline while moving and commits the
  // real width (one state update, one remount) on release, rather than
  // resizing the live grid every frame.
  function onPointerDown(e) {
    e.preventDefault();
    e.stopPropagation();
    const cell = e.currentTarget.closest(".dsg-cell");
    const cellLeft = cell.getBoundingClientRect().left;
    const startX = e.clientX;
    const startWidth = width;
    const guide = document.createElement("div");
    guide.className = "dsg-resize-guide";
    document.body.appendChild(guide);
    function place(px) {
      guide.style.left = `${cellLeft + px}px`;
    }
    place(startWidth);
    let latest = startWidth;
    function onMove(ev) {
      const delta = ev.clientX - startX;
      latest = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(startWidth + delta)));
      place(latest);
    }
    function onUp() {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      guide.remove();
      if (latest !== startWidth) onResize(colKey, latest);
    }
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }
  return (
    <div className="dsg-resizable-header" data-col-key={colKey}>
      <span className="dsg-header-label">{label}</span>
      <span
        className="dsg-resize-handle"
        onPointerDown={onPointerDown}
        onClick={e => e.stopPropagation()}
        onDoubleClick={e => { e.stopPropagation(); onAutofit(colKey); }}
        title="Drag to resize — double-click to fit content"
      />
    </div>
  );
}

// A shared "only one open at a time, close on outside click or Escape"
// popover pattern for the filter toolbar — module scope so its identity
// never changes across FuelInvoiceGrid renders (same reasoning as
// ResizableHeader above). `openKey`/`setOpenKey` live in the parent so
// opening one filter closes whichever other one was open.
function useFilterPopover(filterKey, openKey, setOpenKey) {
  const btnRef = useRef(null);
  const panelRef = useRef(null);
  const [pos, setPos] = useState(null);
  const isOpen = openKey === filterKey;

  useEffect(() => {
    if (isOpen && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      // Clamp so the panel (max 280px, see .filter-dropdown-panel) never
      // runs past the right edge of the viewport for a button sitting near
      // it — "not clipped by the toolbar/table/page boundaries" was an
      // explicit requirement.
      const left = Math.min(r.left, Math.max(8, window.innerWidth - 288));
      setPos({ left, top: r.bottom + 6, minWidth: r.width });
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function onDocMouseDown(e) {
      if (panelRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
      setOpenKey(null);
    }
    function onKeyDown(e) {
      if (e.key === "Escape") { e.stopPropagation(); setOpenKey(null); }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, setOpenKey]);

  function toggle() { setOpenKey(isOpen ? null : filterKey); }
  return { btnRef, panelRef, pos, isOpen, toggle };
}

// Single-select filter pill — click opens a portal-rendered options panel
// (search box included once there are more than a handful of options)
// instead of a native <select>, per her "professional dropdown" request.
// Selecting an option (or "All ...") applies it immediately and closes the
// panel, same semantics as the native select it replaces — no multi-select,
// preserving the existing single-value-per-field filter logic exactly.
function FilterDropdown({ filterKey, label, value, options, openKey, setOpenKey, onSelect }) {
  const { btnRef, panelRef, pos, isOpen, toggle } = useFilterPopover(filterKey, openKey, setOpenKey);
  const [search, setSearch] = useState("");
  useEffect(() => { if (isOpen) setSearch(""); }, [isOpen]);

  const filtered = search.trim()
    ? options.filter(o => o.toLowerCase().includes(search.trim().toLowerCase()))
    : options;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={"filter-pill" + (value ? " filter-pill-active" : "")}
        onClick={toggle}
      >
        <span className="filter-pill-label">{value || label}</span>
        <ChevronDown size={13} />
      </button>
      {isOpen && pos && createPortal(
        <div ref={panelRef} className="filter-dropdown-panel" style={{ left: pos.left, top: pos.top, minWidth: Math.max(pos.minWidth, 160) }}>
          {options.length > 8 && (
            <input
              autoFocus
              className="filter-dropdown-search"
              placeholder={`Search ${label}...`}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          )}
          <div className="filter-dropdown-list">
            <button
              type="button"
              className={"filter-dropdown-option" + (!value ? " selected" : "")}
              onClick={() => { onSelect(""); setOpenKey(null); }}
            >
              All {label}
            </button>
            {filtered.map(opt => (
              <button
                key={opt}
                type="button"
                className={"filter-dropdown-option" + (opt === value ? " selected" : "")}
                onClick={() => { onSelect(opt); setOpenKey(null); }}
              >
                {opt}
              </button>
            ))}
            {filtered.length === 0 && <div className="filter-dropdown-empty">No matches</div>}
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// Date-range filter as the same click-to-open pill, instead of two
// always-visible bare date inputs.
function DateRangeDropdown({ openKey, setOpenKey, dateFrom, dateTo, setDateFrom, setDateTo }) {
  const { btnRef, panelRef, pos, isOpen, toggle } = useFilterPopover("__date_range", openKey, setOpenKey);
  const active = dateFrom || dateTo;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={"filter-pill" + (active ? " filter-pill-active" : "")}
        onClick={toggle}
      >
        <span className="filter-pill-label">{active ? `${dateFrom || "…"} – ${dateTo || "…"}` : "Date Range"}</span>
        <ChevronDown size={13} />
      </button>
      {isOpen && pos && createPortal(
        <div ref={panelRef} className="filter-dropdown-panel filter-dropdown-panel-date" style={{ left: pos.left, top: pos.top }}>
          <label className="filter-dropdown-date-label">
            From
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          </label>
          <label className="filter-dropdown-date-label">
            To
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </label>
          <div className="filter-dropdown-actions">
            <button type="button" className="btn" onClick={() => { setDateFrom(""); setDateTo(""); }}>Clear</button>
            <button type="button" className="btn btn-primary" onClick={() => setOpenKey(null)}>Apply</button>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// The grid's height is set from window.innerHeight, but a bare expression
// read once during render never updates again — the grid would keep
// whatever pixel height happened to be current at the last unrelated
// re-render, not the actual live window size, on a real resize (e.g.
// un-maximizing the browser or rotating a tablet). Tracked in state and
// recomputed on the `resize` event instead, so the grid genuinely stays
// responsive the way "adjusts to different screen sizes" requires.
// Height the grid can use: from wherever the grid's wrapper starts on the page
// (so it sits right under the toolbar, whatever the toolbar's height) to the
// bottom of the window. Re-measured on resize and whenever the layout above it
// changes size (e.g. the toolbar wrapping to a second row).
function useGridHeight(wrapRef, reserve = 0) {
  const [height, setHeight] = useState(() => Math.max(320, window.innerHeight * 0.8 - reserve));
  useEffect(() => {
    function measure() {
      const el = wrapRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      setHeight(Math.max(320, Math.round(window.innerHeight - top - 12 - reserve)));
    }
    measure();
    window.addEventListener("resize", measure);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    const slot = document.getElementById("fx-hero-slot");
    if (ro && slot) ro.observe(slot);
    return () => { window.removeEventListener("resize", measure); ro?.disconnect(); };
  }, [wrapRef, reserve]);
  return height;
}

const fmtTotal = n => (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Excel-style total row fixed under the grid. The grid is virtualised and its
// columns can be resized, so rather than assuming widths this measures where the
// Cost / Amount / VAT header cells actually are and places each total right under
// its own column (re-measured on scroll, resize, and whenever `syncKey` changes).
function TotalsRow({ wrapRef, totals, filtered, syncKey }) {
  const rowRef = useRef(null);
  const [pos, setPos] = useState({});
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return undefined;
    let raf = 0;
    function measure() {
      const base = rowRef.current?.getBoundingClientRect();
      if (!base) return;
      const next = {};
      for (const key of ["cost", "amount", "vat"]) {
        const cell = wrap.querySelector(`.dsg-container [data-col-key="${key}"]`)?.closest(".dsg-cell");
        if (!cell) continue;
        const r = cell.getBoundingClientRect();
        next[key] = { left: Math.round(r.left - base.left), width: Math.round(r.width) };
      }
      setPos(prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    }
    function schedule() {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => { measure(); raf = requestAnimationFrame(measure); });
    }
    schedule();
    const scroller = wrap.querySelector(".dsg-container");
    scroller?.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    const ro = typeof ResizeObserver !== "undefined" && scroller ? new ResizeObserver(schedule) : null;
    if (ro) ro.observe(scroller);
    return () => {
      cancelAnimationFrame(raf);
      scroller?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      ro?.disconnect();
    };
  }, [wrapRef, syncKey]);

  return (
    <div className="fi-totals-row" ref={rowRef} style={{ height: TOTALS_ROW_H }}>
      <span className="fi-total-label">Total (SAR){filtered ? " · filtered" : ""}</span>
      {["cost", "amount", "vat"].map(key => pos[key] && (
        <div key={key} className="fi-total-cell" style={{ left: pos[key].left, width: pos[key].width }} title={key}>
          {fmtTotal(totals[key])}
        </div>
      ))}
    </div>
  );
}

export default function FuelInvoiceGrid() {
  const { isAdmin } = useAuth();
  const { showToast } = useToast();
  const [exporting, setExporting] = useState(false);
  const gridWrapRef = useRef(null);
  const { t } = useLang();
  const tRef = useRef(t);
  tRef.current = t;
  const gridHeight = useGridHeight(gridWrapRef, TOTALS_ROW_H + BOTTOM_BAR_H);
  const { records, loading, syncVersion, deleteRecords, bulkUpsert, updateRecord, insertNewRows } = useFuelInvoiceRecords();
  // What the database holds right now (used to put a row back if its save is rejected),
  // and the invoice keys currently being inserted (so a realtime echo of our own
  // insert is not shown a second time).
  const serverRowsRef = useRef([]);
  serverRowsRef.current = records;
  const pendingKeysRef = useRef(new Set());

  // Per-column widths (px) — null/absent means "use that column's default
  // minWidth". Persisted per-browser (not per-user/synced) since it's a
  // personal layout preference, same idea as a spreadsheet app remembering
  // your last column sizing.
  //
  // Known limitation: react-datasheet-grid doesn't always re-render an
  // already-mounted column at its new width the instant `columnWidths`
  // changes (confirmed the correct value does reach its `columns` prop
  // every time — this is the library's own rendering, not a stale value on
  // our side). The new width is still saved immediately either way, so
  // nothing is ever lost — worst case, a resize/AutoFit needs a page
  // refresh to visibly apply. Forcing a remount to work around it was
  // tried and made things worse (routinely collapsed every column to the
  // library's internal fallback width instead), so it's deliberately not
  // done here.
  const [columnWidths, setColumnWidths] = useState(() => loadStoredColumnWidths());
  const columnWidthsRef = useRef({});
  columnWidthsRef.current = columnWidths;
  const autofitDoneRef = useRef(false);

  // Manual per-row highlight color (see 048 migration, `row_color` column).
  // { key, x, y } of the currently-open swatch popover, anchored to
  // whichever row-number gutter cell was clicked.
  const [colorPicker, setColorPicker] = useState(null);

  // Google-Sheets-style selection summary (Sum/Avg/Min/Max/Count) for whatever
  // range of cells is currently selected, shown in the bottom bar.
  const [selectionStats, setSelectionStats] = useState(null);
  const selectionRef = useRef(null);   // the grid's last non-empty selection {min:{row,col}, max:{row,col}}
  const columnsRef = useRef([]);
  const pasteRedispatchRef = useRef(false);
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;
  const [addCount, setAddCount] = useState(1);

  // The grid's own local, fully-controlled row state (the FULL set — see
  // displayRows below for the filtered subset actually shown) — seeded once
  // from the hook's `records` when they first arrive, then owned locally so
  // typing feels instant instead of waiting on a network round trip per
  // keystroke. Saves happen in the background (see handleChange); new rows
  // created elsewhere (another tab/session) get appended in as they arrive.
  const [allRows, setAllRows] = useState([]);
  const initializedRef = useRef(false);
  const allRowsRef = useRef([]);
  allRowsRef.current = allRows;
  // Ctrl+Z history: a snapshot of the whole (unfiltered) grid taken right
  // before each committed change — capped so it can't grow unbounded.
  const undoStackRef = useRef([]);
  const MAX_UNDO = 50;

  const [search, setSearch] = useState("");
  const [fieldFilters, setFieldFilters] = useState({}); // { [key]: value }
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  // Which filter dropdown (a field key, or "__date_range") is currently
  // open — only one at a time, opening another closes the previous one.
  const [openFilter, setOpenFilter] = useState(null);

  const hasActiveFilters = search.trim() !== "" || dateFrom !== "" || dateTo !== "" || Object.values(fieldFilters).some(Boolean);
  function handleClearFilters() {
    setSearch("");
    setFieldFilters({});
    setDateFrom("");
    setDateTo("");
  }

  useEffect(() => {
    if (!initializedRef.current && !loading) {
      setAllRows(records);
      initializedRef.current = true;
      return;
    }
    if (initializedRef.current) {
      setAllRows(prev => {
        const known = new Set(prev.map(r => r.id).filter(Boolean));
        const missing = records.filter(r => !known.has(r.id) && !pendingKeysRef.current.has(invoiceKey(r)));
        if (!missing.length) return prev;
        // a row saved elsewhere goes where its sort_order belongs (normally the end)
        // among the saved rows; rows still being typed here are never moved
        let next = prev;
        for (const row of missing) {
          const at = row.sort_order == null ? -1 : next.findIndex(r => r.id && r.sort_order != null && Number(r.sort_order) > Number(row.sort_order));
          if (at === -1) next = [...next, row];
          else next = [...next.slice(0, at), row, ...next.slice(at)];
        }
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, loading]);

  // The rows first painted may have come from the local cache; once the real
  // load lands, swap them for the fresh copy (edits/deletes made elsewhere
  // since the cache was written show up), keeping any not-yet-saved rows.
  useEffect(() => {
    if (!syncVersion || !initializedRef.current) return;
    setAllRows(prev => [...records, ...prev.filter(r => !r.id)]);
    undoStackRef.current = [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncVersion]);

  const canEdit = isAdmin;
  const canEditRef = useRef(false);
  canEditRef.current = canEdit;

  // The filtered view actually handed to <DataSheetGrid>. Its row order is
  // whatever `allRows` already holds (fetched date-ascending, day 1 first —
  // see useFuelInvoiceRecords), just with non-matching rows left out. Rows that
  // are not saved yet always stay visible, so a row you just added cannot vanish
  // behind a filter before you have filled it in.
  const displayRows = useMemo(() => {
    const s = search.trim().toLowerCase();
    const filtering = SELECT_FIELD_KEYS.some(k => fieldFilters[k]) || dateFrom || dateTo || s;
    if (!filtering) return allRows;
    return allRows.filter(row => {
      if (!row.id) return true;
      for (const key of SELECT_FIELD_KEYS) {
        if (fieldFilters[key] && (row[key] || "") !== fieldFilters[key]) return false;
      }
      if (dateFrom && (row.entry_date || "") < dateFrom) return false;
      if (dateTo && (row.entry_date || "") > dateTo) return false;
      if (s && !FUEL_INVOICE_FIELDS.some(f => (row[f.key] || "").toString().toLowerCase().includes(s))) return false;
      return true;
    });
  }, [allRows, fieldFilters, dateFrom, dateTo, search]);
  const displayRowsRef = useRef([]);
  displayRowsRef.current = displayRows;

  // Exports every row matching the current filters/search (displayRows is the
  // full filtered set, not just what's virtualised on screen). Read-only:
  // nothing is written to the database.
  async function handleExport() {
    if (exporting) return;
    setExporting(true);
    try {
      const n = await exportFuelInvoiceXlsx(displayRowsRef.current, new Date().toLocaleDateString("en-CA"));
      if (n === 0) showToast("No records to export", "error");
      else showToast(`Exported ${n.toLocaleString()} record${n === 1 ? "" : "s"} to Excel`);
    } catch (err) {
      console.error("Excel export failed", err);
      showToast("Export failed: " + (err?.message || "unknown error"), "error");
    } finally {
      setExporting(false);
    }
  }

  // Google-Sheets-style selection summary. `selection` is react-datasheet-
  // grid's own shape: {min: {row, col}, max: {row, col}} — row/col are
  // 0-based indices into displayRows / COLUMN_DEFS (the gutter column is
  // already excluded from these indices by the library itself). Stable
  // (empty deps): reads displayRowsRef at call time, same reasoning as the
  // gutter/AddRows components above — this fires on every selection change
  // while dragging, so it must never itself trigger a react-datasheet-grid
  // prop-identity change that could revive the width-rendering issue.
  const handleSelectionChange = useMemo(() => ({ selection }) => {
    // `selection` comes back null not just when she deliberately clicks a
    // single cell, but also whenever the grid itself loses focus — which
    // includes clicking the "Total Cost" button to open this very popup.
    // Treating that null the same as "clear the stats" would erase the
    // range she just selected the instant she clicks the button meant to
    // reveal it. So: a real single-cell click (an actual 1x1 selection
    // object) clears the stats; the grid blurring entirely (null) just
    // leaves whatever was last computed on screen, like a spreadsheet's own
    // status bar does.
    if (!selection) return;
    selectionRef.current = selection;
    const { min, max } = selection;
    const rowCount = max.row - min.row + 1;
    const colCount = max.col - min.col + 1;
    if (rowCount * colCount <= 1) { setSelectionStats(null); return; }
    const keys = COLUMN_DEFS.slice(min.col, max.col + 1).map(d => d.key);
    const rows = displayRowsRef.current.slice(min.row, max.row + 1);
    let count = 0, countNumbers = 0, sum = 0, lo = Infinity, hi = -Infinity;
    for (const row of rows) {
      for (const key of keys) {
        const v = row[key];
        if (v === null || v === undefined || v === "") continue;
        count++;
        // Sum / Avg / Min / Max only over money columns (Cost, Amount, VAT): invoice
        // numbers, internal numbers and NIDs are digits too but are not quantities.
        if (!STAT_KEYS.includes(key)) continue;
        const n = Number(v);
        if (Number.isFinite(n)) {
          countNumbers++;
          sum += n;
          if (n < lo) lo = n;
          if (n > hi) hi = n;
        }
      }
    }
    setSelectionStats({
      count, countNumbers, sum,
      avg: countNumbers ? sum / countNumbers : null,
      min: countNumbers ? lo : null,
      max: countNumbers ? hi : null,
    });
  }, []);

  // Copies the selected cells with a heading line on top: only the selected columns,
  // in the order and with the names shown in the table. Plain Ctrl+C stays as it is
  // (cells only) so pasting inside the dashboard never pastes headings as a row.
  async function copyWithHeaders() {
    const sel = selectionRef.current;
    const live = gridWrapRef.current?.querySelector(".dsg-selection-rect, .dsg-active-cell");
    if (!sel || !live) return;
    const defs = COLUMN_DEFS.slice(sel.min.col, sel.max.col + 1);
    const rows = displayRowsRef.current.slice(sel.min.row, sel.max.row + 1);
    const cols = columnsRef.current.slice(sel.min.col, sel.max.col + 1);
    const body = rows.map((rowData, i) => defs.map((d, c) => {
      const v = cols[c]?.copyValue?.({ rowData, rowIndex: sel.min.row + i });
      return v ?? rowData[d.key] ?? "";
    }));
    const { text, html } = buildClipboardTable(defs.map(d => d.title), body);
    const ok = await writeClipboard(text, html);
    showToast(ok ? tRef.current("fuelInvoice.copiedWithHeaders", { n: rows.length }) : tRef.current("fuelInvoice.copyFailed"), ok ? "success" : "error");
  }
  copyWithHeadersRef.current = copyWithHeaders;

  useEffect(() => {
    const typing = (t) => t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
    function onKeyDown(e) {
      // physical key (e.code), so it works on an Arabic layout too
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.code === "KeyC" && !typing(e.target)) {
        e.preventDefault();
        copyWithHeadersRef.current?.();
      }
    }
    // A paste whose first line is exactly the column headings (a "Copy with headers"
    // made here or in Excel) loses that line, so it is never pasted as an invoice.
    // Runs before the grid's own paste handler and hands it the rest.
    function onPaste(e) {
      if (pasteRedispatchRef.current || !canEditRef.current || typing(e.target)) return;
      const text = e.clipboardData?.getData("text/plain");
      if (!text) return;
      const rest = stripPastedHeadingRow(text, COLUMN_DEFS.map(d => d.title));
      if (rest === null) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      showToastRef.current(tRef.current("fuelInvoice.headingRowIgnored"), "success");
      if (!rest.trim()) return;
      const dt = new DataTransfer();
      dt.setData("text/plain", rest);
      pasteRedispatchRef.current = true;
      try { document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); }
      finally { pasteRedispatchRef.current = false; }
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("paste", onPaste, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("paste", onPaste, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Totals of Cost / Amount / VAT over whatever is currently filtered/searched —
  // displayRows already IS that filtered set, so this recomputes whenever a
  // filter changes or a row is edited/added/deleted/pasted. Empty or invalid
  // values are skipped.
  const totals = useMemo(() => {
    let cost = 0, amount = 0, vat = 0;
    for (const row of displayRows) {
      const c = Number(row.cost); if (Number.isFinite(c)) cost += c;
      const a = Number(row.amount); if (Number.isFinite(a)) amount += a;
      const v = Number(row.vat); if (Number.isFinite(v)) vat += v;
    }
    return { cost, amount, vat };
  }, [displayRows]);

  // AutoFit: measure real text width (header + every row's displayed value)
  // per column and clamp to a sensible range — see lib/fuelInvoiceColumnWidths.
  // `single` autofits just one column (double-click its resize handle);
  // omitted, it autofits every column (the toolbar button, and once
  // automatically on first load if she has no saved widths yet).
  function autofitColumns(single) {
    const rows = allRowsRef.current;
    const defs = single ? COLUMN_DEFS.filter(d => d.key === single) : COLUMN_DEFS;
    setColumnWidths(prev => {
      const next = { ...prev };
      for (const def of defs) next[def.key] = computeAutofitWidth(def.title, rows, def.format, def.minWidth);
      saveStoredColumnWidths(next);
      return next;
    });
  }
  useEffect(() => {
    if (!autofitDoneRef.current && !loading && allRows.length && Object.keys(columnWidthsRef.current).length === 0) {
      autofitDoneRef.current = true;
      autofitColumns();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, allRows.length]);

  function handleColumnResize(key, px) {
    setColumnWidths(prev => {
      const next = { ...prev, [key]: px };
      saveStoredColumnWidths(next);
      return next;
    });
  }

  // The row-number gutter must show each row's stable position in the FULL,
  // date-ordered list — not its position within whatever's currently
  // filtered. react-datasheet-grid's default gutter is just `rowIndex + 1`
  // of the array it's handed (displayRows), so it renumbers from 1 every
  // time a filter narrows the view, which looks like rows changed place even
  // though allRows itself never reorders.
  //
  // Created once (empty deps) and reads allRowsRef.current at call time,
  // rather than closing over a freshly-memoized lookup per render — passing
  // a new `gutterColumn` object on every allRows change hit a stale-prop
  // issue in react-datasheet-grid where the grid kept using the gutter
  // column from an earlier render instead of picking up the new one.
  const gutterColumn = useMemo(() => ({
    component: ({ rowData }) => {
      const idx = allRowsRef.current.findIndex(r => rowKey(r) === rowKey(rowData));
      // A row with no database id is not saved yet. Say why next to its number.
      let flag = null;
      if (rowData && !rowData.id) {
        const tt = tRef.current;
        if (rowData.__saving) {
          flag = { icon: "…", title: tt("fuelInvoice.rowSaving") };
        } else if (rowData.__failed) {
          flag = { icon: "⛔", title: tt("fuelInvoice.rowFailed") };
        } else {
          const missing = missingRequiredFields(rowData);
          if (missing.length) {
            const names = missing.map(k => COLUMN_DEFS.find(d => d.key === k)?.title || k).join(", ");
            flag = { icon: "⚠", title: tt("fuelInvoice.rowIncomplete", { fields: names }) };
          }
        }
      }
      return (
        <button
          type="button"
          className={"gutter-row-btn" + (rowData?.row_color ? ` row-color-${rowData.row_color}` : "")}
          title={flag ? flag.title : (canEditRef.current ? "Click to set row color" : undefined)}
          onClick={e => {
            e.stopPropagation();
            if (!canEditRef.current || !rowData?.id) return; // color is stored with the saved row
            const rect = e.currentTarget.getBoundingClientRect();
            setColorPicker({ key: rowKey(rowData), x: rect.left, y: rect.bottom + 4 });
          }}
        >
          {flag && <span className="gutter-flag">{flag.icon}</span>}
          {idx === -1 ? "" : idx + 1}
        </button>
      );
    },
  }), []);

  async function applyRowColor(key, color) {
    setAllRows(cur => cur.map(r => rowKey(r) === key ? { ...r, row_color: color } : r));
    setColorPicker(null);
    const row = allRowsRef.current.find(r => rowKey(r) === key);
    if (!row?.id) return; // never-saved row — color is kept in local state and will save with it
    const { error } = await updateRecord(row.id, { row_color: color });
    if (error) window.alert("Failed to save row color: " + error.message);
  }

  // Close the swatch popover on any outside click.
  useEffect(() => {
    if (!colorPicker) return;
    function onDocClick() { setColorPicker(null); }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [colorPicker]);

  function buildSavePayload(row) {
    const payload = row.id ? { id: row.id } : {};
    for (const key of [
      "data_source", "invoice_number", "internal_number", "fuel_type", "cost", "user_name",
      "entry_date", "card_type", "status", "use_type", "branch", "nid", "deduction_code", "remarks",
      "row_color",
    ]) {
      payload[key] = row[key] ?? null;
    }
    // da_name is filled in by the database (it looks the NID up in the DA
    // directory), and invoice_month is generated there too: neither is sent.
    const derived = payload.cost != null ? computeAmountVat(payload.cost) : { amount: null, vat: null };
    payload.amount = derived.amount;
    payload.vat = derived.vat;
    if (row.sort_order != null) payload.sort_order = row.sort_order; // keeps its place (also when Ctrl+Z puts a deleted row back)
    if (row.id) payload.updated_at = new Date().toISOString();
    return payload;
  }

  // Merges a change made to the FILTERED view back into the full row list,
  // matching by rowKey (id, or the client-side __tempId a brand-new row is
  // given the moment it's created) rather than by array position — array
  // position in the filtered view has no fixed relationship to position in
  // the full list once a filter has hidden some rows.
  function mergeIntoAllRows(newFilteredValue, previousFiltered, operations) {
    setAllRows(prevAll => {
      const next = [...prevAll];
      for (const op of operations) {
        if (op.type === "DELETE") {
          const removedKeys = new Set(previousFiltered.slice(op.fromRowIndex, op.toRowIndex).map(rowKey));
          for (let i = next.length - 1; i >= 0; i--) if (removedKeys.has(rowKey(next[i]))) next.splice(i, 1);
          continue;
        }
        for (const row of newFilteredValue.slice(op.fromRowIndex, op.toRowIndex)) {
          const idx = next.findIndex(r => rowKey(r) === rowKey(row));
          if (idx !== -1) next[idx] = row; else next.push(row);
        }
      }
      return next;
    });
  }

  // Why a save was refused, in words the user can act on.
  function friendlySaveError(error) {
    const msg = error?.message || "";
    if (error?.code === "23505" || /duplicate key|unique constraint/i.test(msg)) return tRef.current("fuelInvoice.duplicateExists");
    if (error?.code === "23514" || /check constraint/i.test(msg)) return tRef.current("fuelInvoice.requiredFields");
    return msg;
  }

  // Rows that already exist: update in place. If the database refuses, put the
  // rows back to what it holds.
  async function saveExistingRows(rows) {
    const { data, error } = await bulkUpsert(rows.map(buildSavePayload));
    if (error) {
      const server = new Map(serverRowsRef.current.map(r => [r.id, r]));
      const ids = new Set(rows.map(r => r.id));
      setAllRows(cur => cur.map(r => (r.id && ids.has(r.id) && server.get(r.id) ? server.get(r.id) : r)));
      showToast(tRef.current("fuelInvoice.saveFailed", { msg: friendlySaveError(error) }), "error");
      return;
    }
    const byId = new Map(data.map(r => [r.id, r]));
    setAllRows(cur => cur.map(r => (r.id && byId.has(r.id) ? { ...r, ...byId.get(r.id) } : r)));
  }

  // New rows: only the complete ones (data source + invoice number + date) are sent,
  // in one request. The database skips any that already exist. Incomplete rows stay
  // in the grid, marked, and are saved the moment they are completed.
  async function saveNewRows(rows) {
    const candidates = rows.filter(r => !r.__saving);
    const complete = candidates.filter(r => missingRequiredFields(r).length === 0);
    const incomplete = candidates.length - complete.length;
    if (!complete.length) return { added: 0, duplicates: [], incomplete };

    const keys = complete.map(rowKey);
    const payloads = complete.map(buildSavePayload);
    const pending = payloads.map(invoiceKey);
    pending.forEach(k => pendingKeysRef.current.add(k));
    setAllRows(cur => cur.map(r => (keys.includes(rowKey(r)) ? { ...r, __saving: true, __failed: false } : r)));

    const { results, error } = await insertNewRows(payloads);
    setTimeout(() => pending.forEach(k => pendingKeysRef.current.delete(k)), 2500);

    if (error && !results) {
      setAllRows(cur => cur.map(r => (keys.includes(rowKey(r)) ? { ...r, __saving: false, __failed: true } : r)));
      showToast(tRef.current("fuelInvoice.saveFailed", { msg: friendlySaveError(error) }), "error");
      return { added: 0, duplicates: [], incomplete };
    }

    setAllRows(cur => {
      const out = [];
      for (const r of cur) {
        const i = keys.indexOf(rowKey(r));
        if (i === -1) { out.push(r); continue; }
        if (results[i].status === "added") {
          // eslint-disable-next-line no-unused-vars
          const { __saving, __failed, ...rest } = r;
          out.push({ ...rest, ...results[i].row }); // id, trimmed values, da_name from the database
        } else if (results[i].status === "failed") {
          out.push({ ...r, __saving: false, __failed: true }); // a big paste stopped part-way: these were not saved
        } // a duplicate is dropped from the grid: it already exists
      }
      const seen = new Set(); // a realtime echo may already have added the same saved row
      return out.filter(r => !r.id || (seen.has(r.id) ? false : (seen.add(r.id), true)));
    });

    if (error) showToast(tRef.current("fuelInvoice.saveFailedPart", { msg: friendlySaveError(error), n: results.filter(x => x.status === "failed").length }), "error");

    return {
      added: results.filter(x => x.status === "added").length,
      duplicates: results.map((x, i) => (x.status === "duplicate" ? payloads[i].invoice_number : null)).filter(Boolean),
      incomplete,
    };
  }

  // react-datasheet-grid batches a whole paste (or a whole typed edit) into
  // one contiguous operation per affected range — so a 200-row paste is one
  // CREATE operation here, saved with a single request, not 200 separate ones.
  async function handleChange(newValue, operations) {
    const previousFiltered = displayRowsRef.current;
    undoStackRef.current.push(allRowsRef.current);
    if (undoStackRef.current.length > MAX_UNDO) undoStackRef.current.shift();
    mergeIntoAllRows(newValue, previousFiltered, operations);

    const summary = { added: 0, duplicates: [], incomplete: 0 };
    for (const op of operations) {
      if (op.type === "DELETE") {
        const removedIds = previousFiltered.slice(op.fromRowIndex, op.toRowIndex).map(r => r.id).filter(Boolean);
        if (removedIds.length) {
          const { error } = await deleteRecords(removedIds);
          if (error) window.alert("Delete failed: " + error.message);
        }
        continue;
      }
      // CREATE or UPDATE
      const slice = newValue.slice(op.fromRowIndex, op.toRowIndex);
      // Saved rows are only sent if something really changed (pasting the same
      // values over a row reports a change too).
      const prevByKey = new Map(previousFiltered.map(r => [rowKey(r), r]));
      const existing = slice.filter(r => r.id && (() => {
        const prev = prevByKey.get(rowKey(r));
        return !prev || SAVED_FIELD_KEYS.some(k => (prev[k] ?? null) !== (r[k] ?? null));
      })());
      const fresh = slice.filter(r => !r.id);
      if (existing.length) await saveExistingRows(existing);
      if (fresh.length) {
        const r = await saveNewRows(fresh);
        summary.added += r.added;
        summary.duplicates.push(...r.duplicates);
        summary.incomplete += r.incomplete;
      }
    }

    // One summary message per change (typing in a half-filled row stays quiet).
    const dup = summary.duplicates.length;
    if (summary.added || dup || summary.incomplete >= 2) {
      const tt = tRef.current;
      let msg = dup ? tt("fuelInvoice.addedIgnored", { added: summary.added, ignored: dup }) : tt("fuelInvoice.added", { added: summary.added });
      if (!summary.added && !dup) msg = "";
      if (dup) msg += `: ${summary.duplicates.slice(0, 5).join(", ")}${dup > 5 ? "…" : ""}`;
      if (summary.incomplete) msg += (msg ? " — " : "") + tt("fuelInvoice.incompleteRows", { n: summary.incomplete });
      showToast(msg, summary.added ? "success" : "error");
    }
  }

  // Adds blank rows in the grid only. Nothing is saved until a row has its data
  // source, invoice number and date.
  function addRows(n) {
    const count = Math.max(1, Math.min(500, Math.round(n) || 1));
    undoStackRef.current.push(allRowsRef.current);
    if (undoStackRef.current.length > MAX_UNDO) undoStackRef.current.shift();
    setAllRows(cur => [...cur, ...Array.from({ length: count }, () => ({ __tempId: `temp-${crypto.randomUUID()}` }))]);
    requestAnimationFrame(() => {
      const scroller = gridWrapRef.current?.querySelector(".dsg-container");
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    });
  }

  function discardEmptyRows() {
    setAllRows(cur => cur.filter(r => r.id || !isBlankRow(r)));
  }

  // Deleting saved rows is permanent (Ctrl+Z restores them, but only in this
  // session), so ask first. The grid is controlled: if the user cancels we
  // simply don't apply the change, and the rows stay exactly as they were.
  function guardedHandleChange(newValue, operations) {
    // Read-only users (e.g. a fleet manager): the grid already disables the cells,
    // but a paste onto one still reports a (no-op) change. Never send anything.
    if (!canEditRef.current) return;
    const current = displayRowsRef.current;
    let savedToDelete = 0;
    for (const op of operations) {
      if (op.type !== "DELETE") continue;
      savedToDelete += current.slice(op.fromRowIndex, op.toRowIndex).filter(r => r.id).length;
    }
    // A saved invoice must keep its data source, invoice number and date: the
    // database would refuse the save anyway, so say so and leave the row as it was.
    // (To remove an invoice, delete the row.)
    let invalidSaved = 0;
    for (const op of operations) {
      if (op.type !== "UPDATE") continue;
      invalidSaved += newValue.slice(op.fromRowIndex, op.toRowIndex).filter(r => r.id && missingRequiredFields(r).length).length;
    }
    if (invalidSaved > 0) {
      showToast(tRef.current("fuelInvoice.requiredSavedRows"), "error");
      return;
    }
    if (savedToDelete > 0) {
      const msg = savedToDelete === 1
        ? "Delete 1 saved record from the database?"
        : `Delete ${savedToDelete.toLocaleString()} saved records from the database?\n\nThis removes them for everyone.`;
      if (!window.confirm(msg)) return;
    }
    return handleChange(newValue, operations);
  }

  // Ctrl+Z: restore the previous full-row-list snapshot, then reconcile
  // that reversal with the database — rows that only exist in the CURRENT
  // state (created by the change being undone) get deleted; rows whose
  // values differ between the two snapshots get saved back to their
  // restored values.
  async function handleUndo() {
    const restored = undoStackRef.current.pop();
    if (!restored) return;
    const current = allRowsRef.current;
    setAllRows(restored);

    const restoredByKey = new Map(restored.map(r => [rowKey(r), r]));
    const currentKeys = new Set(current.map(rowKey));

    const toDelete = [];
    const toSave = [];
    for (const key of currentKeys) if (!restoredByKey.has(key) && typeof key === "string" && !key.startsWith("temp-")) toDelete.push(key);
    for (const [key, row] of restoredByKey) {
      if (!row.id) continue; // never-saved row — nothing in the DB to restore
      const wasRow = current.find(r => rowKey(r) === key);
      if (!wasRow || JSON.stringify(wasRow) !== JSON.stringify(row)) toSave.push(buildSavePayload(row));
    }

    if (toDelete.length) {
      const { error } = await deleteRecords(toDelete);
      if (error) window.alert("Undo failed: " + error.message);
    }
    if (toSave.length) {
      const { error } = await bulkUpsert(toSave);
      if (error) window.alert("Undo failed: " + error.message);
    }
  }

  // Document-level (not a wrapper-div handler): react-datasheet-grid tracks
  // its "active cell" internally without always moving real DOM focus onto
  // a descendant of this component, so a handler relying on React's normal
  // event bubbling through this component's own tree would miss most
  // keypresses. This still only runs while the grid page is mounted.
  useEffect(() => {
    function onKeyDown(e) {
      // `e.code` (physical key position), not `e.key` — `e.key` reports the
      // CHARACTER for whatever keyboard language is currently active, so on
      // an Arabic layout Ctrl+Z's physical key reports the Arabic letter in
      // that slot instead of "z", and the shortcut would silently never
      // match.
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === "KeyZ") {
        e.preventDefault();
        handleUndo();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // Deliberately no deps array: re-attaches every render so it always
    // closes over the latest handleUndo/records — cheap for a single listener.
  });

  const columns = useMemo(() => {
    const colFactories = {
      data_source: () => makeSelectDsgColumn("data_source", () => distinctValues(records, "data_source")),
      invoice_number: () => textColumn,
      internal_number: () => textColumn,
      fuel_type: () => makeSelectDsgColumn("fuel_type", () => distinctValues(records, "fuel_type")),
      cost: () => floatColumn,
      amount: () => makeReadOnlyDsgColumn(money),
      vat: () => makeReadOnlyDsgColumn(money),
      user_name: () => textColumn,
      entry_date: () => dsgDateColumn,
      card_type: () => makeSelectDsgColumn("card_type", () => distinctValues(records, "card_type")),
      status: () => makeSelectDsgColumn("status", () => distinctValues(records, "status")),
      use_type: () => makeSelectDsgColumn("use_type", () => distinctValues(records, "use_type")),
      branch: () => makeSelectDsgColumn("branch", () => distinctValues(records, "branch")),
      nid: () => NID_TEXT_COLUMN,
      da_name: () => makeReadOnlyDsgColumn(),
      deduction_code: () => textColumn,
      remarks: () => textColumn,
    };
    // AutoFit + manual resize: basis is the actual target width (from
    // columnWidths, falling back to that column's default minWidth before
    // any autofit/resize has happened), grow/shrink 0 so columns never
    // stretch/shrink to fill the container — total width can exceed the
    // viewport, which is what makes horizontal scroll kick in naturally.
    const cols = COLUMN_DEFS.map(def => {
      const width = columnWidths[def.key] ?? def.minWidth;
      return {
        ...keyColumn(def.key, colFactories[def.key]()),
        title: (
          <ResizableHeader
            label={def.title}
            colKey={def.key}
            width={width}
            onResize={handleColumnResize}
            onAutofit={autofitColumns}
          />
        ),
        basis: width,
        grow: 0,
        shrink: 0,
        minWidth: MIN_WIDTH,
        maxWidth: MAX_WIDTH,
      };
    });
    if (!canEdit) return cols.map(c => ({ ...c, disabled: true }));
    return cols;
  }, [records, canEdit, columnWidths]);
  columnsRef.current = columns;

  // Rows that are not saved yet: partly filled (missing a required field) or
  // completely blank.
  const partialCount = allRows.filter(r => !r.id && !r.__saving && !isBlankRow(r) && missingRequiredFields(r).length > 0).length;
  const blankCount = allRows.filter(r => !r.id && isBlankRow(r)).length;

  return (
    <div className="fuel-invoice-grid-wrap" ref={gridWrapRef}>
      {/* Portaled into the hero's #fx-hero-slot (same mechanism every other
          page's filter bar already uses — see GlobalFilters/Records.jsx) so
          the toolbar sits in the dark header area instead of its own white
          box above the grid. .fx-hero-slot > .pill-bar is already styled
          `display: contents` for exactly this (dashboard-base.css), and the
          slot itself renders empty (no box at all) when nothing is
          portaled into it, so this never doubles up with anything. */}
      <HeroPortal>
        <div className="pill-bar">
          {GROUPABLE_FIELDS.map(f => (
            <FilterDropdown
              key={f.key}
              filterKey={f.key}
              label={f.label}
              value={fieldFilters[f.key] || ""}
              options={distinctValues(allRows, f.key)}
              openKey={openFilter}
              setOpenKey={setOpenFilter}
              onSelect={opt => setFieldFilters(prev => ({ ...prev, [f.key]: opt }))}
            />
          ))}
          <DateRangeDropdown
            openKey={openFilter}
            setOpenKey={setOpenFilter}
            dateFrom={dateFrom}
            dateTo={dateTo}
            setDateFrom={setDateFrom}
            setDateTo={setDateTo}
          />
          {hasActiveFilters && (
            <button className="btn pill-add-btn" onClick={handleClearFilters}>Clear</button>
          )}
          <button className="btn pill-add-btn" onClick={() => autofitColumns()} title="Fit every column to its content">
            <Maximize2 size={13} style={{ marginInlineEnd: "0.35rem", verticalAlign: "-2px" }} />
            AutoFit columns
          </button>
          <button className="btn pill-add-btn" onClick={handleExport} disabled={exporting} title="Download the currently filtered records as .xlsx">
            <Download size={13} style={{ marginInlineEnd: "0.35rem", verticalAlign: "-2px" }} />
            {exporting ? "Exporting…" : "Export to Excel"}
          </button>
          <span style={{ flex: 1 }} />
          <div className="pill-search">
            <span className="pill-search-ic"><Search size={14} /></span>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." />
          </div>
        </div>
      </HeroPortal>

      <DataSheetGrid
        value={displayRows}
        onChange={guardedHandleChange}
        columns={columns}
        gutterColumn={gutterColumn}
        addRowsComponent={false}
        rowClassName={({ rowData, rowIndex }) => {
          const classes = [];
          if (rowData && !rowData.id) classes.push(rowData.__failed ? "fi-row-failed" : "fi-row-unsaved");
          if (rowIndex % 2 === 1) classes.push("dsg-row-alt");
          if (rowData?.row_color) classes.push(`row-color-${rowData.row_color}`);
          return classes.join(" ") || undefined;
        }}
        rowKey={({ rowData, rowIndex }) => rowKey(rowData) ?? `new-${rowIndex}`}
        lockRows={!canEdit}
        height={gridHeight}
        rowHeight={38}
        headerRowHeight={42}
        createRow={() => ({ __tempId: `temp-${crypto.randomUUID()}` })}
        onSelectionChange={handleSelectionChange}
        contextMenuComponent={FiContextMenu}
      />

      <TotalsRow
        wrapRef={gridWrapRef}
        totals={totals}
        filtered={displayRows.length !== allRows.length}
        syncKey={`${JSON.stringify(columnWidths)}|${displayRows.length}|${gridHeight}|${loading}`}
      />

      <div className="fi-bottom-bar" style={{ height: BOTTOM_BAR_H }}>
        <span className="cards-count">
          {displayRows.length}{displayRows.length !== allRows.length ? ` of ${allRows.length}` : ""} record{allRows.length === 1 ? "" : "s"}
        </span>
        {partialCount > 0 && (
          <span className="fi-incomplete-note" title={t("fuelInvoice.incompleteHint")}>⚠ {t("fuelInvoice.incompleteRows", { n: partialCount })}</span>
        )}
        {canEdit && blankCount > 0 && (
          <button type="button" className="fi-link-btn" onClick={discardEmptyRows}>{t("fuelInvoice.discardEmpty", { n: blankCount })}</button>
        )}
        <span style={{ flex: 1 }} />
        {selectionStats && (
          <span className="fi-sel-stats" title="Selected cells">
            {selectionStats.countNumbers > 0 && (
              <>
                <span>Sum <b>{selectionStats.sum.toLocaleString("en-US", { maximumFractionDigits: 2 })}</b></span>
                <span>Avg <b>{selectionStats.avg != null ? selectionStats.avg.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "—"}</b></span>
                <span>Min <b>{selectionStats.min}</b></span>
                <span>Max <b>{selectionStats.max}</b></span>
              </>
            )}
            <span>Count <b>{selectionStats.count.toLocaleString("en-US")}</b></span>
          </span>
        )}
        {canEdit && (
          <div className="fi-add-rows">
            <button type="button" className="dsg-add-row-btn" onClick={() => addRows(addCount)}>Add</button>
            <input
              className="dsg-add-row-input"
              type="number"
              min={1}
              value={addCount}
              onChange={e => setAddCount(Math.max(1, Math.round(parseInt(e.target.value) || 0)))}
              onKeyDown={e => { if (e.key === "Enter") addRows(addCount); }}
            />
            <span> rows</span>
          </div>
        )}
      </div>

      {colorPicker && (
        <div
          className="row-color-popover"
          style={{ position: "fixed", left: colorPicker.x, top: colorPicker.y }}
          onClick={e => e.stopPropagation()}
        >
          <button type="button" className="row-color-swatch row-color-swatch-none" title="Clear color" onClick={() => applyRowColor(colorPicker.key, null)}>
            <X size={12} />
          </button>
          {ROW_COLOR_OPTIONS.map(opt => (
            <button
              key={opt.key}
              type="button"
              className={`row-color-swatch row-color-swatch-${opt.key}`}
              title={opt.label}
              onClick={() => applyRowColor(colorPicker.key, opt.key)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
