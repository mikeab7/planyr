/* Waller County (TX) — the county's own GIS layer rows (NEW-1, 2026-11-24).
 *
 * The weekly "where people are working" sweep found Planyr told a Waller site the county has no public GIS. It does: the county's ArcGIS Online org carries its Major Thoroughfare Plan (a
 * future right-of-way dedication is a real site-killer on the I-10 corridor), the Katy Prairie Conservancy's easements and fee land (cannot be developed), the certificated water / sewer
 * service areas (who serves the site), the MUDs, and the county's own drawn floodway buffer.
 *
 * Every row is a REGIONAL source: `states: ["TX"]` and `regions: ["waller"]` (serviceAreas.js: Waller County's bundled county polygon, built by scripts/build-service-areas.mjs `--only=waller`),
 * so `layerAvailableHere` hides the row — and the map's draw filter turns it off before any request — on a Harris County, Dallas or Georgia site. Endpoints, fields and fixtures are the
 * `GIS_SOURCES` rows in src/shared/gis/sourcesWaller.js; the host is CORS-open, so nothing rides the /gis-proxy relay.
 *
 * HONESTY (owner constraints #4, #43, #45): a click opens a clean card — plain labels, no raw field names, no empty / sentinel rows, no contact columns; the source and date sit behind the (i);
 * nothing is a hover; every row starts at 100% opacity (#42). NOTHING HERE COMPUTES OR SHOWS A RATE, VOLUME OR ELEVATION (#4). The floodway buffer is a MAP LAYER ONLY: Planyr's screening math keeps
 * its own modelled `floodwayBufferFt` and the existing Waller detention rule (Appendix E) is untouched. Nothing is wired into Site Analysis verdicts (siteChecks.TRUSTED_CHECKS is untouched).
 *
 * Every attribute name below was MEASURED LIVE (2026-11-24, from Michael's browser on build a181f59) — each layer is its own FeatureServer service in the county's org, and the first cut pointed
 * all six at the BKDD service and answered "Invalid URL". A card prints nothing it cannot read, so an empty or placeholder column drops its row.
 *
 * PURE: no network, no React — the card / style rules unit-test standalone (test/wallerLayers.test.js). */

import { GIS_SOURCES } from "../../../shared/gis/sources.js";

