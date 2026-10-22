/* The parcel-gap rows in docs/STATEWIDE-PARCELS.md, read as data — for the TEST that keeps the doc and
 * `site-planner/lib/parcelGaps.js` in agreement (test/parcelGapsDoc.test.js), and for nothing at runtime.
 *
 * WHY A PARSER AND NOT A GENERATED COLUMN. Every state's section was written by a different session in a different shape
 * (a "Kind" column, a "Status" column, comma-joined county lists, a prose paragraph), and they carry research findings that
 * are not ours to regenerate. So the doc stays the research record and the table is the runtime truth; this module reads the
 * doc's gap rows back so a test can fail the build when the two disagree (a gap row with no table entry, a doc "login-required"
 * row the table calls "none", a table entry for a county the doc now says is wired).
 *
 * Pure Node, no deps. `readParcelGapRows(text)` → [{ state, county, kind, source }]. `county` is the bare name with its
 * designation stripped ("Pike", "Ste. Genevieve", "Pointe Coupee"). */

/* One entry per doc table that lists NOT-wired counties. `heading` matches the nearest preceding #/##/### line; `pick` decides
 * which table (by its header cells) and which rows count. `kindCol` names the column whose text says WHY (kept as `kind`). */
export const GAP_SOURCES = [
  { state: "KY", heading: /^### Kentucky gaps/, kindCol: "Status" },
  { state: "GA", heading: /^## Georgia counties \(2026-10-19\)/, kindCol: "Status", rowOk: (kind) => /^gap/.test(kind) },
  { state: "IA", heading: /^## Iowa counties \(2026-10-19\)/, kindCol: "Status", rowOk: (kind) => /^gap/.test(kind) },
  { state: "MI", heading: /^### Not wired \(29\)/, kindCol: "Kind" },
  { state: "MO", heading: /^### Missouri gaps/, kindCol: "Kind" },
  { state: "WA", heading: /^### Washington gaps/, kindCol: "Kind" },
  { state: "OR", heading: /^## Oregon counties \(2026-10-19\)/, kindCol: "Status", rowOk: (kind) => /^gap/.test(kind) },
  { state: "OK", heading: /^### Gaps \(61\)/, kindCol: "Kind" },
  { state: "KS", heading: /^### Gaps — the /, kindCol: "Kind" },
  { state: "IL", heading: /^### The 36 named gaps/, kindCol: "Kind" },
  { state: "LA", heading: /^### The 26 parishes still named gaps/, kindCol: null },
  { state: "ID", heading: /^## Idaho counties \(2026-10-19\)/, kindCol: null, headerHas: "Why it is not wired", onlyPlainNames: true },
  { state: "NY", heading: /^## New York counties \(2026-10-20\)/, kindCol: null, rowOk: (_k, cells) => /named gap/.test(cells.join(" ")) },
  { state: "TN", heading: /^## Tennessee non-state counties/, kindCol: "Outcome", rowOk: (kind) => /^named gap/.test(kind) },
];

const clean = (s) => String(s || "").replace(/\*\*/g, "").replace(/`/g, "").trim();
const cells = (line) => line.split("|").slice(1, -1).map((c) => c.trim());

/* "Pike County" → "Pike"; "Jackson*" → "Jackson"; "Lemhi (also)" → "Lemhi". */
function bareName(raw) {
  return clean(raw).replace(/\*/g, "").replace(/\s*\(also\)\s*/i, "").replace(/\s+(County|Parish)$/i, "").trim();
}

export function readParcelGapRows(text) {
  const lines = String(text).split("\n");
  const rows = [];
  let heading = "";
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    if (/^#{1,3} /.test(line)) heading = line;
    if (!/^\|[- |:]+\|$/.test(line) || n === 0) continue;
    const src = GAP_SOURCES.find((s) => s.heading.test(heading));
    if (!src) continue;
    const hdr = cells(lines[n - 1]).map(clean);
    if (src.headerHas && !hdr.some((h) => h.includes(src.headerHas))) continue;
    const kindIdx = src.kindCol ? hdr.indexOf(src.kindCol) : -1;
    if (src.kindCol && kindIdx < 0) continue; // another table under the same heading
    for (let k = n + 1; k < lines.length && lines[k].startsWith("|"); k++) {
      const c = cells(lines[k]);
      const kind = kindIdx >= 0 ? clean(c[kindIdx]).toLowerCase() : "";
      if (src.rowOk && !src.rowOk(kind, c)) continue;
      let names;
      if (src.state === "LA") names = clean(c[0]).split(" · ");
      else if (src.onlyPlainNames) {
        const parts = clean(c[0]).split(",").map((s) => s.trim());
        if (!parts.every((p) => /^[A-Z][a-z]+( [A-Z][a-z]+)?( \(also\))?$/.test(p) && p !== "Statewide")) continue; // "Statewide", "All 8 ISTC counties + …"
        names = parts;
      } else names = [c[0]];
      for (const nm of names) {
        const county = bareName(nm);
        if (county) rows.push({ state: src.state, county, kind: kind || (src.state === "LA" ? "named gap" : "gap"), source: heading.replace(/^#+\s*/, "").slice(0, 70) });
      }
    }
  }
  // Idaho lists Lemhi twice (a 403 row and an unreachable "(also)" row) — one county, one row.
  const seen = new Set();
  return rows.filter((r) => { const key = `${r.state}|${r.county.toLowerCase()}`; if (seen.has(key)) return false; seen.add(key); return true; });
}
