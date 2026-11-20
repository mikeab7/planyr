/* City of Sugar Land zoning (NEW-1, 2026-11-02) — the pure half: how a zoning polygon is read, classed, painted, worded and linked.
 *
 * SOURCE: the city's own ArcGIS Server, Interactive_Map/Zoning_Districts_Map/MapServer/2 ("Zoning District", 339 polygons; the same data as Zoning_GWNT/MapServer/0),
 * read through the /gis-proxy relay. Fields: Zone_Label (the code the city's own renderer and labels use), ZONE_DEF ("M-1  - RESTRICTED INDUSTRIAL"), ORD_NO,
 * DATE_ (text, m-d-yy), OLDZN, PDF_Link.
 *
 * WHAT THE DATA DOES TO YOU (measured 2026-11-02 over all 339 polygons), and what is done about it:
 *   · one stray code reads "R- 4" (Zone_Label) — `normalizeZone` collapses the spaces around a hyphen, so it is R-4 everywhere it is shown, counted or compared;
 *   · ZONE_DEF is blank on 38 polygons, so the code comes from Zone_Label (the field the city draws and labels by) and ZONE_DEF is only the fallback;
 *   · on 5 polygons ZONE_DEF names a DIFFERENT district than Zone_Label (a B-1 polygon whose definition reads B-O, an R-1 whose definition reads R-1R …). Neither is
 *     "right" — the card shows the code the city draws and ALSO the definition text the city's record carries, so the disagreement is visible, never resolved by a guess;
 *   · the district NAMES are the city's own legend labels (the layer's renderer, 22 categories) — `SL_ZONE_NAMES` — keyed by code, never written from memory; a code
 *     the legend has no name for (AB-OP) shows bare;
 *   · PDF_Link is filled on 147 polygons but holds a test string ("testformap") on some and plain-http links on the rest — only a real http(s) .pdf link is offered, upgraded to https.
 *
 * Pure: no network, no React, no Leaflet — unit-tested in test/sugarLandZoning.test.js. */

/* "R- 4" → "R-4", " b-2 " → "B-2", "R-1 -I" → "R-1-I". Spaces around a hyphen go; any other run of whitespace becomes one space. */
export function normalizeZone(raw) {
  return String(raw == null ? "" : raw).trim().toUpperCase().replace(/\s*-\s*/g, "-").replace(/\s+/g, " ");
}

/* Splits a ZONE_DEF into its code and the words after it. The city separates them with whitespace (usually "  - "), and types a code's own hyphens without spaces — except a few typos
 * ("R- 4", "R-1- I"), where a token ending in a hyphen takes the next token. "HR-1 - THE HILL RESIDENTIAL" → HR-1 · "THE HILL RESIDENTIAL" (the hyphen-space-word is the separator, "THE" is not a code part). */
function splitDefinition(def) {
  const toks = String(def == null ? "" : def).trim().split(/\s+/).filter(Boolean);
  if (!toks.length) return null;
  let code = toks[0], i = 1;
  while (/-$/.test(code) && toks[i]) code += toks[i++];
  code = normalizeZone(code);
  if (!/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/.test(code)) return null;
  if (toks[i] === "-") i++;
  return { code, rest: toks.slice(i).join(" ") };
}

/* The code at the head of a ZONE_DEF text ("M-1  - RESTRICTED INDUSTRIAL" → "M-1", "BR   - BRAZOS RIVER…" → "BR", "B-1-I  NEIGHBORHOOD BUSINESS (INTERIM)" → "B-1-I"). */
export function codeFromDefinition(def) {
  const d = splitDefinition(def);
  return d ? d.code : null;
}

/* The name text after the code in a ZONE_DEF ("R-1Z - ZERO LOT LINE SINGLE-FAMILY RESIDENTIAL" → "Zero Lot Line Single-Family Residential"), or null. */
export function definitionText(def) {
  const d = splitDefinition(def);
  return d && d.rest ? titleWords(d.rest) : null;
}

