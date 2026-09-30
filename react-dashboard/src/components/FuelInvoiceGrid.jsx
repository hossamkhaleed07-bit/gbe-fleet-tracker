import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Maximize2, X } from "lucide-react";
import { DataSheetGrid, keyColumn, textColumn, floatColumn, createTextColumn } from "react-datasheet-grid";
import "react-datasheet-grid/dist/style.css";
import { useAuth } from "../contexts/AuthContext";
import { useFuelInvoiceRecords } from "../hooks/useFuelInvoiceRecords";
import { useFuelInvoiceDaDirectory } from "../hooks/useFuelInvoiceDaDirectory";
import { FUEL_INVOICE_FIELDS, SELECT_FIELD_KEYS, distinctValues, computeAmountVat, money, moneyGrouped, ROW_COLOR_OPTIONS } from "../lib/fuelInvoice";
import { makeSelectDsgColumn, makeReadOnlyDsgColumn, dsgDateColumn } from "./fuelInvoiceDsgColumns";
import { computeAutofitWidth, loadStoredColumnWidths, saveStoredColumnWidths, MIN_WIDTH, MAX_WIDTH } from "../lib/fuelInvoiceColumnWidths";

const NID_TEXT_COLUMN = createTextColumn(); // plain text — never coerced to a number, so leading zeros survive
const GROUPABLE_FIELDS = FUEL_INVOICE_FIELDS.filter(f => SELECT_FIELD_KEYS.includes(f.key));

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
    <div className="dsg-resizable-header">
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

