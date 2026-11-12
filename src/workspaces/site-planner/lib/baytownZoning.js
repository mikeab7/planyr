/* City of Baytown zoning (B2671240, 2026-11-12) — the pure half: how a zoning polygon is read, classed, painted, worded.
 *
 * SOURCE: the city's own ArcGIS Online org, City_of_Baytown_Citizen_Map_WFL1/FeatureServer/10 ("BaytownGIS.SDE.BT_Zoning_Master"), read directly (AGOL is CORS-open). MEASURED 2026-11-12: 24,849 polygons,
 * layer last edited 2023-02-16 — PARCEL-LEVEL (HCAD account, address, acres), so a zoomed-out view is a very large answer: the layer row asks it simplified and with every page followed (the DeSoto shape).
 * It covers the Harris AND the Chambers County sides of the city (HI 152 ac at ≈ (−94.873, 29.80), measured).
 *
 * WHAT THE DATA DOES TO YOU, and what is done about it:
 *   · `ULDCZON_20` is the district code. 17 codes plus `SL` (372 slivers of ≈ 0.007 ac — street-side lots; the layer's own legend does not list it), blank (1) and null (13). A code the city's legend
 *     has no name for shows BARE — never a guess (constraint #46); a blank / null code says "not recorded".
 *   · NAMES are the city's own LEGEND LABELS for that layer (its renderer's `label` for each value, read 2026-11-12), exactly as written ("Med. Density Mixed Res.") — nothing expanded from memory.
 *   · ⛔ THE LAYER IS OLDER THAN THE CODE. Baytown adopted a new Unified Land Development Code on 2024-09-12 effective 2025-01-01 that renames districts (its Article 2 map lists e.g. Estate Residential
 *     (ER) for the former SFE); this layer was last edited 2023-02-16 and still carries the old codes. Every card and the (i) say so — the code printed IS the layer's, not necessarily today's.
 *   · `ORD_Date` is typed text in TWO shapes — "20140724" (YYYYMMDD) and "08252022" (MMDDYYYY) — and blank (" ") when unknown. The two cannot be confused: a YYYYMMDD value starts 19/20, which is never a month.
 *   · `ORD_num` carries a thousands comma on some rows ("15,178"); it is shown without it. A blank (" ") is "not recorded".
 *
 * Pure: no network, no React, no Leaflet — unit-tested in test/chambersLayers.test.js. */

export const normalizeZone = (raw) => String(raw == null ? "" : raw).trim().toUpperCase();

/* District names — the city's own legend labels for its zoning layer (the renderer's uniqueValueInfos, read 2026-11-12), by code. "PUD" carries no words in the legend, so it shows bare. */
export const BT_ZONE_NAMES = Object.freeze({
  ACE: "Arts, Cultural and Entertainment",
  GC: "General Commercial",
  HI: "Heavy Industrial",
  LC: "Livable Center",
  LI: "Light Industrial",
  MF1: "Med. Density Mixed Res.",
  MF2: "Mid-Rise Mixed Res.",
  MF3: "High Density Mixed Res.",
  MU: "Mixed Use",
  NSC: "Neighborhood Serving Commercial",
  OR: "Open Space/Recreation",
  SF1: "Low Density Single-Fam. Res.",
  SF2: "Mixed Res. Low/Med. Density",
  SFE: "Single-Fam. Estate",
  SJO: "San Jacinto Overlay District",
  UN: "Urban Neighborhood",
});

export const zoneName = (code) => BT_ZONE_NAMES[normalizeZone(code)] || null;
/* "HI · Heavy Industrial", or the bare code when the city's legend gives no name. */
export const zoneWithName = (code) => { const c = normalizeZone(code); const n = zoneName(c); return n ? `${c} · ${n}` : c; };
/* The on-map label text (a polygon's code), or null for a polygon with no code. */
export const zoneLabelText = (raw) => normalizeZone(raw) || null;

