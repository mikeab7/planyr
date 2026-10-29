/* DeSoto County, MS + City of Olive Branch — the regional GIS layer rows (B2507056–B2507059, 2026-10-29).
 *
 * Every row here is a REGIONAL source: it declares `states: ["MS"]` and a `regions` boundary (serviceAreas.js: `desoto` = the county, from
 * Planyr's bundled county polygons; `olivebranch` = the padded union of the city's published utility / planning / annexation data extents — a rectangle, "within or near Olive Branch"), so `layerAvailableHere` hides the row — and the
 * map's draw filter turns it off before any request — on a Texas, Georgia or Tennessee site. The registry spreads DESOTO_LAYERS into ALL_LAYERS.
 *
 * TWO HOSTS, TWO WAYS IN (both MEASURED 2026-10-29):
 *   · City of Olive Branch's ArcGIS Online org (services9.arcgis.com/VGtdH6iTQlVulSnr) — public, CORS-open, read directly.
 *   · DeSoto County's own ArcGIS Server (gis.desotocountyms.gov) — the build sandbox's egress blocks it, so its CORS could not be read; it is
 *     reached through the same-origin /gis-proxy relay (functions/gis-proxy), the way every county parcel host is.
 * NOT used, on purpose: the Nearmap imagery inside the Olive Branch utility web map (a licensed feed with the city's key baked into a public map),
 * garbage / cemetery / cannabis / memorial / road-closure / park / ward / polling layers (no site-work value), and PROPOSED_ZONING_20230314
 * (a 2023 proposal, not current zoning).
 *
 * PURE: no network, no React — the style / label rules below unit-test standalone (test/desotoLayers.test.js). */

import { zoningStyle, zoningRows, zoningTitle, zoneLabelText, approvalDate } from "./desotoZoning.js";
import { jurisdictionAt, ensureMunicipalities, DESOTO_RELAY as RELAY, titleCase } from "./desotoJurisdiction.js";
import { providerCardAt, ensureProviders } from "./desotoProviders.js";

export const OB_AGOL = "https://services9.arcgis.com/VGtdH6iTQlVulSnr/ArcGIS/rest/services";
export const DESOTO_RELAY = RELAY;

/* A pipe-size string the city typed by hand → the short label printed beside the line, or null when there is nothing to say.
 * Measured values include: 8" · 8'' · 8 (bare) · "2\" Abandoned" · "6 HP\"" · "FUTURE 6" · "FDC 4\"" · "None" · a stray creek name. */
export function pipeSizeLabel(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s || /^none$/i.test(s)) return null;
  const m = s.match(/(\d+(?:\.\d+)?)/);
  if (!m) return /abandon/i.test(s) ? "abandoned" : null;
  const n = m[1];
  const hp = /\bHP\b/i.test(s) ? " HP" : "";
  if (/future/i.test(s)) return `${n}" future`;
  if (/abandon|\bab\b/i.test(s)) return `${n}" abandoned`;
  return `${n}"${hp}`;
}

/* The city's own convention for its utility lines: a line whose CONVERSION_STATUS is "FIELD VERIFIED" (case varies by layer) is drawn SOLID; a
 * line that was digitised from paper plans and not yet field-verified — or has no status at all — is DASHED. */
export const isFieldVerified = (props) => /^\s*field\s+verified\s*$/i.test(String(props && props.CONVERSION_STATUS != null ? props.CONVERSION_STATUS : ""));
export const VERIFIED_DASH = "7 5";
export const verifiedStyle = (color, weight) => (props, opacity) => ({
  color, weight, opacity, fill: false, lineCap: "butt", dashArray: isFieldVerified(props) ? null : VERIFIED_DASH,
});

const OB = { states: ["MS"], regions: ["olivebranch"] };
const ID = "Olive Branch";

const verifiedHover = { names: ["CONVERSION_STATUS"], label: "Mapping" };
const waterHoverFields = [{ names: ["SIZE"], label: "Size" }, { names: ["MATERIAL1", "MATERIAL"], label: "Material" }, { names: ["YR_INSTALD"], label: "Installed" }, verifiedHover];

/* One city line layer. `svc` = the AGOL service name, `layer` = its layer id. */
const line = (o) => ({
  kind: "esriFeature", ...OB, role: "line", group: "utilities", minZoom: 15, opacity: 0.55,
  hoverIdentify: true, canvasIdentify: true,
  ...o,
  url: `${OB_AGOL}/${o.svc}/FeatureServer/${o.layer}`,
});