export default function FuelInvoiceGrid() {
  const { isAdmin } = useAuth();
  const { records, loading, deleteRecords, bulkUpsert, updateRecord } = useFuelInvoiceRecords();
  const { lookup: lookupDaName } = useFuelInvoiceDaDirectory();

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
        const missing = records.filter(r => !known.has(r.id));
        return missing.length ? [...prev, ...missing] : prev;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, loading]);

  const canEdit = isAdmin;
  const canEditRef = useRef(false);
  canEditRef.current = canEdit;

  // The filtered view actually handed to <DataSheetGrid>. Its row order is
  // whatever `allRows` already holds (fetched date-ascending, day 1 first —
  // see useFuelInvoiceRecords), just with non-matching rows left out.
  const displayRows = useMemo(() => {
    let r = allRows;
    for (const key of SELECT_FIELD_KEYS) {
      if (fieldFilters[key]) r = r.filter(row => (row[key] || "") === fieldFilters[key]);
    }
    if (dateFrom) r = r.filter(row => (row.entry_date || "") >= dateFrom);
    if (dateTo) r = r.filter(row => (row.entry_date || "") <= dateTo);
    if (search.trim()) {
      const s = search.trim().toLowerCase();
      r = r.filter(row => FUEL_INVOICE_FIELDS.some(f => (row[f.key] || "").toString().toLowerCase().includes(s)));
    }
    return r;
  }, [allRows, fieldFilters, dateFrom, dateTo, search]);
  const displayRowsRef = useRef([]);
  displayRowsRef.current = displayRows;

  // Sum of the Cost column across whatever's currently filtered/searched —
  // displayRows already IS that filtered set (client-side, all rows are
  // loaded up front by the hook, no pagination to worry about), so this
  // recomputes for free whenever a filter changes or a row is edited/added/
  // deleted/pasted. Invalid/empty Cost values are excluded rather than
  // treated as 0-affecting NaN.
  const totalCost = useMemo(() => {
    let sum = 0;
    for (const row of displayRows) {
      const n = Number(row.cost);
      if (Number.isFinite(n)) sum += n;
    }
    return sum;
  }, [displayRows]);
  const totalCostRef = useRef(0);
  totalCostRef.current = totalCost;

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
      return (
        <button
          type="button"
          className={"gutter-row-btn" + (rowData?.row_color ? ` row-color-${rowData.row_color}` : "")}
          title={canEditRef.current ? "Click to set row color" : undefined}
          onClick={e => {
            e.stopPropagation();
            if (!canEditRef.current) return;
            const rect = e.currentTarget.getBoundingClientRect();
            setColorPicker({ key: rowKey(rowData), x: rect.left, y: rect.bottom + 4 });
          }}
        >
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

  // Record count moved next to the grid's own native "Add N rows" control
  // (same bottom bar, not a separate line above the grid) — stable
  // (empty deps) for the same reason as gutterColumn above, reading the
  // live counts via refs at render time instead of closing over a
  // per-render value.
  const addRowsComponent = useMemo(() => function AddRowsWithCount({ addRows }) {
    const [value, setValueState] = useState(1);
    return (
      <div className="dsg-add-row fuel-invoice-add-row">
        <div className="cards-count">
          {displayRowsRef.current.length}{displayRowsRef.current.length !== allRowsRef.current.length ? ` of ${allRowsRef.current.length}` : ""} record{allRowsRef.current.length === 1 ? "" : "s"}
        </div>
        <div className="fuel-invoice-total-cost">Total Cost: {moneyGrouped(totalCostRef.current)}</div>
        <span style={{ flex: 1 }} />
        <button type="button" className="dsg-add-row-btn" onClick={() => addRows(value)}>Add</button>
        <input
          className="dsg-add-row-input"
          type="number"
          min={1}
          value={value}
          onChange={e => setValueState(Math.max(1, Math.round(parseInt(e.target.value) || 0)))}
          onKeyDown={e => { if (e.key === "Enter") addRows(value); }}
        />
        <span> rows</span>
      </div>
    );
  }, []);

  function buildSavePayload(row) {
    const payload = row.id ? { id: row.id } : {};
    for (const key of [
      "data_source", "invoice_number", "internal_number", "fuel_type", "cost", "user_name",
      "entry_date", "card_type", "status", "use_type", "branch", "nid", "deduction_code", "remarks",
      "row_color",
    ]) {
      payload[key] = row[key] ?? null;
    }
    const derived = payload.cost != null ? computeAmountVat(payload.cost) : { amount: null, vat: null };
    payload.amount = derived.amount;
    payload.vat = derived.vat;
    payload.da_name = payload.nid ? lookupDaName(payload.nid) : null;
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

  // react-datasheet-grid batches a whole paste (or a whole typed edit) into
  // one contiguous operation per affected range — so a 200-row paste is one
  // CREATE operation here, saved with a single bulkUpsert call, not 200
  // separate requests.
  async function handleChange(newValue, operations) {
    const previousFiltered = displayRowsRef.current;
    undoStackRef.current.push(allRowsRef.current);
    if (undoStackRef.current.length > MAX_UNDO) undoStackRef.current.shift();
    mergeIntoAllRows(newValue, previousFiltered, operations);

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
      const keys = slice.map(rowKey);
      const payloads = slice.map(buildSavePayload);
      if (!payloads.length) continue;
      const { data, error } = await bulkUpsert(payloads);
      if (error) { window.alert("Save failed: " + error.message); continue; }
      // Write the DB-generated id (and server-computed fields) back into
      // the matching rows (by their stable key, not position — a filter
      // may have changed what's visible while this save was in flight).
      setAllRows(cur => cur.map(r => {
        const i = keys.indexOf(rowKey(r));
        return i === -1 ? r : { ...r, ...data[i] };
      }));
    }
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
    // closes over the latest handleUndo/lookupDaName/records (lookupDaName
    // in particular closes over state that starts empty before the DA
    // directory finishes loading) — cheap for a single listener.
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

  return (
    <div className="fuel-invoice-grid-wrap">
      <div className="pill-bar">
        {GROUPABLE_FIELDS.map(f => (
          <div className="pill-select-wrap" key={f.key}>
            <select value={fieldFilters[f.key] || ""} onChange={e => setFieldFilters(prev => ({ ...prev, [f.key]: e.target.value }))}>
              <option value="">{f.label}</option>
              {distinctValues(allRows, f.key).map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </div>
        ))}
        <div className="pill-date-wrap">
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} title="From date" />
          <span className="ink-muted">–</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} title="To date" />
        </div>
        {hasActiveFilters && (
          <button className="btn pill-add-btn" onClick={handleClearFilters}>Clear</button>
        )}
        <button className="btn pill-add-btn" onClick={() => autofitColumns()} title="Fit every column to its content">
          <Maximize2 size={13} style={{ marginInlineEnd: "0.35rem", verticalAlign: "-2px" }} />
          AutoFit columns
        </button>
        <span style={{ flex: 1 }} />
        <div className="pill-search">
          <span className="pill-search-ic"><Search size={14} /></span>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." />
        </div>
      </div>

      <DataSheetGrid
        value={displayRows}
        onChange={handleChange}
        columns={columns}
        gutterColumn={gutterColumn}
        addRowsComponent={addRowsComponent}
        rowClassName={({ rowData, rowIndex }) => {
          const classes = [];
          if (rowIndex % 2 === 1) classes.push("dsg-row-alt");
          if (rowData?.row_color) classes.push(`row-color-${rowData.row_color}`);
          return classes.join(" ") || undefined;
        }}
        rowKey={({ rowData, rowIndex }) => rowKey(rowData) ?? `new-${rowIndex}`}
        lockRows={!canEdit}
        height={window.innerHeight * 0.65}
        rowHeight={38}
        headerRowHeight={42}
        createRow={() => ({ __tempId: `temp-${crypto.randomUUID()}` })}
      />

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
