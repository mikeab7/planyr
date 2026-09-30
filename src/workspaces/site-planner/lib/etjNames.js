/* NEW-1 (DFW ETJ) — ONE reader for "which cities does this ETJ feature name?".
 *
 * Leaf, pure, no imports. Both the identify path (`jurisdiction.js`) and the drawn layer
 * (`vectorLayers.js`) read a publisher's `CITY` column through this, so the name on the map and the
 * name the screening reports cannot disagree (the B176 one-source-of-truth invariant).
 *
 * WHY IT EXISTS. Denton County's ETJ table publishes a polygon for a strip BOTH cities claim as one
 * feature named "Denton/Cross Roads", and Collin County's carries "GraysonCo-Howe" / "HuntCo-
 * Greenville". Reading those raw would name a city that does not exist ("Denton/Cross Roads") and
 * hide the fact that TWO ETJ claims overlap there. An overlap is reported as both claims — never
 * resolved by picking one (Local Gov't Code ch. 42 apportions an overlap between the two cities;
 * that is a legal determination this app does not make).
 *
 * A row declares its rules as DATA — `nameSplit` (separator), `nameStrip` (regex SOURCES, applied to
 * each part), `titleCaseName`, `nameConst` — so another publisher is a registry row, never new code.
 */

const titleCase = (s) => String(s).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

/* Returns the ordered, de-duplicated list of city names one feature carries (possibly empty).
 * `raw` is the publisher's name column value; a row with no name column passes `null` and gets its
 * `nameConst`. Never invents a name: an empty or null answer with no constant is `[]`. */
export function etjNamesOf(row, raw) {
  if (!row) return [];
  let text = raw == null ? "" : String(raw).trim();
  if (!text) return row.nameConst ? [String(row.nameConst)] : [];
  const parts = row.nameSplit ? text.split(row.nameSplit) : [text];
  const strips = (row.nameStrip || []).map((s) => new RegExp(s, "i"));
  const out = [];
  for (let p of parts) {
    p = p.trim();
    for (const re of strips) p = p.replace(re, "").trim();
    if (!p) continue;
    if (row.titleCaseName) p = titleCase(p);
    if (!out.some((n) => n.toLowerCase() === p.toLowerCase())) out.push(p);
  }
  return out;
}
