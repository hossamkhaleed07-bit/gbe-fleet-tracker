// Clipboard helpers for the Invoices grid.

// The only columns whose numbers mean money / quantities. The selection summary
// (Sum / Avg / Min / Max) adds up these and nothing else, so identifier-like
// numbers (invoice number, internal number, NID ...) never end up in a total.
export const STAT_KEYS = ["cost", "amount", "vat"];

const encodeHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// A cell that holds a tab, a line break or a quote is wrapped in quotes (quotes doubled),
// the form Excel and Google Sheets read back as ONE cell.
const tsvCell = (v) => {
  const s = String(v ?? "");
  return /[\t\r\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// `rows` x `cells`: the first row is the column headings. Returns what goes on the
// clipboard: plain text (tab separated) and an HTML table, so each value lands in
// its own cell in Excel and Google Sheets.
export function buildClipboardTable(headings, body) {
  const all = [headings, ...body];
  const text = all.map(r => r.map(tsvCell).join("\t")).join("\n");
  const html = `<table>${all.map(r => `<tr>${r.map(c => `<td>${encodeHtml(c ?? "").replace(/\n/g, "<br/>")}</td>`).join("")}</tr>`).join("")}</table>`;
  return { text, html };
}

export async function writeClipboard(text, html) {
  try {
    if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
      await navigator.clipboard.write([new ClipboardItem({
        "text/plain": new Blob([text], { type: "text/plain" }),
        "text/html": new Blob([html], { type: "text/html" }),
      })]);
      return true;
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to the copy event below */ }
  // last resort: a one-off copy event that carries both formats
  let done = false;
  const onCopy = (e) => {
    e.clipboardData.setData("text/plain", text);
    e.clipboardData.setData("text/html", html);
    e.preventDefault();
    done = true;
  };
  document.addEventListener("copy", onCopy, true);
  try { document.execCommand("copy"); } finally { document.removeEventListener("copy", onCopy, true); }
  return done;
}

// If the first pasted line is exactly the headings of consecutive grid columns (what
// "Copy with headers" puts first), returns the text without that line; otherwise null.
export function stripPastedHeadingRow(text, titles) {
  const lines = text.split(/\r?\n/);
  const first = lines[0].split("\t").map(c => c.trim().toLowerCase());
  // one lone word on a single line could be a real value: only strip with 2+ cells or more lines under it
  if (first.length < 2 && lines.filter(l => l.length).length < 2) return null;
  const t = titles.map(x => x.toLowerCase());
  for (let start = 0; start + first.length <= t.length; start++) {
    if (first.every((c, i) => c === t[start + i])) return lines.slice(1).join("\n");
  }
  return null;
}
