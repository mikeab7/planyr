/* Houston-metro sweep layers (NEW-1 / NEW-2 / NEW-3, 2026-11-12) — three map layers the weekly "where people are working" sweep found missing around Houston:
 *
 *   · harris_mtfp      — the City of Houston's Major Thoroughfare & Freeway Plan (MTFP): which roads the City has planned to widen, and to what right-of-way. AMENDS B723 (the Thoroughfare Plan overlay).
 *                        Reuses the B721 ingest config (`shared/thoroughfare/houston.js`) for the street-class crosswalk and the City's minimum-right-of-way table — one crosswalk, not a second one.
 *   · has_airport_tiers — the Houston Airport System's airport land-use tiers around Bush Intercontinental (GBIA), Hobby and Ellington Field.
 *   · tx_evac_zones    — hurricane evacuation Zip-Zones (A / B / C / Coastal) for the Houston-Galveston coast, Chambers County included. Florida's `fl_evac_zones` is the same card shape.
 *
 * ALL THREE are `states: ["TX"]` with a declared region (serviceAreas.js / layerPanelModel.js `REGION_ZONES`), so a Dallas, Georgia or Colorado site never lists them (constraint #3). Hosts are CORS-open
 * and read directly (see `shared/gis/sourcesHoustonMetro.js`). Layers only — nothing here is wired into a Site Analysis verdict, and no layer claims more than its publisher's own attributes.
 *
 * WHAT IS DELIBERATELY NOT SAID (each measured 2026-11-12):
 *   · MTFP: the plan code (`HIER_TABLE`) is decoded ONLY when it is exactly `class-lanes-width` ("T-4-100", "MN-2-60", "P-6-120/180"); freeways and tollways carry a blank code, and the codes "MJ", "MJ-4", "TCS",
 *     "MN" carry no width — those show no width row, never a guessed one. A width is called "right-of-way" because the prefix/width pairs agree with the City's published minimum-ROW table in houston.js
 *     (Major Thoroughfare 100', Major Collector 80', Minor Collector 60' — verified V274). The other cities' plans in the same service (layers 1–8: No ETJ, Friendswood, Pasadena, Pearland, Seabrook, Stafford,
 *     Tomball, Webster) each have a different schema and are NOT drawn.
 *   · Airport tiers: the card names the airport and the tier and points at the ordinance (Houston Code Chapter 9, Articles VI and VII). It prints NO height limit: the per-tier limits were not readable
 *     from this build (the airport system's ordinance PDFs are outside the session's network), and constraint #4 forbids a naked number. "Tier 1 is the area closest to the airport's runways" is the
 *     Houston Airport System's own FAQ wording, and nothing more is said about Tier 2 or 3.
 *   · Evacuation zones: "not a flood zone" and "evacuation is ordered by zone" are all the card claims. What "Coastal" means is not stated by the layer, so the card does not explain it.
 *
 * PURE: no network, no React — the style / card / legend rules unit-test standalone (test/houstonMetroLayers.test.js). */
import { GIS_SOURCES } from "../../../shared/gis/sources.js";
import { HOUSTON, HOUSTON_ROW_STANDARDS } from "../../../shared/thoroughfare/houston.js";
import { niceCase } from "./floridaLayers.js";

const srcOf = (k) => {
  const s = GIS_SOURCES[k];
  if (!s) throw new Error(`houstonMetroLayers: no GIS_SOURCES row "${k}"`);
  return s;
};
const str = (v) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim());
const has = (v) => { const t = str(v); return !!t && !/^(null|none|n\/?a|<null>)$/i.test(t); };
const row = (label, v, extra) => (has(v) ? { label, text: str(v), ...(extra || {}) } : null);
const clean = (rows) => rows.filter(Boolean);

/* ═════════════════════════ NEW-1 · Houston MTFP ═════════════════════════ */

/* The five classes the City's own renderer paints, in its own colours (the service's renderer, read 2026-11-12: freeway 1,129,0 · major thoroughfare 219,0,0 · major collector 0,112,255 ·
 * transit corridor street 76,0,115 · minor collector 0,255,197). `canonical` is the B721 crosswalk's class, so there is ONE answer to "which class is this street". */
