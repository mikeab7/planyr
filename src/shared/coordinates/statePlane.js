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
 * shows a zone can show WHY rather than implying the statute settled it. See docs/COLORADO-AUDIT.md.
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

const US_FT_M = 1200 / 3937;          // 1 US survey foot in metres (exact)
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

/* Per-county zone assignment for the nine Colorado counties Planyr targets, plus the Texas
 * counties it already serves. `decided:true` marks an assignment this project MADE rather than
 * read off the statute — today that is Broomfield alone, and it carries its reasoning. */
export const COUNTY_ZONE = {
  // Texas (unchanged — every existing site).
  "TX:harris": { zone: "tx_sc" },
  "TX:fortbend": { zone: "tx_sc" },
  "TX:chambers": { zone: "tx_sc" },
  "TX:waller": { zone: "tx_sc" },
  "TX:montgomery": { zone: "tx_sc" },
  // Colorado NORTH (C.R.S. 38-52-101).
  "CO:larimer": { zone: "co_north" },
  "CO:weld": { zone: "co_north" },
  "CO:boulder": { zone: "co_north" },
  "CO:adams": { zone: "co_north" },
  // Colorado CENTRAL (C.R.S. 38-52-101).
  "CO:denver": { zone: "co_central" },
  "CO:arapahoe": { zone: "co_central" },
  "CO:jefferson": { zone: "co_central" },
  "CO:elpaso": { zone: "co_central" },
  // The one DECIDED assignment.
  "CO:broomfield": {
    zone: "co_north",
    decided: true,
    decisionNote:
      "Broomfield is not named in C.R.S. 38-52-101 — the statute predates the county, which was " +
      "created in 2001 from parts of Adams, Boulder, Jefferson and Weld. Planyr assigns it to " +
      "Colorado NORTH: three of its four parent counties are North zone, and Broomfield's own " +
      "published parcel service uses EPSG:2876 (NAD83(HARN) / Colorado North, ftUS). Confirm " +
      "against the survey before using a Broomfield state-plane coordinate for anything but screening.",
  },
};

/* Coarse zone envelopes, used ONLY when no county is known (a raw lat/lon with no identify yet).
 *
 * DELIBERATELY COARSE, AND THE RESULT SAYS SO (`coarse:true`). Colorado's zone boundaries follow
 * COUNTY LINES, not parallels, and along the Front Range those lines interleave: Jefferson
 * (CENTRAL) reaches north to 39.91, while Boulder and Broomfield (NORTH) reach south to 39.89.
 * No latitude split can separate them. So this is a genuine last resort — a county answer always
 * wins, and a caller showing a coarse answer should show that it is one. */
const ZONE_EXTENTS = [
  // North/Central split taken at the Adams south / Arapahoe north line (~39.74). The overlap
  // band above it is the interleave described above.
  { zone: "co_north", latMin: 39.74, latMax: 41.05, lonMin: -109.1, lonMax: -102.0 },
  { zone: "co_central", latMin: 36.9, latMax: 39.74, lonMin: -109.1, lonMax: -102.0 },
  // Texas South Central — the app's existing service area (Houston MSA and its reach).
  { zone: "tx_sc", latMin: 27.0, latMax: 31.2, lonMin: -99.8, lonMax: -93.5 },
];

/* County names arrive from several sources in several shapes — "Adams", "ADAMS COUNTY",
 * "City and County of Denver", "El Paso County". Colorado's two consolidated city-and-counties
 * (Denver, Broomfield) are the reason the connective words are stripped rather than just the
 * trailing "County": none of the counties this project serves has city/and/county/of in its
 * actual name, so removing those tokens is safe and makes every spelling land on one key. */
const slugCounty = (c) =>
  String(c || "").toLowerCase().replace(/\b(city|and|county|of)\b/g, "").replace(/[^a-z]/g, "");

/* The zone for a county, when the app knows one. `state` is "TX"/"CO" (case-insensitive).
 * Returns null for a county this project has not assigned — an HONEST null, never a guess:
 * a caller must render "state plane zone not established here", not a plausible wrong zone. */
export function zoneForCounty(state, county) {
  const key = `${String(state || "").toUpperCase()}:${slugCounty(county)}`;
  const rec = COUNTY_ZONE[key];
  if (!rec) return null;
  return { ...SP_ZONES[rec.zone], decided: rec.decided === true, decisionNote: rec.decisionNote || null, via: "county" };
}

/* The zone for a bare point, when no county has been identified. Coarse by design (see
 * ZONE_EXTENTS) and null outside every modeled envelope — Planyr covers two states, not fifty. */
export function zoneForPoint(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  for (const e of ZONE_EXTENTS) {
    if (lat >= e.latMin && lat <= e.latMax && lon >= e.lonMin && lon <= e.lonMax) {
      return { ...SP_ZONES[e.zone], decided: false, decisionNote: null, via: "extent", coarse: true };
    }
  }
  return null;
}