export const DESOTO_LAYERS = {
  /* ---- Olive Branch water ---- */
  ms_ob_water_main: line({
    svc: "WATER_UTILITIES_(VIEWER)", layer: 6, label: "Water Mains", mergeGroup: "water_sewer", order: 20,
    source: "City of Olive Branch — Water Utilities", color: "#0070ff", weight: 2,
    styleFn: verifiedStyle("#0070ff", 2), lineLabel: { field: "SIZE", minZoom: 17 },
    hoverTitle: "Water main", hoverSource: "City of Olive Branch", hoverFields: waterHoverFields,
    note: "City of Olive Branch water mains, labelled with pipe size at close zoom. Solid = field verified; dashed = not yet field verified.",
    infoCaveat: "Mains only; the city's own mapping, not a survey or an as-built. Confirm availability and size with Olive Branch Water before relying on a tap.",
  }),
  ms_ob_hydrants: {
    kind: "esriFeature", ...OB, role: "point", group: "utilities", mergeGroup: "fire_hydrants", order: 20, minZoom: 16, opacity: 0.55,
    label: "Hydrants", source: "City of Olive Branch — Water Utilities",
    url: `${OB_AGOL}/WATER_UTILITIES_(VIEWER)/FeatureServer/2`, color: "#dc2626", weight: 1.5, pointRadius: 4,
    hoverIdentify: true, canvasIdentify: true, hoverTitle: "Fire hydrant", hoverSource: "City of Olive Branch",
    hoverFields: [{ names: ["FacilityID"], label: "ID" }, { names: ["Manufactur"], label: "Make" }, { names: ["InstallDat"], label: "Installed" }],
    note: "City of Olive Branch hydrants.",
  },
  ms_ob_water_service: line({
    svc: "WATER_UTILITIES_(VIEWER)", layer: 7, label: "Water Service Lines", order: 21, minZoom: 17, weight: 1, color: "#38bdf8",
    source: "City of Olive Branch — Water Utilities",
    hoverTitle: "Water service line", hoverSource: "City of Olive Branch", hoverFields: [{ names: ["Diameter"], label: "Diameter" }, { names: ["Material"], label: "Material" }],
    note: "Service lines from the main to each meter. Dense — loads only at close zoom.",
  }),
  /* ---- Olive Branch sewer ---- */
  ms_ob_sewer_gravity: line({
    svc: "WASTEWATER_UTILITIES_(Viewer)", layer: 6, label: "Gravity Sewer", mergeGroup: "water_sewer", order: 22,
    source: "City of Olive Branch — Wastewater Utilities", color: "#16a34a", weight: 2,
    styleFn: verifiedStyle("#16a34a", 2), lineLabel: { field: "SIZE", minZoom: 17 },
    hoverTitle: "Gravity sewer", hoverSource: "City of Olive Branch",
    hoverFields: [{ names: ["SIZE"], label: "Size" }, { names: ["MATERIAL"], label: "Material" }, { names: ["BASIN"], label: "Basin" }, verifiedHover],
    note: "City of Olive Branch gravity sewer mains, labelled with pipe size at close zoom. Solid = field verified; dashed = not yet field verified.",
    infoCaveat: "The city's own mapping, not a survey or an as-built. Invert elevations are not shown.",
  }),
  ms_ob_sewer_force: line({
    svc: "WASTEWATER_UTILITIES_(Viewer)", layer: 7, label: "Force Mains", mergeGroup: "water_sewer", order: 23,
    source: "City of Olive Branch — Wastewater Utilities", color: "#9333ea", weight: 2,
    styleFn: verifiedStyle("#9333ea", 2), lineLabel: { field: "SIZE", minZoom: 16 },
    hoverTitle: "Sewer force main", hoverSource: "City of Olive Branch",
    hoverFields: [{ names: ["SIZE"], label: "Size" }, { names: ["MATERIAL"], label: "Material" }, { names: ["BASIN"], label: "Basin" }, verifiedHover],
    note: "City of Olive Branch pressurised sewer force mains, labelled with pipe size. Solid = field verified; dashed = not yet field verified.",
  }),
  ms_ob_manholes: {
    kind: "esriFeature", ...OB, role: "point", group: "utilities", mergeGroup: "water_sewer", order: 24, minZoom: 16, opacity: 0.55,
    label: "Manholes", source: "City of Olive Branch — Wastewater Utilities",
    url: `${OB_AGOL}/WASTEWATER_UTILITIES_(Viewer)/FeatureServer/3`, color: "#15803d", weight: 1, pointRadius: 3,
    hoverIdentify: true, canvasIdentify: true, hoverTitle: "Sewer manhole", hoverSource: "City of Olive Branch",
    hoverFields: [{ names: ["SMH_NUMBER"], label: "Number" }, { names: ["RIM_ELEV"], label: "Rim elev." }, { names: ["MATERIAL"], label: "Material" }],
    note: "City of Olive Branch sewer manholes.",
  },
  ms_ob_lift_stations: {
    kind: "esriFeature", ...OB, role: "point", group: "utilities", mergeGroup: "water_sewer", order: 25, minZoom: 12, opacity: 0.55,
    label: "Lift Stations", source: "City of Olive Branch — Wastewater Utilities",
    url: `${OB_AGOL}/WASTEWATER_UTILITIES_(Viewer)/FeatureServer/2`, color: "#7e22ce", weight: 1.5, pointRadius: 6,
    hoverIdentify: true, canvasIdentify: true, hoverTitle: "Sewer lift station", hoverSource: "City of Olive Branch",
    hoverFields: [{ names: ["Name", "StationID"], label: "Station" }, { names: ["TYPE"], label: "Type" }, { names: ["PUMPS"], label: "Pumps" }, { names: ["BASIN"], label: "Basin" }],
    note: "City of Olive Branch sewer lift stations.",
  },
  ms_ob_wwtp: {
    kind: "esriFeature", ...OB, role: "point", group: "utilities", mergeGroup: "water_sewer", order: 26, minZoom: 10, opacity: 0.55,
    label: "Wastewater Treatment Plants", source: "City of Olive Branch — Wastewater Utilities",
    url: `${OB_AGOL}/WASTEWATER_UTILITIES_(Viewer)/FeatureServer/1`, color: "#6b21a8", weight: 1.5, pointRadius: 7,
    hoverIdentify: true, canvasIdentify: true, hoverTitle: "Wastewater treatment plant", hoverSource: "City of Olive Branch",
    hoverFields: [{ names: ["Type"], label: "Type" }, { names: ["Capacity"], label: "Capacity" }],
    note: "City of Olive Branch wastewater treatment plants.",
  },
  ms_ob_sewer_service: line({
    svc: "WASTEWATER_UTILITIES_(Viewer)", layer: 5, label: "Sewer Service Lines", order: 27, minZoom: 17, weight: 1, color: "#86efac",
    source: "City of Olive Branch — Wastewater Utilities",
    hoverTitle: "Sewer service line", hoverSource: "City of Olive Branch", hoverFields: [{ names: ["DIAMETER"], label: "Diameter" }, verifiedHover],
    note: "Sewer laterals from the main to each parcel. Dense — loads only at close zoom.",
  }),
  /* ---- Olive Branch gas (the city runs gas) ---- */
  ms_ob_gas_main: line({
    svc: "GAS_UTILITIES_(VIEWER)", layer: 5, label: "Gas Lines", order: 28,
    source: "City of Olive Branch — Gas Utilities", color: "#ca8a04", weight: 2,
    styleFn: verifiedStyle("#ca8a04", 2), lineLabel: { field: "SIZE", minZoom: 17 },
    hoverTitle: "Gas main", hoverSource: "City of Olive Branch",
    hoverFields: [{ names: ["SIZE"], label: "Size" }, { names: ["MATERIAL"], label: "Material" }, { names: ["TYPE"], label: "Type" }, verifiedHover],
    note: "City of Olive Branch gas mains, labelled with pipe size (HP = high pressure). Solid = field verified; dashed = not yet field verified.",
    infoCaveat: "The city's own mapping, not a survey. Call 811 before digging.",
  }),
  /* ---- DCRUA — the regional sewer trunk system (DeSoto County Regional Utility Authority) ---- */
  ms_dcrua_main: line({
    svc: "DCRUA_DATASET", layer: 1, label: "Regional Sewer Mains (DCRUA)", mergeGroup: "water_sewer", order: 29, minZoom: 13,
    regions: ["desoto"], source: "DeSoto County Regional Utility Authority", color: "#0f766e", weight: 2,
    lineLabel: { field: "DiameterText", minZoom: 15 },
    hoverTitle: "DCRUA sewer main", hoverSource: "DeSoto County Regional Utility Authority",
    hoverFields: [{ names: ["DiameterText"], label: "Diameter" }, { names: ["Material"], label: "Material" }, { names: ["Interceptor"], label: "Interceptor" }, { names: ["Type"], label: "Type" }],
    note: "The regional sewer trunk and interceptor system run by the DeSoto County Regional Utility Authority, labelled with pipe diameter.",
    infoCaveat: "Authority-published mapping, not a survey; confirm capacity and connection terms with DCRUA.",
  }),
  ms_dcrua_structures: {
    kind: "esriFeature", ...{ states: ["MS"], regions: ["desoto"] }, role: "point", group: "utilities", mergeGroup: "water_sewer", order: 30, minZoom: 14, opacity: 0.55,
    label: "Regional Sewer Structures (DCRUA)", source: "DeSoto County Regional Utility Authority",
    url: `${OB_AGOL}/DCRUA_DATASET/FeatureServer/0`, color: "#115e59", weight: 1, pointRadius: 3,
    hoverIdentify: true, canvasIdentify: true, hoverTitle: "DCRUA sewer structure", hoverSource: "DeSoto County Regional Utility Authority",
    hoverFields: [{ names: ["Name"], label: "Name" }, { names: ["Type"], label: "Type" }, { names: ["Rim_Elevat"], label: "Rim elev." }, { names: ["Intercepto"], label: "Interceptor" }],
    note: "Manholes and structures on the regional sewer trunk system.",
  },
  /* ---- Olive Branch planning area ---- */
  ms_ob_planning_area: {
    kind: "esriFeature", ...OB, role: "line", group: "jurisdiction", order: 20, minZoom: 9, opacity: 0.4,
    label: "Olive Branch Planning Area", source: "City of Olive Branch — Planning",
    url: `${OB_AGOL}/OLIVE_BRANCH_PLANNING_AREA/FeatureServer/0`, color: "#7c3aed", weight: 1.6,
    styleFn: (_p, opacity) => ({ color: "#7c3aed", weight: 1.6, opacity, fill: false, dashArray: "10 6" }),
    note: "The area the City of Olive Branch plans for growth around its limits (about 76 square miles).",
    infoCaveat: "A planning line, not a jurisdiction line: land inside it is not necessarily annexed or served by the city.",
  },
};

