/* Which STATE a site is in — the tiny synchronous half of the Colorado tier.
 *
 * WHY THIS IS ITS OWN MODULE (perf budget, 2026-07-29). `coloradoRegions.js` carries the regime
 * records, the CWCB standard and the capability matrix — and those are mostly PROSE. A Texas user
 * has no use for a byte of it, but importing `siteState` from there dragged the whole thing onto
 * the Site route's chunk and breached `bundle.siteRouteJsBytes` / `bundle.largestChunkBytes`. The
 * standing rule is that a feature which breaches a budget ships with a matching optimization, so
 * the Colorado copy is now loaded ON DEMAND (a dynamic import, only once a site resolves to CO —
 * the `lib/exportSheet.js` precedent) and this module is the piece that has to stay synchronous.
 *
 * It has to stay synchronous because it is what the GUARD keys off, and the guard must hold
 * even when nothing has loaded and every GIS endpoint is down — which is exactly when a site is
 * most likely to fall through to a default. Geometry only: no network, no prose, no registry.
 *
 * B2479568 amendment: it now names ALL 50 states + DC (`usStatesData.js`, ~41 KB, generated). That data is deliberately STATIC, not a
 * lazy chunk: a state answer that is null until a chunk lands would make "Ohio" flip to "OH" mid-session, and any rule keyed on a
 * positive answer would fire late. Paid for by simplifying coasts and non-rule borders hard (see scripts/build-us-states.mjs).
 *
 * Pure. Node-testable.
 */

import { njnyStateAt, NJ_OUTLINE, NY_OUTLINE } from "./njnyJurisdiction.js"; // NEW-1 (New Jersey + New York)
import { TN_OUTLINE } from "./tennesseeJurisdiction.js"; // NEW-1 (Tennessee)
import { US_STATES_ENCODED, US_STATES_SCALE } from "./usStatesData.js"; // NEW-1 (B2479568 amendment): the 50 states + DC

/* ROUTING BOXES — NOT USED BY `siteState` ANY MORE (B2479568 amendment, 2026-10-29). They are kept because the per-state jurisdiction
 * modules mirror them as their county-layer ROUTING hints (`georgiaJurisdiction.GA_ENVELOPE_BOX`, `californiaJurisdiction.CA_ENVELOPE_BOX`,
 * asserted equal by their tests) — "which state's county layer shall I ask", where over-asking is harmless. They were `siteState`'s
 * answer for TX / CO / GA / CA, and that was the defect: the Texas box holds Shreveport (LA), Roswell (NM) and Lawton (OK), Georgia's
 * reaches into SC / AL / TN, California's into Baja and Nevada — so a Shreveport site was offered every Texas-only layer. */
export const STATE_ENVELOPES = {
  TX: [25.5, -107.0, 36.8, -93.3],
  CO: [36.9, -109.2, 41.1, -101.9],
  GA: [30.3, -85.7, 35.1, -80.7],
  CA: [32.5, -124.5, 42.0, -114.1],
};

/* NEW-1 (FL/GA pipelines) — Florida and Georgia are POLYGONS, not boxes. These are hand-simplified outlines, [lng, lat], padded ~0.1°
 * out to sea so a shoreline site is never "unknown". Since B2479568 they are the SEAWARD-PAD fallback (a point on the real boundary
 * polygons answers from those first): they only decide a point the real polygons do not hold — a few km of water off the coast. */
export const STATE_POLYGONS = {
  FL: [
    [-87.6, 31.02], [-85.0, 31.02], [-84.88, 30.72], [-83.1, 30.63], [-82.23, 30.58], [-82.05, 30.36],
    [-81.4, 30.72], [-81.2, 29.9], [-80.4, 28.4], [-79.95, 26.8], [-79.95, 25.8], [-80.3, 25.1],
    [-80.4, 24.85], [-81.0, 24.4], [-81.95, 24.35], [-82.1, 24.6], [-81.9, 25.3], [-82.15, 26.0],
    [-82.4, 26.9], [-82.9, 27.6], [-82.85, 28.9], [-83.45, 29.45], [-84.05, 29.85], [-84.65, 29.6],
    [-85.45, 29.45], [-86.55, 30.15], [-87.5, 30.15],
  ],
  GA: [
    /* NEW-1 (Tennessee) — the northern edge is the Georgia–Tennessee line itself (34.985° at the Alabama corner, 34.988° at
     * Ducktown, 35.0° at the North Carolina corner), not the old 35.02° padding. Tennessee's outline (below) starts exactly where this
     * one ends, so the two never overlap. */
    [-85.65, 34.985], [-84.32, 34.988], [-83.1, 35.0], [-83.15, 34.5], [-82.85, 34.3], [-82.5, 33.9], [-82.15, 33.6],
    [-81.9, 33.45], [-81.65, 33.2], [-81.4, 32.8], [-81.1, 32.35], [-80.85, 32.3], [-80.7, 31.98], [-81.0, 31.45], [-81.35, 30.95],
    [-81.4, 30.7], [-82.05, 30.36], [-82.23, 30.58], [-83.1, 30.63], [-84.88, 30.72], [-85.0, 31.02],
    [-85.05, 31.6], [-85.15, 32.3], [-85.19, 32.87],
  ],
};

