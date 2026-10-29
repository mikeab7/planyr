/* Mississippi — the statewide due-diligence layer rows (NEW-1, 2026-10-29), plus DeSoto County's flood / drainage / cemetery layers the first DeSoto pass left out.
 *
 * Every row declares `states: ["MS"]` (the DeSoto County ones also `regions: ["desoto"]`), so a Texas, Georgia, Tennessee or Colorado site never lists them and the map's draw
 * filter turns them off before any request. Each reads its own `GIS_SOURCES` row (src/shared/gis/sources.js — provider, live probe date, fixtures) and is reached through the
 * same-origin `/gis-proxy` relay: the MDEQ, MARIS and DeSoto hosts are not reachable from the build sandbox and their CORS headers were never read, so the relay is what the app
 * depends on (MEASURED through planyr.io on 2026-10-29). Federal sources (EPA, NPS, USFWS, BIA) are read directly from the agencies' ArcGIS Online services.
 *
 * WHAT IS NOT HERE, AND WHY, is on the backlog item (B2536480): no statewide stream / wetland buffer rule exists in the sources found (a buffer width is never drawn without a rule
 * behind it), airport-noise contours are not published as a service, MDAH's historic inventory and the 16th-section school lands have no open service, and several MARIS services are
 * empty shells. Site Analysis verdicts are untouched — these are map layers only.
 *
 * PURE: no network, no React — the colour rules and click cards below unit-test standalone (test/mississippiLayers.test.js). */

import { GIS_SOURCES } from "../../../shared/gis/sources.js";
import { approvalDate } from "./desotoZoning.js";
import { titleCase } from "./desotoJurisdiction.js";

/* The hosts reached through the relay (everything else — arcgis.com — is read directly). */
const RELAYED_HOSTS = new Set(["gis.deq.ms.gov", "opcgis.deq.state.ms.us", "gis.mississippi.edu", "gis.desotocountyms.gov"]);
export function relayed(url) {
  const m = /^https:\/\/([^/]+)(\/.*)$/.exec(String(url || ""));
  return m && RELAYED_HOSTS.has(m[1]) ? `/gis-proxy/${m[1]}${m[2]}` : url;
}

const str = (v) => (v == null ? "" : String(v).trim());
const has = (v) => { const t = str(v); return !!t && !/^(null|none|n\/?a|<null>)$/i.test(t); };
const row = (label, v, extra) => (has(v) ? { label, text: str(v), ...(extra || {}) } : null);
const link = (label, href) => (/^https?:\/\//i.test(str(href)) ? { label, text: "Open", href: str(href) } : null);
const clean = (rows) => rows.filter(Boolean);
const num1 = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? (n >= 100 ? Math.round(n).toLocaleString("en-US") : String(Math.round(n * 10) / 10)) : null; };
const place = (...parts) => parts.map(str).filter((t) => t && !/^null$/i.test(t)).join(", ");

/* ---------------- the colour rules (legend and map read the same table) ---------------- */

export const UST_CLASSES = {
  open: { label: "Open release", color: "#b91c1c", radius: 5 },
  active: { label: "In service, no release reported", color: "#854d0e", radius: 3.5 },
  closed: { label: "Closed / out of use", color: "#78716c", radius: 3 },
};
/* MDEQ's RELEASE_STATUS is "Open Release" / "No Release"; STATUS is Active / Closed / Confirmed Release / Unconfirmed Release / Closed Release. An open release wins over the tank's own status. */
export const ustClass = (p) => (/open/i.test(str(p && p.RELEASE_STATUS)) ? "open" : /^active$/i.test(str(p && p.STATUS)) ? "active" : "closed");

export const GARD_CLASSES = {
  npl: { label: "Federal Superfund (NPL)", color: "#b91c1c", radius: 6 },
  active: { label: "Active state site", color: "#c2410c", radius: 5 },
  other: { label: "Inactive / other status", color: "#78716c", radius: 4 },
};
export const gardClass = (p) => (/^npl/i.test(str(p && p.FEDERALSTATUS)) ? "npl" : /^active$/i.test(str(p && p.STATESTATUS)) ? "active" : "other");

