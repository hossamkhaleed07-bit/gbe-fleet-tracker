import { useMemo, useRef, useState } from "react";
import { Type, Hash, DollarSign, CalendarDays, CircleDot, AlignLeft, IdCard, Layers, Search } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import VirtualizedGrid from "./VirtualizedGrid";
import PillSelectField from "./PillSelectField";
import FuelInvoiceRecordModal from "./FuelInvoiceRecordModal";
import { useFuelInvoiceRecords } from "../hooks/useFuelInvoiceRecords";
import { useFuelInvoiceDaDirectory } from "../hooks/useFuelInvoiceDaDirectory";
import {
  FUEL_INVOICE_FIELDS, SELECT_FIELD_KEYS, PASTE_FIELD_ORDER, distinctValues, emptyFuelInvoiceForm, money, fieldColorKey,
  computeAmountVat, parsePastedDate, parsePastedNumber,
} from "../lib/fuelInvoice";

const GROUPABLE_FIELDS = FUEL_INVOICE_FIELDS.filter(f => SELECT_FIELD_KEYS.includes(f.key));
// "Date" first — grouping by day, with a blank row per day to type straight
// into, is the main daily-entry workflow this grid is built around.
const GROUP_OPTIONS = [{ key: "entry_date", label: "Date" }, ...GROUPABLE_FIELDS];

function today() {
  return new Date().toISOString().slice(0, 10);
}

// A small type-glyph per field, next to its header label — Airtable-style
// column headers (text/number/date/select fields each show their kind).
const FIELD_TYPE_ICON = {
  text: <Type size={12} />,
  number: <Hash size={12} />,
  currency: <DollarSign size={12} />,
  computed: <Hash size={12} />,
  date: <CalendarDays size={12} />,
  select: <CircleDot size={12} />,
  longtext: <AlignLeft size={12} />,
  lookup: <IdCard size={12} />,
};

// Generic inline text/number cell — local draft buffer so typing feels
// instant, commits on blur. Works for both a real record (commit → update)
// and the blank draft row at the bottom of each group (commit → create a
// new record with just this one field, Airtable-"+"-row style — the row
// then shows up as a real row elsewhere, and this same blank slot stays
// ready for the next new entry).
function InlineTextCell({ value, inputType = "text", multiline, onCommit, onFocus }) {
  const [draft, setDraft] = useState(value ?? "");
  const [dirty, setDirty] = useState(false);
  const shown = dirty ? draft : (value ?? "");

  function commit() {
    setDirty(false);
    if (shown === (value ?? "")) return;
    onCommit(shown === "" ? null : shown);
  }

  const props = {
    value: shown,
    onChange: e => { setDraft(e.target.value); setDirty(true); },
    onFocus,
    onBlur: commit,
    onKeyDown: e => { if (e.key === "Enter" && !multiline) e.currentTarget.blur(); },
    className: "notes-cell-input",
    placeholder: "—",
  };
  return multiline ? <textarea rows={1} {...props} /> : <input type={inputType} inputMode={inputType === "number" ? "decimal" : undefined} {...props} />;
}

function InlineDateCell({ value, onCommit, onFocus }) {
  return (
    <input
      type="date"
      className="notes-cell-input"
      value={value || ""}
      onFocus={onFocus}
      onChange={e => onCommit(e.target.value || null)}
    />
  );
}

