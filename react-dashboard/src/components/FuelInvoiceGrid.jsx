import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { DataSheetGrid, keyColumn, textColumn, floatColumn, createTextColumn } from "react-datasheet-grid";
import "react-datasheet-grid/dist/style.css";
import { useAuth } from "../contexts/AuthContext";
import { useFuelInvoiceRecords } from "../hooks/useFuelInvoiceRecords";
import { useFuelInvoiceDaDirectory } from "../hooks/useFuelInvoiceDaDirectory";
import { FUEL_INVOICE_FIELDS, SELECT_FIELD_KEYS, distinctValues, computeAmountVat, money } from "../lib/fuelInvoice";
import { makeSelectDsgColumn, makeReadOnlyDsgColumn, dsgDateColumn } from "./fuelInvoiceDsgColumns";

const NID_TEXT_COLUMN = createTextColumn(); // plain text — never coerced to a number, so leading zeros survive
const GROUPABLE_FIELDS = FUEL_INVOICE_FIELDS.filter(f => SELECT_FIELD_KEYS.includes(f.key));

// A stable per-row key that exists from the moment a row is created — even
// before it's ever been saved (and so has no database `id` yet). Needed so
// filtering can show a subset of rows to react-datasheet-grid while still
// correctly reconciling edits back into the FULL row list by identity
// rather than by array position (which the filtered view can't provide).
function rowKey(row) {
  return row.id ?? row.__tempId;
}

export default function FuelInvoiceGrid() {
  const { isAdmin } = useAuth();
  const { records, loading, deleteRecords, bulkUpsert } = useFuelInvoiceRecords();
  const { lookup: lookupDaName } = useFuelInvoiceDaDirectory();

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
      return idx === -1 ? "" : idx + 1;
    },
  }), []);

  function buildSavePayload(row) {
    const payload = row.id ? { id: row.id } : {};
    for (const key of [
      "data_source", "invoice_number", "internal_number", "fuel_type", "cost", "user_name",
      "entry_date", "card_type", "status", "use_type", "branch", "nid", "deduction_code", "remarks",
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
    const cols = [
      { ...keyColumn("data_source", makeSelectDsgColumn("data_source", () => distinctValues(records, "data_source"))), title: "Data Source", minWidth: 130 },
      { ...keyColumn("invoice_number", textColumn), title: "Invoice Number", minWidth: 130 },
      { ...keyColumn("internal_number", textColumn), title: "Internal number", minWidth: 150 },
      { ...keyColumn("fuel_type", makeSelectDsgColumn("fuel_type", () => distinctValues(records, "fuel_type"))), title: "Type of fuel", minWidth: 110 },
      { ...keyColumn("cost", floatColumn), title: "Cost", minWidth: 100 },
      { ...keyColumn("amount", makeReadOnlyDsgColumn(money)), title: "Amount", minWidth: 110 },
      { ...keyColumn("vat", makeReadOnlyDsgColumn(money)), title: "VAT", minWidth: 100 },
      { ...keyColumn("user_name", textColumn), title: "User Name", minWidth: 220 },
      { ...keyColumn("entry_date", dsgDateColumn), title: "Date", minWidth: 140 },
      { ...keyColumn("card_type", makeSelectDsgColumn("card_type", () => distinctValues(records, "card_type"))), title: "Card Type", minWidth: 130 },
      { ...keyColumn("status", makeSelectDsgColumn("status", () => distinctValues(records, "status"))), title: "Status", minWidth: 140 },
      { ...keyColumn("use_type", makeSelectDsgColumn("use_type", () => distinctValues(records, "use_type"))), title: "Use type", minWidth: 130 },
      { ...keyColumn("branch", makeSelectDsgColumn("branch", () => distinctValues(records, "branch"))), title: "Branch", minWidth: 120 },
      { ...keyColumn("nid", NID_TEXT_COLUMN), title: "NID", minWidth: 130 },
      { ...keyColumn("da_name", makeReadOnlyDsgColumn()), title: "DA Name", minWidth: 220 },
      { ...keyColumn("deduction_code", textColumn), title: "Deduction code", minWidth: 150 },
      { ...keyColumn("remarks", textColumn), title: "Remarks", minWidth: 200 },
    ];
    if (!canEdit) return cols.map(c => ({ ...c, disabled: true }));
    return cols;
  }, [records, canEdit]);

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
        <span style={{ flex: 1 }} />
        <div className="pill-search">
          <span className="pill-search-ic"><Search size={14} /></span>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." />
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.6rem" }}>
        <div className="cards-count">
          {displayRows.length}{displayRows.length !== allRows.length ? ` of ${allRows.length}` : ""} record{allRows.length === 1 ? "" : "s"}
          <span className="ink-muted" style={{ marginInlineStart: "0.6rem" }}>
            — click a cell to select it, arrow keys / Shift+arrows to navigate and select, Ctrl+C / Ctrl+V to copy-paste a range from Excel or Sheets, Ctrl+Z to undo, right-click a row for insert/delete/duplicate.
          </span>
        </div>
      </div>

      <DataSheetGrid
        value={displayRows}
        onChange={handleChange}
        columns={columns}
        gutterColumn={gutterColumn}
        rowKey={({ rowData, rowIndex }) => rowKey(rowData) ?? `new-${rowIndex}`}
        lockRows={!canEdit}
        height={window.innerHeight * 0.65}
        rowHeight={38}
        headerRowHeight={42}
        createRow={() => ({ __tempId: `temp-${crypto.randomUUID()}` })}
      />
    </div>
  );
}
