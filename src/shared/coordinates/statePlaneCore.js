/* statePlaneCore — the LEAN half of the state-plane engine (NEW-1 STATE-PLANE-AUDIT, B2478960): the zone registry, the three
 * projections, units, the coarse POINT resolver and the site-local frame. It carries NO county table, so a caller that only has a
 * point (overlay placement, screening distances) does not pay for 2,600 county names on the Site route's boot path — the table
 * rides `statePlane.js` and `statePlaneCounties.js`, which only county-aware callers (deed alignment, scale factor) import.
 * `statePlane.js` re-exports everything here, so existing importers are unchanged. */
/* NEW-3 — MULTI-ZONE STATE PLANE. The projection resolves from WHERE THE SITE IS, not from a
 * module-level constant.
 *
 * WHY. Until now the shared coordinate spine was one hardcoded zone: EPSG:2278, NAD83 / Texas
 * South Central (US survey feet) — correct for Houston/Katy and wrong everywhere else. Colorado
 * splits the nine target counties across TWO zones, so "the project grid" can no longer be a
 * constant:
 *
 *     Colorado NORTH   EPSG:2231   Larimer · Weld · Boulder · Adams · Broomfield
 *     Colorado CENTRAL EPSG:2232   Denver · Arapahoe · Jefferson · El Paso
 *
 * BROOMFIELD IS A DECISION, NOT A LOOKUP. C.R.S. 38-52-101 assigns Colorado's counties to zones,
 * but Broomfield is not named in it: the statute predates the county, which was carved out of
 * Adams, Boulder, Jefferson and Weld in 2001 as a consolidated city-and-county. Three of those
 * four parents are NORTH zone (Adams, Boulder, Weld); only the small Jefferson slice is Central.
 * Independently, Broomfield's OWN parcel service publishes its geometry in EPSG:2876 — NAD83(HARN)
 * / Colorado North (ftUS) — i.e. the county's own GIS already works in North. So Broomfield is
 * assigned NORTH, and the assignment carries `decided:true` + `decisionNote` so every surface that
 * shows a zone can show WHY rather than implying the statute settled it. See docs/incidents/COLORADO-AUDIT.md.
 *
 * ⛔ TEXAS IS UNCHANGED, AND THAT IS PROVEN, NOT ASSERTED. This module's generic Lambert Conformal
 * Conic is the SAME formulas in the SAME operation order as the hardcoded EPSG:2278 implementation
 * in ./index.js, so the Texas zone reproduces it BIT-FOR-BIT (===, not "close"). That equality is a
 * test (`test/statePlane.test.js`), and the NEW-1 golden master independently pins the numbers
 * ./index.js emits. index.js keeps its own implementation: the shared Texas path was not refactored.
 *
 * SCOPE. Read-only screening use, exactly like the existing spine — the Site Planner still draws in
 * its own per-site feet frame (workspaces/site-planner/lib/mapLock.js), which is anchored ground
 * scale at the site origin. Nothing here changes drawn geometry.
 *
 * Pure. No DOM, no network, Node-testable.
 */

import { GEN_ZONES } from "./statePlaneZones.js";

/* NEW-1 (STATE-PLANE-AUDIT) — EVERY NAD83 SPCS ZONE, ALL 50 STATES. The three hand-written zones below (TX South Central,
 * CO North, CO Central) are UNCHANGED and still win over the generated table; the other 118 zones come from
 * ./statePlaneZones.js` + `statePlaneCounties.js, which scripts/gen-state-plane-zones.py reads out of the EPSG database (never typed from memory).
 * Three projections are implemented here, all validated against PROJ to well under 0.01 ft (test/statePlaneAllZones.test.js):
 *   • Lambert Conformal Conic (2SP) — the original engine, byte-for-byte unchanged for the three original zones;
 *   • Transverse Mercator — Karney's n⁶ series (the same series PROJ uses), accurate to nanometres inside a zone;
 *   • Hotine Oblique Mercator variant A (EPSG 9812) — Alaska zone 1 only.
 * UNITS: a zone's grid is in ITS legislated foot (`unit`: "us-ft" | "ft" (international) | "m"); projectToZone/zoneToProject speak
 * that unit. Everything that treats the grid as the app's US-survey-foot plane converts with `unitInUsFt(zone)`.
 * NEVER FALL BACK TO TEXAS: where no zone resolves the answer is null (or, for overlay placement, an explicit site-local frame). */
