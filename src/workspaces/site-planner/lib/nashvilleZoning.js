/* Metro Nashville & Davidson County zoning — the pure half (NEW-1, 2026-11-12): how a zoning / overlay / downtown-code / PUD / policy polygon is classed, painted, worded and listed.
 *
 * SOURCE: Metro's ArcGIS Online org (services2.arcgis.com/HdTo6HJqh92wn4D8), see src/shared/gis/sourcesNashville.js. Fields (measured 2026-11-12):
 *   · Zoning_Vw: ZONE_DESC (the CODE only — "IR", "MUL-A", "SP", "Satellite City"), NAME (the specific plan's name on SP polygons), ORDINANCE, ORD_DATE, CASE_NO. Text fields arrive padded with spaces
 *     ("O73-650 ", " ") — everything is trimmed and a blank is no row.
 *   · Zoning_Overlay_Districts_Vw: ZONE_DESC (a plain-words NAME already), NAME, SUBDISTRICT, IMPACT_ZONE, ORDINANCE, ORD_DATE, CASE_NO.
 *   · Downtown_Code_Subdistricts_and_Use_Areas_view: Subdistrict, UseArea (shouted: "GULCH SOUTH", "CENTRAL").
 *   · Planned_Unit_Developments_Vw: ZONE_DESC (the PUD's type as typed, 18 spellings), ORDINANCE, ORD_DATE, CASE_NO.
 *   · Planning/CCM (NashvilleNext Community Character Policy): PolicyCode, PolicyDesc, Transect, DateAdopted.
 *
 * NAMES (#46): a district NAME comes only from `nashvilleZoningNames.js` (Title 17, sourced); a code with no sourced name shows the bare code. The satellite cities (Belle Meade, Berry Hill, Forest Hills,
 * Goodlettsville, Oak Hill, Ridgetop) zone themselves — Metro's layer reads "Satellite City" there — so a result in one says "Zoned by City of X — not Metro" and never a Metro code (#41).
 *
 * Pure: no network, no React, no Leaflet — unit-tested in test/nashvilleLayers.test.js. */

import { approvalDate } from "./desotoZoning.js";
import { nashZoneName, NASH_ZONING_CITATION } from "./nashvilleZoningNames.js";

export const SATELLITE_CODE = "Satellite City";
export const METRO = "Metro Nashville";

