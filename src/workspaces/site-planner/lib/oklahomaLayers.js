/* NEW-1 (Oklahoma screening, owner 2026-10-29) — THE OKLAHOMA MAP LAYERS.
 *
 * "In all the states that our users have planned sites … think of the stuff that's really obvious that industrial developers check for." Real Oklahoma sites
 * today: northeast Oklahoma (Washington / Nowata County, ~36.90, -95.85) — a region full of orphaned oil wells, inside the Cherokee Nation's reservation, with
 * Osage County (the Osage Nation's mineral estate) next door.
 *
 * Every row declares `states: ["OK"]`, so `layerAvailableHere` offers it on an Oklahoma site and on no other (test/oklahomaScreens.test.js pins that, by name).
 * Every endpoint comes from the registry (`GIS_SOURCES.ok*`, shared/gis/sourcesOk.js — the NOT-built list and the access notes live in that file's header), and a
 * row whose agency server the build sandbox cannot reach (OCC, DEQ, OWRB — no CORS either) is read through the same-origin /gis-proxy relay: `urlFor` derives the
 * relay path FROM the registry URL so the two cannot disagree.
 *
 * Group placement follows the existing panel groups. Rows that are one idea from several services are ONE panel row (`mergeGroup`): Tribal Areas, Cleanup Sites,
 * Landfills & Waste Facilities, Drinking-Water Sources, Protected Waters — the lead member carries the legend for the whole row.
 *
 * ⛔ One table of classes per layer drives BOTH the map ink (`styleFn`) and the legend (`legend`) — a legend that does not match the map is a defect, so they are
 * never typed twice. PURE: no network, no React; the style / card rules unit-test standalone (test/oklahomaScreens.test.js). */

import { GIS_SOURCES } from "../../../shared/gis/sources.js";

const RELAY = "/gis-proxy";
/* Hosts the build sandbox cannot reach and that send no CORS header — read through the relay. */
const RELAYED_HOSTS = new Set(["gis.occ.ok.gov", "gis.deq.ok.gov", "owrb.csa.ou.edu"]);

export const registryUrl = (key) => {
  const s = GIS_SOURCES[key];
  if (!s) throw new Error(`[oklahomaLayers] unknown registry key "${key}"`);
  return s.layerId != null ? `${s.serviceUrl}/${s.layerId}` : s.serviceUrl;
};
export const viaRelay = (url) => {
  const m = /^https:\/\/([^/]+)(\/.*)$/.exec(String(url || ""));
  return m ? `${RELAY}/${m[1]}${m[2]}` : url;
};
export const urlFor = (key) => {
  const u = registryUrl(key);
  const m = /^https:\/\/([^/]+)\//.exec(u);
  return m && RELAYED_HOSTS.has(m[1]) ? viaRelay(u) : u;
};

/* ---- small pure helpers (no import from featureHover: keep this off the boot path) ---- */
const KEEP_UPPER = /\b(Llc|Inc|Llp|Lp|Pws|Rwd|Okc|Usa|Us|Ok|Occ|Deq|Pst|Nrhp|Ii|Iii|Iv)\b/g;
export const tc = (raw) => {
  const s = raw == null ? "" : String(raw).trim();
  if (!s || /[a-z]/.test(s)) return s;
  return s.toLowerCase().replace(/(^|[\s\-/.(])([a-z])/g, (_m, a, b) => a + b.toUpperCase()).replace(/\b([ODLodl]')([a-z])/g, (_m, a, b) => a.toUpperCase() + b.toUpperCase()).replace(KEEP_UPPER, (w) => w.toUpperCase()); // "DON'S" → "Don's" (not "Don'S"), "O'BRIEN" → "O'Brien"
};
const EMPTY = /^(|null|<null>|none|n\/a|undefined|unknown|0|0\.0+)$/i;
export const clean = (v) => { const s = v == null ? "" : String(v).replace(/_x000d_/gi, "").replace(/\s+/g, " ").trim(); return EMPTY.test(s) ? "" : s; };
const pick = (p, ...names) => { for (const n of names) if (p && p[n] != null && clean(p[n])) return p[n]; return null; };
const rowOf = (label, v, o = {}) => { const t = clean(v); if (!t && !o.href) return null; return { label, text: o.raw ? t : tc(t), ...(o.href ? { href: String(o.href).trim() } : {}) }; };
const dateOf = (ms) => { const n = Number(ms); if (!Number.isFinite(n) || n <= 0) return ""; return new Date(n).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }); };
const acres = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? `${n.toLocaleString("en-US", { maximumFractionDigits: 1 })} AC` : ""; };
/* An identify card: a title and the rows that have something to say. `note` is a plain sentence (rendered under the rows). */
const card = (title, build, note = null) => (props) => ({ title, rows: (build(props || {}) || []).filter(Boolean), note });

/* ---- map ink ---- */
const dot = (color, radius = 4) => (opacity) => ({ radius, color, weight: 1.5, opacity, fillColor: color, fillOpacity: opacity * 0.85 });
const area = (color, fillK = 0.18, weight = 1.5, dash = null) => (opacity) => ({ color, weight, opacity, fillColor: color, fillOpacity: opacity * fillK, ...(dash ? { dashArray: dash } : {}) });
const stroke = (color, weight = 2, dash = null) => (opacity) => ({ color, weight, opacity, fill: false, ...(dash ? { dashArray: dash } : {}) });
/* styleFn adapter: a (opacity) → style builder becomes the (props, opacity) the registry calls. */
const flat = (fn) => (_props, opacity) => fn(opacity);
const legendOf = (classes) => classes.map((c) => ({ label: c.label, color: c.color, ...(c.dash ? { dash: true } : {}) }));

/* =============================================================== Oil & gas wells (Corporation Commission) =============================================================== */
/* RBDMS `symbol_class` → one of seven map classes. ONE table: styleFn and the legend both read it. */
export const WELL_CLASSES = [
  { key: "orphan", label: "Orphan well — no responsible operator", color: "#b91c1c", radius: 5.5, classes: ["ORPHAN"] },
  { key: "queued", label: "Queued for state plugging", color: "#ea580c", radius: 5, classes: ["STATE_FUNDS_PLUGGING"] },
  { key: "ta", label: "Temporarily abandoned", color: "#d97706", radius: 4.5, classes: ["TEMPORARILY_ABANDONED"] },
  { key: "active", label: "Oil / gas / storage (not plugged)", color: "#1f2937", radius: 3.5, classes: ["OIL", "GAS", "OIL/GAS", "GAS_STORAGE"] },
  { key: "uic", label: "Injection / disposal", color: "#7c3aed", radius: 3.5, classes: ["UIC"] },
  { key: "other", label: "Dry, terminated, water supply, other", color: "#6b7280", radius: 3, classes: ["DRY", "TERMINATED", "WATER_SUPPLY", "OTHER"] },
  { key: "plugged", label: "Plugged", color: "#9ca3af", radius: 3, classes: ["PLUGGED"] },
];
export const wellClassOf = (cls) => {
  const c = String(cls == null ? "" : cls).trim().toUpperCase();
  return WELL_CLASSES.find((w) => w.classes.includes(c)) || WELL_CLASSES.find((w) => w.key === "other");
};
const wellStyle = (props, opacity) => { const w = wellClassOf(props && props.symbol_class); return dot(w.color, w.radius)(opacity); };

/* =============================================================== Dams (Water Resources Board) =============================================================== */
/* The inventory's hazard field is a mix of words and letters (High / H, Significant / S, Low / L, Decommissioned/Drained / D, Unknown / U / Non-Jurisdictional). */
export const DAM_CLASSES = [
  { key: "High", label: "High hazard", color: "#b91c1c", radius: 6 },
  { key: "Significant", label: "Significant hazard", color: "#d97706", radius: 5 },
  { key: "Low", label: "Low hazard", color: "#6b7280", radius: 4 },
  { key: "Other", label: "Drained, decommissioned or unclassified", color: "#9ca3af", radius: 3.5 },
];
export const damHazardOf = (raw) => {
  const s = String(raw == null ? "" : raw).trim().toLowerCase();
  if (s === "h" || s === "high") return "High";
  if (s === "s" || s === "significant") return "Significant";
  if (s === "l" || s === "low") return "Low";
  return "Other";
};
const damStyle = (props, opacity) => { const c = DAM_CLASSES.find((d) => d.key === damHazardOf(props && props.hazard)); return dot(c.color, c.radius)(opacity); };
const DAM_OWNER = { f: "Federal", s: "State", l: "Local government", p: "Private", u: "" };
const damOwnerType = (raw) => { const s = String(raw == null ? "" : raw).trim(); return s.length === 1 ? DAM_OWNER[s.toLowerCase()] || "" : s; };