/* Vintage lines for the (i) popover — the dates the publishers' own layers report (2026-10-29). */
export const DESOTO_VINTAGE = {
  ms_ob_water_main: "City of Olive Branch GIS — current edition, continuously edited",
  ms_ob_hydrants: "City of Olive Branch GIS — current edition, continuously edited",
  ms_ob_water_service: "City of Olive Branch GIS — current edition, continuously edited",
  ms_ob_sewer_gravity: "City of Olive Branch GIS — current edition, continuously edited",
  ms_ob_sewer_force: "City of Olive Branch GIS — current edition, continuously edited",
  ms_ob_manholes: "City of Olive Branch GIS — current edition, continuously edited",
  ms_ob_lift_stations: "City of Olive Branch GIS — current edition, continuously edited",
  ms_ob_wwtp: "City of Olive Branch GIS — current edition, continuously edited",
  ms_ob_sewer_service: "City of Olive Branch GIS — current edition, continuously edited",
  ms_ob_gas_main: "City of Olive Branch GIS — current edition, continuously edited",
  ms_dcrua_main: "DCRUA dataset on the City of Olive Branch's ArcGIS Online — current edition",
  ms_dcrua_structures: "DCRUA dataset on the City of Olive Branch's ArcGIS Online — current edition",
  ms_ob_planning_area: "City of Olive Branch planning area — layer last edited 2022-08-09",
};

