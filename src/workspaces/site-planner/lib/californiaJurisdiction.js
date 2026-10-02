/* California jurisdiction facts — the pure, network-free half (NEW-1, the Georgia `georgiaJurisdiction.js` precedent).
 *
 * WHAT CALIFORNIA IS, for the jurisdiction stack:
 *   • Cities and counties only. California cities have NO extraterritorial jurisdiction: outside a city's
 *     limits the COUNTY is the zoning and permitting authority. So there is no "ETJ" role in California —
 *     not "ETJ not mapped", not "no ETJ layer yet", nothing. The badge says the county governs.
 *   • ONE consolidated city-county: San Francisco ("City and County of San Francisco") — the whole county
 *     is the city, so "city + unincorporated" is the WRONG reading.
 *   • Spheres of influence (set by each county's LAFCO — Local Agency Formation Commission) exist, but they
 *     are PLANNING boundaries that say which city may annex a place someday. They confer no regulatory
 *     authority today, so they are deliberately not carried and never presented as jurisdiction.
 *
 * ⛔ THE ENVELOPE IS A ROUTING HINT, NEVER AN ANSWER. It is a bounding box, so it also holds Nevada (Reno, Las
 * Vegas's edge), Oregon's southern strip, Arizona's Colorado-River bank (Yuma, Lake Havasu) and Baja California
 * (Tijuana, Mexicali). Whether a point is IN California is decided by point-in-polygon against the CDT county
 * layer; an envelope hit that the polygon layer does not confirm is "not California" (see
 * `identifyJurisdiction`'s `notInCalifornia`). Texas / Colorado / Georgia envelopes do not overlap this one
 * (CA max lon -114.1, CO min lon -109.2), so a TX, CO or GA site resolves exactly as before.
 *
 * Pure. No React, no DOM, no network. Node-testable. */

/* [latMin, lonMin, latMax, lonMax] — same tuple order as `siteRegion.STATE_ENVELOPES`. */
export const CA_ENVELOPE_BOX = [32.5, -124.5, 42.0, -114.1];
export const CA_ENVELOPE = { latMin: 32.5, latMax: 42.0, lonMin: -124.5, lonMax: -114.1 };

/* ⛔ WHY CALIFORNIA'S ENVELOPE IS A POLYGON AND GEORGIA'S IS A BOX. California's east side is a long DIAGONAL (Lake
 * Tahoe to the Colorado River), so its bounding box swallows Reno, all of Las Vegas / Henderson / Pahrump and Laughlin —
 * Nevada markets Planyr has a parcel source for. A box-only envelope sent a Las Vegas site to the California county
 * service (a wasted request: the very defect B1551618 fixed) and printed "Detention criteria not yet available in
 * CALIFORNIA" on a Nevada site. This hand-traced outline (lat, lng; deliberately a few km generous along the Colorado
 * River, which is why Yuma-side points can fall inside) keeps the box as the cheap pre-filter and refines it. STILL
 * only a routing hint — the CDT county polygon decides "is this California" — and still fail-closed. */
export const CA_OUTLINE = [
  [42.05, -124.6], [42.05, -120.0], [39.0, -120.0], [35.1, -114.6], [34.3, -114.05],
  [33.7, -114.45], [33.0, -114.5], [32.7, -114.75], [32.45, -114.75], [32.45, -124.6],
];
const inPoly = (poly, lat, lng) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i], [yj, xj] = poly[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

/* The one consolidated city-county, keyed by county name (as the CDT layer's `CDT_NAME_SHORT` spells it).
 * `city` is the spelling of the city layer's name for the same government, `label` is what the badge prints. */
export const CA_CONSOLIDATED = {
  "San Francisco": { city: "San Francisco", label: "City and County of San Francisco" },
};

/* The CDT city layer's `CDT_NAME_SHORT` carries three LEGAL names; these are the names people use.
 * Display only — applied where a name is printed, never where one is matched. */
export const CA_CITY_DISPLAY = {
  "San Buenaventura": "Ventura",
  "El Paso de Robles": "Paso Robles",
  "Saint Helena": "St. Helena",
};
export const caCityDisplayName = (name) => CA_CITY_DISPLAY[String(name == null ? "" : name).trim()] || name;

const norm = (s) => String(s == null ? "" : s).trim().toLowerCase().replace(/\s+county$/, "").replace(/[.,']/g, "").replace(/\s+/g, " ");

export const inCaliforniaEnvelope = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng)
  && lat >= CA_ENVELOPE.latMin && lat <= CA_ENVELOPE.latMax && lng >= CA_ENVELOPE.lonMin && lng <= CA_ENVELOPE.lonMax
  && inPoly(CA_OUTLINE, lat, lng);

/* The consolidated government a jurisdiction answer sits in, or null. A county is consolidated on its own —
 * every point in San Francisco County is inside the City and County — so the county alone decides. Pure. */
export function californiaConsolidatedFor(counties = [], _cities = []) {
  for (const c of counties || []) {
    const key = Object.keys(CA_CONSOLIDATED).find((k) => norm(k) === norm(c));
    if (key) return { county: key, ...CA_CONSOLIDATED[key] };
  }
  return null;
}

/* The tooltip sentences for California. No "ETJ" in them on purpose — California has no such thing, and
 * naming it (even to deny it) would put the word on a California site. */
export const CA_COUNTY_GOVERNS_NOTE =
  "California cities have no authority beyond their limits — outside city limits the county is the zoning and permitting authority.";
export const CA_CONSOLIDATED_NOTE =
  "Consolidated city-county government: the city and the county are one government, and the whole county is inside it.";

/* The "not available in California yet" carrier for a Texas-only rule — the California counterpart of the
 * Georgia carrier. A hard, named state, never a number. Kept HERE (small, on the boot path) because the guard
 * must hold with every GIS endpoint down. */
export const CA_DETENTION_HEADLINE = "Detention criteria not yet available in California";
export const CA_DETENTION_DETAIL =
  "Planyr's detention engine models Texas rate-method criteria. California counties and cities each adopt their own " +
  "stormwater requirements (many through a regional MS4 permit and a county flood-control district), so there is no honest way to convert " +
  "a Texas number. Nothing is shown rather than something wrong. Size detention with your engineer against the " +
  "reviewing jurisdiction's manual.";