/* The family a code belongs to — colour and legend order. Unknown codes are "other", drawn neutral and never guessed. */
export function zoneClass(code) {
  const z = normalizeZone(code);
  if (!z) return "other";
  if (z === "HI" || z === "LI") return "industrial";
  if (z === "GC" || z === "NSC" || z === "ACE" || z === "LC") return "commercial";
  if (z === "MU") return "mixed";
  if (/^(SF[12E]|MF[123]|UN)$/.test(z)) return "residential";
  if (z === "PUD") return "pud";
  if (z === "OR") return "parks";
  if (z === "SJO") return "overlay";
  return "other";
}
export const ZONE_COLORS = Object.freeze({
  industrial: "#7c3aed", commercial: "#ea580c", mixed: "#db2777", residential: "#ca8a04", pud: "#0f766e", parks: "#4d7c0f", overlay: "#0369a1", other: "#6b7280",
});
export const zoneColor = (code) => ZONE_COLORS[zoneClass(code)];

/* esri-leaflet per-feature style: a translucent fill in the family colour with a thin outline (parcel-level polygons, so the outline stays hairline). */
export function zoningStyle(props, opacity) {
  const c = zoneColor(props && props.ULDCZON_20);
  return { color: c, weight: 0.8, opacity, fill: true, fillColor: c, fillOpacity: Math.min(0.45, opacity * 0.6) };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/* "20140724" → "Jul 24, 2014"; "08252022" → "Aug 25, 2022"; blank / unreadable → null. */
export function adoptedDate(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!/^\d{8}$/.test(s)) return null;
  let y, m, d;
  if (/^(19|20)/.test(s)) { y = +s.slice(0, 4); m = +s.slice(4, 6); d = +s.slice(6, 8); }   // YYYYMMDD — a 19/20 prefix is never a month
  else { m = +s.slice(0, 2); d = +s.slice(2, 4); y = +s.slice(4, 8); }                      // MMDDYYYY
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) return null;
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

const has = (v) => { const t = String(v == null ? "" : v).trim(); return !!t && !/^(null|none|n\/a|<null>)$/i.test(t); };
/* "15,178" → "15178"; blank → null. */
export const ordinanceNumber = (raw) => (has(raw) ? String(raw).trim().replace(/,/g, "") : null);

/* The click card for one zoning polygon (constraint #45: plain labels, no empty rows, no raw field names). The vintage line rides the card itself because the code may have been renamed since. */
export function zoningCard(props) {
  const p = props || {};
  const code = normalizeZone(p.ULDCZON_20);
  const rows = [];
  rows.push({ label: "Zone", text: code ? zoneWithName(code) : "Not recorded in the city's layer" });
  const ord = ordinanceNumber(p.ORD_num);
  if (ord) rows.push({ label: "Ordinance", text: ord });
  const dt = adoptedDate(p.ORD_Date);
  if (dt) rows.push({ label: "Adopted", text: dt });
  if (has(p.Comment_1)) rows.push({ label: "Note", text: String(p.Comment_1).trim() });
  rows.push({ label: "Layer vintage", text: BAYTOWN_VINTAGE_SHORT });
  return { title: "Zoning · Baytown", rows };
}

/* Zoning legend for what is in view: ONE heading ("Baytown" — the jurisdiction, constraint #50) then ONE row per code. `items` = [{ code }]; duplicates fold; blank codes are skipped. */
export function zoningLegend(items) {
  const seen = new Set();
  for (const it of items || []) { const c = normalizeZone(it && it.code); if (c) seen.add(c); }
  if (!seen.size) return [];
  const order = ["residential", "commercial", "mixed", "industrial", "pud", "parks", "overlay", "other"];
  const codes = [...seen].sort((a, b) => order.indexOf(zoneClass(a)) - order.indexOf(zoneClass(b)) || a.localeCompare(b, undefined, { numeric: true }));
  return [{ heading: true, label: "Baytown" }, ...codes.map((c) => ({ label: zoneWithName(c), color: zoneColor(c), row: true }))];
}
export const legendItemsOf = (features) => (features || []).map((f) => ({ code: f && f.properties && f.properties.ULDCZON_20 }));

export const BAYTOWN_VINTAGE_SHORT = "Edited 2023-02-16 — before Baytown's new code (effective 2025-01-01) renamed districts";
export const BAYTOWN_CITATION = "District names are the city's own legend labels for its zoning layer (last edited 2023-02-16). Baytown adopted a new Unified Land Development Code effective 2025-01-01 that renames districts; confirm today's district with the City of Baytown Planning before relying on a code.";
