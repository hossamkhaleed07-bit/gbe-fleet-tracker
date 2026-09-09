import { createContext, useContext, useState } from "react";
import { sb } from "../lib/supabase";
import { useAuth } from "./AuthContext";
import { useDashboard } from "./DataContext";
import { buildGroupMetrics } from "../lib/calc";

const DetailModalContext = createContext(null);

export function DetailModalProvider({ children }) {
  const { canEditShiftEntries } = useAuth();
  const { vehicleEndHistory, vehicleRates, vehicleFuelTypes, stationRates, approvedFuelByKey, patchShiftEntries } = useDashboard();
  const [group, setGroup] = useState(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  function openDetail(g) {
    setGroup(g);
    setEditing(false);
    setSaveError("");
  }
  function closeDetail() {
    setGroup(null);
    setEditing(false);
  }

  async function saveEdit(form) {
    if (!group) return;
    setSaving(true);
    setSaveError("");
    const num = v => (v === "" || v == null ? null : Number(v));
    const updates = [];
    const patches = [];
    if (group.start) {
      const changes = {
        shift_date: form.date || null,
        odo_reading: num(form.startOdo),
        ofd_count: num(form.ofd),
      };
      updates.push(sb.from("shift_entries").update(changes).eq("id", group.start.id));
      patches.push({ id: group.start.id, changes });
    }
    if (group.end) {
      const changes = {
        shift_date: form.date || null,
        odo_reading: num(form.endOdo),
        cod_delivered: num(form.cod),
        ppd_delivered: num(form.ppd),
        picked_up: num(form.pickup),
      };
      updates.push(sb.from("shift_entries").update(changes).eq("id", group.end.id));
      patches.push({ id: group.end.id, changes });
    }
    const results = await Promise.all(updates);
    const err = results.find(r => r.error);
    setSaving(false);
    if (err) { setSaveError("فشل الحفظ: " + err.error.message); return false; }
    patchShiftEntries(patches);
    closeDetail();
    return true;
  }

  const computed = group ? buildGroupMetrics(group, { vehicleRates, vehicleFuelTypes, stationRates, vehicleEndHistory, approvedFuelByKey }) : null;

  return (
    <DetailModalContext.Provider value={{ group, editing, setEditing, computed, canEdit: canEditShiftEntries, openDetail, closeDetail, saveEdit, saving, saveError }}>
      {children}
    </DetailModalContext.Provider>
  );
}

export function useDetailModal() {
  return useContext(DetailModalContext);
}
