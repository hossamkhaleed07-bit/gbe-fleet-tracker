import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import {
  ArrowDown, ArrowUp, ArrowUpDown, BarChart3, Coins, Columns3, Download, FileText, Fuel, Percent, Printer, Search, TriangleAlert,
} from "lucide-react";
import HeroPortal from "../components/HeroPortal";
import { useAuth } from "../contexts/AuthContext";
import { sb } from "../lib/supabase";
import {
  HIDEABLE, NO_VALUE, MISSING_TIPS, sourceStyle, fmt, localISO, monthStart, monthEnd, addDays, prevMonthRange, previousPeriod,
  periodLabel, branchesLabel, buildReport, summarizeRows, pctChange, incompleteCount, visibleColumns, totalLabel,
} from "../lib/usageReport";
import { exportUsageReportXlsx, printUsageReport } from "../lib/usageReportExport";
import "../usage-report.css";

// Every invoice of the period (full rows, same order as the Invoices page) for the
// "Invoices" sheet of the Excel export. Branch filter: same rule as the report.
async function fetchInvoicesForExport(from, to, selectedBranches) {
  const rows = [];
  let bySortOrder = true;
  for (let start = 0; ; start += PAGE_SIZE) {
    let q = sb.from("fuel_invoice_records").select("*").gte("entry_date", from).lte("entry_date", to);
    q = bySortOrder
      ? q.order("sort_order", { ascending: true }).order("id", { ascending: true })
      : q.order("entry_date", { ascending: true }).order("created_at", { ascending: true }).order("id", { ascending: true });
    const { data, error } = await q.range(start, start + PAGE_SIZE - 1);
    if (error) {
      if (bySortOrder && /sort_order/i.test(error.message || "")) { bySortOrder = false; start -= PAGE_SIZE; continue; }
      return { error };
    }
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  const kept = selectedBranches
    ? rows.filter(r => selectedBranches.has((r.branch || "").trim() || NO_VALUE))
    : rows;
  return { rows: kept };
}

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

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// Counts from the value currently shown up to `target` (jumps straight there with reduced motion).
function useCountUp(target, active) {
  const [shown, setShown] = useState(0);
  const shownRef = useRef(0);
  useEffect(() => {
    if (!active) return;
    const to = Number(target) || 0;
    if (reducedMotion()) { shownRef.current = to; setShown(to); return; }
    const start = shownRef.current;
    const t0 = performance.now();
    const dur = 700;
    let raf;
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      shownRef.current = start + (to - start) * eased;
      setShown(shownRef.current);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    // safety net: a tab that pauses animation frames still ends on the real value
    const done = setTimeout(() => { shownRef.current = to; setShown(to); }, dur + 150);
    return () => { cancelAnimationFrame(raf); clearTimeout(done); };
  }, [target, active]);
  return shown;
}

function SummaryCard({ icon, tone, label, value, decimals, unit, change, loading }) {
  const shown = useCountUp(value, !loading);
  const text = decimals ? fmt(shown) : Math.round(shown).toLocaleString("en-US");
  // For these totals a rise is the thing to watch: up = red arrow up, down = green arrow down.
  const dir = change == null ? "none" : change > 0.005 ? "up" : change < -0.005 ? "down" : "flat";
  return (
    <div className={"urp-stat tone-" + tone}>
      <div className="urp-stat-top">
        <span className="urp-stat-ic">{icon}</span>
        <span className="urp-stat-label" title={label}>{label}</span>
      </div>
      <div className="urp-stat-main">
        {loading ? <div className="urp-skel urp-skel-num" /> : (
          <>
            <span className="urp-stat-value">{text}</span>
            {unit && <span className="urp-stat-unit">{unit}</span>}
          </>
        )}
      </div>
      <div className="urp-stat-change">
        {loading ? <div className="urp-skel urp-skel-chg" /> : dir === "none" ? (
          <span className="chg none" title="No data in the previous period">—</span>
        ) : (
          <span className={"chg " + dir}>
            {dir === "up" ? <ArrowUp size={13} /> : dir === "down" ? <ArrowDown size={13} /> : null}
            {change > 0 ? "+" : change < 0 ? "−" : ""}{Math.abs(change).toFixed(1)}%
          </span>
        )}
        {!loading && <small>vs. previous period</small>}
      </div>
    </div>
  );
}

function FuelBadge({ value }) {
  const kind = value === "91" ? "f91" : value === "95" ? "f95" : /diesel/i.test(value) ? "fdsl" : "fother";
  return <span className={"urp-fuel " + kind}><Fuel size={14} />{value}</span>;
}

export default function FuelUsageReport() {
  const { isAdmin, isFleetManager } = useAuth();
  const allowed = isAdmin || isFleetManager;
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [quick, setQuick] = useState("last");           // which quick button is active (null = custom dates)
  const [latest, setLatest] = useState("");             // last day that has invoices
  const [rows, setRows] = useState([]);
  const [prevRows, setPrevRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedBranches, setSelectedBranches] = useState(null); // null = all branches
  const [byBranch, setByBranch] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState(null);               // { key, dir } or null = natural order
  const [hidden, setHidden] = useState(() => new Set());
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

  // the selected period and the one right before it (for the cards' comparison)
  useEffect(() => {
    if (!allowed || !from || !to || from > to) return;
    let cancelled = false;
    setLoading(true);
    const prev = previousPeriod(from, to);
    Promise.all([fetchRange(from, to), fetchRange(prev.from, prev.to)]).then(([cur, old]) => {
      if (cancelled) return;
      const err = cur.error || old.error;
      if (err) { setError(err.message); setRows([]); setPrevRows([]); }
      else { setError(""); setRows(cur.rows); setPrevRows(old.rows); }
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [allowed, from, to]);

  // close the open dropdown when clicking elsewhere
  useEffect(() => {
    const onDown = (e) => {
      document.querySelectorAll(".urp-dd[open]").forEach(d => { if (!d.contains(e.target)) d.removeAttribute("open"); });
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const branchOptions = useMemo(() => {
    const set = new Set(rows.map(r => (r.branch || "").trim() || NO_VALUE));
    if (selectedBranches) for (const b of selectedBranches) set.add(b);
    return [...set].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  }, [rows, selectedBranches]);

  const cur = useMemo(() => summarizeRows(rows, selectedBranches), [rows, selectedBranches]);
  const old = useMemo(() => summarizeRows(prevRows, selectedBranches), [prevRows, selectedBranches]);
  const missingInvoices = useMemo(() => incompleteCount(rows, selectedBranches), [rows, selectedBranches]);
  const lines = useMemo(
    () => buildReport(rows, { byBranch, selectedBranches, search, sort }),
    [rows, byBranch, selectedBranches, search, sort]);
  const grand = lines[lines.length - 1];
  const cols = visibleColumns(byBranch, hidden);
  const textCols = cols.filter(c => !c.num);
  const numCols = cols.filter(c => c.num);

  if (!allowed) return <Navigate to="/overview" replace />;

  const today = localISO();
  const lastMonth = prevMonthRange(today);
  const quickButtons = [
    { key: "last", label: "Last invoice day", disabled: !latest, range: [latest, latest] },
    { key: "today", label: "Today", range: [today, today] },
    { key: "yesterday", label: "Yesterday", range: [addDays(today, -1), addDays(today, -1)] },
    { key: "month", label: "This month", range: [monthStart(today), monthEnd(today)] },
    { key: "lastMonth", label: "Last month", range: [lastMonth.from, lastMonth.to] },
  ];
  const pickQuick = (q) => { setQuick(q.key); setFrom(q.range[0]); setTo(q.range[1]); };
  const pickDate = (setter) => (e) => { if (e.target.value) { setter(e.target.value); setQuick(null); } };

  const toggleBranch = (b) => {
    const set = new Set(selectedBranches || branchOptions);
    if (set.has(b)) set.delete(b); else set.add(b);
    setSelectedBranches(branchOptions.every(o => set.has(o)) ? null : set); // everything ticked = all
  };
  const toggleColumn = (key) => setHidden(h => { const n = new Set(h); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const cycleSort = (key) => setSort(s => !s || s.key !== key ? { key, dir: "asc" } : s.dir === "asc" ? { key, dir: "desc" } : null);

  const reportArgs = { lines, byBranch, hidden, from, to, selectedBranches };
  const doExport = async () => {
    setExporting(true);
    try {
      const inv = await fetchInvoicesForExport(from, to, selectedBranches);
      if (inv.error) { setError(inv.error.message); return; }
      await exportUsageReportXlsx({ ...reportArgs, invoiceRows: inv.rows });
    } finally { setExporting(false); }
  };

  const period = periodLabel(from, to);
  const hasRows = lines.length > 1;
  const fadeKey = [from, to, byBranch, branchesLabel(selectedBranches), search, sort?.key, sort?.dir].join("|");

  return (
    <div className="urp">
      <HeroPortal target="fx-hero-actions" className="content-header">
        <div>
          <div className="breadcrumb">Fuel &amp; Invoice Management &gt; <b>Usage Report</b></div>
          <h1 className="page-title">Usage Report</h1>
        </div>
      </HeroPortal>

      <div className="urp-head">
        <p className="urp-desc">Detailed breakdown of fuel usage by data source and type</p>
        <div className="urp-actions">
          <button type="button" className="urp-btn" disabled={loading || !hasRows} onClick={() => printUsageReport(reportArgs)}>
            <Printer size={16} /> Print
          </button>
          <button type="button" className="urp-btn primary" disabled={exporting || loading || !hasRows} onClick={doExport}>
            <Download size={16} /> {exporting ? "Exporting…" : "Export to Excel"}
          </button>
        </div>
      </div>

      <div className="urp-filters">
        <div className="urp-quick">
          {quickButtons.map(q => (
            <button key={q.key} type="button" className={"urp-chip" + (quick === q.key ? " on" : "")} disabled={q.disabled} onClick={() => pickQuick(q)}>{q.label}</button>
          ))}
        </div>
        <label className="urp-field"><span>From</span>
          <input type="date" value={from} max={to || undefined} onChange={pickDate(setFrom)} /></label>
        <label className="urp-field"><span>To</span>
          <input type="date" value={to} min={from || undefined} onChange={pickDate(setTo)} /></label>
        <details className="urp-dd">
          <summary className="urp-select">Branches: {selectedBranches ? `${selectedBranches.size} selected` : "All"}</summary>
          <div className="urp-dd-panel">
            <label><input type="checkbox" checked={!selectedBranches} onChange={() => setSelectedBranches(null)} /> All branches</label>
            {branchOptions.map(b => (
              <label key={b}><input type="checkbox" checked={!selectedBranches || selectedBranches.has(b)} onChange={() => toggleBranch(b)} /> {b}</label>
            ))}
          </div>
        </details>
        <button type="button" className={"urp-chip" + (byBranch ? " on" : "")} aria-pressed={byBranch} onClick={() => setByBranch(v => !v)}>
          Breakdown by branch
        </button>
      </div>

      {error && <div className="urp-error">{error}</div>}

      <div className="urp-stats">
        <SummaryCard tone="blue" icon={<FileText size={22} />} label="Total Amount" unit="SAR" decimals value={cur.amount}
          change={pctChange(cur.amount, old.amount, old.count)} loading={loading} />
        <SummaryCard tone="green" icon={<Percent size={22} />} label="VAT 15%" unit="SAR" decimals value={cur.vat}
          change={pctChange(cur.vat, old.vat, old.count)} loading={loading} />
        <SummaryCard tone="purple" icon={<Coins size={22} />} label="Total Cost" unit="SAR" decimals value={cur.cost}
          change={pctChange(cur.cost, old.cost, old.count)} loading={loading} />
        <SummaryCard tone="sky" icon={<BarChart3 size={22} />} label="Total Invoices" value={cur.count}
          change={pctChange(cur.count, old.count, old.count)} loading={loading} />
      </div>

      <section className="urp-card">
        <div className="urp-card-head">
          <span className="urp-card-ic"><BarChart3 size={20} /></span>
          <div className="urp-card-title">
            <h2>Usage Details</h2>
            <small>{period} · Branches: {branchesLabel(selectedBranches)}</small>
          </div>
          <label className="urp-search">
            <Search size={15} />
            <input type="text" name="usage-report-filter" placeholder="Search" value={search} onChange={e => setSearch(e.target.value)}
              autoComplete="off" data-lpignore="true" data-1p-ignore="true" data-form-type="other" data-gramm="false" />
          </label>
          <details className="urp-dd end">
            <summary className="urp-icon-btn" title="Show / hide columns" aria-label="Show or hide columns"><Columns3 size={17} /></summary>
            <div className="urp-dd-panel">
              {HIDEABLE.filter(c => c.key !== "branch" || byBranch).map(c => (
                <label key={c.key}><input type="checkbox" checked={!hidden.has(c.key)} onChange={() => toggleColumn(c.key)} /> {c.label}</label>
              ))}
            </div>
          </details>
        </div>

        {!loading && missingInvoices > 0 && (
          <div className="urp-note"><TriangleAlert size={15} />
            {missingInvoices.toLocaleString("en-US")} invoice{missingInvoices === 1 ? "" : "s"} with a missing use type, type of fuel or branch (highlighted below)
          </div>
        )}

        <div className="urp-wrap">
          <table className="urp-table">
            <thead>
              <tr>
                <th className="idx">#</th>
                {cols.map(c => {
                  const active = sort?.key === c.key;
                  return (
                    <th key={c.key} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                      <button type="button" className="urp-th-btn" onClick={() => cycleSort(c.key)}>
                        {c.label}
                        {active ? (sort.dir === "asc" ? <ArrowUp size={13} /> : <ArrowDown size={13} />) : <ArrowUpDown size={13} className="dim" />}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            {loading ? (
              <tbody>
                {Array.from({ length: 7 }, (_, i) => (
                  <tr key={i} className="skel-row">
                    {Array.from({ length: cols.length + 1 }, (_, j) => <td key={j}><div className="urp-skel" /></td>)}
                  </tr>
                ))}
              </tbody>
            ) : (
              <tbody key={fadeKey} className="urp-fade">
                {lines.filter(l => l.type !== "grand").map((l, i) => l.type === "row" ? (
                  <tr key={i} className={"urp-row" + (l.missing.length ? " has-missing" : "")}>
                    <td className="idx">{l.n}</td>
                    {cols.map(c => {
                      if (c.num) return <td key={c.key} className="num">{c.money ? fmt(l[c.key]) : l[c.key]}</td>;
                      if (c.key === "source") {
                        const s = sourceStyle(l.source);
                        return <td key={c.key}><span className="urp-badge" style={{ background: s.badge, color: s.ink }}>{l.source}</span></td>;
                      }
                      if (l.missing.includes(c.key)) {
                        return <td key={c.key} className="miss" title={MISSING_TIPS[c.key]}><TriangleAlert size={14} /> {NO_VALUE}</td>;
                      }
                      return <td key={c.key}>{c.key === "fuel" ? <FuelBadge value={l.fuel} /> : l[c.key]}</td>;
                    })}
                  </tr>
                ) : (
                  <tr key={i} className={"urp-sub " + l.type}
                    style={{ background: sourceStyle(l.source)[l.type === "sourceTotal" ? "sub" : "branchSub"], color: sourceStyle(l.source).ink }}>
                    <td colSpan={1 + textCols.length}>{totalLabel(l)}</td>
                    {numCols.map(c => <td key={c.key} className="num">{c.money ? fmt(l[c.key]) : l[c.key]}</td>)}
                  </tr>
                ))}
                {!hasRows && (
                  <tr><td colSpan={cols.length + 1} className="urp-empty">No invoices match this period and filters.</td></tr>
                )}
              </tbody>
            )}
            {!loading && (
              <tfoot>
                <tr>
                  <td colSpan={1 + textCols.length}>Grand Total</td>
                  {numCols.map(c => <td key={c.key} className="num">{c.money ? fmt(grand[c.key]) : grand[c.key]}</td>)}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>
    </div>
  );
}