export const MTFP_CLASSES = Object.freeze({
  freeway: { label: "Freeway / tollway", color: "#018100", weight: 2.2 },
  major_thoroughfare: { label: "Major thoroughfare", color: "#db0000", weight: 2.0 },
  collector_major: { label: "Major collector", color: "#0070ff", weight: 1.8 },
  transit_corridor: { label: "Transit corridor street", color: "#4c0073", weight: 1.8 },
  collector_minor: { label: "Minor collector", color: "#00ffc5", weight: 1.6 },
});
export const MTFP_ORDER = Object.keys(MTFP_CLASSES);

/* ST_TYPE → class, through the B721 crosswalk (houston.js). Anything it does not know ("N/A", blank) is not on the City's map. */
export function mtfpClassKey(props) {
  const raw = str(props && props.ST_TYPE).toLowerCase();
  const k = HOUSTON.classificationCrosswalk[raw];
  return k && MTFP_CLASSES[k] ? k : null;
}

/* ST_STATUS → one of three states. The layer has a typo ("Suffiicent width", one segment) that the City's own map reads as sufficient. */
export function mtfpStatusKey(props) {
  const s = str(props && props.ST_STATUS).toLowerCase();
  if (/^suf/.test(s)) return "sufficient";
  if (s === "to be widened") return "widen";
  if (s === "proposed") return "proposed";
  return null;
}
export const MTFP_STATUS_WORDS = Object.freeze({ sufficient: "Sufficient width", widen: "To be widened", proposed: "Proposed (not yet built)" });

/* The City's map draws proposed roads dashed and to-be-widened roads as a thin line; this does the same, in screen pixels. */
export function mtfpStyle(props, opacity) {
  const c = MTFP_CLASSES[mtfpClassKey(props)];
  const st = mtfpStatusKey(props);
  const base = { color: c ? c.color : "#6b7280", weight: c ? c.weight : 1.2, opacity, fill: false, lineCap: "round", lineJoin: "round" };
  if (st === "proposed") return { ...base, dashArray: "8 5" };
  if (st === "widen") return { ...base, weight: Math.max(1, base.weight * 0.6) };
  return base;
}
export const mtfpLegend = () => [
  ...MTFP_ORDER.map((k) => ({ label: MTFP_CLASSES[k].label, color: MTFP_CLASSES[k].color, weight: MTFP_CLASSES[k].weight })),
  { label: "Dashed = proposed · thin = to be widened", color: "#6b7280", weight: 2, dash: true },
];

/* OWNERSHIP: the abbreviations the layer holds (measured: COH, HARRIS, TxDOT, FORT BEND, HCTRA, Montgomery, WALLER, FBCTRA, LIBERTY, "Harris County Toll Road Autho*", "Harris County"). */
const OWNER_WORDS = Object.freeze({
  "COH": "City of Houston", "HARRIS": "Harris County", "HARRIS COUNTY": "Harris County", "TXDOT": "TxDOT",
  "FORT BEND": "Fort Bend County", "MONTGOMERY": "Montgomery County", "WALLER": "Waller County", "LIBERTY": "Liberty County",
  "HCTRA": "Harris County Toll Road Authority", "FBCTRA": "Fort Bend County Toll Road Authority",
});
export function mtfpOwner(v) {
  const t = str(v);
  if (!has(t)) return "";
  const k = t.toUpperCase();
  if (OWNER_WORDS[k]) return OWNER_WORDS[k];
  if (/^harris county toll road autho/i.test(t)) return OWNER_WORDS.HCTRA; // the layer's field is 30 characters wide and cuts this one off
  return niceCase(t);
}

