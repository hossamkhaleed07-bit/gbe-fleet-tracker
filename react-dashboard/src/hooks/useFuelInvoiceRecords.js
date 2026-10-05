import { useCallback, useEffect, useRef, useState } from "react";
import { sb } from "../lib/supabase";
import { useAuth } from "../contexts/AuthContext";
import { cacheGet, cacheSet } from "../lib/fuelInvoiceCache";
import { GENERATED_COLUMNS, invoiceKey } from "../lib/fuelInvoice";

const PAGE_SIZE = 1000;

// Same "no fixed limit can silently truncate" pagination idiom used
// elsewhere in this app (useDashboardData.js) — this table starts empty but
// there's no reason to reintroduce that bug class as it grows.
// Rows are shown in `sort_order` (migration 055): a unique number from a sequence, so
// the order is the same on every load and a pasted batch keeps its paste order. A
// database that does not have the column yet (055 not run) is read the old way.
let hasSortOrder = true;
async function fetchPage(start) {
  let q = sb.from("fuel_invoice_records").select("*");
  if (hasSortOrder) {
    q = q.order("sort_order", { ascending: true }).order("id", { ascending: true });
  } else {
    // Legacy order. `id` is a required last tiebreaker: rows inserted together share
    // entry_date AND created_at, so Postgres would otherwise be free to reorder them.
    q = q.order("entry_date", { ascending: true }).order("created_at", { ascending: true }).order("id", { ascending: true });
  }
  const res = await q.range(start, start + PAGE_SIZE - 1);
  if (res.error && hasSortOrder && /sort_order/i.test(res.error.message || "")) {
    hasSortOrder = false;
    return fetchPage(start);
  }
  return res;
}

// Row order helpers: rows without a number (legacy database) keep their place at the end.
const orderOf = (r) => (r?.sort_order == null ? Infinity : Number(r.sort_order));
export function sortRecords(list) {
  return [...list].sort((a, b) => orderOf(a) - orderOf(b));
}
// Inserts one row where its number belongs (binary search over a list already in order).
export function insertSorted(list, row) {
  const o = orderOf(row);
  let lo = 0, hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (orderOf(list[mid]) <= o) lo = mid + 1; else hi = mid;
  }
  const out = list.slice();
  out.splice(lo, 0, row);
  return out;
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

// The database computes some columns itself (invoice_month). Whatever a caller
// passes, they are never sent — Postgres rejects a value for a generated column.
function stripGenerated(payload) {
  if (Array.isArray(payload)) return payload.map(stripGenerated);
  const out = { ...payload };
  for (const k of GENERATED_COLUMNS) delete out[k];
  return out;
}

// "No unique constraint for ON CONFLICT" — what a database that has not got
// migration 054 yet answers. Used to fall back to a client-side duplicate check.
function isMissingConflictTarget(err) {
  return err?.code === "42P10" || /ON CONFLICT|invoice_month/i.test(err?.message || "");
}

// "function does not exist" — what a database that has not got migration 055 answers
function isMissingFunction(err) {
  return err?.code === "PGRST202" || err?.code === "42883" || /reserve_invoice_sort_orders/i.test(err?.message || "");
}

const RESERVE_MAX = 20000;  // most numbers the database hands out per call
const INSERT_CHUNK = 500;   // rows per save request

const CONFLICT_COLUMNS = "data_source,invoice_number,invoice_month";