const US_FT_M = 1200 / 3937;          // 1 US survey foot in metres (exact)
const INTL_FT_M = 0.3048;
const UNIT_M = { "us-ft": US_FT_M, ft: INTL_FT_M, m: 1 };
const D2R = Math.PI / 180, R2D = 180 / Math.PI;

// NAD83 / GRS80 ellipsoid — the datum every zone below is on.
const GRS80_A = 6378137.0;
const GRS80_F = 1 / 298.257222101;
const E2 = GRS80_F * (2 - GRS80_F);
const ECC = Math.sqrt(E2);

const lccM = (lat) => Math.cos(lat) / Math.sqrt(1 - E2 * Math.sin(lat) ** 2);
const lccT = (lat) => Math.tan(Math.PI / 4 - lat / 2) /
  ((1 - ECC * Math.sin(lat)) / (1 + ECC * Math.sin(lat))) ** (ECC / 2);

/* ---------------------------------------------------------------------------
 * The zone registry.
 *
 * `falseEastingM`/`falseNorthingM` are stated in METRES for Texas because that is exactly how the
 * existing EPSG:2278 implementation states them (600000 / 4000000), and restating them in feet
 * would perturb the arithmetic. Colorado's ftUS zones are stated in FEET, which is how EPSG
 * defines 2231/2232 exactly (3,000,000 and 1,000,000 ftUS); the engine converts.
 * ------------------------------------------------------------------------- */
export const SP_ZONES = {
  tx_sc: {
    id: "tx_sc", epsg: 2278, state: "TX",
    name: "NAD83 / Texas South Central (ftUS)",
    short: "TX South Central",
    unit: "us-ft",
    lat0: 27.83333333333333, lon0: -99.0, lat1: 28.38333333333333, lat2: 30.28333333333333,
    falseEastingM: 600000.0, falseNorthingM: 4000000.0,
    note: "The app's original project grid — the zone every existing Texas site uses.",
  },
  co_north: {
    id: "co_north", epsg: 2231, state: "CO",
    name: "NAD83 / Colorado North (ftUS)",
    short: "CO North",
    unit: "us-ft",
    // C.R.S. 38-52-101(1): standard parallels 39°43' and 40°47', origin 39°20' N / 105°30' W.
    lat0: 39.33333333333333, lon0: -105.5, lat1: 39.71666666666667, lat2: 40.78333333333333,
    falseEastingFt: 3000000.0, falseNorthingFt: 1000000.0,
  },
  co_central: {
    id: "co_central", epsg: 2232, state: "CO",
    name: "NAD83 / Colorado Central (ftUS)",
    short: "CO Central",
    unit: "us-ft",
    // C.R.S. 38-52-101(2): standard parallels 38°27' and 39°45', origin 37°50' N / 105°30' W.
    lat0: 37.83333333333333, lon0: -105.5, lat1: 38.45, lat2: 39.75,
    falseEastingFt: 3000000.0, falseNorthingFt: 1000000.0,
  },
};

/* The generated zones. Hand-written ids above win; a test pins their constants to EPSG's. */
for (const [id, g] of Object.entries(GEN_ZONES)) {
  if (SP_ZONES[id]) continue;
  const qualifier = id.slice(g.state.length + 1).split("_").filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
  SP_ZONES[id] = {
    ...g, id,
    name: `NAD83 / ${g.label}${g.unit === "us-ft" ? " (ftUS)" : g.unit === "ft" ? " (ft)" : ""}`,
    short: qualifier ? `${g.state} ${qualifier}` : g.state,
    falseEastingM: g.feM, falseNorthingM: g.fnM,
  };
}

