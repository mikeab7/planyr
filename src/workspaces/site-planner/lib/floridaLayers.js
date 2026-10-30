/* Florida due-diligence layer rows (B2452976, 2026-10-29) — the obvious industrial checks for a Florida site (Broward first) that Planyr did not have.
 *
 * EVERY ROW declares `states: ["FL"]` (so a Texas / Georgia / Colorado view never lists it) and, where its source only serves one county or one water
 * management district, a `regions` boundary (serviceAreas.js: `broward`, `miamidade`, `sfwmd`, `pantherconsult`) so a Tampa site is not offered a Broward
 * wellfield row. The registry spreads FLORIDA_LAYERS into ALL_LAYERS; the endpoint facts + probe dates live in `shared/gis/sourcesFlorida.js`.
 *
 * THE HOSTS, AND HOW EACH IS REACHED (all MEASURED 2026-10-29): agency-owned ArcGIS Online orgs (FDEM, FNAI, SFWMD, Broward County, Miami-Dade County,
 * FWC) are CORS-open and read directly. FDEP's OpenData server, SFWMD's geoweb server, FWC's server and Broward's GeoHub server are not reachable from the
 * build sandbox, so those rows read through the same-origin /gis-proxy relay (`relayUrl`).
 *
 * WHAT THESE ROWS ARE NOT: a verdict. Site Analysis stays TRUSTED-ONLY (siteChecks.js) — nothing here adds a card, and none of these sources is a
 * survey, a determination or a clearance; each note says what the layer is and what to do next. Every regulatory number printed is the publisher's own
 * (Broward's wellfield distances come from the county's layer description; Miami-Dade's travel times are the county's own attribute).
 *
 * PURE: no network, no React — the style / label rules unit-test standalone (test/floridaLayers.test.js). */
import { GIS_SOURCES } from "../../../shared/gis/sources.js";