/* =============================================================== State highways (ODOT) =============================================================== */
export const ROAD_CLASSES = [
  { key: "I", label: "Interstate", color: "#1d4ed8", weight: 2 },
  { key: "U", label: "US highway", color: "#0f766e", weight: 2 },
  { key: "S", label: "State highway", color: "#7c3aed", weight: 1.6 },
  { key: "T", label: "Turnpike", color: "#b45309", weight: 2, dash: true },
];
/* A turnpike is drawn by WHO MAINTAINS IT: ODOT's route class marks only 11 segments 'T', while 1,611 segments the Turnpike Authority maintains carry class I / S / U (measured 2026-10-29). */
export const roadClassKeyOf = (p) => (String((p && p.MAINTENANCERESPONSIBILITY) || "").trim() === "T" ? "T" : String((p && p.ODOTROUTECLASS) || "").trim());
/* A street name that is really a route code ("U059") is no name. */
const roadNameOf = (p) => { const n = clean(p && p.STREETNAME); return /^[A-Z]\d{3,4}$/.test(n) ? "" : n; };
const roadStyle = (props, opacity) => { const c = ROAD_CLASSES.find((r) => r.key === roadClassKeyOf(props)) || ROAD_CLASSES[2]; return stroke(c.color, c.weight, c.dash ? "10 5" : null)(opacity); };
const ROAD_MAINT = { C: "City", K: "County", P: "Private", S: "State (ODOT)", T: "Turnpike Authority", U: "State, urban (interstate ramps and frontage roads)", Z: "State responsibility, maintained by another" };

/* =============================================================== Tribal areas =============================================================== */
const TRIBAL = {
  otsa: { key: "otsa", label: "Tribal statistical area (Census) — not a legal boundary", color: "#7c3aed", dash: true },
  osage: { key: "osage", label: "Osage Reservation (Census)", color: "#0f766e" },
  trust: { key: "trust", label: "Trust land (Census)", color: "#a16207" },
  cherokee: { key: "cherokee", label: "Cherokee Nation reservation (the Nation's own file)", color: "#b45309", dash: true },
  land: { key: "land", label: "Cherokee Nation tribal land tracts", color: "#b45309" },
};
const tribalCensusKind = (name) => /^osage reservation$/i.test(String(name || "")) ? "osage" : /trust land/i.test(String(name || "")) ? "trust" : "otsa";
const tribalStyle = (props, opacity) => {
  const k = tribalCensusKind(props && props.NAME);
  if (k === "osage") return area(TRIBAL.osage.color, 0.12, 2)(opacity);
  if (k === "trust") return area(TRIBAL.trust.color, 0.3, 1.5)(opacity);
  return area(TRIBAL.otsa.color, 0.08, 1.2, "6 4")(opacity);
};

/* =============================================================== Cleanup programs =============================================================== */
export const CLEANUP = {
  superfund: { label: "Superfund site", color: "#7c2d12", radius: 6 },
  rcra: { label: "RCRA corrective action", color: "#c2410c", radius: 5 },
  restriction: { label: "Recorded land-use restriction", color: "#0f766e", radius: 4.5 },
  vcp: { label: "Voluntary cleanup", color: "#a16207", radius: 4.5 },
  scap: { label: "Cleanup assistance (school chemicals, armories, orphan sites)", color: "#be185d", radius: 4.5 },
  brownfieldDeq: { label: "Brownfield (DEQ)", color: "#4d7c0f", radius: 4.5 },
  brownfieldOcc: { label: "Brownfield (Corporation Commission, petroleum)", color: "#15803d", radius: 4.5 },
  release: { label: "Petroleum tank release — open case (OCC)", color: "#4338ca", radius: 5.5 },
};
export const RELEASE_CLOSED = { label: "Petroleum tank release — closed case (OCC)", color: "#a5b4fc", radius: 3.5 };
const WASTE = {
  solid: { label: "Landfill / solid-waste facility", color: "#78350f", radius: 5 },
  haz: { label: "Hazardous-waste permit site", color: "#6d28d9", radius: 5 },
};
const SOLID_TYPE = { "C/D": "Construction & demolition landfill", "C&D": "Construction & demolition landfill", CCR: "Coal combustion residual", COMP: "Compost facility", INCR: "Incinerator", MDP: "Medical waste", MDTS: "Medical transfer station", MSW: "Municipal solid-waste landfill", NHIW: "Non-hazardous industrial waste", P: "Processing", T: "Tire", TS: "Transfer station" };
const IC_PROGRAM = { SCAP: "Site Cleanup Assistance", VCP: "Voluntary Cleanup", RCRA: "RCRA", Superfund: "Superfund", "Solid Waste": "Solid waste", Brownfields: "Brownfields", "Brownfields Land Use Change": "Brownfields land-use change" };

/* =============================================================== Water =============================================================== */
const SRC_WATER = { whpa: { label: "Wellhead protection area (DEQ-modelled)", color: "#0891b2" }, buffer: { label: "Public well 300-ft buffer", color: "#0e7490" }, intake: { label: "Surface-water intake", color: "#1d4ed8" } };
export const SPECIAL_WS = [
  { key: "SR", label: "Scenic River watershed (OWRB)", color: "#0e7490" },
  { key: "ORW", label: "Outstanding Resource Waters watershed", color: "#047857" },
  { key: "HQW", label: "High Quality Waters watershed", color: "#65a30d" },
  { key: "NLW", label: "Nutrient-Limited watershed", color: "#ca8a04" },
  { key: "SWS", label: "Sensitive water-supply watershed", color: "#2563eb" },
];
const specialWsOf = (t) => SPECIAL_WS.find((w) => w.key === String(t || "").trim().toUpperCase()) || null;
const PROTECTED = { scenic: { label: "Scenic River (OWRB)", color: "#0e7490" }, areaT1: { label: "Appendix B area — parks, forests, wildlife areas", color: "#15803d" }, areaT2: { label: "Appendix B area — federally listed species", color: "#166534", dash: true }, stream: { label: "Appendix B stream", color: "#15803d" }, sens: { label: "Sensitive watershed — OKR10 stormwater permit", color: "#7e22ce", dash: true } };
export const IMPAIRED = [
  { key: "5a", label: "Impaired — TMDL needed (5a)", color: "#c2410c" },
  { key: "5b", label: "Impaired — category 5b", color: "#b45309" },
  { key: "5c", label: "Impaired — more data needed (5c)", color: "#ca8a04" },
  { key: "4a", label: "Impaired — TMDL complete (4a)", color: "#9ca3af" },
];
const impairedStyle = (props, opacity) => { const c = IMPAIRED.find((i) => i.key === String((props && props.Category) || "").trim().toLowerCase()); return stroke(c ? c.color : "#9ca3af", c && c.key !== "4a" ? 2 : 1.4)(opacity); };

/* The volume tier of every Oklahoma row (layerWeight.js LAYER_TIER — declared per layer, never inferred). Nothing here STOPS a build on its own: wells, tanks, cleanup
 * sites, dams and the protected-water layers are look-up facts (reference); the county / city lines are orientation (context). */
