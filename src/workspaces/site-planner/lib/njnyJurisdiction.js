/* New Jersey + New York jurisdiction facts — the pure, network-free half (NEW-1, the Georgia / California precedent).
 *
 * WHAT THESE TWO STATES ARE, for the jurisdiction stack — and why neither is a Texas, Georgia or California copy:
 *   • NEW JERSEY — all 564 municipalities tile the WHOLE state (city · borough · township · town · village). There is no
 *     unincorporated land, so "Unincorporated" is never a true answer here and is never printed. The badge names the
 *     municipality with its type ("Township of Edison", "Borough of Fort Lee") and the county.
 *   • NEW YORK — the 62 cities cover part of the state and 933 towns tile the rest (the roster the state's own layer publishes);
 *     ~530 villages sit INSIDE towns (a few straddle two). Zoning and site-plan approval come from the village if the site is in
 *     one, otherwise the town or city, so the badge names the village, then its town, then the county:
 *     "Village of Pleasantville · Town of Mount Pleasant · Westchester County". New York City is ONE city whose five boroughs
 *     are each a county: "New York City · Brooklyn (Kings County)".
 *   • NEITHER STATE HAS AN ETJ. A city / village has no reach beyond its limits, so the ETJ role is silent (no "ETJ not mapped",
 *     no "no ETJ layer yet" — naming it, even to deny it, would put a Texas word on a NJ/NY site).
 *
 * ⛔ THE OUTLINES ARE ROUTING HINTS, NEVER ANSWERS. Each is the real state boundary (the state's own county polygons, grown a few
 * km and simplified), so they also hold slivers of PA / CT / MA / VT / DE / the other state across a river. Whether a point is IN
 * New Jersey / New York is decided by point-in-polygon against the state's own county layer; an outline hit the polygon layer does
 * not confirm is "not NJ / not NY" (see `identifyJurisdiction`'s `notInNjNy`). Where the two outlines overlap (the Hudson, Arthur
 * Kill, Rockland–Bergen line) BOTH county layers are asked and whichever answers wins. Neither outline overlaps TX / CO / GA / CA.
 *
 * ⛔ INTERNAL MUNICIPAL NAMES CARRY THEIR TYPE AS A SUFFIX ("Hempstead Village", "Hempstead Town", "Edison Township"), and the
 * DISPLAY form is built from it ("Village of Hempstead"). That is deliberate: `jurisdiction.placeKey` strips a leading
 * "City / Town / Village of " so two layers' spellings of one Texas city compare equal — which would merge New York's Village of
 * Hempstead into the Town of Hempstead (same bare name, two different governments, one inside the other). A suffix keeps them apart.
 * `municipalDisplayName` is applied ONLY to a NJ/NY answer (it would turn Texas's "Bay City" into "City of Bay").
 *
 * Pure. No React, no DOM, no network. Node-testable. */

/* [lng, lat] — same order as `siteRegion.STATE_POLYGONS`. Generated 2026-10-22 from NJOGIS NJ_Counties_3857 and the NYS
 * Civil Boundaries "State_Shoreline"-free county union, simplified 0.02° / 0.03° and grown by the same amount plus 0.004°, so every
 * vertex of the real boundary is inside (test/njnyJurisdiction.test.js asserts the fixtures; the generator is in B-NEW-1's notes). */
