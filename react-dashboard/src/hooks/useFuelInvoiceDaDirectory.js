import { useEffect, useState } from "react";
import { sb } from "../lib/supabase";
import { cacheGet, cacheSet } from "../lib/fuelInvoiceCache";

const PAGE_SIZE = 1000;

// The DA directory has ~2826 rows — comfortably past Supabase/PostgREST's
// default 1000-row cap, so this must paginate (same lesson learned the hard
// way elsewhere in this app: a fixed .limit()/no pagination silently drops
// rows once a table grows past it).
export function useFuelInvoiceDaDirectory() {
  const [byNid, setByNid] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // show the last-known directory instantly; the real load below replaces it
    cacheGet("da-directory").then(c => { if (!cancelled && c && Object.keys(c).length) { setByNid(prev => (Object.keys(prev).length ? prev : c)); setLoading(false); } });
    (async () => {
      const page = (start) => sb.from("fuel_invoice_da_directory")
        .select("national_id,english_name").order("national_id", { ascending: true })
        .range(start, start + PAGE_SIZE - 1);
      const rows = [];
      let start = 0;
      // count first, then every page at once (see useFuelInvoiceRecords)
      const { count, error: cErr } = await sb.from("fuel_invoice_da_directory").select("national_id", { count: "exact", head: true });
      if (!cErr && typeof count === "number" && count > PAGE_SIZE) {
        const starts = [];
        for (let x = 0; x < count; x += PAGE_SIZE) starts.push(x);
        const results = await Promise.all(starts.map(page));
        for (const r of results) if (!r.error && r.data) rows.push(...r.data);
        start = starts.length * PAGE_SIZE;
        if (rows.length < start) start = -1; // short result — don't keep walking
      }
      while (start >= 0) {
        const { data, error } = await page(start);
        if (error || !data) break;
        rows.push(...data);
        if (data.length < PAGE_SIZE) break;
        start += PAGE_SIZE;
      }
      if (cancelled) return;
      const map = {};
      for (const r of rows) map[r.national_id] = r.english_name;
      setByNid(map);
      if (Object.keys(map).length) cacheSet("da-directory", map);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  function lookup(nid) {
    if (!nid) return "";
    return byNid[String(nid).trim()] || "N/A";
  }

  return { lookup, loading };
}
