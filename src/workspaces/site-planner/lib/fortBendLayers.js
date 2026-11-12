/* Fort Bend County (TX) — the county's own GIS layer rows (NEW-1, 2026-11-12).
 *
 * The weekly "where people are working" sweep found Planyr could NAME a Levee Improvement District (the TCEQ water-district row) but drew no levee geometry, none of the county drainage
 * district's Brazos River studies, and none of the county's tax-increment zones, management districts, development agreements or proposed thoroughfares — the facts a Fort Bend
 * industrial site is killed or made by (a levee on the boundary, a 55-ft Brazos floodplain study, a road the developer already owes the county).
 *
 * Every row is a REGIONAL source: `states: ["TX"]` and `regions: ["fortbend"]` (serviceAreas.js: Fort Bend County's bundled county polygon, built by scripts/build-service-areas.mjs), so
 * `layerAvailableHere` hides the row — and the map's draw filter turns it off before any request — on a Harris County, Dallas or Georgia site. Endpoints, fields and fixtures are the
 * `GIS_SOURCES` rows in src/shared/gis/sourcesFortBend.js; the host (gisportal.fortbendcountytx.gov) is CORS-open, so nothing rides the /gis-proxy relay.
 *
 * City / county-layer HONESTY (owner constraints #43, #45): a click opens a clean card (plain labels, no raw field names, no empty or sentinel rows — the layers' -8888 / -9999 / "NP"
 * placeholders are never printed), the source and date sit behind the (i), and nothing here is a hover. The Brazos studies are the Fort Bend County Drainage District's OWN studies and say so on
 * the card — "not the effective FEMA map" — and sit in the Flood & Drainage "Advisory" tier. Nothing is wired into Site Analysis verdicts (siteChecks.TRUSTED_CHECKS is untouched).
 *
 * PURE: no network, no React — the card / style rules unit-test standalone (test/fortBendLayers.test.js). */

import { GIS_SOURCES } from "../../../shared/gis/sources.js";