export const FLORIDA_RELAY = "/gis-proxy";
/* An agency's real https URL → the same-origin relay URL for it. Only the hosts allow-listed in functions/gis-proxy/[[path]].js work. */
export const relayUrl = (url) => String(url).replace(/^https:\/\//, `${FLORIDA_RELAY}/`);

const FL = { states: ["FL"] };
/* The agencies publish ALL-CAPS names and addresses; a card prints them in words (a value with any lowercase letter is left exactly as written). */
const KEEP_CAPS = new Set(["LLC", "INC", "LP", "LLP", "II", "III", "IV", "NW", "NE", "SW", "SE", "FPL", "FDOT", "USA", "FL", "MD", "SR", "US", "CR", "PGA", "DBA", "DEP", "AT&T", "SFWMD", "SWFWMD", "SJRWMD", "SRWMD", "NWFWMD", "WMD", "WCD", "FWC", "USACE", "FEC", "DD", "BCB", "ID",
  // acronyms that carry a vowel and so look like words (STA = Stormwater Treatment Area), and the ones the live canal / permit / site-name lists actually hold
  "STA", "HDPE", "CATV", "CMP", "RCP", "EAA", "HEFT", "JEA", "JTA", "GRU", "EPA", "IMC", "ITT", "AAFES", "USDA", "YMCA", "COJ", "JSO", "ABCA", "MCI", "DERM", "CERP", "TCI", "IXC", "NUI", "CCI", "NASA", "HAFB", "AFS", "FCI",
  "HICPO", "FPDA", "PBIA", "USSC", "ENP", "NDA", "SDA", "SIRWCD", "NSID", "CSID", "DICD", "ITID", "ECWCD", "EBWCD", "ESWCD", "LAMSID"]);
/* Abbreviations that have no vowels but are words, not acronyms ("Ft", "St", "Hwy", "Bldg"). */
const WORD_ABBR = new Set(["ST", "FT", "MT", "DR", "RD", "HWY", "BLVD", "PKWY", "PKY", "CT", "LN", "PL", "CIR", "TRL", "STE", "JR", "TPKE", "CNL", "CNLS", "BRK", "CRK", "BLDG", "CTR", "BD", "MGMT", "PLT", "TR", "BLK", "LK", "PLZ", "BTWN", "SRVC", "MSTR", "FRM", "MR", "MRS", "MS", "DPT", "DEPT", "CNTY", "CTY", "TWP", "BR", "NR", "PRK", "VLG", "SQ", "TRM", "WRK", "WKS", "BLD", "BRG", "HTS", "PT", "MTN", "SPGS"]);
const SMALL_WORDS = new Set(["of", "and", "the", "at", "in", "on", "for", "de", "del", "la"]);
/* A token stays upper-case when it is a known acronym, a district-style acronym (…WCD, …WMD), a canal / road id mixing letters and digits ("C-24D", "L-35"), initials joined by "&" ("J&J", "FP&L"),
 * or a vowel-less run of letters — the shape most district and canal-authority acronyms have ("NSLRWCD", "LWDD") and no ordinary name has. Everything else is title-cased. An acronym's possessive keeps its acronym ("FPL's"). */
const isAcronym = (w) => KEEP_CAPS.has(w.toUpperCase())
  || /^[a-z]{2,}(wcd|wmd)$/.test(w)
  || (/\d/.test(w) && /[a-z]/.test(w) && !/^\d+(st|nd|rd|th)$/.test(w))
  || /^[a-z]{1,3}(&[a-z]{1,3})+$/.test(w)
  || (/^[a-z]{2,}$/.test(w) && !/[aeiouy]/.test(w) && !WORD_ABBR.has(w.toUpperCase()));
const wordCase = (w, i) => {
  const poss = /^([a-z&]+)'s$/.exec(w);
  if (poss && isAcronym(poss[1])) return poss[1].toUpperCase() + "'s";
  if (isAcronym(w)) return w.toUpperCase();
  if (i > 0 && SMALL_WORDS.has(w)) return w;
  if (/^[a-z]'[a-z]/.test(w)) return w.charAt(0).toUpperCase() + "'" + w.charAt(2).toUpperCase() + w.slice(3);
  return w.charAt(0).toUpperCase() + w.slice(1);
};
export function niceCase(v) {
  const t = String(v == null ? "" : v).replace(/\s+/g, " ").trim();
  if (!t || /[a-z]/.test(t)) return t;
  let i = 0;
  return t.toLowerCase().replace(/[a-z0-9&']+/g, (w) => wordCase(w, i++)).replace(/(\d)(St|Nd|Rd|Th)\b/g, (_m, d, suf) => d + suf.toLowerCase());
}

const first = (v) => String(v == null ? "" : v).split(/[\r\n]+/)[0].trim();
/* Broward's drainage-district names carry stray line breaks and a doubled word ("Coral Bay\r\nCoral Bay"). */
export const districtName = (v) => first(v) || null;

const areaStyle = (color, fillMax = 0.25, weight = 1.2, dash = null) => (_props, opacity) => ({
  color, weight, opacity, fill: true, fillColor: color, fillOpacity: Math.min(fillMax, opacity * 0.5), dashArray: dash,
});

/* ── Hurricane evacuation zones: one hue, darker = nearer the water. Zone A is the Category-1 surge area. ─────────────────────────────────────────── */
export const EVAC_RAMP = { A: "#9a3412", B: "#c2410c", C: "#ea580c", D: "#f59e0b", E: "#fbbf24" };
export const EVAC_OTHER = "#fcd34d"; // the zones a county names beyond A–E (F–M, HUR, LAKE, NPBC …) — the legend carries this colour too
export const evacColor = (zone) => EVAC_RAMP[String(zone == null ? "" : zone).trim().toUpperCase().charAt(0)] || EVAC_OTHER;
export const evacStyle = (props, opacity) => {
  const c = evacColor(props && props.EZone);
  return { color: c, weight: 1, opacity, fill: true, fillColor: c, fillOpacity: Math.min(0.45, opacity * 0.6) };
};

/* ── Broward wellfield zones (the county's own definition, in its layer description): Zone 1 innermost. ─────────────────────────────────────────── */
export const BROWARD_WELLFIELD_RAMP = { 1: "#5b21b6", 2: "#7c3aed", 3: "#a78bfa" };
export const browardWellfieldStyle = (props, opacity) => {
  const c = BROWARD_WELLFIELD_RAMP[Number(props && props.ZONE)] || "#a78bfa";
  return { color: c, weight: 1, opacity, fill: true, fillColor: c, fillOpacity: Math.min(0.4, opacity * 0.55) };
};
/* ── Miami-Dade wellfield areas: contours of 10 / 30 / 100 / 210 DAYS of groundwater travel time to the well. ───────────────────────────────────── */
export const MDC_TRAVEL_RAMP = { "010": "#5b21b6", "030": "#7c3aed", "100": "#a78bfa", "210": "#ddd6fe" };
export const mdcTravelDays = (v) => { const t = String(v == null ? "" : v).trim(); return /^\d+$/.test(t) ? String(Number(t)) : null; };
export const mdcWellfieldStyle = (props, opacity) => {
  const c = MDC_TRAVEL_RAMP[String(props && props.TRAVELTIME || "").trim()] || "#a78bfa";
  return { color: "#6d28d9", weight: 1, opacity, fill: true, fillColor: c, fillOpacity: Math.min(0.4, opacity * 0.55) };
};


/* ── DEP contamination sites: the layer's own category / status codes in words ─────────────────────────────────────────────────────────────────── */
export const CLEANUP_CATEGORIES = { PETRO: "Petroleum", OTHCU: "Other cleanup", BROWN: "Brownfield", PFAS: "PFAS", SUPER: "Superfund", FED: "Federal facility" };
export const CLEANUP_STATUSES = { ACTIVE: "Active", OPEN: "Open", ONHOLD: "On hold" };
const codeWord = (table, v) => { const k = String(v == null ? "" : v).trim().toUpperCase(); return k ? (table[k] || k) : null; };
export const cleanupCategory = (v) => codeWord(CLEANUP_CATEGORIES, v);
export const cleanupStatus = (v) => codeWord(CLEANUP_STATUSES, v);
/* The registry's restriction text arrives as "EC MAINTENANCE|GROUNDWATER USE RESTRICTION" — pipe-joined, shouted. */
export const restrictionWords = (v) => {
  const t = String(v == null ? "" : v).trim();
  if (!t) return null;
  // only the registry's own shouted, pipe-joined restriction vocabulary is re-worded; free text ("SS086 LUC Boundary", an order title, a recorded-book reference) prints exactly as written
  if (!/^[A-Z][A-Z ]*(\|[A-Z][A-Z ]*)*$/.test(t)) return t;
  return t.split("|").map((x) => x.trim()).filter(Boolean)
    .map((x) => x.toLowerCase().replace(/(^|\s)([a-z])/g, (_m, a, b) => a + b.toUpperCase()).replace(/\bEc\b/, "EC")).join(" · ");
};
/* An Esri epoch-ms date in words — including the pre-1970 dates a plain date formatter drops (SFWMD's 1959–60 right-of-way permits). */
export const epochDate = (ms) => {
  const n = Number(ms);
  if (ms == null || ms === "" || !Number.isFinite(n)) return "";
  const d = new Date(n);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
};
const acres = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? (n >= 100 ? String(Math.round(n).toLocaleString("en-US")) : n.toFixed(2)) : ""; };
const oneLine = (v, max = 140) => { const t = String(v == null ? "" : v).replace(/\s+/g, " ").trim(); return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t; };

/* ── FGS sinkhole-type areas: I (bare / thin cover) darkest → IV (deep cover) lightest ────────────────────────────────────────────────────────── */
export const SINKHOLE_AREA_RAMP = { "Area I": "#334155", "Area II": "#64748b", "Area III": "#94a3b8", "Area IV": "#cbd5e1" }; // a neutral ramp by cover thickness — NOT a hazard scale (the Survey says Area I's sinkholes are few and gradual)
export const sinkholeAreaStyle = (props, opacity) => {
  const c = SINKHOLE_AREA_RAMP[String(props && props.AREA_DESC || "").trim()] || "#fde68a";
  return { color: c, weight: 1, opacity, fill: true, fillColor: c, fillOpacity: Math.min(0.4, opacity * 0.55) };
};

/* ── FLL noise contours: DNL 60 / 65 / 70 / 75 dB ─────────────────────────────────────────────────────────────────────────────────────────── */
export const NOISE_RAMP = { 60: "#38bdf8", 65: "#a78bfa", 70: "#c026d3", 75: "#9d174d" };
export const noiseLabel = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? `${n} dB` : null; };
export const noiseStyle = (props, opacity) => {
  const c = NOISE_RAMP[Number(props && props.CONTOURVAL)] || "#a78bfa";
  return { color: c, weight: 2, opacity, fill: false };
};

const hoverCommon = { hoverIdentify: true, canvasIdentify: true };

export const FLORIDA_LAYERS = {
  /* ── Jurisdictions ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
  fl_county: {
    kind: "vector", label: "County Boundaries (Florida)", mergeGroup: "counties_cities", source: "Florida Division of Emergency Management",
    url: GIS_SOURCES.countyFl.serviceUrl, ...FL,
    minZoom: 6, color: "#374151", weight: 1.6, opacity: 0.4,
    note: "Florida's 67 county lines (FDEM). Outside city limits the county is the zoning and permitting authority; inside a city the city usually is. A has-jurisdiction boundary, not a service area.",
    role: "line", group: "jurisdiction", order: 1,
  },
  fl_city: {
    kind: "vector", label: "City Limits (Florida)", mergeGroup: "counties_cities", source: "UF GeoPlan / Florida Department of Revenue (2021 tax rolls)",
    url: GIS_SOURCES.cityFl.serviceUrl, ...FL,
    minZoom: 9, color: "#1d4ed8", weight: 1.6, opacity: 0.4,
    note: "Florida municipal limits compiled by the UF GeoPlan Center from the 2021 county tax rolls (Department of Revenue). Inside = in the city; outside = unincorporated county. An annexation since 2021 is NOT in this copy. NOT proof of utility service.",
    infoCaveat: "A boundary means the city HAS JURISDICTION here — not that it serves or will connect utilities to a parcel. Confirm a recent annexation with the city.",
    role: "line", group: "jurisdiction", order: 2,
  },
  fl_udb_miamidade: {
    kind: "esriFeature", label: "Urban Development Boundary", source: "Miami-Dade County — Regulatory & Economic Resources",
    url: GIS_SOURCES.udbMdc.serviceUrl, ...FL, regions: ["miamidade"],
    minZoom: 8, color: "#b45309", weight: 2, opacity: 0.55,
    styleFn: (_p, opacity) => ({ color: "#b45309", weight: 2, opacity, fill: false, dashArray: "10 5" }),
    ...hoverCommon, hoverTitle: "Urban Development Boundary", hoverSource: "Miami-Dade County",
    identifyCard: () => ({ title: "Urban Development Boundary", rows: [], note: "The county's urban development area is on the inside of this line; agricultural and open land lies beyond it." }),
    note: "Miami-Dade County's Urban Development Boundary — the line its Comprehensive Development Master Plan draws between the urban area and the agricultural and rural lands beyond it. Land outside the line is planned for non-urban uses, so urban industrial development there generally needs a plan amendment; inside it, zoning and the land-use map govern.",
    infoCaveat: "The county's boundary line only. Confirm a parcel's land-use designation and any needed amendment with Miami-Dade Planning.",
    role: "line", group: "jurisdiction", order: 7,
  },
  fl_wmd: {
    kind: "esriFeature", label: "Water Management Districts", source: "South Florida Water Management District (FDEP boundary)",
    url: GIS_SOURCES.wmdFl.serviceUrl, ...FL,
    minZoom: 6, color: "#0f766e", weight: 1.6, opacity: 0.55,
    styleFn: (_p, opacity) => ({ color: "#0f766e", weight: 1.6, opacity, fill: false, dashArray: "10 5" }),
    lineLabel: { field: "WMDNAME", minZoom: 7 },
    ...hoverCommon, hoverTitle: "Water management district", hoverSource: "SFWMD",
    hoverFields: [{ names: ["WMDNAME"], label: "District", format: (p) => niceCase(p.WMDNAME) }],
    note: "The five Florida water management districts (SFWMD, SWFWMD, SJRWMD, SRWMD, NWFWMD). The district a site sits in reviews its Environmental Resource Permit (wetlands and stormwater) under its own handbook and criteria.",
    infoCaveat: "A district boundary, not a permit determination. Generalised along the coast; confirm the reviewing district with the agency.",
    role: "line", group: "jurisdiction", order: 6,
  },

  /* ── Flood & drainage ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
  fl_evac_zones: {
    kind: "esriFeature", label: "Hurricane Evacuation Zones", source: "Florida Division of Emergency Management — Know Your Zone",
    url: GIS_SOURCES.evacZonesFl.serviceUrl, ...FL,
    minZoom: 11, color: "#c2410c", weight: 1, opacity: 0.4,
    styleFn: evacStyle, simplifyFactor: 6, vertexBudget: 400000, // Pinellas's coastline polygons are 30k+ vertices each and AGOL re-delivers whole polygons per tile: measured at St. Petersburg z11–13 the default budget refused 16 of 30 batches (2026-10-29)
    legend: [
      { label: "Zone A — usually the Category 1 surge area", color: EVAC_RAMP.A }, { label: "Zone B", color: EVAC_RAMP.B }, { label: "Zone C", color: EVAC_RAMP.C },
      { label: "Zone D", color: EVAC_RAMP.D }, { label: "Zone E", color: EVAC_RAMP.E }, { label: "Other county-defined zones (F–M, lake, …)", color: EVAC_OTHER },
    ],
    ...hoverCommon, hoverTitle: "Evacuation zone", hoverSource: "FDEM",
    hoverFields: [{ names: ["EZone"], label: "Zone" }, { names: ["County_Nam"], label: "County" }],
    note: "Statewide hurricane evacuation zones from the state's storm-surge (SLOSH) modelling: A floods first (Category 1), then B, C … as the storm grows. Zone A is generally the Category-1 surge area that Florida law uses to define the Coastal High Hazard Area (s. 163.3178, F.S.), but zone letters are set county by county and a county's adopted CHHA map is what governs a plan amendment or rezoning. Inland sites are in no zone.",
    infoCaveat: "Evacuation zones, not flood zones and not the FEMA floodplain — a site can be in a zone and outside the SFHA, or the reverse. Zones are drawn county by county and some counties' zones were last edited as long ago as 2013. A flag for insurance, lender and comp-plan review; confirm the adopted CHHA and the current zone map with the county.",
    role: "area", group: "flood", order: 4,
    floodTier: "advisory", agency: "FDEM",
  },
  fl_drainage_districts_broward: {
    kind: "esriFeature", label: "Drainage Districts (Broward)", source: "Broward County — Natural Resources Planning & Management",
    url: GIS_SOURCES.drainageBroward.serviceUrl, ...FL, regions: ["broward"],
    minZoom: 10, color: "#0e7490", weight: 1.6, opacity: 0.4,
    styleFn: areaStyle("#0e7490", 0.15, 1.6, "6 4"),
    lineLabel: { field: "LABELNAME", minZoom: 11, format: districtName },
    ...hoverCommon, hoverTitle: "Drainage district", hoverSource: "Broward County",
    hoverFields: [{ names: ["LABELNAME"], label: "District" }],
    identifyCard: (props) => ({ title: "Drainage district", rows: [{ label: "District", text: districtName(props.LABELNAME) }] }),
    note: "Broward County's 23 drainage and water control districts (Central Broward, South Broward, Coral Springs, NSID …). Each maintains the canals and culverts in its area (some are dependent districts of the county); a connection or discharge into one generally needs that district's approval as well as the state permit.",
    infoCaveat: "Which district covers a parcel, not a will-serve letter or a discharge allowance. Contact the district for allowable discharge and connection terms.",
    role: "area", group: "flood", order: 5,
    floodTier: "local", agency: "Broward County",
  },

  /* ── Rows read through the same-origin /gis-proxy relay (hosts the build sandbox cannot reach; measured through planyr.io's preview 2026-10-29) ─────── */
  fl_sfwmd_canals: {
    kind: "esriFeature", label: "Canals & Streams (SFWMD)", source: "South Florida Water Management District",
    url: relayUrl(GIS_SOURCES.canalsSfwmd.serviceUrl), ...FL, regions: ["sfwmd"],
    minZoom: 13, color: "#0284c7", weight: 1.6, opacity: 0.55,
    styleFn: (_p, opacity) => ({ color: "#0284c7", weight: 1.6, opacity, fill: false }),
    ...hoverCommon, hoverTitle: "Canal or stream", hoverSource: "SFWMD",
    hoverFields: [{ names: ["NAME", "ALIAS", "NHD_GNIS_NAME"], label: "Name", format: (p) => niceCase(p.NAME || p.ALIAS || p.NHD_GNIS_NAME) }, { names: ["OWNER"], label: "Owner", format: (p) => niceCase(p.OWNER) }, { names: ["OPER_MAINT"], label: "Operated by", format: (p) => niceCase(p.OPER_MAINT) }],
    note: "SFWMD's map of the canal and stream network in its 16 counties (the NHD, edited on the District's aerials). A canal beside the site is a possible discharge outlet and a right-of-way / setback question — see Canal & Levee Rights-of-Way. Owner and operator are filled in for only part of the network (a drainage district, the District, a county), so a blank is not 'privately owned'.",
    infoCaveat: "A hydrography map, not a survey of the canal bank or its right-of-way, and not proof the canal can take your discharge. Confirm the owner and any permit with SFWMD and the local drainage district.",
    role: "line", group: "flood", order: 6,
    floodTier: "local", agency: "SFWMD",
  },
  fl_sfwmd_row_permits: {
    kind: "esriFeature", label: "Canal Right-of-Way Permits", source: "South Florida Water Management District — Regulation",
    url: relayUrl(GIS_SOURCES.rowPermitsSfwmd.serviceUrl), ...FL, regions: ["sfwmd"],
    minZoom: 13, color: "#0e7490", weight: 1.2, opacity: 0.4, fetchAll: true, where: "reviewStatus = 'FINAL'",
    styleFn: areaStyle("#0e7490", 0.2, 1.2),
    ...hoverCommon, hoverTitle: "Right-of-way permit", hoverSource: "SFWMD",
    hoverFields: [{ names: ["PERMIT_NO"], label: "Permit no." }, { names: ["PERMITEE"], label: "Permittee" }, { names: ["PROJECT_WORKS"], label: "Canal or works" }],
    identifyCard: (props) => ({
      title: "Right-of-way permit",
      rows: [
        { label: "Permit no.", text: props.PERMIT_NO }, { label: "Permittee", text: niceCase(props.PERMITEE) }, { label: "Canal or works", text: niceCase(props.PROJECT_WORKS) },
        { label: "Use", text: oneLine(niceCase(props.AUTHORIZATION_)) }, { label: "Issued", text: epochDate(props.DATE_ISSUED) }, { label: "Expires", text: epochDate(props.PERMIT_EXP_DATE) },
      ],
    }),
    note: "Final Right-of-Way and Right-of-Way Occupancy permits SFWMD has issued on its canal and levee rights-of-way (drafts, permits in review and cancelled or rejected ones are left out; some final permits have since expired — the card shows the expiry where SFWMD recorded one). Per SFWMD, an occupancy permit is required before connecting with, placing structures in or across, or discharging into the canal and levee system (the 'Works of the District') and certain other canals, and it conveys no property rights. A permit beside your site shows what the District allowed on that canal bank.",
    infoCaveat: "These are permitted occupancies, NOT the right-of-way line itself, and not every canal the District's rules reach. Confirm the right-of-way width and any needed permit with SFWMD.",
    role: "area", group: "flood", order: 7,
    floodTier: "local", agency: "SFWMD",
  },
  fl_sfwmd_conservation_easements: {
    kind: "esriFeature", label: "SFWMD Easements", source: "South Florida Water Management District — Regulation",
    url: relayUrl(GIS_SOURCES.conEasementsSfwmd.serviceUrl), ...FL, regions: ["sfwmd"],
    minZoom: 12, color: "#15803d", weight: 1.2, opacity: 0.4, fetchAll: true,
    styleFn: areaStyle("#15803d", 0.3, 1.2, "6 3"),
    ...hoverCommon, hoverTitle: "Conservation easement", hoverSource: "SFWMD",
    hoverFields: [{ names: ["CE_TYPE_DESC"], label: "Type" }, { names: ["REG_PERMIT_NO"], label: "Permit no." }, { names: ["GRANTOR"], label: "Grantor" }, { names: ["RECORDED_DATE"], label: "Recorded", date: true }, { names: ["RECORDED_ACRES"], label: "Acres", format: (p) => acres(p.RECORDED_ACRES) }, { names: ["COUNTY"], label: "County" }],
    note: "Conservation easements held by SFWMD, many recorded as a condition of a regulatory permit to preserve wetlands or prevent development. The owner keeps the land but cannot use it in a way that interferes with the easement, so mapped acreage inside your parcel comes off the buildable area.",
    infoCaveat: "SFWMD's own easements only (the County, FDEP and land trusts hold others). Mapped from recorded instruments and not survey-accurate; the recorded instrument governs. Check the title commitment.",
    role: "area", group: "environmental", order: 26,
  },
  fl_contamination_sites: {
    kind: "esriFeature", label: "Contamination Sites", source: "Florida Department of Environmental Protection — Contamination Locator Map",
    url: relayUrl(GIS_SOURCES.cleanupFl.serviceUrl), ...FL,
    minZoom: 12, color: "#9a3412", weight: 2, opacity: 0.55, pointRadius: 4, fetchAll: true,
    ...hoverCommon, hoverTitle: "Cleanup site", hoverSource: "Florida DEP",
    hoverFields: [{ names: ["BUSINESS_NAME"], label: "Site" }, { names: ["ADDRESS1"], label: "Address" }, { names: ["CITY"], label: "City" }, { names: ["CLCC_CLEANUP_CATEGORY_KEY"], label: "Program" }, { names: ["RSC2_REMEDIATION_STATUS_KEY"], label: "Status" }],
    identifyCard: (props) => ({
      title: "Cleanup site",
      rows: [
        { label: "Site", text: niceCase(props.BUSINESS_NAME) }, { label: "Address", text: [niceCase(props.ADDRESS1), niceCase(props.CITY)].filter(Boolean).join(", ") },
        { label: "Program", text: cleanupCategory(props.CLCC_CLEANUP_CATEGORY_KEY) }, { label: "Status", text: cleanupStatus(props.RSC2_REMEDIATION_STATUS_KEY) },
      ],
    }),
    note: "Sites in FDEP's cleanup programs with an active, open or on-hold cleanup — petroleum tank discharges, dry-cleaning and other cleanups, brownfield sites, Superfund and PFAS sites — at DEP's own coordinates. A Phase I ESA PRE-SCREEN: a site on or beside yours is a flag to pull DEP's file (the Contamination Locator Map links each site's documents). It is not a list of every registered tank or historic release.",
    infoCaveat: "A map of known, tracked cleanups. A clear map is NOT a clean bill: unreported releases and sites DEP has closed are not here. A Phase I ESA is the real check.",
    role: "point", group: "environmental", order: 21,
  },
  fl_brownfield_areas: {
    kind: "esriFeature", label: "Brownfield Areas", source: "Florida Department of Environmental Protection — Brownfields",
    url: relayUrl(GIS_SOURCES.brownfieldFl.serviceUrl), ...FL,
    minZoom: 10, color: "#a16207", weight: 1.4, opacity: 0.4,
    styleFn: areaStyle("#a16207", 0.25, 1.4, "5 3"),
    ...hoverCommon, hoverTitle: "Brownfield area", hoverSource: "Florida DEP",
    hoverFields: [{ names: ["AREA_NAME"], label: "Name" }, { names: ["CITY"], label: "City" }, { names: ["ACREAGE"], label: "Acres", format: (p) => acres(p.ACREAGE) }, { names: ["RESOLUTION_NUMBER"], label: "Resolution" }, { names: ["RESOLUTION_DATE"], label: "Designated", date: true }],
    note: "Brownfield Areas designated by a local government resolution under Florida's Brownfields Redevelopment Act (ss. 376.77–.85, F.S.) — areas of abandoned, idled or underused industrial and commercial sites where redevelopment is complicated by real or perceived contamination. Designation opens state financial and regulatory incentives for voluntary cleanup and redevelopment, and flags the area for a Phase I.",
    infoCaveat: "An area can include parcels that are not contaminated, and designation is a local act, not a finding. Confirm the parcel's status with the local government and DEP.",
    role: "area", group: "environmental", order: 22,
  },
  fl_institutional_controls: {
    kind: "esriFeature", label: "Institutional Controls", source: "Florida Department of Environmental Protection — Institutional Controls Registry",
    url: relayUrl(GIS_SOURCES.icrFl.serviceUrl), ...FL,
    minZoom: 12, color: "#be185d", weight: 1.4, opacity: 0.4,
    styleFn: areaStyle("#be185d", 0.25, 1.4),
    ...hoverCommon, hoverTitle: "Institutional control", hoverSource: "Florida DEP",
    hoverFields: [{ names: ["PRIMARY_SITE_NAME"], label: "Site" }, { names: ["PRIMARY_SITE_ADDRESS_LINE_1"], label: "Address" }, { names: ["PRIMARY_SITE_CITY"], label: "City" }, { names: ["DESCRIPTION"], label: "Restrictions" }, { names: ["BEGIN_DATE"], label: "In effect since", date: true }],
    identifyCard: (props) => ({
      title: "Institutional control",
      rows: [
        { label: "Site", text: niceCase(props.PRIMARY_SITE_NAME) }, { label: "Address", text: [niceCase(props.PRIMARY_SITE_ADDRESS_LINE_1), niceCase(props.PRIMARY_SITE_CITY)].filter(Boolean).join(", ") },
        { label: "Restrictions", text: restrictionWords(props.DESCRIPTION) }, { label: "In effect since", text: props.BEGIN_DATE },
      ],
    }),
    note: "Properties where a contaminated site was cleaned up to a standard that depends on a restriction placed on the land — for example commercial-use-only, a groundwater-use ban or an engineering control. The restriction runs with the property: a change of use (to residential, say) means meeting stricter cleanup targets. Some also restrict dewatering or stormwater features.",
    infoCaveat: "DEP's registry boundaries, not the recorded instrument. The recorded restriction (and any DEP order) governs — read it before you buy or change use.",
    role: "area", group: "environmental", order: 23,
  },
  fl_sinkhole_reports: {
    kind: "esriFeature", label: "Reported Sinkholes", source: "Florida Geological Survey",
    url: relayUrl(GIS_SOURCES.subsidenceFl.serviceUrl), ...FL,
    minZoom: 11, color: "#7c2d12", weight: 1.6, opacity: 0.55, pointRadius: 3.5, fetchAll: true,
    ...hoverCommon, hoverTitle: "Reported subsidence", hoverSource: "Florida Geological Survey",
    hoverFields: [{ names: ["REF_NUM"], label: "Report no." }, { names: ["COUNTY"], label: "County" }],
    identifyCard: (props) => ({
      title: "Reported subsidence",
      rows: [
        { label: "Report no.", text: props.REF_NUM }, { label: "County", text: niceCase(props.COUNTY) },
        { label: "Field-verified sinkhole", text: String(props.TRUE_SINK || "").trim().toUpperCase() === "Y" ? "Yes" : "" },
      ],
      note: "A reported depression. Most reports were never field-checked, so a dot is not a confirmed sinkhole.",
    }),
    note: "The Florida Geological Survey's database of reported subsidence incidents (about 4,500). It may include true sinkholes, but most reports were never checked in the field and the cause is not verified. A cluster near the site is the signal to commission a geotechnical sinkhole study; Central and North Florida (Tampa Bay to the Panhandle) is where it matters.",
    infoCaveat: "Reports only: an empty map does NOT mean no sinkhole risk. A geotechnical investigation is the real check.",
    role: "point", group: "environmental", order: 27,
  },
  fl_sinkhole_areas: {
    kind: "esriFeature", label: "Sinkhole Type Areas", source: "Florida Geological Survey",
    url: relayUrl(GIS_SOURCES.sinkholeAreasFl.serviceUrl), ...FL,
    minZoom: 9, color: "#c2410c", weight: 1, opacity: 0.4,
    styleFn: sinkholeAreaStyle, simplifyFactor: 4, vertexBudget: 300000, // FGS polygons are 10k+ vertices each and re-delivered per tile (Tampa z14 on a wide window refused a batch at the default)
    legend: [
      { label: "Area I — usually thinnest cover", color: SINKHOLE_AREA_RAMP["Area I"] }, { label: "Area II", color: SINKHOLE_AREA_RAMP["Area II"] },
      { label: "Area III", color: SINKHOLE_AREA_RAMP["Area III"] }, { label: "Area IV — usually deepest cover", color: SINKHOLE_AREA_RAMP["Area IV"] },
    ],
    ...hoverCommon, hoverTitle: "Sinkhole type area", hoverSource: "Florida Geological Survey",
    hoverFields: [{ names: ["AREA_DESC"], label: "Area" }, { names: ["DESC_1"], label: "Cover" }, { names: ["DESC_2"], label: "Sinkholes" }],
    note: "The Florida Geological Survey's map of where sinkholes form and what kind: Area I is generally bare or thinly covered limestone, Areas II and III are generally 30–200 ft of sandy or clayey cover and Area IV is generally more than 200 ft. The shading runs by cover thickness only — it is not a hazard scale. Click for the Survey's own description of the sinkholes each area produces (cover-collapse can develop abruptly). Where a polygon's own Cover line differs from its area's general description, the polygon's line is the one that applies. Ground outside every area is simply not mapped for sinkhole type.",
    infoCaveat: "A regional screening map, not a site investigation: it says what is likely in the area, not what is under your slab. Order a geotechnical report before committing to a building pad.",
    role: "area", group: "environmental", order: 28,
  },
  fl_outstanding_florida_waters: {
    kind: "esriFeature", label: "Outstanding Florida Waters", source: "Florida Department of Environmental Protection",
    url: relayUrl(GIS_SOURCES.ofwFl.serviceUrl), ...FL,
    minZoom: 9, color: "#0369a1", weight: 1.2, opacity: 0.4,
    styleFn: areaStyle("#0369a1", 0.25, 1.2), simplifyFactor: 0.75,
    ...hoverCommon, hoverTitle: "Outstanding Florida Water", hoverSource: "Florida DEP",
    hoverFields: [{ names: ["NAME"], label: "Name" }, { names: ["TYPE"], label: "Type" }, { names: ["OFW_DATE"], label: "Designated" }],
    note: "Waters the state has designated worthy of special protection because of their natural attributes (s. 62-302.700, F.A.C.): OFW aquatic preserves, special OFWs and other OFWs, including the waters of many state parks. The designation is intended to protect and maintain existing water quality, so a stormwater discharge to or near one can face stricter permit criteria.",
    infoCaveat: "A boundary from DEP's rule, not a determination for a project. The reviewing agency (the water management district or DEP) decides what applies to a discharge.",
    role: "area", group: "environmental", order: 29,
  },
  fl_panther_consultation: {
    kind: "esriFeature", label: "Panther Consultation Area", source: "U.S. Fish & Wildlife Service (hosted by Florida DEP)",
    url: relayUrl(GIS_SOURCES.pantherFl.serviceUrl), ...FL, regions: ["pantherconsult"],
    minZoom: 8, color: "#b45309", weight: 1.2, opacity: 0.4,
    styleFn: areaStyle("#b45309", 0.2, 1.2, "6 3"), simplifyFactor: 1,
    ...hoverCommon, hoverTitle: "Panther consultation area", hoverSource: "USFWS",
    hoverFields: [],
    identifyCard: () => ({ title: "Panther consultation area", rows: [], note: "Consult USFWS if suitable panther habitat is present and a federal action is involved." }),
    note: "The area in USFWS's South Florida Ecological Services Office territory (southwest Florida) where consultation on possible impacts to the endangered Florida panther should be made if suitable habitat is present. It matters for a project needing a federal action — a Corps wetlands permit, say — that touches panther habitat. The mapped area spans southwest Florida and reaches the western edges of Broward and Miami-Dade (the Everglades side); sites elsewhere are outside it.",
    infoCaveat: "A consultation trigger, not a habitat map or a permit determination. USFWS (IPaC) decides whether consultation is required.",
    role: "area", group: "environmental", order: 30,
  },
  fl_eagle_nesting: {
    kind: "esriFeature", label: "Eagle Nesting (1998–2017)", source: "Florida Fish and Wildlife Conservation Commission",
    url: relayUrl(GIS_SOURCES.eagleFl.serviceUrl), ...FL,
    minZoom: 11, color: "#ca8a04", weight: 1.2, opacity: 0.4,
    styleFn: areaStyle("#ca8a04", 0.3, 1.2),
    ...hoverCommon, hoverTitle: "Bald eagle nesting area", hoverSource: "FWC",
    hoverFields: [{ names: ["MinOfSurve"], label: "First survey" }, { names: ["MaxOfSurve"], label: "Last survey" }],
    identifyCard: (props) => ({
      title: "Bald eagle nesting area",
      rows: [{ label: "Nest confirmed", text: props.MinOfSurve && props.MaxOfSurve ? (String(props.MinOfSurve) === String(props.MaxOfSurve) ? String(props.MinOfSurve) : `${props.MinOfSurve}–${props.MaxOfSurve}`) : "" }],
      note: "Historical survey result — not a current nest.",
    }),
    note: "Every bald eagle nesting area FWC documented in its statewide aerial surveys from 1998 to 2017; each polygon carries the years a nest was confirmed there. Bald eagles are still federally protected, so a nest tree near a site can restrict clearing and construction timing.",
    infoCaveat: "HISTORICAL surveys, not a current nest list and not every nest: FWC says the map does not take the place of a survey. Check FWC and USFWS's current eagle guidance and have a biologist survey.",
    role: "area", group: "environmental", order: 31,
  },
  fl_fll_noise: {
    kind: "esriFeature", label: "Airport Noise Contours (FLL)", source: "Broward County Aviation Department",
    url: relayUrl(GIS_SOURCES.fllNoise.serviceUrl), ...FL, regions: ["broward"],
    minZoom: 9, color: "#a78bfa", weight: 2, opacity: 0.55,
    styleFn: noiseStyle, lineLabel: { field: "CONTOURVAL", minZoom: 11, format: noiseLabel },
    legend: [{ label: "60 dB", color: NOISE_RAMP[60] }, { label: "65 dB", color: NOISE_RAMP[65] }, { label: "70 dB", color: NOISE_RAMP[70] }, { label: "75 dB", color: NOISE_RAMP[75] }],
    ...hoverCommon, hoverTitle: "Noise contour", hoverSource: "Broward County Aviation Department",
    hoverFields: [{ names: ["CONTOURVAL"], label: "Day-night average noise level", unit: "dB" }],
    note: "Day-night average sound level (DNL) contours at 60, 65, 70 and 75 dB around Fort Lauderdale–Hollywood International, from the Aviation Department (the layer is titled 2020, alternative B1b — modelled contours, not measured noise). 65 dB is the FAA's reference line for homes and other noise-sensitive uses; warehouse and industrial uses are generally compatible with higher levels, but office, hotel and residential components, and any avigation or noise-disclosure requirement, are worth checking.",
    infoCaveat: "Modelled contours for one airport; no other airport's are shown. Confirm the current noise map with the Aviation Department.",
    role: "line", group: "access", order: 7,
  },

  /* ── Access ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
  fl_sis_highways: {
    kind: "esriFeature", label: "SIS Highways (FDOT)", source: "Florida Department of Transportation",
    url: GIS_SOURCES.sisHighwaysFl.serviceUrl, ...FL,
    minZoom: 8, color: "#0369a1", weight: 2, opacity: 0.55,
    styleFn: (props, opacity) => ({ color: "#0369a1", weight: 2, opacity, fill: false, dashArray: /future/i.test(String(props && props.SISTYPE_DE || "")) ? "8 5" : null }), // planned ("Future") corridors are dashed
    ...hoverCommon, hoverTitle: "SIS highway", hoverSource: "FDOT",
    hoverFields: [{ names: ["FACILITY"], label: "Facility", format: (p) => niceCase(p.FACILITY) }, { names: ["SISTYPE_DE"], label: "Type" }, { names: ["COUNTY"], label: "County" }],
    note: "The highways on FDOT's Strategic Intermodal System — the state's designated high-priority freight and passenger corridors (interstates, the Turnpike, major connectors). Freight-oriented industrial sites cluster on them; a driveway or median opening onto a state road needs an FDOT connection permit, and FDOT's access-management rules apply on state roads.",
    infoCaveat: "SIS is a state planning designation, not a measure of truck volume or a guarantee of access. Confirm the access class and connection rules with the FDOT district office.",
    role: "line", group: "access", order: 6,
  },

  /* ── Environmental & hazards ────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
  fl_wellfield_broward: {
    kind: "esriFeature", label: "Wellfield Zones (Broward)", source: "Broward County — Pollution Prevention, Remediation & Air Quality",
    url: GIS_SOURCES.wellfieldBroward.serviceUrl, ...FL, regions: ["broward"],
    minZoom: 11, color: "#7c3aed", weight: 1, opacity: 0.4,
    styleFn: browardWellfieldStyle, simplifyFactor: 0.5, fetchAll: true,
    legend: [{ label: "Zone 1 — innermost", color: BROWARD_WELLFIELD_RAMP[1] }, { label: "Zone 2", color: BROWARD_WELLFIELD_RAMP[2] }, { label: "Zone 3 — outermost", color: BROWARD_WELLFIELD_RAMP[3] }],
    ...hoverCommon, hoverTitle: "Wellfield protection zone", hoverSource: "Broward County",
    hoverFields: [{ names: ["ZONE"], label: "Zone" }, { names: ["LABEL"], label: "Wellfield", format: (p) => niceCase(p.LABEL) }],
    note: "Broward County's regulatory zones around public water-supply wells. For a well on the county's 2001 map the zones are the mapped ones; for a later well, Zone 1 is 250 ft, Zone 2 out to 500 ft and Zone 3 out to 1,320 ft (the county's own layer description of its wellfield ordinance). The ordinance restricts how regulated substances are stored, handled, used and disposed of inside the zones — generally tightest nearest the well — which matters for tenant uses (chemicals, fuel, hazardous-materials storage).",
    infoCaveat: "Screening only: Broward County's Environmental Permitting Division determines the zone and any use restriction for a parcel. Zone edges are drawn from the county's model, not surveyed.",
    role: "area", group: "environmental", order: 20,
  },
  fl_wellfield_miamidade: {
    kind: "esriFeature", label: "Wellfield Areas (Miami-Dade)", source: "Miami-Dade County — Regulatory & Economic Resources",
    url: GIS_SOURCES.wellfieldMdc.serviceUrl, ...FL, regions: ["miamidade"],
    minZoom: 9, color: "#7c3aed", weight: 1, opacity: 0.4,
    styleFn: mdcWellfieldStyle, simplifyFactor: 0.5, where: "TRAVELTIME IN ('010','030','100','210')",
    legend: [{ label: "10-day travel time", color: MDC_TRAVEL_RAMP["010"] }, { label: "30-day", color: MDC_TRAVEL_RAMP["030"] }, { label: "100-day", color: MDC_TRAVEL_RAMP["100"] }, { label: "210-day", color: MDC_TRAVEL_RAMP["210"] }],
    ...hoverCommon, hoverTitle: "Wellfield protection area", hoverSource: "Miami-Dade County",
    hoverFields: [{ names: ["TRAVELTIME"], label: "Travel time" }, { names: ["NAME"], label: "Wellfield", format: (p) => niceCase(p.NAME) }],
    identifyCard: (props) => ({ title: "Wellfield protection area", rows: [{ label: "Travel time to the well", text: mdcTravelDays(props.TRAVELTIME) ? `${mdcTravelDays(props.TRAVELTIME)} days` : "" }, { label: "Wellfield", text: niceCase(props.NAME) }] }),
    note: "Miami-Dade County's wellfield protection areas, drawn as groundwater travel-time contours to a public supply well (10, 30, 100 and 210 days). Chapter 24 of the Code of Miami-Dade County restricts land uses that could pollute the aquifer inside them, tightest nearest the well. Matters for industrial tenants that store fuel, solvents or other regulated substances.",
    infoCaveat: "Screening only: Miami-Dade County applies the restriction to a parcel. Travel-time contours are modelled and are revised by ordinance.",
    role: "area", group: "environmental", order: 21,
  },
  fl_erp_sfwmd: {
    kind: "esriFeature", label: "ERP Permits (SFWMD)", source: "South Florida Water Management District",
    url: GIS_SOURCES.erpSfwmd.serviceUrl, ...FL, regions: ["sfwmd"],
    minZoom: 12, color: "#0f766e", weight: 1.2, opacity: 0.4,
    styleFn: areaStyle("#0f766e", 0.12, 1.2), simplifyFactor: 0.5, fetchAll: true, where: "PermitStatus <> 'Pending-Expired'",
    ...hoverCommon, hoverTitle: "Environmental Resource Permit", hoverSource: "SFWMD",
    hoverFields: [{ names: ["PROJECT_NAME"], label: "Project" }, { names: ["PERMIT_NO"], label: "Permit no." }, { names: ["PermitType"], label: "Type" }, { names: ["PermitStatus"], label: "Status" }, { names: ["IssueDate"], label: "Issued", date: true }],
    identifyCard: (props) => ({
      title: "Environmental Resource Permit",
      rows: [
        { label: "Project", text: niceCase(props.PROJECT_NAME) }, { label: "Permit no.", text: props.PERMIT_NO }, { label: "Type", text: erpTypeLabel(props.PermitType) },
        { label: "Status", text: props.PermitStatus }, { label: "Issued", text: props.IssueDate },
      ],
    }),
    note: "Permit footprints (active and approved; expired pending applications are left out) from SFWMD's regulation system. An Environmental Resource Permit (Part IV, ch. 373, F.S.) covers wetland impacts AND the stormwater system, so a neighbouring permit shows how nearby sites were drained and mitigated — and a permit on the site itself sets what may change without a modification.",
    infoCaveat: "SFWMD's footprints only. A site in another district's territory shows nothing here — that is not an all-clear. Footprints are not survey-accurate; the permit file itself is at SFWMD (the permit number on the card finds it).",
    role: "area", group: "environmental", order: 22,
  },
  fl_conservation_lands: {
    kind: "esriFeature", label: "Conservation Lands", source: "Florida Natural Areas Inventory",
    url: GIS_SOURCES.conservationLandsFl.serviceUrl, ...FL,
    minZoom: 8, color: "#15803d", weight: 1.2, opacity: 0.4,
    styleFn: areaStyle("#15803d", 0.25, 1.2), simplifyFactor: 0.75, fetchAll: true,
    ...hoverCommon, hoverTitle: "Conservation land", hoverSource: "FNAI",
    hoverFields: [{ names: ["MANAME"], label: "Name" }, { names: ["MANAGING_A"], label: "Managed by" }, { names: ["OWNER"], label: "Owner" }, { names: ["TOTACRES"], label: "Acres" }],
    note: "Federal, state, local and some private lands managed at least partly for conservation (FNAI's Florida Conservation Lands, ~3,400 areas). Land next to one draws wildlife, wetland and buffer questions at permitting; a conservation easement over a site's own acreage is a title item.",
    infoCaveat: "A managed-area boundary, not a legal survey and not a list of every conservation easement. Confirm with the title commitment.",
    role: "area", group: "environmental", order: 23,
  },
  fl_wetlands_broward: {
    kind: "esriFeature", label: "Wetlands (Broward)", source: "Broward County — Aquatic & Wetland Resources",
    url: GIS_SOURCES.wetlandsBroward.serviceUrl, ...FL, regions: ["broward"],
    minZoom: 12, color: "#0d9488", weight: 1, opacity: 0.4,
    styleFn: areaStyle("#0d9488", 0.3, 1), simplifyFactor: 0.5,
    ...hoverCommon, hoverTitle: "Wetland", hoverSource: "Broward County",
    hoverFields: [{ names: ["ACRESGIS"], label: "Acres" }],
    identifyCard: (props) => ({ title: "Wetland", rows: [{ label: "Acres", text: acres(props.ACRESGIS) }] }),
    note: "Broward County's own wetland map, kept by its Aquatic and Wetland Resources program for planning and environmental review. In Broward, work in wetlands generally needs the county's Environmental Resource License in addition to the state / federal permits (its license numbers are in this layer's data) — this map shows where to expect it. Turn on National Wetlands for the federal inventory.",
    infoCaveat: "A planning map, not a jurisdictional delineation: edges are approximate and some mapped areas are already permitted for impact or mitigation. A wetland delineation by a consultant is the real check.",
    role: "area", group: "environmental", order: 24,
  },
  fl_natural_lands_broward: {
    kind: "esriFeature", label: "Natural Lands (Broward)", source: "Broward County — Land Stewardship Program",
    url: GIS_SOURCES.naturalLandsBroward.serviceUrl, ...FL, regions: ["broward"],
    minZoom: 10, color: "#4d7c0f", weight: 1.2, opacity: 0.4,
    styleFn: areaStyle("#4d7c0f", 0.25, 1.2), simplifyFactor: 0.5,
    ...hoverCommon, hoverTitle: "Protected natural land", hoverSource: "Broward County",
    hoverFields: [{ names: ["NAME"], label: "Name" }, { names: ["OWNER"], label: "Owner" }, { names: ["MNGMTAUTHO"], label: "Managed by" }],
    note: "Broward's inventory of protected natural lands — forested uplands and wetlands protected by ownership, easement or a land-use designation. Next to one, expect buffer, habitat and stormwater-quality questions; on one, the protection mechanism decides what is possible.",
    infoCaveat: "County inventory last edited 2018. Confirm the mechanism and boundary against the recorded instrument.",
    role: "area", group: "environmental", order: 25,
  },
};

/* Every Florida row words its shouted agency text with the ONE acronym-aware formatter above (featureHover reads `cfg.nameCase` for any field without its own format). */
for (const cfg of Object.values(FLORIDA_LAYERS)) cfg.nameCase = niceCase;

/* Permit-type codes → words, used by the ERP row's click card. */
/* Only the four codes whose meaning is standard Florida ERP wording are decoded; any other SFWMD code prints as the agency wrote it (the agency publishes no code list we could cite). */
export const ERP_TYPES = { IND: "Individual", GP: "General", CA: "Conceptual approval", EXEM: "Exemption" };
export const erpTypeLabel = (code) => { const c = String(code == null ? "" : code).trim().toUpperCase(); return c ? (ERP_TYPES[c] || c) : null; };

export const FLORIDA_VINTAGE = {
  fl_county: "FDEM county boundaries — layer edited 2026-07-22",
  fl_city: "UF GeoPlan city limits from the 2021 county tax rolls — layer edited 2024-05-03; later annexations are not in it",
  fl_udb_miamidade: "Miami-Dade Urban Development Boundary — layer edited 2025-08-19",
  fl_wmd: "FDEP water management district boundaries (SFWMD-hosted copy) — layer edited 2021-10-31",
  fl_evac_zones: "FDEM Know Your Zone evacuation zones — statewide layer edited 2026-09-19; each county's zones carry their own edit date (some Broward / Miami-Dade zones date from 2013)",
  fl_drainage_districts_broward: "Broward County drainage districts — layer edited 2021-06-10",
  fl_wellfield_broward: "Broward County wellfield zones — map approved 2001-02-16, ordinance revised June 2013; layer edited 2021-06-10",
  fl_wellfield_miamidade: "Miami-Dade County wellfield protection areas — data last edited 2023-04-05 (layer definition edited 2025-11-03)",
  fl_erp_sfwmd: "SFWMD Approved ERP boundaries — continuously maintained by its permitting system",
  fl_sis_highways: "FDOT SIS highways — layer edited 2026-10-26",
  fl_sfwmd_canals: "SFWMD AHED canals and streams — continuously maintained (no edition date published)",
  fl_sfwmd_row_permits: "SFWMD Right-of-Way permits — continuously maintained by its permitting system",
  fl_sfwmd_conservation_easements: "SFWMD conservation easements — continuously maintained (layer edited 2025-09-26)",
  fl_contamination_sites: "Florida DEP Contamination Locator Map — records loaded 2026-10-29, continuously updated",
  fl_brownfield_areas: "Florida DEP Brownfield Areas — continuously updated from local-government designations",
  fl_institutional_controls: "Florida DEP Institutional Controls Registry — continuously updated",
  fl_sinkhole_reports: "Florida Geological Survey subsidence incident reports — periodically updated",
  fl_sinkhole_areas: "Florida Geological Survey sinkhole-type areas — no edition date published",
  fl_outstanding_florida_waters: "Florida DEP OFW boundaries (s. 62-302.700, F.A.C.) — the layer notes an update on 2026-07",
  fl_panther_consultation: "USFWS South Florida Ecological Services consultation area — no edition date published",
  fl_eagle_nesting: "FWC statewide eagle surveys 1998–2017 — historical, not updated",
  fl_fll_noise: "Broward County Aviation Department DNL contours — titled 2020, alternative B1b",
  fl_conservation_lands: "FNAI Florida Conservation Lands — layer edited 2026-10-06",
  fl_wetlands_broward: "Broward County wetlands — updated regularly by its Aquatic & Wetland Resources program (layer data edited 2024-12-26)",
  fl_natural_lands_broward: "Broward Protected Natural Lands — layer edited 2018-10-11",
};