/* HIER_TABLE decode — "P-6-120", "T-4-100", "MN-2-60", "MJ-4-80/100": class prefix · lane count · right-of-way in feet (two widths when the City writes "120/180"). Anything else decodes to null. */
const CODE_RE = /^(P|T|MJ|MN|TCS)-(\d{1,2})-(\d{2,3})(?:\/(\d{2,3}))?$/;
export function decodePlanCode(raw) {
  const m = CODE_RE.exec(str(raw).toUpperCase());
  if (!m) return null;
  return { prefix: m[1], lanes: Number(m[2]), rowFt: Number(m[3]), rowFt2: m[4] ? Number(m[4]) : null };
}
export function planCodeWords(raw) {
  const d = decodePlanCode(raw);
  if (!d) return null;
  const row = d.rowFt2 ? `${d.rowFt} / ${d.rowFt2} ft right-of-way (the City lists two widths)` : `${d.rowFt} ft right-of-way`;
  return `${d.lanes} lane${d.lanes === 1 ? "" : "s"} · ${row}`;
}

/* JDT is the City's own tag of where the segment sits. */
const JDT_WORDS = Object.freeze({ "limit": "Inside Houston city limits", "etj": "In Houston's ETJ (extraterritorial jurisdiction — the ring around the city the City also plans for)", "limit/etj": "Along the city-limit line" });
export const mtfpWhere = (v) => JDT_WORDS[str(v).toLowerCase()] || null;

export function mtfpCard(props) {
  const p = props || {};
  const ck = mtfpClassKey(p), sk = mtfpStatusKey(p);
  const rows = [];
  if (has(p.ST_TYPE)) rows.push({ label: "Class", text: str(p.ST_TYPE) });
  if (sk) rows.push({ label: "Status", text: MTFP_STATUS_WORDS[sk] });
  else if (has(p.ST_STATUS)) rows.push({ label: "Status", text: str(p.ST_STATUS) });
  const words = planCodeWords(p.HIER_TABLE);
  if (words) rows.push({ label: "Planned section", text: words });
  else if (ck === "freeway") rows.push({ label: "Right-of-way", text: "Set by the highway or toll agency, not by the City's thoroughfare table." });
  const own = mtfpOwner(p.OWNERSHIP);
  if (own) rows.push({ label: "Maintained by", text: own });
  const where = mtfpWhere(p.JDT);
  if (where) rows.push({ label: "Where", text: where });
  rows.push(row("Last plan amendment", p.LastMTFPA));
  rows.push({ label: "Plan", text: "City of Houston MTFP", href: HOUSTON.sourceUrl });
  const name = niceCase(str(p.FULL_NAME)) || "Planned thoroughfare";
  return { title: name, rows: clean(rows) };
}

/* ═════════════════════════ NEW-2 · Airport tiers ═════════════════════════ */

/* The layer's nine tier names ("GBIA Tier 1", "Hobby Tier 2", "Ellington-Tier 3") → airport + tier number. The colours are the City's own renderer (read 2026-11-12). */
export const AIRPORTS = Object.freeze({
  gbia: { label: "Bush Intercontinental (IAH)", legend: "Bush Intercontinental", colors: ["#2bad24", "#ab3c70", "#485f94"] },
  hobby: { label: "William P. Hobby (HOU)", legend: "Hobby", colors: ["#a6332d", "#a1b031", "#278245"] },
  ellington: { label: "Ellington Field (EFD)", legend: "Ellington Field", colors: ["#806329", "#37239e", "#2aadad"] },
});
export function parseTier(raw) {
  const m = /^(GBIA|Hobby|Ellington)\W*Tier\s*([123])$/i.exec(str(raw));
  if (!m) return null;
  const airport = { gbia: "gbia", hobby: "hobby", ellington: "ellington" }[m[1].toLowerCase()];
  return { airport, tier: Number(m[2]) };
}
export function tierStyle(props, opacity) {
  const t = parseTier(props && props.Tier);
  const c = t ? AIRPORTS[t.airport].colors[t.tier - 1] : "#9ca3af";
  return { color: c, weight: 1.2, opacity, fill: true, fillColor: c, fillOpacity: Math.min(0.38, opacity * 0.5) };
}
export function tierLegend() {
  const out = [];
  for (const a of Object.values(AIRPORTS)) {
    out.push({ heading: true, label: a.legend });
    a.colors.forEach((color, i) => out.push({ label: `Tier ${i + 1}`, color, row: true }));
  }
  return out;
}
export const AIRPORT_ORDINANCE = "Houston Code of Ordinances, Chapter 9, Articles VI (airport land use) and VII (airport hazard areas)";
export const AIRPORT_ORDINANCE_URL = "https://www.fly2houston.com/airport-business/resources/regulatory-policy/hazard-area-regulations/";
/* Only what the Houston Airport System's own FAQ says is repeated: each airport's area is divided into three tiers, and Tier 1 is the area closest to the runways. Nothing is claimed about Tier 2 or 3. */
const TIER_MEANING = "The City divides each airport's area into three tiers; Tier 1 is the area closest to the airport's runways.";
export function tierCard(props) {
  const t = parseTier(props && props.Tier);
  if (!t) return { title: "Airport tier", rows: clean([row("Tier", props && props.Tier)]) };
  const a = AIRPORTS[t.airport];
  return {
    title: `${a.legend} · Tier ${t.tier}`,
    rows: [
      { label: "Airport", text: a.label },
      { label: "Tier", text: `Tier ${t.tier} of 3` },
      { label: "What it is", text: TIER_MEANING },
      { label: "Height limits", text: "Set by the ordinance for this tier — read it before designing building or crane heights." },
      { label: "Ordinance", text: AIRPORT_ORDINANCE },
      { label: "Regulations", text: "Open", href: AIRPORT_ORDINANCE_URL },
    ],
  };
}

