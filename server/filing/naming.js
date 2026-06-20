/* Auto-name a filed document (B270) — pure, dependency-free.
 *
 * MIRRORS the canonical client convention in
 * src/workspaces/doc-review/lib/reviewStore.js (`composeTitle` / `fmtDocDate`):
 *   "<Project> - <Item> - YYYY.MM.DD"
 * The server returns this as a *suggested* name on the filing decision; the actual filed
 * record is still written client-side through reviewStore.composeTitle, so the two agree by
 * construction. Kept here (rather than imported) because /server is walled off from the
 * frontend bundle and must stay self-contained (same precedent as fitToBoundary.js carrying
 * its own Procrustes rather than importing the workspace copy).
 */
const pad = (n) => String(n).padStart(2, "0");

// Format a date as YYYY.MM.DD. Accepts an ISO string, a Date, or a timestamp; "" when
// unparseable (so a missing date drops cleanly out of the composed name).
export function fmtDocDate(d) {
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d)) {
    const [y, m, day] = d.slice(0, 10).split("-");
    return `${y}.${m}.${day}`;
  }
  const dt = d ? new Date(d) : new Date();
  if (isNaN(dt)) return "";
  return `${dt.getFullYear()}.${pad(dt.getMonth() + 1)}.${pad(dt.getDate())}`;
}

// "<Project> - <Item> - YYYY.MM.DD". Pieces that are empty drop out; an all-empty head
// falls back to "Untitled" (never an empty or dangling-separator name).
export function composeFiledName({ project, item, docDate } = {}) {
  const head = [project, item].map((s) => (s || "").toString().trim()).filter(Boolean).join(" - ") || "Untitled";
  const date = fmtDocDate(docDate);
  return date ? `${head} - ${date}` : head;
}