export const NJ_OUTLINE = [[-74.85, 38.91], [-74.78, 38.97], [-74.59, 39.23], [-74.31, 39.42], [-74.07, 39.75], [-73.95, 40.33], [-73.96, 40.46], [-74.02, 40.50], [-74.05, 40.48], [-74.03, 40.45], [-74.13, 40.48], [-74.20, 40.47], [-74.24, 40.49], [-74.18, 40.62], [-74.05, 40.64], [-74.01, 40.63], [-74.04, 40.68], [-74.02, 40.69], [-73.87, 41.01], [-74.69, 41.38], [-74.81, 41.34], [-74.90, 41.20], [-75.00, 41.13], [-75.03, 41.08], [-75.17, 41.00], [-75.09, 40.88], [-75.12, 40.86], [-75.13, 40.81], [-75.22, 40.77], [-75.23, 40.68], [-75.21, 40.66], [-75.23, 40.62], [-75.21, 40.55], [-75.09, 40.52], [-75.08, 40.40], [-74.98, 40.38], [-74.96, 40.33], [-74.76, 40.16], [-75.06, 40.03], [-75.09, 39.99], [-75.15, 39.98], [-75.16, 39.91], [-75.35, 39.87], [-75.47, 39.79], [-75.59, 39.63], [-75.54, 39.57], [-75.57, 39.46], [-75.30, 39.27], [-75.26, 39.27], [-75.13, 39.14], [-75.10, 39.19], [-74.93, 39.17], [-74.91, 39.14], [-75.00, 38.91]];
export const NY_OUTLINE = [[-73.57, 40.49], [-73.01, 40.59], [-71.60, 41.04], [-71.92, 41.35], [-73.60, 40.99], [-73.67, 41.09], [-73.43, 41.20], [-73.52, 41.31], [-73.45, 42.08], [-73.47, 42.08], [-73.23, 42.74], [-73.21, 43.54], [-73.29, 43.67], [-73.37, 43.64], [-73.31, 43.77], [-73.40, 44.05], [-73.36, 44.17], [-73.27, 44.26], [-73.30, 44.36], [-73.26, 44.43], [-73.35, 44.62], [-73.30, 44.79], [-73.34, 44.86], [-73.30, 45.04], [-74.83, 45.05], [-75.32, 44.87], [-75.79, 44.54], [-75.88, 44.43], [-76.15, 44.33], [-76.46, 44.12], [-76.81, 43.67], [-78.70, 43.67], [-79.26, 43.47], [-79.09, 43.25], [-79.11, 43.05], [-79.06, 43.04], [-79.06, 43.00], [-78.95, 42.92], [-78.96, 42.85], [-79.80, 42.54], [-79.80, 41.96], [-75.38, 41.97], [-75.28, 41.83], [-75.13, 41.80], [-75.16, 41.76], [-75.09, 41.73], [-75.11, 41.60], [-75.00, 41.45], [-74.76, 41.40], [-74.72, 41.33], [-74.31, 41.13], [-73.93, 41.00], [-73.95, 40.93], [-74.08, 40.68], [-74.23, 40.66], [-74.30, 40.50], [-74.24, 40.44]];

function inRing(poly, lng, lat) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const finite = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng);
export const inNewJerseyEnvelope = (lat, lng) => finite(lat, lng) && inRing(NJ_OUTLINE, lng, lat);
export const inNewYorkEnvelope = (lat, lng) => finite(lat, lng) && inRing(NY_OUTLINE, lng, lat);
export const inNjNyEnvelope = (lat, lng) => inNewJerseyEnvelope(lat, lng) || inNewYorkEnvelope(lat, lng);

/* ⛔ THE TWO OUTLINES OVERLAP (each is grown a few km), most of all on the Hudson and Arthur Kill — lower Manhattan is inside the NJ
 * outline and Jersey City inside the NY one. The identify handles that by asking BOTH county layers. `siteState` cannot (it is
 * synchronous geometry that scopes the Layers panel and the Texas-rule guards), so a point in both is settled by this: the real NJ
 * land-and-water boundary near the NY line, simplified to ~0.006° (the NJOGIS county union clipped to 40.4–41.5°N, -74.8– -73.7°W). Inside
 * it → NJ, else NY. It only ever arbitrates points already inside both outlines. */
