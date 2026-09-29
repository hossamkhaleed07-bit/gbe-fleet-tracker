import { useEffect, useMemo, useRef, useState } from "react";
import { DataSheetGrid, keyColumn, textColumn, floatColumn, createTextColumn } from "react-datasheet-grid";
import "react-datasheet-grid/dist/style.css";
import { useAuth } from "../contexts/AuthContext";
import { useFuelInvoiceRecords } from "../hooks/useFuelInvoiceRecords";
import { useFuelInvoiceDaDirectory } from "../hooks/useFuelInvoiceDaDirectory";
import { distinctValues, computeAmountVat, money } from "../lib/fuelInvoice";
import { makeSelectDsgColumn, makeReadOnlyDsgColumn, dsgDateColumn } from "./fuelInvoiceDsgColumns";

// Exact 17-column order of the source sheet (Batch, the 18th field, isn't
// part of her spec and is left out of this grid) — both the column
// definitions below and buildSavePayload rely on this same list.
const NID_TEXT_COLUMN = createTextColumn(); // plain text — never coerced to a number, so leading zeros survive

export default function FuelInvoiceGrid() {
  const { isAdmin } = useAuth();
  const { records, loading, deleteRecords, bulkUpsert } = useFuelInvoiceRecords();
  const { lookup: lookupDaName } = useFuelInvoiceDaDirectory();

  // The grid's own local, fully-controlled row state — seeded once from the
  // hook's `records` when they first arrive, then owned locally so typing
  // feels instant instead of waiting on a network round trip per keystroke.
  // Saves happen in the background (see handleChange); new rows created
  // elsewhere (another tab/session) get appended in as they arrive.
  const [gridRows, setGridRows] = useState([]);
  const initializedRef = useRef(false);
  const gridRowsRef = useRef([]);
  gridRowsRef.current = gridRows;

  useEffect(() => {
    if (!initializedRef.current && !loading) {
      setGridRows(records);
      initializedRef.current = true;
      return;
    }
    if (initializedRef.current) {
      setGridRows(prev => {
        const known = new Set(prev.map(r => r.id).filter(Boolean));
        const missing = records.filter(r => !known.has(r.id));
        return missing.length ? [...prev, ...missing] : prev;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, loading]);

  const canEdit = isAdmin;

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

  // react-datasheet-grid batches a whole paste (or a whole typed edit) into
  // one contiguous operation per affected range — so a 200-row paste is one
  // CREATE operation here, saved with a single bulkUpsert call, not 200
  // separate requests.
  async function handleChange(newValue, operations) {
    const previous = gridRowsRef.current;
    setGridRows(newValue);

    for (const op of operations) {
      if (op.type === "DELETE") {
        const removedIds = previous.slice(op.fromRowIndex, op.toRowIndex).map(r => r.id).filter(Boolean);
        if (removedIds.length) {
          const { error } = await deleteRecords(removedIds);
          if (error) window.alert("Delete failed: " + error.message);
        }
        continue;
      }
      // CREATE or UPDATE
      const slice = newValue.slice(op.fromRowIndex, op.toRowIndex);
      const payloads = slice.map(buildSavePayload);
      if (!payloads.length) continue;
      const { data, error } = await bulkUpsert(payloads);
      if (error) { window.alert("Save failed: " + error.message); continue; }
      // Write the DB-generated id (and server-computed fields) back into
      // the local grid rows at the same positions, so a second edit to a
      // just-created row updates it instead of creating another one.
      setGridRows(cur => {
        const next = [...cur];
        for (let i = 0; i < data.length && op.fromRowIndex + i < next.length; i++) {
          next[op.fromRowIndex + i] = { ...next[op.fromRowIndex + i], ...data[i] };
        }
        return next;
      });
    }
  }

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
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.6rem" }}>
        <div className="cards-count">
          {gridRows.length} record{gridRows.length === 1 ? "" : "s"}
          <span className="ink-muted" style={{ marginInlineStart: "0.6rem" }}>
            — click a cell to select it, arrow keys / Shift+arrows to navigate and select, Ctrl+C / Ctrl+V to copy-paste a range from Excel or Sheets, right-click a row for insert/delete/duplicate.
          </span>
        </div>
      </div>

      <DataSheetGrid
        value={gridRows}
        onChange={handleChange}
        columns={columns}
        rowKey={({ rowData, rowIndex }) => rowData.id ?? `new-${rowIndex}`}
        lockRows={!canEdit}
        height={window.innerHeight * 0.65}
        createRow={() => ({})}
      />
    </div>
  );
}
