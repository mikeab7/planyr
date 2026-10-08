/* Georgia jurisdiction facts — the pure, network-free half (NEW-1, the Colorado `countyCo` precedent).
 *
 * WHAT GEORGIA IS, for the jurisdiction stack:
 *   • Cities and counties only. Georgia municipalities have NO extraterritorial jurisdiction: outside
 *     a city's limits the COUNTY is the zoning and permitting authority. So there is no "ETJ" role in
 *     Georgia — not "ETJ not mapped", not "no ETJ layer yet", nothing. The badge says the county governs.
 *   • Four (plus two small) consolidated city-county governments, where "city + unincorporated"
 *     is the WRONG reading — the city and the county are one government and the whole county is inside it.
 *
 * ⛔ THE ENVELOPE IS A ROUTING HINT, NEVER AN ANSWER. It is deliberately generous, so it also holds parts
 * of SC (Augusta's north bank), AL (Columbus's west bank), FL, NC and TN. Whether a point is IN Georgia is
 * decided by point-in-polygon against the DCA county layer; an envelope hit that the polygon layer does not
 * confirm is "not Georgia" (see `identifyJurisdiction`'s `notInGeorgia`). Texas / Colorado envelopes do not
 * overlap this one (TX max lon -93.3, GA min lon -85.7), so a TX or CO site resolves exactly as before.
 *
 * Pure. No React, no DOM, no network. Node-testable. */

/* [latMin, lonMin, latMax, lonMax] — same tuple order as `siteRegion.STATE_ENVELOPES`. */
export const GA_ENVELOPE_BOX = [30.3, -85.7, 35.1, -80.7];
export const GA_ENVELOPE = { latMin: 30.3, latMax: 35.1, lonMin: -85.7, lonMax: -80.7 };

/* Consolidated city-county governments, keyed by county name (as DCA's `NAME` column spells it).
 * `city` is the spelling of the DCA Municipal_Boundaries `cityname` for the same government
 * (Columbus's polygon is published as plain "Columbus"), and `label` is what the badge prints.
 * Measured live 2026-09-30: Athens → "Athens-Clarke County", Augusta → "Augusta-Richmond County",
 * Macon → "Macon-Bibb County", Columbus → "Columbus". */
export const GA_CONSOLIDATED = {
  Clarke: { city: "Athens-Clarke County", label: "Athens-Clarke County" },
  Richmond: { city: "Augusta-Richmond County", label: "Augusta-Richmond County" },
  Muscogee: { city: "Columbus", label: "Columbus-Muscogee County" },
  Bibb: { city: "Macon-Bibb County", label: "Macon-Bibb County" },
  Chattahoochee: { city: "Cusseta-Chattahoochee County", label: "Cusseta-Chattahoochee County" },
  Quitman: { city: "Georgetown-Quitman County", label: "Georgetown-Quitman County" },
};

const norm = (s) => String(s == null ? "" : s).trim().toLowerCase().replace(/\s+county$/, "").replace(/[.,']/g, "").replace(/\s+/g, " ");

export const inGeorgiaEnvelope = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng)
  && lat >= GA_ENVELOPE.latMin && lat <= GA_ENVELOPE.latMax && lng >= GA_ENVELOPE.lonMin && lng <= GA_ENVELOPE.lonMax;

/* The consolidated government a jurisdiction answer sits in, or null. `counties` is the county name list
 * from the identify ("Clarke"); `cities` is the city list. A county is consolidated on its own — every
 * point in Clarke County is inside Athens-Clarke — so the county alone decides; the city list is only
 * consulted to make sure we never claim consolidation for a county we do not recognise. Pure. */
export function georgiaConsolidatedFor(counties = [], _cities = []) {
  for (const c of counties || []) {
    const key = Object.keys(GA_CONSOLIDATED).find((k) => norm(k) === norm(c));
    if (key) return { county: key, ...GA_CONSOLIDATED[key] };
  }
  return null;
}

/* The one sentence the badge tooltip carries for Georgia. No "ETJ" in it on purpose — Georgia has no such
 * thing, and naming it (even to deny it) would put the word on a Georgia site. */
export const GA_COUNTY_GOVERNS_NOTE =
  "Georgia cities have no authority beyond their limits — outside city limits the county is the zoning and permitting authority.";
export const GA_CONSOLIDATED_NOTE =
  "Consolidated city-county government: the city and the county are one government, and the whole county is inside it.";

/* The "not available in Georgia yet" carrier for a Texas-only rule. The Georgia counterpart of
 * `coloradoRegions`' detention guard — a hard, named state, never a number. Kept HERE (small, on the boot
 * path) because the guard must hold with every GIS endpoint down. */
export const GA_DETENTION_HEADLINE = "Detention criteria not yet available in Georgia";
export const GA_DETENTION_DETAIL =
  "Planyr's detention engine models Texas rate-method criteria. Georgia counties and cities each adopt their own " +
  "stormwater manual (many follow the Georgia Stormwater Management Manual), so there is no honest way to convert " +
  "a Texas number. Nothing is shown rather than something wrong. Size detention with your engineer against the " +
  "reviewing jurisdiction's manual.";

/* The badge hover's "Source:" line. It used to be one hard-coded Texas string on every site (found live on a Georgia site:
 * "TxDOT / TxGIO / county & city ETJ publishers" — Texas publishers, and the word ETJ, on a state that has neither). */
export const GA_JURISDICTION_SOURCE_NAME = "Georgia DCA (county + municipal boundaries)";
export const TX_JURISDICTION_SOURCE_NAME = "TxDOT / TxGIO / county & city ETJ publishers";
export const jurisdictionSourceName = (state) => (state === "GA" ? GA_JURISDICTION_SOURCE_NAME : TX_JURISDICTION_SOURCE_NAME);