/* NJ / NY are registered here so the set of states `siteState` can return stays ONE declared list (the layer registry's state-coverage
 * guard reads these keys); the Hudson overlap between their outlines is settled by `njnyStateAt`'s border polygon. */
STATE_POLYGONS.TN = TN_OUTLINE;
STATE_POLYGONS.NJ = NJ_OUTLINE;
STATE_POLYGONS.NY = NY_OUTLINE;

/* Every code `siteState` can return: the 50 states and DC. */
export const US_STATE_CODES = Object.freeze([
  "AK", "AL", "AR", "AZ", "CA", "CO", "CT", "DC", "DE", "FL", "GA", "HI", "IA", "ID", "IL", "IN", "KS", "KY", "LA", "MA", "MD", "ME",
  "MI", "MN", "MO", "MS", "MT", "NC", "ND", "NE", "NH", "NJ", "NM", "NV", "NY", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX",
  "UT", "VA", "VT", "WA", "WI", "WV", "WY",
]);

/* HAND-TUNED OUTLINES (B2479568 amendment). Natural Earth 1:10m is good to about a kilometre, and a river border is where that shows: it
 * puts downtown Columbus GA in Alabama. A rule-bearing state must not lose a site that is genuinely inside it, so Texas and Colorado each
 * keep a polygon drawn a hair INSIDE their borders (rivers), and Florida / Georgia / Tennessee keep the outlines drawn to their state
 * lines. Within NE's error band (NE_BAND_DEG) of the real boundary they overrule the real set; beyond it they do not.
 * TEXAS_OUTLINE is hand-simplified [lng, lat], padded seaward on the coast; it was `siteChecks`' trust gate before it was this
 * (siteChecks re-exports it: the RRC verdicts still require it). */
export const TEXAS_OUTLINE = Object.freeze([
  [-103.04, 36.49], [-100.03, 36.49], [-100.03, 34.60], [-99.60, 34.40], [-99.20, 34.19], [-98.60, 34.13],
  [-98.10, 34.04], [-97.40, 33.80], [-96.80, 33.80], [-96.00, 33.67], [-95.30, 33.87], [-94.50, 33.67],
  [-94.07, 33.54], [-94.07, 31.99], [-93.90, 31.80], [-93.76, 31.45], [-93.62, 31.10], [-93.70, 30.75],
  [-93.70, 30.30], [-93.72, 30.05], [-93.82, 29.70], [-93.80, 29.55], [-94.45, 29.35], [-94.95, 29.15],
  [-95.35, 28.80], [-96.00, 28.45], [-96.55, 28.20], [-97.05, 27.80], [-97.30, 27.20], [-97.25, 26.60],
  [-97.15, 25.96], [-97.50, 25.87], [-97.65, 25.93], [-98.00, 26.05], [-98.26, 26.08], [-98.82, 26.36], [-99.02, 26.40],
  [-99.27, 26.88], [-99.53, 27.50], [-99.95, 27.90], [-100.30, 28.45], [-100.50, 28.71], [-100.90, 29.36], [-101.40, 29.75],
  [-101.55, 29.80], [-102.30, 29.88], [-102.70, 29.70], [-102.95, 29.15], [-103.15, 28.98], [-103.60, 29.17], [-103.78, 29.26],
  [-104.37, 29.56], [-104.70, 30.15], [-105.00, 30.65], [-105.85, 31.30], [-106.53, 31.77], [-106.62, 31.80], [-106.62, 32.00],
  [-103.05, 32.00],
]);


/* Colorado is a legal quadrangle (37°N–41°N, 109.05°W–102.05°W); drawn 0.01° inside its sides so a surveyed-line wobble can never put a
 * Colorado site outside it. */