/* ───────────────────────── small readers ───────────────────────── */
const str = (v) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim());
const has = (v) => { const t = str(v); return !!t && !/^(null|none|n\/?a|np|<null>|-?9{3,}|-?8{3,}|0)$/i.test(t); };
const row = (label, v) => (has(v) ? { label, text: str(v) } : null);
const clean = (rows) => rows.filter(Boolean);
const SMALL = new Set(["and", "of", "the", "for", "to", "a", "in"]);
/* Shouted text ("KATY PRAIRIE CONSERVANCY") reads as words; mixed-case text is left exactly as written. */
export function soft(v) {
  const t = str(v);
  if (!t || /[a-z]/.test(t)) return t;
  return t.toLowerCase().replace(/[a-z0-9][a-z0-9'.&#]*/g, (w, i) => (i > 0 && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).replace(/\b(Fm|Us|Sh|Ih|Cr|Mud|Ccn|Cpc|Row|Wcid|Wsc)\b/g, (m) => m.toUpperCase());
}
const srcOf = (k) => {
  const s = GIS_SOURCES[k];
  if (!s) throw new Error(`wallerLayers: no GIS_SOURCES row "${k}"`);
  return s;
};
const WL = { states: ["TX"], regions: ["waller"] };
const feature = (k, o) => {
  const s = srcOf(k);
  return { kind: "esriFeature", ...WL, hoverIdentify: true, canvasIdentify: true, ...o, url: s.serviceUrl, ...(s.where ? { where: s.where } : {}) };
};
const outline = (color, weight, fillOpacity, dash) => (_p, opacity) => ({ color, weight, opacity, fill: fillOpacity > 0, fillColor: color, fillOpacity: Math.min(fillOpacity, opacity * 0.5), ...(dash ? { dashArray: dash } : {}) });

export const WALLER_COLORS = Object.freeze({
  thoroughfare: "#ea580c", // design-exempt: map ink for a drawn planned road (cartography, not UI chrome)
  cpcEasement: "#15803d", // design-exempt: map ink for drawn conservation land (cartography, not UI chrome)
  cpcOwned: "#166534", // design-exempt: map ink for drawn conservation land (cartography, not UI chrome)
  ccn: "#0369a1", // design-exempt: map ink for a drawn service area (cartography, not UI chrome)
  mud: "#7c3aed", // design-exempt: map ink for a drawn district (cartography, not UI chrome)
  floodwayBuffer: "#0891b2", // design-exempt: map ink for a drawn flood area (cartography, not UI chrome)
});

/* The standing honesty line for the county floodway buffer (a card row, so it is read on the click, and the (i) of the row). */
export const BUFFER_STATUS = "The county's own drawn floodway buffer — not the effective FEMA map, and not Planyr's screening buffer";

/* ───────────────────────── Access: the county's thoroughfare plan ───────────────────────── */
export function thoroughfareCard(props) {
  const p = props || {};
  const status = soft(p.Status);
  return {
    title: soft(p.StreetName) || "Proposed roadway",
    rows: clean([
      { label: "Plan status", text: status && !/^proposed$/i.test(status) ? `Proposed — ${status}` : "Proposed — not built" },
      row("Road class", soft(p.ROW_CLASS)),
      row("Proposed right-of-way", p.ProposeROW),
    ]),
  };
}

/* ───────────────────────── Environmental: Katy Prairie Conservancy ───────────────────────── */
export function cpcEasementCard(props) {
  const p = props || {};
  return {
    title: soft(p.Name) || "Conservation easement",
    rows: clean([
      { label: "What this is", text: "Land under a conservation easement — protected from development" },
      row("Easement holder", soft(p.CE_holder)),
    ]),
  };
}
/* An acreage as the county gives it, trimmed to a sensible precision; nothing for a blank / zero / junk value. */
export function acresText(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return "";
  return `${n.toLocaleString("en-US", { maximumFractionDigits: n >= 100 ? 0 : 1 })} acres`;
}
export function cpcOwnedCard(props) {
  const p = props || {};
  return {
    title: soft(p.Property) || "Katy Prairie Conservancy land",
    rows: clean([
      { label: "What this is", text: "Land the Katy Prairie Conservancy owns outright — not developable" },
      row("Size", acresText(p.Acres)),
    ]),
  };
}

/* ───────────────────────── Utilities: CCN service areas and MUDs ───────────────────────── */
const STATUS_WORDS = { a: "Active", i: "Inactive" };
const statusText = (v) => { const t = str(v); return STATUS_WORDS[t.toLowerCase()] || soft(t); };
export function ccnCard(props) {
  const p = props || {};
  const kind = soft(p.CCN_TYPE);
  const type = soft(p.TYPE);
  return {
    title: soft(p.UTILITY) || "Water / sewer service area",
    rows: clean([
      row("Service", kind || type),
      kind && type && kind.toLowerCase() !== type.toLowerCase() ? row("Type", type) : null,
      row("Certificate number", p.CCN_NO),
      has(p.STATUS) ? { label: "Status", text: statusText(p.STATUS) } : null,
    ]),
  };
}
export function mudCard(props) {
  const p = props || {};
  return {
    title: soft(p.NAME) || "Municipal utility district",
    rows: clean([row("District ID", p.DISTRICT_ID), row("Type", soft(p.TYPE)), has(p.STATUS) ? { label: "Status", text: statusText(p.STATUS) } : null]),
  };
}

/* ───────────────────────── Flood & Drainage: the county's floodway buffer ───────────────────────── */
export function floodwayBufferCard(props) {
  const p = props || {};
  return {
    title: "County floodway buffer",
    rows: clean([row("Mapped as", p.FLD_ZONE ? `Zone ${str(p.FLD_ZONE)}` : ""), row("Zone subtype", soft(p.ZONE_SUBTY)), { label: "What this is", text: BUFFER_STATUS }]),
  };
}

/* ───────────────────────── The registry rows ───────────────────────── */
export const WALLER_LAYERS = {
  /* ---- Access ---- */
  waller_thoroughfare: feature("wallerThoroughfare", {
    label: "Proposed Thoroughfares (Waller County)", role: "line", group: "access", order: 70, minZoom: 10, source: "Waller County — Major Thoroughfare Plan (proposed roadways)",
    fields: ["OBJECTID", "StreetName", "ROW_CLASS", "ProposeROW", "Status"],
    color: WALLER_COLORS.thoroughfare, weight: 2, styleFn: (_p, opacity) => ({ color: WALLER_COLORS.thoroughfare, weight: 2, opacity, dashArray: "8 5" }),
    lineLabel: { field: "StreetName", minZoom: 13, format: (v) => soft(v) || null }, identifyCard: thoroughfareCard,
    note: "Roads on Waller County's Major Thoroughfare Plan that are proposed, not built. Click one for its name, class and the right-of-way the plan calls for.",
    infoCaveat: "A planned alignment, drawn schematically — not surveyed right-of-way. A future right-of-way dedication can take part of a site along the I-10 corridor: confirm the alignment and any dedication with the Waller County Engineer.",
  }),
  /* ---- Environmental ---- */
  waller_cpc_easements: feature("wallerCpcEasements", {
    label: "Katy Prairie Conservancy Easements (Waller)", role: "area", group: "environmental", order: 70, minZoom: 10, source: "Waller County GIS — Katy Prairie Conservancy protected properties (2024)",
    fields: ["OBJECTID", "Name", "CE_holder"],
    color: WALLER_COLORS.cpcEasement, weight: 1.6, simplifyFactor: 2, styleFn: outline(WALLER_COLORS.cpcEasement, 1.6, 0.18, "6 4"), identifyCard: cpcEasementCard,
    note: "Land protected by a conservation easement held for the Katy Prairie. Click one for its name and easement holder.",
    infoCaveat: "A conservation easement permanently limits development of the land. The boundary is the county's 2024 layer, not a survey — confirm with the Katy Prairie Conservancy before assuming a tract is available.",
  }),
  waller_cpc_owned: feature("wallerCpcOwned", {
    label: "Katy Prairie Conservancy Land (Waller)", role: "area", group: "environmental", order: 71, minZoom: 10, source: "Waller County GIS — Katy Prairie Conservancy owned properties (2024)",
    fields: ["OBJECTID", "Property", "Acres"],
    color: WALLER_COLORS.cpcOwned, weight: 1.6, simplifyFactor: 2, styleFn: outline(WALLER_COLORS.cpcOwned, 1.6, 0.26), identifyCard: cpcOwnedCard,
    note: "Land the Katy Prairie Conservancy owns outright.",
    infoCaveat: "Fee land held for conservation — not available for development. The boundary is the county's 2024 layer, not a survey.",
  }),
  /* ---- Utilities ---- */
  waller_ccn: feature("wallerCcn", {
    label: "Water & Sewer Service Areas (Waller CCN)", role: "area", group: "utilities", order: 70, minZoom: 10, source: "Waller County GIS — CCN boundaries (certificated water / sewer service areas)",
    fields: ["OBJECTID", "UTILITY", "TYPE", "CCN_NO", "CCN_TYPE", "STATUS"],
    color: WALLER_COLORS.ccn, weight: 1.6, simplifyFactor: 2, styleFn: outline(WALLER_COLORS.ccn, 1.6, 0.1, "8 5"), identifyCard: ccnCard,
    note: "The certificated water and sewer service areas in Waller County — who holds the right to serve a site. Click one for the utility.",
    infoCaveat: "A certificate of convenience and necessity (CCN) gives one utility the exclusive right to serve its area. The boundary is the county's copy; confirm service availability and capacity with the utility itself.",
  }),
  waller_mud: feature("wallerMud", {
    label: "Municipal Utility Districts (Waller)", role: "area", group: "utilities", order: 71, minZoom: 10, source: "Waller County GIS — municipal utility districts",
    fields: ["OBJECTID", "NAME", "DISTRICT_ID", "TYPE", "STATUS"],
    color: WALLER_COLORS.mud, weight: 1.6, simplifyFactor: 2, styleFn: outline(WALLER_COLORS.mud, 1.6, 0.12, "3 4"), identifyCard: mudCard,
    note: "Municipal utility districts in Waller County. Click one for its name.",
    infoCaveat: "A district can levy taxes and build or serve infrastructure inside its boundary; its rates and rules are not in this layer. The county's own copy — the statewide TCEQ water-district row also draws MUDs.",
  }),
  /* ---- Flood & Drainage ---- */
  waller_floodway_buffer: feature("wallerFloodwayBuffer", {
    label: "County Floodway Buffer (Waller)", role: "area", group: "flood", order: 70, minZoom: 10, source: "Waller County GIS — floodway buffer (2023-11)",
    fields: ["OBJECTID", "FLD_ZONE", "ZONE_SUBTY"],
    color: WALLER_COLORS.floodwayBuffer, weight: 1.4, simplifyFactor: 2, styleFn: outline(WALLER_COLORS.floodwayBuffer, 1.4, 0.2), identifyCard: floodwayBufferCard,
    floodTier: "local", agency: "Waller County", areaCounties: ["waller"],
    note: "The county's own drawn floodway buffer, as a map layer.",
    infoCaveat: `${BUFFER_STATUS}. Planyr's screening keeps its own modelled floodway buffer; this shows where the county drew its buffer.`,
  }),
};

export const WALLER_VINTAGE = {
  waller_thoroughfare: "Waller County Major Thoroughfare Plan — layer edited 2025-12-11",
  waller_cpc_easements: "Waller County GIS — Katy Prairie Conservancy protected properties, 2024 edition",
  waller_cpc_owned: "Waller County GIS — Katy Prairie Conservancy owned properties, 2024 edition",
  waller_ccn: "Waller County GIS — CCN boundaries (current edition)",
  waller_mud: "Waller County GIS — municipal utility districts (current edition)",
  waller_floodway_buffer: "Waller County GIS — floodway buffer, November 2023",
};