/* ═════════════════════════ NEW-3 · Evacuation Zip-Zones ═════════════════════════ */

/* One hue, darker = evacuated first (the same ramp Florida uses). "Coastal" is its own zone in this scheme; it keeps a distinct hue because the layer does not say where it ranks. */
export const EVAC_ZONE_COLORS = Object.freeze({ A: "#9a3412", B: "#c2410c", C: "#ea580c", COASTAL: "#0f766e" });
export function evacZoneKey(raw) {
  const t = str(raw).replace(/^zip-?\s*zone\s*/i, "").trim().toUpperCase();
  return EVAC_ZONE_COLORS[t] ? t : null;
}
export const evacZoneWords = (raw) => { const k = evacZoneKey(raw); return k ? (k === "COASTAL" ? "Zip-Zone Coastal" : `Zip-Zone ${k}`) : str(raw); };
export function evacStyle(props, opacity) {
  const k = evacZoneKey(props && props.Zone);
  const c = k ? EVAC_ZONE_COLORS[k] : "#9ca3af";
  return { color: c, weight: 1, opacity, fill: true, fillColor: c, fillOpacity: Math.min(0.42, opacity * 0.55) };
}
export const evacLegend = () => [
  { label: "Zip-Zone A", color: EVAC_ZONE_COLORS.A }, { label: "Zip-Zone B", color: EVAC_ZONE_COLORS.B },
  { label: "Zip-Zone C", color: EVAC_ZONE_COLORS.C }, { label: "Zip-Zone Coastal", color: EVAC_ZONE_COLORS.COASTAL },
];
export function evacCard(props) {
  const p = props || {};
  const place = niceCase(str(p.Name));
  const zip = [str(p.Zip5digit), str(p.ZIP_Evac)].find(has);
  return {
    title: evacZoneWords(p.Zone) || "Evacuation zone",
    rows: clean([
      { label: "What it is", text: "Evacuation is ordered by zone. This is not a flood zone." },
      place ? { label: "Area", text: zip ? `${place} · ZIP ${str(zip)}` : place } : null,
      row("County", niceCase(str(p.County))),
    ]),
  };
}

/* ═════════════════════════ the registry rows ═════════════════════════ */

const hoverCommon = { hoverIdentify: true, canvasIdentify: true };
const mtfp = srcOf("harrisMtfp"), tiers = srcOf("hasAirspaceTiers"), evac = srcOf("txEvacZones");