export const WELL_CLASSES = {
  active: { label: "Producing, injecting or stand-by", color: "#b45309", radius: 3.5 },
  plugged: { label: "Plugged and abandoned", color: "#64748b", radius: 3 },
  orphaned: { label: "Orphaned or plugging unverified", color: "#a21caf", radius: 4 },
  other: { label: "Monitor, water source, other", color: "#0f766e", radius: 3 },
};
const WELL_ACTIVE = new Set(["PR", "CI", "AI", "SB", "TA", "DG", "PWP", "CPLNP"]);
const WELL_PLUGGED = new Set(["PA", "PAS", "DA", "JA", "AA"]);
const WELL_ORPHAN = new Set(["OPA", "O", "APA", "APS", "AUS"]);
/* The Board's status description starts with its code ("PA - Plugged and Abandoned", "O - Orphaned Well", "DWW Domestic Water Well"). */
export function wellClass(p) {
  const m = /^([A-Z]+)\b/.exec(str(p && p.statdesc));
  const code = m ? m[1] : "";
  return WELL_ORPHAN.has(code) ? "orphaned" : WELL_PLUGGED.has(code) ? "plugged" : WELL_ACTIVE.has(code) ? "active" : "other";
}

export const LANDFILL_CLASSES = {
  active: { label: "Active", color: "#7c2d12", radius: 5 },
  closed: { label: "Closed / inactive", color: "#78716c", radius: 4 },
};
export const landfillClass = (p) => (/^active$/i.test(str(p && p.Status)) ? "active" : "closed");

export const DAM_CLASSES = {
  high: { label: "High hazard", color: "#b91c1c", radius: 5.5 },
  significant: { label: "Significant hazard", color: "#c2410c", radius: 4.5 },
  low: { label: "Low hazard", color: "#64748b", radius: 3.5 },
  other: { label: "Breached / unclassified", color: "#94a3b8", radius: 3 },
};
export const DAM_HAZARD_WORD = { H: "High", S: "Significant", L: "Low" };
export const damClass = (p) => { const h = str(p && p.HAZRDCLASS).toUpperCase(); return h === "H" ? "high" : h === "S" ? "significant" : h === "L" ? "low" : "other"; };

const legendOf = (classes) => Object.values(classes).map((c) => ({ label: c.label, color: c.color }));
const pointFn = (classes, classOf) => (p) => { const c = classes[classOf(p)] || {}; return { color: c.color, radius: c.radius }; };

/* ---------------- the click cards ---------------- */

const gardProgram = (v) => { const t = str(v); return /^bf$/i.test(t) ? "Brownfield" : /^vep$/i.test(t) ? "Voluntary Evaluation Program" : t; };
export function gardCard(p) {
  p = p || {};
  return {
    title: str(p.SITENAME) || "Contaminated site",
    rows: clean([
      row("Address", place(p.SITEADDRESS, p.SITECITY)),
      row("County", p.SITECOUNTY),
      row("Program", gardProgram(p.TYPECLEAN)),
      row("State status", p.STATESTATUS),
      row("Federal status", p.FEDERALSTATUS),
      row("Main contaminant", p.MAJCONT),
      row("Discovered", approvalDate(p.DATEDISCV)),
      row("Acres", num1(p.SITEACRES)),
    ]),
    note: "Status codes are MDEQ's as published.",
  };
}
export function ustCard(p) {
  p = p || {};
  return {
    title: str(p.FACILITY_NAME) || "Tank facility",
    rows: clean([
      row("Address", place(p.ADDRESS, p.CITY)),
      row("Tank status", p.STATUS),
      row("Release", p.RELEASE_STATUS),
      row("Tanks", p.TOTAL_TANKS),
      row("Owner", p.OWNER_NAME),
    ]),
  };
}
export function landfillCard(p) {
  p = p || {};
  return {
    title: str(p.Facility_N) || "Solid-waste facility",
    rows: clean([row("Type", p.Facility_T), row("Status", p.Status), row("County", p.County), row("Acres", num1(p.Acres)), row("Permit", p.Permit__)]),
  };
}
export function wellCard(p) {
  p = p || {};
  return { title: "Oil or gas well", rows: clean([row("Type", p.typedesc), row("Status", p.statdesc), row("API no.", p.API)]) };
}
export function damCard(p) {
  p = p || {};
  const eap = str(p.Online_EAP), insp = str(p.Online_Inspect);
  const ok = (u) => /^https:\/\/landandwater\.deq\.ms\.gov\//i.test(u);
  return {
    title: str(p.DAMNAME) || "Dam",
    rows: clean([
      row("County", titleCase(p.COUNTYNAME)),
      row("Hazard class", DAM_HAZARD_WORD[str(p.HAZRDCLASS).toUpperCase()] || str(p.HAZRDCLASS)),
      row("Height", has(p.Dam_Height) ? `${str(p.Dam_Height)} ft` : null),
      row("Condition", p.CONDITION),
      ok(eap) ? link("Emergency action plan", eap) : null,
      ok(insp) ? link("Inspection report", insp) : null,
    ]),
    note: "Hazard class is the consequence if the dam failed, not its condition.",
  };
}
export function lomrCard(p) {
  p = p || {};
  return { title: "FEMA map revision (LOMR)", rows: clean([row("FEMA case", p.CASE_NO), row("Effective", approvalDate(p.EFF_DATE)), link("FEMA letter", p.LINK_1), link("FEMA letter", p.LINK_2), link("FEMA letter", p.LINK_3)]) };
}
export function lomaCard(p) {
  p = p || {};
  const rows = [];
  for (let i = 1; i <= 5; i++) { rows.push(row("FEMA case", p[`CASE_NO_${i}`])); rows.push(link("FEMA letter", p[`LINK_${i}`])); }
  return { title: "FEMA map amendment (LOMA)", rows: clean(rows) };
}

