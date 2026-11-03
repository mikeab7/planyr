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
 *   Southaven — Code of Ordinances, Title XIII Zoning Regulations, Chapter 12 District Regulations, Charts 3 and 4 and Secs. 13-12(b)-(m), library.municode.com/ms/southaven
 *     (read by the dispatching chat 2026-11-03; the build sandbox cannot reach it). Left bare ON PURPOSE: C-2 (Ch. 12 has no definition for it, only a row in a dimensions chart) and the
 *     codes the data carries that the chart does not list (ER, PO, RM-6, the "… OVERLAY" values). "RO" is Southaven's "Residential Office" (the chart writes R-O and RO); in the
 *     unincorporated county "RO" is "Residential Overlay" — which is why names are keyed by jurisdiction.
 * Hernando, Horn Lake and Walls are NOT sourced (their ordinances could not be read — municode / the cities' sites are outside the sandbox's network): their codes show as written.
 *
 * Pure: no network, no React. */

const OB_SRC = "https://library.municode.com/ms/olive_branch";
const CO_SRC = "https://www.desotocountyms.gov/DocumentCenter/View/8541";
const SH_SRC = "https://library.municode.com/ms/southaven/codes/code_of_ordinances?nodeId=CO_TITXIIIZORE_CH12DIRE";
const ob = (name) => ({ name, source: OB_SRC });
const co = (name) => ({ name, source: CO_SRC });
const sh = (name) => ({ name, source: SH_SRC });

/* The ordinance behind each jurisdiction's names — shown behind the (i). */
export const ZONING_CITATIONS = {
  "Olive Branch": "Olive Branch Code of Ordinances, Appendix A Zoning Ordinance, Art. III Districts and Boundaries (library.municode.com/ms/olive_branch)",
  "Unincorporated DeSoto County": "DeSoto County Zoning Ordinance (current as of 3-8-2024), Art. III Sec. 1; C-4 from Art. IX (desotocountyms.gov, Document Center item 8541)",
  Southaven: "Southaven Code of Ordinances, Title XIII Zoning Regulations, Ch. 12 District Regulations, Charts 3 and 4 and Secs. 13-12(b)-(m) (library.municode.com/ms/southaven)",
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
  Southaven: {
    A: sh("Agricultural"), "A/ER": sh("Agricultural/Estate Residential"),
    "R-30": sh("Single-Family Residential"), "R-20": sh("Single-Family Residential"), "R-15": sh("Single-Family Residential"), "R-12": sh("Single-Family Residential"),
    "R-10": sh("Single-Family Residential"), "R-9": sh("Single-Family Residential"), "R-8": sh("Single-Family Residential"), "R-6": sh("Single-Family Residential"),
    "RM-8": sh("Multi-Family Residential"),
    O: sh("Office"), "R-O": sh("Residential Office"), RO: sh("Residential Office"),
    "C-1": sh("Neighborhood Commercial"), "C-3": sh("General Commercial"), "C-4": sh("Planned Commercial"), PBP: sh("Planned Business Park"),
    "M-1": sh("Light Industrial"), "M-2": sh("Heavy Industrial"),
    PUD: sh("Planned Unit Development"),
  },
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

/* The order the governments are listed in the legend: the cities first, the county last. A government not named here sorts after these, by name. */
const JURISDICTION_ORDER = ["Olive Branch", "Southaven", "Horn Lake", "Hernando", "Walls", "Unincorporated DeSoto County"];
const jurisdictionRank = (j) => { const i = JURISDICTION_ORDER.indexOf(j); return i < 0 ? JURISDICTION_ORDER.length : i; };

/* The legend for the zones in view, in the headed shape the Zoning dropdown renders (the same shape as Sugar Land's — owner constraint #50): for every government in view
 * ONE heading naming it ("Olive Branch", "Southaven", "Unincorporated DeSoto County"…), then ONE row per code, "R-20 · Residential Single-Family (Low Density)" — the
 * government is NEVER a suffix on a row, and a code that two governments share simply appears under each heading. `items` = [{ code, jurisdiction|null, color }]; duplicates
 * fold. Codes from a government not known yet (the city limits are still loading) are listed by code alone, with no heading, after the headed groups. Pure. */
export function zoningLegend(items, table = ZONING_NAMES) {
  const seen = new Map();
  for (const it of items || []) {
    const code = String(it && it.code != null ? it.code : "").trim();
    if (!code) continue;
    const j = it.jurisdiction || null;
    const key = `${j || ""}|${norm(code)}`;
    if (!seen.has(key)) seen.set(key, { code, jurisdiction: j, color: it.color });
  }
  const groups = new Map();
  for (const e of seen.values()) { const k = e.jurisdiction || ""; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
  const names = [...groups.keys()].filter(Boolean).sort((a, b) => jurisdictionRank(a) - jurisdictionRank(b) || a.localeCompare(b));
  if (groups.has("")) names.push("");
  const out = [];
  for (const j of names) {
    const rows = groups.get(j).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
    if (j) out.push({ heading: true, label: j });
    for (const e of rows) {
      const name = zoneName(e.code, e.jurisdiction, table);
      const shown = displayCode(e.code);
      out.push({ label: name ? `${shown} · ${name}` : shown, color: e.color, row: true });
    }
  }
  return out;
}
