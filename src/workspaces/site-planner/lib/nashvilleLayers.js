/* Metro Nashville & Davidson County — water-quality buffers + pending / preliminary flood maps (NEW-1 / NEW-2, 2026-11-12).
 *
 * Every row is a REGIONAL source: it declares `states: ["TN"]` and `regions: ["davidson_tn"]` (serviceAreas.js: Davidson County, from the bundled county polygons — built by
 * scripts/build-service-areas.mjs), so `layerAvailableHere` hides the row — and the map's draw filter turns it off before any request — on a Memphis, Knoxville, Murfreesboro, Houston or Georgia site.
 * The registry spreads NASHVILLE_LAYERS into ALL_LAYERS, exactly as Sugar Land's rows are.
 *
 * NEW-1 — "Metro water-quality buffers": ONE panel row (merge group `metro_wq_buffers`) of four members read from Metro Water Services' Stormwater_Regulation_Buffers_view. The existing `tn_stream_buffers`
 * row (30 ft from the USGS NHD centreline, the state Construction General Permit rule) STAYS: Metro's polygons are the LOCAL rule on top of it.
 *   · the stream and wetland polygons carry NO width attribute, so the row draws the buffer and never prints a width Metro did not publish (the tier table is in the (i), constraint #4);
 *   · the service pages at 2,000 and a downtown z13 view holds ~3,800 stream polygons, so the dense rows ride `fetchAll`; the polygons are thin ribbons (378k raw vertices for 2,000), so every row asks the
 *     server to simplify to ~1 screen pixel (`simplifyFactor: 1` — about 25k vertices in the densest z13 view, measured) and none draws before z13.
 *
 * NEW-2 — "Metro floodplain — pending / preliminary maps": ONE Flood & Drainage row (merge group `metro_pending_flood`) of two members. Approved is NOT duplicated (FEMA's NFHL row is the effective map).
 *   ⛔ Both layers hold ZERO features on 2026-11-12, so today the row draws nothing; its note says so, with the date, and that an empty map is Metro's copy being empty — never proof FEMA has no revision in progress.
 *
 * City/county GIS is shown as LAYERS ONLY — nothing here is wired into Site Analysis verdicts (constraint: Site Analysis stays TRUSTED-ONLY).
 * PURE: no network, no React — unit-tested in test/nashvilleLayers.test.js. */
import { GIS_SOURCES } from "../../../shared/gis/sources.js";
import { floodwayBufferCard, streamBufferCard, pondBufferCard, wetlandBufferCard, pendingFloodCard, SWMM_CITATION } from "./nashvilleCards.js";

const METRO = { states: ["TN"], regions: ["davidson_tn"] };
const METRO_WS = "Metro Nashville & Davidson County — Metro Water Services";
const BUFFER_VINTAGE = "Metro Water Services stormwater regulation buffers — layer edited 2025-06-06";
const PENDING_VINTAGE = "Metro Nashville FEMA pending / preliminary flood hazard areas — layer edited 2026-08-18; both held 0 features on 2026-11-12";
const WQ_COLORS = Object.freeze({ stream: "#b45309", pond: "#0369a1", wetland: "#15803d", floodway: "#6d28d9" }); // design-exempt: map ink for the drawn buffer classes (cartography, not UI chrome)
const FEMA_COLORS = Object.freeze({ pending: "#a900e6", preliminary: "#e69800" }); // design-exempt: Metro's own service colours for the two map states

/* a row's endpoint IS the registry's: the buffer sources name their layer; the two FEMA sources name the service root and a layerId list whose FIRST id is the row's own layer */
const urlOf = (key) => {
  const s = GIS_SOURCES[key];
  return Array.isArray(s.layerId) ? `${s.serviceUrl}/${s.layerId[0]}` : s.serviceUrl;
};
const ribbon = (color) => (_p, opacity) => ({ color, weight: 1, opacity, fill: true, fillColor: color, fillOpacity: Math.min(0.4, opacity * 0.4) });
const fema = (color) => (_p, opacity) => ({ color, weight: 1.4, opacity, fill: true, fillColor: color, fillOpacity: Math.min(0.3, opacity * 0.3) });
const buffer = (key, o) => ({ kind: "esriFeature", ...METRO, url: urlOf(key), source: `${METRO_WS} — stormwater regulation buffers`, vintage: BUFFER_VINTAGE, minZoom: 13, simplifyFactor: 1, weight: 1, opacity: 0.55,
  role: "area", group: "flood", floodTier: "local", agency: "Metro Water Services", hoverIdentify: true, canvasIdentify: true, mergeGroup: "metro_wq_buffers", ...o });

