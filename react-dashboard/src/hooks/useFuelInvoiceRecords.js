import { useCallback, useEffect, useRef, useState } from "react";
import { sb } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { cacheGet, cacheSet } from "../lib/fuelInvoiceCache";

const PAGE_SIZE = 1000;

// Same "no fixed limit can silently truncate" pagination idiom used
// elsewhere in this app (useDashboardData.js) — this table starts empty but
// there's no reason to reintroduce that bug class as it grows.
async function fetchPage(start) {
  // Ascending — the grid should start from day 1 and read downward, not
  // most-recent-first. `id` is a required third tiebreaker: rows bulk
  // -inserted together (the original 1965-row seed migration, or any
  // paste/re-paste of a day's data) share the exact same entry_date AND
  // created_at (one INSERT statement = one now()), so with only two sort
  // columns Postgres has no guaranteed order among them and can return a
  // different order on every reload even though nothing changed.
  return sb.from("fuel_invoice_records").select("*")
    .order("entry_date", { ascending: true }).order("created_at", { ascending: true }).order("id", { ascending: true })
    .range(start, start + PAGE_SIZE - 1);
}

// Pages are fetched in PARALLEL (a cheap head-only count first, then every
// page at once) instead of one after another, so load time stays roughly one
// round trip no matter how many pages there are. Falls back to the old
// sequential walk if the count isn't available. Safe against truncation
// either way: after the parallel batch, any further full page is still walked.
async function fetchAllPages() {
  const { count, error: countErr } = await sb.from("fuel_invoice_records").select("id", { count: "exact", head: true });
  const rows = [];
  let start = 0;
  if (!countErr && typeof count === "number" && count > PAGE_SIZE) {
    const starts = [];
    for (let s = 0; s < count; s += PAGE_SIZE) starts.push(s);
    const results = await Promise.all(starts.map(fetchPage));
    for (const r of results) {
      if (r.error) return { data: null, error: r.error };
      rows.push(...(r.data || []));
    }
    start = starts.length * PAGE_SIZE;
    // rows added between the count and the pages (or an out-of-date count):
    // keep walking while pages come back full.
    if (rows.length < start) return { data: rows, error: null };
  }
  for (;;) {
    const { data, error } = await fetchPage(start);
    if (error) return { data: null, error };
    rows.push(...(data || []));
    if (!data || data.length < PAGE_SIZE) break;
    start += PAGE_SIZE;
  }
  return { data: rows, error: null };
}

// Shared by both the Entries and Data Base pages — each mounts its own copy
// of this hook (simple, no extra provider plumbing needed for what's meant
// to be a self-contained module), but both read the SAME table and both
// subscribe to Postgres Realtime on it, so a change made from either page
// (or a second browser tab) appears on both without a manual refresh and
// without ever diverging into separate copies of the data.
export function useFuelInvoiceRecords() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const recordsRef = useRef([]);
  const { session } = useAuth();
  const cacheKey = session?.user?.id ? `records:${session.user.id}` : null;
  // Stale-while-revalidate: the last-known rows (IndexedDB) show immediately,
  // the real load runs behind them, and `syncVersion` ticks when it lands so
  // the grid can swap the cached copy for the fresh one.
  const [syncVersion, setSyncVersion] = useState(0);
  const hydratedRef = useRef(false);   // currently showing cached rows
  const freshRef = useRef(false);      // a real network load has completed
  const mutationsRef = useRef(0);      // local/realtime changes since last load began

  const load = useCallback(async () => {
    if (!hydratedRef.current) setLoading(true);
    for (let attempt = 0; attempt < 3; attempt++) {
      const mutationsAtStart = mutationsRef.current;
      const { data, error: err } = await fetchAllPages();
      if (err) { setError(err.message); setLoading(false); return; }
      // a save/realtime change landed while this was in flight: the result may
      // predate it and would visually undo it — fetch again (max 3 tries)
      if (mutationsRef.current !== mutationsAtStart && attempt < 2) continue;
      setError("");
      freshRef.current = true;
      recordsRef.current = data;
      setRecords(data);
      setLoading(false);
      if (hydratedRef.current) { hydratedRef.current = false; setSyncVersion(v => v + 1); }
      return;
    }
  }, []);

  useEffect(() => {
    if (!cacheKey) return;
    let cancelled = false;
    cacheGet(cacheKey).then(cached => {
      if (cancelled || freshRef.current || !Array.isArray(cached) || !cached.length) return;
      hydratedRef.current = true;
      recordsRef.current = cached;
      setRecords(cached);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [cacheKey]);

  // keep the cache current (debounced) once real data is in
  useEffect(() => {
    if (!cacheKey || !freshRef.current || !records.length) return;
    const t = setTimeout(() => cacheSet(cacheKey, records), 1500);
    return () => clearTimeout(t);
  }, [records, cacheKey]);

  useEffect(() => {
    load();
    const channel = sb.channel("fuel_invoice_records_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "fuel_invoice_records" }, (payload) => {
        mutationsRef.current++;
        if (payload.eventType === "DELETE") {
          recordsRef.current = recordsRef.current.filter(r => r.id !== payload.old.id);
        } else {
          const idx = recordsRef.current.findIndex(r => r.id === payload.new.id);
          recordsRef.current = idx === -1
            ? [payload.new, ...recordsRef.current]
            : recordsRef.current.map(r => r.id === payload.new.id ? payload.new : r);
        }
        setRecords([...recordsRef.current]);
      })
      .subscribe();
    return () => { sb.removeChannel(channel); };
  }, [load]);

  async function createRecord(payload) {
    mutationsRef.current++;
    const { data, error: err } = await sb.from("fuel_invoice_records").insert(payload).select().single();
    if (err) return { error: err };
    // Optimistic — the realtime event will also arrive and is a no-op merge.
    recordsRef.current = [data, ...recordsRef.current];
    setRecords([...recordsRef.current]);
    return { data };
  }

  async function updateRecord(id, payload) {
    mutationsRef.current++;
    const { data, error: err } = await sb.from("fuel_invoice_records").update(payload).eq("id", id).select().single();
    if (err) return { error: err };
    recordsRef.current = recordsRef.current.map(r => r.id === id ? data : r);
    setRecords([...recordsRef.current]);
    return { data };
  }

  // One network round-trip for many rows at once (bulk paste) instead of one
  // request per cell/row — rows with an existing `id` update in place, rows
  // without one insert fresh (the column's default generates their id).
  async function bulkUpsert(rowsPayload) {
    mutationsRef.current++;
    const { data, error: err } = await sb.from("fuel_invoice_records").upsert(rowsPayload).select();
    if (err) return { error: err };
    const byId = new Map(recordsRef.current.map(r => [r.id, r]));
    for (const r of data) byId.set(r.id, r);
    recordsRef.current = [...byId.values()];
    setRecords(recordsRef.current);
    return { data };
  }

  async function deleteRecords(ids) {
    mutationsRef.current++;
    const { error: err } = await sb.from("fuel_invoice_records").delete().in("id", ids);
    if (err) return { error: err };
    const idSet = new Set(ids);
    recordsRef.current = recordsRef.current.filter(r => !idSet.has(r.id));
    setRecords([...recordsRef.current]);
    return {};
  }

  return { records, loading, error, syncVersion, reload: load, createRecord, updateRecord, deleteRecords, bulkUpsert };
}