/* Coarse zone envelopes, used ONLY when no county is known (a raw lat/lon with no identify yet).
 *
 * DELIBERATELY COARSE, AND THE RESULT SAYS SO (`coarse:true`). Colorado's zone boundaries follow
 * COUNTY LINES, not parallels, and along the Front Range those lines interleave: Jefferson
 * (CENTRAL) reaches north to 39.91, while Boulder and Broomfield (NORTH) reach south to 39.89.
 * No latitude split can separate them. So this is a genuine last resort — a county answer always
 * wins, and a caller showing a coarse answer should show that it is one.
 *
 * These two LEGACY envelopes are asked FIRST so the Houston / Front Range answers are exactly what they were. Every other zone
 * is then found from its EPSG area-of-use box (`GEN_ZONES[id].bounds`); see zoneForPoint. */
const ZONE_EXTENTS = [
  // North/Central split taken at the Adams south / Arapahoe north line (~39.74). The overlap
  // band above it is the interleave described above.
  { zone: "co_north", latMin: 39.74, latMax: 41.05, lonMin: -109.1, lonMax: -102.0 },
  { zone: "co_central", latMin: 36.9, latMax: 39.74, lonMin: -109.1, lonMax: -102.0 },
  // Texas South Central — the app's existing service area (Houston MSA and its reach).
  { zone: "tx_sc", latMin: 27.0, latMax: 31.2, lonMin: -99.8, lonMax: -93.5 },
];

/* States served by exactly one zone: the state alone settles it (no county needed). DC rides Maryland's zone (NGS). */
const STATE_ALIAS = { DC: "MD" };
export const stateCode = (s) => { const u = String(s || "").trim().toUpperCase(); return STATE_ALIAS[u] || u; };
const ZONES_OF_STATE = {};
for (const z of Object.values(SP_ZONES)) (ZONES_OF_STATE[z.state] = ZONES_OF_STATE[z.state] || []).push(z.id);
export const SINGLE_ZONE_STATE = Object.fromEntries(Object.entries(ZONES_OF_STATE).filter(([, v]) => v.length === 1).map(([k, v]) => [k, v[0]]));
// Louisiana Offshore is registered but never resolves from a county / point (it is federal water, not a parish); Alaska resolves by
// position; Hawaii by island.
const OFFSHORE = new Set(["la_offshore"]);
export const WA_GRANT_SPLIT_LAT = 47.5;  // "Grant north / south of approximately 47°30'N" — EPSG area text

export const withZone = (id, extra) => ({ ...SP_ZONES[id], decided: false, decisionNote: null, ...extra });

/* Alaska is NOT county-bounded: zones 2–9 are 4°-wide meridian bands (the EPSG area text names the meridians), zone 1 is the
 * panhandle east of 141°W, zone 10 the Aleutians south of 54°30'N. Positional, exact at the statutory meridians. */
export function alaskaZoneId(lat, lon) {
  if (lon >= -141 && lon <= -129) return "ak_1";
  if (lat < 54.5 && (lon <= -164 || lon > 0)) return "ak_10";
  if (lon > 0) return null;  // west-hemisphere-crossing slivers north of 54°30' are zone 9 below; east longitudes there are ocean
  if (lon >= -144) return "ak_2";
  if (lon >= -148) return "ak_3";
  if (lon >= -152) return "ak_4";
  if (lon >= -156) return "ak_5";
  if (lon >= -160) return "ak_6";
  if (lon >= -164) return "ak_7";
  if (lon >= -168) return "ak_8";
  return "ak_9";
}