const NJ_NEAR_NY = [[-73.975, 40.406], [-73.983, 40.447], [-74.002, 40.479], [-74.020, 40.473], [-73.993, 40.445], [-73.995, 40.430], [-73.981, 40.412], [-73.986, 40.405], [-74.055, 40.421], [-74.134, 40.457], [-74.158, 40.447], [-74.180, 40.459], [-74.202, 40.439], [-74.262, 40.465], [-74.270, 40.485], [-74.250, 40.523], [-74.254, 40.550], [-74.215, 40.565], [-74.202, 40.597], [-74.208, 40.624], [-74.200, 40.637], [-74.183, 40.648], [-74.093, 40.650], [-74.090, 40.665], [-74.107, 40.670], [-74.071, 40.661], [-74.096, 40.675], [-74.066, 40.666], [-74.081, 40.676], [-74.071, 40.679], [-74.080, 40.689], [-74.071, 40.684], [-74.068, 40.697], [-74.055, 40.691], [-74.035, 40.706], [-74.020, 40.753], [-74.027, 40.757], [-73.970, 40.829], [-73.928, 40.915], [-73.902, 40.997], [-74.696, 41.358], [-74.756, 41.345], [-74.767, 41.328], [-74.793, 41.322], [-74.800, 41.307], [-74.800, 40.400], [-73.975, 40.400]];
/* "NJ" | "NY" | null — geometry only. A routing hint like the outlines (the county layers decide what a point is in). */
export function njnyStateAt(lat, lng) {
  const nj = inNewJerseyEnvelope(lat, lng), ny = inNewYorkEnvelope(lat, lng);
  if (nj && ny) return inRing(NJ_NEAR_NY, lng, lat) ? "NJ" : "NY";
  return nj ? "NJ" : ny ? "NY" : null;
}
export const isNjNyState = (state) => state === "NJ" || state === "NY";

/* ── Municipal names ─────────────────────────────────────────────────────────────────────────────────────────────────── */
export const MUNICIPAL_TYPES = ["Borough", "Township", "City", "Town", "Village"];
const TYPE_RE = /\s+(Borough|Township|City|Town|Village)$/i;
const properType = (t) => { const w = String(t || "").trim().toLowerCase(); return MUNICIPAL_TYPES.find((m) => m.toLowerCase() === w) || null; };

/* NJOGIS's `NAME` is typed for boroughs and townships ("Fort Lee Borough") but not for cities / towns ("Newark", "Phillipsburg"),
 * and its GNIS_NAME has two wrong rows (Princeton carries no type; City of Orange Township reads "Township of City of Orange"), so the
 * internal name is built from the base name and MUN_TYPE, with the two legal names that do not follow the pattern pinned here. */
const NJ_NAME_EXCEPTIONS = {
  "City of Orange Township": "City of Orange Township",
};
/* The one internal name for a municipal feature. `cfg` is a source's `municipal` block: { baseField, typeField | typeConst }. */
export function municipalName(cfg, attrs) {
  if (!cfg) return null;
  const raw = attrs ? attrs[cfg.baseField] : null;
  if (raw == null || String(raw).trim() === "") return null;
  const type = properType(cfg.typeConst != null ? cfg.typeConst : attrs[cfg.typeField]);
  const named = String(raw).trim();
  if (NJ_NAME_EXCEPTIONS[named]) return NJ_NAME_EXCEPTIONS[named];
  if (!type) return named;
  const base = named.replace(TYPE_RE, "").trim() || named;
  return `${base} ${type}`;
}

/* Display forms that are not "<Type> of <Name>": New York City is one government named that way, the City of Orange Township is
 * the legal name as written, and Princeton's 2013 merger left a single "Municipality of Princeton". */