/* ---- Mississippi PSC service areas: who serves water / sewer / gas / electric here, by PROVIDER NAME ---- */
const PSC_PALETTE = ["#0369a1", "#b45309", "#15803d", "#7e22ce", "#be123c", "#0f766e", "#a16207", "#4338ca", "#be185d", "#65a30d"];
/* A stable colour per provider name (the same utility is the same colour on every layer and every load). */
export function providerColor(name) {
  const s = String(name == null ? "" : name).trim().toUpperCase();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return PSC_PALETTE[h % PSC_PALETTE.length];
}
export const providerStyle = (props, opacity) => {
  const c = providerColor(props && props.UTILITY_NA);
  return { color: c, weight: 1.5, opacity, fill: true, fillColor: c, fillOpacity: Math.min(0.3, opacity * 0.5) };
};
const providerLabel = (v) => { const t = String(v == null ? "" : v).trim(); return t ? t.replace(/, Inc\.?$/i, "") : null; };

const COUNTY = { states: ["MS"], regions: ["desoto"] };
const county = (o) => ({ kind: "esriFeature", ...COUNTY, ...o, url: `${DESOTO_RELAY}/${o.path}` });

const psc = (o) => county({
  role: "area", group: "utilities", minZoom: 8, opacity: 0.4, hoverIdentify: true, canvasIdentify: true,
  styleFn: providerStyle, lineLabel: { field: "UTILITY_NA", minZoom: 11, format: providerLabel },
  source: "Mississippi Public Service Commission (via DeSoto County GIS)",
  hoverSource: "MS PSC", hoverFields: [{ names: ["UTILITY_NA"] }],
  /* A click anywhere in the county answers all four services at once, by provider name (desotoProviders.js); `dedupeKey` collapses the four layers' identical cards into one. */
  warm: () => { ensureProviders(); },
  identifyCard: (_props, at) => ({ title: "Who serves this site", dedupeKey: "ms-psc-providers", rows: at && Number.isFinite(at.lat) ? providerCardAt(at.lat, at.lng) : [], note: "Mississippi PSC certificated service areas — a territory, not a will-serve letter." }),
  infoCaveat: "Certificated service territory, not a will-serve letter or proof of a main at the property — confirm availability and capacity with the provider.",
  ...o,
});