/* ---------------- the rows ---------------- */

const MS = { states: ["MS"] };
const DESOTO = { states: ["MS"], regions: ["desoto"] };
const srcOf = (k) => {
  const s = GIS_SOURCES[k];
  if (!s) throw new Error(`mississippiLayers: no GIS_SOURCES row "${k}"`);
  return s;
};
const feature = (k, o) => {
  const s = srcOf(k);
  return { kind: "esriFeature", hoverIdentify: true, canvasIdentify: true, ...o, url: relayed(s.serviceUrl), ...(s.where ? { where: s.where } : {}) };
};
const outline = (color, weight, fillOpacity, dash) => (_p, opacity) => ({ color, weight, opacity, fill: fillOpacity > 0, fillColor: color, fillOpacity: Math.min(fillOpacity, opacity * 0.5), ...(dash ? { dashArray: dash } : {}) });

export const MISSISSIPPI_LAYERS = {
  /* ---- Jurisdictions ---- */
  ms_city: feature("msCity", {
    ...MS, label: "City Limits (Mississippi)", mergeGroup: "counties_cities", role: "line", group: "jurisdiction", order: 6, minZoom: 9,
    source: "Mississippi Statewide Governmental Boundaries Layer (MARIS)", color: "#1d4ed8", weight: 1.6, fields: ["Name", "County", "Population", "Year_Incor", "Boundary_U"],
    styleFn: (_p, opacity) => ({ color: "#1d4ed8", weight: 3, opacity, fill: true, fillColor: "#1d4ed8", fillOpacity: 0.12, className: "pf-boundary-hit" }),
    lineLabel: { field: "Name", minZoom: 9, declutter: true, format: (v) => str(v) || null },
    identifyCard: (p) => ({ title: `${str(p && p.Name) || "City"} city limits`, rows: clean([row("County", p && p.County), row("Population", p && p.Population ? Number(p.Population).toLocaleString("en-US") : null), row("Incorporated", p && p.Year_Incor)]) }),
    note: "Mississippi's 300 incorporated places (MARIS statewide governmental boundaries, 2025). Inside = in the city; outside = unincorporated county. Mississippi has no ETJ. DeSoto County's five cities come from the county's own layer.",
    infoCaveat: "A boundary means the city HAS JURISDICTION here — not that it serves or will connect utilities to a parcel. Each city's boundary was last updated in a different year (the layer records it); annexations after that are not drawn.",
  }),
  ms_tribal: feature("msTribal", {
    ...MS, label: "Tribal Lands", role: "area", group: "jurisdiction", order: 10, minZoom: 6,
    source: "U.S. Bureau of Indian Affairs — land area representations", color: "#9a3412", weight: 1.6, fields: ["LARName", "GISAcres"],
    styleFn: outline("#9a3412", 1.6, 0.18),
    lineLabel: { field: "LARName", minZoom: 9, format: (v) => str(v).replace(/\s+LAR$/i, "") || null },
    identifyCard: (p) => ({ title: str(p && p.LARName).replace(/\s+LAR$/i, "") || "Tribal land", rows: clean([row("Acres", num1(p && p.GISAcres))]), note: "Federal and tribal jurisdiction apply on tribal trust land." }),
    note: "Federally recognized tribal land boundaries (BIA). In Mississippi these are the Mississippi Band of Choctaw's trust lands in the east-central and southern counties. Tribal and federal law, not county zoning, governs on this land.",
    infoCaveat: "BIA land area representations — a mapped representation, not a survey. Confirm the status of any parcel near a boundary with the Bureau and the Tribe.",
  }),
  /* ---- Environmental ---- */
  ms_deq_gard: feature("msDeqGard", {
    ...MS, label: "Contaminated Sites", role: "point", group: "environmental", order: 30, minZoom: 10, source: "MDEQ — Groundwater Assessment & Remediation Division",
    color: "#c2410c", weight: 1.5, pointRadius: 5, fields: ["SITENAME", "SITEADDRESS", "SITECITY", "SITECOUNTY", "TYPECLEAN", "STATESTATUS", "FEDERALSTATUS", "MAJCONT", "DATEDISCV", "SITEACRES"],
    pointStyleFn: pointFn(GARD_CLASSES, gardClass), legend: legendOf(GARD_CLASSES), identifyCard: gardCard,
    note: "MDEQ's list of uncontrolled-release and CERCLA sites — state-lead cleanups, Brownfield and Voluntary Evaluation Program sites, and Superfund. A Phase I ESA pre-screen, not a substitute: a site beside the property is a flag to pull MDEQ's file.",
    infoCaveat: "The point is MDEQ's recorded location, not the extent of contamination. Status codes (e.g. SNFA, BNFA) are MDEQ's as published — ask its Groundwater Assessment & Remediation Division what a code means for a given site.",
  }),
  ms_deq_ust: feature("msDeqUst", {
    ...MS, label: "Underground Storage Tanks", role: "point", group: "environmental", order: 31, minZoom: 12, source: "MDEQ — Underground Storage Tank program (MUSTER)",
    color: "#854d0e", weight: 1.5, pointRadius: 3.5, fields: ["FACILITY_NAME", "ADDRESS", "CITY", "STATUS", "RELEASE_STATUS", "TOTAL_TANKS", "OWNER_NAME"],
    pointStyleFn: pointFn(UST_CLASSES, ustClass), legend: legendOf(UST_CLASSES), identifyCard: ustCard,
    note: "Every facility in MDEQ's tank repository, in service or closed, coloured by release status: red = an open (unresolved) release is on record. A Phase I ESA pre-screen — pull MDEQ's file for any facility on or next to the site.",
    infoCaveat: "A register of tank facilities with their release status — it does not say how large a release was or where on the lot. Locations are MDEQ's.",
  }),
  ms_epa_brownfields: feature("msBrownfields", {
    ...MS, label: "Brownfield Properties", role: "point", group: "environmental", order: 32, minZoom: 11, source: "U.S. EPA — ACRES brownfields",
    color: "#0f766e", weight: 1.5, pointRadius: 4, fields: ["PRIMARY_NAME", "LOCATION_ADDRESS", "CITY_NAME", "FAC_URL"],
    identifyCard: (p) => ({ title: str(p && p.PRIMARY_NAME) || "Brownfield property", rows: clean([row("Address", place(p && p.LOCATION_ADDRESS, p && p.CITY_NAME)), link("EPA record", p && p.FAC_URL)]) }),
    note: "Properties EPA tracks in its brownfields database (assessment, cleanup and reuse). The state's own brownfield-program sites are on Contaminated Sites.",
    infoCaveat: "EPA's federal ACRES records — a property being on the list is a flag to read its file, not a finding of contamination.",
  }),
  ms_deq_landfills: feature("msDeqLandfills", {
    ...MS, label: "Landfills", role: "point", group: "environmental", order: 33, minZoom: 10, source: "MDEQ — solid-waste facilities",
    color: "#7c2d12", weight: 1.5, pointRadius: 5, fields: ["Facility_N", "Facility_T", "Status", "County", "Acres", "Permit__"],
    pointStyleFn: pointFn(LANDFILL_CLASSES, landfillClass), legend: legendOf(LANDFILL_CLASSES), identifyCard: landfillCard,
    note: "Permitted solid-waste facilities, closed and inactive ones included: municipal and industrial landfills, rubbish sites, tire sites. Fill, settlement and landfill gas make ground on or beside a closed landfill a geotechnical and environmental question.",
    infoCaveat: "One point per facility, not the waste footprint; old unpermitted dumps are not on this list.",
  }),
  ms_deq_mines: feature("msDeqMines", {
    ...MS, label: "Surface Mines", role: "area", group: "environmental", order: 34, minZoom: 11, source: "MDEQ — Surface Mining",
    color: "#a16207", weight: 1.4, fields: ["PermitNumber", "Acres", "PERMITTED"], styleFn: outline("#a16207", 1.4, 0.22),
    identifyCard: (p) => ({ title: "Surface mine permit", rows: clean([row("Permit", p && p.PermitNumber), row("Acres", num1(p && p.Acres)), row("Permitted", p && /^yes$/i.test(str(p.PERMITTED)) ? "Yes" : p && p.PERMITTED)]) }),
    note: "MDEQ surface-mining permit boundaries — sand, gravel, clay and borrow pits, active and released. Mined or backfilled ground is a geotechnical flag.",
    infoCaveat: "Permit boundaries as MDEQ maps them; a released permit may be reclaimed. The polygons carry the permit number and acres only.",
  }),
  ms_ogb_wells: feature("msOgbWells", {
    ...MS, label: "Oil & Gas Wells", role: "point", group: "environmental", order: 35, minZoom: 12, source: "Mississippi State Oil and Gas Board (via MARIS)",
    color: "#b45309", weight: 1.2, pointRadius: 3.5, fields: ["typedesc", "statdesc", "API"],
    pointStyleFn: pointFn(WELL_CLASSES, wellClass), legend: legendOf(WELL_CLASSES), identifyCard: wellCard,
    note: "Wells regulated by the State Oil and Gas Board — producing, injection, dry holes and plugged wells. Purple = orphaned, or plugged with no record: the wells most likely to be a surprise on a development site.",
    infoCaveat: "Surface locations from the Board's July 2025 data, republished by MARIS (the Board publishes no open map service). A plugged well is still a setback and re-entry issue — confirm with the Board and on the title.",
  }),
  ms_deq_og_fields: feature("msDeqOgFields", {
    ...MS, label: "Oil & Gas Fields", role: "area", group: "environmental", order: 36, minZoom: 8, source: "MDEQ — Office of Geology",
    color: "#ca8a04", weight: 1.2, fields: ["FIELD_NM"], styleFn: outline("#ca8a04", 1.2, 0.16),
    lineLabel: { field: "FIELD_NM", minZoom: 11, format: (v) => str(v) || null },
    identifyCard: (p) => ({ title: str(p && p.FIELD_NM) || "Oil or gas field" }),
    note: "Generalized outlines of Mississippi's oil and gas fields. An outline is a producing area, not a surface restriction — check the title for mineral reservations and surface-use rights.",
    infoCaveat: "Generalized by MDEQ's Office of Geology; not a lease or unit boundary.",
  }),
  ms_deq_spa: feature("msDeqSpa", {
    ...MS, label: "Source Water Protection Areas", role: "area", group: "environmental", order: 37, minZoom: 10, source: "MDEQ — Source Water Assessment Program",
    color: "#0369a1", weight: 1.3, fields: ["PWS_ID"], styleFn: outline("#0369a1", 1.3, 0.14, "6 4"),
    identifyCard: (p) => ({ title: "Source water protection area", rows: clean([row("Public water system ID", p && p.PWS_ID)]), note: "Protection area around a public water-supply source." }),
    note: "Delineated protection areas around public drinking-water sources. Mississippi's program is a state assessment, not a statewide land-use rule — a city or county may add its own limits inside one.",
    infoCaveat: "MDEQ's delineations carry only the public water system ID. Ask the county or city planning office whether a wellhead overlay applies.",
  }),
  ms_nrcs_easements: feature("msNrcsEasements", {
    ...MS, label: "Conservation Easements (NRCS)", role: "area", group: "environmental", order: 38, minZoom: 10, source: "USDA NRCS (via MARIS)",
    color: "#15803d", weight: 1.4, fields: ["Program", "County", "CalcAcres"], styleFn: outline("#15803d", 1.4, 0.25),
    identifyCard: (p) => ({ title: "NRCS conservation easement", rows: clean([row("Program", p && p.Program), row("County", p && p.County), row("Acres", num1(p && p.CalcAcres))]), note: "Easements like these typically bar development on the easement area." }),
    note: "USDA wetland-reserve and similar conservation easements. These typically prohibit development and drainage changes on the easement area, and the federal government holds the right.",
    infoCaveat: "NRCS's aggregated, approximate boundaries (2024) republished by MARIS — read the recorded easement before relying on a line.",
  }),
  ms_nrhp: feature("msNrhp", {
    ...MS, label: "Historic Places", role: "point", group: "environmental", order: 39, minZoom: 11, source: "National Park Service — National Register of Historic Places",
    color: "#6d28d9", weight: 1.5, pointRadius: 4, fields: ["RESNAME", "ResType", "City", "County"],
    identifyCard: (p) => ({ title: str(p && p.RESNAME) || "Historic place", rows: clean([row("Type", p && p.ResType), row("City", p && p.City), row("County", p && p.County)]) }),
    note: "National Register listings — one point per listing (a district is one point, not its boundary). Mississippi's own historic-resources inventory (MDAH) is not an open service, so recorded-but-unlisted sites are NOT here. A flag to check with MDAH, not a clearance.",
    infoCaveat: "NPS listings through Esri Federal Data. Federal or state permits on a listed property trigger Section 106 review.",
  }),
  ms_cemeteries: feature("msCemeteries", {
    ...MS, label: "Cemeteries", role: "point", group: "environmental", order: 40, minZoom: 12, source: "USGS — GNIS cemeteries",
    color: "#475569", weight: 1.5, pointRadius: 3.5, fields: ["NAME", "CITY", "STATE"],
    identifyCard: (p) => ({ title: str(p && (p.NAME || p.name)) || "Cemetery", rows: clean([row("City", p && (p.CITY || p.city))]) }),
    note: "INCOMPLETE: recorded cemeteries only. An unrecorded family burial ground is NOT on this layer, so an empty map is never proof of none. A burial ground on the site is a hard constraint — ask the county and have it surveyed.",
    infoCaveat: "USGS National Map (GNIS) points; no single edition date.",
  }),
  ms_crit_habitat: feature("msCritHabitat", {
    ...MS, label: "Critical Habitat", role: "area", group: "environmental", order: 42, minZoom: 8, source: "U.S. Fish & Wildlife Service",
    color: "#15803d", weight: 1.5, fields: ["comname", "sciname", "listing_status"], styleFn: outline("#15803d", 1.5, 0.5),
    identifyCard: (p) => ({ title: str(p && p.comname) || "Critical habitat", rows: clean([row("Species", p && p.sciname), row("Listing", p && p.listing_status)]) }),
    note: "USFWS final critical habitat (Mississippi has the gopher frog, pearl darter, black pinesnake, sandhill crane and several mussels). It binds FEDERAL actions, not private land directly — but a Corps wetlands permit is a federal action, so it matters wherever there is a stream or wetland. USFWS IPaC is the authoritative species list.",
    infoCaveat: "A screen, not a species survey.",
  }),
  ms_303d: feature("ms303d", {
    ...MS, label: "Impaired Streams", role: "line", group: "environmental", order: 43, minZoom: 10, source: "MDEQ — 2024 Section 303(d) list",
    color: "#7c3aed", weight: 2, fields: ["WATER_BODY_NAME", "POLLUTANT", "LOCATION", "BASIN"],
    identifyCard: (p) => ({ title: str(p && p.WATER_BODY_NAME) || "Impaired stream", rows: clean([row("Impairment", p && p.POLLUTANT), row("Reach", p && p.LOCATION), row("Basin", p && p.BASIN)]) }),
    note: "Stream reaches MDEQ lists as impaired under Clean Water Act section 303(d) (2024 list). Construction-stormwater discharge to or above an impaired water can carry added limits.",
    infoCaveat: "Streams only — the four impaired lakes are not drawn. A reach not listed has not necessarily been assessed.",
  }),
  /* ---- Flood & drainage ---- */
  ms_dams: feature("msDams", {
    ...MS, label: "Dams", role: "point", group: "flood", order: 30, minZoom: 11, source: "MDEQ — Dam Safety",
    color: "#64748b", weight: 1.4, pointRadius: 4, fields: ["DAMNAME", "COUNTYNAME", "HAZRDCLASS", "Dam_Height", "CONDITION", "Online_EAP", "Online_Inspect"],
    pointStyleFn: pointFn(DAM_CLASSES, damClass), legend: legendOf(DAM_CLASSES), identifyCard: damCard,
    note: "State-inventoried dams, coloured by hazard class (what failure would put at risk, not how sound the dam is). Click for height, condition and the emergency action plan and inspection report where MDEQ posts them.",
    infoCaveat: "MDEQ Dam Safety inventory. Small private ponds below the state's size threshold may be missing.",
    floodTier: "hydrography", agency: "MDEQ",
  }),
  ms_dam_inundation: feature("msDamInundation", {
    ...MS, label: "Dam Breach Inundation", role: "area", group: "flood", order: 31, minZoom: 10, source: "MDEQ — Dam Safety",
    color: "#1d4ed8", weight: 1.2, fields: ["DamName", "County", "DamHeight"], styleFn: outline("#1d4ed8", 1.2, 0.2, "5 3"),
    identifyCard: (p) => ({ title: "Dam breach inundation area", rows: clean([row("Dam", titleCase(p && p.DamName)), row("County", titleCase(p && p.County)), row("Dam height", p && has(p.DamHeight) ? `${str(p.DamHeight)} ft` : null)]), note: "Ground that could flood if this dam failed." }),
    note: "Modeled areas that could flood if a dam failed. Only dams MDEQ has studied have one — no polygon does not mean no risk. Advisory, not a regulatory floodplain.",
    infoCaveat: "322 modeled inundation areas from MDEQ Dam Safety. Never treat as a FEMA flood zone.",
    floodTier: "advisory", agency: "MDEQ",
  }),
  ms_desoto_drainage: feature("msDesotoDrainage", {
    ...DESOTO, label: "Drainage Districts (DeSoto County)", role: "area", group: "flood", order: 32, minZoom: 9, source: "DeSoto County GIS",
    color: "#0f766e", weight: 1.4, fields: ["District"], styleFn: outline("#0f766e", 1.4, 0.12, "6 4"),
    lineLabel: { field: "District", minZoom: 11, format: (v) => str(v) || null },
    identifyCard: (p) => ({ title: str(p && p.District) ? `${str(p.District)} drainage district` : "Drainage district", note: "The district may review work in its channels and easements." }),
    note: "DeSoto County's drainage districts. A district can own channels and easements and review drainage work inside it — confirm with the district before designing outfalls.",
    infoCaveat: "County GIS boundaries; the districts' own rules and fees are not in the data.",
    floodTier: "local", agency: "DeSoto County",
  }),
  ms_desoto_levee: feature("msDesotoLevee", {
    ...DESOTO, label: "Delta Levee District (DeSoto County)", role: "area", group: "flood", order: 33, minZoom: 9, source: "DeSoto County GIS",
    color: "#7e22ce", weight: 1.4, styleFn: outline("#7e22ce", 1.4, 0.1, "8 4"),
    identifyCard: () => ({ title: "Yazoo–Mississippi Delta Levee District", note: "Levee-board approval can be required for work near levees and ditches in the district." }),
    note: "The part of the Yazoo–Mississippi Delta Levee District in western DeSoto County. A levee board can require permits and assess fees inside its district.",
    infoCaveat: "County GIS outline; ask the levee board which works need its approval.",
    floodTier: "local", agency: "DeSoto County",
  }),
  ms_desoto_lomr: feature("msDesotoLomr", {
    ...DESOTO, label: "FEMA Map Revisions (LOMR)", role: "area", group: "flood", order: 34, minZoom: 10, source: "DeSoto County GIS — FEMA Letters of Map Revision",
    color: "#be185d", weight: 1.4, fields: ["CASE_NO", "EFF_DATE", "LINK_1", "LINK_2", "LINK_3"], styleFn: outline("#be185d", 1.4, 0.18),
    identifyCard: lomrCard,
    note: "Areas where FEMA has issued a Letter of Map Revision, which changes the effective flood map there. The revised map governs over the older panel — read the letter.",
    infoCaveat: "The county's mapping of LOMR areas, with links to FEMA's letters. Not every revision may be mapped.",
    floodTier: "regulatory", agency: "FEMA (via DeSoto County)",
  }),
  ms_desoto_loma: feature("msDesotoLoma", {
    ...DESOTO, label: "FEMA Map Amendments (LOMA)", role: "point", group: "flood", order: 35, minZoom: 12, source: "DeSoto County GIS — FEMA Letters of Map Amendment",
    color: "#be185d", weight: 1.2, pointRadius: 3, fields: ["CASE_NO_1", "LINK_1", "CASE_NO_2", "LINK_2", "CASE_NO_3", "LINK_3", "CASE_NO_4", "LINK_4", "CASE_NO_5", "LINK_5"],
    identifyCard: lomaCard,
    note: "Lots FEMA has removed from the mapped floodplain by a Letter of Map Amendment. A LOMA on a neighbour is context, not clearance for the site.",
    infoCaveat: "One point per letter, at the county's mapped location. FEMA's letter is the record.",
    floodTier: "regulatory", agency: "FEMA (via DeSoto County)",
  }),
  ms_desoto_cemeteries: feature("msDesotoCemeteries", {
    ...DESOTO, label: "Cemeteries (DeSoto County)", role: "point", group: "environmental", order: 41, minZoom: 12, source: "DeSoto County GIS",
    color: "#475569", weight: 1.5, pointRadius: 3.5, fields: ["Name", "Confirmed"],
    identifyCard: (p) => ({ title: str(p && p.Name) || "Cemetery", rows: clean([row("Location confirmed", p && has(p.Confirmed) ? (/^(y|yes|true|1)$/i.test(str(p.Confirmed)) ? "Yes" : /^(n|no|false|0)$/i.test(str(p.Confirmed)) ? "No" : p.Confirmed) : null)]) }),
    note: "Cemeteries the county has located. INCOMPLETE: an unrecorded family burial ground is not here, so an empty map is never proof of none. A burial ground on the site is a hard constraint — ask the county and have it surveyed.",
    infoCaveat: "The county's inventory; 'Location confirmed' says whether the point was field-checked.",
  }),
};