export function hawaiiZoneId(lat, lon) {
  for (const id of ["hi_1", "hi_2", "hi_3", "hi_4", "hi_5"]) {
    const b = GEN_ZONES[id].bounds;
    if (lat >= b[1] && lat <= b[3] && lon >= b[0] && lon <= b[2]) return id;
  }
  return null;
}

/* The zone for a bare point, when no county has been identified. Coarse by design and flagged `coarse:true`.
 * Order: the two legacy envelopes (Houston / Front Range, unchanged) → Alaska's meridian bands → each zone's EPSG area-of-use
 * box, the one the point sits DEEPEST inside winning where several contain it (`ambiguous:true` says more than one did; measured over the
 * 3,144 county centres: 89.7% the exact zone, 3.2% a neighbouring zone of the right state, 7.2% a neighbour state — docs/incidents/STATE-PLANE-AUDIT.md §5). Near a state line a
 * box can hold the neighbour's ground — that is exactly what `coarse` warns about; a county answer always beats it.
 * `state` (optional) restricts the search to that state's zones. */
export function zoneForPoint(lat, lon, state = null) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const st = state ? stateCode(state) : null;
  for (const e of ZONE_EXTENTS) {
    if (st && SP_ZONES[e.zone].state !== st) continue;
    if (lat >= e.latMin && lat <= e.latMax && lon >= e.lonMin && lon <= e.lonMax) {
      return { ...SP_ZONES[e.zone], decided: false, decisionNote: null, via: "extent", coarse: true };
    }
  }
  const cands = [];
  for (const z of Object.values(SP_ZONES)) {
    if (OFFSHORE.has(z.id) || (st && z.state !== st)) continue;
    const b = GEN_ZONES[z.id].bounds;
    if (lat >= b[1] && lat <= b[3] && lon >= b[0] && lon <= b[2]) {
      // how far INTO its box the point sits (0 = centre, 1 = on the edge): a point near a zone's edge is likelier its neighbour's
      const depth = Math.max(Math.abs(lon - (b[0] + b[2]) / 2) / ((b[2] - b[0]) / 2 || 1), Math.abs(lat - (b[1] + b[3]) / 2) / ((b[3] - b[1]) / 2 || 1));
      cands.push({ z, area: depth });
    }
  }
  if (!cands.length) return null;
  cands.sort((a, b) => a.area - b.area);
  return { ...cands[0].z, decided: false, decisionNote: null, via: "extent", coarse: true, ambiguous: cands.length > 1 || undefined };
}

/* A SITE-LOCAL frame: a transverse Mercator centred on an anchor point, scale 1 at the anchor. This is what a caller that MUST
 * have some projection (overlay placement) uses when no zone resolves — explicit, labelled `local:true`, and never a Texas grid.
 * Ground-true at the anchor; it has no state-plane meaning, so a caller shows "zone unknown". */
export function localFrameZone(lat, lon) {
  return { id: `local`, local: true, state: null, epsg: null, name: "Site-local transverse Mercator", short: "local grid",
    unit: "us-ft", proj: "tm", lat0: lat, lon0: lon, k0: 1, falseEastingM: 0, falseNorthingM: 0, via: "local" };
}

/* Feet-per-grid-unit for callers that treat the grid as US survey feet (overlay placement): 1 for a ftUS zone, ≈1.000002 for an
 * international-foot zone, 3.2808… for a metre zone. */
export const unitInUsFt = (zone) => (zone.unit === "us-ft" ? 1 : UNIT_M[zone.unit] / US_FT_M);

/* ---------------------------------------------------------------------------------------------------------------------
 * PROJECTION MATH. Each zone is reduced once to a constants record (`cone`), keyed on its id (the site-local frame is built
 * per call). `forwardM`/`inverseM` work in METRES; projectToZone/zoneToProject convert to and from the zone's grid unit.
 * The LCC arm is the original expression-for-expression code, so the three original zones are bit-identical to before.
 * ------------------------------------------------------------------------------------------------------------------ */
