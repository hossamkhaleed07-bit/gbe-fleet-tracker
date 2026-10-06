// Oil changes: labels, formatting and small helpers shared by the page, the export and the bell.
// The numbers themselves (current odometer, remaining km, status...) are computed by the
// database (public.oil_fleet_status, migration 058): nothing here recalculates them.

export const STATUS = {
  overdue:      { label: "Overdue",      icon: "🔴", rank: 0 },
  soon:         { label: "Soon",         icon: "🟠", rank: 1 },
  ok:           { label: "OK",           icon: "🟢", rank: 2 },
  no_reading:   { label: "No reading",   icon: "⚪", rank: 3 },
  needs_setup:  { label: "Needs setup",  icon: "⚙️", rank: 4 },
};

export const FLAG_TEXT = {
  no_baseline: "No oil change recorded yet — record the last change to start counting",
  needs_interval: "This model has no change distance — set one in Settings",
  no_reading: "No valid odometer reading in the last 45 days",
  current_below_change: "The current odometer is below the odometer of the last change — one of the two is wrong",
  ignored_readings: "Some readings were ignored as wrong (lower than the previous one, or an impossible jump)",
};

// Why a reading was ignored (the reason codes come from oil_valid_readings, migration 058)
export const REASON_TEXT = {
  lower_than_last_change: "أقل من عداد آخر تغيير زيت",
  lower_than_previous: "أقل من القراءة الصحيحة السابقة",
  jump_too_large: "قفزة أكبر من الحد اليومي المسموح",
  suspect_baseline: "قراءة مشكوك فيها، القراءات اللي بعدها مش متوافقة معاها",
};

export const fmtKm = (n) => (n == null || n === "" ? "—" : Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 }));

// yyyy-mm-dd (or a timestamp) -> d/m/yyyy
export function dmy(v) {
  if (!v) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  return m ? `${Number(m[3])}/${Number(m[2])}/${m[1]}` : "—";
}

export const localISO = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// 0..100: how much of the change distance is used up
export function usedPct(row) {
  const interval = Number(row.last_change_interval);
  if (!interval || row.remaining_km == null) return null;
  return Math.max(0, Math.min(100, Math.round(((interval - Number(row.remaining_km)) / interval) * 100)));
}

// Saudi mobile numbers come as 05xxxxxxxx, 5xxxxxxxx, 9665xxxxxxxx or +9665xxxxxxxx: WhatsApp wants 9665xxxxxxxx.
export function normalizeMobile(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("00966")) return d.slice(2);
  if (d.startsWith("966")) return d;
  if (d.startsWith("05") && d.length === 10) return "966" + d.slice(1);
  if (d.startsWith("5") && d.length === 9) return "966" + d;
  return d;
}

export function driverMessage(row) {
  const remaining = row.remaining_km == null ? null : Number(row.remaining_km);
  const lines = ["السلام عليكم،"];
  if (remaining != null && remaining <= 0) {
    lines.push(`مركبتك ${row.vehicle_plate} تعدّت موعد تغيير الزيت بـ ${fmtKm(Math.abs(remaining))} كم.`);
    lines.push("من فضلك رتّب تغيير الزيت في أقرب وقت.");
  } else {
    lines.push(`مركبتك ${row.vehicle_plate} باقي لها ${fmtKm(remaining)} كم على تغيير الزيت.`);
    if (row.expected_date) lines.push(`التاريخ المتوقع للتغيير: ${dmy(row.expected_date)}.`);
    lines.push("من فضلك رتّب تغيير الزيت قبل الموعد.");
  }
  lines.push("وبعد التغيير ابعتلنا صورة الفاتورة. شكرًا.");
  return lines.join("\n");
}

export function whatsappUrl(mobile, text) {
  return `https://wa.me/${normalizeMobile(mobile)}?text=${encodeURIComponent(text)}`;
}

export function friendlyError(error) {
  const msg = error?.message || "";
  if (error?.code === "23505" || /duplicate key|no_duplicate/i.test(msg)) return "This oil change is already recorded for this vehicle, date and odometer.";
  if (error?.code === "22023" && /future/i.test(msg)) return "The change date cannot be in the future.";
  if (error?.code === "42501" || /row-level security|NOT_ALLOWED/i.test(msg)) return "You do not have permission for this.";
  return msg || "Something went wrong.";
}
