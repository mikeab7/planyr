/* Tennessee jurisdiction facts — the pure, network-free half (NEW-1, the Georgia / New Jersey precedent).
 *
 * WHAT TENNESSEE IS, for the jurisdiction stack:
 *   • Cities and counties. Tennessee has NO ETJ (owner rule: the word never appears on a Tennessee site, not even to deny it): there is no
 *     band of "city-governed" land outside a city's limits the way Texas has. Outside every city, the COUNTY is the local government
 *     ("Unincorporated Rutherford County").
 *     The nearest Tennessee idea is the county GROWTH PLAN (Public Chapter 1101 of 1998, T.C.A. title 6, ch. 58):
 *     urban growth boundaries, planned growth areas and rural areas, which decide where a city may annex. Those are
 *     published county by county (when at all) and are NOT mapped here — see docs/TENNESSEE-JURISDICTION.md. A growth
 *     boundary is therefore never printed on the badge, and neither is the word "ETJ".
 *   • THREE consolidated city-county ("Metropolitan") governments, where "city + unincorporated" is the wrong reading
 *     because the city and the county are one government: Nashville-Davidson (1963; Belle Meade, Berry Hill, Forest Hills,
 *     Oak Hill and parts of Goodlettsville and Ridgetop kept their own charters inside it), Lynchburg-Moore County (1988)
 *     and Hartsville-Trousdale County (2001). Davidson, Moore and Trousdale have no unincorporated land.
 *
 * ⛔ THE ENVELOPE IS A ROUTING HINT, NEVER AN ANSWER. It is a box, so it also holds KY, VA, NC, GA, AL, MS, AR and MO ground.
 * Whether a point is IN Tennessee is decided by point-in-polygon against the state's county layer; an envelope hit the
 * county layer does not confirm is "not Tennessee" (see `identifyJurisdiction`'s `notInTennessee`). The Tennessee box
 * overlaps Georgia's (the Chattanooga end of the line), so a point in both asks BOTH counties layers.
 *
 * Pure. No React, no DOM, no network. Node-testable. */

/* [latMin, lonMin, latMax, lonMax] — same tuple order as `siteRegion.STATE_ENVELOPES`. */
export const TN_ENVELOPE_BOX = [34.95, -90.4, 36.72, -81.55];
export const TN_ENVELOPE = { latMin: 34.95, latMax: 36.72, lonMin: -90.4, lonMax: -81.55 };

/* The state outline, [lng, lat] — hand-simplified from the real border, nudged a few km outward on the Mississippi and
 * Kentucky/Virginia sides so a shoreline or border-edge site is never "unknown". It decides which STATE'S RULES may apply
 * (`siteState`), never which county or city a point is in. Its southern edge is the Georgia / Alabama / Mississippi line
 * EXACTLY (Georgia's outline in `siteRegion.js` meets it there), so the two never overlap. Clockwise from the north-west. */
export const TN_OUTLINE = [
  [-89.62, 36.58], [-88.1, 36.58], [-87.4, 36.72], [-86.5, 36.7], [-85.0, 36.66], [-83.9, 36.64], [-83.68, 36.65],
  [-82.5, 36.66], [-81.68, 36.68], [-81.66, 36.58], [-82.05, 36.15], [-82.62, 36.01], [-83.1, 35.78],
  [-83.5, 35.56], [-84.02, 35.43], [-84.32, 35.0], [-84.32, 34.988], [-85.605, 34.985], [-88.2, 34.995],
  [-90.31, 34.995], [-90.34, 35.03], [-90.12, 35.12], [-90.14, 35.32], [-90.0, 35.7], [-89.78, 36.0],
  [-89.6, 36.25], [-89.46, 36.4], [-89.45, 36.5],
];

const inPolygon = (lng, lat, poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
};

export const inTennesseeEnvelope = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng)
  && lat >= TN_ENVELOPE.latMin && lat <= TN_ENVELOPE.latMax && lng >= TN_ENVELOPE.lonMin && lng <= TN_ENVELOPE.lonMax;

/* True when the point is inside the state outline (state-rules scoping, not a jurisdiction answer). */
export const inTennesseeOutline = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && inPolygon(lng, lat, TN_OUTLINE);

/* The three consolidated governments, keyed by county name (as the state's county layer spells it). `city` is the name of
 * the city polygon the state publishes for the same government (Nashville's is the "balance" — it excludes the satellite
 * cities); `label` is what the badge prints. A county is consolidated on its own: every point in Moore County is inside
 * the Lynchburg-Moore government whether or not it is inside the Lynchburg polygon. */
export const TN_CONSOLIDATED = {
  Davidson: { county: "Davidson", city: "Nashville", label: "Metro Nashville-Davidson County" },
  Moore: { county: "Moore", city: "Lynchburg", label: "Metro Lynchburg-Moore County" },
  Trousdale: { county: "Trousdale", city: "Hartsville", label: "Metro Hartsville-Trousdale County" },
};

