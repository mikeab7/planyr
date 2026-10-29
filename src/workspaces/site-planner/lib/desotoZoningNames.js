/* DeSoto County MS zoning — THE DISTRICT NAME behind a zone code (B2507063 / NEW-8, owner constraint #46).
 *
 * Owner: "how does someone know what M-1 means?" A code is shown with its district NAME wherever a user sees it (the click card; the legend in the Zoning dropdown).
 * The rules are the owner's, and they are why this file is mostly EMPTY today:
 *   • names come from each JURISDICTION'S OWN ORDINANCE — never from memory. Olive Branch: library.municode.com/ms/olive_branch/codes (its Unified Development
 *     Code); unincorporated DeSoto County: the county zoning ordinance (desotocountyms.gov, Planning). The same code can mean different things in different
 *     governments, so names are keyed by jurisdiction (the city limits the polygon falls in, or "Unincorporated DeSoto County" — desotoJurisdiction.js);
 *   • a code that cannot be sourced shows the BARE CODE — never a guess, never a class word ("commercial") standing in for a name;
 *   • the on-map labels stay codes; the name belongs in the card and the legend.
 *
 * ⛔ STATE OF THE TABLE (measured 2026-10-29): EMPTY, because every ordinance host is unreachable from the build sandbox (library.municode.com, api.municode.com,
 * www.desotocountyms.gov, olivebranchms.gov all refuse the proxy tunnel; web search returns summaries, not the ordinance text), and the zoning layer itself carries
 * no names (its legend labels equal the codes; no coded-value domain). Search summaries suggested names (e.g. "M-1 Light Industrial") that are NOT quoted from an
 * ordinance and so are NOT here. To fill the table: pull the district list from each ordinance, then add `"<code>": { name, source }` under the jurisdiction —
 * `source` is the ordinance section URL, and `test/desotoZoningNames.test.js` fails an entry without one. Two version risks to read first: the layer's county link is
 * the 3-8-2024 ordinance (a newer one is signed 3/17/2026), and Olive Branch published a May 2024 draft rewrite with a different district structure — name a code
 * only from the ordinance version that governs the polygon (its ORDINANCE field says which).
 *
 * Pure: no network, no React. */

/* { [jurisdiction]: { [ZONE code, upper-case]: { name, source } } } */
export const ZONING_NAMES = {
  "Olive Branch": {},
  "Unincorporated DeSoto County": {},
  Hernando: {},
  Southaven: {},
  "Horn Lake": {},
  Walls: {},
};

const norm = (code) => String(code == null ? "" : code).trim().toUpperCase();

/* The sourced district name for `code` in `jurisdiction`, or null (→ show the bare code). `table` is injectable for tests. */
export function zoneName(code, jurisdiction, table = ZONING_NAMES) {
  const j = table && jurisdiction ? table[jurisdiction] : null;
  const e = j ? j[norm(code)] : null;
  return e && e.name ? String(e.name) : null;
}

/* "M-1 · Light Industrial" when a name is sourced, else the bare "M-1". */
export const zoneWithName = (code, jurisdiction, table) => {
  const c = String(code == null ? "" : code).trim();
  const n = zoneName(c, jurisdiction, table);
  return n ? `${c} · ${n}` : c;
};

/* The legend for the zones in view: one entry per (jurisdiction, code), grouped by jurisdiction, sorted. `items` = [{ code, jurisdiction|null, color }].
 * Entries from a jurisdiction that is not known yet (limits still loading) are listed by code alone. When more than one jurisdiction is in view the label carries
 * the jurisdiction only if the SAME code appears in both (so "C-2" in two governments is never merged into one line). Pure. */
export function zoningLegend(items, table = ZONING_NAMES) {
  const seen = new Map();
  for (const it of items || []) {
    const code = String(it && it.code != null ? it.code : "").trim();
    if (!code) continue;
    const j = it.jurisdiction || null;
    const key = `${j || ""}|${norm(code)}`;
    if (!seen.has(key)) seen.set(key, { code, jurisdiction: j, color: it.color });
  }
  const list = [...seen.values()];
  const jurisdictionsByCode = new Map();
  for (const e of list) { const k = norm(e.code); const s = jurisdictionsByCode.get(k) || new Set(); s.add(e.jurisdiction || ""); jurisdictionsByCode.set(k, s); }
  list.sort((a, b) => String(a.jurisdiction || "").localeCompare(String(b.jurisdiction || "")) || a.code.localeCompare(b.code, undefined, { numeric: true }));
  return list.map((e) => {
    const name = zoneName(e.code, e.jurisdiction, table);
    const clash = (jurisdictionsByCode.get(norm(e.code)) || new Set()).size > 1;
    const base = name ? `${e.code} · ${name}` : e.code;
    return { label: clash && e.jurisdiction ? `${base} (${e.jurisdiction})` : base, color: e.color };
  });
}