export const NASHVILLE_MERGE_GROUPS = {
  metro_wq_buffers: {
    label: "Metro water-quality buffers",
    note: `Metro Water Services' stormwater buffers — streams, ponds, wetlands and the FEMA floodway — one switch for all four. Metro's stormwater rules limit what can be built inside them (${SWMM_CITATION}); they sit on top of the state's 30 ft construction buffer. Loads at zoom 13 and closer. Click a buffer for what applies.`,
  },
  metro_pending_flood: {
    label: "Metro floodplain — pending / preliminary maps",
    note: "Revised FEMA flood maps Metro lists as pending or preliminary — not yet in effect. As of 2026-11-12 Metro's service holds none of either, so nothing draws; it fills when Metro posts a revision. The adopted map is the FEMA flood-zone layer.",
  },
};

export const NASHVILLE_LAYERS = {
  nash_stream_buffer: buffer("metroStreamBuffer", {
    label: "Stream buffer", color: WQ_COLORS.stream, order: 6, fetchAll: true, styleFn: ribbon(WQ_COLORS.stream), legend: [{ label: "Stream buffer", color: WQ_COLORS.stream }],
    identifyCard: (props) => streamBufferCard(props), hoverTitle: "Stream buffer", hoverSource: "Metro Water Services", hoverFields: [],
    note: "Metro Water Services' stormwater buffer along a stream (25,287 mapped). The width depends on the stream's drainage area and flood study; the map draws the buffer, not which width applies. Click for what is allowed inside.",
    infoCaveat: `${SWMM_CITATION}. Streams draining under 100 acres: 30 ft from the top of bank, all no-disturb. 100 acres to 1 square mile: 50 ft (30 ft no-disturb + 20 ft outer). FEMA-studied, local-flood-study streams, and streams of 1 square mile or more: 75 ft measured from the FLOODWAY (the floodway + 50 ft no-disturb, then 25 ft outer). No-disturb zone: no clearing, grading or building. Outer zone: no structures and no impervious surface. Metro's polygons carry neither the width nor the zone split, so neither is printed per stream. The state's 30 ft construction buffer is a separate row. Screening only — a survey from top of bank governs. Layer edited 2025-06-06.`,
  }),
  nash_pond_buffer: buffer("metroPondBuffer", {
    label: "Pond buffer", color: WQ_COLORS.pond, order: 7, styleFn: ribbon(WQ_COLORS.pond), legend: [{ label: "Pond buffer", color: WQ_COLORS.pond }],
    identifyCard: (props) => pondBufferCard(props), hoverTitle: "Pond buffer", hoverSource: "Metro Water Services", hoverFields: [{ names: ["BufferDistance"], label: "buffer (ft)" }],
    note: "Metro's stormwater buffer around ponds (993 mapped), 25 ft from the normal pool.",
    infoCaveat: `${SWMM_CITATION}: ponds carry a 25 ft buffer from normal pool. Metro's layer gives the distance on every polygon (25). Screening only. Layer edited 2025-06-06.`,
  }),
  nash_wetland_buffer: buffer("metroWetlandBuffer", {
    label: "Wetland buffer", color: WQ_COLORS.wetland, order: 8, fetchAll: true, styleFn: ribbon(WQ_COLORS.wetland), legend: [{ label: "Wetland buffer", color: WQ_COLORS.wetland }],
    identifyCard: () => wetlandBufferCard(), hoverTitle: "Wetland buffer", hoverSource: "Metro Water Services", hoverFields: [],
    note: "Metro's stormwater buffer around delineated wetlands (2,747 mapped), 25 ft from the wetland edge.",
    infoCaveat: `${SWMM_CITATION}: wetlands carry a 25 ft buffer from the delineation. The polygons carry no width, so the figure is the rule's, not the layer's. A wetland the US Army Corps or TDEC regulates carries its own requirements on top. Screening only. Layer edited 2025-06-06.`,
  }),
  nash_floodway_buffer: buffer("metroFloodwayBuffer", {
    label: "FEMA floodway buffer", color: WQ_COLORS.floodway, order: 9, styleFn: ribbon(WQ_COLORS.floodway), legend: [{ label: "Floodway buffer", color: WQ_COLORS.floodway }],
    identifyCard: (props) => floodwayBufferCard(props), hoverTitle: "Floodway buffer", hoverSource: "Metro Water Services", hoverFields: [{ names: ["BufferDistance"], label: "buffer (ft)" }],
    note: "Metro's stormwater buffer beside FEMA floodways (174 mapped). Click for the buffer distance Metro records.",
    infoCaveat: `${SWMM_CITATION}: where a stream is FEMA-studied the buffer is measured from the floodway. The distance on the card (50 or 75 ft) is Metro's own attribute for each polygon. Screening only — Metro Water Services' floodplain administrator governs. Layer edited 2025-06-06.`,
  }),

  nash_flood_pending: {
    kind: "esriFeature", ...METRO, label: "Pending flood maps", mergeGroup: "metro_pending_flood", url: urlOf("metroFemaPending"), source: "Metro Nashville & Davidson County — FEMA pending flood hazard areas",
    vintage: PENDING_VINTAGE, minZoom: 11, simplifyFactor: 1, color: FEMA_COLORS.pending, weight: 1.4, opacity: 0.55, styleFn: fema(FEMA_COLORS.pending), legend: [{ label: "Pending", color: FEMA_COLORS.pending }],
    hoverIdentify: true, canvasIdentify: true, hoverTitle: "Pending flood map", hoverSource: "Metro Nashville", hoverFields: [{ names: ["ZoneDescription"] }],
    identifyCard: (props) => pendingFloodCard(props, "pending"),
    role: "area", group: "flood", order: 20, floodTier: "advisory", agency: "Metro Nashville / FEMA",
    note: "Flood hazard areas on a FEMA revision Metro lists as pending — approved but not yet in effect. EMPTY as of 2026-11-12: Metro's service holds none, so nothing draws. Click a polygon for the zone and effective date.",
    infoCaveat: "FEMA's own flood-zone layer carries only the effective (adopted) maps, so this is Metro's early look at the next ones. An empty map here means Metro has posted none — not that FEMA has none in progress; FEMA's Map Service Center lists them. Never treat it as an adopted floodplain.",
  },
  nash_flood_preliminary: {
    kind: "esriFeature", ...METRO, label: "Preliminary flood maps", mergeGroup: "metro_pending_flood", url: urlOf("metroFemaPreliminary"), source: "Metro Nashville & Davidson County — FEMA preliminary flood hazard areas",
    vintage: PENDING_VINTAGE, minZoom: 11, simplifyFactor: 1, color: FEMA_COLORS.preliminary, weight: 1.4, opacity: 0.55, styleFn: fema(FEMA_COLORS.preliminary), legend: [{ label: "Preliminary", color: FEMA_COLORS.preliminary }],
    hoverIdentify: true, canvasIdentify: true, hoverTitle: "Preliminary flood map", hoverSource: "Metro Nashville", hoverFields: [{ names: ["ZoneDescription"] }],
    identifyCard: (props) => pendingFloodCard(props, "preliminary"),
    role: "area", group: "flood", order: 21, floodTier: "advisory", agency: "Metro Nashville / FEMA",
    note: "Flood hazard areas on a draft FEMA revision under review — not adopted. EMPTY as of 2026-11-12: Metro's service holds none, so nothing draws. Click a polygon for the zone.",
    infoCaveat: "A preliminary map can change before it is adopted, and the adopted (effective) map still governs. An empty map here means Metro has posted none — not that FEMA has none in progress; FEMA's Map Service Center lists them.",
  },
};

export const NASHVILLE_LAYER_IDS = Object.freeze(Object.keys(NASHVILLE_LAYERS));