const CO_SURE = [[-109.04, 37.01], [-102.06, 37.01], [-102.06, 40.99], [-109.04, 40.99]];

/* The plain names, for the words ("Not screened in Ohio"). */
export const US_STATE_NAMES = Object.freeze({
  AK: "Alaska", AL: "Alabama", AR: "Arkansas", AZ: "Arizona", CA: "California", CO: "Colorado", CT: "Connecticut", DC: "the District of Columbia",
  DE: "Delaware", FL: "Florida", GA: "Georgia", HI: "Hawaii", IA: "Iowa", ID: "Idaho", IL: "Illinois", IN: "Indiana", KS: "Kansas",
  KY: "Kentucky", LA: "Louisiana", MA: "Massachusetts", MD: "Maryland", ME: "Maine", MI: "Michigan", MN: "Minnesota", MO: "Missouri",
  MS: "Mississippi", MT: "Montana", NC: "North Carolina", ND: "North Dakota", NE: "Nebraska", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NV: "Nevada", NY: "New York", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island",
  SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VA: "Virginia", VT: "Vermont", WA: "Washington",
  WI: "Wisconsin", WV: "West Virginia", WY: "Wyoming",
});

function inPolygon(lng, lat, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

/* ── The real boundaries (decoded once, on first use) ─────────────────────────────────────────────────────────────────────────
 * Each ring is a flat Float64Array [lng, lat, lng, lat …] with its bounding box, so a point is tested only against the few rings whose
 * box holds it. Generated by scripts/build-us-states.mjs; the decoder mirrors its encoder. */
let _rings = null;
function usRings() {
  if (_rings) return _rings;
  const out = [];
  for (const part of US_STATES_ENCODED.split(";")) {
    const cut = part.indexOf(":");
    const st = part.slice(0, cut);
    for (const enc of part.slice(cut + 1).split("|")) {
      const nums = enc.split(",");
      const xy = new Float64Array(nums.length);
      let x = 0, y = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < nums.length; i += 2) {
        x += parseInt(nums[i], 36); y += parseInt(nums[i + 1], 36);
        const lng = x / US_STATES_SCALE, lat = y / US_STATES_SCALE;
        xy[i] = lng; xy[i + 1] = lat;
        if (lng < minX) minX = lng; if (lng > maxX) maxX = lng; if (lat < minY) minY = lat; if (lat > maxY) maxY = lat;
      }
      out.push({ st, xy, minX, maxX, minY, maxY });
    }
  }
  return (_rings = out);
}

