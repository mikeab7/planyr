/* DeSoto County MS zoning — THE DISTRICT NAME behind a zone code (B2507063 / NEW-8, owner constraint #46).
 *
 * Owner: "how does someone know what M-1 means?" A code is shown with its district NAME wherever a user sees it (the click card; the legend in the Zoning dropdown).
 * The rules are the owner's:
 *   • names come from each JURISDICTION'S OWN ORDINANCE — never from memory. The same code can mean different things in different governments (C-4 and M-3 exist
 *     in only one of these lists; R-1…R-4 are Olive Branch's), so names are keyed by jurisdiction — the city limits the polygon falls in, or "Unincorporated DeSoto
 *     County" (desotoJurisdiction.js);
 *   • a code that is in NEITHER list for its jurisdiction (ER, PBP, CM OVERLAY, an "R-15 OVERLAY" value, or a code outside its own jurisdiction's list) shows the CODE
 *     AS WRITTEN — no invented name, no class word standing in for one. A value that is already WORDS ("MAIN STREET DISTRICT") is shown title-cased;
 *   • the on-map labels stay codes; the name belongs in the card and the legend; the ordinance behind them is cited behind the (i) (`ZONING_CITATIONS`, repeated in
 *     desotoLayers' zoning vintage line).
 *
 * SOURCES (read from the ordinances by the dispatching chat, 2026-10-29 — the build sandbox cannot reach either host):
 *   Olive Branch — Code of Ordinances, Appendix A Zoning Ordinance, Art. III Districts and Boundaries ("divided into 16 districts"), library.municode.com/ms/olive_branch.
 *     The ordinance writes the agricultural-residential district AR; the county's data writes it A-R (both keys are here).
 *   Unincorporated DeSoto County — DeSoto County Zoning Ordinance, current as of 3-8-2024, Art. III Sec. 1 (C-4 Planned Commercial is in Art. IX, missing from the
 *     Art. III list), desotocountyms.gov DocumentCenter/View/8541.
 * Two version risks to keep in mind: the county has a newer ordinance signed 3/17/2026, and Olive Branch published a May 2024 draft rewrite with a different district
 * structure — re-check a name against the ordinance version that governs a polygon (its ORDINANCE field says which) if either is adopted.
 * Hernando, Southaven, Horn Lake and Walls are NOT sourced: their codes show as written.
 *
 * Pure: no network, no React. */

const OB_SRC = "https://library.municode.com/ms/olive_branch";
const CO_SRC = "https://www.desotocountyms.gov/DocumentCenter/View/8541";
const ob = (name) => ({ name, source: OB_SRC });
const co = (name) => ({ name, source: CO_SRC });

/* The ordinance behind each jurisdiction's names — shown behind the (i). */
export const ZONING_CITATIONS = {
  "Olive Branch": "Olive Branch Code of Ordinances, Appendix A Zoning Ordinance, Art. III Districts and Boundaries (library.municode.com/ms/olive_branch)",
  "Unincorporated DeSoto County": "DeSoto County Zoning Ordinance (current as of 3-8-2024), Art. III Sec. 1; C-4 from Art. IX (desotocountyms.gov, Document Center item 8541)",
};

/* { [jurisdiction]: { [ZONE code, upper-case]: { name, source } } } */
export const ZONING_NAMES = {
  "Olive Branch": {
    A: ob("Agricultural"), "A-R": ob("Agricultural-Residential"), AR: ob("Agricultural-Residential"),
    "R-1": ob("Single-Family Residential"), "R-2": ob("Single-Family Residential"), "R-3": ob("Planned Residential"), "R-4": ob("Multiple-Family Residential"),
    O: ob("Office"),
    "C-1": ob("Neighborhood Commercial"), "C-2": ob("Highway Commercial"), "C-3": ob("General Commercial"), "C-4": ob("Planned Commercial"), "C-5": ob("Old Towne District"),
    "M-1": ob("Light Industrial"), "M-2": ob("Heavy Industrial"), "M-3": ob("Planned Industrial District (PID)"),
    PUD: ob("Planned Unit Development"),
  },
  "Unincorporated DeSoto County": {
    A: co("Agricultural"), "A-R": co("Agricultural-Residential"),
    "R-40": co("Residential Single-Family (Low Density)"), "R-30": co("Residential Single-Family (Low Density)"), "R-20": co("Residential Single-Family (Low Density)"), "R-15": co("Residential Single-Family (Low Density)"),
    "R-12": co("Residential Single-Family (Medium Density)"), "R-10": co("Residential Single-Family (Medium Density)"), "R-8": co("Residential Single-Family (Medium Density)"), "R-6": co("Residential Single-Family (Medium Density)"),
    "RM-8": co("Multiple-Family Residential (High Density)"), "RM-6": co("Multiple-Family Residential (High Density)"),
    "C-R": co("Rural Commercial"), "C-1": co("Neighborhood Commercial"), "C-2": co("Highway Commercial"), "C-3": co("General Commercial"), "C-4": co("Planned Commercial"),
    O: co("Office"), "M-1": co("Light Industrial"), "M-2": co("Heavy Industrial"),
    PO: co("Planned Office Park"), PB: co("Planned Business"), RO: co("Residential Overlay"), PUD: co("Planned Unit Development"),
    F: co("Flood Control"), AHR: co("Airport Height Use Regulation"),
  },
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

/* A value that is ALREADY WORDS ("MAIN STREET DISTRICT", "HISTORIC DISTRICT OVERLAY": two or more all-letter words of three or more letters) is shown title-cased; a code
 * ("ER", "PBP", "CM OVERLAY", "R-15 OVERLAY") is shown exactly as written. */
export function displayCode(code) {
  const c = String(code == null ? "" : code).trim();
  if (/^[A-Za-z]{3,}(\s+[A-Za-z]{3,})+$/.test(c)) return c.toLowerCase().replace(/\b[a-z]/g, (m) => m.toUpperCase());
  return c;
}

/* "M-1 · Light Industrial" when a name is sourced, else the code as written (or the words, title-cased). */
export const zoneWithName = (code, jurisdiction, table) => {
  const c = displayCode(code);
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
    const shown = displayCode(e.code);
    const base = name ? `${shown} · ${name}` : shown;
    return { label: clash && e.jurisdiction ? `${base} (${e.jurisdiction})` : base, color: e.color };
  });
}
