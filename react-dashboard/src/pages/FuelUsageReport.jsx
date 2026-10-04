import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import HeroPortal from "../components/HeroPortal";
import { useAuth } from "../contexts/AuthContext";
import { sb } from "../lib/supabase";
import {
  NO_VALUE, SOURCE_COLORS, fmt, localISO, monthStart, monthEnd, addDays, prevMonthRange,
  periodLabel, branchesLabel, buildReport, exportUsageReportXlsx,
} from "../lib/usageReport";

const PAGE_SIZE = 1000;

// Only the columns the report needs, filtered on the server by date and
// walked page by page so a big range can never be silently truncated.
async function fetchRange(from, to) {
  const rows = [];
  for (let start = 0; ; start += PAGE_SIZE) {
    const { data, error } = await sb.from("fuel_invoice_records")
      .select("id,data_source,branch,use_type,fuel_type,cost,amount,vat")
      .gte("entry_date", from).lte("entry_date", to)
      .order("id", { ascending: true })
      .range(start, start + PAGE_SIZE - 1);
    if (error) return { error };
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return { rows };
}

export default function FuelUsageReport() {
  const { isAdmin, isFleetManager } = useAuth();
  const allowed = isAdmin || isFleetManager;
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [latest, setLatest] = useState("");          // last day that has invoices
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedBranches, setSelectedBranches] = useState(null); // null = all branches
  const [byBranch, setByBranch] = useState(false);
  const [exporting, setExporting] = useState(false);

  // default period: the last day that has invoices (one day)
  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    sb.from("fuel_invoice_records").select("entry_date").not("entry_date", "is", null)
      .order("entry_date", { ascending: false }).limit(1).then(({ data, error: err }) => {
        if (cancelled) return;
        if (err) { setError(err.message); setLoading(false); return; }
        const day = data?.[0]?.entry_date || localISO();
        setLatest(day); setFrom(day); setTo(day);
      });
    return () => { cancelled = true; };
  }, [allowed]);

  useEffect(() => {
    if (!allowed || !from || !to || from > to) return;
    let cancelled = false;
    setLoading(true);
    fetchRange(from, to).then(res => {
      if (cancelled) return;
      if (res.error) { setError(res.error.message); setRows([]); }
      else { setError(""); setRows(res.rows); }
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [allowed, from, to]);

  const branchOptions = useMemo(() => {
    const set = new Set(rows.map(r => (r.branch || "").trim() || NO_VALUE));
    if (selectedBranches) for (const b of selectedBranches) set.add(b);
    return [...set].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  }, [rows, selectedBranches]);

  const lines = useMemo(() => buildReport(rows, { byBranch, selectedBranches }), [rows, byBranch, selectedBranches]);
  const grand = lines[lines.length - 1];

  if (!allowed) return <Navigate to="/overview" replace />;

  const setRange = (f, t) => { setFrom(f); setTo(t); };
  const today = localISO();
  const lastMonth = prevMonthRange(today);
  const quick = [
    { label: "Last invoice day", disabled: !latest, run: () => setRange(latest, latest), active: from === latest && to === latest },
    { label: "Today", run: () => setRange(today, today), active: from === today && to === today },
    { label: "Yesterday", run: () => { const y = addDays(today, -1); setRange(y, y); }, active: from === addDays(today, -1) && to === from },
    { label: "This month", run: () => setRange(monthStart(today), monthEnd(today)), active: from === monthStart(today) && to === monthEnd(today) },
    { label: "Last month", run: () => setRange(lastMonth.from, lastMonth.to), active: from === lastMonth.from && to === lastMonth.to },
  ];

  const toggleBranch = (b) => {
    const cur = new Set(selectedBranches || branchOptions);
    if (cur.has(b)) cur.delete(b); else cur.add(b);
    // everything ticked again = "all"
    setSelectedBranches(branchOptions.every(o => cur.has(o)) ? null : cur);
  };

  const doExport = async () => {
    setExporting(true);
    try { await exportUsageReportXlsx({ lines, byBranch, from, to, selectedBranches }); }
    finally { setExporting(false); }
  };

  const labelCols = byBranch ? 4 : 3;
  const colCount = labelCols + 4;
  const period = periodLabel(from, to);

  return (
    <>
      <HeroPortal target="fx-hero-actions" className="content-header">
        <div>
          <div className="breadcrumb">Fuel &amp; Invoice Management &gt; <b>Usage Report</b></div>
          <h1 className="page-title">Usage Report</h1>
        </div>
      </HeroPortal>

      <div className="ur-filters">
        <div className="ur-quick">
          {quick.map(q => (
            <button key={q.label} type="button" className={"ur-chip" + (q.active ? " on" : "")} disabled={q.disabled} onClick={q.run}>{q.label}</button>
          ))}
        </div>
        <label>From <input type="date" value={from} max={to || undefined} onChange={e => e.target.value && setFrom(e.target.value)} /></label>
        <label>To <input type="date" value={to} min={from || undefined} onChange={e => e.target.value && setTo(e.target.value)} /></label>
        <details className="ur-dd">
          <summary>Branches: {selectedBranches ? `${selectedBranches.size} selected` : "All"}</summary>
          <div className="ur-dd-panel">
            <label><input type="checkbox" checked={!selectedBranches} onChange={() => setSelectedBranches(null)} /> All branches</label>
            {branchOptions.map(b => (
              <label key={b}><input type="checkbox" checked={!selectedBranches || selectedBranches.has(b)} onChange={() => toggleBranch(b)} /> {b}</label>
            ))}
          </div>
        </details>
        <button type="button" className={"ur-chip" + (byBranch ? " on" : "")} aria-pressed={byBranch} onClick={() => setByBranch(v => !v)}>Breakdown by branch</button>
        <button type="button" className="ur-chip ur-export" disabled={exporting || loading || !rows.length} onClick={doExport}>
          {exporting ? "Exporting…" : "Export to Excel"}
        </button>
      </div>

      {error && <div className="ur-error">{error}</div>}

      <div className="ur-wrap">
        <table className="ur-table">
          <thead>
            <tr>
              <th colSpan={colCount - 2} className="ur-title">Fuels usage report</th>
              <th colSpan={2} className="ur-title">{period}</th>
            </tr>
            <tr><th colSpan={colCount} className="ur-branches">Branches: {branchesLabel(selectedBranches)}</th></tr>
            <tr>
              <th>Data Source</th>{byBranch && <th>Branch</th>}<th>Use type</th><th>Type of fuel</th>
              <th>Count of Invoice</th><th>Total Amount</th><th>VAT 15%</th><th>Total Cost</th>
            </tr>
          </thead>
          <tbody>
            {lines.filter(l => l.type !== "grand").map((l, i) => l.type === "row" ? (
              <tr key={i}>
                <td className="ur-source" style={SOURCE_COLORS[l.source] ? { background: SOURCE_COLORS[l.source] } : undefined}>{l.source}</td>
                {byBranch && <td>{l.branch}</td>}
                <td>{l.use}</td><td>{l.fuel}</td>
                <td>{l.count}</td><td>{fmt(l.amount)}</td><td>{fmt(l.vat)}</td><td>{fmt(l.cost)}</td>
              </tr>
            ) : (
              <tr key={i} className="ur-sub">
                <td colSpan={labelCols}>{l.branch} total</td>
                <td>{l.count}</td><td>{fmt(l.amount)}</td><td>{fmt(l.vat)}</td><td>{fmt(l.cost)}</td>
              </tr>
            ))}
            {lines.length === 1 && (
              <tr><td colSpan={colCount} className="ur-empty">{loading ? "Loading…" : "No invoices in this period."}</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={labelCols}>Grand Total</td>
              <td>{grand.count}</td><td>{fmt(grand.amount)}</td><td>{fmt(grand.vat)}</td><td>{fmt(grand.cost)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}