const SMALL = new Set(["and", "of", "the"]);
export function titleWords(s) {
  return String(s == null ? "" : s).toLowerCase().replace(/[a-z][a-z'.]*/g, (w, i) => (i > 0 && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .replace(/\(([a-z])/g, (_m, c) => "(" + c.toUpperCase());
}

/* District names — the city's own legend labels (the zoning layer's renderer), by code. Source: the layer's drawingInfo.renderer.uniqueValueInfos, read 2026-11-02. */
export const SL_ZONE_NAMES = Object.freeze({
  "B-1": "Neighborhood Business",
  "B-1-I": "Neighborhood Business (Interim)",
  "B-2": "General Business",
  "B-2-I": "General Business (Interim)",
  "B-O": "Business Office",
  "BR": "Brazos River Parks and Conservation",
  "BR-1": "Brazos River Parks and Conservation (Interim)",
  "HR-1": "The Hill Residential",
  "LPR": "Lake Pointe Redevelopment District",
  "M-1": "Restricted Industrial",
  "M-2": "General Industrial",
  "MUC": "Mixed Use Conservation District",
  "PD": "Planned Development",
  "PD-I": "Planned Development (Interim)",
  "R-1": "Standard Single-Family Residential",
  "R-1-I": "Standard Single-Family Residential (Interim)",
  "R-1E": "Residential Estate",
  "R-1R": "Restricted Single-Family Residential",
  "R-1Z": "Zero Lot Line Single-Family Residential",
  "R-3": "Townhouse Residential",
  "R-4": "Multi-Family Residential",
});

/* A code the city's definition text spells differently from its label for the SAME district (ZONE_DEF "BR-I BRAZOS RIVER… (INTERIM" is the BR-1 district — a typo, not a disagreement). */
const DEFINITION_ALIASES = Object.freeze({ "BR-I": "BR-1" });

/* The code a polygon is drawn and labelled by: Zone_Label, else the head of ZONE_DEF; normalised; null when neither says. */
export function zoneCode(props) {
  const p = props || {};
  return normalizeZone(p.Zone_Label) || codeFromDefinition(p.ZONE_DEF) || null;
}
export const zoneName = (code) => SL_ZONE_NAMES[normalizeZone(code)] || null;
/* "M-1 · Restricted Industrial", or the bare code when the city's legend gives no name. */
export const zoneWithName = (code) => { const c = normalizeZone(code); const n = zoneName(c); return n ? `${c} · ${n}` : c; };
/* The on-map label text (a polygon's code). */
export const zoneLabelText = (raw) => normalizeZone(raw) || null;

/* The family a code belongs to — colour and legend order. Unknown codes are "other", drawn neutral and never guessed. */
export function zoneClass(code) {
  const z = normalizeZone(code);
  if (!z) return "other";
  if (/^M-/.test(z)) return "industrial";
  if (/^B-/.test(z) || z === "AB-OP" || z === "LPR") return "business";
  if (/^(R-|HR-)/.test(z)) return "residential";
  if (/^PD/.test(z)) return "pud";
  if (/^BR/.test(z)) return "parks";
  if (z === "MUC") return "mixed";
  return "other";
}
export const ZONE_COLORS = Object.freeze({
  industrial: "#7c3aed", business: "#ea580c", residential: "#ca8a04", pud: "#0f766e", parks: "#4d7c0f", mixed: "#db2777", other: "#6b7280",
});
export const zoneColor = (code) => ZONE_COLORS[zoneClass(code)];

/* esri-leaflet per-feature style: a translucent fill in the family colour with a thin outline; interim districts are outlined dashed. */
export function zoningStyle(props, opacity) {
  const code = zoneCode(props);
  const c = zoneColor(code);
  const interim = /\(Interim\)$/.test(zoneName(code) || ""); // B-1-I, B-2-I, PD-I, R-1-I, BR-1 — the city's own "(Interim)" districts
  return { color: c, weight: 1, opacity, fill: true, fillColor: c, fillOpacity: Math.min(0.45, opacity * 0.6), ...(interim ? { dashArray: "4 3" } : {}) };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/* The city types DATE_ as text: "07-18-06", "6-06-06", "12-7-21" (m-d-yy), sometimes slashes ("5/1/18") or a four-digit year; a run-together "12721" is NOT read (it could be 12-7-21 or 1-27-21). "Jul 18, 2006", or null for blank / unreadable. */
export function adoptedDate(raw) {
  const m = /^\s*(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})\s*$/.exec(String(raw == null ? "" : raw));
  if (!m) return null;
  const mo = +m[1], d = +m[2];
  let y = +m[3];
  if (m[3].length === 2) y += y <= 30 ? 2000 : 1900;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) return null;
  return `${MONTHS[mo - 1]} ${d}, ${y}`;
}

/* PDF_Link → a link worth offering, or null. Only an http(s) address ending .pdf on a Sugar Land host is kept (the field holds "testformap" on some polygons); http is upgraded to https. */
export function pdfHref(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!/^https?:\/\/[^\s]+\.pdf$/i.test(s)) return null;
  let u;
  try { u = new URL(s); } catch (_) { return null; }
  if (!/(^|\.)sugarlandtx\.gov$/i.test(u.hostname)) return null;
  u.protocol = "https:";
  return u.toString();
}