const planning = (o) => county({ role: "area", group: "jurisdiction", opacity: 0.4, hoverIdentify: true, canvasIdentify: true, source: "DeSoto County GIS", hoverSource: "DeSoto County", ...o });

const FLU_COLORS = { HI: "#6d28d9", LI: "#8b5cf6", GC: "#ea580c", HC: "#c2410c", PC: "#f59e0b", SFR: "#ca8a04", RR: "#84cc16", PUD: "#0f766e", P: "#16a34a", W: "#0ea5e9", D: "#64748b", SCP: "#e11d48", TRANS: "#475569" };
const fluStyle = (props, opacity) => { const c = FLU_COLORS[String(props && props.FLU || "").trim().toUpperCase()] || "#6b7280"; return { color: c, weight: 1, opacity, fill: true, fillColor: c, fillOpacity: Math.min(0.35, opacity * 0.6) }; };
const THOROUGHFARE_WEIGHT = { "Major Arterial": 2, "Primary Arterial": 2, "Minor Arterial": 1.6, "Collector": 1.2, "Minor Collector": 1 };
const thoroughfareStyle = (props, opacity) => ({ color: "#b45309", weight: THOROUGHFARE_WEIGHT[String(props && props.CLASSIFICA || "").trim()] || 1, opacity, fill: false, dashArray: "8 4" });

