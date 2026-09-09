import { useEffect, useState } from "react";
import { sb } from "../lib/supabase";

export function prevDay(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function usePrevDayShift(identityNumber, shiftDate, fallbackPlate) {
  const [group, setGroup] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!identityNumber || !shiftDate) { setGroup(null); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const day = prevDay(shiftDate);
      const { data } = await sb.from("shift_entries").select("*").eq("identity_number", identityNumber).eq("shift_date", day);
      if (cancelled) return;
      const entries = data || [];
      const start = entries.find(r => r.shift_type === "start") || null;
      const end = entries.find(r => r.shift_type === "end") || null;
      setGroup({
        day,
        identity_number: identityNumber,
        vehicle_plate: (end || start)?.vehicle_plate || fallbackPlate,
        start, end,
        empty: !start && !end,
      });
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [identityNumber, shiftDate, fallbackPlate]);

  return { prevDayGroup: group, prevDayLoading: loading };
}