/* The ids the vintage line, the tier table and the tests read. */
export const MISSISSIPPI_VINTAGE = {
  ms_city: "MARIS governmental boundaries — municipal layer, 2025 edition (each city's boundary year is in the data)",
  ms_tribal: "BIA land area representations — hosted by EPA, layer data edited 2022",
  ms_deq_gard: "MDEQ GARD site list — current edition, continuously edited",
  ms_deq_ust: "MDEQ MUSTER tank repository — current edition, continuously edited",
  ms_epa_brownfields: "EPA ACRES via the Facility Registry Service — layer refreshed 2026-10-21",
  ms_deq_landfills: "MDEQ solid-waste facility list — current edition",
  ms_deq_mines: "MDEQ surface-mining permits — current edition",
  ms_ogb_wells: "State Oil and Gas Board wells — July 2025 extract republished by MARIS",
  ms_deq_og_fields: "MDEQ Office of Geology oil and gas fields — current edition",
  ms_deq_spa: "MDEQ Source Water Assessment Program — current edition",
  ms_nrcs_easements: "USDA NRCS easements — 2024 aggregate republished by MARIS",
  ms_nrhp: "NPS National Register — Esri Federal Data copy",
  ms_cemeteries: "USGS GNIS cemeteries — recorded sites only; no single edition date",
  ms_crit_habitat: "USFWS final critical habitat — layer edited 2026-08-31",
  ms_303d: "MDEQ 2024 Section 303(d) list",
  ms_dams: "MDEQ Dam Safety inventory — current edition",
  ms_dam_inundation: "MDEQ Dam Safety modeled inundation areas — current edition",
  ms_desoto_drainage: "DeSoto County GIS — current edition",
  ms_desoto_levee: "DeSoto County GIS — current edition",
  ms_desoto_lomr: "DeSoto County GIS — FEMA letters as the county has mapped them",
  ms_desoto_loma: "DeSoto County GIS — FEMA letters as the county has mapped them",
  ms_desoto_cemeteries: "DeSoto County GIS — current edition",
};
