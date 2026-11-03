/* City of Sugar Land (Fort Bend County, TX) — the city's own GIS layer rows (NEW-1, 2026-11-02).
 *
 * Every row here is a REGIONAL source: it declares `states: ["TX"]` and `regions: ["sugarland"]` (serviceAreas.js: the City of Sugar Land's limits ∪ its ETJ, from the city's own
 * CityLimits_ETJ map service — built by scripts/build-service-areas.mjs), so `layerAvailableHere` hides the row — and the map's draw filter turns it off before any request — on a
 * Harris County, Dallas or Georgia site. The registry spreads SUGARLAND_LAYERS into ALL_LAYERS, exactly as DeSoto's rows are.
 *
 * TWO HOSTS, TWO WAYS IN (both MEASURED 2026-11-02):
 *   · the city's ArcGIS Online org (services1.arcgis.com/SVtsrBXEiBhI5L5n) — public, CORS-open, read directly;
 *   · the city's own ArcGIS Server 10.91 (interactivemaps.sugarlandtx.gov/512) — sends no CORS header and the build sandbox's egress refuses it, so it is read through the same-origin
 *     /gis-proxy relay (functions/gis-proxy), measured on the PR preview. The server's login-gated folders (PW_Utilities, CIP, CityHall, CWOL_Services, GTG) are NEVER read.
 *
 * WHAT THE CITY DOES NOT PUBLISH, and so what is not here (each measured):
 *   · WATER, SEWER AND STORM PIPE LINES. The city's public folders, all 507 org services and an ArcGIS Online item search hold none. The Utilities group says so
 *     (`SUGARLAND_UTILITY_NOTE`, with the city's Utility Map Request form) instead of listing an empty "Water Mains" row. Hydrants (inspection layer) are the only public trace of the water system.
 *   · the WATER SYSTEM service-area polygons (Hosted/waterSystemMap_VIEW, and its siblings waterSystem and waterSystem_VIEW): every query — count, ids, features — answers HTTP 500
 *     "Database error has occurred" on the city's server. There is nothing to read, so there is no row.
 *   · LEVEE IMPROVEMENT DISTRICTS and MUNICIPAL UTILITY DISTRICTS: the TCEQ water-district row already draws all 9 city LIDs and the MUDs (TCEQ's layer carries a TYPE of LID and MUD, 15 Fort Bend
 *     LIDs); the city's copies add only district contact names, so no second district row is made.
 *   · Traffic Count (4 points, counted 2016 and 2019), Key Development Areas (8 named points) and Planning/Current_Developments (108 review cases, newest application 2025-09-30):
 *     the org's Development Projects layer is the more current of the two (edited 2026-10-09), so it is the one development row.
 *   · parcels (the county's CAD is wired — county source first), FEMA copies, street centerlines, pavement, sidewalks, trails, addresses, council districts, HOAs, schools, Stormwater_Fee_Parcels
 *     (owner names), UtilityProblemReports (names, phones), Large_Comm_Meters, anything Cityworks or airport-asset.
 *
 * NO PERSONAL DATA: the hydrant layer is asked only for its id and install date (its other fields carry creator / editor names and work-order ids); the development-project layer for six
 * non-contact fields (its contractor / superintendent names, phones and emails are never requested); the capital-project layer for five (its manager, engineer, contractor and inspector
 * names and emails are never requested). Case layers show case, date, request and result — no addresses of homes.
 *
 * City GIS is shown as LAYERS ONLY — nothing here is wired into Site Analysis verdicts.
 *
 * PURE: no network, no React — the style / card / filter rules unit-test standalone (test/sugarLandLayers.test.js). */

import { GIS_SOURCES } from "../../../shared/gis/sources.js";
import { approvalDate } from "./desotoZoning.js";
import { zoningStyle, zoningCard, zoningLegend, legendItemsOf, zoneLabelText, normalizeZone, ZONING_CITATION } from "./sugarLandZoning.js";
import { thoroughfareStyle, thoroughfareCard, thoroughfareLegend, THOROUGHFARE_WHERE } from "./sugarLandThoroughfare.js";
export { THOROUGHFARE_WHERE };

