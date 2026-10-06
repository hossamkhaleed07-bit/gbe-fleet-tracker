import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import {
  ArrowDown, ArrowUp, ArrowUpDown, Download, Droplets, MessageCircle, Plus, Search, Settings, TriangleAlert, X,
} from "lucide-react";
import HeroPortal from "../components/HeroPortal";
import { useAuth } from "../contexts/AuthContext";
import { useToast } from "../contexts/ToastContext";
import { sb } from "../lib/supabase";
import {
  STATUS, FLAG_TEXT, REASON_TEXT, fmtKm, dmy, localISO, usedPct, normalizeMobile, driverMessage, whatsappUrl, friendlyError,
} from "../lib/oilChanges";
import { exportOilChangesXlsx } from "../lib/oilChangesExport";
import "../oil-changes.css";

const CARDS = [
  { key: "overdue", label: "Overdue", icon: "🔴" },
  { key: "soon", label: "Soon", icon: "🟠" },
  { key: "ok", label: "OK", icon: "🟢" },
  { key: "no_reading", label: "No reading", hint: "No valid odometer reading for 3 days or more", icon: "⚪" },
];

function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="oc-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={"oc-modal" + (wide ? " wide" : "")} role="dialog" aria-modal="true" aria-label={title}>
        <div className="oc-modal-head">
          <h2>{title}</h2>
          <button type="button" className="oc-x" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- record a change