export const OK_LAYER_TIERS = {
  ok_county: "context", ok_city: "context", ok_road: "reference",
  ok_tribal: "reference", ok_cherokee_res: "reference", ok_cherokee_land: "reference",
  ok_wells: "reference", ok_pst: "reference",
  ok_deq_superfund: "reference", ok_deq_rcra: "reference", ok_deq_restrictions: "reference", ok_deq_vcp: "reference", ok_deq_scap: "reference", ok_deq_brownfields: "reference", ok_occ_brownfields: "reference", ok_pst_releases: "reference",
  ok_deq_solid_waste: "reference", ok_deq_haz_waste: "reference",
  ok_deq_whpa: "reference", ok_deq_well_buffers: "reference", ok_deq_intakes: "reference",
  ok_deq_appb_areas: "reference", ok_deq_appb_streams: "reference", ok_owrb_scenic: "reference", ok_owrb_special_ws: "reference", ok_deq_sensitive: "reference", ok_deq_303d: "reference",
  ok_dams: "reference", ok_nrhp: "reference", ok_cemeteries: "reference", ok_crit_habitat: "reference", ok_water_systems: "reference",
};

/* =============================================================== The rows =============================================================== */
const OKS = { states: ["OK"] };
const pointRow = (o) => ({ kind: "esriFeature", ...OKS, role: "point", hoverIdentify: true, canvasIdentify: true, opacity: 0.85, ...o });
const areaRow = (o) => ({ kind: "esriFeature", ...OKS, role: "area", hoverIdentify: true, canvasIdentify: true, opacity: 0.55, ...o });
const lineRow = (o) => ({ kind: "esriFeature", ...OKS, role: "line", hoverIdentify: true, canvasIdentify: true, opacity: 0.85, ...o });

export const OK_MERGE_GROUPS = {
  ok_tribal: { label: "Tribal Areas", note: "Census tribal areas, the Osage Reservation, and — where the Nation publishes it — the Cherokee Nation's reservation and tribal land. Jurisdiction on tribal land is a legal question; this is where to start asking it." },
  ok_cleanup: { label: "Cleanup Sites (DEQ & OCC)", note: "Every Oklahoma cleanup program that publishes a map: DEQ Superfund, RCRA corrective action, Voluntary Cleanup, Cleanup Assistance, Brownfields and recorded land-use restrictions, plus the Corporation Commission's petroleum Brownfields. A Phase I ESA pre-screen, not a substitute for one." },
  ok_waste: { label: "Landfills & Waste Facilities", note: "DEQ-permitted landfills and solid-waste facilities, and hazardous-waste permit sites." },
  ok_source_water: { label: "Drinking-Water Sources", note: "Where public drinking water comes from: DEQ-modelled wellhead protection areas, the fixed 300-ft circle around each public well, and surface-water intakes." },
  ok_protected_waters: { label: "Protected Waters", note: "Waters Oklahoma protects beyond the ordinary: Water Quality Standards Appendix B areas and streams, Scenic Rivers and the special-provision watersheds, and the sensitive watersheds the OKR10 construction stormwater permit singles out." },
};

const CLEANUP_LEGEND = legendOf([...Object.values(CLEANUP), RELEASE_CLOSED].map((c) => ({ label: c.label, color: c.color })));
const TRIBAL_LEGEND = legendOf([TRIBAL.otsa, TRIBAL.osage, TRIBAL.trust, TRIBAL.cherokee, TRIBAL.land]);
const WATER_LEGEND = legendOf([SRC_WATER.whpa, SRC_WATER.buffer, SRC_WATER.intake]);
const PROTECTED_LEGEND = legendOf([PROTECTED.areaT1, PROTECTED.areaT2, PROTECTED.stream, PROTECTED.sens, PROTECTED.scenic, ...SPECIAL_WS]);

const OCC_NOTE_SRC = "Oklahoma Corporation Commission";
const DEQ = "Oklahoma DEQ";