export default function FuelInvoiceGrid() {
  const { isAdmin } = useAuth();
  const { records, loading, error, createRecord, updateRecord, deleteRecords, bulkUpsert } = useFuelInvoiceRecords();
  const { lookup: lookupDaName } = useFuelInvoiceDaDirectory();
  // Which cell last had focus — read (not reacted to) only when a paste
  // event fires, so tracking it never triggers a re-render on every click.
  const activeCellRef = useRef(null);
  const [pasting, setPasting] = useState(false);

  const [search, setSearch] = useState("");
  const [fieldFilters, setFieldFilters] = useState({}); // { [key]: value }
  const [groupBy, setGroupBy] = useState("");
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [modalState, setModalState] = useState(null); // null | { isNew, record }
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [busyDelete, setBusyDelete] = useState(false);

  const canEdit = isAdmin;

  const rows = useMemo(() => {
    let r = records;
    for (const key of SELECT_FIELD_KEYS) {
      if (fieldFilters[key]) r = r.filter(rec => (rec[key] || "") === fieldFilters[key]);
    }
    if (search.trim()) {
      const s = search.trim().toLowerCase();
      r = r.filter(rec =>
        FUEL_INVOICE_FIELDS.some(f => (rec[f.key] || "").toString().toLowerCase().includes(s))
      );
    }
    return r;
  }, [records, fieldFilters, search]);

  function toggleOne(id) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  const allSelected = rows.length > 0 && rows.every(r => selectedIds.has(r.id));
  function toggleAll() {
    setSelectedIds(allSelected ? new Set() : new Set(rows.map(r => r.id)));
  }

  async function handleInlineFieldSave(record, key, value) {
    const patch = { [key]: value || null, updated_at: new Date().toISOString() };
    if (key === "cost") Object.assign(patch, computeAmountVat(value));
    // Mirrors the source sheet's VLOOKUP(NID, 'DA DB'!A:L, 2, FALSE) — typing
    // a NID inline re-derives DA Name too, same as the full edit modal does.
    if (key === "nid") patch.da_name = lookupDaName(value);
    const { error: err } = await updateRecord(record.id, patch);
    if (err) window.alert("Save failed: " + err.message);
  }

  // The blank "+" row at the bottom of a group: the first field anyone types
  // into it creates a brand-new record (with just that field, plus the
  // group's own date when grouping by day) — it then appears as its own real
  // row, and this same slot stays blank underneath, ready for the next one.
  async function handleDraftFieldSave(defaultDate, key, value) {
    if (!value) return;
    const payload = { [key]: value, entry_date: defaultDate || today() };
    if (key === "cost") Object.assign(payload, computeAmountVat(value));
    if (key === "nid") payload.da_name = lookupDaName(value);
    const { error: err } = await createRecord(payload);
    if (err) window.alert("Save failed: " + err.message);
  }

  function commitField(rec, field, value) {
    return rec.__isDraft ? handleDraftFieldSave(rec.__draftDate, field, value) : handleInlineFieldSave(rec, field, value);
  }

  function openAdd() {
    setSaveError("");
    setModalState({ isNew: true, record: emptyFuelInvoiceForm() });
  }
  function openEdit(record) {
    setSaveError("");
    setModalState({ isNew: false, record });
  }

  async function handleSave(form) {
    setSaving(true);
    setSaveError("");
    const payload = {};
    for (const f of FUEL_INVOICE_FIELDS) {
      const v = form[f.key];
      if (f.type === "number" || f.type === "currency" || f.type === "computed") payload[f.key] = v === "" || v == null ? null : Number(v);
      else payload[f.key] = v === "" ? null : v;
    }
    const result = modalState.isNew
      ? await createRecord(payload)
      : await updateRecord(modalState.record.id, { ...payload, updated_at: new Date().toISOString() });
    setSaving(false);
    if (result.error) { setSaveError("Save failed: " + result.error.message); return; }
    setModalState(null);
  }

  async function handleDeleteSelected() {
    if (!selectedIds.size) return;
    if (!window.confirm(`Delete ${selectedIds.size} record(s)? This cannot be undone.`)) return;
    setBusyDelete(true);
    const { error: err } = await deleteRecords([...selectedIds]);
    setBusyDelete(false);
    if (err) { window.alert("Delete failed: " + err.message); return; }
    setSelectedIds(new Set());
  }

  // Bulk paste from Excel/Google Sheets: a multi-cell copy arrives as
  // tab-separated columns / newline-separated rows. Pasting from the blank
  // "+" row creates every pasted row fresh; pasting onto an existing row
  // updates it and every row below it (by current position), creating new
  // rows only for whatever overflows past the end — matching a real
  // spreadsheet's paste behavior. One single network call either way
  // (bulkUpsert) regardless of how many rows were pasted.
  async function handleGridPaste(e) {
    const target = e.target;
    if (!target.closest?.(".notes-cell-input, .reason-pill-select")) return;
    const text = e.clipboardData.getData("text/plain");
    if (!text || !/[\t\n]/.test(text)) return; // a single value — let the normal single-cell paste happen
    const active = activeCellRef.current;
    if (!active) return;
    const startCol = PASTE_FIELD_ORDER.indexOf(active.fieldKey);
    if (startCol === -1) return;

    e.preventDefault();

    const lines = text.replace(/\r/g, "").split("\n");
    while (lines.length && lines[lines.length - 1] === "") lines.pop();
    const grid2d = lines.map(line => line.split("\t"));

    let baseRows = [];
    if (!active.isDraft) {
      const idx = rows.findIndex(r => r.id === active.recId);
      if (idx !== -1) baseRows = rows.slice(idx);
    }

    const payloads = grid2d.map((line, r) => {
      const existing = baseRows[r];
      const payload = existing ? { id: existing.id } : { entry_date: active.isDraft ? (active.draftDate || today()) : null };
      for (let c = 0; c < line.length; c++) {
        const fieldKey = PASTE_FIELD_ORDER[startCol + c];
        // amount/vat/da_name are always derived, never taken from pasted
        // text directly — recomputed below from cost/nid instead, so a
        // paste of the full 17-column sheet range (which includes these
        // formula columns) still ends up correct rather than stale.
        if (!fieldKey || fieldKey === "amount" || fieldKey === "vat" || fieldKey === "da_name") continue;
        const raw = line[c];
        if (fieldKey === "entry_date") { const d = parsePastedDate(raw); if (d) payload.entry_date = d; }
        else if (fieldKey === "cost") payload.cost = parsePastedNumber(raw);
        else payload[fieldKey] = raw?.trim() || null;
      }
      if (payload.cost != null) Object.assign(payload, computeAmountVat(payload.cost));
      if (payload.nid) payload.da_name = lookupDaName(payload.nid);
      return payload;
    });

    setPasting(true);
    const { error: err } = await bulkUpsert(payloads);
    setPasting(false);
    if (err) window.alert("Paste failed: " + err.message);
  }

  const columns = useMemo(() => {
    const cols = [
      {
        id: "select", enableSorting: false,
        header: () => <input type="checkbox" checked={allSelected} onChange={toggleAll} />,
        cell: ({ row }) => row.original.__isDraft ? null : <input type="checkbox" checked={selectedIds.has(row.original.id)} onChange={() => toggleOne(row.original.id)} />,
      },
      { id: "index", header: "#", enableSorting: false, cell: ({ row }) => row.original.__isDraft ? <span style={{ opacity: 0.4 }}>+</span> : row.index + 1 },
    ];
    for (const f of FUEL_INVOICE_FIELDS) {
      cols.push({
        accessorKey: f.key,
        header: () => <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>{FIELD_TYPE_ICON[f.type]} {f.label}</span>,
        cell: ({ row }) => {
          const rec = row.original;
          const v = rec[f.key];
          const editable = canEdit;
          const focusInfo = () => { activeCellRef.current = { recId: rec.id, isDraft: !!rec.__isDraft, draftDate: rec.__draftDate, fieldKey: f.key }; };

          if (f.type === "select") {
            return (
              <PillSelectField
                value={v}
                options={distinctValues(records, f.key)}
                colorFor={val => fieldColorKey(f.key, val)}
                disabled={!canEdit}
                onFocus={focusInfo}
                onChange={newVal => commitField(rec, f.key, newVal)}
              />
            );
          }
          if (f.type === "computed") return money(rec.__isDraft ? computeAmountVat(rec.cost)[f.key] : v);
          if (f.type === "lookup") return v || (rec.__isDraft ? "" : "—");
          if (!editable) {
            if (f.type === "currency") return money(v);
            if (f.type === "longtext") return <span title={v || ""} style={{ display: "inline-block", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", verticalAlign: "bottom" }}>{v || "—"}</span>;
            return v ?? "—";
          }
          if (f.type === "date") return <InlineDateCell value={v} onFocus={focusInfo} onCommit={val => commitField(rec, f.key, val)} />;
          if (f.type === "currency") return <InlineTextCell value={v} inputType="number" onFocus={focusInfo} onCommit={val => commitField(rec, f.key, val)} />;
          if (f.type === "longtext") return <InlineTextCell value={v} multiline onFocus={focusInfo} onCommit={val => commitField(rec, f.key, val)} />;
          return <InlineTextCell value={v} onFocus={focusInfo} onCommit={val => commitField(rec, f.key, val)} />;
        },
      });
    }
    cols.push({
      id: "actions", header: "", enableSorting: false,
      cell: ({ row }) => (canEdit && !row.original.__isDraft)
        ? <button className="btn" onClick={() => openEdit(row.original)}>Edit</button>
        : null,
    });
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, selectedIds, allSelected, canEdit]);

  // One blank "+" row template — same shape as a real record so every column
  // renders consistently, just flagged __isDraft so the cell renderer above
  // creates-on-commit instead of update-on-commit.
  function makeDraftRow(draftDate) {
    return {
      ...emptyFuelInvoiceForm(),
      id: `draft-${draftDate || "all"}`,
      __isDraft: true,
      __draftDate: draftDate || today(),
      entry_date: draftDate || today(),
    };
  }

  const groups = useMemo(() => {
    if (!groupBy) return null;
    const map = new Map();
    for (const r of rows) {
      const key = r[groupBy] || "(empty)";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    }
    const entries = [...map.entries()];
    // Date groups read naturally most-recent-first (today's entries at top);
    // every other grouping keeps its existing alphabetical order.
    entries.sort((a, b) => groupBy === "entry_date" ? b[0].localeCompare(a[0]) : a[0].localeCompare(b[0]));
    return entries;
  }, [rows, groupBy]);

  return (
    <div onPaste={handleGridPaste}>
      {/* Airtable-style horizontal chip toolbar: one rounded pill-select per
          filterable field (instead of this app's usual vertical field/label
          blocks), a Group-by pill, then search + New Entry on the far side —
          mirrors the reference "Bank Cards" toolbar layout. */}
      <div className="pill-bar">
        {GROUPABLE_FIELDS.map(f => (
          <div className="pill-select-wrap" key={f.key}>
            <select value={fieldFilters[f.key] || ""} onChange={e => setFieldFilters(prev => ({ ...prev, [f.key]: e.target.value }))}>
              <option value="">{f.label}</option>
              {distinctValues(records, f.key).map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </div>
        ))}
        <div className="pill-select-wrap">
          <select value={groupBy} onChange={e => setGroupBy(e.target.value)}>
            <option value="">No grouping</option>
            {GROUP_OPTIONS.map(f => <option key={f.key} value={f.key}>Group: {f.label}</option>)}
          </select>
        </div>
        <span style={{ flex: 1 }} />
        <div className="pill-search">
          <span className="pill-search-ic"><Search size={14} /></span>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." />
        </div>
        {canEdit && <button className="btn btn-primary pill-add-btn" onClick={openAdd}>+ New Entry (form)</button>}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.8rem" }}>
        <div className="cards-count">
          <Layers size={13} style={{ verticalAlign: "-2px", marginRight: "0.3rem" }} />
          {rows.length} record{rows.length === 1 ? "" : "s"}{selectedIds.size ? ` · ${selectedIds.size} selected` : ""}
          {pasting && " · Pasting…"}
          <span className="ink-muted" style={{ marginInlineStart: "0.6rem" }}>— click a cell, then paste (Ctrl+V) a range copied from Excel/Sheets</span>
        </div>
        {canEdit && selectedIds.size > 0 && (
          <button className="btn btn-danger" disabled={busyDelete} onClick={handleDeleteSelected}>
            {busyDelete ? "Deleting..." : `Delete Selected (${selectedIds.size})`}
          </button>
        )}
      </div>

      {error && <div style={{ color: "var(--critical)", marginBottom: "0.8rem" }}>{error}</div>}

      {groups ? (
        groups.map(([groupValue, groupRows]) => (
          <details key={groupValue} open style={{ marginBottom: "1rem" }}>
            <summary style={{ cursor: "pointer", fontWeight: 700, padding: "0.5rem 0" }}>{groupValue} ({groupRows.length})</summary>
            <VirtualizedGrid
              columns={columns}
              data={canEdit ? [...groupRows, makeDraftRow(groupBy === "entry_date" ? groupValue : today())] : groupRows}
              emptyMessage={loading ? "Loading..." : "No records"}
            />
          </details>
        ))
      ) : (
        <VirtualizedGrid
          columns={columns}
          data={canEdit ? [...rows, makeDraftRow(today())] : rows}
          emptyMessage={loading ? "Loading..." : "No records"}
        />
      )}

      {modalState && (
        <FuelInvoiceRecordModal
          record={modalState.record}
          records={records}
          isNew={modalState.isNew}
          onSave={handleSave}
          onCancel={() => setModalState(null)}
          saving={saving}
          saveError={saveError}
        />
      )}
    </div>
  );
}