function RecordDialog({ rows, plate, onClose, onSaved }) {
  const { showToast } = useToast();
  const vehicles = useMemo(() => [...rows].sort((a, b) => a.vehicle_plate.localeCompare(b.vehicle_plate)), [rows]);
  const [pick, setPick] = useState(plate || "");
  const current = vehicles.find(v => v.vehicle_plate === pick);
  const [date, setDate] = useState(localISO());
  const [odo, setOdo] = useState("");
  const [interval, setInterval] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // pre-fill from the chosen vehicle: newest valid reading and its default change distance
  useEffect(() => {
    if (!current) return;
    setOdo(current.current_odo != null ? String(current.current_odo) : "");
    const d = current.default_interval_km ?? current.last_change_interval;
    setInterval(d != null ? String(d) : "");
  }, [pick]); // eslint-disable-line react-hooks/exhaustive-deps

  const next = Number(odo) > 0 && Number(interval) > 0 ? Number(odo) + Number(interval) : null;

  async function save() {
    setError("");
    if (!pick) return setError("Choose a vehicle.");
    if (!(Number(odo) > 0)) return setError("Enter the odometer at the change.");
    if (!(Number(interval) > 0)) return setError("Enter the change distance (km).");
    if (!date || date > localISO()) return setError("The change date cannot be in the future.");
    if (file && file.size > 5 * 1024 * 1024) return setError("The invoice file is larger than 5 MB.");
    setSaving(true);
    let path = null;
    if (file) {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "jpg";
      path = `${pick}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const up = await sb.storage.from("oil-invoices").upload(path, file, { contentType: file.type || undefined });
      if (up.error) { setSaving(false); return setError("Could not upload the invoice: " + up.error.message); }
    }
    const { error: err } = await sb.from("oil_changes").insert({
      vehicle_plate: pick, change_date: date, change_odo: Number(odo), change_interval_km: Number(interval),
      notes: notes.trim() || null, invoice_photo_path: path,
    });
    setSaving(false);
    if (err) return setError(friendlyError(err));
    showToast(`Oil change recorded for ${pick}`);
    onSaved();
  }

  return (
    <Modal title="Record oil change" onClose={onClose}>
      <div className="oc-form">
        <label className="oc-field"><span>Vehicle</span>
          <select value={pick} onChange={e => setPick(e.target.value)} disabled={!!plate}>
            <option value="">Choose…</option>
            {vehicles.map(v => <option key={v.vehicle_plate} value={v.vehicle_plate}>{v.vehicle_plate}{v.model ? ` — ${v.model}` : ""}</option>)}
          </select>
        </label>
        <div className="oc-grid2">
          <label className="oc-field"><span>Date</span><input type="date" value={date} max={localISO()} onChange={e => setDate(e.target.value)} /></label>
          <label className="oc-field"><span>Odometer at the change (km)</span><input type="number" inputMode="numeric" min="1" value={odo} onChange={e => setOdo(e.target.value)} /></label>
          <label className="oc-field"><span>Change distance (km)</span><input type="number" inputMode="numeric" min="1" value={interval} onChange={e => setInterval(e.target.value)} /></label>
          <div className="oc-field"><span>Next change at</span><div className="oc-next">{next != null ? `${fmtKm(next)} km` : "—"}</div></div>
        </div>
        {current && current.current_odo != null && Number(odo) > 0 && Number(odo) < Number(current.current_odo) - 1000 && (
          <div className="oc-warn"><TriangleAlert size={14} /> The odometer you entered is far below the latest reading ({fmtKm(current.current_odo)} km).</div>
        )}
        <label className="oc-field"><span>Invoice photo (optional, image or PDF, up to 5 MB)</span>
          <input type="file" accept="image/*,application/pdf" onChange={e => setFile(e.target.files?.[0] || null)} /></label>
        <label className="oc-field"><span>Notes</span><textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} /></label>
        {error && <div className="oc-error">{error}</div>}
        <div className="oc-actions">
          <button type="button" className="oc-btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="oc-btn primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- one vehicle: history + its own settings
function HistoryDialog({ row, onClose, onChanged }) {
  const { showToast } = useToast();
  const [changes, setChanges] = useState(null);
  const [readings, setReadings] = useState(null);
  const [intervalKm, setIntervalKm] = useState("");
  const [months, setMonths] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [c, r, v] = await Promise.all([
        sb.from("oil_changes").select("*").eq("vehicle_plate", row.vehicle_plate)
          .order("change_date", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }),
        sb.rpc("oil_valid_readings", { p_plate: row.vehicle_plate }),
        sb.from("vehicles").select("oil_interval_km,oil_time_limit_months").eq("vehicle_plate", row.vehicle_plate).maybeSingle(),
      ]);
      if (cancelled) return;
      setChanges(c.data || []);
      setReadings([...(r.data || [])].reverse().slice(0, 40));
      setIntervalKm(v.data?.oil_interval_km != null ? String(v.data.oil_interval_km) : "");
      setMonths(v.data?.oil_time_limit_months != null ? String(v.data.oil_time_limit_months) : "");
    })();
    return () => { cancelled = true; };
  }, [row.vehicle_plate]);

  async function openPhoto(path) {
    const { data, error } = await sb.storage.from("oil-invoices").createSignedUrl(path, 300);
    if (error) return showToast("Could not open the invoice: " + error.message, "error");
    window.open(data.signedUrl, "_blank", "noopener");
  }

  async function saveVehicleSettings() {
    setSaving(true);
    const { error } = await sb.from("vehicles").update({
      oil_interval_km: intervalKm === "" ? null : Number(intervalKm),
      oil_time_limit_months: months === "" ? null : Number(months),
    }).eq("vehicle_plate", row.vehicle_plate);
    setSaving(false);
    if (error) return showToast(friendlyError(error), "error");
    showToast("Saved");
    onChanged();
  }

  return (
    <Modal title={`${row.vehicle_plate} — oil history`} onClose={onClose} wide>
      <div className="oc-hist">
        <section>
          <h3>Oil changes</h3>
          {changes == null ? <div className="oc-skel" /> : !changes.length ? <p className="oc-muted">No oil change recorded yet.</p> : (
            <table className="oc-mini">
              <thead><tr><th>Date</th><th>Odometer</th><th>Distance</th><th>Next at</th><th>Recorded by</th><th>Notes</th><th /></tr></thead>
              <tbody>
                {changes.map(c => (
                  <tr key={c.id}>
                    <td>{dmy(c.change_date)}</td><td>{fmtKm(c.change_odo)}</td><td>{fmtKm(c.change_interval_km)}</td><td>{fmtKm(c.next_odo)}</td>
                    <td title={c.recorded_by_email || ""}>{c.recorded_by_email ? c.recorded_by_email.split("@")[0] : "—"}</td>
                    <td className="oc-notes">{c.notes || ""}</td>
                    <td>{c.invoice_photo_path && <button type="button" className="oc-link" onClick={() => openPhoto(c.invoice_photo_path)}>Invoice</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section>
          <h3>Recent odometer readings</h3>
          {readings == null ? <div className="oc-skel" /> : !readings.length ? <p className="oc-muted">No readings in the last 45 days.</p> : (
            <table className="oc-mini">
              <thead><tr><th>Date</th><th>Odometer</th><th>From</th><th /></tr></thead>
              <tbody>
                {readings.map((r, i) => (
                  <tr key={i} className={r.is_valid ? "" : "bad"}>
                    <td>{dmy(r.reading_date)}</td><td>{fmtKm(r.odo)}</td><td>{r.source === "shift" ? "Shift form" : "Reinforcement"}</td>
                    <td>{!r.is_valid && <span title={REASON_TEXT[r.reason] || r.reason}><TriangleAlert size={13} /> ignored</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section>
          <h3>This vehicle's settings</h3>
          <div className="oc-grid2">
            <label className="oc-field"><span>Change distance (km) — empty = the model's default</span>
              <input type="number" min="1" value={intervalKm} onChange={e => setIntervalKm(e.target.value)} /></label>
            <label className="oc-field"><span>Time limit (months) — empty = none</span>
              <input type="number" min="1" value={months} onChange={e => setMonths(e.target.value)} /></label>
          </div>
          <div className="oc-actions"><button type="button" className="oc-btn" onClick={saveVehicleSettings} disabled={saving}>{saving ? "Saving…" : "Save settings"}</button></div>
        </section>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- global settings
function SettingsDialog({ settings, defaults, onClose, onSaved }) {
  const { showToast } = useToast();
  const { session } = useAuth();
  const [s, setS] = useState(() => ({ ...settings }));
  const [models, setModels] = useState(() => defaults.map(d => ({ model: d.model, interval_km: String(d.interval_km), existing: true })));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const num = (k) => (e) => setS(v => ({ ...v, [k]: e.target.value }));
  const hasTolerance = settings.back_tolerance_km !== undefined; // column added by migration 059

  async function save() {
    setError("");
    const fields = ["alert_km", "alert_days", "stale_reading_days", "notify_repeat_days", "max_jump_km_per_day", "avg_window_days", "avg_min_readings", "reading_scan_days", ...(hasTolerance ? ["back_tolerance_km"] : [])];
    const payload = {};
    for (const k of fields) {
      const n = Number(s[k]);
      if (!Number.isFinite(n) || n < 0) return setError("Check the numbers: they must be zero or more.");
      payload[k] = Math.round(n);
    }
    const cleaned = models.map(m => ({ ...m, model: m.model.trim(), km: Number(m.interval_km) })).filter(m => m.model || m.interval_km);
    if (cleaned.some(m => !m.model || !(m.km > 0))) return setError("Every model needs a name and a distance above zero.");
    setSaving(true);
    const email = session?.user?.email || null;
    const a = await sb.from("oil_settings").update({ ...payload, updated_at: new Date().toISOString(), updated_by_email: email }).eq("id", true);
    if (a.error) { setSaving(false); return setError(friendlyError(a.error)); }
    const keep = new Set(cleaned.map(m => m.model));
    const removed = defaults.filter(d => !keep.has(d.model));
    if (cleaned.length) {
      const b = await sb.from("oil_model_defaults").upsert(
        cleaned.map(m => ({ model: m.model, interval_km: m.km, updated_at: new Date().toISOString(), updated_by_email: email })), { onConflict: "model" });
      if (b.error) { setSaving(false); return setError(friendlyError(b.error)); }
    }
    if (removed.length) {
      const c = await sb.from("oil_model_defaults").delete().in("model", removed.map(d => d.model));
      if (c.error) { setSaving(false); return setError("Models can only be removed by an admin: " + friendlyError(c.error)); }
    }
    setSaving(false);
    showToast("Settings saved");
    onSaved();
  }

  return (
    <Modal title="Oil settings" onClose={onClose} wide>
      <div className="oc-form">
        <h3>Alerts</h3>
        <div className="oc-grid2">
          <label className="oc-field"><span>"Soon" when this many km are left (or…)</span><input type="number" min="0" value={s.alert_km} onChange={num("alert_km")} /></label>
          <label className="oc-field"><span>…the expected date is within (days)</span><input type="number" min="0" value={s.alert_days} onChange={num("alert_days")} /></label>
        </div>
        <details className="oc-adv">
          <summary>Advanced</summary>
          <div className="oc-grid2">
            <label className="oc-field"><span>"No reading" after (days)</span><input type="number" min="1" value={s.stale_reading_days} onChange={num("stale_reading_days")} /></label>
            <label className="oc-field"><span>Alert again if the driver was notified and nothing was recorded after (days)</span><input type="number" min="1" value={s.notify_repeat_days} onChange={num("notify_repeat_days")} /></label>
            <label className="oc-field"><span>Wrong-reading jump limit (km per day)</span><input type="number" min="1" value={s.max_jump_km_per_day} onChange={num("max_jump_km_per_day")} /></label>
            <label className="oc-field"><span>Daily average over the last (days)</span><input type="number" min="1" value={s.avg_window_days} onChange={num("avg_window_days")} /></label>
            <label className="oc-field"><span>Valid readings needed for the average</span><input type="number" min="2" value={s.avg_min_readings} onChange={num("avg_min_readings")} /></label>
            <label className="oc-field"><span>Readings looked at (last N days)</span><input type="number" min="14" value={s.reading_scan_days} onChange={num("reading_scan_days")} /></label>
            {hasTolerance && (
              <label className="oc-field"><span>A small step back of up to this many km is not a wrong reading</span><input type="number" min="0" value={s.back_tolerance_km} onChange={num("back_tolerance_km")} /></label>
            )}
          </div>
        </details>
        <h3>Change distance per model</h3>
        <table className="oc-mini">
          <thead><tr><th>Model</th><th>Distance (km)</th><th /></tr></thead>
          <tbody>
            {models.map((m, i) => (
              <tr key={i}>
                <td><input value={m.model} disabled={m.existing} onChange={e => setModels(list => list.map((x, j) => j === i ? { ...x, model: e.target.value } : x))} /></td>
                <td><input type="number" min="1" value={m.interval_km} onChange={e => setModels(list => list.map((x, j) => j === i ? { ...x, interval_km: e.target.value } : x))} /></td>
                <td><button type="button" className="oc-link" onClick={() => setModels(list => list.filter((_, j) => j !== i))}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" className="oc-btn" onClick={() => setModels(list => [...list, { model: "", interval_km: "", existing: false }])}><Plus size={14} /> Add model</button>
        {error && <div className="oc-error">{error}</div>}
        <div className="oc-actions">
          <button type="button" className="oc-btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="oc-btn primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- the page
const SORTS = {
  vehicle: (r) => r.vehicle_plate,
  project: (r) => r.project || "",
  remaining: (r) => (r.remaining_km == null ? null : Number(r.remaining_km)),
  expected: (r) => r.expected_date || null,
  status: (r) => STATUS[r.status]?.rank ?? 9,
};

export default function OilChanges() {
  const { isAdmin, isFleetManager } = useAuth();
  const allowed = isAdmin || isFleetManager;
  const { showToast } = useToast();
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState([]);
  const [settings, setSettings] = useState(null);
  const [defaults, setDefaults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [project, setProject] = useState("");
  const [city, setCity] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState({ key: "remaining", dir: "asc" });
  const [dialog, setDialog] = useState(null); // { type: "record" | "history" | "settings", plate? }
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [st, se, md] = await Promise.all([
      sb.rpc("oil_fleet_status"),
      sb.from("oil_settings").select("*").maybeSingle(),
      sb.from("oil_model_defaults").select("*").order("model"),
    ]);
    if (st.error) {
      setError(st.error.code === "PGRST202" || /oil_fleet_status/i.test(st.error.message || "")
        ? "Oil tracking is not set up in the database yet (migration 058)."
        : friendlyError(st.error));
      setRows([]);
    } else {
      setError("");
      setRows(st.data || []);
    }
    setSettings(se.data || null);
    setDefaults(md.data || []);
    setLoading(false);
  }, []);
  useEffect(() => { if (allowed) load(); }, [allowed, load]);

  // a link from the bell: ?plate=... opens that vehicle
  useEffect(() => {
    const plate = params.get("plate");
    if (plate && rows.length && !dialog) {
      setDialog({ type: "history", plate });
      const next = new URLSearchParams(params); next.delete("plate"); setParams(next, { replace: true });
    }
  }, [params, rows.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const options = useMemo(() => {
    const uniq = (k) => [...new Set(rows.map(r => r[k]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    return { projects: uniq("project"), cities: uniq("city") };
  }, [rows]);

  // everything except the status filter: the cards count this set and filter it when clicked
  const scoped = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r =>
      (!project || r.project === project) && (!city || r.city === city) &&
      (!q || [r.vehicle_plate, r.model, r.driver_name, r.project, r.city].some(v => v && String(v).toLowerCase().includes(q))));
  }, [rows, project, city, search]);

  const counts = useMemo(() => {
    const c = { overdue: 0, soon: 0, ok: 0, no_reading: 0, needs_setup: 0 };
    for (const r of scoped) if (c[r.status] != null) c[r.status]++;
    return c;
  }, [scoped]);
  const needsInterval = useMemo(() => scoped.filter(r => (r.flags || []).includes("needs_interval")).length, [scoped]);

  const visible = useMemo(() => {
    const list = scoped.filter(r => !status || r.status === status);
    const get = SORTS[sort.key];
    const dir = sort.dir === "desc" ? -1 : 1;
    return [...list].sort((a, b) => {
      const x = get(a), y = get(b);
      if (x == null && y == null) return a.vehicle_plate.localeCompare(b.vehicle_plate);
      if (x == null) return 1;      // empty values always last
      if (y == null) return -1;
      const r = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "en", { numeric: true });
      return r * dir || a.vehicle_plate.localeCompare(b.vehicle_plate);
    });
  }, [scoped, status, sort]);

  if (!allowed) return <Navigate to="/overview" replace />;

  const cycleSort = (key) => setSort(s => s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" });
  const th = (key, label) => (
    <th aria-sort={sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className="oc-th" onClick={() => cycleSort(key)}>
        {label}{sort.key === key ? (sort.dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={12} className="dim" />}
      </button>
    </th>
  );

  async function notifyDriver(r) {
    if (!r.driver_mobile) return;
    const { error: err } = await sb.from("oil_driver_notices").insert({
      vehicle_plate: r.vehicle_plate, cycle_next_odo: r.next_change_odo, remaining_km: r.remaining_km,
      expected_date: r.expected_date, driver_identity_number: r.driver_identity_number,
    });
    if (err) return showToast("Could not record the notice: " + friendlyError(err), "error");
    window.open(whatsappUrl(r.driver_mobile, driverMessage(r)), "_blank", "noopener");
    showToast(`Notice recorded for ${r.vehicle_plate}`);
    load();
  }

  async function doExport() {
    setExporting(true);
    try { const n = await exportOilChangesXlsx(visible); showToast(`Exported ${n} vehicle${n === 1 ? "" : "s"}`); }
    catch (e) { showToast("Export failed: " + (e?.message || "unknown error"), "error"); }
    finally { setExporting(false); }
  }

  const historyRow = dialog?.type === "history" ? rows.find(r => r.vehicle_plate === dialog.plate) : null;

  return (
    <div className="oc">
      <HeroPortal target="fx-hero-actions" className="content-header">
        <div>
          <div className="breadcrumb">Fleet &gt; <b>Oil Changes</b></div>
          <h1 className="page-title">Oil Changes</h1>
        </div>
      </HeroPortal>

      <div className="oc-head">
        <p className="oc-desc">The next change = the odometer at the last change + the change distance. Current odometers come from the shift and reinforcement forms.</p>
        <div className="oc-actions">
          <button type="button" className="oc-btn" onClick={() => setDialog({ type: "settings" })} disabled={!settings}><Settings size={15} /> Settings</button>
          <button type="button" className="oc-btn" onClick={doExport} disabled={exporting || !visible.length}><Download size={15} /> {exporting ? "Exporting…" : "Export to Excel"}</button>
          <button type="button" className="oc-btn primary" onClick={() => setDialog({ type: "record" })} disabled={!rows.length}><Droplets size={15} /> Record oil change</button>
        </div>
      </div>

      {error && <div className="oc-error">{error}</div>}

      <div className="oc-cards">
        {CARDS.map(c => (
          <button key={c.key} type="button" className={"oc-card tone-" + c.key + (status === c.key ? " on" : "")} aria-pressed={status === c.key} title={c.hint || c.label}
            onClick={() => setStatus(s => (s === c.key ? "" : c.key))}>
            <span className="oc-card-icon">{c.icon}</span>
            <span className="oc-card-label">{c.label}</span>
            {loading ? <span className="oc-skel num" /> : <span className="oc-card-value">{counts[c.key]}</span>}
          </button>
        ))}
      </div>
      {!loading && (counts.needs_setup > 0 || needsInterval > 0) && (
        <div className="oc-setup">
          <TriangleAlert size={14} />
          {counts.needs_setup > 0 && <button type="button" className="oc-link" onClick={() => setStatus("needs_setup")}>{counts.needs_setup} vehicle{counts.needs_setup === 1 ? "" : "s"} need setup (no oil change recorded yet)</button>}
          {needsInterval > 0 && <span>{counts.needs_setup > 0 ? " · " : ""}{needsInterval} with no change distance for the model</span>}
        </div>
      )}

      <div className="oc-filters">
        <select value={project} onChange={e => setProject(e.target.value)} aria-label="Project"><option value="">All projects</option>{options.projects.map(p => <option key={p}>{p}</option>)}</select>
        <select value={city} onChange={e => setCity(e.target.value)} aria-label="City"><option value="">All cities</option>{options.cities.map(p => <option key={p}>{p}</option>)}</select>
        <select value={status} onChange={e => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <label className="oc-search"><Search size={14} />
          <input type="text" name="oil-filter" placeholder="Search vehicle, model or driver" value={search} onChange={e => setSearch(e.target.value)}
            autoComplete="off" data-lpignore="true" data-1p-ignore="true" data-form-type="other" data-gramm="false" /></label>
        {(project || city || status || search) && <button type="button" className="oc-link" onClick={() => { setProject(""); setCity(""); setStatus(""); setSearch(""); }}>Clear</button>}
        <span className="oc-count">{visible.length} of {rows.length} vehicles</span>
      </div>

      <div className="oc-wrap">
        <table className="oc-table">
          <thead>
            <tr>
              {th("vehicle", "Vehicle")}{th("project", "Project")}<th>Model</th><th>Last change</th><th>Current odometer</th>
              {th("remaining", "Remaining")}<th>Avg / day</th>{th("expected", "Expected date")}<th>Driver</th><th>Notified</th>{th("status", "Status")}<th />
            </tr>
          </thead>
          <tbody>
            {loading ? Array.from({ length: 6 }, (_, i) => (
              <tr key={i}>{Array.from({ length: 12 }, (_, j) => <td key={j}><div className="oc-skel" /></td>)}</tr>
            )) : visible.map(r => {
              const pct = usedPct(r);
              const flags = (r.flags || []);
              return (
                <tr key={r.vehicle_plate} className={"oc-row st-" + r.status} onClick={() => setDialog({ type: "history", plate: r.vehicle_plate })}>
                  <td className="plate">{r.vehicle_plate}</td>
                  <td>{r.project || "—"}<small>{r.city || ""}</small></td>
                  <td>{r.model || "—"}</td>
                  <td>{r.last_change_id ? <><span title={r.last_change_date ? "" : "Date not recorded (old data)"}>{r.last_change_date ? dmy(r.last_change_date) : "—"}</span><small>{fmtKm(r.last_change_odo)} km</small></> : "—"}</td>
                  <td>{r.current_odo != null ? <>{fmtKm(r.current_odo)}<small>{dmy(r.current_odo_date)}</small></> : "—"}</td>
                  <td className="rem">
                    {r.remaining_km != null ? (
                      <>
                        <b className={Number(r.remaining_km) <= 0 ? "neg" : ""}>{Number(r.remaining_km) <= 0 ? `${fmtKm(Math.abs(r.remaining_km))} over` : fmtKm(r.remaining_km)}</b>
                        {pct != null && <div className="oc-bar" title={`${pct}% of the change distance used`}><i style={{ width: pct + "%" }} /></div>}
                      </>
                    ) : "—"}
                  </td>
                  <td>{r.avg_daily_km != null ? fmtKm(r.avg_daily_km) : "—"}</td>
                  <td>{r.expected_date ? dmy(r.expected_date) : "—"}</td>
                  <td className="drv" title={r.driver_name || ""}>{r.driver_name || "—"}</td>
                  <td>{r.notice_at ? <>{dmy(r.notice_at)}<small>{r.notice_unanswered ? "not done yet" : ""}</small></> : "—"}</td>
                  <td>
                    <span className={"oc-status " + r.status}>{STATUS[r.status]?.icon} {STATUS[r.status]?.label || r.status}</span>
                    {flags.length > 0 && (
                      <span className="oc-flag" title={flags.map(f => FLAG_TEXT[f] || f).join("\n")}><TriangleAlert size={13} /></span>
                    )}
                  </td>
                  <td className="oc-row-actions" onClick={e => e.stopPropagation()}>
                    <button type="button" className="oc-icon" title="Record oil change" onClick={() => setDialog({ type: "record", plate: r.vehicle_plate })}><Droplets size={15} /></button>
                    <button type="button" className="oc-icon wa" disabled={!normalizeMobile(r.driver_mobile)}
                      title={normalizeMobile(r.driver_mobile) ? "Notify the driver on WhatsApp" : "No driver mobile number"} onClick={() => notifyDriver(r)}><MessageCircle size={15} /></button>
                  </td>
                </tr>
              );
            })}
            {!loading && !visible.length && <tr><td colSpan={12} className="oc-empty">{rows.length ? "No vehicle matches these filters." : "No vehicles yet."}</td></tr>}
          </tbody>
        </table>
      </div>

      {dialog?.type === "record" && <RecordDialog rows={rows} plate={dialog.plate} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); load(); }} />}
      {historyRow && <HistoryDialog row={historyRow} onClose={() => setDialog(null)} onChanged={load} />}
      {dialog?.type === "settings" && settings && <SettingsDialog settings={settings} defaults={defaults} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); load(); }} />}
    </div>
  );
}