export const OK_LAYERS = {
  /* ---------------------------------------------------------------- Jurisdictions & authority ---------------------------------------------------------------- */
  ok_county: {
    kind: "vector", label: "County Boundaries (Oklahoma)", mergeGroup: "counties_cities", source: "Oklahoma Department of Transportation",
    url: GIS_SOURCES.okCounty.serviceUrl, ...OKS,
    minZoom: 6, color: "#374151", weight: 1.6, opacity: 0.4,
    note: "Oklahoma county lines (ODOT, all 77 counties). Outside city limits, ask the county what land-use rules apply — Oklahoma counties vary. A has-jurisdiction boundary, not a service area.",
    role: "line", group: "jurisdiction", order: 1,
  },
  ok_city: {
    kind: "vector", label: "City Limits (Oklahoma)", mergeGroup: "counties_cities", source: "Oklahoma Department of Transportation (from the Oklahoma Tax Commission)",
    url: GIS_SOURCES.okCity.serviceUrl, ...OKS,
    minZoom: 9, color: "#1d4ed8", weight: 1.6, opacity: 0.4,
    note: "Oklahoma city and town limits (ODOT, collected from the Oklahoma Tax Commission; 597 places). Inside = in the city; outside = unincorporated county. ETJ is not mapped for Oklahoma. NOT proof of utility service.",
    infoCaveat: "A boundary means the city HAS JURISDICTION here — not that it serves or will connect utilities to a parcel.",
    role: "line", group: "jurisdiction", order: 2,
  },
  ok_road: lineRow({
    label: "State Highways (Oklahoma)", source: "Oklahoma Department of Transportation",
    url: GIS_SOURCES.okRoad.serviceUrl, where: GIS_SOURCES.okRoad.where,
    // The layer holds ~80,000 segments of every road; a view of the state system is still ~2,000 pieces, and each carries ninety attributes — ask for the seven the card prints.
    fields: ["ODOTROUTECLASS", "STREETNAME", "ROUTE_ID", "AADT", "MAINTENANCERESPONSIBILITY", "TRUCKROUTE"],
    minZoom: 12, color: "#7c3aed", weight: 1.6, styleFn: roadStyle, legend: legendOf(ROAD_CLASSES),
    hoverTitle: "State highway", hoverSource: "ODOT",
    identifyCard: card("State highway", (p) => [
      rowOf("Road", roadNameOf(p)),
      rowOf("Class", (ROAD_CLASSES.find((r) => r.key === roadClassKeyOf(p)) || {}).label, { raw: true }),
      rowOf("Maintained by", ROAD_MAINT[String(p.MAINTENANCERESPONSIBILITY || "").trim()], { raw: true }),
      rowOf("Traffic", Number(p.AADT) > 0 ? `${Number(p.AADT).toLocaleString("en-US")} vehicles a day` : "", { raw: true }),
      Number(p.TRUCKROUTE) === 1 ? rowOf("Truck route", "Yes", { raw: true }) : null,
    ].filter(Boolean)),
    note: "ODOT's state system — Interstates, US highways, state highways and turnpikes. On a state-system road ODOT (or the Turnpike Authority) usually permits the access — the card's 'Maintained by' says when a city or county maintains it; off the state system the county or city does. An absent line is NOT 'unmaintained'.",
    infoCaveat: "Loads zoomed in. ODOT's linear-referencing inventory (edited 2026-10-26); a driveway permit decides the access, not this line.",
    group: "jurisdiction", order: 3,
  }),

  /* ---- Tribal areas (one panel row, four members) ---- */
  ok_tribal: areaRow({
    label: "Tribal Areas (Census)", mergeGroup: "ok_tribal", source: "U.S. Census Bureau (via Esri U.S. Federal Datasets)",
    url: GIS_SOURCES.okTribal.serviceUrl, where: GIS_SOURCES.okTribal.where, simplifyFactor: 0.5,
    minZoom: 7, color: TRIBAL.otsa.color, weight: 1.2, styleFn: tribalStyle, legend: TRIBAL_LEGEND,
    hoverTitle: "Tribal area", hoverSource: "U.S. Census Bureau",
    identifyCard: card("Tribal area", (p) => [rowOf("Name", String(p.NAME || "").replace(/\s+OTSA$/i, " (statistical area)"), { raw: true })],
      "Census Oklahoma Tribal Statistical Areas are statistical areas the Bureau draws with each tribe — they are not legal boundaries and not a ruling on jurisdiction. Whether a parcel is 'Indian country' for a criminal, civil, tax or regulatory purpose is a legal question; ask counsel and the tribal government early."),
    note: "Census 'American Indian / Alaska Native / Native Hawaiian' areas in Oklahoma: the 25 Oklahoma Tribal Statistical Areas plus four joint-use areas (OTSAs, dashed — statistical, NOT legal boundaries; they overlap where tribes share ground), the Osage Reservation and the Shawnee trust land.",
    infoCaveat: "Since McGirt v. Oklahoma (2020) several Nations' historic reservations are recognized for some purposes. What that means for a given parcel — criminal, civil, tax, regulatory — is a legal question no map answers. In Osage County the Osage Nation also owns the minerals below the ground (the Osage Mineral Estate); excavation there can need the Nation's and the BIA's sign-off (U.S. v. Osage Wind, 10th Cir. 2017).",
    group: "jurisdiction", order: 21,
  }),
  ok_cherokee_res: areaRow({
    label: "Cherokee Nation Reservation", mergeGroup: "ok_tribal", source: "Cherokee Nation",
    url: GIS_SOURCES.okCherokeeRes.serviceUrl, minZoom: 6, color: TRIBAL.cherokee.color, weight: 2,
    styleFn: (_p, opacity) => stroke(TRIBAL.cherokee.color, 2, "9 5")(opacity),
    hoverTitle: "Cherokee Nation reservation", hoverSource: "Cherokee Nation",
    identifyCard: card("Cherokee Nation reservation", (p) => [rowOf("Area", acres(p.Acres), { raw: true })],
      "The Cherokee Nation's own depiction of its reservation. The legal effect on a given parcel is a question for counsel and the Nation."),
    note: "The Cherokee Nation's reservation boundary, as the Nation publishes it (edited 2026-09-24).",
    role: "line", group: "jurisdiction", order: 22,
  }),
  ok_cherokee_land: areaRow({
    label: "Cherokee Nation Tribal Land", mergeGroup: "ok_tribal", source: "Cherokee Nation",
    url: GIS_SOURCES.okCherokeeLand.serviceUrl, minZoom: 10, color: TRIBAL.land.color, weight: 1.4,
    styleFn: flat(area(TRIBAL.land.color, 0.3, 1.4)),
    hoverTitle: "Tribal land tract", hoverSource: "Cherokee Nation",
    identifyCard: card("Cherokee Nation tribal land", (p) => [rowOf("County", p.COUNTY), rowOf("Tract", p.Tract_ID, { raw: true }), rowOf("Area", acres(p.Acres), { raw: true })],
      "Land the Nation lists as tribal land. Whether a tract is trust, restricted or fee land, and what that means for a purchase or a permit, is for the Nation's realty office to say."),
    note: "Tracts the Cherokee Nation publishes as 'Tribal Land' (458 tracts, edited 2026-09-21).",
    group: "jurisdiction", order: 23,
  }),

  /* ---------------------------------------------------------------- Environmental & hazards ---------------------------------------------------------------- */
  ok_wells: pointRow({
    label: "Oil & Gas Wells (Oklahoma)", source: OCC_NOTE_SRC,
    url: urlFor("okWells"), fields: ["symbol_class", "well_name", "well_num", "operator", "county"],
    minZoom: 13, color: "#1f2937", weight: 1.5, pointRadius: 4, styleFn: wellStyle, legend: legendOf(WELL_CLASSES),
    hoverTitle: "Oil & gas well", hoverSource: "OCC",
    identifyCard: card("Oil & gas well", (p) => {
      const w = wellClassOf(p.symbol_class);
      return [
        rowOf("Well", [clean(p.well_name), clean(p.well_num)].filter(Boolean).join(" ")),
        clean(p.symbol_class) ? rowOf("Status", w.label, { raw: true }) : null,
        /not assigned/i.test(String(p.operator || "")) ? rowOf("Operator", "None assigned", { raw: true }) : rowOf("Operator", p.operator),
        rowOf("County", p.county),
      ];
    }),
    note: "Every well on the Oklahoma Corporation Commission's record (457,000+) — orphan wells in red, wells queued for state plugging in orange, temporarily abandoned in amber, plugged wells in light grey. Loads zoomed in.",
    infoCaveat: "Locations are as filed with the Commission and older wells can be approximate. An orphan, unplugged or temporarily abandoned well near a building footprint calls for a field search and a plugging-status check with the Commission's Oil & Gas Conservation Division. Pipelines are not published (the Commission's pipeline data needs a login) — see the Pipelines row for the approximate EIA lines.",
    group: "environmental", order: 21,
  }),
  ok_pst: pointRow({
    label: "Petroleum Storage Tanks (Oklahoma)", source: OCC_NOTE_SRC,
    url: urlFor("okPst"), fields: ["facility_name", "facility_type", "facility_status", "address1", "city", "active_ust_tank_count", "active_ast_tank_count", "indian_trust_lands"],
    minZoom: 12, color: "#854d0e", weight: 1.5, pointRadius: 4,
    hoverTitle: "Tank facility", hoverSource: "OCC",
    identifyCard: card("Petroleum storage tank facility", (p) => [
      rowOf("Facility", p.facility_name),
      rowOf("Type", p.facility_type, { raw: true }),
      rowOf("Status", p.facility_status, { raw: true }),
      rowOf("Address", [clean(p.address1), clean(p.city)].filter(Boolean).join(", ")),
      Number(p.active_ust_tank_count) > 0 ? rowOf("Underground tanks", p.active_ust_tank_count, { raw: true }) : null,
      Number(p.active_ast_tank_count) > 0 ? rowOf("Aboveground tanks", p.active_ast_tank_count, { raw: true }) : null,
      /^yes$/i.test(String(p.indian_trust_lands || "")) ? rowOf("On Indian trust land", "Yes", { raw: true }) : null,
    ].filter(Boolean)),
    note: "The Corporation Commission's register of regulated petroleum storage tank facilities (21,000+): gas stations, distributors, farms, industrial sites. A REGISTER of tanks, not a leak list — the Commission's release (leaking-tank) cases are their own row, Petroleum Tank Releases, in Cleanup Sites. A Phase I ESA pre-screen.",
    group: "environmental", order: 22,
  }),

  ok_deq_superfund: pointRow({
    label: "Superfund Sites", mergeGroup: "ok_cleanup", source: DEQ + " — Land Protection",
    url: urlFor("okSuperfund"), minZoom: 8, color: CLEANUP.superfund.color, weight: 1.5, pointRadius: CLEANUP.superfund.radius,
    legend: CLEANUP_LEGEND, hoverTitle: "Superfund site", hoverSource: "Oklahoma DEQ",
    identifyCard: card("Superfund site", (p) => [rowOf("Site", p.NPL_SITE), rowOf("EPA ID", p.EPA_ID, { raw: true }), /^https?:/i.test(String(p.Link || "")) ? rowOf("Site page", "", { href: p.Link }) : null].filter(Boolean)),
    note: "DEQ's Superfund (National Priorities List) sites — 18 in Oklahoma, at DEQ's own coordinates.",
    infoCaveat: "A listed site is a flag to pull the DEQ and EPA file. A site's footprint is larger than its point.",
    group: "environmental", order: 23,
  }),
  ok_deq_rcra: pointRow({
    label: "RCRA Corrective Action", mergeGroup: "ok_cleanup", source: DEQ + " — Land Protection",
    url: urlFor("okRcra"), minZoom: 8, color: CLEANUP.rcra.color, weight: 1.5, pointRadius: CLEANUP.rcra.radius,
    hoverTitle: "RCRA corrective-action site", hoverSource: "Oklahoma DEQ",
    identifyCard: card("RCRA corrective-action site", (p) => [rowOf("Facility", p.Facility_N), rowOf("City", p.City), rowOf("County", p.Cty), /^https?:/i.test(String(p.DEQWeblink || "")) ? rowOf("DEQ file", "", { href: p.DEQWeblink }) : null].filter(Boolean)),
    note: "Hazardous-waste treatment, storage and disposal facilities DEQ has under corrective action (43).",
    group: "environmental", order: 24,
  }),
  ok_deq_restrictions: pointRow({
    label: "Land-Use Restrictions", mergeGroup: "ok_cleanup", source: DEQ + " — Land Protection",
    url: urlFor("okInstControl"), minZoom: 8, color: CLEANUP.restriction.color, weight: 1.5, pointRadius: CLEANUP.restriction.radius,
    hoverTitle: "Land-use restriction", hoverSource: "Oklahoma DEQ",
    identifyCard: card("Land-use restriction on a cleanup site", (p) => [
      rowOf("Site", p.FacilityNa),
      rowOf("Program", IC_PROGRAM[String(p.Program || "").trim()] || p.Program, { raw: true }),
      rowOf("Restriction", p.Land_Use_Restrictions, { raw: true }),
      rowOf("Filed", dateOf(p.DateFiled), { raw: true }),
      rowOf("County", p.County),
      /^https?:/i.test(String(p.Link_to_Do || "").trim()) ? rowOf("Filed notice", "", { href: p.Link_to_Do }) : null,
    ].filter(Boolean)),
    note: "Cleanup sites where DEQ has a land-use restriction on file (900) — typically a recorded deed notice or covenant that can bar residential use, groundwater use or digging. The restriction runs with the land.",
    infoCaveat: "The point is DEQ's site coordinate; the restriction applies to the affected property described in the filed notice.",
    group: "environmental", order: 25,
  }),
  ok_deq_vcp: pointRow({
    label: "Voluntary Cleanup", mergeGroup: "ok_cleanup", source: DEQ + " — Land Protection",
    url: urlFor("okVcp"), minZoom: 8, color: CLEANUP.vcp.color, weight: 1.5, pointRadius: CLEANUP.vcp.radius,
    hoverTitle: "Voluntary Cleanup Program site", hoverSource: "Oklahoma DEQ",
    identifyCard: card("Voluntary Cleanup Program site", (p) => [rowOf("Site", p.Facility_Name), rowOf("County", p.County)]),
    note: "Properties in DEQ's Voluntary Cleanup Program (78; DEQ's data set was last updated 1/25/2022).",
    group: "environmental", order: 26,
  }),
  ok_deq_scap: pointRow({
    label: "Cleanup Assistance Sites", mergeGroup: "ok_cleanup", source: DEQ + " — Land Protection",
    url: urlFor("okScap"), minZoom: 8, color: CLEANUP.scap.color, weight: 1.5, pointRadius: CLEANUP.scap.radius,
    hoverTitle: "Cleanup assistance site", hoverSource: "Oklahoma DEQ",
    identifyCard: card("Cleanup assistance site", (p) => [rowOf("Site", p.Site_Name), rowOf("Kind", p.Site_Type, { raw: true }), rowOf("City", p.City)]),
    note: "DEQ's Site Cleanup Assistance Program (286): abandoned hazardous-waste sites, closed armories, community revitalization sites and school chemical disposal.",
    group: "environmental", order: 27,
  }),
  ok_deq_brownfields: pointRow({
    label: "Brownfields (DEQ)", mergeGroup: "ok_cleanup", source: DEQ + " — Land Protection",
    url: urlFor("okBrownfieldDeq"), minZoom: 8, color: CLEANUP.brownfieldDeq.color, weight: 1.5, pointRadius: CLEANUP.brownfieldDeq.radius,
    hoverTitle: "Brownfield site", hoverSource: "Oklahoma DEQ",
    identifyCard: card("Brownfield site", (p) => [
      rowOf("Site", p.Site_Name), rowOf("Status", ({ RLF: "Revolving loan fund site", "Certificate Completed and RLF": "Certificate completed, revolving loan fund" })[String(p.Status || "").trim()] || p.Status, { raw: true }), rowOf("Kind", p.Type_of_Site, { raw: true }), rowOf("Contamination", p.Nature_of_Contamination, { raw: true }),
      rowOf("Allowed use", p.Allowable_Use, { raw: true }), rowOf("Address", p.Address, { raw: true }),
    ].filter(Boolean)),
    note: "DEQ's Brownfields program (103): Certificate and revolving-loan-fund sites, with what was found and what use the cleanup allows.",
    group: "environmental", order: 28,
  }),
  ok_occ_brownfields: pointRow({
    label: "Brownfields (Corporation Commission)", mergeGroup: "ok_cleanup", source: OCC_NOTE_SRC + " — Brownfields Program",
    url: GIS_SOURCES.okBrownfieldOcc.serviceUrl, minZoom: 8, color: CLEANUP.brownfieldOcc.color, weight: 1.5, pointRadius: CLEANUP.brownfieldOcc.radius,
    hoverTitle: "Petroleum brownfield site", hoverSource: "OCC",
    identifyCard: card("Petroleum brownfield site", (p) => [rowOf("Site", p.SiteName), rowOf("Status", p.Status, { raw: true }), rowOf("Kind", p.Type, { raw: true }), rowOf("City", p.City), rowOf("County", p.County)].filter(Boolean)),
    note: "Sites in the Corporation Commission's Brownfields Program (108) — the petroleum counterpart of DEQ's Brownfields.",
    group: "environmental", order: 29,
  }),

  ok_pst_releases: pointRow({
    label: "Petroleum Tank Releases", mergeGroup: "ok_cleanup", source: OCC_NOTE_SRC + " — Petroleum Storage Tank Division",
    url: urlFor("okPstReleases"), fields: ["facility_name", "case_status", "case_type", "release_date", "close_date", "release_cause_type", "tank_type", "address1", "city", "county", "case_number"],
    minZoom: 11, color: CLEANUP.release.color, weight: 1.5, pointRadius: CLEANUP.release.radius,
    styleFn: (p, opacity) => (String((p && p.case_status) || "").trim().toLowerCase() === "open" ? dot(CLEANUP.release.color, CLEANUP.release.radius) : dot(RELEASE_CLOSED.color, RELEASE_CLOSED.radius))(opacity),
    hoverTitle: "Petroleum tank release", hoverSource: "OCC",
    identifyCard: card("Petroleum tank release (leaking tank)", (p) => [
      rowOf("Facility", p.facility_name),
      rowOf("Case status", p.case_status, { raw: true }),
      rowOf("Case type", p.case_type, { raw: true }),
      rowOf("Released", dateOf(p.release_date), { raw: true }),
      rowOf("Closed", dateOf(p.close_date), { raw: true }),
      rowOf("Cause", p.release_cause_type, { raw: true }),
      rowOf("Tank", p.tank_type, { raw: true }),
      rowOf("Address", [clean(p.address1), clean(p.city)].filter(Boolean).join(", ")),
      rowOf("Case no.", p.case_number, { raw: true }),
    ].filter(Boolean), "A closed case is a case the Commission has closed, not proof the ground is clean — ask the Commission for the file."),
    note: "The Corporation Commission's petroleum-tank release (leaking underground / aboveground storage tank) cases — 7,600+, open cases in dark indigo, closed cases pale. The most direct Phase I flag for a gas-station or fuel-yard neighbour.",
    infoCaveat: "At the facility's own coordinate; a release can reach beyond the tank site. Closed does not mean clean.",
    group: "environmental", order: 29.5,
  }),
  ok_deq_solid_waste: pointRow({
    label: "Landfills & Solid-Waste Facilities", mergeGroup: "ok_waste", source: DEQ + " — Land Protection",
    url: urlFor("okSolidWaste"), minZoom: 9, color: WASTE.solid.color, weight: 1.5, pointRadius: WASTE.solid.radius,
    legend: legendOf([WASTE.solid, WASTE.haz]), hoverTitle: "Solid-waste facility", hoverSource: "Oklahoma DEQ",
    identifyCard: card("Solid-waste facility", (p) => [rowOf("Facility", p.Facility_Name), rowOf("Kind", SOLID_TYPE[String(p.Facility_Type || "").trim()] || p.Facility_Type, { raw: true }), rowOf("City", p.City), rowOf("County", p.Cty)].filter(Boolean)),
    note: "DEQ-permitted solid-waste facilities (147): landfills of every kind, transfer stations, incinerators, compost, tire and medical-waste facilities.",
    infoCaveat: "A landfill's waste footprint is larger than its point. Landfill gas, settlement and groundwater make adjacent ground a geotechnical and environmental question.",
    group: "environmental", order: 30,
  }),
  ok_deq_haz_waste: pointRow({
    label: "Hazardous-Waste Permit Sites", mergeGroup: "ok_waste", source: DEQ + " — Land Protection",
    url: urlFor("okHazWaste"), minZoom: 9, color: WASTE.haz.color, weight: 1.5, pointRadius: WASTE.haz.radius,
    hoverTitle: "Hazardous-waste permit site", hoverSource: "Oklahoma DEQ",
    identifyCard: card("Hazardous-waste permit site", (p) => [rowOf("Facility", p.Facility_N), rowOf("Kind", p.Facility_Type, { raw: true }), rowOf("City", p.City), rowOf("County", p.County)].filter(Boolean)),
    note: "Facilities holding a DEQ hazardous-waste permit (28): treatment, storage, disposal and transfer.",
    group: "environmental", order: 31,
  }),

  ok_deq_whpa: areaRow({
    label: "Wellhead Protection Areas", mergeGroup: "ok_source_water", source: DEQ + " — Water Quality",
    url: urlFor("okWhpa"), fields: ["ZONE"], simplifyFactor: 0.5, minZoom: 11, color: SRC_WATER.whpa.color, weight: 1.2,
    styleFn: (p, opacity) => area(SRC_WATER.whpa.color, { A: 0.35, B: 0.22, C: 0.12 }[String(p && p.ZONE || "").trim().toUpperCase()] || 0.15, 1.2)(opacity),
    legend: WATER_LEGEND, hoverTitle: "Wellhead protection area", hoverSource: "Oklahoma DEQ",
    identifyCard: card("Wellhead protection area", (p) => [rowOf("Zone", p.ZONE, { raw: true })],
      "DEQ's modelled area around a public water-supply well; the zone letters are DEQ's. Ask DEQ Water Quality what each zone restricts."),
    note: "DEQ's modelled wellhead protection areas around public water-supply wells (5,900 zones). Land use inside is limited to protect the drinking-water source.",
    infoCaveat: "Modelled by DEQ per well; where a well has no modelled area, only its fixed well buffer is drawn.",
    group: "environmental", order: 32,
  }),
  ok_deq_well_buffers: areaRow({
    label: "Public-Well 300-ft Buffers", mergeGroup: "ok_source_water", source: DEQ + " — Water Quality (OAC 252:626-7-4)",
    url: urlFor("okWellBuffer"), fields: ["SYSTEM", "SOURCE_NAM", "SOURCE_TYP", "POP_SERVED", "COUNTY"], minZoom: 13, color: SRC_WATER.buffer.color, weight: 1.2,
    styleFn: flat(area(SRC_WATER.buffer.color, 0.25, 1.2)),
    hoverTitle: "Public-well buffer", hoverSource: "Oklahoma DEQ",
    identifyCard: card("Public water-supply well", (p) => [rowOf("System", p.SYSTEM), rowOf("Source", p.SOURCE_NAM), rowOf("Serves", Number(p.POP_SERVED) > 0 ? `${Number(p.POP_SERVED).toLocaleString("en-US")} people` : "", { raw: true }), rowOf("County", p.COUNTY)].filter(Boolean),
      "DEQ rule OAC 252:626-7-4: a public drinking-water well is not to be located within 300 feet of any existing or potential source of pollution."),
    note: "A fixed 300-ft circle around each public water-supply well, drawn by DEQ from its 2014 well layer. A fixed radius — where a modelled wellhead protection area exists it is the better guide.",
    group: "environmental", order: 33,
  }),
  ok_deq_intakes: pointRow({
    label: "Surface-Water Intakes", mergeGroup: "ok_source_water", source: DEQ + " — Water Quality",
    url: urlFor("okPwsIntake"), fields: ["SYSTEM", "FACILITY"], minZoom: 9, color: SRC_WATER.intake.color, weight: 1.5, pointRadius: 5,
    hoverTitle: "Surface-water intake", hoverSource: "Oklahoma DEQ",
    identifyCard: card("Public water-supply intake", (p) => [rowOf("System", p.SYSTEM), rowOf("Intake", p.FACILITY)].filter(Boolean)),
    note: "Where public water systems take drinking water from a river or lake (216).",
    group: "environmental", order: 34,
  }),

  ok_deq_appb_areas: areaRow({
    label: "Appendix B Protected Areas", mergeGroup: "ok_protected_waters", source: DEQ + " — Water Quality Standards (OAC 252:730)",
    url: urlFor("okAppendixBArea"), fields: ["NAME", "TYPE", "AB_TABLE"], simplifyFactor: 0.5, minZoom: 8, color: PROTECTED.areaT1.color, weight: 1.4,
    styleFn: (p, opacity) => (Number(p && p.AB_TABLE) === 2 ? area(PROTECTED.areaT2.color, 0.18, 1.4, "6 4") : area(PROTECTED.areaT1.color, 0.14, 1.4))(opacity),
    legend: PROTECTED_LEGEND, hoverTitle: "Appendix B protected area", hoverSource: "Oklahoma DEQ",
    identifyCard: card("Appendix B protected area", (p) => [
      rowOf("Name", p.NAME), rowOf("Kind", p.TYPE, { raw: true }),
      rowOf("Table", Number(p.AB_TABLE) === 2 ? "Table 2 — federally listed species" : Number(p.AB_TABLE) === 1 ? "Table 1 — parks, forests, wildlife areas" : "", { raw: true }),
    ].filter(Boolean), "Waters in Appendix B areas carry extra protection under the Oklahoma Water Quality Standards (OAC 252:730); DEQ's general discharge permits can exclude them. Confirm with DEQ Water Quality."),
    note: "Areas listed in Appendix B of the Oklahoma Water Quality Standards (OAC 252:730) — Table 1: waters in national and state parks, forests, wildlife areas and refuges; Table 2: areas with federally listed threatened or endangered species.",
    group: "environmental", order: 35,
  }),
  ok_deq_appb_streams: lineRow({
    label: "Appendix B Protected Streams", mergeGroup: "ok_protected_waters", source: DEQ + " — Water Quality Standards (OAC 252:730)",
    url: urlFor("okAppendixBLine"), fields: ["NAME", "APXB_NAME", "AB_TABLE", "SPECIES"], minZoom: 8, color: PROTECTED.stream.color, weight: 2,
    styleFn: flat(stroke(PROTECTED.stream.color, 2)),
    hoverTitle: "Appendix B protected stream", hoverSource: "Oklahoma DEQ",
    identifyCard: card("Appendix B protected stream", (p) => [rowOf("Stream", pick(p, "APXB_NAME", "NAME")), rowOf("Species", p.SPECIES)].filter(Boolean)),
    note: "The stream segments of the Appendix B areas (14).",
    group: "environmental", order: 36,
  }),
  ok_deq_sensitive: areaRow({
    label: "Stormwater Sensitive Areas", mergeGroup: "ok_protected_waters", source: DEQ + " — Water Quality (sensitive areas for the OKR10 Construction General Permit)",
    url: urlFor("okSensitiveWaters"), fields: ["NAME", "HUC11"], simplifyFactor: 0.5, minZoom: 8, color: PROTECTED.sens.color, weight: 1.4,
    styleFn: flat(area(PROTECTED.sens.color, 0.08, 1.4, "8 5")),
    hoverTitle: "Sensitive watershed", hoverSource: "Oklahoma DEQ",
    identifyCard: card("Stormwater sensitive area", (p) => [rowOf("Area", p.NAME), rowOf("HUC-11", p.HUC11, { raw: true })].filter(Boolean),
      "DEQ lists these watersheds as sensitive waters harboring endangered and threatened species and their critical habitats, as set forth in the OKR10 Construction General Stormwater Permit. Read the permit's eligibility terms before relying on the general permit."),
    note: "Sensitive waters and watersheds harboring threatened and endangered species that DEQ's OKR10 Construction General Stormwater Permit singles out (52 areas: HUC-11 watersheds and river corridors; DEQ's layer is named \"OKR05 Stormwater Sensitive Areas\" and its description cites OKR10).",
    infoCaveat: "DEQ's own description of the layer; the permit text governs. A site inside one needs the permit's endangered-species review.",
    group: "environmental", order: 37,
  }),
  ok_owrb_scenic: lineRow({
    label: "Scenic Rivers", mergeGroup: "ok_protected_waters", source: "Oklahoma Water Resources Board — Water Quality Standards",
    url: urlFor("okScenicRivers"), fields: ["name", "wqs_name", "remark"], minZoom: 8, color: PROTECTED.scenic.color, weight: 2,
    styleFn: flat(stroke(PROTECTED.scenic.color, 2)),
    hoverTitle: "Scenic River", hoverSource: "OWRB",
    identifyCard: card("Scenic River", (p) => [rowOf("River", pick(p, "name")), rowOf("Reach", pick(p, "wqs_name"), { raw: true })].filter(Boolean),
      "Oklahoma's Scenic Rivers carry the strictest protection in the state's water-quality standards. The Scenic Rivers Commission and OWRB say what applies on the land beside one."),
    note: "The Scenic Rivers named in the Oklahoma Water Quality Standards (including the Illinois River, Barren Fork, Flint Creek, Lee Creek and the Upper Mountain Fork; 182 segments, OWRB).",
    infoCaveat: "The stream line only. The watershed above it is in the Special-Provision Watersheds row.",
    group: "environmental", order: 36.5,
  }),
  ok_owrb_special_ws: areaRow({
    label: "Special-Provision Watersheds", mergeGroup: "ok_protected_waters", source: "Oklahoma Water Resources Board — Water Quality Standards",
    url: urlFor("okSpecialWatersheds"), fields: ["name", "type", "type_def"], simplifyFactor: 0.5, minZoom: 8, color: "#0e7490", weight: 1.2,
    styleFn: (p, opacity) => { const w = specialWsOf(p && p.type); return area(w ? w.color : "#6b7280", 0.14, 1.2)(opacity); },
    hoverTitle: "Special-provision watershed", hoverSource: "OWRB",
    identifyCard: card("Special-provision watershed", (p) => [rowOf("Name", p.name), rowOf("Kind", pick(p, "type_def"), { raw: true })].filter(Boolean),
      "Where the Oklahoma Water Quality Standards add a special provision for the watershed (scenic river, outstanding resource, high quality, nutrient-limited or sensitive water supply). Ask OWRB and DEQ what it means for a new discharge, including stormwater."),
    note: "Watersheds where the Oklahoma Water Quality Standards add a special provision: Scenic River, Outstanding Resource Waters, High Quality Waters, Nutrient-Limited Watershed, and Sensitive Public and Private Water Supply (190 polygons, OWRB's own types).",
    infoCaveat: "Nutrient-limited and scenic-river watersheds cover much of northeast Oklahoma's Illinois River basin.",
    group: "environmental", order: 36.6,
  }),
  ok_deq_303d: lineRow({
    label: "Impaired Waters (303(d))", source: DEQ + " — 2024 Integrated Report",
    url: urlFor("ok303d"), fields: ["Name", "Category"], simplifyFactor: 0.5, minZoom: 9, color: "#c2410c", weight: 2,
    styleFn: impairedStyle, legend: legendOf(IMPAIRED),
    hoverTitle: "Impaired waterbody", hoverSource: "Oklahoma DEQ",
    identifyCard: card("Impaired waterbody", (p) => [rowOf("Name", p.Name), rowOf("Category", (IMPAIRED.find((i) => i.key === String(p.Category || "").trim().toLowerCase()) || {}).label || p.Category, { raw: true })].filter(Boolean),
      "A stream on DEQ's 303(d) list fails a water-quality standard; a new discharge to it (including stormwater) can face tighter limits. Ask DEQ Water Quality."),
    note: "Streams and lakes on DEQ's 2024 Clean Water Act 303(d) list (839 segments), coloured by category.",
    group: "environmental", order: 38,
  }),

  ok_dams: pointRow({
    label: "Dams by Hazard Class", source: "Oklahoma Water Resources Board — Dam Safety",
    url: GIS_SOURCES.okDams.serviceUrl, fields: ["dam_name", "hazard", "owner_name", "owner_type", "county", "river", "year_completed", "dam_height", "inundation_map_created"],
    minZoom: 10, color: "#6b7280", weight: 1.5, pointRadius: 4, styleFn: damStyle, legend: legendOf(DAM_CLASSES),
    hoverTitle: "Dam", hoverSource: "OWRB",
    identifyCard: card("Dam", (p) => [
      rowOf("Name", p.dam_name),
      rowOf("Hazard class", ({ High: "High", Significant: "Significant", Low: "Low", Other: "Drained, decommissioned or unclassified" })[damHazardOf(p.hazard)], { raw: true }),
      rowOf("Owner", p.owner_name), rowOf("Owner type", damOwnerType(p.owner_type), { raw: true }),
      rowOf("Stream", p.river), rowOf("County", p.county), rowOf("Built", p.year_completed, { raw: true }),
      Number(p.dam_height) > 0 ? rowOf("Height", `${Number(p.dam_height).toLocaleString("en-US", { maximumFractionDigits: 1 })} ft`, { raw: true }) : null,
      /^y(es)?$/i.test(String(p.inundation_map_created || "").trim()) ? rowOf("Inundation map", "On file with OWRB — ask for it", { raw: true }) : null,
    ].filter(Boolean), "The hazard class describes the consequence of a failure downstream, not the dam's condition."),
    note: "The Oklahoma Dam Inventory (OWRB; 4,900+ dams, including NRCS flood-control and federal dams) by hazard class. OWRB describes a High hazard dam as one with occupied dwellings immediately downstream.",
    infoCaveat: "The inventory flags the 107 dams that have an inundation map on file with OWRB (the map itself is OWRB's to give); for any other dam none is published. A site downstream of a high or significant hazard dam is a question for the dam's owner and OWRB.",
    group: "environmental", order: 39,
  }),

  ok_nrhp: pointRow({
    label: "Historic Places", source: "National Park Service — National Register of Historic Places",
    url: GIS_SOURCES.okNrhp.serviceUrl, minZoom: 11, color: "#6d28d9", weight: 2, pointRadius: 4,
    hoverTitle: "Historic place", hoverSource: "NPS National Register",
    identifyCard: card("Historic place", (p) => [rowOf("Name", pick(p, "RESNAME")), rowOf("Type", String(pick(p, "ResType") || "").replace(/^./, (c) => c.toUpperCase()), { raw: true }), rowOf("City", pick(p, "City")), rowOf("County", pick(p, "County"))].filter(Boolean)),
    note: "National Register listings — one point per listing (a district is one point, not its boundary). The State Historic Preservation Office's own inventory is not public, so recorded-but-unlisted sites are NOT here. A flag to check with the Oklahoma SHPO.",
    group: "environmental", order: 40,
  }),
  ok_cemeteries: pointRow({
    label: "Cemeteries", source: "USGS — GNIS cemeteries",
    url: GIS_SOURCES.okCemeteries.serviceUrl, minZoom: 12, color: "#475569", weight: 2, pointRadius: 3.5,
    hoverTitle: "Cemetery", hoverSource: "USGS GNIS",
    identifyCard: card("Cemetery", (p) => [rowOf("Name", pick(p, "NAME", "name")), rowOf("City", pick(p, "CITY", "city"))].filter(Boolean)),
    note: "INCOMPLETE: recorded cemeteries only. Unrecorded family burial grounds are NOT on this layer, so an empty map is never proof of none. A burial ground on the site is a hard constraint; ask the county and have it surveyed.",
    group: "environmental", order: 41,
  }),
  ok_crit_habitat: areaRow({
    label: "Critical Habitat", source: "U.S. Fish & Wildlife Service",
    url: GIS_SOURCES.okCritHabitat.serviceUrl, simplifyFactor: 0.5, vertexBudget: 150000, minZoom: 8, color: "#15803d", weight: 1.5,
    styleFn: flat(area("#15803d", 0.5, 1.5)),
    hoverTitle: "Critical habitat", hoverSource: "USFWS",
    identifyCard: card("Critical habitat", (p) => [rowOf("Species", pick(p, "comname")), rowOf("Scientific name", pick(p, "sciname"), { raw: true }), rowOf("Status", pick(p, "listing_status"), { raw: true })].filter(Boolean)),
    note: "USFWS final critical habitat. It binds FEDERAL actions, not private land directly — but a Corps wetlands permit is a federal action, so it matters wherever there is a stream or wetland. A screen; USFWS IPaC is the authoritative species list (it also covers the American burying beetle, which this map does not).",
    group: "environmental", order: 42,
  }),

  /* ---------------------------------------------------------------- Utilities ---------------------------------------------------------------- */
  ok_water_systems: areaRow({
    label: "Water System Service Areas", mergeGroup: "water_sewer", source: "Oklahoma Water Resources Board",
    url: urlFor("okWaterSystems"), fields: ["name", "pwsid", "county"], minZoom: 8, color: "#0369a1", weight: 1.2,
    styleFn: flat(area("#0369a1", 0.1, 1.2)),
    hoverTitle: "Water system service area", hoverSource: "OWRB",
    identifyCard: card("Public water system", (p) => [rowOf("System", p.name), rowOf("ID", p.pwsid, { raw: true }), rowOf("County", p.county)].filter(Boolean),
      "Approximate. Not a certificated territory and not a commitment to serve — confirm availability and size with the system."),
    note: "OWRB's approximate service areas for Oklahoma public water systems (720) — towns and rural water districts.",
    infoCaveat: "Approximate boundaries; availability, size and pressure are the system's to confirm.",
    group: "utilities", order: 21,
  }),
};

