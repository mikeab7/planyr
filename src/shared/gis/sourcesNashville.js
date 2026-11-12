/* NEW-1 / NEW-2 (Nashville stream / pond / wetland buffers + Metro pending flood maps, 2026-11-12) — THE METRO NASHVILLE GIS REGISTRY ROWS.
 *
 * Metro Nashville & Davidson County publishes two public ArcGIS Online feature services (org services2.arcgis.com/HdTo6HJqh92wn4D8, CORS-open, no token, read straight from the browser):
 *   · Stormwater_Regulation_Buffers_view — Metro Water Services' stormwater regulation buffers (Metro Stormwater Manual, Vol. 1, ch. 6 §6.10):
 *       0 FEMA Floodway Buffer (174 polygons; `BufferDistance` ft — 50 on 91, 75 on 83) · 1 Pond Buffer (993; BufferDistance 25) · 2 Stream Buffer (25,287; NO width attribute) · 3 Wetland Buffer (2,747; NO width attribute).
 *       Every layer last edited 2025-06-06. The service page size is 2,000, so the dense rows ride `fetchAll` (layers/nashvilleLayers.js).
 *   · FEMA_Floodplains_and_Floodways_view — layer 1 Approved (17,784 polygons, all adopted 2024-06-20), 2 Pending, 3 Preliminary. Edited 2026-08-18.
 *       ⛔ MEASURED 2026-11-12: layers 2 (Pending) and 3 (Preliminary) hold ZERO features (returnCountOnly, returnIdsOnly, no definition expression). The sweep that filed this item measured the layers' existence,
 *       not their contents. The rows are built anyway — the service is Metro's own pipeline for the maps, and it will fill the day a revision is posted — and they SAY so (see the layer rows' notes);
 *       their coverage fixtures prove the SERVICE answers by probing the sibling Approved layer, never by asserting a count on an empty layer.
 *
 * Every row is `states: ["TN"]`, production tier. Spread into `GIS_SOURCES` (sources.js) — one line there — so this block does not share a patch hunk with any other state's rows.
 * Fixtures and notes live in `sourceFixturesNashville.js` (off the app bundle, like every other row). */

const METRO = "https://services2.arcgis.com/HdTo6HJqh92wn4D8/arcgis/rest/services";
const base = { states: ["TN"], coverage: "nashville", tier: "production", lastVerified: "2026-11-12", layerId: null, geometryType: "polygon" };
/* a buffer row's serviceUrl IS its layer (layerId null); the two FEMA rows name the service root and a layerId list */
const BUF = `${METRO}/Stormwater_Regulation_Buffers_view/FeatureServer`;
const FEMA = `${METRO}/FEMA_Floodplains_and_Floodways_view/FeatureServer`;

export const NASHVILLE_SOURCES = {
  metroFloodwayBuffer: {
    key: "metroFloodwayBuffer", label: "Floodway buffer (Metro Water Services, Nashville)", provider: "Metro Nashville & Davidson County — Metro Water Services stormwater regulation buffers (FEMA floodway buffer)",
    serviceUrl: `${BUF}/0`, fields: { distance: "BufferDistance" }, dataLastEdited: "2025-06-06", ...base,
    // Live 2026-11-12: 174 polygons · BufferDistance 50 (91) / 75 (83) · ~218k raw vertices in a 0.2° × 0.1° window (drawn with the server simplifying to ~1 px).
  },
  metroPondBuffer: {
    key: "metroPondBuffer", label: "Pond buffer (Metro Water Services, Nashville)", provider: "Metro Nashville & Davidson County — Metro Water Services stormwater regulation buffers (pond buffer)",
    serviceUrl: `${BUF}/1`, fields: { distance: "BufferDistance" }, dataLastEdited: "2025-06-06", ...base,
    // Live 2026-11-12: 993 polygons · BufferDistance 25 on all.
  },
  metroStreamBuffer: {
    key: "metroStreamBuffer", label: "Stream buffer (Metro Water Services, Nashville)", provider: "Metro Nashville & Davidson County — Metro Water Services stormwater regulation buffers (stream buffer)",
    serviceUrl: `${BUF}/2`, fields: {}, dataLastEdited: "2025-06-06", ...base,
    // Live 2026-11-12: 25,287 polygons, NO width attribute (only GlobalID / audit fields). Antioch box -86.64,36.03,-86.62,36.045 → 72. ~378k raw vertices for 2,000 polygons.
  },
  metroWetlandBuffer: {
    key: "metroWetlandBuffer", label: "Wetland buffer (Metro Water Services, Nashville)", provider: "Metro Nashville & Davidson County — Metro Water Services stormwater regulation buffers (wetland buffer)",
    serviceUrl: `${BUF}/3`, fields: {}, dataLastEdited: "2025-06-06", ...base,
    // Live 2026-11-12: 2,747 polygons, no width attribute.
  },
  metroFemaPending: {
    key: "metroFemaPending", label: "Pending FEMA flood hazard areas (Metro Nashville)", provider: "Metro Nashville & Davidson County — FEMA Pending Flood Hazard Areas (Metro's copy of maps not yet effective)",
    serviceUrl: FEMA, ...base, layerId: [2, 1], fields: { zone: "FloodZone", description: "ZoneDescription", study: "StudyType" }, dataLastEdited: "2026-08-18",
    // layerId [2, 1]: the weekly verifier checks the row's own layer (2) AND the sibling Approved layer (1), which carries the fixtures (Pending itself is empty). `fields` lists only what all three layers share, so
    // the schema check passes on both; the click card also reads Status and Effective, which exist on layers 2 and 3 only.
    // Live 2026-11-12: 0 features (count, ids). Schema: DFIRM_ID, VersionID, FloodAreaID, StudyType, FloodZone, ZoneSubtype, ZoneDescription ("100 Year Floodplain" / "500 Year Floodplain" / "Floodway"), Status, Effective.
  },
  metroFemaPreliminary: {
    key: "metroFemaPreliminary", label: "Preliminary FEMA flood hazard areas (Metro Nashville)", provider: "Metro Nashville & Davidson County — FEMA Preliminary Flood Hazard Areas (Metro's copy of maps in review)",
    serviceUrl: FEMA, ...base, layerId: [3, 1], fields: { zone: "FloodZone", description: "ZoneDescription", study: "StudyType" }, dataLastEdited: "2026-08-18",
    // Live 2026-11-12: 0 features. Same schema as Pending (layerId [3, 1] — see above).
  },
};

/* Every row's real coverage is ONE county — a "regional" fixture class (≥2 points, ≥15 km apart), not the state class a Tennessee scope implies. */
const COUNTY_ONLY = (what) => ["regional", `${what} — Davidson County (Nashville) only; probing it in Memphis or Knoxville would assert a guaranteed zero.`];
export const NASHVILLE_FIXTURE_REACH = Object.fromEntries(Object.keys(NASHVILLE_SOURCES).map((k) => [k, COUNTY_ONLY(NASHVILLE_SOURCES[k].label)]));
