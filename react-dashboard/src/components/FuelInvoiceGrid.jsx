import { useMemo, useState } from "react";
import { Type, Hash, DollarSign, CalendarDays, CircleDot, AlignLeft, IdCard, Layers, Search } from "lucide-react";
import { useAuth } from "../contexts/AuthContext";
import DataTable from "./DataTable";
import PillSelectField from "./PillSelectField";
import FuelInvoiceRecordModal from "./FuelInvoiceRecordModal";
import { useFuelInvoiceRecords } from "../hooks/useFuelInvoiceRecords";
import { FUEL_INVOICE_FIELDS, SELECT_FIELD_KEYS, distinctValues, emptyFuelInvoiceForm, money, fieldColorKey } from "../lib/fuelInvoice";

const GROUPABLE_FIELDS = FUEL_INVOICE_FIELDS.filter(f => SELECT_FIELD_KEYS.includes(f.key));

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

export default function FuelInvoiceGrid() {
  const { isAdmin } = useAuth();
  const { records, loading, error, createRecord, updateRecord, deleteRecords } = useFuelInvoiceRecords();

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
    const { error: err } = await updateRecord(record.id, { [key]: value || null, updated_at: new Date().toISOString() });
    if (err) window.alert("Save failed: " + err.message);
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

  const columns = useMemo(() => {
    const cols = [
      {
        id: "select", enableSorting: false,
        header: () => <input type="checkbox" checked={allSelected} onChange={toggleAll} />,
        cell: ({ row }) => <input type="checkbox" checked={selectedIds.has(row.original.id)} onChange={() => toggleOne(row.original.id)} />,
      },
      { id: "index", header: "#", enableSorting: false, cell: ({ row }) => row.index + 1 },
    ];
    for (const f of FUEL_INVOICE_FIELDS) {
      cols.push({
        accessorKey: f.key,
        header: () => <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem" }}>{FIELD_TYPE_ICON[f.type]} {f.label}</span>,
        cell: ({ row }) => {
          const rec = row.original;
          const v = rec[f.key];
          if (f.type === "select") {
            return (
              <PillSelectField
                value={v}
                options={distinctValues(records, f.key)}
                colorFor={val => fieldColorKey(f.key, val)}
                disabled={!canEdit}
                onChange={newVal => handleInlineFieldSave(rec, f.key, newVal)}
              />
            );
          }
          if (f.type === "currency" || f.type === "computed") return money(v);
          if (f.type === "longtext") return <span title={v || ""} style={{ display: "inline-block", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", verticalAlign: "bottom" }}>{v || "—"}</span>;
          return v ?? "—";
        },
      });
    }
    cols.push({
      id: "actions", header: "", enableSorting: false,
      cell: ({ row }) => canEdit
        ? <button className="btn" onClick={() => openEdit(row.original)}>Edit</button>
        : null,
    });
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, selectedIds, allSelected, canEdit]);

  const groups = useMemo(() => {
    if (!groupBy) return null;
    const map = new Map();
    for (const r of rows) {
      const key = r[groupBy] || "(empty)";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows, groupBy]);

  return (
    <>
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
            <option value="">Group</option>
            {GROUPABLE_FIELDS.map(f => <option key={f.key} value={f.key}>Group: {f.label}</option>)}
          </select>
        </div>
        <span style={{ flex: 1 }} />
        <div className="pill-search">
          <span className="pill-search-ic"><Search size={14} /></span>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." />
        </div>
        {canEdit && <button className="btn btn-primary pill-add-btn" onClick={openAdd}>+ New Entry</button>}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.8rem" }}>
        <div className="cards-count">
          <Layers size={13} style={{ verticalAlign: "-2px", marginRight: "0.3rem" }} />
          {rows.length} record{rows.length === 1 ? "" : "s"}{selectedIds.size ? ` · ${selectedIds.size} selected` : ""}
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
            <DataTable columns={columns} data={groupRows} emptyMessage={loading ? "Loading..." : "No records"} />
          </details>
        ))
      ) : (
        <DataTable columns={columns} data={rows} emptyMessage={loading ? "Loading..." : "No records"} pageSize={25} />
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
    </>
  );
}
