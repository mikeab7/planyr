/* Tennessee — the industrial due-diligence layer rows (B2521584, 2026-10-29).
 *
 * Owner: "in all the states that our users have planned sites … think of the stuff that's really obvious that developers check for, or that
 * industrial developers check for. Like Georgia, you did a great job calling out stream buffers." This is Tennessee's set. Every row:
 *   · declares `states: ["TN"]`, so a Texas, Georgia or Mississippi view never lists it (layerLocationScope / layerStateCoverage);
 *   · reads a `GIS_SOURCES` row (src/shared/gis/sources.js) — the agency that owns the fact, live-probed with its date — and never a
 *     third-party copy; the click card wording is the pure `tennesseeCards.js` (owner constraint #45: plain labels, no raw field names);
 *   · is a MAP LAYER only. Site Analysis verdicts stay TRUSTED-ONLY (siteChecks.TRUSTED_CHECKS); nothing here adds a verdict card.
 *
 * The registry spreads TN_LAYERS into ALL_LAYERS (layers.js). The two `kind:"vector"` rows (county / city lines) have their
 * `VECTOR_SOURCES` entries in vectorLayers.js in the SAME commit — without one a vector row draws nothing (the Georgia lesson).
 *
 * PURE: no network, no React. */
import { GIS_SOURCES } from "../../../shared/gis/sources.js";
import {
  drycleanerCard, ms4Card, wqaCard, pwsCard, snaCard, scenicCard, critHabitatCard, landfillCard, thcSiteCard, nrhpBoundaryCard, dorSiteCard, nrhpPointCard, isImpairedAttainment, isThreatenedAttainment,
} from "./tennesseeCards.js";