Object.assign(DESOTO_LAYERS, {
  /* ---- Zoning (one table, several DeSoto governments — never labelled as one's) ---- */
  ms_desoto_zoning: county({
    path: "CountyWebMap/Zoning/MapServer/20", label: "Zoning", role: "area", group: "jurisdiction", order: 30, minZoom: 12, opacity: 0.4,
    source: "DeSoto County GIS — Zoning (incl. the City of Olive Branch's zoning)", hoverSource: "DeSoto County GIS",
    styleFn: zoningStyle, lineLabel: { field: "ZONE", minZoom: 15, format: zoneLabelText },
    hoverIdentify: true, canvasIdentify: true, hoverTitle: "Zoning",
    hoverFields: [{ names: ["ZONE"], label: "Zone" }, { names: ["CASE_NO"], label: "Case" }, { names: ["DATE_APPROVED"], label: "Approved", date: true }],
    warm: () => { ensureMunicipalities(); },
    identifyCard: (props, at) => {
      const j = at && Number.isFinite(at.lat) ? jurisdictionAt(at.lat, at.lng) : null;
      return { title: zoningTitle(j), rows: zoningRows(props, j) };
    },
    note: "Zoning districts across DeSoto County — unincorporated county and the cities (Olive Branch's rezoning cases are in it). Colour = class; the code prints at close zoom. Click for zone, case, approval date and the ordinance.",
    infoCaveat: "One county table holds several governments' zoning with no jurisdiction field, so a result is labelled by the city limits (or unincorporated county) the point falls in. Confirm with the planning department.",
  }),
  /* ---- Municipal limits (Mississippi has no ETJ) ---- */
  ms_desoto_city: county({
    path: "BaseLayers/MapServer/4", label: "City Limits (DeSoto County)", mergeGroup: "counties_cities", role: "line", group: "jurisdiction", order: 5, minZoom: 8, opacity: 0.4,
    source: "DeSoto County GIS — Municipalities", color: "#1d4ed8", weight: 1.6,
    styleFn: (_p, opacity) => ({ color: "#1d4ed8", weight: 1.6, opacity, fill: false }),
    lineLabel: { field: "NAME", minZoom: 9, format: (v) => titleCase(v) || null },
    hoverIdentify: true, canvasIdentify: true, hoverTitle: "City limits", hoverSource: "DeSoto County GIS", hoverFields: [{ names: ["NAME"] }],
    note: "The five incorporated cities of DeSoto County — Olive Branch, Southaven, Horn Lake, Hernando and Walls. Outside them a site is in unincorporated DeSoto County. Mississippi has no ETJ.",
    infoCaveat: "A boundary means the city HAS JURISDICTION here — not that it serves or will connect utilities to a parcel.",
  }),
  /* ---- Who serves the site ---- */
  ms_psc_electric: psc({ path: "CountyWebMap/County_Web_Map/MapServer/69", label: "Electric Service Areas", mergeGroup: "electric", order: 40, hoverTitle: "Electric provider", note: "Certificated electric service areas (Mississippi PSC): Northcentral Mississippi EPA, Entergy Mississippi, Coahoma EPA." }),
  ms_psc_gas: psc({ path: "CountyWebMap/County_Web_Map/MapServer/70", label: "Gas Service Areas", order: 41, hoverTitle: "Gas provider", note: "Certificated natural-gas service areas (Mississippi PSC): the City of Olive Branch and Atmos Energy." }),
  ms_psc_water: psc({ path: "CountyWebMap/County_Web_Map/MapServer/71", label: "Water Service Areas", mergeGroup: "water_sewer", order: 42, hoverTitle: "Water provider", note: "Certificated water service areas (Mississippi PSC): the cities and water associations." }),
  ms_psc_sewer: psc({ path: "CountyWebMap/County_Web_Map/MapServer/72", label: "Sewer Service Areas", mergeGroup: "water_sewer", order: 43, hoverTitle: "Sewer provider", note: "Certificated sewer service areas (Mississippi PSC): the cities and private sewer utilities." }),
  /* ---- DCRUA, county copy: easements + service areas ---- */
  ms_dcrua_easements: county({
    path: "CountyWebMap/County_Web_Map/MapServer/67", label: "Regional Sewer Easements (DCRUA)", mergeGroup: "water_sewer", role: "line", group: "utilities", order: 31, minZoom: 14, opacity: 0.55,
    source: "DeSoto County Regional Utility Authority (via DeSoto County GIS)", color: "#0f766e", weight: 1.6, hoverIdentify: true, canvasIdentify: true,
    hoverTitle: "DCRUA sewer easement", hoverSource: "DCRUA", hoverFields: [{ names: ["Width_FT"], label: "Width", unit: "ft" }],
    note: "Easement lines along the DCRUA regional sewer system, with the recorded width.",
    infoCaveat: "Centreline-style mapping from the authority, not a recorded plat — confirm the easement on the title commitment and survey.",
  }),
  ms_dcrua_service_area: county({
    path: "CountyWebMap/County_Web_Map/MapServer/68", label: "Regional Sewer Service Areas (DCRUA)", mergeGroup: "water_sewer", role: "area", group: "utilities", order: 32, minZoom: 8, opacity: 0.4,
    source: "DeSoto County Regional Utility Authority (via DeSoto County GIS)", color: "#0f766e", weight: 1.4,
    styleFn: (_p, opacity) => ({ color: "#0f766e", weight: 1.4, opacity, fill: true, fillColor: "#0f766e", fillOpacity: Math.min(0.15, opacity * 0.4), dashArray: "6 4" }),
    lineLabel: { field: "Name", minZoom: 10, format: (v) => { const t = String(v == null ? "" : v).trim(); return t || null; } },
    hoverIdentify: true, canvasIdentify: true, hoverTitle: "DCRUA service area", hoverSource: "DCRUA", hoverFields: [{ names: ["Name"] }],
    note: "The service areas of the DeSoto County Regional Utility Authority's regional sewer system.",
  }),
  /* ---- Planning context (off by default; vintage in each (i)) ---- */
  ms_desoto_flu: planning({
    path: "CountyWebMap/County_Web_Map/MapServer/23", label: "Future Land Use (2004)", order: 40, simplifyFactor: 0.75, minZoom: 9, styleFn: fluStyle,
    lineLabel: { field: "FLU", minZoom: 11, format: (v) => { const t = String(v == null ? "" : v).trim(); return t || null; } },
    hoverTitle: "Future land use", hoverFields: [{ names: ["FLU"], label: "Class" }],
    note: "DeSoto County's 2004 future land use plan, by class code as the county publishes it (LI/HI = light/heavy industrial, GC/HC/PC = commercial, SFR/RR = residential).",
    infoCaveat: "A 2004 plan — over twenty years old and superseded in places by rezonings and the I-269 corridor study. A planning intent, not zoning.",
  }),
  ms_desoto_thoroughfare: planning({
    path: "CountyWebMap/County_Web_Map/MapServer/24", label: "Thoroughfare Plan (2004)", role: "line", order: 41, minZoom: 10, styleFn: thoroughfareStyle,
    hoverTitle: "Planned thoroughfare", hoverFields: [{ names: ["CLASSIFICA"], label: "Class" }],
    note: "DeSoto County's 2004 thoroughfare plan: planned arterials and collectors, dashed.",
    infoCaveat: "A 2004 plan — some alignments were built differently or dropped. Confirm a planned road with the county engineer before relying on it.",
  }),
  ms_desoto_future_subd: planning({
    path: "CountyWebMap/County_Web_Map/MapServer/22", label: "Future Subdivisions", order: 42, minZoom: 14, color: "#0f766e",
    styleFn: (_p, opacity) => ({ color: "#0f766e", weight: 1, opacity, fill: true, fillColor: "#0f766e", fillOpacity: Math.min(0.15, opacity * 0.3) }),
    hoverTitle: "Future subdivision", hoverFields: [{ names: ["Name"] }, { names: ["Lots"], label: "Lots" }, { names: ["Date_Approved"], label: "Approved" }],
    note: "Subdivisions the county has approved that are not yet built out (lot count and approval date on hover).",
    infoCaveat: "County-maintained list; approval dates run from the earliest approvals to the latest — check the date.",
  }),
});

Object.assign(DESOTO_VINTAGE, {
  ms_desoto_zoning: "DeSoto County zoning table — records through the most recent case approvals (latest seen 2026-08-18); updated by the planning departments",
  ms_desoto_city: "DeSoto County GIS municipal limits — current edition",
  ms_psc_electric: "Mississippi Public Service Commission certificated areas, as republished by DeSoto County GIS — edition date not published",
  ms_psc_gas: "Mississippi Public Service Commission certificated areas, as republished by DeSoto County GIS — edition date not published",
  ms_psc_water: "Mississippi Public Service Commission certificated areas, as republished by DeSoto County GIS — edition date not published",
  ms_psc_sewer: "Mississippi Public Service Commission certificated areas, as republished by DeSoto County GIS — edition date not published",
  ms_dcrua_easements: "DCRUA easements via DeSoto County GIS — current edition",
  ms_dcrua_service_area: "DCRUA service areas via DeSoto County GIS — current edition",
  ms_desoto_flu: "DeSoto County future land use plan — 2004",
  ms_desoto_thoroughfare: "DeSoto County thoroughfare plan — 2004",
  ms_desoto_future_subd: "DeSoto County approved-subdivision list — approval dates run through the latest case",
});

export { ID as OLIVE_BRANCH };