const CONE = new Map();
function cone(zone) {
  const z = typeof zone === "string" ? SP_ZONES[zone] : zone;
  if (!z) throw new Error("statePlane: unknown zone");
  const hit = z.local ? null : CONE.get(z.id);
  if (hit) return hit;
  const proj = z.proj || "lcc";
  const LAT0 = z.lat0 * D2R, LON0 = z.lon0 * D2R;
  const FE_M = z.falseEastingM != null ? z.falseEastingM : z.falseEastingFt * US_FT_M;
  const FN_M = z.falseNorthingM != null ? z.falseNorthingM : z.falseNorthingFt * US_FT_M;
  const UNIT = UNIT_M[z.unit];
  let c;
  if (proj === "lcc") {
    const LAT1 = z.lat1 * D2R, LAT2 = z.lat2 * D2R;
    const _m1 = lccM(LAT1), _m2 = lccM(LAT2);
    const _t0 = lccT(LAT0), _t1 = lccT(LAT1), _t2 = lccT(LAT2);
    const n = (Math.log(_m1) - Math.log(_m2)) / (Math.log(_t1) - Math.log(_t2));
    const F = _m1 / (n * _t1 ** n);
    const R0 = GRS80_A * F * _t0 ** n;
    c = { proj, z, LAT0, LON0, FE_M, FN_M, UNIT, n, F, R0 };
  } else if (proj === "tm") {
    c = tmConstants(z, LAT0, LON0, FE_M, FN_M, UNIT);
  } else if (proj === "hom") {
    c = homConstants(z, LAT0, LON0, FE_M, FN_M, UNIT);
  } else {
    throw new Error(`statePlane: unsupported projection ${proj}`);
  }
  if (!z.local) CONE.set(z.id, c);
  return c;
}

