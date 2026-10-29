/* Tennessee industrial due-diligence layers (B2521584) — the PURE click-card wording. No network, no React.
 *
 * Owner constraint #45: a layer's click card is CLEAN — plain labels, no raw field names, no empty or null rows, normal dates, a link as a short
 * labelled link (never a raw URL), the source / vintage behind the (i). Each builder takes one feature's attributes and returns
 * `{ title, rows: [{ label, text, href? }], note? }` — the shape `featureHoverAttach` hands the planner's identify card — or `null` when the
 * feature has nothing worth a card (the one-line tooltip wording then stands in). */

const clean = (v) => {
  const s = v == null ? "" : String(v).trim();
  return !s || /^(null|none|n\/?a|unknown|undetermined|0|-{1,2})$/i.test(s) ? "" : s;
};
const row = (label, text, href) => (clean(text) ? { label, text: clean(text), ...(href ? { href } : {}) } : null);
const rowsOf = (...rs) => rs.filter(Boolean);
const httpHref = (u) => (/^https?:\/\//i.test(String(u || "").trim()) ? String(u).trim() : null);

/* SHOUTED federal / state text → sentence-ish case, without butchering short acronyms or small words. */
const SMALL = new Set(["of", "and", "the", "at", "in", "on", "for"]);
const ACRONYM = new Set(["LLC", "LP", "INC", "TN", "MLGW", "WWTP", "STP", "PWSID"]);
export function titleCase(raw) {
  const s = clean(raw);
  if (!s || /[a-z]/.test(s)) return s;
  return s.split(/(\s+)/).map((tok, i) => {
    if (/^\s+$/.test(tok) || !tok) return tok;
    const bare = tok.replace(/[^A-Za-z]/g, "");
    if (ACRONYM.has(bare)) return tok;
    const lower = tok.toLowerCase();
    if (i > 0 && SMALL.has(lower)) return lower;
    return lower.replace(/(^|[\s'\-/.(])([a-z])/g, (_m, pre, c) => pre + c.toUpperCase());
  }).join("");
}

/* ---- TDEC drycleaners (DCERP) ---- */
export function drycleanerStatus(comments) {
  const c = clean(comments);
  if (/response\s+site/i.test(c)) return "TDEC has worked a release here (DCERP response site)";
  if (/registration\s+only/i.test(c)) return "On the DCERP list — registration only, no release work by TDEC";
  return null;
}
export function drycleanerCard(props) {
  const p = props || {};
  const name = titleCase(p.FACILITY_N) || "Drycleaner";
  return {
    title: `${name} — known drycleaner`,
    rows: rowsOf(
      row("Status", drycleanerStatus(p.COMMENTS)),
      row("Address", [titleCase(p.FACILITY_A), titleCase(p.CITY)].filter(Boolean).join(", ")),
      row("County", p.COUNTY_NAM),
      row("DCERP ID", p.DCERP_ID),
    ),
    note: "TDEC's Drycleaner Environmental Response Program list. Solvent (PCE) releases are the classic drycleaner contamination — a flag to pull TDEC's file for a Phase I, not a finding.",
  };
}

/* ---- TDEC MS4 permit areas ---- */
export function ms4Card(props) {
  const p = props || {};
  return {
    title: `${titleCase(p.NAME) || "MS4"} — stormwater permit area`,
    rows: rowsOf(row("Permit", p.PERMIT_NUM)),
    note: "Inside this area the permittee's own stormwater and post-construction rules apply on top of the state Construction General Permit — ask for its design manual and any stream-buffer requirement.",
  };
}

/* ---- TDEC 2026 water quality assessment (stream units) ---- */
export const ATTAINMENT_WORDS = Object.freeze({
  "Fully Supporting": "Fully supporting its uses",
  "Fully Supporting (Evaluated)": "Fully supporting its uses (evaluated, not monitored)",
  "Not Supporting": "Impaired — not supporting its uses",
  "Not Supporting (Evaluated)": "Impaired (evaluated, not monitored)",
  "Threatened": "Threatened — may soon be impaired",
  "Not Assessed": "Not assessed",
});
export const isImpairedAttainment = (v) => /^not supporting/i.test(clean(v));
export const isThreatenedAttainment = (v) => /^threatened/i.test(clean(v));
export function wqaCard(props) {
  const p = props || {};
  return {
    title: `${titleCase(p.ASSESSMENT_UNIT_NAME) || "Stream"} — water quality`,
    rows: rowsOf(
      row("Status (2026)", ATTAINMENT_WORDS[clean(p.ATTAINMENT)] || clean(p.ATTAINMENT)),
      row("Reach", p.LOCATION_DESCRIPTION),
      row("Watershed", p.NAME8),
    ),
    note: "TDEC's 2026 assessment. An impaired stream can carry tighter stormwater and buffer requirements — the cause (siltation, habitat alteration…) decides which; ask TDEC's Division of Water Resources.",
  };
}

/* ---- TDEC public water system service areas ---- */
const WATER_SOURCES = { SW: "Surface water", SWP: "Purchased surface water", GW: "Groundwater", GWP: "Purchased groundwater", GU: "Groundwater under the influence of surface water" };
const OWNER_TYPES = { L: "Local government / utility district", P: "Private", F: "Federal", S: "State", M: "Public/private", N: "Native American" };
export function pwsCard(props) {
  const p = props || {};
  const name = titleCase(p.MA_NAME) || "Public water system";
  const pop = Number(p.PL_POPL);
  return {
    title: `${name} — water service area`,
    rows: rowsOf(
      row("System ID", p.PWSID),
      row("Owner type", OWNER_TYPES[clean(p.OW_TYPE)] || null),
      Number.isFinite(pop) && pop > 0 ? { label: "Population served", text: pop.toLocaleString("en-US") } : null,
      row("Water source", WATER_SOURCES[clean(p.PL_PSRC).toUpperCase()] || null),
      httpHref(p.DWW_Link) ? { label: "TDEC record", text: "Drinking Water Watch", href: httpHref(p.DWW_Link) } : null,
    ),
    note: "The system's declared territory — NOT proof of a main at the property line. Ask the system for a will-serve letter and the nearest main size.",
  };
}

/* ---- TDEC Division of Natural Areas ---- */
export function snaCard(props) {
  const p = props || {};
  const ac = Number(p.CALC_ACRES);
  return {
    title: clean(p.SNA_NAME) || "State Natural Area",
    rows: rowsOf(
      Number.isFinite(ac) && ac > 0 ? { label: "Area", text: `${Math.round(ac).toLocaleString("en-US")} acres` } : null,
      httpHref(p.URL) ? { label: "TDEC page", text: "About this area", href: httpHref(p.URL) } : null,
    ),
    note: "Designated under the Natural Areas Preservation Act of 1971 and managed for the rare species and natural features it protects — a constraint on the land itself. Talk to TDEC's Division of Natural Areas before planning near it.",
  };
}
export function scenicCard(props) {
  const p = props || {};
  const mi = Number(p.GISMILES);
  return {
    title: titleCase(p.Site_name) || "State Scenic River",
    rows: rowsOf(
      row("River class", p.DESIGNATIO),
      Number.isFinite(mi) && mi > 0 ? { label: "Length", text: `${mi} miles` } : null,
      row("Reach", p.DESCRIPTIO),
    ),
    note: "Tennessee Scenic Rivers Act of 1968 designation. The river's management plan governs what is allowed in the corridor — ask TDEC's Division of Natural Areas.",
  };
}

/* ---- National registers read at Tennessee sites ---- */
export function critHabitatCard(props) {
  const p = props || {};
  return {
    title: clean(p.comname) || "Critical habitat",
    rows: rowsOf(row("Species", p.sciname), row("Federal status", p.listing_status)),
    note: "Binds federal actions, not private land directly — but a Corps stream or wetland permit is a federal action. USFWS IPaC is the authoritative species list.",
  };
}
