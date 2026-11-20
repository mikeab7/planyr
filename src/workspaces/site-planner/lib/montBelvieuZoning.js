/* City of Mont Belvieu zoning (B2671240, 2026-11-12) — the pure half: how a zoning polygon is read, classed, painted and worded.
 *
 * SOURCE: the city's own ArcGIS Server (www.cmbgis.com), LandUsePlanning_v2/MapServer/0 "ZoningDistrict", read through the same-origin /gis-proxy relay. MEASURED 2026-11-12: 41 polygons, spatial reference
 * 2278. The only populated district column is `ZONEDESC` — `ZONECLASS` is a blank on all 41 — so there is NO district code in the data: a polygon is named by the city's own description and nothing else.
 *   ZONEDESC (value → polygons): Rural Use 16 · Hill Mixed Use 7 · "Vill. Mixed Use" 7 · PUD 6 · Suburban Residential 3 · Estate Residential 1 · "Freeway Commerical" 1.
 *   `LASTUPDATE` is the layer's only date: the newest (and oldest) value anywhere in it is 2017-06-23 (the layer's own statistics), and some polygons carry none; `HEIGHT` / `BASEELEV` are 0 or null — never shown.
 *   The Targa plant and 1129 Main St both sit in "Hill Mixed Use". There is NO industrial district in this layer.
 *
 * NAMES (constraint #46 — a district name comes from the jurisdiction's own text, never from memory; one that cannot be sourced shows as the layer wrote it):
 *   · the city's layer description is the name, as written;
 *   · TWO spellings are corrected, and only because the city's own zoning code spells them so (its special-use chapter names "Village Mixed Use (VMU)" and "Freeway Commercial (FC)"): the layer's "Vill." and its
 *     typo "Commerical". Nothing else is changed, and NO abbreviation (VMU, FC, ER …) is invented as a code — the layer carries none;
 *   · the city's Unified Development Code itself was NOT reachable when this was written (its mirror host was refused), so "Hill Mixed Use", "Rural Use", "Suburban Residential" and "PUD" are the layer's wording,
 *     unverified against the code text — the card's last line and the (i) say so.
 *
 * Pure: no network, no React, no Leaflet — unit-tested in test/chambersLayers.test.js. */

const clean = (v) => String(v == null ? "" : v).trim().replace(/\s+/g, " ");

/* The layer's ZONEDESC (as published) → the display name. A value not listed is shown exactly as published. */
export const MB_ZONE_NAMES = Object.freeze({
  "ESTATE RESIDENTIAL": "Estate Residential",
  "FREEWAY COMMERICAL": "Freeway Commercial",   // the layer's typo, corrected to the code's own spelling
  "HILL MIXED USE": "Hill Mixed Use",
  "PUD": "PUD",
  "RURAL USE": "Rural Use",
  "SUBURBAN RESIDENTIAL": "Suburban Residential",
  "VILL. MIXED USE": "Village Mixed Use",       // the layer's abbreviation, expanded to the code's own spelling
});

export const zoneName = (raw) => {
  const t = clean(raw);
  if (!t) return null;
  return MB_ZONE_NAMES[t.toUpperCase()] || t;
};
/* The on-map label text. */
export const zoneLabelText = (raw) => zoneName(raw);

/* The family a district belongs to — colour and legend order. A description not recognised draws neutral. */
export function zoneClass(raw) {
  const n = (zoneName(raw) || "").toUpperCase();
  if (!n) return "other";
  if (/RESIDENTIAL/.test(n)) return "residential";
  if (/RURAL/.test(n)) return "rural";
  if (/COMMERCIAL/.test(n)) return "commercial";
  if (/MIXED/.test(n)) return "mixed";
  if (n === "PUD") return "pud";
  return "other";
}
export const ZONE_COLORS = Object.freeze({
  residential: "#ca8a04", rural: "#65a30d", commercial: "#ea580c", mixed: "#db2777", pud: "#0f766e", other: "#6b7280",
});
export const zoneColor = (raw) => ZONE_COLORS[zoneClass(raw)];

/* esri-leaflet per-feature style: a translucent fill in the family colour with a thin outline. */
export function zoningStyle(props, opacity) {
  const c = zoneColor(props && props.ZONEDESC);
  return { color: c, weight: 1, opacity, fill: true, fillColor: c, fillOpacity: Math.min(0.45, opacity * 0.6) };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/* An Esri date (epoch ms) → "Jun 23, 2017"; null / blank / unreadable → null. */
export function updatedDate(raw) {
  if (raw == null || raw === "" || raw === " ") return null;
  const d = new Date(Number(raw));
  if (!Number.isFinite(d.getTime())) return null;
  const y = d.getUTCFullYear();
  if (y < 1990 || y > 2100) return null;
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${y}`;
}

export const MB_VINTAGE_SHORT = "2017 layer — confirm with Planning";

/* The click card for one zoning polygon (constraint #45: plain labels, no empty rows, no raw field names). The vintage line rides the card itself, as the brief asks. */
export function zoningCard(props) {
  const p = props || {};
  const name = zoneName(p.ZONEDESC);
  const rows = [{ label: "Zone", text: name || "Not recorded in the city's layer" }];
  const upd = updatedDate(p.LASTUPDATE);
  if (upd) rows.push({ label: "Polygon updated", text: upd });
  rows.push({ label: "Layer vintage", text: MB_VINTAGE_SHORT });
  return { title: "Zoning · Mont Belvieu", rows };
}

/* The Zoning dropdown legend for what is in view: ONE heading ("Mont Belvieu" — the jurisdiction, constraint #50) then ONE row per district, in the family colour. `items` = [{ desc }]; duplicates fold. */
export function zoningLegend(items) {
  const seen = new Set();
  for (const it of items || []) { const n = zoneName(it && it.desc); if (n) seen.add(n); }
  if (!seen.size) return [];
  const order = ["residential", "rural", "mixed", "commercial", "pud", "other"];
  const names = [...seen].sort((a, b) => order.indexOf(zoneClass(a)) - order.indexOf(zoneClass(b)) || a.localeCompare(b));
  return [{ heading: true, label: "Mont Belvieu" }, ...names.map((n) => ({ label: n, color: zoneColor(n), row: true }))];
}
export const legendItemsOf = (features) => (features || []).map((f) => ({ desc: f && f.properties && f.properties.ZONEDESC }));

export const MB_CITATION = "District names are the city's own descriptions in its zoning layer (last edited 2017); 'Village Mixed Use' and 'Freeway Commercial' use the spelling in the city's zoning code. The layer lists no industrial district. The Unified Development Code governs — confirm the district and its permitted uses with the City of Mont Belvieu Planning.";