const has = (v) => { const t = String(v == null ? "" : v).trim(); return !!t && !/^(null|none|n\/a|<null>)$/i.test(t); };

/* The click card for one zoning polygon. Rows: Zone (code · city's name), the city's own definition text WHEN it names a different district, Ordinance, Adopted, Previous zoning, PDF. */
export function zoningCard(props) {
  const p = props || {};
  const code = zoneCode(p);
  const rows = [];
  if (code) rows.push({ label: "Zone", text: zoneWithName(code) });
  const defCode = DEFINITION_ALIASES[codeFromDefinition(p.ZONE_DEF)] || codeFromDefinition(p.ZONE_DEF);
  if (defCode && code && defCode !== code) {
    const dn = definitionText(p.ZONE_DEF);
    rows.push({ label: "City record also reads", text: dn ? `${defCode} · ${dn}` : defCode });
  }
  if (has(p.ORD_NO)) rows.push({ label: "Ordinance", text: String(p.ORD_NO).trim() });
  const dt = adoptedDate(p.DATE_);
  if (dt) rows.push({ label: "Adopted", text: dt });
  const old = normalizeZone(p.OLDZN);
  if (old && old !== code) rows.push({ label: "Previously", text: old });
  const href = pdfHref(p.PDF_Link);
  if (href) rows.push({ label: "Ordinance PDF", text: "Open", href });
  return { title: "Zoning · Sugar Land", rows };
}

/* The Zoning dropdown legend for what is in view: ONE heading ("Sugar Land" — the jurisdiction, never a suffix on each row) then ONE row per code, "R-1Z · Zero Lot Line…", in the
 * family colour. `items` = [{ code }]; duplicates fold. Sorted by family then code. */
export function zoningLegend(items) {
  const seen = new Map();
  for (const it of items || []) {
    const c = normalizeZone(it && it.code);
    if (c && !seen.has(c)) seen.set(c, c);
  }
  if (!seen.size) return [];
  const order = ["residential", "business", "industrial", "pud", "mixed", "parks", "other"];
  const codes = [...seen.keys()].sort((a, b) => order.indexOf(zoneClass(a)) - order.indexOf(zoneClass(b)) || a.localeCompare(b, undefined, { numeric: true }));
  return [{ heading: true, label: "Sugar Land" }, ...codes.map((c) => ({ label: zoneWithName(c), color: zoneColor(c), row: true }))];
}

/* The point of a polygon feature to read a code from in a view-legend callback — the code only needs the feature's properties. */
export const legendItemsOf = (features) => (features || []).map((f) => ({ code: zoneCode(f && f.properties) }));

export const ZONING_CITATION = "District names are the city's own legend labels for its zoning layer; the zoning ordinance on file is the legal text.";