/* ───────────────────────── small readers ───────────────────────── */
const str = (v) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim());
const has = (v) => { const t = str(v); return !!t && !/^(null|none|n\/?a|np|<null>)$/i.test(t); };
const row = (label, v, extra) => (has(v) ? { label, text: str(v), ...(extra || {}) } : null);
const clean = (rows) => rows.filter(Boolean);
const SMALL = new Set(["and", "of", "the", "for", "to", "a", "in"]);
/* Shouted text ("SIENNA PLANTATION LEVEE IMPROVEMENT DISTRICT LEVEE") reads as words; mixed-case text is left exactly as written. */
export function soft(v) {
  const t = str(v);
  if (!t || /[a-z]/.test(t)) return t;
  return t.toLowerCase().replace(/[a-z0-9][a-z0-9'.&#]*/g, (w, i) => (i > 0 && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).replace(/\b(Fm|Us|Sh|Ih|Cr|Fbc|Lid|Mud|Tirz|Mmd)\b/g, (m) => m.toUpperCase()); 
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/* A service epoch-ms date → "Aug 2004" (UTC); nothing for blank / junk / the year-9999 "no date" placeholder some FEMA-schema columns carry. */
export function monthYear(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n);
  const y = d.getUTCFullYear();
  if (y < 1900 || y > 2100) return null;
  return `${MONTHS[d.getUTCMonth()]} ${y}`;
}

const srcOf = (k) => {
  const s = GIS_SOURCES[k];
  if (!s) throw new Error(`fortBendLayers: no GIS_SOURCES row "${k}"`);
  return s;
};
const FB = { states: ["TX"], regions: ["fortbend"] };
const feature = (k, o) => {
  const s = srcOf(k);
  return { kind: "esriFeature", ...FB, hoverIdentify: true, canvasIdentify: true, ...o, url: s.serviceUrl, ...(s.where ? { where: s.where } : {}) };
};
const outline = (color, weight, fillOpacity, dash) => (_p, opacity) => ({ color, weight, opacity, fill: fillOpacity > 0, fillColor: color, fillOpacity: Math.min(fillOpacity, opacity * 0.5), ...(dash ? { dashArray: dash } : {}) });

export const FORTBEND_COLORS = Object.freeze({
  lid: "#0f766e", // design-exempt: map ink for a drawn county district (cartography, not UI chrome)
  levee: "#9a3412", // design-exempt: map ink for a drawn levee line (cartography, not UI chrome)
  inundation: "#2563eb", // design-exempt: map ink for a drawn flood study area (cartography, not UI chrome)
  floodplain: "#0891b2", // design-exempt: map ink for a drawn flood study area (cartography, not UI chrome)
  tirz: "#a16207", // design-exempt: map ink for a drawn incentive zone (cartography, not UI chrome)
  mmd: "#7c3aed", // design-exempt: map ink for a drawn management district (cartography, not UI chrome)
  agreement: "#be185d", // design-exempt: map ink for a drawn agreement area (cartography, not UI chrome)
  mtp: "#ea580c", // design-exempt: map ink for a drawn planned road (cartography, not UI chrome)
});

/* The standing honesty line for the two Brazos studies (a card row, so it is read on the click, and the (i) of the merged row). */
export const STUDY_STATUS = "County drainage district study — not the effective FEMA map";

/* ───────────────────────── Levee Improvement Districts ───────────────────────── */
export function lidCard(props) {
  const p = props || {};
  const status = str(p.STATUS).toUpperCase();
  return {
    title: str(p.LID_NAME) || "Levee Improvement District",
    rows: clean([
      row("Operator", p.OPERATOR),
      row("Engineer", p.ENGINEER_FIRM),
      has(p.TCEQ_ID) ? { label: "TCEQ district ID", text: str(p.TCEQ_ID) } : null,
      status ? { label: "Status", text: status === "A" ? "Active" : soft(p.STATUS) } : null,
    ]),
  };
}

/* ───────────────────────── Levees ───────────────────────── */
/* FEMA's levee schema, as the county publishes it. LEVEE_STAT 'NP', OWNER 'NP' and PL84_99TF 'U' mean "not provided" — never shown as a claim; FREEBOARD (-8888) and CONST_DATE (a year-9999
 * placeholder) carry no value and are never requested. */
export function leveeCard(props) {
  const p = props || {};
  const stat = str(p.LEVEE_STAT);
  const pl = str(p.PL84_99TF).toUpperCase();
  return {
    title: soft(p.LEVEE_NM) || "Levee",
    dedupeKey: str(p.LEVEE_ID) ? `fb-levee:${str(p.LEVEE_ID)}` : undefined,
    rows: clean([
      row("Waterway", soft(p.WTR_NM)),
      has(stat) ? { label: "FEMA accreditation", text: soft(stat) } : { label: "FEMA accreditation", text: "Not stated in the county's data" },
      pl === "T" ? { label: "Corps rehabilitation program", text: "Enrolled (PL 84-99)" } : pl === "F" ? { label: "Corps rehabilitation program", text: "Not enrolled (PL 84-99)" } : null,
      row("Owner", soft(p.OWNER)),
    ]),
  };
}

/* ───────────────────────── Brazos River studies ───────────────────────── */
export function inundationCard() {
  return { title: "Brazos River 100-year inundation", rows: [{ label: "What this is", text: STUDY_STATUS }] };
}
export function floodplainCard(props) {
  const p = props || {};
  const zone = str(p.FLD_ZONE);
  return {
    title: "Brazos River 55-foot floodplain",
    rows: clean([
      zone ? { label: "Mapped in the study as", text: `Zone ${zone}` } : null,
      { label: "What this is", text: STUDY_STATUS },
    ]),
  };
}

/* ───────────────────────── Jurisdictions ───────────────────────── */
export function tirzCard(props) {
  const p = props || {};
  return { title: str(p.NAME) || "Tax increment reinvestment zone", rows: clean([row("County code", p.ENTITYCODE), row("Notes", p.NOTES)]) };
}
export function mmdCard(props) {
  const p = props || {};
  const status = str(p.STATUS).toUpperCase();
  return {
    title: str(p.MMD_NAME) || "Management district",
    rows: clean([has(p.TCEQ_ID) ? { label: "TCEQ district ID", text: str(p.TCEQ_ID) } : null, status ? { label: "Status", text: status === "A" ? "Active" : soft(p.STATUS) } : null]),
  };
}
export function agreementCard(props) {
  const p = props || {};
  return {
    title: str(p.SUBDIVISION) || "Development agreement",
    rows: clean([row("Affected road", p.AFFECTED_ROAD), row("Developer", p.DEVELOPER), row("Agreement type", p.TYPE), row("Status", p.STATUS)]),
  };
}

/* ───────────────────────── Access: proposed thoroughfares ───────────────────────── */
export function mtpProposedCard(props) {
  const p = props || {};
  const updated = monthYear(p.DATE_MODIF);
  return {
    title: soft(p.FULL_NAME) || soft(p.RD_NAME) || "Proposed roadway",
    rows: clean([
      { label: "Plan status", text: "Proposed — not built" },
      row("City", soft(p.CITY)),
      updated ? { label: "Plan line last updated", text: updated } : null,
    ]),
  };
}

/* ───────────────────────── The registry rows ───────────────────────── */
export const FORTBEND_MERGE_GROUPS = {
  fb_brazos_studies: {
    label: "Brazos River Studies (FBCDD)",
    note: "The Fort Bend County Drainage District's own Brazos River studies: the 100-year inundation and the 55-foot floodplain. Studies, not the effective FEMA map — one switch for both.",
  },
};

export const FORTBEND_LAYERS = {
  /* ---- Flood & Drainage ---- */
  fb_lid: feature("fbLid", {
    label: "Levee Improvement Districts (Fort Bend)", role: "area", group: "flood", order: 60, minZoom: 10, source: "Fort Bend County — GIS (Levee Improvement Districts)",
    fields: ["OBJECTID", "LID_NAME", "TCEQ_ID", "OPERATOR", "ENGINEER_FIRM", "STATUS"],
    color: FORTBEND_COLORS.lid, weight: 1.6, simplifyFactor: 2, styleFn: outline(FORTBEND_COLORS.lid, 1.6, 0.12, "6 4"), identifyCard: lidCard,
    floodTier: "local", agency: "Fort Bend County", areaCounties: ["fortbend"],
    note: "The 15 Levee Improvement Districts in Fort Bend County. Click one for who operates and engineers it and its TCEQ district ID.",
    infoCaveat: "A Levee Improvement District is a taxing district that builds and maintains a levee system. The district boundary is not the levee: the Levees row draws the levee line, and whether it is FEMA-accredited decides how the ground behind it is mapped.",
  }),
  fb_levees: feature("fbLevees", {
    label: "Levees (Fort Bend)", role: "line", group: "flood", order: 61, minZoom: 11, source: "Fort Bend County Drainage District — Levees",
    fields: ["OBJECTID", "LEVEE_ID", "LEVEE_NM", "WTR_NM", "LEVEE_STAT", "PL84_99TF", "OWNER"],
    color: FORTBEND_COLORS.levee, weight: 2.4, styleFn: (_p, opacity) => ({ color: FORTBEND_COLORS.levee, weight: 2.4, opacity }), identifyCard: leveeCard,
    floodTier: "local", agency: "FBCDD", areaCounties: ["fortbend"],
    note: "Levee centerlines along the Brazos River in Fort Bend County, in FEMA's levee format. Click one for its name, waterway and accreditation.",
    infoCaveat: "The county's levee line, not a survey. 'Not stated' means the county's data does not say — it does not mean the levee is unaccredited. Confirm accreditation and any levee easement with the levee district and the Fort Bend County Drainage District.",
  }),
  fb_brazos_inundation: feature("fbBrazosInundation", {
    label: "Brazos 100-year Inundation (FBCDD study)", mergeGroup: "fb_brazos_studies", role: "area", group: "flood", order: 62, minZoom: 10, source: "Fort Bend County Drainage District — Brazos River 100-year inundation study",
    /* MEASURED 2026-11-12: the county's two inundation polygons carry ~122,000 vertices at 6 px of server-side generalisation (and the server re-sends the WHOLE polygon with every tile), which is
     * over the 120,000-vertex draw budget — the row refused to draw right where the river is. 20 px (~37,000 vertices at working zoom, ~230,000 at the deepest) with a budget of 250,000 draws it;
     * the line is the study's outline generalised for display, said behind the (i). */
    fields: ["OBJECTID"], simplifyFactor: 20, vertexBudget: 250000, color: FORTBEND_COLORS.inundation, weight: 1.2, styleFn: outline(FORTBEND_COLORS.inundation, 1.2, 0.2), identifyCard: inundationCard,
    floodTier: "advisory", agency: "FBCDD", areaCounties: ["fortbend"],
    legend: [{ label: "100-year inundation (study)", color: FORTBEND_COLORS.inundation }, { label: "55-foot floodplain (study)", color: FORTBEND_COLORS.floodplain }],
    note: "The Fort Bend County Drainage District's Brazos River 100-year inundation study.",
    infoCaveat: `${STUDY_STATUS}. Use FEMA's effective map for flood insurance and permitting; this shows where the district's own study puts the river. The outline is generalised for display (the county's polygon has ~120,000 vertices), so it is coarser than the study itself at a close zoom.`,
  }),
  fb_brazos_floodplain: feature("fbBrazosFloodplain", {
    label: "Brazos 55-ft Floodplain (FBCDD study)", mergeGroup: "fb_brazos_studies", role: "area", group: "flood", order: 62, minZoom: 11, source: "Fort Bend County Drainage District — Brazos River 55-foot floodplain study",
    fields: ["OBJECTID", "FLD_ZONE"], simplifyFactor: 4, color: FORTBEND_COLORS.floodplain, weight: 1.2, styleFn: outline(FORTBEND_COLORS.floodplain, 1.2, 0.2), identifyCard: floodplainCard,
    floodTier: "advisory", agency: "FBCDD", areaCounties: ["fortbend"],
    note: "The Fort Bend County Drainage District's Brazos River 55-foot floodplain study.",
    infoCaveat: `${STUDY_STATUS}. The study carries no base flood elevation or depth in the county's data, so none is shown.`,
  }),
  /* ---- Jurisdictions: incentives, districts and county contracts ---- */
  fb_tirz: feature("fbTirz", {
    label: "Tax Increment Zones (Fort Bend)", role: "area", group: "jurisdiction", order: 60, minZoom: 10, source: "Fort Bend County — Tax Increment Reinvestment Zones",
    fields: ["OBJECTID", "NAME", "NOTES", "ENTITYCODE"],
    color: FORTBEND_COLORS.tirz, weight: 1.6, styleFn: outline(FORTBEND_COLORS.tirz, 1.6, 0.14, "8 5"), identifyCard: tirzCard,
    note: "Tax increment reinvestment zones in Fort Bend County (29). Click one for its name and the county's code for the government that created it.",
    infoCaveat: "A zone boundary, not a statement of what the zone funds today. The county's zone names start with its own code for the creating city or county (C06, C09…), not a city name.",
  }),
  fb_mmd: feature("fbMmd", {
    label: "Management Districts (Fort Bend)", role: "area", group: "jurisdiction", order: 61, minZoom: 10, source: "Fort Bend County — Management Districts",
    fields: ["OBJECTID", "MMD_NAME", "TCEQ_ID", "STATUS"],
    color: FORTBEND_COLORS.mmd, weight: 1.6, styleFn: outline(FORTBEND_COLORS.mmd, 1.6, 0.12, "3 4"), lineLabel: { field: "MMD_NAME", minZoom: 11, format: (v) => str(v) || null }, identifyCard: mmdCard,
    note: "Municipal management districts in Fort Bend County (13), such as Sienna Plantation and First Colony. Click one for its name, TCEQ ID and status.",
    infoCaveat: "A management district can levy assessments and build or maintain infrastructure inside its boundary; the district's own rules and fees are not in this layer.",
  }),
  fb_dev_agreements: feature("fbDevAgreements", {
    label: "Development Agreements (Fort Bend)", role: "area", group: "jurisdiction", order: 62, minZoom: 11, source: "Fort Bend County — Development Agreements",
    fields: ["OBJECTID", "SUBDIVISION", "AFFECTED_ROAD", "DEVELOPER", "TYPE", "STATUS"],
    color: FORTBEND_COLORS.agreement, weight: 1.6, styleFn: outline(FORTBEND_COLORS.agreement, 1.6, 0.16), identifyCard: agreementCard,
    note: "County development agreements (48): the road dedication, construction or contribution a project already owes the county. Click one for the road, developer and agreement type.",
    infoCaveat: "The layer names the obligation, not its terms or amounts — the signed agreement has those. Ask the Fort Bend County Engineer for it.",
  }),
  /* ---- Access: the county's thoroughfare plan ---- */
  fb_mtp_proposed: feature("fbMtpProposed", {
    label: "Proposed Thoroughfares (Fort Bend MTP)", role: "line", group: "access", order: 60, minZoom: 11, source: "Fort Bend County — Major Thoroughfare Plan (proposed roadways)",
    fields: ["OBJECTID", "FULL_NAME", "RD_NAME", "CITY", "ROAD_CLA_1", "DATE_MODIF"],
    color: FORTBEND_COLORS.mtp, weight: 2, styleFn: (_p, opacity) => ({ color: FORTBEND_COLORS.mtp, weight: 2, opacity, dashArray: "8 5" }), lineLabel: { field: "FULL_NAME", minZoom: 13, format: (v) => soft(v) || null }, identifyCard: mtpProposedCard,
    note: "Roads on Fort Bend County's Major Thoroughfare Plan that are proposed, not built (339 segments). Click one for its name and city.",
    infoCaveat: "A planned alignment, drawn schematically — not surveyed right-of-way. The layer carries no width or lane count. Confirm the alignment and any right-of-way dedication with the Fort Bend County Engineer.",
  }),
};

export const FORTBEND_VINTAGE = {
  fb_lid: "Fort Bend County GIS — Water Districts (current edition)",
  fb_levees: "Fort Bend County Drainage District levee layer (FEMA levee schema) — current edition",
  fb_brazos_inundation: "Fort Bend County Drainage District Brazos River 100-year inundation study — study date not published",
  fb_brazos_floodplain: "Fort Bend County Drainage District Brazos River 55-foot floodplain study — study date not published",
  fb_tirz: "Fort Bend County GIS — Boundaries (current edition)",
  fb_mmd: "Fort Bend County GIS — Boundaries (current edition)",
  fb_dev_agreements: "Fort Bend County GIS — Boundaries (current edition)",
  fb_mtp_proposed: "Fort Bend County Major Thoroughfare Plan — plan lines carry their own last-updated dates",
};