const TN = { states: ["TN"] };
/* a state server the browser cannot read directly rides the same-origin relay (functions/gis-proxy); the registry records the server's own address */
export const viaRelay = (u) => "/gis-proxy/" + String(u).replace(/^https:\/\//, "");
const TDEC = "Tennessee Dept. of Environment & Conservation (TDEC)";

/* Water-quality assessment colouring: impaired (the EPA-approved 303(d)-style list) is the loud class; threatened next; the rest recede. */
export const wqaStyle = (props, opacity) => {
  const a = props && props.ATTAINMENT;
  const impaired = isImpairedAttainment(a), threatened = isThreatenedAttainment(a);
  const c = impaired ? "#c2410c" : threatened ? "#d97706" : /^fully/i.test(String(a || "")) ? "#2563eb" : "#9ca3af"; // design-exempt: map ink for a drawn assessment class (cartography, not UI chrome)
  return { color: c, weight: impaired ? 2 : threatened ? 2 : 1.4, opacity, fill: false };
};

export const TN_LAYERS = {
  /* ---- Jurisdictions: City limits (State of Tennessee STS; no ETJ in Tennessee — the county governs outside city limits). The county-line row `tn_county` is main's own (B2507065), offered in TN and, at DeSoto's feet, MS. ---- */
  tn_city: {
    kind: "vector", label: "City Limits (Tennessee)", mergeGroup: "counties_cities", source: "State of Tennessee (STS)",
    url: GIS_SOURCES.cityTn.serviceUrl, ...TN,
    minZoom: 9, color: "#1d4ed8", weight: 1.6, opacity: 0.4,
    note: "Tennessee municipal boundaries (State of Tennessee, 345 cities; layer last edited 2026-03-18 — annexations since are not shown). Inside = in the city; outside = unincorporated county. NOT proof of utility service.",
    infoCaveat: "A boundary means the city HAS JURISDICTION here — not that it serves or will connect utilities to a parcel.",
    role: "line", group: "jurisdiction", order: 2,
  },
  tn_ms4: {
    kind: "esriFeature", label: "Stormwater (MS4) Permit Areas", source: `${TDEC} — Division of Water Resources`,
    url: GIS_SOURCES.ms4Tn.serviceUrl, ...TN,
    minZoom: 9, color: "#475569", weight: 1.6, opacity: 0.45, simplifyFactor: 6,
    styleFn: (_p, opacity) => ({ color: "#475569", weight: 1.6, opacity, dashArray: "6 4", fillColor: "#475569", fillOpacity: opacity * 0.12 }), // design-exempt: map ink for a drawn jurisdiction area
    hoverIdentify: true, canvasIdentify: true, hoverTitle: "MS4 permit area", hoverSource: "TDEC",
    hoverFields: [{ names: ["NAME"] }, { names: ["PERMIT_NUM"], label: "permit" }],
    identifyCard: (props) => ms4Card(props),
    vintage: "TDEC MS4 permit areas — layer edited 2026-08-18",
    note: "The cities and counties that hold a Municipal Separate Storm Sewer System (MS4) permit. Inside one, that government's own stormwater, post-construction and stream-buffer rules apply on top of the state Construction General Permit; outside, the state permit governs alone. Click for the permittee and permit number.",
    infoCaveat: "A permit area says WHOSE stormwater rules apply, not what they are — buffer widths and detention criteria differ by city (Nashville, Murfreesboro and Franklin each publish their own). Get the design manual from the permittee.",
    role: "area", group: "jurisdiction", order: 6,
  },

  /* ---- Flood & Drainage: the state's water-quality assessment ---- */
  tn_wqa: {
    kind: "esriFeature", label: "Impaired & Assessed Waters", source: `${TDEC} — Division of Water Resources, 2026 Water Quality Assessment`,
    url: GIS_SOURCES.wqaTn.serviceUrl, ...TN,
    minZoom: 10, color: "#c2410c", weight: 2, opacity: 0.55, styleFn: wqaStyle, simplifyFactor: 6, // 270–370k vertices in a Middle / East Tennessee metro at the first zoom it draws
    hoverIdentify: true, canvasIdentify: true, hoverTitle: "Assessed stream", hoverSource: "TDEC",
    hoverFields: [{ names: ["ASSESSMENT_UNIT_NAME"] }, { names: ["ATTAINMENT"] }],
    identifyCard: (props) => wqaCard(props),
    vintage: "TDEC 2026 Water Quality Assessment — layer edited 2026-08-13",
    note: "TDEC's 2026 stream assessment: orange = impaired (not supporting its uses), amber = threatened, blue = fully supporting, grey = not assessed. It is the spatial companion of the EPA-approved 2026 List of Impaired and Threatened Streams. Click a stream for its status and reach.",
    infoCaveat: "Impairment can tighten the state's construction buffer (60 ft average instead of 30 ft, TNR100000) and discharge rules, but only for some causes — TDEC's own list of those waters is on its Construction General Permit map — ask TDEC's Division of Water Resources.",
    role: "line", group: "flood", order: 4,
    floodTier: "hydrography", agency: "TDEC",
  },

  tn_stream_buffers: {
    // Computed bands off the cached NHD geometry — vectorOverlay.cachedTnStreamBufferLayer and lib/tennesseeStreamBuffers.js, which holds the rule.
    kind: "pipelineCorridor", label: "Stream Buffers", swatch: "#b45309", bufferRule: "tn_streams",
    source: "USGS NHD + TDEC Construction General Permit rule (computed)",
    ...TN,
    // Vector-only: the bands exist only where the NHD centrelines came back as VECTORS, so the gate is the NHD source's own `query.minVectorZoom` (test/layerZoomGate pins the two together).
    minZoom: 12,
    opacity: 0.55,
    vintage: "Computed from USGS NHD under the Construction General Permit rule — not a surveyed buffer",
    note: "Assumed 30 ft construction buffer each side of the USGS stream centreline: the natural riparian buffer the TDEC Construction General Permit (TNR100000) directs be preserved, to the maximum extent practicable, between a stream and the limits of disturbance — an AVERAGE width, no point narrower than half of it. NOT drawn: the permit asks 60 ft on Exceptional Tennessee Waters and waters impaired for siltation / habitat, and TDEC's list of those reaches is not available to Planyr — check TDEC's Construction General Permit map. Measured from the CENTRELINE, not the top of bank, so a wide stream's true buffer starts further out. Ephemeral channels, ditches and canals are not buffered, and a wet-weather conveyance (TDEC hydrologic determination) carries none. Screening only — a surveyed top-of-bank governs.",
    infoCaveat: "These are the STATE construction buffers (rule text is the 2021 permit; TDEC reissued the permit effective 2026-10-01 — confirm its buffer section). Cities add their own post-construction buffers on top — Murfreesboro's Water Quality Protection Area policy asks 35, 50 or 60 ft by stream size and health; Metro Nashville's Stormwater Manual (Vol. 1, §6.10) sets its own. Those widths depend on drainage area and stream class this map does not carry, so they are NOT drawn: get the city's. The MS4 permit-area layer shows whose rules apply.",
    role: "area", group: "flood", order: 5,
    floodTier: "hydrography", agency: "TDEC / USGS",
  },

  /* ---- Utilities: who serves water ---- */
  tn_pws: {
    kind: "esriFeature", label: "Water Service Areas", mergeGroup: "water_sewer", source: `${TDEC} — Division of Water Resources, public water systems`,
    url: GIS_SOURCES.pwsTn.serviceUrl, ...TN,
    minZoom: 9, color: "#0369a1", weight: 1.4, opacity: 0.4, simplifyFactor: 6, // one Greeneville / Johnson City system is a single 112,589-vertex polygon that every tile returns whole
    styleFn: (_p, opacity) => ({ color: "#0369a1", weight: 1.4, opacity, fillColor: "#0369a1", fillOpacity: opacity * 0.1 }), // design-exempt: map ink for a drawn service territory
    hoverIdentify: true, canvasIdentify: true, hoverTitle: "Water service area", hoverSource: "TDEC",
    hoverFields: [{ names: ["MA_NAME"] }, { names: ["PWSID"], label: "ID" }],
    identifyCard: (props) => pwsCard(props),
    vintage: "TDEC public water system service areas — layer edited 2024-10-01",
    note: "The permitted public water system whose declared service territory holds the point (447 systems). Click for the system, its owner type, population served and a link to its TDEC Drinking Water Watch record.",
    infoCaveat: "A service territory is not a will-serve letter and not proof of a main at the property line — confirm size, pressure and capacity with the system. System names are TDEC's abbreviations.",
    role: "area", group: "utilities", order: 40,
  },

  /* ---- Environmental: contamination, natural areas, historic, habitat ---- */
  tn_drycleaners: {
    kind: "esriFeature", label: "Known Drycleaners", source: `${TDEC} — Division of Remediation (DCERP)`,
    url: GIS_SOURCES.drycleanersTn.serviceUrl, ...TN,
    minZoom: 11, color: "#a21caf", weight: 2, opacity: 0.55, pointRadius: 4,
    hoverIdentify: true, canvasIdentify: true, hoverTitle: "Drycleaner", hoverSource: "TDEC",
    hoverFields: [{ names: ["FACILITY_N"] }, { names: ["CITY"] }],
    identifyCard: (props) => drycleanerCard(props),
    vintage: "TDEC DCERP drycleaner list — layer edited 2026-02-26",
    note: "Every drycleaner registered with TDEC's Drycleaner Environmental Response Program since 1996 (pick-up-only shops are not on it). Click for whether TDEC has worked a release there or only holds the registration.",
    infoCaveat: "A Phase I ESA pre-screen: chlorinated-solvent (PCE) plumes are the classic drycleaner contamination. A shop beside the site is a flag to pull TDEC's file — not a finding, and a missing shop is not proof of none.",
    role: "point", group: "environmental", order: 21,
  },
  tn_remediation: {
    kind: "esriFeature", label: "Remediation Sites", source: `${TDEC} — Division of Remediation (DOR sites)`,
    url: GIS_SOURCES.dorSitesTn.serviceUrl, ...TN,
    minZoom: 10, color: "#9a3412", weight: 2, opacity: 0.55, pointRadius: 5,
    hoverIdentify: true, canvasIdentify: true, hoverTitle: "Remediation site", hoverSource: "TDEC",
    hoverFields: [{ names: ["DOR_Site_Name"] }, { names: ["Program"] }, { names: ["City"] }],
    identifyCard: (props) => dorSiteCard(props),
    vintage: "TDEC Division of Remediation sites — layer last edited 2024-06-25",
    note: "TDEC's register of sites in a remediation program — voluntary cleanup, State Superfund, EPA and Department of Defense sites (825 open sites). Click for the program, size, address and TDEC site ID.",
    infoCaveat: "A Phase I ESA pre-screen: pull TDEC's file for cleanup status and land-use controls. The register was last edited June 2024, so a site opened since is not on it, and a missing site is not proof of none.",
    role: "point", group: "environmental", order: 19,
  },
  tn_sna: {
    kind: "esriFeature", label: "State Natural Areas", source: `${TDEC} — Division of Natural Areas`,
    url: GIS_SOURCES.snaTn.serviceUrl, ...TN,
    minZoom: 9, color: "#15803d", weight: 1.6, opacity: 0.5,
    styleFn: (_p, opacity) => ({ color: "#15803d", weight: 1.6, opacity, fillColor: "#15803d", fillOpacity: opacity * 0.35 }), // design-exempt: map ink for a drawn designated area
    hoverIdentify: true, canvasIdentify: true, hoverTitle: "State Natural Area", hoverSource: "TDEC",
    hoverFields: [{ names: ["SNA_NAME"] }],
    identifyCard: (props) => snaCard(props),
    vintage: "TDEC Division of Natural Areas — layer edited 2026-10-13",
    note: "The 93 State Natural Areas designated under the Natural Areas Preservation Act of 1971. In Middle Tennessee these are chiefly the cedar glades around Murfreesboro and Christiana, home to federally listed plants. Click for the area's name and size.",
    infoCaveat: "A designated area is a constraint on the land itself, and a neighbouring tract often carries the same rare species. Boundaries are TDEC's public view; talk to the Division of Natural Areas before planning near one.",
    role: "area", group: "environmental", order: 22,
  },
  tn_scenic: {
    kind: "esriFeature", label: "State Scenic Rivers", source: `${TDEC} — Division of Natural Areas`,
    url: GIS_SOURCES.scenicTn.serviceUrl, ...TN,
    minZoom: 9, color: "#0e7490", weight: 1.6, opacity: 0.5, simplifyFactor: 6, // the Hatchie corridor is one 143,521-vertex MultiPolygon the service returns whole to every tile that touches it
    styleFn: (_p, opacity) => ({ color: "#0e7490", weight: 1.6, opacity, fillColor: "#0e7490", fillOpacity: opacity * 0.3 }), // design-exempt: map ink for a drawn designated corridor
    hoverIdentify: true, canvasIdentify: true, hoverTitle: "Scenic river", hoverSource: "TDEC",
    hoverFields: [{ names: ["Site_name"] }, { names: ["DESIGNATIO"] }],
    identifyCard: (props) => scenicCard(props),
    vintage: "TDEC Tennessee Scenic Rivers — layer edited 2023-09-13",
    note: "River corridors designated under the Tennessee Scenic Rivers Act of 1968 (25 corridors), with the Act's class. Click for the river, class and reach.",
    infoCaveat: "The corridor is a planning designation; the river's management plan governs what is allowed inside it. Confirm with TDEC's Division of Natural Areas.",
    role: "area", group: "environmental", order: 23,
  },
  tn_nrhp: {
    kind: "esriFeature", label: "Historic Places", source: "National Park Service — National Register of Historic Places",
    url: GIS_SOURCES.nrhpTn.serviceUrl, ...TN,
    minZoom: 11, color: "#6d28d9", weight: 2, opacity: 0.55, pointRadius: 4,
    hoverIdentify: true, canvasIdentify: true, hoverTitle: "Historic place", hoverSource: "NPS National Register",
    hoverFields: [{ names: ["RESNAME"] }, { names: ["ResType"], label: "type" }, { names: ["City"] }],
    identifyCard: (props) => nrhpPointCard(props),
    vintage: "NPS National Register — Esri Federal Data copy, edited 2026-10-28",
    note: "National Register listings — one point per listing (a district is one point, not its boundary). The Tennessee Historical Commission's inventory of recorded-but-unlisted sites is not public GIS, so an empty map is never proof of none. A flag to check with the Commission, not a clearance.",
    role: "point", group: "environmental", order: 24,
  },
  tn_cemeteries: {
    kind: "esriFeature", label: "Cemeteries", source: "USGS — GNIS cemeteries",
    url: GIS_SOURCES.cemeteriesTn.serviceUrl, ...TN,
    minZoom: 12, color: "#475569", weight: 2, opacity: 0.55, pointRadius: 3.5,
    hoverIdentify: true, canvasIdentify: true, hoverTitle: "Cemetery", hoverSource: "USGS GNIS",
    hoverFields: [{ names: ["NAME"] }, { names: ["CITY"] }],
    vintage: "USGS GNIS cemeteries — recorded sites only; no single edition date",
    note: "INCOMPLETE: recorded cemeteries only. Unrecorded family burial grounds — common on old Middle Tennessee farmland — are NOT on this layer, so an empty map is never proof of none. Tennessee law protects every known burial site; ask the county and have the property surveyed.",
    role: "point", group: "environmental", order: 27,
  },
  tn_nrhp_bounds: {
    kind: "esriFeature", label: "National Register Boundaries", source: "Tennessee Historical Commission (SHPO) — National Register boundaries",
    url: viaRelay(GIS_SOURCES.nrhpBoundsTn.serviceUrl), ...TN,
    minZoom: 12, color: "#6d28d9", weight: 1.5, opacity: 0.5, simplifyFactor: 6,
    styleFn: (_p, opacity) => ({ color: "#6d28d9", weight: 1.5, opacity, fillColor: "#6d28d9", fillOpacity: opacity * 0.2 }), // design-exempt: map ink for a drawn designated area
    hoverIdentify: true, canvasIdentify: true, hoverTitle: "National Register property", hoverSource: "THC",
    hoverFields: [{ names: ["Resource_Name"] }, { names: ["City"] }],
    identifyCard: (props) => nrhpBoundaryCard(props),
    vintage: "Tennessee Historical Commission National Register boundaries — current edition",
    note: "The footprint of each National Register property and district in Tennessee (2,047), where the point layer gives one dot. Click for the name, address and listing date.",
    infoCaveat: "A listing triggers federal Section 106 review where a federal permit or funding is involved. A property can be eligible without being listed — ask the Tennessee Historical Commission.",
    role: "area", group: "environmental", order: 25,
  },
  tn_thc_sites: {
    kind: "esriFeature", label: "Recorded Historic Sites", source: "Tennessee Historical Commission — historic sites survey",
    url: viaRelay(GIS_SOURCES.thcSitesTn.serviceUrl), ...TN,
    minZoom: 16, color: "#7c3aed", weight: 1.5, opacity: 0.55, pointRadius: 3,
    fields: ["OBJECTID", "COMNAME", "HISTNAME", "PROPADDR", "CITY", "COUNTY", "DATECONST", "ORIGUSE", "PRESUSE"], // ~100 fields exist; the card reads these (a dense view was 4–5 MB with all of them). ⛔ OBJECTID must be in the list: without it the service sends no feature id and esri-leaflet keys every point under "undefined" — ONE point draws
    hoverIdentify: true, canvasIdentify: true, hoverTitle: "Recorded historic site", hoverSource: "THC",
    hoverFields: [{ names: ["COMNAME", "HISTNAME"] }, { names: ["DATECONST"], label: "built" }],
    identifyCard: (props) => thcSiteCard(props),
    vintage: "Tennessee Historical Commission survey records — decades of paper surveys, digitisation in progress",
    note: "Buildings and sites recorded in the Tennessee Historical Commission's surveys (186,000 records) — most are NOT on the National Register. Shown close in only. The inventory is still being digitised, so an empty map is never proof of none.",
    infoCaveat: "Surveyed is not listed, and a survey can be decades old. A flag to check with the Commission (Section 106 applies where a federal permit is involved), not a clearance.",
    role: "point", group: "environmental", order: 26,
  },
  tn_landfills: {
    kind: "esriFeature", label: "Permitted Landfills", source: `${TDEC} — Division of Solid & Hazardous Waste Management`,
    url: viaRelay(GIS_SOURCES.landfillsTn.serviceUrl), ...TN,
    minZoom: 9, color: "#78350f", weight: 2, opacity: 0.55, pointRadius: 5,
    hoverIdentify: true, canvasIdentify: true, hoverTitle: "Permitted landfill", hoverSource: "TDEC",
    hoverFields: [{ names: ["PRIMARY_NAME"] }, { names: ["LANDFILL_CLASS"] }, { names: ["CITY"] }],
    identifyCard: (props) => landfillCard(props),
    vintage: "TDEC permitted landfills — current edition",
    note: "TDEC's permitted landfills across Tennessee (111 facilities, Class I–IV by the kind of waste). Click for the name, class, address and TDEC site ID.",
    infoCaveat: "A Phase I ESA pre-screen: a landfill nearby is a flag (gas migration, leachate, truck traffic). Closed and unpermitted dumps are not on this map, so an empty view is never proof of none.",
    role: "point", group: "environmental", order: 20,
  },
  tn_crit_habitat: {
    kind: "esriFeature", label: "Critical Habitat", source: "U.S. Fish & Wildlife Service",
    url: GIS_SOURCES.critHabitatTn.serviceUrl, ...TN,
    minZoom: 8, color: "#15803d", weight: 1.5, opacity: 0.45, simplifyFactor: 16, vertexBudget: 250000, // the service returns each mussel reach WHOLE (up to 314k vertices): the server simplifies to ~16 screen pixels (a screening-grade outline — the layer's own unit field says 'check the species shapefile'), re-asked every 2 zoom levels (layers.js); the worst Tennessee cell (Holston, 36.46 N −83.32 W; esri-leaflet's offset is width/height × factor, so it varies with the window's shape) measures roughly 105–215k vertices from z17 to z17.25 — under this budget; closer in (about z17.5+) it is refused, and says so
    overbudgetMsg: "Critical habitat is mapped as whole river reaches and is too detailed to draw this close in — zoom out a level or two.",
    styleFn: (_p, opacity) => ({ color: "#15803d", weight: 1.5, opacity, fillColor: "#15803d", fillOpacity: opacity * 0.5 }), // design-exempt: map ink for a drawn designated area
    hoverIdentify: true, canvasIdentify: true, hoverTitle: "Critical habitat", hoverSource: "USFWS",
    hoverFields: [{ names: ["comname"] }, { names: ["sciname"] }, { names: ["listing_status"], label: "status" }],
    identifyCard: (props) => critHabitatCard(props),
    vintage: "USFWS final critical habitat — layer edited 2026-10-21",
    note: "USFWS final critical habitat — in Tennessee mostly freshwater mussels and fish (the Stones, Duck, Clinch and Holston systems) and the cedar-glade plants. It binds FEDERAL actions, not private land directly — but a Corps stream or wetland permit is a federal action. A screen; USFWS IPaC is the authoritative species list.",
    role: "area", group: "environmental", order: 28,
  },
};

/* The ids, in panel order — the guards (test/tennesseeLayers.test.js, layerStateCoverage) read this. */
export const TN_LAYER_IDS = Object.freeze(Object.keys(TN_LAYERS));