const norm = (s) => String(s == null ? "" : s).trim().toLowerCase().replace(/\s+county$/, "").replace(/[.,']/g, "").replace(/\s+/g, " ");

/* The consolidated government a jurisdiction answer sits in, or null. Pure. */
export function tennesseeConsolidatedFor(counties = []) {
  for (const c of counties || []) {
    const key = Object.keys(TN_CONSOLIDATED).find((k) => norm(k) === norm(c));
    if (key) return { ...TN_CONSOLIDATED[key] };
  }
  return null;
}

/* Memphis and unincorporated Shelby County are one planning jurisdiction: both governing bodies adopted the Unified
 * Development Code in August 2010 as the zoning code AND subdivision regulations for the City of Memphis and the
 * unincorporated county, administered through the Memphis and Shelby County Office of Planning and Development. Shelby's
 * other municipalities (Germantown, Collierville, Bartlett, Arlington, Lakeland, Millington) are NOT under it.
 * Source: Shelby County Board of Commissioners / Memphis City Council staff reports (Aug 2010 adoption; "serves as the
 * Zoning Code and the Subdivision Regulations for all properties within the City of Memphis and the unincorporated areas
 * of Shelby County"). Shown only where it changes who reviews a plan: a Memphis or unincorporated-Shelby site. */
export const SHELBY_UDC_NOTE =
  "Memphis and unincorporated Shelby County share one zoning and subdivision code (the Unified Development Code, adopted 2010), " +
  "reviewed through the joint Memphis and Shelby County Office of Planning and Development.";
export function shelbyUdcApplies(counties = [], governingCities = []) {
  if (!(counties || []).some((c) => norm(c) === "shelby")) return false;
  const cities = governingCities || [];
  return cities.length === 0 || cities.some((c) => norm(c) === "memphis");
}

/* The one sentence the badge tooltip carries for Tennessee. Says what is true (the county governs outside city limits; no
 * ETJ) and what Planyr does not map (county growth plans). */
export const TN_COUNTY_GOVERNS_NOTE =
  "Outside city limits the county is the local government. County growth plans (urban growth boundaries) decide where a city " +
  "may annex; Planyr does not map them yet.";
export const TN_CONSOLIDATED_NOTE =
  "Metropolitan government: the city and the county are one government, and the whole county is inside it (satellite cities such as " +
  "Belle Meade keep their own charters).";

/* The "not available in Tennessee yet" carrier for a Texas-only rule — the Tennessee counterpart of Georgia's, a hard,
 * named state and never a number. Kept HERE (small, on the boot path) because the guard must hold with every endpoint down. */
export const TN_DETENTION_HEADLINE = "Detention criteria not yet available in Tennessee";
export const TN_DETENTION_DETAIL =
  "Planyr's detention engine models Texas rate-method criteria. Tennessee cities and counties each adopt their own stormwater " +
  "rules under the state's MS4 permits (many follow TDEC's guidance), so there is no honest way to convert a Texas number. " +
  "Nothing is shown rather than something wrong. Size detention with your engineer against the reviewing jurisdiction's manual.";
export const TN_NOT_WIRED_FLAG = "tennessee-not-wired";

export const TN_JURISDICTION_SOURCE_NAME = "State of Tennessee (county + city boundaries) / TDOT Road Segment";

/* TDOT's Road Segment layer publishes the government control of each road segment as text. The labels match the Texas
 * road-authority line ("State (TxDOT)" → "State (TDOT)"; "County"; "City"). Anything else is named for what it is, and
 * an unrecognised value is an honest "Unknown" — never a guess. Pure. */
export function tnRoadAuthority(govtCtrl, admSys) {
  const g = String(govtCtrl == null ? "" : govtCtrl).trim().toLowerCase();
  const a = String(admSys == null ? "" : admSys).trim().toLowerCase();
  if (/^state highway/.test(g)) return { code: null, label: "State (TDOT)", onSystem: true, basis: "govt_ctrl" };
  if (/^county/.test(g)) return { code: null, label: "County", onSystem: false, basis: "govt_ctrl" };
  if (/^municipal/.test(g)) return { code: null, label: "City", onSystem: false, basis: "govt_ctrl" };
  if (/state park|other state agency/.test(g)) return { code: null, label: "Other state agency", onSystem: false, basis: "govt_ctrl" };
  if (/local park|other local/.test(g)) return { code: null, label: "Other local agency", onSystem: false, basis: "govt_ctrl" };
  if (/federal|forest|national park|fish and wildlife|bureau of land|corps of engineers|tva|air force|navy|army/.test(g)) return { code: null, label: "Federal", onSystem: false, basis: "govt_ctrl" };
  if (/private/.test(g) || /^private/.test(a)) return { code: null, label: "Private", onSystem: false, basis: "govt_ctrl" };
  if (/railroad/.test(g)) return { code: null, label: "Railroad", onSystem: false, basis: "govt_ctrl" };
  return { code: null, label: "Unknown", onSystem: null, basis: "unknown" };
}
