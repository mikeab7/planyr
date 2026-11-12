/* Chambers County, TX — the regional GIS layer rows (B2671240, 2026-11-12): the City of Mont Belvieu's zoning, water, sewer, storm and Master Drainage Plan, and the City of Baytown's zoning (its Chambers side included).
 *
 * Every row here is a REGIONAL source: it declares `states: ["TX"]` and a `regions` boundary (serviceAreas.js), so `layerAvailableHere` hides the row — and the map's draw filter turns it off before any request —
 * anywhere else (Houston, Anahuac, Katy, Dallas, and every non-Texas site). The registry spreads CHAMBERS_LAYERS into ALL_LAYERS, exactly as it does DESOTO_LAYERS and SUGARLAND_LAYERS.
 *   · `montbelvieu`       the city's limits ∪ its ETJ (AdministrativeArea_v2 layers 0 + 1) — zoning, water, sewer, storm.
 *   · `montbelvieu_plan`  the padded extent of the Master Drainage Plan's own data (the watersheds run south into Baytown's side), so the plan draws where it has something to say and nowhere else.
 *   · `baytown`           the City of Baytown's limits, limited-purpose and strip annexation (City_of_Baytown_Citizen_Map_WFL1 layer 12) — it reaches into Chambers County.
 *
 * TWO HOSTS, TWO WAYS IN (both MEASURED 2026-11-12):
 *   · the City of Mont Belvieu's own self-hosted ArcGIS Server (www.cmbgis.com, 60 services, EPSG:2278) — the build sandbox's egress blocks it and its CORS header is unmeasured, so it is read through the same-origin
 *     /gis-proxy relay, measured on the PR preview.
 *   · the City of Baytown's ArcGIS Online org (services8.arcgis.com/2iaYWEMdQLPv0ZUw) — public, CORS-open, read directly.
 * NOT drawn, on purpose: LandUsePlanning_v2 layers 1 (FEMA Flood Zones) and 2 (Wetlands) are the city's COPIES of federal layers Planyr already draws from their publishers; the other 50-odd services (parcels,
 * addresses, schools, elections, fiber …) have no site-work value here; water fittings / casings / service connections, sewer bends / clean-outs / fittings and storm valves are asset-inventory detail, not site facts.
 *
 * NOTHING HERE COMPUTES A NUMBER (constraint #4): the cards print the city's own attributes (a pipe size, a material, an owner) and the standing source line; the drainage plan's pond volumes, depths and market
 * values are deliberately NOT shown (they are the plan consultant's assumptions with zero placeholders, and Planyr holds no rule record behind them).
 *
 * PURE: no network, no React — the style / label / card rules below unit-test standalone (test/chambersLayers.test.js). */

import { zoningStyle as mbStyle, zoningCard as mbZoningCard, zoningLegend as mbLegend, legendItemsOf as mbLegendItems, zoneLabelText as mbLabel, MB_CITATION } from "./montBelvieuZoning.js";
import { zoningStyle as btStyle, zoningCard as btZoningCard, zoningLegend as btLegend, legendItemsOf as btLegendItems, zoneLabelText as btLabel, BAYTOWN_CITATION } from "./baytownZoning.js";

export const CMB_RELAY = "/gis-proxy/www.cmbgis.com/arcgis/rest/services";
export const BAYTOWN_AGOL = "https://services8.arcgis.com/2iaYWEMdQLPv0ZUw/arcgis/rest/services";

/* ───────────────────────── How the city's attributes read ───────────────────────── */
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

/* A pipe diameter in inches. The data uses 0, −1 and −9 as "unknown" placeholders (measured: 0 on water mains, −1 / −9 on sewer and storm), so only a positive value is a pipe size. "8" → `8"`; 0.75 → `0.75"`. */
export function diameterLabel(raw) {
  const n = num(raw);
  if (n == null || n <= 0) return null;
  return `${Number.isInteger(n) ? n : n.toFixed(2).replace(/0+$/, "")}"`;
}

