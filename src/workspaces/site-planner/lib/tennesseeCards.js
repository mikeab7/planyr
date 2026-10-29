/* Tennessee industrial due-diligence layers (B2521584) — the PURE click-card wording. No network, no React.
 *
 * Owner constraint #45: a layer's click card is CLEAN — plain labels, no raw field names, no empty or null rows, normal dates, a link as a short
 * labelled link (never a raw URL), the source / vintage behind the (i). Each builder takes one feature's attributes and returns
 * `{ title, rows: [{ label, text, href? }], note? }` — the shape `featureHoverAttach` hands the planner's identify card — or `null` when the
 * feature has nothing worth a card (the one-line tooltip wording then stands in). */

const clean = (v) => {
  const s = v == null ? "" : String(v).replace(/\s+/g, " ").trim(); // the State's text is fixed-width: padded, and sometimes double-spaced inside
  return !s || /^(null|none|n\/?a|unknown|undetermined|0|-{1,2})$/i.test(s) ? "" : s;
};
const row = (label, text, href) => (clean(text) ? { label, text: clean(text), ...(href ? { href } : {}) } : null);
const rowsOf = (...rs) => rs.filter(Boolean);
const httpHref = (u) => (/^https?:\/\//i.test(String(u || "").trim()) ? String(u).trim() : null);

/* SHOUTED federal / state text → sentence-ish case, without butchering short acronyms or small words. */
const SMALL = new Set(["of", "and", "the", "at", "in", "on", "for"]);
const ACRONYM = new Set(["LLC", "LP", "INC", "TN", "MLGW", "WWTP", "STP", "PWSID", "TVA", "DOE", "DOD", "UD", "PUD", "WSD", "US", "USA", "II", "III", "IV", "NPL", "EPA", "TDEC", "HWRA"]);
export function titleCase(raw) {
  const s = clean(raw);
  if (!s || /[a-z]/.test(s)) return s;
  return s.split(/(\s+)/).map((tok, i) => {
    if (/^\s+$/.test(tok) || !tok) return tok;
    const bare = tok.replace(/[^A-Za-z]/g, "");
    if (ACRONYM.has(bare)) return tok;
    const lower = tok.toLowerCase();
    if (i > 0 && SMALL.has(lower)) return lower;
    // capitalise a word start, and after an apostrophe only for an O'/D'-style prefix (O'Brien) — never the possessive s (Joy's)
    let out = lower.replace(/(^|[\s\-/.(])([a-z])/g, (_m, pre, c) => pre + c.toUpperCase()).replace(/\b([od])'([a-z])/g, (_m, a, b) => `${a.toUpperCase()}'${b.toUpperCase()}`);
    out = out.replace(/\b(Mc)([a-z])/g, (_m, a, b) => a + b.toUpperCase());          // McMinnville, McKenzie
    if (/^Dekalb\b/.test(out)) out = out.replace(/^Dekalb/, "DeKalb");
    return out;
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
      drycleanerStatus(p.COMMENTS) ? null : row("TDEC note", clean(p.COMMENTS).slice(0, 160)), // a note TDEC wrote that is neither of the two standard ones (e.g. "Site ID issued in error") is shown as TDEC wrote it
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
      row("Reach", clean(p.LOCATION_DESCRIPTION).replace(/\s*Ecoregion\s+\S+.*$/i, "").trim()),   // the trailing "Ecoregion 71i …" is TDEC's bookkeeping, not part of the reach
      row("Watershed", p.NAME8),
    ),
    note: "TDEC's 2026 assessment. An impaired stream can carry tighter stormwater and buffer requirements — the cause (siltation, habitat alteration…) decides which; ask TDEC's Division of Water Resources.",
  };
}

/* ---- TDEC public water system service areas ---- */
const WATER_SOURCES = { SW: "Surface water", SWP: "Purchased surface water", GW: "Groundwater", GWP: "Purchased groundwater", GU: "Groundwater under the influence of surface water", GUP: "Purchased groundwater under the influence of surface water" };
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
      Number.isFinite(mi) && mi > 0 ? { label: "Length", text: `${Math.round(mi * 10) / 10} miles` } : null,
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

/* ---- TDEC permitted landfills ---- */
const romanClass = (v) => clean(v).replace(/\bclass\s+(i{1,3}|iv)\b/gi, (_m, r) => `Class ${r.toUpperCase()}`);
export function landfillCard(props) {
  const p = props || {};
  return {
    title: `${romanClass(clean(p.PRIMARY_NAME)) || "Landfill"} — permitted landfill`,
    rows: rowsOf(
      row("Class", romanClass(p.LANDFILL_CLASS)),
      row("Status", p.STATUS),
      row("Address", [clean(p.ADDRESS), clean(p.CITY)].filter(Boolean).join(", ")),
      row("County", p.COUNTY),
      row("TDEC site ID", p.TDEC_SITE_ID),
    ),
    note: "TDEC classes permitted landfills I–IV by the kind of waste accepted. A landfill beside a site is a flag (gas, leachate, truck traffic, buffers) — ask TDEC's Division of Solid & Hazardous Waste Management. Closed and unpermitted dumps are not on this map.",
  };
}

/* ---- Tennessee Historical Commission survey + State Historic Preservation Office boundaries ---- */
/* The State's historic layers are fixed-width text (padded with spaces) and dates like 20020320; `clean` trims, this makes a date read as one. */
export function ymd(raw) {
  const m = clean(raw).match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return clean(raw);
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const mo = months[Number(m[2]) - 1];
  return mo ? `${mo} ${Number(m[3])}, ${m[1]}` : clean(raw);
}
export function thcSiteCard(props) {
  const p = props || {};
  const name = titleCase(p.COMNAME) || titleCase(p.HISTNAME);
  const hist = titleCase(p.HISTNAME);
  return {
    title: name ? `${name} — recorded historic site` : "Recorded historic site",
    rows: rowsOf(
      hist && hist !== name ? row("Historic name", hist) : null,
      row("Address", [titleCase(p.PROPADDR), titleCase(p.CITY)].filter(Boolean).join(", ")),
      row("County", p.COUNTY),
      row("Built", p.DATECONST),
      row("Original use", p.ORIGUSE),
      row("Present use", p.PRESUSE),
    ),
    note: "From the Tennessee Historical Commission's survey records — surveyed, not necessarily listed on the National Register, and the inventory is still being digitised statewide. A flag to check with the Commission, not a clearance.",
  };
}
export function nrhpBoundaryCard(props) {
  const p = props || {};
  const where = [clean(p.City), clean(p.County) ? `${clean(p.County)} County` : ""].filter(Boolean).join(", ");
  return {
    title: `${clean(p.Resource_Name) || "National Register property"} — National Register`,
    rows: rowsOf(
      row("Address", p.Address),
      row("Location", where),
      row("Listed", ymd(p.Listed_Date)),
      row("National Historic Landmark", ymd(p.NHL_Date)),
      row("Listed as part of", p.Multiple_Name),
    ),
    note: "The boundary of a property or district listed on the National Register of Historic Places (State Historic Preservation Office). A listing triggers federal Section 106 review where a federal permit or funding is involved.",
  };
}

/* ---- TDEC Division of Remediation (DOR sites) ---- */
export const DOR_PROGRAMS = Object.freeze({
  "VOLUNTARY": "Voluntary cleanup",
  "STATE (HWRA FUNDED)": "State Superfund — state-funded (Hazardous Waste Remedial Action fund)",
  "LIABLE PARTY FUNDED": "State Superfund — paid for by the responsible party",
  "PRE-REMEDIAL": "Pre-remedial — being evaluated",
  "DCERP": "Drycleaner program",
  "EPA NON-NPL": "EPA site (not on the National Priorities List)",
  "EPA NPL": "Federal Superfund (National Priorities List)",
  "DOD": "Department of Defense site",
});
export function dorProgramWords(v) {
  const k = clean(v).toUpperCase();
  return DOR_PROGRAMS[k] || titleCase(clean(v));
}
export function dorSiteCard(props) {
  const p = props || {};
  const ac = Number(p.Acres);
  const prom = Number(p.Promulgated);
  return {
    title: `${titleCase(p.DOR_Site_Name) || "Remediation site"} — remediation site`,
    rows: rowsOf(
      row("Program", dorProgramWords(p.Program)),
      row("Status", titleCase(p.Status)),
      Number.isFinite(ac) && ac > 0 ? { label: "Site area", text: `${ac} acres` } : null,
      row("Address", [titleCase(p.Address), titleCase(p.City)].filter(Boolean).join(", ")),
      row("County", titleCase(p.County)),
      Number.isFinite(prom) && prom > 0 ? { label: "Listed", text: new Date(prom).getUTCFullYear().toString() } : null,
      row("TDEC site ID", p.DOR_Site_Id),
    ),
    note: "TDEC's Division of Remediation register (last edited June 2024 — a site opened since is not on it). A flag for a Phase I ESA: pull TDEC's file for the cleanup status and any land-use controls. A neighbouring site is not a finding about this one.",
  };
}
