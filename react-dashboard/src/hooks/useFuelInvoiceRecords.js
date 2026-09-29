import { useCallback, useEffect, useRef, useState } from "react";
import { sb } from "../lib/supabase";

const PAGE_SIZE = 1000;

// Same "no fixed limit can silently truncate" pagination idiom used
// elsewhere in this app (useDashboardData.js) — this table starts empty but
// there's no reason to reintroduce that bug class as it grows.
async function fetchAllPages() {
  const rows = [];
  let start = 0;
  for (;;) {
    const { data, error } = await sb.from("fuel_invoice_records").select("*")
      .order("entry_date", { ascending: false }).order("created_at", { ascending: false })
      .range(start, start + PAGE_SIZE - 1);
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

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await fetchAllPages();
    if (err) { setError(err.message); setLoading(false); return; }
    setError("");
    recordsRef.current = data;
    setRecords(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const channel = sb.channel("fuel_invoice_records_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "fuel_invoice_records" }, (payload) => {
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
    const { data, error: err } = await sb.from("fuel_invoice_records").insert(payload).select().single();
    if (err) return { error: err };
    // Optimistic — the realtime event will also arrive and is a no-op merge.
    recordsRef.current = [data, ...recordsRef.current];
    setRecords([...recordsRef.current]);
    return { data };
  }

  async function updateRecord(id, payload) {
    const { data, error: err } = await sb.from("fuel_invoice_records").update(payload).eq("id", id).select().single();
    if (err) return { error: err };
    recordsRef.current = recordsRef.current.map(r => r.id === id ? data : r);
    setRecords([...recordsRef.current]);
    return { data };
  }

  async function deleteRecords(ids) {
    const { error: err } = await sb.from("fuel_invoice_records").delete().in("id", ids);
    if (err) return { error: err };
    const idSet = new Set(ids);
    recordsRef.current = recordsRef.current.filter(r => !idSet.has(r.id));
    setRecords([...recordsRef.current]);
    return {};
  }

  return { records, loading, error, reload: load, createRecord, updateRecord, deleteRecords };
}