/* The city's material codes. The few the data itself pairs with a plain word (AC ↔ "Asbestos Cement", PVC ↔ "Polyvinyl chloride", "PVC C-900" ↔ "PVC900") are read as that word; the unknowns, blanks and the stray
 * numerals/letters ("11", "10", "7", "W") are no answer; every other code (RCP, HDPE, DIP, CMP …) is printed exactly as the city wrote it — nothing is expanded from memory. */
const MATERIAL_WORDS = Object.freeze({
  "AC": "Asbestos cement", "ASBESTOS CEMENT": "Asbestos cement",
  "PVC": "PVC", "POLYVINYL CHLORIDE": "PVC",
  "PVC C-900": "PVC C-900", "PVC900": "PVC C-900",
});
export function materialLabel(raw) {
  const t = String(raw == null ? "" : raw).trim();
  if (!t || /^(unk|unknown|none|null|n\/a)$/i.test(t) || /^\d{1,2}$/.test(t) || t === "W") return null;
  return MATERIAL_WORDS[t.toUpperCase()] || t;
}

/* OWNEDBY / MAINTBY are domain codes. The water-main layer's own legend gives the words (1 "Our Agency", −1 "Private", −2 "Other", −3 "BHISD"); the server is the City of Mont Belvieu's, so "Our Agency" is the city.
 * "BHISD" is printed as the layer writes it. Any other code is no answer. */
const OWNER_WORDS = Object.freeze({ "1": "City of Mont Belvieu", "-1": "Private", "-2": "Other", "-3": "BHISD" });
export function ownerLabel(raw) {
  if (raw == null || raw === "" || raw === " ") return null;
  return OWNER_WORDS[String(Math.trunc(Number(raw)))] || null;
}

/* Every card reads through these so a row never prints an empty value. */
const cleanText = (v) => { const t = String(v == null ? "" : v).trim(); return t && !/^(null|none|n\/a|<null>)$/i.test(t) ? t : null; };

/* ───────────────────────── The registry rows ───────────────────────── */
const MB = { states: ["TX"], regions: ["montbelvieu"] };
const PLAN = { states: ["TX"], regions: ["montbelvieu_plan"] };
const BT = { states: ["TX"], regions: ["baytown"] };
const ID = "Mont Belvieu";
const SRC = "City of Mont Belvieu GIS";

const mb = (o) => ({ kind: "esriFeature", ...MB, hoverIdentify: true, canvasIdentify: true, hoverSource: SRC, source: SRC, ...o, url: `${CMB_RELAY}/${o.path}` });
const plan = (o) => ({ kind: "esriFeature", ...PLAN, hoverIdentify: true, canvasIdentify: true, group: "flood", hoverSource: `${SRC} — Master Drainage Plan`, source: `${SRC} — Master Drainage Plan`, ...o, url: `${CMB_RELAY}/LandUsePlanning_v2/MapServer/${o.layer}` });
const line = (o) => mb({ role: "line", group: "utilities", minZoom: 14, ...o });
const point = (o) => mb({ role: "point", group: "utilities", minZoom: 16, ...o });

const ownerField = { names: ["OWNEDBY"], label: "Owner", format: (p) => ownerLabel(p.OWNEDBY) || "" };
const diameterField = { names: ["DIAMETER"], label: "Diameter", format: (p) => diameterLabel(p.DIAMETER) || "" };
const materialField = { names: ["MATERIAL"], label: "Material", format: (p) => materialLabel(p.MATERIAL) || "" };
const installedField = { names: ["INSTALLDATE"], label: "Installed", date: true };

const planArea = (color, fillMax = 0.18) => (_p, opacity) => ({ color, weight: 1.4, opacity, fill: true, fillColor: color, fillOpacity: Math.min(fillMax, opacity * 0.4), dashArray: "7 4" });
const planLine = (color, weight = 1.6) => (_p, opacity) => ({ color, weight, opacity, fill: false });

