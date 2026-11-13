/* Davidson County, TN (Metro Nashville) — the parcel card's extra rows (NEW-2, 2026-11-12).
 *
 * SOURCE: the Planning Department / Assessor of Property's Parcels_view (counties.js `tn_davidson`). Beyond owner / address / acres / values it carries, on every row (measured 2026-11-12 over 287,729 lots):
 *   · Zoning   — the ASSESSOR'S zoning, a comma list ("IR,IWD"); not Metro Planning's zoning layer, which can disagree after a rezoning, so the row is labelled "(per assessor)";
 *   · Council  — the council district, two characters ("16", "01");  · TaxDist — the tax district code, padded with trailing spaces ("USD ", "GSD ", "OH  ");  · LUDesc — the land-use name.
 *   · A satellite city's land carries a placeholder zoning code "<n>ZZ" (3ZZ Belle Meade · 4ZZ Berry Hill · 5ZZ Forest Hills · 6ZZ Goodlettsville · 8ZZ Oak Hill · 9ZZ Ridgetop — each agrees with the lot's TaxDist
 *     on 99% of its lots) meaning "the city zones this, not Metro". It is NEVER shown as a code (#41); the row says so in words, and keeps any real code the assessor listed beside it.
 *   · FEATURETYPE also holds placeholder polygons for lots across the county line — Cheatham 45, Robertson 46, Rutherford 4, Williamson 103, Wilson 58 ("ASSESSED IN WILSON COUNTY"): Metro draws them but has no
 *     Metro record of them, so no Metro row (zoning, tax district, council) is ever shown for one, and a click on one is not answered by this layer at all (counties.js `pointWhere`).
 *
 * The assessor's portal (portal.padctn.org) takes the STANPAR as "Map & Parcel" but publishes no per-parcel address, so the card links to the portal's home and the card row says so by name.
 *
 * Pure: no network, no React — unit-tested in test/davidsonParcelCard.test.js. */

const str = (v) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim());
const get = (attrs, name) => {
  if (!attrs) return "";
  const k = Object.keys(attrs).find((key) => key.replace(/^.*\./, "").toLowerCase() === name.toLowerCase());
  return k ? str(attrs[k]) : "";
};

export const ASSESSOR_PORTAL = "https://portal.padctn.org/OFS/WP/Home";
/* FEATURETYPE values that are another county's lots drawn in Metro's layer. */
export const OUT_OF_COUNTY_FEATURETYPES = Object.freeze(["Cheatham", "Robertson", "Rutherford", "Williamson", "Wilson"]);
/* The `where` that leaves them out of a point click (ArcGIS SQL). */
export const METRO_POINT_WHERE = `FEATURETYPE NOT IN (${OUT_OF_COUNTY_FEATURETYPES.map((n) => `'${n}'`).join(",")})`;

/* Is this attribute bag a Davidson (Metro Nashville) parcel row? — STANPAR beside the Metro-only Council / TaxDist / FEATURETYPE columns. */
export function isDavidsonRecord(attrs) {
  if (!attrs || typeof attrs !== "object") return false;
  const keys = new Set(Object.keys(attrs).map((k) => k.replace(/^.*\./, "").toLowerCase()));
  return keys.has("stanpar") && keys.has("taxdist") && keys.has("council") && keys.has("featuretype");
}
export const isOutOfCountyPlaceholder = (attrs) => OUT_OF_COUNTY_FEATURETYPES.includes(get(attrs, "FEATURETYPE"));

const SATELLITE_ZONE = /^\d+ZZ$/i;
/* The assessor's comma list as words: "IR,IWD" → "IR, IWD"; "3ZZ" → "Zoned by the city, not Metro"; "3ZZ,RS20" → "Zoned by the city, not Metro (assessor also lists RS20)". Null when blank. */
export function assessorZoningText(raw) {
  const tokens = str(raw).split(",").map((t) => t.trim()).filter(Boolean);
  if (!tokens.length) return null;
  const real = [...new Set(tokens.filter((t) => !SATELLITE_ZONE.test(t)))];
  if (real.length === tokens.length) return real.join(", ");
  return real.length ? `Zoned by the city, not Metro (assessor also lists ${real.join(", ")})` : "Zoned by the city, not Metro";
}
/* "01" → "1"; anything that is not a plain number is shown as written; blank → null. */
export function councilText(raw) {
  const t = str(raw);
  if (!t) return null;
  return /^\d+$/.test(t) ? String(Number(t)) : t;
}
/* The tax district code as the assessor typed it, trimmed; "UNASSIGNED" is no district. */
export function taxDistrictText(raw) {
  const t = str(raw);
  return !t || /^unassigned$/i.test(t) ? null : t;
}
const SMALL = new Set(["and", "of", "the", "for", "to", "a", "in", "w"]);
const landUseText = (raw) => {
  const t = str(raw);
  if (!t) return null;
  if (/[a-z]/.test(t)) return t;
  return t.toLowerCase().replace(/\b[a-z][a-z'.&/]*/g, (w, i) => (i > 0 && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)));
};

/* The Davidson rows of the curated parcel card, in card order, or [] for a non-Davidson bag or a placeholder lot. Each is { label, value }; the link row's value is an http(s) URL, which the card renders as a link. */
export function davidsonRows(attrs) {
  if (!isDavidsonRecord(attrs) || isOutOfCountyPlaceholder(attrs)) return [];
  const out = [];
  const lu = landUseText(get(attrs, "LUDesc"));
  if (lu) out.push({ label: "Land use", value: lu });
  const z = assessorZoningText(get(attrs, "Zoning"));
  if (z) out.push({ label: "Zoning (per assessor)", value: z });
  const td = taxDistrictText(get(attrs, "TaxDist"));
  if (td) out.push({ label: "Tax district", value: td });
  const cd = councilText(get(attrs, "Council"));
  if (cd) out.push({ label: "Council district", value: cd });
  out.push({ label: "Assessor portal", value: ASSESSOR_PORTAL });
  return out;
}
