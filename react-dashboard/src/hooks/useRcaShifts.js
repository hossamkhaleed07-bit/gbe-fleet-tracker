import { useCallback, useEffect, useRef, useState } from "react";
import { sb } from "../lib/supabase";
import { fetchAllPages } from "./useDashboardData";
import { addDays } from "../lib/rcaFollowup";

// shift_entries for the RCA page's own from..to, independent of the app's
// shared date filter (which used to be the only thing loaded, so picking an
// RCA day outside it showed every driver as Non Submitted). One extra day
// after `to` is fetched so a shift closed after midnight can be paired with
// its start (see mergeMidnightShifts).
export function useRcaShifts(from, to) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const generationRef = useRef(0);

  const reload = useCallback(async () => {
    const requestId = ++generationRef.current;
    if (!from || !to || from > to) {
      setRows([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const factory = () => sb.from("shift_entries").select("*")
      .gte("shift_date", from)
      .lte("shift_date", addDays(to, 1))
      .order("created_at", { ascending: false });
    let result;
    try {
      result = await fetchAllPages(factory);
    } catch (e) {
      result = { data: null, error: e };
    }
    // A newer from/to was picked while this request was in flight.
    if (requestId !== generationRef.current) return;
    if (result.error) {
      setError(result.error.message || "Request failed");
    } else {
      setRows(result.data);
    }
    setLoading(false);
  }, [from, to]);

  useEffect(() => { reload(); }, [reload]);

  return { rows, loading, error, reload };
}
