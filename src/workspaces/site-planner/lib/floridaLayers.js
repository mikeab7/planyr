/* Florida due-diligence layer rows (B2452976, 2026-10-29) — the obvious industrial checks for a Florida site (Broward first) that Planyr did not have.
 *
 * EVERY ROW declares `states: ["FL"]` (so a Texas / Georgia / Colorado view never lists it) and, where its source only serves one county or one water
 * management district, a `regions` boundary (serviceAreas.js: `broward`, `miamidade`, `palmbeach`, `sfwmd`) so a Tampa site is not offered a Broward
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
const first = (v) => String(v == null ? "" : v).split(/[\r\n]+/)[0].trim();
/* Broward's drainage-district names carry stray line breaks and a doubled word ("Coral Bay\r\nCoral Bay"). */
export const districtName = (v) => first(v) || null;

const hex = (c) => ({ color: c });
const areaStyle = (color, fillMax = 0.25, weight = 1.2, dash = null) => (_props, opacity) => ({
  color, weight, opacity, fill: true, fillColor: color, fillOpacity: Math.min(fillMax, opacity * 0.5), dashArray: dash,
});

/* ── Hurricane evacuation zones: one hue, darker = nearer the water. Zone A is the Category-1 surge area. ─────────────────────────────────────────── */
export const EVAC_RAMP = { A: "#9a3412", B: "#c2410c", C: "#ea580c", D: "#f59e0b", E: "#fbbf24" };
export const evacColor = (zone) => EVAC_RAMP[String(zone == null ? "" : zone).trim().toUpperCase().charAt(0)] || "#fcd34d";
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
  fl_wmd: {
    kind: "esriFeature", label: "Water Management Districts", source: "South Florida Water Management District (FDEP boundary)",
    url: GIS_SOURCES.wmdFl.serviceUrl, ...FL,
    minZoom: 6, color: "#0f766e", weight: 1.6, opacity: 0.55,
    styleFn: (_p, opacity) => ({ color: "#0f766e", weight: 1.6, opacity, fill: false, dashArray: "10 5" }),
    lineLabel: { field: "WMDNAME", minZoom: 7 },
    ...hoverCommon, hoverTitle: "Water management district", hoverSource: "SFWMD",
    hoverFields: [{ names: ["WMDNAME"], label: "District" }],
    note: "The five Florida water management districts (SFWMD, SWFWMD, SJRWMD, SRWMD, NWFWMD). The district a site sits in reviews its Environmental Resource Permit (wetlands and stormwater) under its own handbook and criteria.",
    infoCaveat: "A district boundary, not a permit determination. Generalised along the coast; confirm the reviewing district with the agency.",
    role: "line", group: "jurisdiction", order: 6,
  },

  /* ── Flood & drainage ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
  fl_evac_zones: {
    kind: "esriFeature", label: "Hurricane Evacuation Zones", source: "Florida Division of Emergency Management — Know Your Zone",
    url: GIS_SOURCES.evacZonesFl.serviceUrl, ...FL,
    minZoom: 8, color: "#c2410c", weight: 1, opacity: 0.4,
    styleFn: evacStyle, simplifyFactor: 0.5,
    legend: [
      { label: "Zone A — usually the Category 1 surge area", color: EVAC_RAMP.A }, { label: "Zone B", color: EVAC_RAMP.B }, { label: "Zone C", color: EVAC_RAMP.C },
      { label: "Zone D", color: EVAC_RAMP.D }, { label: "Zone E and beyond", color: EVAC_RAMP.E },
    ],
    ...hoverCommon, hoverTitle: "Evacuation zone", hoverSource: "FDEM",
    hoverFields: [{ names: ["EZone"], label: "Zone" }, { names: ["County_Nam"], label: "County" }],
    note: "Statewide hurricane evacuation zones from the state's storm-surge (SLOSH) modelling: A floods first (Category 1), then B, C … as the storm grows. Zone A is generally the Category-1 surge area that Florida law uses to define the Coastal High Hazard Area (s. 163.3178, F.S.), but zone letters are set county by county and a county's adopted CHHA map is what governs a plan amendment or rezoning. Inland sites are in no zone.",
    infoCaveat: "Evacuation zones, not flood zones and not the FEMA floodplain — a site can be in a zone and outside the SFHA, or the reverse. A flag for insurance, lender and comp-plan review; confirm the adopted CHHA with the county.",
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

  /* ── Access ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
  fl_sis_highways: {
    kind: "esriFeature", label: "Strategic Intermodal System Highways", source: "Florida Department of Transportation",
    url: GIS_SOURCES.sisHighwaysFl.serviceUrl, ...FL,
    minZoom: 8, color: "#0369a1", weight: 2.4, opacity: 0.55,
    styleFn: (_p, opacity) => ({ color: "#0369a1", weight: 2.4, opacity, fill: false }),
    ...hoverCommon, hoverTitle: "SIS highway", hoverSource: "FDOT",
    hoverFields: [{ names: ["FACILITY"], label: "Facility" }, { names: ["SISTYPE_DE"], label: "Type" }, { names: ["COUNTY"], label: "County" }],
    note: "The highways on FDOT's Strategic Intermodal System — the state's designated high-priority freight and passenger corridors (interstates, the Turnpike, major connectors). Freight-oriented industrial sites cluster on them; a driveway or median opening onto a state road needs an FDOT connection permit, and FDOT's access-management rules apply on state roads.",
    infoCaveat: "SIS is a state planning designation, not a measure of truck volume or a guarantee of access. Confirm the access class and connection rules with the FDOT district office.",
    role: "line", group: "access", order: 6,
  },

  /* ── Environmental & hazards ────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
  fl_wellfield_broward: {
    kind: "esriFeature", label: "Wellfield Protection Zones (Broward)", source: "Broward County — Pollution Prevention, Remediation & Air Quality",
    url: GIS_SOURCES.wellfieldBroward.serviceUrl, ...FL, regions: ["broward"],
    minZoom: 10, color: "#7c3aed", weight: 1, opacity: 0.4,
    styleFn: browardWellfieldStyle, simplifyFactor: 0.5,
    legend: [{ label: "Zone 1 — innermost", color: BROWARD_WELLFIELD_RAMP[1] }, { label: "Zone 2", color: BROWARD_WELLFIELD_RAMP[2] }, { label: "Zone 3 — outermost", color: BROWARD_WELLFIELD_RAMP[3] }],
    ...hoverCommon, hoverTitle: "Wellfield protection zone", hoverSource: "Broward County",
    hoverFields: [{ names: ["ZONE"], label: "Zone" }, { names: ["LABEL"], label: "Wellfield" }],
    note: "Broward County's regulatory zones around public water-supply wells. For a well on the county's 2001 map the zones are the mapped ones; for a later well, Zone 1 is 250 ft, Zone 2 out to 500 ft and Zone 3 out to 1,320 ft (the county's own layer description of its wellfield ordinance). The ordinance restricts how regulated substances are stored, handled, used and disposed of inside the zones — generally tightest nearest the well — which matters for tenant uses (chemicals, fuel, hazardous-materials storage).",
    infoCaveat: "Screening only: Broward County's Environmental Permitting Division determines the zone and any use restriction for a parcel. Zone edges are drawn from the county's model, not surveyed.",
    role: "area", group: "environmental", order: 20,
  },
  fl_wellfield_miamidade: {
    kind: "esriFeature", label: "Wellfield Protection Areas (Miami-Dade)", source: "Miami-Dade County — Regulatory & Economic Resources",
    url: GIS_SOURCES.wellfieldMdc.serviceUrl, ...FL, regions: ["miamidade"],
    minZoom: 9, color: "#7c3aed", weight: 1, opacity: 0.4,
    styleFn: mdcWellfieldStyle, simplifyFactor: 0.5,
    legend: [{ label: "10-day travel time", color: MDC_TRAVEL_RAMP["010"] }, { label: "30-day", color: MDC_TRAVEL_RAMP["030"] }, { label: "100-day", color: MDC_TRAVEL_RAMP["100"] }, { label: "210-day", color: MDC_TRAVEL_RAMP["210"] }],
    ...hoverCommon, hoverTitle: "Wellfield protection area", hoverSource: "Miami-Dade County",
    hoverFields: [{ names: ["TRAVELTIME"], label: "Travel time" }, { names: ["NAME"], label: "Wellfield" }],
    identifyCard: (props) => ({ title: "Wellfield protection area", rows: [{ label: "Travel time to the well", text: mdcTravelDays(props.TRAVELTIME) ? `${mdcTravelDays(props.TRAVELTIME)} days` : "" }, { label: "Wellfield", text: props.NAME }] }),
    note: "Miami-Dade County's wellfield protection areas, drawn as groundwater travel-time contours to a public supply well (10, 30, 100 and 210 days). Chapter 24 of the Code of Miami-Dade County restricts land uses that could pollute the aquifer inside them, tightest nearest the well. Matters for industrial tenants that store fuel, solvents or other regulated substances.",
    infoCaveat: "Screening only: Miami-Dade County applies the restriction to a parcel. Travel-time contours are modelled and are revised by ordinance.",
    role: "area", group: "environmental", order: 21,
  },
  fl_erp_sfwmd: {
    kind: "esriFeature", label: "Approved Environmental Resource Permits", source: "South Florida Water Management District",
    url: GIS_SOURCES.erpSfwmd.serviceUrl, ...FL, regions: ["sfwmd"],
    minZoom: 12, color: "#0f766e", weight: 1.2, opacity: 0.4,
    styleFn: areaStyle("#0f766e", 0.12, 1.2), simplifyFactor: 0.5,
    ...hoverCommon, hoverTitle: "Environmental Resource Permit", hoverSource: "SFWMD",
    hoverFields: [{ names: ["PROJECT_NAME"], label: "Project" }, { names: ["PERMIT_NO"], label: "Permit no." }, { names: ["PermitType"], label: "Type" }, { names: ["PermitStatus"], label: "Status" }, { names: ["IssueDate"], label: "Issued", date: true }],
    identifyCard: (props) => ({
      title: "Environmental Resource Permit",
      rows: [
        { label: "Project", text: props.PROJECT_NAME }, { label: "Permit no.", text: props.PERMIT_NO }, { label: "Type", text: erpTypeLabel(props.PermitType) },
        { label: "Status", text: props.PermitStatus }, { label: "Issued", text: props.IssueDate }, { label: "Record", text: "", href: props.Link },
      ],
    }),
    note: "Permitted project footprints from SFWMD's regulation system. An Environmental Resource Permit (Part IV, ch. 373, F.S.) covers wetland impacts AND the stormwater system, so a neighbouring permit shows how nearby sites were drained and mitigated — and a permit on the site itself sets what may change without a modification.",
    infoCaveat: "SFWMD's footprints only (the permit record link opens its file). A site in another district's territory shows nothing here — that is not an all-clear. Footprints are not survey-accurate.",
    role: "area", group: "environmental", order: 22,
  },
  fl_conservation_lands: {
    kind: "esriFeature", label: "Conservation Lands", source: "Florida Natural Areas Inventory",
    url: GIS_SOURCES.conservationLandsFl.serviceUrl, ...FL,
    minZoom: 8, color: "#15803d", weight: 1.2, opacity: 0.4,
    styleFn: areaStyle("#15803d", 0.25, 1.2), simplifyFactor: 0.75,
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
    note: "Broward County's own wetland map, kept by its Aquatic and Wetland Resources program for planning and environmental review. In Broward, work in wetlands generally needs the county's Environmental Resource License in addition to the state / federal permits (its license numbers are in this layer's data) — this map shows where to expect it. Turn on National Wetlands for the federal inventory.",
    infoCaveat: "A planning map, not a jurisdictional delineation: edges are approximate and some mapped areas are already permitted for impact or mitigation. A wetland delineation by a consultant is the real check.",
    role: "area", group: "environmental", order: 24,
  },
  fl_natural_lands_broward: {
    kind: "esriFeature", label: "Protected Natural Lands (Broward)", source: "Broward County — Land Stewardship Program",
    url: GIS_SOURCES.naturalLandsBroward.serviceUrl, ...FL, regions: ["broward"],
    minZoom: 10, color: "#4d7c0f", weight: 1.2, opacity: 0.4,
    styleFn: areaStyle("#4d7c0f", 0.25, 1.2), simplifyFactor: 0.5,
    ...hoverCommon, hoverTitle: "Protected natural land", hoverSource: "Broward County",
    hoverFields: [{ names: ["NAME"], label: "Name" }, { names: ["OWNER"], label: "Owner" }, { names: ["MNGMTAUTHO"], label: "Managed by" }, { names: ["PRESMECHAN"], label: "Protected by" }],
    note: "Broward's inventory of protected natural lands — forested uplands and wetlands protected by ownership, easement or a land-use designation. Next to one, expect buffer, habitat and stormwater-quality questions; on one, the protection mechanism decides what is possible.",
    infoCaveat: "County inventory last edited 2018. Confirm the mechanism and boundary against the recorded instrument.",
    role: "area", group: "environmental", order: 25,
  },
};

/* Permit-type codes → words, used by the ERP row's click card. */
export const ERP_TYPES = {
  IND: "Individual", GP: "General", CA: "Conceptual approval", MIT: "Mitigation bank", DF: "Dredge & fill", SLERP: "Statewide listed", EXEM: "Exemption",
  VAR: "Variance", AQU: "Aquaculture", FWD: "Fish & wildlife", IWD: "Isolated wetland",
};
export const erpTypeLabel = (code) => { const c = String(code == null ? "" : code).trim().toUpperCase(); return c ? (ERP_TYPES[c] || c) : null; };