/* ───────────────────────── small readers ───────────────────────── */
const str = (v) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim());
const has = (v) => { const t = str(v); return !!t && !/^(null|none|n\/?a|<null>)$/i.test(t); };
const row = (label, v, extra) => (has(v) ? { label, text: str(v), ...(extra || {}) } : null);
const clean = (rows) => rows.filter(Boolean);
const SMALL = new Set(["and", "of", "the", "for", "to", "a", "in"]);
/* Shouted text ("LIGHT INDUSTRIAL", "NEIGHBORHOOD ACTIVITY CENTER") reads as words; mixed-case text is left exactly as written. */
export function soft(v) {
  const t = str(v);
  if (!t || /[a-z]/.test(t)) return t;
  return t.toLowerCase().replace(/[a-z][a-z'.&]*/g, (w, i) => (i > 0 && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).replace(/\bMxd\b/g, "MXD").replace(/\bEtj\b/g, "ETJ");
}
/* $27,500,000 → "$27.5 million", 150000 → "$150,000"; nothing for blank / zero / junk. */
export function money(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n >= 1e6) return `$${(Math.round(n / 1e5) / 10).toString().replace(/\.0$/, "")} million`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}
/* A document link worth offering: an http(s) address on a Sugar Land host, upgraded to https. */
export function cityHref(raw) {
  const s = str(raw);
  if (!/^https?:\/\/[^\s]+$/i.test(s)) return null;
  let u;
  try { u = new URL(s); } catch (_) { return null; }
  if (!/(^|\.)sugarlandtx\.gov$/i.test(u.hostname)) return null;
  u.protocol = "https:";
  return u.toString();
}

export const SUGARLAND_RELAY = "/gis-proxy/interactivemaps.sugarlandtx.gov/512/rest/services";
/* The row's URL: the city's own server goes through the relay (it sends no CORS header); the org's ArcGIS Online is read directly. */
export function relayed(url) {
  const m = /^https:\/\/interactivemaps\.sugarlandtx\.gov\/512\/rest\/services(\/.*)$/.exec(String(url || ""));
  return m ? SUGARLAND_RELAY + m[1] : url;
}
const srcOf = (k) => {
  const s = GIS_SOURCES[k];
  if (!s) throw new Error(`sugarLandLayers: no GIS_SOURCES row "${k}"`);
  return s;
};

const SL = { states: ["TX"], regions: ["sugarland"] };
const feature = (k, o) => {
  const s = srcOf(k);
  return { kind: "esriFeature", ...SL, hoverIdentify: true, canvasIdentify: true, ...o, url: relayed(s.serviceUrl), ...(s.where ? { where: s.where } : {}) };
};
const outline = (color, weight, fillOpacity, dash) => (_p, opacity) => ({ color, weight, opacity, fill: fillOpacity > 0, fillColor: color, fillOpacity: Math.min(fillOpacity, opacity * 0.5), ...(dash ? { dashArray: dash } : {}) });

/* ───────────────────────── Airport zoning ───────────────────────── */
/* The city's own colours for its five airport areas (the layer's renderer, read 2026-11-02). */
export const AIRPORT_AREAS = Object.freeze({
  "AIRPORT PROPERTY": { label: "Airport property", color: "#86b3eb" },
  "ANID": { label: "ANID", color: "#cb88e3" },
  "AVIGATION EASEMENT": { label: "Avigation easement", color: "#84e8d1" },
  "AZ-01": { label: "AZ-01", color: "#ebebb5" },
  "AZ-02": { label: "AZ-02", color: "#de8585" },
});
export const AIRPORT_CODE_URL = "https://library.municode.com/tx/sugar_land/codes/land_development_code?nodeId=CH9SULAREAIZORE";
const airportKey = (p) => str(p && p.TYPE).toUpperCase();
export function airportStyle(props, opacity) {
  const a = AIRPORT_AREAS[airportKey(props)];
  const c = a ? a.color : "#9ca3af";
  return { color: "#6e6e6e", weight: 1.2, opacity, fill: true, fillColor: c, fillOpacity: Math.min(0.5, opacity * 0.6) };
}
/* The card text for each airport area, from the Sugar Land Land Development Code, Chapter 9 (Sugar Land Regional Airport Zoning Regulations), read on Municode 2026-11-02 by the owner:
 *   · AZ-01 = Airport Zoning District 1, AZ-02 = Airport Zoning District 2 (Sec. 9-14, Table 9-14.1). They are LAND USE districts (Art. III), NOT height zones, and "establish additional regulations to
 *     the underlying zoning districts established in Chapter 2" — so the base zoning AND the AZ district both apply.
 *   · Permitted Uses Schedule, Table 9-17.1 (Sec. 9-17, Ord. 2149, 2-19-2019). AZ-01 permits Warehouse and Distribution Facility; Manufacturing, Light; Manufacturing, Heavy; Mini-Warehouse and Self-Storage; wholesale
 *     uses; Railroad Freight Yard. AZ-02 permits Municipal Airport, Railroad Freight Yard and Utilities among the rows read; Warehouse and Distribution, manufacturing and wholesale are blank (prohibited) in AZ-02. Only the
 *     industrial rows and part of the rest were read, so NO full AZ-02 list is written — the card points at the table for the rest.
 *   · Sec. 9-16 plat note for AZ-01 and AZ-02: all residential uses and some nonresidential uses are prohibited.
 *   · ANID = Airport Noise Impact District (Sec. 9-15): no land use restrictions are imposed in it; landowners should consider the noise impact; Sec. 9-16 requires a plat statement.
 *   · AVIGATION EASEMENT and AIRPORT PROPERTY: labels only — no code text was read, so none is claimed.
 * HEIGHT LIMITS ARE NOT HERE and are never shown: they are a separate thing (Art. II, Secs. 9-7 and 9-8 — approach, transitional, horizontal and conical zones on the Airport Height Hazard Zoning Map), and that map is not in this layer. */
const AIRPORT_RESIDENTIAL = { label: "Residential", text: "Prohibited — the Sec. 9-16 plat note: all residential uses and some nonresidential uses." };
const AIRPORT_DISTRICT = (n, name) => ({ label: "What this is", text: `${name} (Sec. 9-14). It adds regulations to the underlying zoning (Chapter 2): both the base zoning and ${n} apply.` });
const AIRPORT_TABLE = { label: "Permitted uses", text: "Open the code", href: AIRPORT_CODE_URL };
export function airportCard(props) {
  const k = airportKey(props);
  const a = AIRPORT_AREAS[k];
  let rows;
  if (k === "AZ-01") {
    rows = [
      { label: "Warehouse & distribution", text: "Permitted here, subject to the base zoning (Sec. 9-17, Table 9-17.1)." },
      { label: "Also permitted", text: "Light manufacturing, heavy manufacturing, mini-warehouse and self-storage, wholesale uses, railroad freight yard (the industrial rows of Table 9-17.1)." },
      AIRPORT_RESIDENTIAL, AIRPORT_DISTRICT("AZ-01", "Airport Zoning District 1"), AIRPORT_TABLE,
    ];
  } else if (k === "AZ-02") {
    rows = [
      { label: "Warehouse & distribution", text: "Not permitted here (Sec. 9-17, Table 9-17.1)." },
      { label: "Also not permitted", text: "Light and heavy manufacturing and wholesale uses (blank in Table 9-17.1)." },
      { label: "Permitted", text: "Includes municipal airport, railroad freight yard and utilities. Table 9-17.1 has the full schedule." },
      AIRPORT_RESIDENTIAL, AIRPORT_DISTRICT("AZ-02", "Airport Zoning District 2"), AIRPORT_TABLE,
    ];
  } else if (k === "ANID") {
    rows = [
      { label: "What this is", text: "Airport Noise Impact District (Sec. 9-15)." },
      { label: "Land use", text: "No land use restrictions are imposed in it. Landowners should consider the noise impact." },
      { label: "Plat", text: "Sec. 9-16 requires a statement on the plat." },
      { label: "Development Code", text: "Open", href: AIRPORT_CODE_URL },
    ];
  } else if (a) {
    rows = [{ label: "Meaning", text: "Label only — the code text for this area was not read." }, { label: "Development Code", text: "Open", href: AIRPORT_CODE_URL }];
  } else rows = [{ label: "Area", text: soft(props && props.TYPE) || "Not named" }];
  return { title: a ? `Airport zoning · ${a.label}` : "Airport zoning", rows };
}

/* ───────────────────────── Future land use ───────────────────────── */
/* The 20 classes of the adopted 2022 map (Future_Land_Use_Map_2022_WFL1 layer 8), by family. A class not listed draws neutral and keeps its own name. */
const FLU_FAMILY = [
  [/AIRPORT/, "#6b7fd7"], [/LIGHT INDUSTRIAL|INDUSTRIAL/, "#7c3aed"], [/REGIONAL ACTIVITY|NEIGHBORHOOD ACTIVITY|COMM SERV|COMMERCIAL/, "#ea580c"],
  [/MIXED|MXD/, "#db2777"], [/INSTITUTIONAL/, "#2563eb"], [/PARKS|OPEN SPACE/, "#16a34a"], [/RURAL|AGRICULT/, "#a3c963"],
  [/ESTATE|SUBURBAN|SINGLE FAMILY|NEIGHBORHOOD/, "#ca8a04"], [/STREETS/, "#9ca3af"], [/RELEASE/, "#64748b"],
];
export const fluColor = (props) => { const k = str(props && props.FUTURE_LAND_USE).toUpperCase(); const f = FLU_FAMILY.find(([re]) => re.test(k)); return f ? f[1] : "#6b7280"; };
export const fluStyle = (props, opacity) => { const c = fluColor(props); return { color: c, weight: 1, opacity, fill: true, fillColor: c, fillOpacity: Math.min(0.4, opacity * 0.55) }; };
export function fluCard(props) {
  const p = props || {};
  return { title: soft(p.FUTURE_LAND_USE) || "Future land use", rows: clean([row("Planning area", soft(p.SUBREGION))]) };
}
export const fluLegend = (features) => {
  const seen = new Map();
  for (const f of features || []) { const p = f && f.properties; const n = soft(p && p.FUTURE_LAND_USE); if (n && !seen.has(n)) seen.set(n, fluColor(p)); }
  return [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([label, color]) => ({ label, color, row: true }));
};

/* ───────────────────────── Hydrants ───────────────────────── */
export function hydrantCard(props) {
  const p = props || {};
  const yr = approvalDate(p.InstallDate);
  return { title: "Fire hydrant", rows: clean([row("ID", p.FacilityID), yr ? { label: "Installed", text: yr } : null]) };
}

/* ───────────────────────── Zoning cases (CUPs · special exceptions · variances) ───────────────────────── */
export const CASE_COLORS = Object.freeze({ cup: "#7c3aed", exception: "#0891b2", variance: "#be123c" });
const ACTION_WORD = (v) => { const t = str(v).toUpperCase(); return !t ? "" : t === "NO ACTION" ? "No action" : t.charAt(0) + t.slice(1).toLowerCase(); };
const CUP_CATEGORY = { "ESTABLISHED NEW": "Established", "ESTABLISHED REPLACEMENT": "Established (replacement)", "PENDING OCCUPANCY": "Pending occupancy" };
export function cupCard(p) {
  p = p || {};
  const when = approvalDate(p.Date_Appro);
  const pdf = cityHref(p.PDF);
  return {
    title: "Conditional use permit",
    rows: clean([
      row("Project", p.Project_Na), row("Request", p.Descriptio), row("District", p.District),
      when ? { label: "Approved", text: when } : null,
      row("Ordinance", p.Ordinance), row("Status", CUP_CATEGORY[str(p.Category).toUpperCase()] || soft(p.Category)),
      pdf ? { label: "Ordinance PDF", text: "Open", href: pdf } : null,
    ]),
  };
}
const caseRows = (p, caseNo, date) => {
  const when = approvalDate(date);
  const act = ACTION_WORD(p.ACTION), res = str(p.RESULT);
  return clean([row("Case", caseNo), when ? { label: "Date", text: when } : null, row("District", p.ZONING_DIS), row("Request", p.REQUEST), has(act) || has(res) ? { label: "Result", text: [act, has(res) ? res : ""].filter(Boolean).join(" — ") } : null]);
};
export const exceptionCard = (p) => ({ title: "Special exception", rows: caseRows(p || {}, (p || {}).Case_No_, (p || {}).DATE_) });
export const varianceCard = (p) => ({ title: "Variance", rows: caseRows(p || {}, (p || {}).CASE_NO, (p || {}).DATE) });

/* ───────────────────────── Capital projects ───────────────────────── */
/* Projects not yet closed out (the 2024 list also holds 76 closed-out, 4 completed and 7 cancelled). */
export const CIP_WHERE = "Status IN ('In Progress','Initiated','Future','ON HOLD')";
export function cipCard(props) {
  const p = props || {};
  return { title: str(p.Title) || "Capital project", rows: clean([row("Phase", p.Phase), row("Status", soft(p.Status)), row("Budget", money(p.Budget))]) };
}

/* ───────────────────────── Public right-of-way and land ───────────────────────── */
const ROW_TYPE = { ROADROW: "Road right-of-way", PARCEL: "Parcel", RESERVE: "Reserve", EASEMENT: "Easement" };
export function rowLandCard(props) {
  const p = props || {};
  const acres = Number(p.LANDSIZEAC);
  return {
    title: str(p.OWNERNAME) || "Public land",
    rows: clean([row("Address", p.SITUS), row("Type", ROW_TYPE[str(p.PARCELTYPE).toUpperCase()] || str(p.PARCELTYPE)), Number.isFinite(acres) && acres > 0 ? { label: "Acres", text: String(Math.round(acres * 100) / 100) } : null]),
  };
}

/* ───────────────────────── Economic development and incentives ───────────────────────── */
export function tirzCard(props) {
  const p = props || {};
  const notes = str(p.TIRZNOTES);
  const acres = Number(p.ACRES);
  return {
    title: str(p.NAME) || "TIRZ",
    rows: clean([
      /^inactive$/i.test(notes) ? { label: "Status", text: "Inactive" } : null,
      has(notes) && !/^inactive$/i.test(notes) ? { label: "Notes", text: notes } : null,
      Number.isFinite(acres) && acres > 0 ? { label: "Acres", text: Math.round(acres).toLocaleString("en-US") } : null,
    ]),
  };
}
export function availableSiteCard(props) {
  const p = props || {};
  return { title: str(p.Name) || "Available site", rows: clean([row("Type", p.Property_Type), row("Owner", p.Ownership), row("Size", p.acres)]) };
}
export function devProjectCard(props) {
  const p = props || {};
  const start = approvalDate(p.Construction_Start), done = approvalDate(p.Completion_Date);
  return {
    title: str(p.Project_Name) || "Development project",
    rows: clean([row("Address", p.Address), row("Status", p.Status), start ? { label: "Construction start", text: start } : null, done ? { label: "Completed", text: done } : null, row("Estimated completion", p.Estimated_Completion)]),
  };
}
const DEV_STATUS_COLOR = (p) => (/completed/i.test(str(p && p.Status)) ? "#6b7280" : "#d97706");

/* ───────────────────────── The registry rows ───────────────────────── */
export const SUGARLAND_MERGE_GROUPS = {
  sl_zoning_cases: {
    label: "Zoning Cases",
    note: "Conditional use permits, special exceptions and variances the City of Sugar Land has decided — one switch for all three.",
  },
};

export const SUGARLAND_LAYERS = {
  /* ---- Roads ---- */
  sl_thoroughfare: feature("slThoroughfare", {
    label: "Thoroughfare Plan", role: "line", group: "access", order: 30, minZoom: 12, source: "City of Sugar Land — Master Thoroughfare Plan",
    fields: ["OBJECTID", "FULL_STREET_NAME", "FUNCTIONAL_CLASS", "SECTION_TYPE", "RECOMMENDED_SECTION", "SECTION_2035", "LANE_NUMBER", "LIFE_CYCLE"],
    styleFn: thoroughfareStyle, legend: thoroughfareLegend(), identifyCard: thoroughfareCard,
    note: "The City of Sugar Land's Master Thoroughfare Plan: freeways, state highways, arterials, major and minor collectors. Click a road for its class, current section, the plan's section and the 2035 section.",
    infoCaveat: "Section codes are the city's cross-section names. Where the plan's 2020 legend lists a code, the card adds its classification (the legend gives classification only — no right-of-way and no definition of the letters); a code not on it, like C4D (the most common here), shows as written. No width is shown. The lane count is the city's per-line figure and reads 2 on most divided four- and six-lane roads. The layer holds almost no not-yet-built roads (3,285 of 3,286 mapped segments lie on an existing street), but the adopted plan draws future roadways as their own lines — use the plan PDF for them.",
  }),
  sl_capital_projects: feature("slCip", {
    label: "Capital Projects", role: "area", group: "access", order: 31, minZoom: 12, source: "City of Sugar Land — Capital Improvement Program",
    fields: ["OBJECTID", "Title", "Phase", "Status", "Budget"],
    color: "#b45309", weight: 1.4, styleFn: outline("#b45309", 1.4, 0.25), identifyCard: cipCard,
    note: "City capital projects not yet closed out — design, bidding and construction — shown at their footprints. Click one for its phase, status and budget.",
    infoCaveat: "The 2024 project list. Closed-out, completed and cancelled projects are left out. Budgets are the city's figures for the project, not for the footprint shown.",
  }),
  /* ---- Zoning ---- */
  sl_zoning: feature("slZoning", {
    label: "Zoning", role: "area", group: "jurisdiction", order: 30, minZoom: 12, source: "City of Sugar Land — Zoning Districts",
    styleFn: zoningStyle, lineLabel: { field: "Zone_Label", minZoom: 14, format: zoneLabelText }, identifyCard: zoningCard,
    viewLegend: (features) => zoningLegend(legendItemsOf(features)),
    note: "Zoning districts within the City of Sugar Land. Colour = district family; the code prints at close zoom; the legend lists the districts in view with the city's own names. Click for the district, ordinance and adoption date.",
    infoCaveat: `Zoning of land inside the city limits only — the ETJ is not zoned. ${ZONING_CITATION} Where the city's own record names a different district than the one drawn, the card says so. Confirm with Planning.`,
  }),
  sl_airport_zoning: feature("slAirportZoning", {
    label: "Airport Zoning", role: "area", group: "jurisdiction", order: 31, minZoom: 11, source: "City of Sugar Land — Airport Zoning",
    styleFn: airportStyle, legend: Object.values(AIRPORT_AREAS).map((a) => ({ label: a.label, color: a.color })), identifyCard: airportCard,
    note: "The Sugar Land Regional Airport's zoning areas in the city's own colours: AZ-01 and AZ-02 (land use districts), ANID (noise impact district), the avigation easement and the airport property. Click for what each allows.",
    infoCaveat: "The Land Development Code, Chapter 9 governs; this summarises Secs. 9-14 to 9-17 (Table 9-17.1, Ord. 2149, 2019). Height limits are on a separate city map (the Airport Height Hazard Zoning Map, Secs. 9-7 and 9-8) that is not in this layer. The avigation easement and airport property are labels only.",
  }),
  sl_flu: feature("slFlu", {
    label: "Future Land Use", role: "area", group: "jurisdiction", order: 32, minZoom: 10, source: "City of Sugar Land — Future Land Use Map (2022)",
    simplifyFactor: 0.75, styleFn: fluStyle, viewLegend: fluLegend, identifyCard: fluCard,
    note: "The city's adopted 2022 Future Land Use Map, by class. Click for the class and planning area.",
    infoCaveat: "The comprehensive plan is not zoning (Tex. Local Gov't Code §213.005). Adopted May 2022 (Ordinance 2263).",
  }),
  sl_zoning_cup: feature("slCups", {
    label: "Conditional Use Permits", mergeGroup: "sl_zoning_cases", role: "area", group: "jurisdiction", order: 33, minZoom: 13, source: "City of Sugar Land — Conditional Use Permits",
    fields: ["FID", "Project_Na", "Descriptio", "District", "Date_Appro", "Ordinance", "Category", "PDF"],
    color: CASE_COLORS.cup, weight: 1.4, styleFn: outline(CASE_COLORS.cup, 1.4, 0.3), legend: [{ label: "Conditional use permit", color: CASE_COLORS.cup }, { label: "Special exception", color: CASE_COLORS.exception }, { label: "Variance", color: CASE_COLORS.variance }],
    identifyCard: cupCard,
    note: "Conditional use permits (69, 1998–2024).", infoCaveat: "Decided cases only; the city's list was last edited 2025-10-13 and its newest variance is from 2016.",
  }),
  sl_zoning_exception: feature("slSpecialExceptions", {
    label: "Special Exceptions", mergeGroup: "sl_zoning_cases", role: "area", group: "jurisdiction", order: 34, minZoom: 15, source: "City of Sugar Land — Special Exceptions",
    fields: ["FID", "Case_No_", "DATE_", "ZONING_DIS", "REQUEST", "ACTION", "RESULT"],
    color: CASE_COLORS.exception, weight: 1.2, styleFn: outline(CASE_COLORS.exception, 1.2, 0.3), identifyCard: exceptionCard,
    note: "Special exceptions (244, mostly setback relief).",
  }),
  sl_zoning_variance: feature("slVariances", {
    label: "Variances", mergeGroup: "sl_zoning_cases", role: "area", group: "jurisdiction", order: 35, minZoom: 15, source: "City of Sugar Land — Variances",
    fields: ["FID", "CASE_NO", "DATE", "ZONING_DIS", "REQUEST", "ACTION", "RESULT"],
    color: CASE_COLORS.variance, weight: 1.2, styleFn: outline(CASE_COLORS.variance, 1.2, 0.3), identifyCard: varianceCard,
    note: "Variances (160, the newest from 2016).",
  }),
  /* ---- Land ---- */
  sl_public_land: feature("slRowLand", {
    label: "Public Right-of-Way & Land", role: "area", group: "jurisdiction", order: 36, minZoom: 16, source: "City of Sugar Land — ROW and Property, Public Entities",
    fields: ["OBJECTID", "OWNERNAME", "SITUS", "PARCELTYPE", "LANDSIZEAC"],
    color: "#0f766e", weight: 1, simplifyFactor: 0.75, styleFn: outline("#0f766e", 1, 0.22), identifyCard: rowLandCard,
    note: "Ground owned by public entities — the city, Fort Bend County, the State, TxDOT, neighbouring cities, ISDs and districts — including road right-of-way. Loads at close zoom. Click for owner and address.",
    infoCaveat: "The city's compilation from the appraisal district's roll; a sale not yet in the roll is not shown. Not a survey.",
  }),
  /* ---- Economic development and incentives ---- */
  sl_tirz: feature("slTirz", {
    label: "Tax Increment Zones (TIRZ)", role: "area", group: "jurisdiction", order: 37, minZoom: 10, source: "City of Sugar Land — Tax Increment Reinvestment Zones",
    color: "#a16207", weight: 1.6, styleFn: outline("#a16207", 1.6, 0.18, "8 5"), lineLabel: { field: "NAME", minZoom: 11, format: (v) => str(v) || null }, identifyCard: tirzCard,
    note: "The city's four tax increment reinvestment zones; TIRZ 2 is inactive.", infoCaveat: "A zone boundary, not a statement of what the zone funds today.",
  }),
  sl_available_sites: feature("slAvailableSites", {
    label: "Available Sites", role: "area", group: "jurisdiction", order: 38, minZoom: 12, source: "City of Sugar Land — Economic Development",
    color: "#be185d", weight: 1.4, styleFn: outline("#be185d", 1.4, 0.28), identifyCard: availableSiteCard,
    note: "Sites the City of Sugar Land's economic development office lists as available (23, Imperial and the airport).", infoCaveat: "The city's marketing list, last edited 2022-05-11 — a listing may be sold or off the market.",
  }),
  sl_dev_projects: feature("slDevProjects", {
    label: "Development Projects", role: "area", group: "jurisdiction", order: 39, minZoom: 12, source: "City of Sugar Land — Development Project Tracker",
    fields: ["OBJECTID", "Project_Name", "Address", "Status", "Construction_Start", "Completion_Date", "Estimated_Completion"],
    color: "#d97706", weight: 1.4, styleFn: (p, opacity) => { const c = DEV_STATUS_COLOR(p); return { color: c, weight: 1.4, opacity, fill: true, fillColor: c, fillOpacity: Math.min(0.28, opacity * 0.5) }; },
    legend: [{ label: "In progress", color: "#d97706" }, { label: "Completed", color: "#6b7280" }], identifyCard: devProjectCard,
    note: "Development projects the city is tracking through construction (47). Click for the address, status and dates.", infoCaveat: "Contractor and superintendent contacts in the city's tracker are not requested or shown.",
  }),
  /* ---- Utilities ---- */
  sl_hydrants: feature("slHydrants", {
    label: "Hydrants", mergeGroup: "fire_hydrants", role: "point", group: "utilities", order: 21, minZoom: 16, source: "City of Sugar Land — Hydrant Inspections",
    color: "#dc2626", weight: 1.5, pointRadius: 4, fields: ["OBJECTID", "FacilityID", "InstallDate"], identifyCard: hydrantCard,
    note: "City of Sugar Land fire hydrants — the closest public trace of where water mains run.",
    infoCaveat: "Hydrants only: the city does not publish water or sewer lines. The layer was last edited 2021-02-23 and carries an ID on about 1 in 6 hydrants. Removed and abandoned hydrants are left out.",
  }),
};

/* Vintage lines for the (i) popover — the dates the publisher's own layers report (2026-11-02). */
export const SUGARLAND_VINTAGE = {
  sl_thoroughfare: "City of Sugar Land Master Thoroughfare Plan layer (map document 2026); plan adopted by Ordinance 2167, February 2020",
  sl_capital_projects: "City of Sugar Land CIP database, 2024 public edition — layer edited 2026-11-02",
  sl_zoning: "City of Sugar Land zoning layer — current edition; ordinance dates run through 2023",
  sl_airport_zoning: "City of Sugar Land airport zoning layer — current edition",
  sl_flu: "City of Sugar Land Future Land Use Map — adopted May 2022 (Ordinance 2263); layer edited 2022-06-30",
  sl_zoning_cup: "City of Sugar Land conditional use permits — layer edited 2025-10-13; newest permit 2024-11-05",
  sl_zoning_exception: "City of Sugar Land special exceptions — layer edited 2025-10-13; newest case 2024-01-17",
  sl_zoning_variance: "City of Sugar Land variances — layer edited 2025-10-13; newest case 2016-10-19",
  sl_public_land: "City of Sugar Land ROW and Property, Public Entities — current edition",
  sl_tirz: "City of Sugar Land TIRZ boundaries — layer edited 2026-04-30",
  sl_available_sites: "City of Sugar Land economic development listing — layer edited 2022-05-11",
  sl_dev_projects: "City of Sugar Land development project tracker — layer edited 2026-10-09",
  sl_hydrants: "City of Sugar Land hydrant inspection layer — last edited 2021-02-23",
};

/* ───────────────────────── Utilities honesty (owner: tell people why, offer the route) ───────────────────────── */
export const UTILITY_MAP_REQUEST_URL = "https://survey123.arcgis.com/share/a9755767526546b5a9509d1648399862";
export const SUGARLAND_UTILITY_NOTE = Object.freeze({
  text: "Sugar Land does not publish water or sewer lines.",
  linkText: "Request utility maps from the city",
  href: UTILITY_MAP_REQUEST_URL,
});
/* The note a panel group carries at a site: { text, linkText, href } | null. Only the Utilities group, only inside the Sugar Land area. */
export function sugarLandGroupNote(groupKey, inSugarLand) {
  return groupKey === "util" && inSugarLand === true ? SUGARLAND_UTILITY_NOTE : null;
}

export { normalizeZone };