export const CHAMBERS_MERGE_GROUPS = {
  tx_mb_storm: {
    label: "Storm Drains (Mont Belvieu)",
    note: "The City of Mont Belvieu's storm sewer: gravity mains (orange), culverts (dark orange) and outfalls. One switch for all three. Click one for its size, material and owner.",
  },
  tx_mb_plan_basins: {
    label: "Drainage Plan Watersheds (Mont Belvieu)",
    note: "The six watersheds of the City of Mont Belvieu's Master Drainage Plan (Cherry Point Gully, Cotton Bayou, Hackberry Gully, Smith Gully, Old River, Cedar Bayou), Cherry Point's subbasins and the Grand Parkway contributing areas. One switch for all.",
  },
  tx_mb_plan_projects: {
    label: "Drainage Plan Projects (Mont Belvieu)",
    note: "The Master Drainage Plan's proposed work: potential detention ponds and sites, channel improvements and new ditches, and proposed cross culverts. One switch for all. A proposal, not a commitment.",
  },
};

export const CHAMBERS_LAYERS = {
  /* ---- Mont Belvieu zoning (the city has NO industrial district in this layer) ---- */
  tx_mb_zoning: mb({
    path: "LandUsePlanning_v2/MapServer/0", label: "Zoning (Mont Belvieu)", role: "area", group: "jurisdiction", order: 34, minZoom: 11,
    fields: ["ZONEDESC", "LASTUPDATE"],
    styleFn: mbStyle, lineLabel: { field: "ZONEDESC", minZoom: 13, format: mbLabel, declutter: true }, identifyCard: mbZoningCard,
    viewLegend: (features) => mbLegend(mbLegendItems(features)),
    note: "Zoning districts within the City of Mont Belvieu (41 polygons). Colour = district family; the name prints at close zoom and the legend lists the districts in view. Click for the district.",
    infoCaveat: `${MB_CITATION} Inside the city limits only — the ETJ is not zoned.`,
  }),
  /* ---- Water ---- */
  tx_mb_water_main: line({
    path: "WaterDistribution_v2/MapServer/8", label: "Water Mains (Mont Belvieu)", mergeGroup: "water_sewer", order: 50,
    color: "#0070ff", weight: 2, lineLabel: { field: "DIAMETER", minZoom: 16, format: diameterLabel },
    hoverTitle: "Water main", hoverFields: [diameterField, materialField, ownerField, installedField],
    note: "City of Mont Belvieu water mains (1,690 lines), labelled with pipe size at close zoom. Click for size, material and owner.",
    infoCaveat: "The city's own mapping, not a survey or an as-built; a size of zero or blank in the city's data means unknown and is not printed. Confirm availability and size with the City of Mont Belvieu before relying on a tap.",
  }),
  tx_mb_hydrants: point({
    path: "WaterDistribution_v2/MapServer/2", label: "Hydrants (Mont Belvieu)", mergeGroup: "fire_hydrants", order: 50, color: "#dc2626", weight: 1.5, pointRadius: 4,
    hoverTitle: "Fire hydrant", hoverFields: [{ names: ["FACILITYID"], label: "ID" }, { names: ["MANUFACTURER"], label: "Make" }, ownerField, installedField],
    note: "City of Mont Belvieu fire hydrants (900).",
  }),
  /* ---- Sewer ---- */
  tx_mb_sewer_gravity: line({
    path: "SewerStormwater_v2/MapServer/8", label: "Gravity Sewer (Mont Belvieu)", mergeGroup: "water_sewer", order: 52,
    color: "#16a34a", weight: 2, lineLabel: { field: "DIAMETER", minZoom: 16, format: diameterLabel },
    hoverTitle: "Gravity sewer", hoverFields: [diameterField, materialField, ownerField, installedField],
    note: "City of Mont Belvieu gravity sewer mains (1,472 lines), labelled with pipe size at close zoom. Click for size, material and owner.",
    infoCaveat: "The city's own mapping, not a survey or an as-built. Invert elevations are in the city's data but are not shown.",
  }),
  tx_mb_sewer_force: line({
    path: "SewerStormwater_v2/MapServer/10", label: "Force Mains (Mont Belvieu)", mergeGroup: "water_sewer", order: 53,
    color: "#9333ea", weight: 2, styleFn: (_p, opacity) => ({ color: "#9333ea", weight: 2, opacity, fill: false, dashArray: "8 5" }), lineLabel: { field: "DIAMETER", minZoom: 15, format: diameterLabel },
    hoverTitle: "Sewer force main", hoverFields: [diameterField, materialField, ownerField, installedField],
    note: "City of Mont Belvieu pressurised sewer force mains (22 lines), dashed, labelled with pipe size.",
  }),
  tx_mb_lift_stations: point({
    path: "SewerStormwater_v2/MapServer/2", label: "Lift Stations (Mont Belvieu)", mergeGroup: "water_sewer", order: 54, minZoom: 12, color: "#7e22ce", weight: 1.5, pointRadius: 6,
    hoverTitle: "Sewer lift station", hoverFields: [{ names: ["FACILITYID"], label: "Station" }, ownerField, installedField],
    note: "City of Mont Belvieu sewer lift stations (13, including a private one).",
  }),
  /* ---- Storm ---- */
  tx_mb_storm_main: line({
    path: "Stormwater_v2/MapServer/4", label: "Storm Sewer (Mont Belvieu)", mergeGroup: "tx_mb_storm", order: 56,
    color: "#ea580c", weight: 2, lineLabel: { field: "DIAMETER", minZoom: 16, format: diameterLabel },
    hoverTitle: "Storm sewer", hoverFields: [diameterField, materialField, { names: ["MAINSHAPE"], label: "Shape" }, ownerField, installedField],
    note: "City of Mont Belvieu storm sewer mains (2,072 lines), labelled with pipe size at close zoom.",
    infoCaveat: "The city's own mapping, not a survey or an as-built. Pipe sizes of zero, −1 or −9 in the city's data mean unknown and are not printed.",
  }),
  tx_mb_storm_culverts: line({
    path: "Stormwater_v2/MapServer/5", label: "Culverts (Mont Belvieu)", mergeGroup: "tx_mb_storm", order: 57, minZoom: 15,
    color: "#9a3412", weight: 2, lineLabel: { field: "DIAMETER", minZoom: 17, format: diameterLabel },
    hoverTitle: "Culvert", hoverFields: [diameterField, materialField, ownerField, installedField],
    note: "City of Mont Belvieu culverts (2,053).",
  }),
  tx_mb_storm_outfalls: point({
    path: "Stormwater_v2/MapServer/0", label: "Storm Outfalls (Mont Belvieu)", mergeGroup: "tx_mb_storm", order: 58, minZoom: 15, color: "#c2410c", weight: 1.2, pointRadius: 4,
    hoverTitle: "Storm discharge point", hoverFields: [{ names: ["FACILITYID"], label: "ID" }, { names: ["DISCHRGTYP"], label: "Type" }, diameterField, ownerField],
    note: "City of Mont Belvieu storm discharge points (125).",
  }),

  /* ---- Master Drainage Plan (the city's study; OFF until a person turns it on — every overlay starts off) ---- */
  tx_mb_plan_watershed_cherry: plan({ layer: 6, label: "Cherry Point Gully Watershed", mergeGroup: "tx_mb_plan_basins", role: "area", order: 60, minZoom: 10, styleFn: planArea("#7c3aed"), hoverTitle: "Cherry Point Gully watershed", hoverFields: [], note: "Master Drainage Plan watershed." }),
  tx_mb_plan_subbasins_cherry: plan({
    layer: 7, label: "Cherry Point Gully Subbasins", mergeGroup: "tx_mb_plan_basins", role: "area", order: 61, minZoom: 11, styleFn: planArea("#a855f7", 0.1),
    hoverTitle: "Cherry Point Gully subbasin", hoverFields: [{ names: ["SUBBASIN"], label: "Subbasin" }, { names: ["ACREAGE"], label: "Area", unit: "ac" }], note: "Master Drainage Plan subbasins.",
  }),
  tx_mb_plan_watershed_cotton: plan({ layer: 10, label: "Cotton Bayou Watershed", mergeGroup: "tx_mb_plan_basins", role: "area", order: 62, minZoom: 10, styleFn: planArea("#db2777"), hoverTitle: "Cotton Bayou watershed", hoverFields: [], note: "Master Drainage Plan watershed." }),
  tx_mb_plan_watershed_hackberry: plan({ layer: 12, label: "Hackberry Gully Watershed", mergeGroup: "tx_mb_plan_basins", role: "area", order: 63, minZoom: 10, styleFn: planArea("#a16207"), hoverTitle: "Hackberry Gully watershed", hoverFields: [], note: "Master Drainage Plan watershed." }),
  tx_mb_plan_watershed_smith: plan({ layer: 15, label: "Smith Gully Watershed", mergeGroup: "tx_mb_plan_basins", role: "area", order: 64, minZoom: 10, styleFn: planArea("#ea580c"), hoverTitle: "Smith Gully watershed", hoverFields: [], note: "Master Drainage Plan watershed." }),
  tx_mb_plan_watershed_oldriver: plan({ layer: 16, label: "Old River Watershed", mergeGroup: "tx_mb_plan_basins", role: "area", order: 65, minZoom: 10, styleFn: planArea("#16a34a"), hoverTitle: "Old River watershed", hoverFields: [], note: "Master Drainage Plan watershed." }),
  tx_mb_plan_watershed_cedar: plan({ layer: 17, label: "Cedar Bayou Watershed", mergeGroup: "tx_mb_plan_basins", role: "area", order: 66, minZoom: 10, styleFn: planArea("#0284c7"), hoverTitle: "Cedar Bayou watershed", hoverFields: [], note: "Master Drainage Plan watershed." }),
  tx_mb_plan_grand_parkway: plan({
    layer: 11, label: "Grand Parkway Contributing Areas", mergeGroup: "tx_mb_plan_basins", role: "area", order: 67, minZoom: 11, styleFn: planArea("#1d4ed8", 0.14),
    hoverTitle: "Grand Parkway drainage area", hoverFields: [{ names: ["Desc_"], label: "Area" }, { names: ["Area_ac"], label: "Size", unit: "ac" }], note: "Areas that drain to the Grand Parkway, per the plan.",
  }),
  tx_mb_plan_ponds: plan({
    layer: 13, label: "Potential Detention Ponds", mergeGroup: "tx_mb_plan_projects", role: "area", order: 70, minZoom: 12, styleFn: planArea("#0f766e", 0.3),
    hoverTitle: "Potential detention pond", hoverFields: [{ names: ["Type"], label: "Type" }, { names: ["Owner"], label: "Owner" }, { names: ["Area_ac"], label: "Size", unit: "ac" }],
    note: "Sites the plan identifies as potential regional detention.",
    infoCaveat: "A proposal in the city's master plan, not a commitment or a reserved site. The plan's depths, volumes and market values are not shown here — they are the study's assumptions.",
  }),
  tx_mb_plan_cherry_detention: plan({
    layer: 4, label: "Cherry Point Gully Detention Sites", mergeGroup: "tx_mb_plan_projects", role: "area", order: 71, minZoom: 12, styleFn: planArea("#0f766e", 0.3),
    hoverTitle: "Potential detention site (Cherry Point Gully)", hoverFields: [{ names: ["Area_Ac"], label: "Size", unit: "ac" }], note: "Cherry Point Gully potential detention locations.",
  }),
  tx_mb_plan_cotton_detention: plan({
    layer: 8, label: "Cotton Bayou Potential Detention", mergeGroup: "tx_mb_plan_projects", role: "area", order: 72, minZoom: 12, styleFn: planArea("#0f766e", 0.3),
    hoverTitle: "Potential detention (Cotton Bayou)", hoverFields: [{ names: ["ImprovType"], label: "Proposed" }, { names: ["Owner"], label: "Owner" }], note: "Cotton Bayou potential detention (acquisition) sites.",
  }),
  tx_mb_plan_cherry_improvements: plan({
    layer: 5, label: "Cherry Point Gully Improvements", mergeGroup: "tx_mb_plan_projects", role: "line", order: 73, minZoom: 12, styleFn: planLine("#6800b5"),
    hoverTitle: "Potential improvement (Cherry Point Gully)", hoverFields: [{ names: ["Descriptio"], label: "Work" }, { names: ["Solution_I"], label: "Project" }, { names: ["Priority"], label: "Priority" }, { names: ["Length_LF"], label: "Length", unit: "ft", format: (p) => (num(p.Length_LF) > 0 ? String(Math.round(num(p.Length_LF)).toLocaleString("en-US")) : "") }],
    note: "Proposed channel improvements.",
  }),
  tx_mb_plan_cotton_improvements: plan({
    layer: 9, label: "Cotton Bayou Improvements", mergeGroup: "tx_mb_plan_projects", role: "line", order: 74, minZoom: 12, styleFn: planLine("#ffaa00"),
    hoverTitle: "Potential improvement (Cotton Bayou)", hoverFields: [{ names: ["Descriptio"], label: "Work" }], note: "Proposed channel improvements and new ditches.",
  }),
  tx_mb_plan_culverts: plan({
    layer: 14, label: "Proposed Cross Culverts", mergeGroup: "tx_mb_plan_projects", role: "line", order: 75, minZoom: 12, styleFn: planLine("#00a336"),
    hoverTitle: "Proposed cross culvert", hoverFields: [{ names: ["CrossingID"], label: "Crossing" }, { names: ["Desc_"], label: "Description" }], note: "Proposed cross culverts.",
  }),

  /* ---- Baytown zoning (the city's own layer; reaches into Chambers County) ---- */
  tx_baytown_zoning: {
    kind: "esriFeature", ...BT, url: `${BAYTOWN_AGOL}/City_of_Baytown_Citizen_Map_WFL1/FeatureServer/10`,
    label: "Zoning (Baytown)", role: "area", group: "jurisdiction", order: 35, minZoom: 14, source: "City of Baytown GIS — Zoning", hoverSource: "City of Baytown GIS",
    fields: ["ULDCZON_20", "ORD_num", "ORD_Date", "Comment_1"],
    /* MEASURED 2026-11-12: 24,849 PARCEL-level polygons in one table (the DeSoto zoning table's problem at ten times the size). Asked simplified server-side and with every page followed, so a view fits the draw budget at
     * any zoom and the layer never refuses; parcels, so the outline stays hairline. */
    simplifyFactor: 1.5, fetchAll: true,
    styleFn: btStyle, lineLabel: { field: "ULDCZON_20", minZoom: 16, format: btLabel, declutter: true }, identifyCard: btZoningCard,
    viewLegend: (features) => btLegend(btLegendItems(features)), hoverIdentify: true, canvasIdentify: true,
    note: "Zoning districts of the City of Baytown, including its Chambers County side. Colour = district family; the code prints at close zoom; the legend lists the districts in view with the city's own names. Click for the district, ordinance and date.",
    infoCaveat: BAYTOWN_CITATION,
  },
};