function inRing(xy, lng, lat) {
  let inside = false;
  const n = xy.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const xi = xy[i], yi = xy[i + 1], xj = xy[j], yj = xy[j + 1];
    if (((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

/* The state whose real boundary holds the point, or null (open water, Canada, Mexico, anything outside the US). No padding. */
export function realStateAt(lat, lng) {
  for (const r of usRings()) {
    if (lng < r.minX || lng > r.maxX || lat < r.minY || lat > r.maxY) continue;
    if (inRing(r.xy, lng, lat)) return r.st;
  }
  return null;
}

/* The state whose boundary passes within `padDeg` of the point (nearest wins), or null. Distances are in degrees with the longitude
 * scaled by cos(lat), so a "degree" is the same ground distance both ways. */
function nearestStateWithin(lat, lng, padDeg) {
  const k = Math.cos((lat * Math.PI) / 180);
  let best = padDeg, bestSt = null;
  for (const r of usRings()) {
    if (lng < r.minX - padDeg / k || lng > r.maxX + padDeg / k || lat < r.minY - padDeg || lat > r.maxY + padDeg) continue;
    const xy = r.xy;
    for (let i = 0, j = xy.length - 2; i < xy.length; j = i, i += 2) {
      const ax = (xy[j] - lng) * k, ay = xy[j + 1] - lat, bx = (xy[i] - lng) * k, by = xy[i + 1] - lat;
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
      const d = Math.hypot(ax + t * dx, ay + t * dy);
      if (d < best) { best = d; bestSt = r.st; }
    }
  }
  return bestSt;
}
/* How far (degrees ≈ 6.6 km) a point off the real polygons may sit and still answer the state beside it: the coast is simplified
 * (0.04°) and a shoreline site must never read "unknown" — which, for a located point, hides every state-scoped layer. */
const SEAWARD_PAD_DEG = 0.06;

/* NE's error band (degrees, ~1.3 km): within it of the boundary of the real polygon that holds a point, the older hand-tuned FL / GA / TN
 * outlines (drawn to the state line itself, not to a 1:10m generalisation of it) may overrule the real set. Beyond it they may not —
 * the Georgia outline once reached into Bluffton SC, and the Texas one 8 km into Oklahoma, which no 1.3 km band forgives. */
const NE_BAND_DEG = 0.012;
function edgeDistanceDeg(xy, lat, lng) {
  const k = Math.cos((lat * Math.PI) / 180);
  let best = Infinity;
  for (let i = 0, j = xy.length - 2; i < xy.length; j = i, i += 2) {
    const ax = (xy[j] - lng) * k, ay = xy[j + 1] - lat, bx = (xy[i] - lng) * k, by = xy[i + 1] - lat;
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best) best = d;
  }
  return best;
}
function realRingAt(lat, lng) {
  for (const r of usRings()) {
    if (lng < r.minX || lng > r.maxX || lat < r.minY || lat > r.maxY) continue;
    if (inRing(r.xy, lng, lat)) return r;
  }
  return null;
}
/* The state a hand-tuned outline puts the point in, or null: Texas / Colorado (the hair-inside guards) and Florida / Georgia / Tennessee (the
 * outlines drawn to the state line; they share the GA–TN and GA–FL lines exactly, so order does not matter). */
function tunedOutlineState(la, lo) {
  if (inPolygon(lo, la, TEXAS_OUTLINE)) return "TX";
  if (inPolygon(lo, la, CO_SURE)) return "CO";
  for (const st of ["FL", "GA", "TN"]) if (inPolygon(lo, la, STATE_POLYGONS[st])) return st;
  return null;
}

/* "AL" … "WY" | "DC" | null — the state a point is in, for ALL 50 states and DC. Null only for a site with no coordinates (every legacy
 * saved plan) and for ground outside the US — and null behaves exactly as the app did before Colorado existed. The guard fires on a
 * POSITIVE answer, never on the absence of one.
 *
 * ⛔ ONE ANSWER FROM REAL BOUNDARIES, NOT BOXES (B2479568 amendment, owner 2026-10-29: "you need to check every state"). The old
 * answer was eight states, three of them boxes — Shreveport read "TX", North Augusta SC read "GA" — and every other state read null.
 * Order now:
 *   1. the real state polygon holding the point (the 50 + DC set, `usStatesData.js`) — except that inside its ~1.3 km error band the
 *      hand-tuned TX / CO / FL / GA / TN outlines overrule it, so a river border never costs a rule-bearing state a site that is
 *      genuinely inside it (Columbus GA, Chattanooga TN, the Red River);
 *   2. a point the polygons put in NJ or NY: the existing NJ/NY border settlement (`njnyStateAt`, the Hudson / Arthur Kill overlap) —
 *      kept exactly as it was;
 *   3. a point in NO polygon (a few km of water off a coast): the padded outlines above and the NJ / NY ones, so a shoreline site in
 *      those states answers as before; else the state whose boundary lies within SEAWARD_PAD_DEG; else null.
 * What changed is only the margin: the Texas box no longer holds Louisiana, New Mexico or Oklahoma ground, Georgia's no longer holds
 * the Carolinas, California's no longer holds Baja or Nevada, and the states the app had no region for now answer by name. */
export function siteState({ lat = null, lng = null, lon = null } = {}) {
  const la = Number(lat), lo = Number(lng != null ? lng : lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  const ring = realRingAt(la, lo);
  if (ring) {
    const real = ring.st;
    if (real === "NJ" || real === "NY") return njnyStateAt(la, lo) || real; // the Hudson settlement decides between the two
    const tuned = tunedOutlineState(la, lo);
    if (tuned && tuned !== real && edgeDistanceDeg(ring.xy, la, lo) <= NE_BAND_DEG) return tuned;
    return real;
  }
  const tuned = tunedOutlineState(la, lo);
  if (tuned) return tuned;
  const nn = njnyStateAt(la, lo);
  if (nn) return nn;
  return nearestStateWithin(la, lo, SEAWARD_PAD_DEG);
}

export const isColorado = (pt) => siteState(pt) === "CO";
export const isGeorgia = (pt) => siteState(pt) === "GA";
export const isTennessee = (pt) => siteState(pt) === "TN"; // NEW-1 (Tennessee)
export const isCalifornia = (pt) => siteState(pt) === "CA";
export const isNewJersey = (pt) => siteState(pt) === "NJ";
export const isNewYork = (pt) => siteState(pt) === "NY";