/* The ⓘ "as of" line of every Oklahoma row (layers.js spreads this into LAYER_VINTAGE). Dates are the services' own last-edit stamps or the agency's stated vintage, read 2026-10-29. */
export const OK_VINTAGE = {
  ok_county: "ODOT — edited 2026-08-11", ok_city: "ODOT (Oklahoma Tax Commission) — edited 2026-10-05", ok_road: "ODOT linear-referencing inventory — edited 2026-10-26",
  ok_tribal: "U.S. Census Bureau — checked weekly, edited 2026-10-28", ok_cherokee_res: "Cherokee Nation — edited 2026-09-24", ok_cherokee_land: "Cherokee Nation — edited 2026-09-21",
  ok_wells: "Oklahoma Corporation Commission RBDMS — edited 2026-10-29", ok_pst: "Oklahoma Corporation Commission — edited 2026-10-28", ok_pst_releases: "Oklahoma Corporation Commission — edited 2026-10-28",
  ok_deq_superfund: "Oklahoma DEQ LandWeb — updated 2025-01", ok_deq_rcra: "Oklahoma DEQ LandWeb — updated 2025-10", ok_deq_restrictions: "Oklahoma DEQ LandWeb — filings tracked by DEQ staff",
  ok_deq_vcp: "Oklahoma DEQ — data set updated 2022-01-25", ok_deq_scap: "Oklahoma DEQ LandWeb — updated 2025-10", ok_deq_brownfields: "Oklahoma DEQ LandWeb — updated 2025-06", ok_occ_brownfields: "Oklahoma Corporation Commission Brownfields — edited 2026-10-26",
  ok_deq_solid_waste: "Oklahoma DEQ LandWeb — updated 2025-09", ok_deq_haz_waste: "Oklahoma DEQ LandWeb — updated 2025-09",
  ok_deq_whpa: "Oklahoma DEQ WaterWeb — updated 2026-08", ok_deq_well_buffers: "DEQ — drawn from its 2014 public-well layer", ok_deq_intakes: "Oklahoma DEQ WaterWeb — updated 2026-08",
  ok_deq_appb_areas: "Oklahoma DEQ WaterWeb — updated 2026-08", ok_deq_appb_streams: "Oklahoma DEQ WaterWeb — updated 2026-08", ok_deq_sensitive: "Oklahoma DEQ WaterWeb — updated 2026-08", ok_deq_303d: "Oklahoma DEQ — 2024 Integrated Report",
  ok_owrb_scenic: "Oklahoma Water Resources Board — Water Quality Standards", ok_owrb_special_ws: "Oklahoma Water Resources Board — Water Quality Standards",
  ok_dams: "OWRB Dam Inventory — edited 2026-09-22", ok_water_systems: "OWRB — approximate, as published",
  ok_nrhp: "National Park Service — Esri federal mirror, edited 2026-10", ok_cemeteries: "USGS National Map — GNIS", ok_crit_habitat: "USFWS — final critical habitat",
};