/* THE resolver every consumer should call: county first (authoritative — Colorado's zone
 * boundaries ARE county lines), point envelope second, honest null last. */
export function resolveZone({ state = null, county = null, lat = null, lon = null } = {}) {
  const byCounty = state && county ? zoneForCounty(state, county) : null;
  if (byCounty) return byCounty;
  // A county with no assignment is a KNOWN gap, not an excuse to fall through to a coarse
  // envelope that would answer confidently for a county we deliberately never assigned.
  if (state && county) {
    const inState = zoneForPoint(lat, lon);
    if (inState && inState.state === String(state).toUpperCase()) return { ...inState, unassignedCounty: String(county) };
    return null;
  }
  return zoneForPoint(lat, lon);
}

/* Per-zone cone constants, computed once. Same expressions, same order as the hardcoded
 * EPSG:2278 implementation in ./index.js — that is what makes the Texas zone bit-identical. */
const CONE = new Map();
function cone(zone) {
  const z = typeof zone === "string" ? SP_ZONES[zone] : zone;
  if (!z) throw new Error("statePlane: unknown zone");
  const hit = CONE.get(z.id);
  if (hit) return hit;
  const LAT0 = z.lat0 * D2R, LON0 = z.lon0 * D2R, LAT1 = z.lat1 * D2R, LAT2 = z.lat2 * D2R;
  const FE_M = z.falseEastingM != null ? z.falseEastingM : z.falseEastingFt * US_FT_M;
  const FN_M = z.falseNorthingM != null ? z.falseNorthingM : z.falseNorthingFt * US_FT_M;
  const _m1 = lccM(LAT1), _m2 = lccM(LAT2);
  const _t0 = lccT(LAT0), _t1 = lccT(LAT1), _t2 = lccT(LAT2);
  const n = (Math.log(_m1) - Math.log(_m2)) / (Math.log(_t1) - Math.log(_t2));
  const F = _m1 / (n * _t1 ** n);
  const R0 = GRS80_A * F * _t0 ** n;
  const c = { z, LAT0, LON0, FE_M, FN_M, n, F, R0 };
  CONE.set(z.id, c);
  return c;
}

/* WGS84 (lat, lon degrees) → the zone's grid {x, y} in US survey feet. */
export function projectToZone(zone, lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error("statePlane: projectToZone needs finite lat, lon");
  const c = cone(zone);
  const latR = lat * D2R, lonR = lon * D2R;
  const r = GRS80_A * c.F * lccT(latR) ** c.n;
  const theta = c.n * (lonR - c.LON0);
  const E_m = c.FE_M + r * Math.sin(theta);
  const N_m = c.FN_M + c.R0 - r * Math.cos(theta);
  return { x: E_m / US_FT_M, y: N_m / US_FT_M };
}

/* The zone's grid {x, y} in US survey feet → WGS84 {lat, lon} in degrees. */
export function zoneToProject(zone, { x, y } = {}) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("statePlane: zoneToProject needs finite {x, y}");
  const c = cone(zone);
  const E_m = x * US_FT_M, N_m = y * US_FT_M;
  const dE = E_m - c.FE_M, dN = c.R0 - (N_m - c.FN_M);
  const rho = Math.sign(c.n) * Math.sqrt(dE * dE + dN * dN);
  const t = (rho / (GRS80_A * c.F)) ** (1 / c.n);
  const lon = Math.atan2(dE, dN) / c.n + c.LON0;
  let lat = Math.PI / 2 - 2 * Math.atan(t);
  for (let i = 0; i < 8; i++) {
    const es = ECC * Math.sin(lat);
    lat = Math.PI / 2 - 2 * Math.atan(t * ((1 - es) / (1 + es)) ** (ECC / 2));
  }
  return { lat: lat * R2D, lon: lon * R2D };
}

/* NEW-4 input — the GRID SCALE FACTOR of a Lambert zone at a latitude.
 *
 * On an LCC the grid scale is a function of latitude alone: exactly 1 on each standard parallel,
 * slightly under 1 between them, slightly over outside. k = n·F·t(φ)^n / m(φ), which is 1 at φ1 by
 * construction (F is defined as m1/(n·t1^n)). Pure, dimensionless. */
export function gridScaleFactor(zone, lat) {
  if (!Number.isFinite(lat)) return null;
  const c = cone(zone);
  const latR = lat * D2R;
  const m = lccM(latR);
  if (!(m > 0)) return null;                       // undefined at the poles
  return (c.n * c.F * lccT(latR) ** c.n) / m;
}

export const zoneById = (id) => SP_ZONES[id] || null;
export const ZONE_IDS = Object.keys(SP_ZONES);