const DISPLAY_EXCEPTIONS = {
  "New York City": "New York City",
  "City of Orange Township": "City of Orange Township",
  "Princeton Borough": "Municipality of Princeton",
};
export function municipalDisplayName(name) {
  const s = String(name == null ? "" : name).trim();
  if (!s) return s;
  if (DISPLAY_EXCEPTIONS[s]) return DISPLAY_EXCEPTIONS[s];
  const m = s.match(TYPE_RE);
  if (!m) return s;
  const base = s.slice(0, m.index).trim();
  const type = properType(m[1]);
  return base && type ? `${type} of ${base}` : s;
}
/* Which kind of government a name is — drives reading order (village before the town that holds it) and nothing else. */
export const municipalType = (name) => { const m = String(name || "").match(TYPE_RE); return m ? properType(m[1]) : null; };
const MUNI_RANK = { Village: 0, City: 1, Borough: 2, Township: 3, Town: 4 };
/* Reading order for a NY chain: village → city → town. (NJ answers one municipality, so this is a no-op there.) */
export const sortMunicipalNames = (names) =>
  [...names].sort((a, b) => (MUNI_RANK[municipalType(a)] ?? 9) - (MUNI_RANK[municipalType(b)] ?? 9));

export const isNewYorkCity = (names = []) => (names || []).some((n) => String(n) === "New York City");

/* ── Counties ────────────────────────────────────────────────────────────────────────────────────────────────────────── */
/* NYS publishes "St Lawrence"; the county's name is "St. Lawrence". Display only — applied where a name is printed. */
export const NY_COUNTY_DISPLAY = { "St Lawrence": "St. Lawrence" };
/* New York City's five boroughs are each a county (NYS `NYC = 'Y'`). Keyed by the county name the layer publishes. */
export const NYC_BOROUGH_BY_COUNTY = { "New York": "Manhattan", Kings: "Brooklyn", Queens: "Queens", Bronx: "Bronx", Richmond: "Staten Island" };
export const nycBoroughOf = (county) => NYC_BOROUGH_BY_COUNTY[String(county || "").replace(/\s+county$/i, "").trim()] || null;

/* ── Words ───────────────────────────────────────────────────────────────────────────────────────────────────────────── */
export const NJ_MUNICIPAL_NOTE =
  "New Jersey has no unincorporated land — every acre is in a municipality, and the municipality (not the county) is the zoning and site-plan authority.";
export const NY_MUNICIPAL_NOTE =
  "New York has no land outside a town or city. A village's own board approves zoning and site plans for land inside it; otherwise the town or city does. The county is not the zoning authority.";
export const NJ_JURISDICTION_SOURCE_NAME = "NJOGIS (county + municipal boundaries)";
export const NY_JURISDICTION_SOURCE_NAME = "NYS ITS Geospatial Services (county, city, town + village boundaries)";

/* The "not available in New Jersey / New York yet" carrier for a Texas-only rule — the NJ / NY counterpart of the Georgia and California
 * carriers. A hard, named state, never a number: the detention engine models Texas rate-method criteria, and a New York site in
 * Montgomery County (there is one) must never be read as Montgomery County, Texas. Kept HERE (small, on the boot path) because the
 * guard must hold with every GIS endpoint down. */
export const NJNY_NOT_WIRED_FLAGS = ["newjersey-not-wired", "newyork-not-wired"];
export const NJNY_DETENTION_HEADLINE = { NJ: "Detention criteria not yet available in New Jersey", NY: "Detention criteria not yet available in New York" };
export const NJNY_DETENTION_DETAIL = {
  NJ: "Planyr's detention engine models Texas rate-method criteria. New Jersey sets stormwater requirements through the NJDEP Stormwater " +
    "Management Rules, applied by each municipality and county, so there is no honest way to convert a Texas number. Nothing is shown " +
    "rather than something wrong. Size detention with your engineer against the reviewing municipality's ordinance.",
  NY: "Planyr's detention engine models Texas rate-method criteria. New York sets stormwater requirements through the DEC's stormwater " +
    "permit and design manual, applied by each town, village and city (New York City has its own rules), so there is no honest way to " +
    "convert a Texas number. Nothing is shown rather than something wrong. Size detention with your engineer against the reviewing " +
    "municipality's requirements.",
};