export const FLORIDA_VINTAGE = {
  fl_county: "FDEM county boundaries — layer edited 2026-07-22",
  fl_city: "UF GeoPlan city limits from the 2021 county tax rolls — layer edited 2024-05-03; later annexations are not in it",
  fl_wmd: "FDEP water management district boundaries (SFWMD-hosted copy) — layer edited 2021-10-31",
  fl_evac_zones: "FDEM Know Your Zone evacuation zones — updated 2026-07-24",
  fl_drainage_districts_broward: "Broward County drainage districts — layer edited 2021-06-10",
  fl_wellfield_broward: "Broward County wellfield zones — map approved 2001-02-16, ordinance revised June 2013; layer edited 2021-06-10",
  fl_wellfield_miamidade: "Miami-Dade County wellfield protection areas — layer edited 2025-11-03",
  fl_erp_sfwmd: "SFWMD Approved ERP boundaries — continuously maintained by its permitting system",
  fl_sis_highways: "FDOT SIS highways — layer edited 2026-10-26",
  fl_conservation_lands: "FNAI Florida Conservation Lands — layer edited 2026-10-06",
  fl_wetlands_broward: "Broward County wetlands — updated regularly by its Aquatic & Wetland Resources program (layer notes 2018)",
  fl_natural_lands_broward: "Broward Protected Natural Lands — layer edited 2018-10-11",
};
