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
 *   Unincorporated DeSoto County, 2026 — the CURRENT ordinance on the county's site, signed 3/17/2026 (desotocountyms.gov DocumentCenter/View/10775), Sec. 402-407 headings, read by the
 *     dispatching chat 2026-11-03 THROUGH A TEXT EXTRACT (Section 400's own list did not come through — the headings below are what was read; the absence of RO and C-R from it is probable,
 *     not proven). It RENAMES PO "Planned Office", PB / P-B "Planned Business Park" and R-40 "Residential Single-Family (Low Density or Transition Density)", and adds CO "Office" and C4
 *     "Planned Commercial"; those entries are sourced to it (`co26`). R-30 keeps its 2024 name until its 2026 heading is confirmed. C-R and RO are NOT in the 2026 text: they keep their
 *     2024 names (older polygons can still carry them — the layer's ORDINANCE field says which version governs a polygon). The 2026 text also has I-69/I-269 overlay headings (DS Delta Sector,
 *     NWS Newtown West Sector, Hernando/I-55 Sector, ECS Eastern Corridor Sector, RCS/RCOS River Corridors Sector) — none is a code in the layer's data today, so none is entered.
 * One remaining version risk: Olive Branch published a May 2024 draft rewrite with a different district structure — re-check an Olive Branch name against the ordinance version that governs a
 * polygon if it is adopted.
 *   Southaven — Code of Ordinances, Title XIII Zoning Regulations, Chapter 12 District Regulations, Charts 3 and 4 and Secs. 13-12(b)-(m), library.municode.com/ms/southaven
 *     (read by the dispatching chat 2026-11-03; the build sandbox cannot reach it). Left bare ON PURPOSE: C-2 (Ch. 12 has no definition for it, only a row in a dimensions chart) and the
 *     codes the data carries that the chart does not list (ER, PO, RM-6, the "… OVERLAY" values). "RO" is Southaven's "Residential Office" (the chart writes R-O and RO); in the
 *     unincorporated county "RO" is "Residential Overlay" — which is why names are keyed by jurisdiction.
 *   Horn Lake — Code of Ordinances, Appendix A Zoning, Art. III Sec. A (library.municode.com/ms/horn_lake, nodeId COOR_APXAZO_ARTIIIESZODIPROFZOMA), read on Municode by the dispatching chat
 *     2026-11-03: TWENTY districts. The ordinance writes C1, C3, C4, M1, M2 and AR WITHOUT a hyphen; the county's data writes C-1, A-R… — BOTH spellings are keys. Horn Lake's R-6 is
 *     "Residential (High Density)" where the county and Hernando say Medium — which is why names are never borrowed across governments. It has NO C-2 in this list: a C-2 stays bare.
 *   Hernando — Code of Ordinances, Appendix B Zoning, Art. III Districts and Boundaries ("divided into twenty-four districts"), library.municode.com/ms/hernando (nodeId COOR_APXBZO), read the same
 *     way. Version risk: Municode lists an UNCODIFIED "Ordinance of 05-19-2026(1)" amending various sections of the zoning ordinance and one of 08-04-2026 amending the downtown overlay —
 *     NEITHER WAS READ; re-check a Hernando name against them. Hernando's data also carries C-4 (22 polygons) and the words "HISTORIC DISTRICT OVERLAY" / "MAIN STREET DISTRICT", which are not
 *     among the twenty-four (H-1 is "Historic Overlay"): they stay as written.
 *   Walls — NO primary source exists online (the town's Codes & Ordinances page is empty and Municode has no Walls code): its codes stay bare.
 *
 * NOT-IN-ORDINANCE RECORD (B2589345's stopping rule — each of these stays bare ON PURPOSE, measured against the live data 2026-11-03):
 *   Olive Branch: PB, R-8, R-15 OVERLAY, R-20, R-30 (and R-40, the "… OVERLAY" values) · Southaven: C-2, ER, PO, RM-6, CM OVERLAY, R-6 OVERLAY, R-15 OVERLAY · Hernando: C-4, the words
 *   "HISTORIC DISTRICT OVERLAY" and "MAIN STREET DISTRICT", the "… OVERLAY" values · Horn Lake: C-2 (if it ever appears), the "… OVERLAY" values other than F, "HISTORIC DISTRICT OVERLAY" ·
 *   unincorporated county: R-20 OVERLAY, R-30 OVERLAY, A-R OVERLAY, "PUD OVERLAY" (not in the 2024 or the 2026 ordinance) · Walls: everything.
 *
 * Pure: no network, no React. */

const OB_SRC = "https://library.municode.com/ms/olive_branch";
const CO_SRC = "https://www.desotocountyms.gov/DocumentCenter/View/8541";
const CO26_SRC = "https://www.desotocountyms.gov/DocumentCenter/View/10775/Desoto-County-Zoning-Ordinance--Current-signed-3172026";
const SH_SRC = "https://library.municode.com/ms/southaven/codes/code_of_ordinances?nodeId=CO_TITXIIIZORE_CH12DIRE";
const HL_SRC = "https://library.municode.com/ms/horn_lake/codes/code_of_ordinances?nodeId=COOR_APXAZO_ARTIIIESZODIPROFZOMA";
const HE_SRC = "https://library.municode.com/ms/hernando/codes/code_of_ordinances?nodeId=COOR_APXBZO";
const ob = (name) => ({ name, source: OB_SRC });
const co = (name) => ({ name, source: CO_SRC });
const co26 = (name) => ({ name, source: CO26_SRC });
const sh = (name) => ({ name, source: SH_SRC });
const hl = (name) => ({ name, source: HL_SRC });
const he = (name) => ({ name, source: HE_SRC });

/* The ordinance behind each jurisdiction's names — shown behind the (i). */
export const ZONING_CITATIONS = {
  "Olive Branch": "Olive Branch Code of Ordinances, Appendix A Zoning Ordinance, Art. III Districts and Boundaries (library.municode.com/ms/olive_branch)",
  "Unincorporated DeSoto County": "DeSoto County Zoning Ordinance signed 3/17/2026, Sec. 402-407 (desotocountyms.gov, Document Center item 10775) for PO, PB, CO, C4 and R-40; the 2024 ordinance (current as of 3-8-2024), Art. III Sec. 1, with C-4 from Art. IX (item 8541), for the rest — C-R and RO are only in the 2024 text",
  "Horn Lake": "Horn Lake Code of Ordinances, Appendix A Zoning, Art. III Sec. A (library.municode.com/ms/horn_lake)",
  Hernando: "Hernando Code of Ordinances, Appendix B Zoning, Art. III Districts and Boundaries (library.municode.com/ms/hernando); two 2026 amending ordinances are not read",
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
    "R-40": co26("Residential Single-Family (Low Density or Transition Density)"), "R-30": co("Residential Single-Family (Low Density)"), "R-20": co("Residential Single-Family (Low Density)"), "R-15": co("Residential Single-Family (Low Density)"),
    "R-12": co("Residential Single-Family (Medium Density)"), "R-10": co("Residential Single-Family (Medium Density)"), "R-8": co("Residential Single-Family (Medium Density)"), "R-6": co("Residential Single-Family (Medium Density)"),
    "RM-8": co("Multiple-Family Residential (High Density)"), "RM-6": co("Multiple-Family Residential (High Density)"),
    "C-R": co("Rural Commercial"), "C-1": co("Neighborhood Commercial"), "C-2": co("Highway Commercial"), "C-3": co("General Commercial"), "C-4": co("Planned Commercial"),
    O: co("Office"), CO: co26("Office"), C4: co26("Planned Commercial"), "M-1": co("Light Industrial"), "M-2": co("Heavy Industrial"),
    PO: co26("Planned Office"), PB: co26("Planned Business Park"), "P-B": co26("Planned Business Park"), RO: co("Residential Overlay"), PUD: co("Planned Unit Development"),
    F: co("Flood Control"), AHR: co("Airport Height Use Regulation"),
  },
  Hernando: {
    A: he("Agricultural"), "A-R": he("Agricultural-Residential"),
    "R-40": he("Residential Single-Family (Low Density)"), "R-30": he("Residential Single-Family (Low Density)"), "R-20": he("Residential Single-Family (Low Density)"), "R-15": he("Residential Single-Family (Low Density)"),
    "R-12": he("Residential Single-Family (Medium Density)"), "R-10": he("Residential Single-Family (Medium Density)"), "R-8": he("Residential Single-Family (Medium Density)"), "R-6": he("Residential Single-Family (Medium Density)"),
    "RM-8": he("Multiple-Family Residential (High Density)"), "RM-6": he("Multiple-Family Residential (High Density)"),
    "C-1": he("Neighborhood Commercial"), "C-2": he("Highway Commercial"), "C-3": he("General Commercial"),
    O: he("Office"), "M-1": he("Light Industrial"), "M-2": he("Heavy Industrial"),
    PO: he("Planned Corporate Office Park"), PB: he("Planned Business"), PUD: he("Planned Unit Development"),
    EO: he("Environmental Overlay"), "H-1": he("Historic Overlay"), TND: he("Traditional Neighborhood Development"),
  },
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
  /* Horn Lake writes C1, C3, C4, M1, M2 and AR with no hyphen in its ordinance; the layer's data writes them with one — both spellings are keys (twenty districts in all). */
  "Horn Lake": {
    AR: hl("Agricultural-Residential"), "A-R": hl("Agricultural-Residential"),
    "R-30": hl("Residential (Low Density)"), "R-20": hl("Residential (Low Density)"), "R-15": hl("Residential (Low Density)"),
    "R-12": hl("Residential (Medium Density)"), "R-10": hl("Residential (Medium Density)"), "R-9": hl("Residential (Medium Density)"), "R-8": hl("Residential (Medium Density)"),
    "R-6": hl("Residential (High Density)"),
    "RM-6": hl("Multi-Family Residential"),
    O: hl("Office"),
    C1: hl("Neighborhood Commercial"), "C-1": hl("Neighborhood Commercial"), C3: hl("General Commercial"), "C-3": hl("General Commercial"), C4: hl("Planned Commercial"), "C-4": hl("Planned Commercial"),
    M1: hl("Light Industrial"), "M-1": hl("Light Industrial"), M2: hl("Heavy Industrial"), "M-2": hl("Heavy Industrial"),
    PUD: hl("Planned Unit Development"), PBP: hl("Planned Business Park"),
    F: hl("Flood Control Overlay District"), OTC: hl("Old Town Center District"),
  },
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