/* --- Transverse Mercator: Karney (2011) n⁶ series, the same series PROJ's `etmerc` uses. ------------------------------- */
const TM_N = GRS80_F / (2 - GRS80_F);
const poly = (cs, n) => cs.reduce((acc, k, i) => acc + k * n ** (i + 1), 0);
const TM_ALPHA = [
  [1 / 2, -2 / 3, 5 / 16, 41 / 180, -127 / 288, 7891 / 37800],
  [0, 13 / 48, -3 / 5, 557 / 1440, 281 / 630, -1983433 / 1935360],
  [0, 0, 61 / 240, -103 / 140, 15061 / 26880, 167603 / 181440],
  [0, 0, 0, 49561 / 161280, -179 / 168, 6601661 / 7257600],
  [0, 0, 0, 0, 34729 / 80640, -3418889 / 1995840],
  [0, 0, 0, 0, 0, 212378941 / 319334400],
].map((cs) => poly(cs, TM_N));
const TM_BETA = [
  [1 / 2, -2 / 3, 37 / 96, -1 / 360, -81 / 512, 96199 / 604800],
  [0, 1 / 48, 1 / 15, -437 / 1440, 46 / 105, -1118711 / 3870720],
  [0, 0, 17 / 480, -37 / 840, -209 / 4480, 5569 / 90720],
  [0, 0, 0, 4397 / 161280, -11 / 504, -830251 / 7257600],
  [0, 0, 0, 0, 4583 / 161280, -108847 / 3991680],
  [0, 0, 0, 0, 0, 20648693 / 638668800],
].map((cs) => poly(cs, TM_N));
const TM_A = (GRS80_A / (1 + TM_N)) * (1 + TM_N ** 2 / 4 + TM_N ** 4 / 64 + TM_N ** 6 / 256);
// tan(conformal latitude) of geodetic latitude φ.
const confTan = (phi) => Math.sinh(Math.asinh(Math.tan(phi)) - ECC * Math.atanh(ECC * Math.sin(phi)));
// geodetic latitude from tan(conformal latitude): fixed-point on the isometric latitude (e² ≈ 0.0067 per pass).
function latFromConfTan(tau) {
  const psi = Math.asinh(tau);
  let phi = Math.atan(tau);
  for (let i = 0; i < 12; i++) phi = Math.atan(Math.sinh(psi + ECC * Math.atanh(ECC * Math.sin(phi))));
  return phi;
}
function tmConstants(z, LAT0, LON0, FE_M, FN_M, UNIT) {
  const xi0p = Math.atan(confTan(LAT0));
  let xi0 = xi0p;
  for (let j = 1; j <= 6; j++) xi0 += TM_ALPHA[j - 1] * Math.sin(2 * j * xi0p);
  return { proj: "tm", z, LAT0, LON0, FE_M, FN_M, UNIT, K0: z.k0, XI0: xi0 };
}
function tmForward(c, lat, lon) {
  const dl = dLon(lon, c.LON0);
  const tau = confTan(lat);
  const xip = Math.atan2(tau, Math.cos(dl));
  const etap = Math.asinh(Math.sin(dl) / Math.hypot(tau, Math.cos(dl)));
  let xi = xip, eta = etap;
  for (let j = 1; j <= 6; j++) {
    xi += TM_ALPHA[j - 1] * Math.sin(2 * j * xip) * Math.cosh(2 * j * etap);
    eta += TM_ALPHA[j - 1] * Math.cos(2 * j * xip) * Math.sinh(2 * j * etap);
  }
  return { E: c.FE_M + c.K0 * TM_A * eta, N: c.FN_M + c.K0 * TM_A * (xi - c.XI0) };
}
function tmInverse(c, E, N) {
  const eta = (E - c.FE_M) / (c.K0 * TM_A);
  const xi = (N - c.FN_M) / (c.K0 * TM_A) + c.XI0;
  let xip = xi, etap = eta;
  for (let j = 1; j <= 6; j++) {
    xip -= TM_BETA[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    etap -= TM_BETA[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  const lon = c.LON0 + Math.atan2(Math.sinh(etap), Math.cos(xip));
  const tau = Math.sin(xip) / Math.hypot(Math.sinh(etap), Math.cos(xip));
  return { lat: latFromConfTan(tau), lon };
}

/* --- Hotine Oblique Mercator, variant A (EPSG method 9812; EPSG Guidance Note 7-2). Alaska zone 1 only. -------------- */
function homConstants(z, LAT0, LON0, FE_M, FN_M, UNIT) {
  const AZ = z.alpha * D2R, GAMMA_C = z.gamma * D2R, KC = z.k0;
  const sinp = Math.sin(LAT0), cosp = Math.cos(LAT0);
  const B = Math.sqrt(1 + (E2 * cosp ** 4) / (1 - E2));
  const A = (GRS80_A * B * KC * Math.sqrt(1 - E2)) / (1 - E2 * sinp ** 2);
  const t0 = lccT(LAT0);
  const D0 = (B * Math.sqrt(1 - E2)) / (cosp * Math.sqrt(1 - E2 * sinp ** 2));
  const D = Math.max(D0, 1);
  const Fv = D + Math.sqrt(D * D - 1) * Math.sign(LAT0);
  const H = Fv * t0 ** B;
  const G = (Fv - 1 / Fv) / 2;
  const GAMMA0 = Math.asin(Math.sin(AZ) / D);
  const LAMBDA0 = LON0 - Math.asin(G * Math.tan(GAMMA0)) / B;
  return { proj: "hom", z, LAT0, LON0, FE_M, FN_M, UNIT, B, A, H, GAMMA0, LAMBDA0, GAMMA_C };
}
function homForward(c, lat, lon) {
  const t = lccT(lat);
  const Q = c.H / t ** c.B;
  const S = (Q - 1 / Q) / 2, T = (Q + 1 / Q) / 2;
  const dl = c.B * (lon - c.LAMBDA0);
  const V = Math.sin(dl);
  const U = (-V * Math.cos(c.GAMMA0) + S * Math.sin(c.GAMMA0)) / T;
  const v = (c.A * Math.log((1 - U) / (1 + U))) / (2 * c.B);
  const u = (c.A * Math.atan2(S * Math.cos(c.GAMMA0) + V * Math.sin(c.GAMMA0), Math.cos(dl))) / c.B;
  return {
    E: v * Math.cos(c.GAMMA_C) + u * Math.sin(c.GAMMA_C) + c.FE_M,
    N: u * Math.cos(c.GAMMA_C) - v * Math.sin(c.GAMMA_C) + c.FN_M,
  };
}
function homInverse(c, E, N) {
  const dE = E - c.FE_M, dN = N - c.FN_M;
  const vp = dE * Math.cos(c.GAMMA_C) - dN * Math.sin(c.GAMMA_C);
  const up = dN * Math.cos(c.GAMMA_C) + dE * Math.sin(c.GAMMA_C);
  const Qp = Math.exp((-c.B * vp) / c.A);
  const Sp = (Qp - 1 / Qp) / 2, Tp = (Qp + 1 / Qp) / 2;
  const Vp = Math.sin((c.B * up) / c.A);
  const Up = (Vp * Math.cos(c.GAMMA0) + Sp * Math.sin(c.GAMMA0)) / Tp;
  const tp = (c.H / Math.sqrt((1 + Up) / (1 - Up))) ** (1 / c.B);
  const lon = c.LAMBDA0 - Math.atan2(Sp * Math.cos(c.GAMMA0) - Vp * Math.sin(c.GAMMA0), Math.cos((c.B * up) / c.A)) / c.B;
  let lat = Math.PI / 2 - 2 * Math.atan(tp);
  for (let i = 0; i < 12; i++) {
    const es = ECC * Math.sin(lat);
    lat = Math.PI / 2 - 2 * Math.atan(tp * ((1 - es) / (1 + es)) ** (ECC / 2));
  }
  return { lat, lon };
}

// Longitude difference wrapped into [-π, π] — only Alaska zone 10 (the Aleutians cross the antimeridian) ever triggers it, so every
// other zone's arithmetic is untouched.
const dLon = (lonR, lon0R) => { let d = lonR - lon0R; if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI; return d; };
const wrapLon = (deg) => (deg > 180 ? deg - 360 : deg < -180 ? deg + 360 : deg);

/* WGS84 (lat, lon degrees) → the zone's grid {x, y} in the ZONE'S OWN unit (z.unit: us-ft, ft or m). */
export function projectToZone(zone, lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error("statePlane: projectToZone needs finite lat, lon");
  const c = cone(zone);
  const latR = lat * D2R, lonR = lon * D2R;
  if (c.proj === "lcc") {
    const r = GRS80_A * c.F * lccT(latR) ** c.n;
    const theta = c.n * dLon(lonR, c.LON0);
    const E_m = c.FE_M + r * Math.sin(theta);
    const N_m = c.FN_M + c.R0 - r * Math.cos(theta);
    return { x: E_m / c.UNIT, y: N_m / c.UNIT };
  }
  const p = c.proj === "tm" ? tmForward(c, latR, lonR) : homForward(c, latR, lonR);
  return { x: p.E / c.UNIT, y: p.N / c.UNIT };
}

/* The zone's grid {x, y} in its own unit → WGS84 {lat, lon} in degrees. */
export function zoneToProject(zone, { x, y } = {}) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("statePlane: zoneToProject needs finite {x, y}");
  const c = cone(zone);
  const E_m = x * c.UNIT, N_m = y * c.UNIT;
  if (c.proj === "lcc") {
    const dE = E_m - c.FE_M, dN = c.R0 - (N_m - c.FN_M);
    const rho = Math.sign(c.n) * Math.sqrt(dE * dE + dN * dN);
    const t = (rho / (GRS80_A * c.F)) ** (1 / c.n);
    const lon = Math.atan2(dE, dN) / c.n + c.LON0;
    let lat = Math.PI / 2 - 2 * Math.atan(t);
    for (let i = 0; i < 8; i++) {
      const es = ECC * Math.sin(lat);
      lat = Math.PI / 2 - 2 * Math.atan(t * ((1 - es) / (1 + es)) ** (ECC / 2));
    }
    return { lat: lat * R2D, lon: wrapLon(lon * R2D) };
  }
  const r = c.proj === "tm" ? tmInverse(c, E_m, N_m) : homInverse(c, E_m, N_m);
  return { lat: r.lat * R2D, lon: r.lon * R2D };
}

/* NEW-4 input — the GRID SCALE FACTOR of a zone at a latitude (and, for the non-Lambert zones, a longitude — the scale of a
 * transverse / oblique Mercator varies with distance from its central line, not with latitude alone).
 *
 * On an LCC the grid scale is a function of latitude alone: exactly 1 on each standard parallel,
 * slightly under 1 between them, slightly over outside. k = n·F·t(φ)^n / m(φ), which is 1 at φ1 by
 * construction (F is defined as m1/(n·t1^n)). TM / HOM zones: k = |d grid / d ground| along the meridian, by a symmetric difference
 * of the projection itself (conformal, so the direction does not matter). Pure, dimensionless. */
export function gridScaleFactor(zone, lat, lon = null) {
  if (!Number.isFinite(lat)) return null;
  const c = cone(zone);
  const latR = lat * D2R;
  if (c.proj === "lcc") {
    const m = lccM(latR);
    if (!(m > 0)) return null;                       // undefined at the poles
    return (c.n * c.F * lccT(latR) ** c.n) / m;
  }
  const lo = Number.isFinite(lon) ? lon : c.z.lon0;
  const h = 1e-6, lonR = lo * D2R;
  const f = c.proj === "tm" ? tmForward : homForward;
  const a = f(c, latR - h, lonR), b = f(c, latR + h, lonR);
  const sin2 = Math.sin(latR) ** 2;
  const M = (GRS80_A * (1 - E2)) / (1 - E2 * sin2) ** 1.5;     // meridian radius of curvature
  return Math.hypot(b.E - a.E, b.N - a.N) / (2 * h * M);
}

/* Grid-north-vs-true-north convergence at a point, in degrees. POSITIVE = the zone's State Plane
 * grid north lies EAST of true north. Moved here from the site-planner workspace's `deedAlign.js`
 * (B1134752) — this is a plain geodetic fact about a zone at a point, the exact same category as
 * `gridScaleFactor` right above it, and it has a SECOND consumer now (the site-plan-overlay
 * placement math, `shared/overlay/overlayPlacement.js`) that lives in `shared/` and must not
 * import a workspace-scoped module. `deedAlign.js` re-exports this unchanged so its own callers
 * (SitePlanner.jsx's deed-align flow) are untouched.
 *
 * Returns **null** — an honest unknown, never 0 — for non-finite input and for ground outside
 * every modelled zone. 0 is a real answer ("you are on the central meridian"), so a caller must
 * be able to tell the two apart before rotating anything by it. */
export function gridConvergenceDegIn(lat, lon, zone) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !zone) return null;
  const p = projectToZone(zone, lat, lon);
  const up = zoneToProject(zone, { x: p.x, y: p.y + 1000 }); // a point 1000 ft due GRID-north
  const dLat = up.lat - lat;
  const dLon = (up.lon - lon) * Math.cos((lat * Math.PI) / 180); // east component, in degrees
  return (Math.atan2(dLon, dLat) * 180) / Math.PI; // angle of grid-north east of true north
}

export const zoneById = (id) => SP_ZONES[id] || null;
export const ZONE_IDS = Object.keys(SP_ZONES);
