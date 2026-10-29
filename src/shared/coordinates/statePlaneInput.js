/* statePlaneInput — THE UNIT-EXPLICIT BOUNDARY for a state plane coordinate that a PERSON typed, pasted or imported (NEW-1, B2528672).
 *
 * WHY THIS FILE EXISTS. A zone's grid is in ITS legislated unit (statePlaneCore.js `zone.unit`): the metre in Alabama, Missouri, Hawaii and
 * Alaska, the international foot in AZ MI MT ND OR SC, the US survey foot elsewhere. `zoneToProject(zone, {x, y})` speaks THAT unit and
 * nothing else — hand it a value a surveyor wrote in US survey feet for a metre zone and it reads feet as metres, landing the point
 * ~3.28× too far from the zone's grid origin (hundreds of km out), with no error. Surveyors in those states routinely write plats and
 * deeds in US survey feet even where the state's grid is defined in metres. Audit (docs/incidents/STATE-PLANE-AUDIT.md §11) found NO path
 * in the app today that takes such a value — every grid number is app-generated from lat/lon and rescaled by `unitInUsFt` — so this file is
 * the door a FUTURE path (deed grid calls, CSV/KML/CAD point import, a .prj on an overlay) must use. `test/stateplaneInputUnit.test.js`
 * fails the build if anything else in src/ calls `zoneToProject` / `gridToProject` on a value it did not generate itself.
 *
 * THE RULES, in order of preference (owner: "never assume a unit silently"):
 *   1. The file's OWN declaration wins — `gridUnitFromPrj` reads the unit off a .prj / WKT (the projected CRS's own length unit).
 *   2. Otherwise `detectGridUnit` decodes the value under each candidate unit and keeps the ones that land near the site. One survivor is a
 *      confident answer; two, or none, is `ask:true` — the caller asks "US survey feet or metres?" with `unit` (US survey feet unless the
 *      zone is a statutory-international-foot zone) PRESELECTED, because that is what plats in these states usually use.
 *   3. `gridInputToLatLon` has NO default unit and throws without one.
 * Pure. No DOM, no network. Not imported by anything on a boot path (nothing imports it yet), so it costs no bundle. */
import { zoneToProject, UNIT_M } from "./statePlaneCore.js";

export const INPUT_UNITS = Object.freeze(Object.keys(UNIT_M));          // "us-ft" | "ft" | "m"
const isUnit = (u) => typeof u === "string" && Object.prototype.hasOwnProperty.call(UNIT_M, u);

/* The unit to PRESELECT when the person must be asked: US survey feet, except in a zone whose own statute is the international foot. */
export const preselectedFootUnit = (zone) => (zone && zone.unit === "ft" ? "ft" : "us-ft");

/* A grid coordinate the caller DECLARES to be in `unit`, converted to lat/lon through the zone. `unit` is REQUIRED — there is no default,
 * so a call site cannot forget it. The false easting/northing are part of the value, so the whole number is rescaled (x·f), not an offset. */
export function gridInputToLatLon(zone, xy, unit) {
  if (!isUnit(unit)) throw new Error(`statePlaneInput: a state plane coordinate needs an explicit unit (${INPUT_UNITS.join(" | ")}), got ${JSON.stringify(unit)}`);
  if (!zone) throw new Error("statePlaneInput: no zone to read the coordinate in");
  const { x, y } = xy || {};
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("statePlaneInput: needs finite {x, y}");
  const f = UNIT_M[unit] / UNIT_M[zone.unit];                              // input unit → the zone's own unit
  return zoneToProject(zone, { x: x * f, y: y * f });
}

const D2R = Math.PI / 180;
function kmBetween(a, b) {
  const dLat = (b.lat - a.lat) * D2R, dLon = (b.lon - a.lon) * D2R;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/* Which unit was this coordinate probably written in? `site` = {lat, lon}, anywhere on the site. Pure; never throws.
 *   { unit, confident:true,  ask:false }  — exactly one reading lands near the site (feet vs metres).
 *   { unit, confident:false, ask:true }   — it fits as both, or fits NEITHER (`fitsNeither`): ask the person; `unit` is the preselect.
 * US survey vs international feet differ by 2 ppm (a foot or so at these magnitudes), so they are ONE "feet" reading here and the zone's
 * own foot decides which; that residual is not detectable from position and is not pretended to be. */
export function detectGridUnit(zone, xy, site, { toleranceKm = 50 } = {}) {
  const pre = preselectedFootUnit(zone);
  const lat = site && Number(site.lat), lon = site && Number(site.lon);
  if (!zone || !xy || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { unit: pre, confident: false, ask: true, fitsNeither: false, reason: "no site location to test the value against — ask which unit it is in" };
  }
  const fits = (unit) => {
    try {
      const p = gridInputToLatLon(zone, xy, unit);
      return Number.isFinite(p.lat) && Number.isFinite(p.lon) && kmBetween(p, { lat, lon }) <= toleranceKm;
    } catch (_) { return false; }
  };
  const asMetres = fits("m"), asFeet = fits(pre);
  if (asMetres && !asFeet) return { unit: "m", confident: true, ask: false, fitsNeither: false, reason: "only a metre reading lands on the site" };
  if (asFeet && !asMetres) return { unit: pre, confident: true, ask: false, fitsNeither: false, reason: "only a feet reading lands on the site" };
  if (asFeet && asMetres) return { unit: pre, confident: false, ask: true, fitsNeither: false, reason: "the value lands on the site as feet AND as metres — ask" };
  return { unit: pre, confident: false, ask: true, fitsNeither: true, reason: `the value lands more than ${toleranceKm} km from the site as feet and as metres — wrong zone or a typo; ask, never convert silently` };
}

/* The grid unit a .prj / WKT declares for its PROJECTED CRS: the LAST length UNIT in the text (WKT1 closes PROJCS with its own UNIT after the
 * GEOGCS's angular one; WKT2 uses LENGTHUNIT). Classified by the metres-per-unit FACTOR, never the name ("Foot_US", "US survey foot",
 * "Foot_US" all differ by vendor). null = nothing declared or not recognisable — the caller then falls to detectGridUnit / asks. */
export function gridUnitFromPrj(text) {
  if (typeof text !== "string") return null;
  const hits = [...text.matchAll(/(?:LENGTH)?UNIT\s*\[\s*"[^"]*"\s*,\s*([0-9]*\.?[0-9]+(?:[eE][+-]?\d+)?)/gi)];
  if (!hits.length) return null;
  const factor = Number(hits[hits.length - 1][1]);
  if (!Number.isFinite(factor) || factor <= 0) return null;
  for (const u of INPUT_UNITS) if (Math.abs(factor - UNIT_M[u]) / UNIT_M[u] < 1e-7) return u;   // 2 ppm apart: 1e-7 separates ftUS from ft
  return null;
}
