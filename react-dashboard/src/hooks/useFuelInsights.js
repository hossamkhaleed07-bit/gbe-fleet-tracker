import { useCallback, useEffect, useState } from "react";
import { sb } from "../lib/supabase";

// Lightweight, independently-fetched counts used for sidebar badges and the
// Overview KPI tiles: how many fuel requests are waiting on a decision, and
// how many of those (pending or approved) land on a day the driver was
// marked leave/absent in driver_attendance. RLS already scopes both queries
// per the signed-in account's project, same as everywhere else in the app.
export function useFuelInsights() {
  const [pendingCount, setPendingCount] = useState(0);
  const [conflictCount, setConflictCount] = useState(0);

  const load = useCallback(async () => {
    const { data: reqs } = await sb
      .from("reinforcement_requests")
      .select("identity_number,shift_date,status")
      .neq("status", "rejected");
    const list = reqs || [];
    setPendingCount(list.filter(r => r.status === "pending").length);

    const { data: nonPresent } = await sb
      .from("driver_attendance")
      .select("identity_number,attendance_date")
      .in("status", ["leave", "absent"]);
    const conflictSet = new Set((nonPresent || []).map(a => `${a.identity_number}|${a.attendance_date}`));
    setConflictCount(list.filter(r => conflictSet.has(`${r.identity_number}|${r.shift_date}`)).length);
  }, []);

  useEffect(() => {
    load();
    // This hook can be mounted by more than one component at once (Layout's
    // sidebar badges + the Overview page) — each needs its own channel name,
    // since Supabase throws if you try to add listeners to a channel that's
    // already subscribed under the same name.
    const channelName = `fuel_insights_${Math.random().toString(36).slice(2)}`;
    const channel = sb
      .channel(channelName)
      .on("postgres_changes", { event: "*", schema: "public", table: "reinforcement_requests" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "driver_attendance" }, load)
      .subscribe();
    return () => { sb.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { pendingCount, conflictCount, refresh: load };
}
