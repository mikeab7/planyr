/* NEW-1 (Waller County layers, 2026-11-24) — THE WALLER COUNTY GIS REGISTRY ROWS.
 *
 * Every row is `states: ["TX"]`, read from the county's own ArcGIS Online org (services1.arcgis.com/BqVKz0o32DERqyE4 — the SAME org and FeatureServer the Brookshire–Katy Drainage District
 * boundary row `bkdd` already reads; one big FeatureServer, the layer id picks the row). CORS-open (measured 2026-11-22 by the weekly sweep), so nothing rides the /gis-proxy relay.
 * Spread into the pack list with one line (sourcePacks.js) so this block shares no patch hunk with any other region's rows; fixtures and notes live in `sourceFixturesWaller.js`.
 *
 * WHAT IS NOT HERE, and why (each measured 2026-11-22): `Pipelines` (716 features) duplicates the RRC pipeline row; `Flood_Zones` (layer 56) and `Floodplain_BFE` (104) duplicate FEMA, which
 * Planyr already draws from its publisher. The optional contour, drainage-study, BKDD-development-polygon and electric-provider (answered CENTERPOINT at every point tried) layers are not wired.
 *
 * The attribute names of the first row (ROW_CLASS, ProposeROW, StreetName, Status) and of the Conservancy easement row (Name, CE_holder) are the sweep's measured ones; the other four rows
 * request every attribute (no `fields` list, so a wrong guess can never blank a layer) and their cards read the first plausible column. The live pass (V#) records the real names. */

const W = "https://services1.arcgis.com/BqVKz0o32DERqyE4/arcgis/rest/services/Brookshire_Katy_Drainage_District1/FeatureServer";
const base = { states: ["TX"], coverage: "waller", tier: "production", lastVerified: "2026-11-22", layerId: null };

export const WALLER_SOURCES = {
  wallerThoroughfare: {
    key: "wallerThoroughfare", label: "Proposed thoroughfares (Waller County Major Thoroughfare Plan)", provider: "Waller County GIS — Major Thoroughfare Plan (proposed)",
    serviceUrl: `${W}/10`, geometryType: "line",
    fields: { rowClass: "ROW_CLASS", rowWidth: "ProposeROW", name: "StreetName", status: "Status" },
    ...base,
    // Sweep 2026-11-22: 242 lines, edited 2025-12-11 — the county's future-right-of-way plan along the I-10 corridor and beyond.
  },
  wallerCpcEasements: {
    key: "wallerCpcEasements", label: "Katy Prairie Conservancy protected land (conservation easements)", provider: "Waller County GIS — Katy Prairie Conservancy protected properties (2024)",
    serviceUrl: `${W}/21`, geometryType: "polygon",
    fields: { name: "Name", holder: "CE_holder" },
    ...base,
    // Sweep: layer CPC_Protected_Properties_2024.
  },
  wallerCpcOwned: {
    key: "wallerCpcOwned", label: "Katy Prairie Conservancy owned land", provider: "Waller County GIS — Katy Prairie Conservancy owned properties (2024)",
    serviceUrl: `${W}/27`, geometryType: "polygon",
    fields: {},
    ...base,
    // Sweep: layer CPC_owned_2024.
  },
  wallerCcn: {
    key: "wallerCcn", label: "Water and sewer service areas (Waller County CCN boundaries)", provider: "Waller County GIS — CCN boundaries (certificated water / sewer service areas)",
    serviceUrl: `${W}/0`, geometryType: "polygon",
    fields: {},
    ...base,
    // Sweep: 28 polygons.
  },
  wallerMud: {
    key: "wallerMud", label: "Municipal utility districts (Waller County)", provider: "Waller County GIS — MUDs",
    serviceUrl: `${W}/103`, geometryType: "polygon",
    fields: {},
    ...base,
    // Sweep: 44 polygons; "Waller County MUD 19" at (-95.93, 29.785).
  },
  wallerFloodwayBuffer: {
    key: "wallerFloodwayBuffer", label: "County floodway buffer (Waller County)", provider: "Waller County GIS — Floodway buffer, 100 ft (2023-11)",
    serviceUrl: `${W}/51`, geometryType: "polygon",
    fields: {},
    ...base,
    // Sweep: 49 polygons. MAP LAYER ONLY — the screening math keeps its own modelled floodwayBufferFt.
  },
};

/* The county's own layers have no business in Dallas or Harris County — a "local" fixture class (≥2 points, ≥2 km apart), not the state class a Texas scope implies. */
const COUNTY_ONLY = (what) => ["local", `${what} — Waller County only; probing it in Dallas or Houston would assert a guaranteed zero.`];
export const WALLER_FIXTURE_REACH = Object.fromEntries(Object.keys(WALLER_SOURCES).map((k) => [k, COUNTY_ONLY(WALLER_SOURCES[k].label)]));