// Shared by the Invoices page — each mounts its own copy
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
            ? insertSorted(recordsRef.current, payload.new)
            : recordsRef.current.map(r => r.id === payload.new.id ? payload.new : r);
        }
        setRecords([...recordsRef.current]);
      })
      .subscribe();
    return () => { sb.removeChannel(channel); };
  }, [load]);

  async function createRecord(payload) {
    mutationsRef.current++;
    const { data, error: err } = await sb.from("fuel_invoice_records").insert(stripGenerated(payload)).select().single();
    if (err) return { error: err };
    // Optimistic — the realtime event will also arrive and is a no-op merge.
    recordsRef.current = insertSorted(recordsRef.current, data);
    setRecords([...recordsRef.current]);
    return { data };
  }

  async function updateRecord(id, payload) {
    mutationsRef.current++;
    const { data, error: err } = await sb.from("fuel_invoice_records").update(stripGenerated(payload)).eq("id", id).select().single();
    if (err) return { error: err };
    recordsRef.current = recordsRef.current.map(r => r.id === id ? data : r);
    setRecords([...recordsRef.current]);
    return { data };
  }

  // Saves rows that ALREADY exist (they carry an `id`): updates in place. Also
  // used to put a row back when a delete is undone.
  async function bulkUpsert(rowsPayload) {
    mutationsRef.current++;
    const { data, error: err } = await sb.from("fuel_invoice_records").upsert(stripGenerated(rowsPayload)).select();
    if (err) return { error: err };
    const byId = new Map(recordsRef.current.map(r => [r.id, r]));
    for (const r of data) byId.set(r.id, r);
    recordsRef.current = sortRecords([...byId.values()]);
    setRecords(recordsRef.current);
    return { data };
  }

  // Adds NEW rows (no `id`). A row whose (data_source, invoice_number, invoice
  // month) already exists is skipped by the database (ON CONFLICT DO NOTHING),
  // never duplicated and never an error.
  //
  // ORDER, even for a paste of thousands of rows (migration 055):
  //   1. every row gets its sort_order FIRST - numbers are taken from the database
  //      in increasing order (one call per 20000 rows, one after the other) and the
  //      k-th row of the paste gets the k-th number;
  //   2. only then are the rows sent, in batches of INSERT_CHUNK rows, ONE BATCH AT A TIME
  //      (each waits for the previous one).
  // The stored order depends on step 1 alone, so it cannot be changed by batch size,
  // timing, retries or the order Postgres inserts in. Sending the batches in sequence
  // additionally keeps the first rows of a paste saved first, and a failure stops
  // the paste at a clean point (a retry is safe: saved rows are skipped as duplicates).
  //
  // Resolves to { results } - one entry per input row, in order:
  //   { status: "added", row }  the row as stored (id, trimmed values, da_name...)
  //   { status: "duplicate" }   skipped because it already existed
  //   { status: "failed" }      not saved because a batch failed
  // plus { error } when something failed (results then covers what was done), or just
  // { error } when nothing was attempted.
  async function insertNewRows(rowsPayload) {
    mutationsRef.current++;
    let clean = stripGenerated(rowsPayload);

    if (clean.length) {
      const numbers = [];
      let numberingFailed = null;
      for (let at = 0; at < clean.length; at += RESERVE_MAX) {
        const n = Math.min(RESERVE_MAX, clean.length - at);
        const reserved = await sb.rpc("reserve_invoice_sort_orders", { p_count: n });
        if (!reserved.error && Array.isArray(reserved.data) && reserved.data.length === n) {
          numbers.push(...reserved.data.map(Number));
        } else {
          numberingFailed = reserved.error || new Error("Could not reserve row numbers");
          break;
        }
      }
      if (!numberingFailed) {
        clean = clean.map((p, i) => ({ ...p, sort_order: numbers[i] }));
      } else if (isMissingFunction(numberingFailed)) {
        // a database without migration 055 yet: save the rows as before, unnumbered
      } else {
        return { error: numberingFailed }; // nothing saved
      }
    }

    const results = [];
    let failure = null;
    for (let at = 0; at < clean.length; at += INSERT_CHUNK) {
      const chunk = clean.slice(at, at + INSERT_CHUNK);
      if (failure) { chunk.forEach(() => results.push({ status: "failed" })); continue; }
      const done = await insertChunk(chunk);
      if (done.error) {
        failure = done.error;
        chunk.forEach(() => results.push({ status: "failed" }));
        continue;
      }
      results.push(...done.results);
    }
    return failure ? { results, error: failure } : { results };
  }

  // One batch: inserts it, folds the stored rows into the hook's list, and pairs every
  // input row with what was stored (or notes that it was skipped).
  async function insertChunk(chunk) {
    let inserted;
    const first = await sb.from("fuel_invoice_records")
      .upsert(chunk, { onConflict: CONFLICT_COLUMNS, ignoreDuplicates: true })
      .select();
    if (first.error && isMissingConflictTarget(first.error)) {
      // Database without the unique key yet: skip the rows we already know about
      // (and repeats inside this batch), insert the rest.
      const known = new Set(recordsRef.current.map(invoiceKey));
      const seen = new Set();
      const fresh = chunk.filter(p => {
        const k = invoiceKey(p);
        if (known.has(k) || seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      if (!fresh.length) return { results: chunk.map(() => ({ status: "duplicate" })) };
      const second = await sb.from("fuel_invoice_records").insert(fresh).select();
      if (second.error) return { error: second.error };
      inserted = second.data;
    } else if (first.error) {
      return { error: first.error };
    } else {
      inserted = first.data;
    }

    const byId = new Map(recordsRef.current.map(r => [r.id, r]));
    for (const r of inserted) byId.set(r.id, r);
    recordsRef.current = sortRecords([...byId.values()]);
    setRecords(recordsRef.current);

    const storedByKey = new Map();
    for (const r of inserted) storedByKey.set(invoiceKey(r), r);
    return {
      results: chunk.map(p => {
        const k = invoiceKey(p);
        const stored = storedByKey.get(k);
        if (!stored) return { status: "duplicate" };
        storedByKey.delete(k); // a second identical row in the same batch is a duplicate
        return { status: "added", row: stored };
      }),
    };
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

  return { records, loading, error, syncVersion, reload: load, createRecord, updateRecord, deleteRecords, bulkUpsert, insertNewRows };
}