export const HOUSTON_METRO_LAYERS = {
  harris_mtfp: {
    kind: "esriFeature", label: "Thoroughfare Plan", source: "City of Houston — Major Thoroughfare & Freeway Plan",
    url: mtfp.serviceUrl, where: mtfp.where, states: ["TX"], regions: ["houston", "harris"],
    fields: ["OBJECTID", "FULL_NAME", "ST_TYPE", "ST_STATUS", "OWNERSHIP", "HIER_TABLE", "JDT", "LastMTFPA", "ROW_STATUS"],
    minZoom: 12, color: "#db0000", weight: 2, opacity: 0.6, styleFn: mtfpStyle, legend: mtfpLegend(),
    lineLabel: { field: "FULL_NAME", minZoom: 16, format: (p) => niceCase(str(p)) },
    ...hoverCommon, identifyCard: mtfpCard,
    note: "The City of Houston's Major Thoroughfare and Freeway Plan: which roads the City plans as freeways, thoroughfares and collectors, and which it plans to widen. Colour = class; dashed = proposed; thin = to be widened. Click a road for its class, status, planned lanes and right-of-way, and who maintains it.",
    infoCaveat: "The plan the City reviews plats and permits against — a planned right-of-way can be wider than the road is today, and a site along a road marked 'to be widened' may owe a dedication. Planned width comes from the City's plan code (class-lanes-width); where the code is blank or does not carry a width, none is shown. Freeway and tollway widths are set by TxDOT or the toll authority. Confirm with the City's Planning Department.",
    role: "line", group: "access", order: 32,
  },
  has_airport_tiers: {
    kind: "esriFeature", label: "Airport Height Tiers", source: "City of Houston — Houston Airport System",
    url: tiers.serviceUrl, states: ["TX"], regions: ["houston_metro"],
    fields: ["OBJECTID", "Tier"],
    minZoom: 9, color: "#485f94", weight: 1.2, opacity: 0.55, styleFn: tierStyle, legend: tierLegend(),
    ...hoverCommon, identifyCard: tierCard,
    note: "The Houston Airport System's airport land-use tiers around Bush Intercontinental, Hobby and Ellington Field: the three bands the City regulates building height and land use by near each airport. Click one for the airport and the tier.",
    infoCaveat: `The City's tier map, not an FAA Part 77 surface and not a height determination. ${AIRPORT_ORDINANCE} set what each tier allows; this card does not print the limits. Confirm with the Houston Airport System before relying on a height.`,
    role: "area", group: "jurisdiction", order: 34,
  },
  tx_evac_zones: {
    kind: "esriFeature", label: "Hurricane Evacuation Zones", source: "Harris County GIS — hurricane evacuation Zip-Zones",
    url: evac.serviceUrl, states: ["TX"], regions: ["tx_gulf_evac"],
    fields: ["FID", "Zone", "Zip5digit", "Name", "County", "ZIP_Evac", "Direction"],
    minZoom: 9, color: "#c2410c", weight: 1, opacity: 0.4, styleFn: evacStyle, simplifyFactor: 6, legend: evacLegend(),
    ...hoverCommon, identifyCard: evacCard,
    note: "Hurricane evacuation Zip-Zones for the Houston-Galveston coast — Brazoria, Chambers, Galveston, Harris and Matagorda counties. Officials order evacuation by zone, so the zone a site is in is the one to know. Click a zone for its name, area and county.",
    infoCaveat: "An evacuation zone, not a flood zone and not the FEMA floodplain: a site can be in one and outside the other. The layer covers only those five counties — a site elsewhere shows nothing, which is not the same as 'not at risk'. Layer edited 2026-07-10; its zone data was last edited 2024-06-04. Confirm the current zone map with the county's emergency management office.",
    role: "area", group: "flood", order: 8,
    floodTier: "advisory", agency: "Harris County GIS",
  },
};

export const HOUSTON_METRO_VINTAGE = {
  harris_mtfp: "City of Houston MTFP — approved by the Planning Commission Sept 18, 2025, adopted by City Council Oct 15, 2025 (Harris County GIS copy downloaded Jan 9, 2026)",
  has_airport_tiers: "Houston Airport System airport land-use tiers — current edition (the City publishes no edit date)",
  tx_evac_zones: "Harris County GIS hurricane evacuation Zip-Zones — layer edited 2026-07-10; zone data last edited 2024-06-04",
};

/* The City's minimum right-of-way table, re-exported so the card's width claim and the table it was cross-checked against are one import away (houston.js is their home). */
export { HOUSTON_ROW_STANDARDS };