/* Vintage lines for the (i) popover — what the publishers' own layers report (2026-11-12). */
export const CHAMBERS_VINTAGE = {
  tx_mb_zoning: "City of Mont Belvieu zoning layer — newest date in the layer is 2017-06-23; the layer lists no industrial district",
  tx_mb_water_main: "City of Mont Belvieu GIS — continuously edited; newest edit 2026-11-02",
  tx_mb_hydrants: "City of Mont Belvieu GIS — continuously edited; newest edit 2026-11-09",
  tx_mb_sewer_gravity: "City of Mont Belvieu GIS — continuously edited; newest edit 2026-10-20",
  tx_mb_sewer_force: "City of Mont Belvieu GIS — continuously edited; newest edit 2026-10-14",
  tx_mb_lift_stations: "City of Mont Belvieu GIS — newest edit 2025-07-22",
  tx_mb_storm_main: "City of Mont Belvieu GIS — continuously edited; newest edit 2026-09-14",
  tx_mb_storm_culverts: "City of Mont Belvieu GIS — newest edit 2024-09-18",
  tx_mb_storm_outfalls: "City of Mont Belvieu GIS — newest edit 2025-09-10",
  tx_baytown_zoning: "City of Baytown zoning layer — last edited 2023-02-16 (before the city's new code took effect 2025-01-01); parcel-level, 24,849 polygons",
};
for (const id of Object.keys(CHAMBERS_LAYERS)) if (id.startsWith("tx_mb_plan_")) CHAMBERS_VINTAGE[id] = "City of Mont Belvieu Master Drainage Plan (consultant study) — publication date not stated in the layer";

export { ID as MONT_BELVIEU };