/* =============================================================== Vector sources (ok_county, ok_city) =============================================================== */
/* The Georgia pattern (vectorLayers.VECTOR_SOURCES): registered in the SAME commit as the layer rows (test/vectorLayerRegistered fails otherwise). Endpoints are the
 * registry rows'. Probed 2026-10-29: 77 counties in ONE statewide pull; 597 cities, so the city tier is bbox-cell only. */
export const OK_VECTOR_SOURCES = {
  ok_county: {
    id: "ok_county",
    label: "County boundaries (Oklahoma)",
    labelField: GIS_SOURCES.okCounty.fields.name,
    labelZoom: { min: 6, max: 11 },
    nameTemplate: "{name} County",
    titleCaseLabel: true,
    identifyNote: "This county has jurisdiction here (it can tax/regulate) — outside city limits, ask it what land-use rules apply; Oklahoma counties vary. A boundary is not a utility service area. Screening only.",
    sourceName: "Oklahoma DOT",
    liveFallback: true,
    query: {
      url: GIS_SOURCES.okCounty.serviceUrl + "/query",
      outFields: [GIS_SOURCES.okCounty.fields.name, GIS_SOURCES.okCounty.fields.fips],
      where: "1=1",
      pageSize: 1000,
      maxFeatures: 4000,
      ttl: 30 * 24 * 3600 * 1000, // Oklahoma's 77-county roster has not changed since statehood
      minVectorZoom: 0,
      maxAreaDeg: Infinity,
      tiers: [
        { maxZoom: 11, scope: "all", offsetDeg: 0.002, precision: 4 },
        { scope: "bbox", offsetDeg: 0.0002, precision: 5, cellDeg: 0.25 },
      ],
    },
    note: "Oklahoma county lines (ODOT).",
  },
  ok_city: {
    id: "ok_city",
    label: "City limits (Oklahoma)",
    labelField: GIS_SOURCES.okCity.fields.name,
    labelZoom: { min: 10, max: 13 },
    nameTemplate: "{name} — city limits",
    titleCaseLabel: true,
    identifyNote: "Inside this line is in the city (it has jurisdiction — can tax/regulate); outside is unincorporated county. ETJ is not mapped for Oklahoma. NOT proof of utility service. Screening only.",
    sourceName: "Oklahoma DOT (Oklahoma Tax Commission)",
    liveFallback: true,
    query: {
      url: GIS_SOURCES.okCity.serviceUrl + "/query",
      outFields: [GIS_SOURCES.okCity.fields.name],
      where: "1=1",
      pageSize: 1000,
      maxFeatures: 4000,
      ttl: 14 * 24 * 3600 * 1000, // annexations move city limits occasionally
      minVectorZoom: 0,
      maxAreaDeg: Infinity,
      tiers: [
        { maxZoom: 10, scope: "bbox", offsetDeg: 0.003, precision: 3, cellDeg: 1 },
        { maxZoom: 12, scope: "bbox", offsetDeg: 0.001, precision: 4, cellDeg: 0.5 },
        { scope: "bbox", offsetDeg: 0.0002, precision: 5, cellDeg: 0.25 },
      ],
    },
    note: "Oklahoma city limits (ODOT, from the Oklahoma Tax Commission).",
  },
};
