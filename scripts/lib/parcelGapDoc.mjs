/* The parcel-gap rows in docs/STATEWIDE-PARCELS.md, read as data — for the TEST that keeps the doc and
 * `site-planner/lib/parcelGaps.js` in agreement (test/parcelGapsDoc.test.js), and for nothing at runtime.
 *
 * WHY A PARSER AND NOT A GENERATED COLUMN. Every state's section was written by a different session in a different shape
 * (a "Kind" column, a "Status" column, comma-joined county lists, a prose paragraph), and they carry research findings that
 * are not ours to regenerate. So the doc stays the research record and the table is the runtime truth; this module reads the
 * doc's gap rows back so a test can fail the build when the two disagree (a gap row with no table entry, a doc "login-required"
 * row the table calls "none", a table entry for a county the doc now says is wired).
 *
 * Pure Node, no deps. `readParcelGapRows(text)` → [{ state, county, kind, source, text, line }] (`text` = the whole row, `line` = its 0-based line in the doc). `county` is the bare name with its
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
  { state: "IL", heading: /^### The \d+ named gaps/, kindCol: "Kind" },
  { state: "LA", heading: /^### The 26 parishes still named gaps/, kindCol: null },
  { state: "ID", heading: /^## Idaho counties \(2026-10-19\)/, kindCol: null, headerHas: "Why it is not wired", onlyPlainNames: true },
  { state: "NY", heading: /^## New York counties \(2026-10-20\)/, kindCol: null, rowOk: (_k, cells) => /named gap/.test(cells.join(" ")) },
  { state: "TN", heading: /^## Tennessee non-state counties/, kindCol: "Outcome", rowOk: (kind) => /^named gap/.test(kind) },
  // NEW-1 (B2486192): South Dakota's 49 researched gaps were never read because this list had no entry for it — the table
  // marks them "— (named gap)" in the Key column, the same shape New York's section uses.
  { state: "SD", heading: /^## South Dakota counties \(2026-10-19\)/, kindCol: null, rowOk: (_k, cells) => /named gap/.test(cells.join(" ")) },
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
        if (county) rows.push({ state: src.state, county, kind: kind || (src.state === "LA" ? "named gap" : "gap"), source: heading.replace(/^#+\s*/, "").slice(0, 70), text: clean(c.join(" ")), line: k });
      }
    }
  }
  // Idaho lists Lemhi twice (a 403 row and an unreachable "(also)" row) — one county, one row.
  const seen = new Set();
  return rows.filter((r) => { const key = `${r.state}|${r.county.toLowerCase()}`; if (seen.has(key)) return false; seen.add(key); return true; });
}

/* ── Agreement helpers (NEW-1, B2486192) ──────────────────────────────────────────────────────────────────────────────────
 * WHY SOUTH DAKOTA SLIPPED THROUGH: the parser was fine — `GAP_SOURCES` simply had no entry for SD, so the doc's 49 "— (named gap)"
 * rows were never read, and the test's per-state count expectation (a hand-pinned object) never named SD either. Three guards
 * now close that door, from three directions: (1) this scan finds a gap-looking doc row under a heading no GAP_SOURCES entry
 * claims; (2) `missingFromTable` is the doc→table comparison as a pure function so a red-proof can feed it a doc with a county
 * the table lacks; (3) test/parcelGapsCoverage.test.js ignores the doc entirely and joins the live registry to the county
 * polygons. */

/* A row that SAYS it is a gap in one of the shapes the state sections use. Deliberately tight: a loose "gap" match would flag every
 * historical session note. */
export const GAP_ROW_SIGNATURE = /\(named gap\)|\*\*gap\*\*|\*\*no source wired\*\*|no parcel data wired here yet/i;

/* Sections that repeat a gap sentence for a county another section already carries (so a second copy is not a second source).
 * Each entry says WHY. A section here is never scanned; add one only with a reason. */
export const GAP_SCAN_EXEMPT = [
  { heading: /^### The 95-county table/, why: "Tennessee's sweep table repeats Knox's gap sentence; Knox is the one TN gap row, carried by the TN non-state section" },
];

/* → [{ heading, count }] for every heading that holds gap-looking rows but is not claimed by a GAP_SOURCES entry or exempted. */
export function gapRowsOutsideGapSources(text, sources = GAP_SOURCES, exempt = GAP_SCAN_EXEMPT) {
  const found = new Map();
  let heading = "";
  for (const line of String(text).split("\n")) {
    if (/^#{1,3} /.test(line)) heading = line;
    if (!line.startsWith("|") || !GAP_ROW_SIGNATURE.test(line)) continue;
    if (sources.some((s) => s.heading.test(heading)) || exempt.some((e) => e.heading.test(heading))) continue;
    found.set(heading, (found.get(heading) || 0) + 1);
  }
  return [...found].map(([heading, count]) => ({ heading: heading.replace(/^#+\s*/, ""), count }));
}

/* The doc→table comparison: every doc gap row needs an explicit table entry (even `none` is a decision, not an omission). */
export function missingFromTable(rows, table, keyOf) {
  return rows.filter((r) => !table[keyOf(r.county, r.state)]).map((r) => `${r.state} ${r.county}`);
}

/* The Schneider (Beacon / qPublic) access measurement, recorded on a doc row as plain text (NEW-2, B2486193), and the table
 * reason each means. The doc row and the table entry must agree both ways (test/parcelGapsDoc.test.js). */
export const SCHNEIDER_MARKERS = [
  { text: "Schneider map subscriber-only (2026-10-29)", reason: "paywall" },
  { text: "Schneider map public, parcel feed private (2026-10-29)", reason: "locked" },
];
export const schneiderReasonOfRow = (rowText) => (SCHNEIDER_MARKERS.find((m) => String(rowText).includes(m.text)) || {}).reason || null;
