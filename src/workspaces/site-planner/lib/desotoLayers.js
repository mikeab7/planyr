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

export const OB_AGOL = "https://services9.arcgis.com/VGtdH6iTQlVulSnr/ArcGIS/rest/services";
export const DESOTO_RELAY = "/gis-proxy/gis.desotocountyms.gov/arcgis/rest/services";

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

export { ID as OLIVE_BRANCH };
