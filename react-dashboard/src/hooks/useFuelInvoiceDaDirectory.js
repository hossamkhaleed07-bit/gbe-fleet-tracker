import { useEffect, useState } from "react";
import { sb } from "../lib/supabase";

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
    (async () => {
      const rows = [];
      let start = 0;
      for (;;) {
        const { data, error } = await sb.from("fuel_invoice_da_directory")
          .select("national_id,english_name")
          .range(start, start + PAGE_SIZE - 1);
        if (error || !data) break;
        rows.push(...data);
        if (data.length < PAGE_SIZE) break;
        start += PAGE_SIZE;
      }
      if (cancelled) return;
      const map = {};
      for (const r of rows) map[r.national_id] = r.english_name;
      setByNid(map);
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
