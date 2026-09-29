import { useLayoutEffect, useRef } from "react";
import { fieldColorKey, parsePastedDate } from "../lib/fuelInvoice";

// Custom react-datasheet-grid column types for the Fuel & Invoice module.
// The library ships text/float/date/checkbox columns but no "select" column
// (see node_modules/react-datasheet-grid/dist/columns — confirmed while
// building this), so the colored single-select pill is hand-built here,
// same colored-pill look as PillSelectField/the RCA Reason column, just
// wired into this library's Column contract (component/copyValue/
// pasteValue/isCellEmpty) instead.
//
// IMPORTANT (verified against the library's own paste code,
// dist/components/DataSheetGrid.js): pasteValue is called for EVERY column
// positionally, `disabled` or not — a disabled column does not shift or
// skip pasted columns around it. So Amount/VAT/DA Name (always derived, per
// the source sheet's own formulas) can safely sit in their exact real
// column position and simply ignore whatever text was pasted into them
// (their pasteValue returns the row unchanged) — pasting the full 17-column
// sheet range therefore still lands every other column in the right place,
// while Amount/VAT/DA Name get recomputed separately from Cost/NID
// (see FuelInvoiceGrid's buildSavePayload), never taken from pasted text.

function pillStyle(colorKey) {
  if (colorKey === "neutral") return { backgroundColor: "var(--plane)", color: "var(--ink-2)" };
  if (!colorKey) return undefined;
  return { backgroundColor: `var(--${colorKey}-bg)`, color: `var(--${colorKey}-ink)` };
}

export function makeSelectDsgColumn(fieldKey, getOptions) {
  function SelectCell({ active, rowData, setRowData, disabled }) {
    const style = pillStyle(fieldColorKey(fieldKey, rowData));
    if (!active) {
      return (
        <div className="dsg-select-display">
          {rowData ? <span className="dsg-pill" style={style}>{rowData}</span> : null}
        </div>
      );
    }
    const options = getOptions();
    const allOptions = rowData && !options.includes(rowData) ? [rowData, ...options] : options;
    return (
      <div className="dsg-select-display">
        <select
          autoFocus
          className="dsg-select-input dsg-pill"
          tabIndex={-1}
          disabled={disabled}
          value={rowData || ""}
          style={style}
          onChange={e => setRowData(e.target.value || null)}
        >
          <option value=""></option>
          {allOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      </div>
    );
  }
  return {
    component: SelectCell,
    deleteValue: () => null,
    copyValue: ({ rowData }) => rowData ?? "",
    pasteValue: ({ value }) => (value || "").trim() || null,
    isCellEmpty: ({ rowData }) => !rowData,
  };
}

function ReadOnlyCell({ rowData, format }) {
  return <div className="dsg-readonly-cell">{format ? format(rowData) : (rowData ?? "")}</div>;
}
export function makeReadOnlyDsgColumn(format) {
  return {
    component: (props) => <ReadOnlyCell {...props} format={format} />,
    disabled: true,
    deleteValue: ({ rowData }) => rowData,
    copyValue: ({ rowData }) => (format ? format(rowData) : (rowData ?? "")),
    pasteValue: ({ rowData }) => rowData, // ignore pasted text — always recomputed from Cost/NID instead
    isCellEmpty: () => false,
  };
}

// Same UI as the library's own isoDateColumn, but with a paste parser that
// understands the source sheet's DD/M/YYYY display format (confirmed from
// the real file) instead of the built-in `new Date(str)`, which reads that
// same text as the wrong month/day.
function DateCell({ focus, active, rowData, setRowData }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    if (focus) ref.current?.select();
    else ref.current?.blur();
  }, [focus]);
  return (
    <input
      className="dsg-input"
      type="date"
      tabIndex={-1}
      max="9999-12-31"
      ref={ref}
      style={{ pointerEvents: focus ? "auto" : "none", opacity: rowData || active ? undefined : 0 }}
      value={rowData ?? ""}
      onChange={e => setRowData(e.target.value || null)}
    />
  );
}
export const dsgDateColumn = {
  component: DateCell,
  deleteValue: () => null,
  copyValue: ({ rowData }) => rowData ?? "",
  pasteValue: ({ value }) => parsePastedDate(value),
  minWidth: 130,
  isCellEmpty: ({ rowData }) => !rowData,
};