const str = (v) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim());
const has = (v) => { const t = str(v); return !!t && !/^(null|none|n\/?a|<null>)$/i.test(t); };
const row = (label, v, extra) => (has(v) ? { label, text: str(v), ...(extra || {}) } : null);
const clean = (rows) => rows.filter(Boolean);
const SMALL = new Set(["and", "of", "the", "for", "to", "a", "in"]);
/* Shouted text ("GULCH SOUTH", "CENTRAL") reads as words; mixed-case text is left exactly as written. */
export function soft(v) {
  const t = str(v);
  if (!t || /[a-z]/.test(t)) return t;
  return t.toLowerCase().replace(/\b[a-z][a-z'.&]*/g, (w, i) => (i > 0 && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))); // \b: the "nd" of "2nd" is not a word start
}
/* The date Metro typed, as words — an epoch-ms number, an ISO string, or (the policy layer) possibly already text; unreadable text is shown as typed, an unset date as nothing. */
function dateWords(raw) {
  const d = approvalDate(raw);
  if (d) return d;
  return typeof raw === "string" && has(raw) && !/^\d{9,}$/.test(raw.trim()) ? str(raw) : null;
}

/* ───────────────────────── base zoning ───────────────────────── */
/* The code as Metro's layer spells it, trimmed. */
export const zoneCode = (props) => str(props && props.ZONE_DESC) || null;
export const isSatelliteCode = (code) => str(code).toLowerCase() === SATELLITE_CODE.toLowerCase();

/* Family for colour and legend order — by the code system's own letters ("-A" and "-NS" variants fold into their base). Unknown codes are "other", drawn neutral and never guessed. */
export function zoneClass(code) {
  const c = str(code);
  if (!c) return "other";
  if (isSatelliteCode(c)) return "satellite";
  const z = c.toUpperCase().replace(/(-A)?(-NS)?$/, "");
  if (z === "SP") return "sp";
  if (z === "DTC") return "downtown";
  if (z === "AG" || z === "AR2A") return "agricultural";
  if (/^(IWD|IR|IG)$/.test(z)) return "industrial";
  if (/^MU[NLGI]$/.test(z)) return "mixed";
  if (/^O[NLG]$/.test(z) || /^OR(\d+|I)$/.test(z)) return "office";
  if (/^SC[CNR]$/.test(z) || /^C[ACFLNS]$/.test(z)) return "commercial";
  if (/^(RS\d|R\d|RM\d|RL\d)/.test(z) || z === "MHP") return "residential";
  return "other";
}
export const ZONE_COLORS = Object.freeze({
  industrial: "#7c3aed", commercial: "#ea580c", office: "#0891b2", mixed: "#db2777", residential: "#ca8a04", agricultural: "#4d7c0f", // design-exempt: map ink for a drawn zoning class (cartography, not UI chrome)
  downtown: "#0f766e", sp: "#2563eb", satellite: "#6b7280", other: "#6b7280", // design-exempt: map ink for a drawn zoning class (cartography, not UI chrome)
});
export const ZONE_CLASS_ORDER = ["residential", "agricultural", "office", "commercial", "mixed", "industrial", "downtown", "sp", "other", "satellite"];
export const zoneColor = (code) => ZONE_COLORS[zoneClass(code)];

/* esri-leaflet per-feature style: a translucent family-coloured fill with a thin outline; satellite-city land is dashed and fainter (Metro does not zone it). */
export function zoningStyle(props, opacity) {
  const code = zoneCode(props);
  const c = zoneColor(code);
  const sat = isSatelliteCode(code);
  return { color: c, weight: 1, opacity, fill: true, fillColor: c, fillOpacity: Math.min(sat ? 0.18 : 0.45, opacity * (sat ? 0.3 : 0.6)), ...(sat ? { dashArray: "4 3" } : {}) };
}

/* The on-map label (a polygon's code). Satellite-city land prints nothing — "Satellite City" across a whole city is noise; the legend and the card say it. */
export const zoneLabelText = (raw) => { const c = str(raw); return c && !isSatelliteCode(c) ? c : null; };

/* "IR · Industrial Restrictive" when the ordinance name is sourced, else the bare code. */
export const zoneWithName = (code) => { const c = str(code); const n = nashZoneName(c); return n ? `${c} · ${n}` : c; };

/* The card's title: the government that zones the SITE (#41) — Metro, or the satellite city the point is in. */
export const zoningTitle = (satelliteCity, props) => `Zoning · ${satelliteCity || (isSatelliteCode(zoneCode(props)) ? "Satellite city" : METRO)}`;

/* The rows of the zoning click card. `satelliteCity` = the satellite city the SITE falls in ("City of Belle Meade") or null. */
export function zoningRows(props, satelliteCity) {
  const p = props || {};
  const code = zoneCode(p);
  const sat = isSatelliteCode(code) || !!satelliteCity;
  const rows = [];
  if (sat) {
    rows.push({ label: "Zoning", text: `Zoned by ${satelliteCity || "the satellite city"} — not Metro` });
    if (code && !isSatelliteCode(code)) rows.push({ label: "Metro's layer reads", text: code }); // a Metro code on land the city zones is shown, never hidden
    return rows;
  }
  if (code) rows.push({ label: "Zone", text: zoneWithName(code) });
  if (zoneClass(code) === "sp") rows.push(row("Plan name", p.NAME));
  rows.push(row("Case", p.CASE_NO));
  rows.push(row("Ordinance", p.ORDINANCE));
  const dt = dateWords(p.ORD_DATE);
  if (dt) rows.push({ label: "Adopted", text: dt });
  return clean(rows);
}
export const zoningCard = (props, satelliteCity) => ({ title: zoningTitle(satelliteCity, props), rows: zoningRows(props, satelliteCity) });

/* The Zoning dropdown legend for what is in view: ONE heading naming the government (#50), then ONE row per code, in the family colour, sorted by family then code. Satellite-city land is one row. */
export function zoningLegend(items) {
  const seen = new Set();
  for (const it of items || []) { const c = str(it && it.code); if (c) seen.add(c); }
  if (!seen.size) return [];
  const codes = [...seen].sort((a, b) => ZONE_CLASS_ORDER.indexOf(zoneClass(a)) - ZONE_CLASS_ORDER.indexOf(zoneClass(b)) || a.localeCompare(b, undefined, { numeric: true }));
  return [
    { heading: true, label: METRO },
    ...codes.map((c) => (isSatelliteCode(c) ? { label: "Satellite cities — zoned by each city", color: ZONE_COLORS.satellite, row: true } : { label: zoneWithName(c), color: zoneColor(c), row: true })),
  ];
}
export const legendItemsOf = (features) => (features || []).map((f) => ({ code: zoneCode(f && f.properties) }));

export const ZONING_CITATION = `District names are from ${NASH_ZONING_CITATION}; a code with no sourced name shows as the code. The zoning ordinance on file is the legal text.`;

/* ───────────────────────── overlays ───────────────────────── */
const OVERLAY_PALETTE = ["#0369a1", "#b45309", "#15803d", "#7e22ce", "#be123c", "#0f766e", "#a16207", "#4338ca", "#be185d", "#65a30d"]; // design-exempt: map ink for a drawn zoning class (cartography, not UI chrome)
/* A stable colour per overlay name (the same overlay is the same colour on every load). */
export function overlayColor(name) {
  const s = str(name).toUpperCase();
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return OVERLAY_PALETTE[h % OVERLAY_PALETTE.length];
}
export const overlayName = (props) => soft(props && props.ZONE_DESC) || null;
export function overlayStyle(props, opacity) {
  const c = overlayColor(overlayName(props));
  return { color: c, weight: 1.6, opacity, fill: true, fillColor: c, fillOpacity: Math.min(0.2, opacity * 0.3), dashArray: "6 4" };
}
export function overlayCard(props) {
  const p = props || {};
  const name = overlayName(p);
  return {
    title: name ? `Overlay · ${name}` : "Zoning overlay",
    rows: clean([row("Name", p.NAME), row("Subdistrict", p.SUBDISTRICT), row("Impact zone", p.IMPACT_ZONE), row("Case", p.CASE_NO), row("Ordinance", p.ORDINANCE), dateWords(p.ORD_DATE) ? { label: "Adopted", text: dateWords(p.ORD_DATE) } : null]),
    note: "An overlay adds rules on top of the base zoning — both apply.",
  };
}
export function overlayLegend(features) {
  const names = new Map();
  for (const f of features || []) { const n = overlayName(f && f.properties); if (n && !names.has(n)) names.set(n, overlayColor(n)); }
  if (!names.size) return [];
  return [{ heading: true, label: `${METRO} overlays` }, ...[...names].sort((a, b) => a[0].localeCompare(b[0])).map(([label, color]) => ({ label, color, row: true }))];
}

/* ───────────────────────── downtown code ───────────────────────── */
export const DTC_COLOR = "#0f766e"; // design-exempt: map ink for a drawn zoning class (cartography, not UI chrome)
export const dtcStyle = (_p, opacity) => ({ color: DTC_COLOR, weight: 1.2, opacity, fill: true, fillColor: DTC_COLOR, fillOpacity: Math.min(0.22, opacity * 0.35) });
export const dtcLabelText = (raw) => soft(raw) || null;
export function dtcCard(props) {
  const p = props || {};
  const sub = soft(p.Subdistrict);
  return { title: sub ? `Downtown Code · ${sub}` : "Downtown Code", rows: clean([row("Subdistrict", sub), row("Use area", soft(p.UseArea))]) };
}

/* ───────────────────────── planned unit developments ───────────────────────── */
export const PUD_COLOR = "#0d9488"; // design-exempt: map ink for a drawn zoning class (cartography, not UI chrome)
export const pudStyle = (_p, opacity) => ({ color: PUD_COLOR, weight: 1.2, opacity, fill: true, fillColor: PUD_COLOR, fillOpacity: Math.min(0.2, opacity * 0.3), dashArray: "3 3" });
export function pudCard(props) {
  const p = props || {};
  const dt = dateWords(p.ORD_DATE);
  return {
    title: "Planned unit development",
    rows: clean([row("Type", p.ZONE_DESC), row("Case", p.CASE_NO), row("Ordinance", p.ORDINANCE), dt ? { label: "Adopted", text: dt } : null]),
    note: "A PUD's own plan sets what is allowed, not the underlying base zone.",
  };
}

/* ───────────────────────── NashvilleNext Community Character Policy ───────────────────────── */
export const policyCode = (props) => str(props && props.PolicyCode) || null;
export const policyName = (props) => soft(props && props.PolicyDesc) || null;
export function ccmStyle(props, opacity) {
  const c = overlayColor(policyCode(props) || policyName(props));
  return { color: c, weight: 1, opacity, fill: true, fillColor: c, fillOpacity: Math.min(0.35, opacity * 0.5) };
}
export const ccmLabelText = (raw) => str(raw) || null;
export function ccmCard(props) {
  const p = props || {};
  const code = policyCode(p), name = policyName(p);
  const dt = dateWords(p.DateAdopted);
  return {
    title: "Community character policy",
    rows: clean([code || name ? { label: "Policy", text: [code, name].filter(Boolean).join(" · ") } : null, row("Transect", soft(p.Transect)), dt ? { label: "Adopted", text: dt } : null]),
    note: "NashvilleNext planning policy — guidance for rezoning decisions, not zoning.",
  };
}
export function ccmLegend(features) {
  const seen = new Map();
  for (const f of features || []) {
    const p = (f && f.properties) || {};
    const code = policyCode(p);
    if (code && !seen.has(code)) seen.set(code, { label: [code, policyName(p)].filter(Boolean).join(" · "), color: overlayColor(code), row: true });
  }
  if (!seen.size) return [];
  return [{ heading: true, label: "NashvilleNext policy" }, ...[...seen.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, v]) => v)];
}
