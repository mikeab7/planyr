/* Site Analysis — the TRUSTED-VERDICT core (NEW-1, 2026-10-05, owner-approved redesign).
 *
 * THE RULE THIS FILE EXISTS TO KEEP: a verdict (a colour, an amount, a "None") is only ever issued
 * for a check whose source we trust AT THE SITE'S LOCATION. Everything else is a map layer the user
 * can turn on — the panel makes no claim about it. Pure: no network, no React. The fetch half is
 * `siteChecksRun.js`; the words are composed here so they are unit-testable.
 *
 * Four things live here, each with one home:
 *   1. TRUSTED_CHECKS — the declared registry: which check may issue a verdict in which regions.
 *   2. CHECK_THRESHOLDS — every radius / tolerance in ONE place (state them in the PR, tune here).
 *   3. The region gate (`siteRegions` / `isTrustedFor`) — geometry only, strictest reading on a
 *      straddle, so it holds when every GIS endpoint is down.
 *   4. The measurements + severity rules — AREA fractions on the real rings (clipper), never
 *      vertex sampling; severity is by LOCATION (on the site / near it), not by presence.
 */

import ClipperLib from "clipper-lib";
import { siteState } from "./siteRegion.js";
import { isSfhaZone, isShadedXSubtype } from "./floodZone.js";
import { classifyWell } from "./wellStatus.js";
import { toGrid, screenProximity } from "./proximityScreen.js";
import { NEAR_RADIUS_MI } from "./siteCheckRadius.js";

const FT_PER_MI = 5280;
const EDGE = 1e-6; // a feature EXACTLY at the radius is inside it (≤, not <): float dust must not flip that

/* ── 2. thresholds — one place ───────────────────────────────────────────────────────────────── */
/* NEAR_RADIUS_MI (siteCheckRadius.js, a boot-safe leaf) is the quarter mile the screen already used for wells
 * (`ANALYSIS_SOURCES.oilgas.bufferMi` reads it too); pipelines had no radius before and adopt the same one. */
export { NEAR_RADIUS_MI };
export const CHECK_THRESHOLDS = Object.freeze({
  nearRadiusMi: NEAR_RADIUS_MI,
  /* A line / point at or inside this many feet of the ring counts as ON the site. One foot, not zero:
   * both sides are projected through the same grid, so a pipeline that truly touches the ring agrees to
   * well under a foot, while a schematic RRC route a few feet outside still reads "near", not "on". */
  onSiteFt: 1,
  /* An overlap smaller than this is clipper dust (a flood polygon that shares the parcel's own edge),
   * not ground. Square feet. Deliberately tiny: a 0.01-acre wetland is 435 sq ft and still counts. */
  overlapDustSqft: 25,
  /* FEMA publishes the all-clear (unshaded Zone X) as polygons, so a site with no polygon over part of it
   * is a part FEMA has not mapped. Below this mapped fraction a flood row will not read "None". */
  floodMappedMin: 0.98,
  /* The server-side proximity buffer is padded this far past the radius; the exact cut is made
   * client-side on the real rings, so a well "exactly at the radius" is judged by our distance, not by
   * the server's buffer of a decimated ring. */
  queryPadFt: 150,
  /* A well/pipeline query returning this many features may have been truncated: we then ask a second,
   * unbuffered question for what is ON the site so a crowded corridor can never hide a crossing. */
  proxCap: 200,
  maxPages: 6,
});

/* ── 1. the registry ─────────────────────────────────────────────────────────────────────────── */
/* `regions: "all"` = trusted wherever the site is; an array = trusted ONLY where every part of the site
 * resolves into one of those states. `source` is the key in shared/gis/sources.js; test/siteChecks.test.js
 * asserts each row's regions agree with that registry's own `SOURCE_STATE_SCOPE`, so the two cannot drift.
 * `layer` is the Layers-panel key a click on the row turns on (click-to-show; no hover). */
export const TRUSTED_CHECKS = Object.freeze([
  { id: "flood100", label: "100-year floodplain", group: "flood", source: "flood", regions: "all", layer: "fema" },
  { id: "flood500", label: "500-year floodplain", group: "flood", source: "flood", regions: "all", layer: "fema" },
  { id: "wetlands", label: "Wetlands", group: "wetlands", source: "wetlands", regions: "all", layer: "wetlands" },
  { id: "pipelines", label: "Pipelines", group: "pipelines", source: "pipelines", regions: ["TX"], layer: "txrrc_pipe" },
  { id: "wells", label: "Oil & gas wells", group: "wells", source: "oilgas", regions: ["TX"], layer: "txrrc_wells" },
]);

/* ── 3. region gate ──────────────────────────────────────────────────────────────────────────── */
/* A coarse Texas OUTLINE. `siteState`'s "TX" is a generous BOX (it also holds Shreveport, Roswell and
 * Lawton), which is right for "which rules may apply" and WRONG for "may the RRC clear this site": the
 * RRC knows nothing about Louisiana, so a Shreveport parcel would read a green "None". So the RRC
 * checks additionally require the point to sit inside this outline. It is hand-simplified [lng, lat],
 * a hair INSIDE the borders (rivers) and padded seaward on the coast: a border-town site falling out of
 * it only ever loses a verdict (the layer pill is still offered) — it can never gain a false one. */
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

function inPolygon(lng, lat, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
export const inTexas = (lat, lng) => inPolygon(lng, lat, TEXAS_OUTLINE);

/* The region ("TX" | "CO" | "GA" | "CA" | "FL" | null) a single point belongs to FOR TRUST PURPOSES: "TX"
 * only when the box AND the outline agree. */
/* The Texas claim also covers a quarter-mile buffer (a check says "None within a quarter mile"), and the RRC has
 * nothing across the line, so "Texas" requires the point AND a ~0.4 mi ring around it (four offsets) inside the
 * outline: a site closer than that to a border loses its verdict rather than gaining a false one. */
const TX_MARGIN_DEG = 0.007;
export function trustRegionOf(lat, lng) {
  const st = siteState({ lat, lng });
  if (st === "TX") {
    const d = TX_MARGIN_DEG;
    return inTexas(lat, lng) && inTexas(lat + d, lng) && inTexas(lat - d, lng) && inTexas(lat, lng + d) && inTexas(lat, lng - d) ? "TX" : null;
  }
  return st;
}

/* Up to `cap` sample points over every ring (all vertices when the set is small), plus each ring's bbox
 * corners and centre — enough that a straddle of a state line is seen from either side. [lng, lat]. */
export function samplePoints(rings, cap = 400) {
  const pts = [];
  const all = (rings || []).flat().filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
  const stride = Math.max(1, Math.ceil(all.length / cap));
  for (let i = 0; i < all.length; i += stride) pts.push(all[i]);
  for (const ring of rings || []) {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const [x, y] of ring || []) { if (x < a) a = x; if (y < b) b = y; if (x > c) c = x; if (y > d) d = y; }
    if (Number.isFinite(a)) pts.push([a, b], [a, d], [c, b], [c, d], [(a + c) / 2, (b + d) / 2]);
  }
  return pts;
}

/* The regions the whole site touches. `regions` is the sorted list of distinct trust regions (null
 * entries mean "outside every region we can name"); `strict` is true when a single region holds EVERY
 * sample point. */
export function siteRegions(rings) {
  const set = new Set();
  for (const [lng, lat] of samplePoints(rings)) set.add(trustRegionOf(lat, lng) || "?");
  const regions = [...set].sort();
  return { regions, single: regions.length === 1 && regions[0] !== "?" ? regions[0] : null };
}

/* May this check issue a VERDICT for a site spanning `regions`? A straddling site uses the strictest
 * reading: every part of it must be inside one of the check's regions, so a Texas/Colorado straddle
 * (or a Texas parcel that touches Louisiana) gets no RRC verdict. An empty site is never trusted. */
export function isTrustedFor(check, regions) {
  if (!check) return false;
  if (check.regions === "all") return Array.isArray(regions) && regions.length > 0;
  if (!Array.isArray(regions) || !regions.length) return false;
  return regions.every((r) => r !== "?" && check.regions.includes(r));
}

/* ── geometry (feet, via the shared grid) ────────────────────────────────────────────────────── */
const SCALE = 100; // clipper works on integers: centi-feet, the same scale polyClip / pondOffset use
const Clipper = ClipperLib.Clipper;

function ringsToFt(rings) {
  return (rings || []).map((r) => (r || []).map(toGrid).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).filter((r) => r.length >= 3);
}
function makeFrame(ringsFt) {
  let ox = 0, oy = 0, n = 0;
  for (const r of ringsFt) for (const p of r) { ox += p.x; oy += p.y; n++; }
  return n ? { ox: ox / n, oy: oy / n } : { ox: 0, oy: 0 };
}
const toPath = (ringFt, f) => ringFt.map((p) => ({ X: Math.round((p.x - f.ox) * SCALE), Y: Math.round((p.y - f.oy) * SCALE) }));
const pathsArea = (paths) => {
  let s = 0;
  for (const p of paths) s += Clipper.Area(p);
  return Math.abs(s) / (SCALE * SCALE);
};
const orient = (path) => (Clipper.Orientation(path) ? path : path.slice().reverse());

function exec(type, subj, clip, fillS = ClipperLib.PolyFillType.pftNonZero, fillC = ClipperLib.PolyFillType.pftNonZero) {
  const c = new Clipper();
  if (subj && subj.length) c.AddPaths(subj, ClipperLib.PolyType.ptSubject, true);
  if (clip && clip.length) c.AddPaths(clip, ClipperLib.PolyType.ptClip, true);
  const out = new ClipperLib.Paths();
  c.Execute(type, out, fillS, fillC);
  return out;
}
const union = (paths) => exec(ClipperLib.ClipType.ctUnion, paths, null);

/* The SITE as a solid: every active parcel unioned (all rings forced one orientation first, or two
 * oppositely-wound neighbours cancel to a hole), save-and-except HOLES subtracted. Returns clipper paths. */
export function siteSolid(rings, holes, frame) {
  const parts = ringsToFt(rings).map((r) => orient(toPath(r, frame)));
  let solid = union(parts);
  const holePaths = ringsToFt(holes || []).map((r) => orient(toPath(r, frame)));
  if (holePaths.length) solid = exec(ClipperLib.ClipType.ctDifference, solid, union(holePaths));
  return solid;
}

/* One GIS polygon feature (esri `rings`, outer + inner, any winding) → normalised paths. EvenOdd within
 * the feature so its INTERIOR rings stay holes; the normalised output is oriented for the cross-feature
 * union that follows. Never vertex sampling — real area. */
function featurePaths(esriRings, frame) {
  const paths = ringsToFt(esriRings).map((r) => toPath(r, frame));
  if (!paths.length) return [];
  return exec(ClipperLib.ClipType.ctUnion, paths, null, ClipperLib.PolyFillType.pftEvenOdd, ClipperLib.PolyFillType.pftEvenOdd);
}
const unionOfFeatures = (features, frame) => union(features.flatMap((f) => featurePaths(f.rings, frame)));
const clipToSite = (paths, siteSolidPaths) => (paths.length ? exec(ClipperLib.ClipType.ctIntersection, paths, siteSolidPaths) : []);

/* Compass word for where `paths` sits within the site's own extent: "most of the site", "west side",
 * "northeast corner". Area-weighted by vertex mean of the largest piece — presentation only. */
function sideWord(paths, siteSolidPaths) {
  if (!paths.length || !siteSolidPaths.length) return null;
  const bounds = (ps) => {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const p of ps) for (const q of p) { if (q.X < a) a = q.X; if (q.Y < b) b = q.Y; if (q.X > c) c = q.X; if (q.Y > d) d = q.Y; }
    return { a, b, c, d };
  };
  const sb = bounds(siteSolidPaths);
  const share = pathsArea(paths) / (pathsArea(siteSolidPaths) || 1);
  if (share >= 0.7) return "most of the site";
  const big = paths.slice().sort((p, q) => Math.abs(Clipper.Area(q)) - Math.abs(Clipper.Area(p)))[0];
  let mx = 0, my = 0;
  for (const q of big) { mx += q.X; my += q.Y; }
  mx /= big.length; my /= big.length;
  return compassFrom((mx - (sb.a + sb.c) / 2) / ((sb.c - sb.a) || 1), (my - (sb.b + sb.d) / 2) / ((sb.d - sb.b) || 1), true);
}
/* dx east+, dy north+, each as a fraction of the extent. `inside` words it as a part of the site. */
export function compassFrom(dx, dy, inside = false) {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (ax < 0.12 && ay < 0.12) return inside ? "middle of the site" : null;
  const ns = dy > 0 ? "north" : "south", ew = dx > 0 ? "east" : "west";
  const diagonal = ax > 0.5 * ay && ay > 0.5 * ax;
  if (diagonal) return inside ? `${ns}${ew} corner` : `${ns}${ew}`;
  const dir = ax >= ay ? ew : ns;
  return inside ? `${dir} side` : dir;
}

/* ── measurements ────────────────────────────────────────────────────────────────────────────── */
/* FLOOD. `features` = [{ rings (lng/lat), zone, subtype }]. Three disjoint classes are formed BEFORE any
 * area is read: SFHA (the 1% / 100-yr, floodway included), shaded X (the 0.2% / 500-yr) MINUS the SFHA
 * — so an AE area that a shaded-X polygon also covers is counted once, in the 100-year only — and Zone D
 * (undetermined). `mappedFrac` is how much of the site ANY polygon covers: FEMA publishes the all-clear
 * as polygons, so uncovered ground is unmapped, and a row may not read "None" over it. */
export function measureFlood(rings, holes, features, thresholds = CHECK_THRESHOLDS) {
  const ringsFt = ringsToFt(rings);
  const frame = makeFrame(ringsFt);
  const solid = siteSolid(rings, holes, frame);
  const siteSqft = pathsArea(solid);
  if (!(siteSqft > 0)) throw new Error("The site has no measurable area.");
  const feats = features || [];
  const sfha = feats.filter((f) => isSfhaZone(f.zone));
  const shaded = feats.filter((f) => !isSfhaZone(f.zone) && String(f.zone || "").trim().toUpperCase() === "X" && isShadedXSubtype(f.subtype));
  const undetermined = feats.filter((f) => /^D$|NOT INCLUDED/i.test(String(f.zone || "").trim()));
  const sfhaU = unionOfFeatures(sfha, frame);
  const shadedU = unionOfFeatures(shaded, frame);
  const shadedOnly = shadedU.length && sfhaU.length ? exec(ClipperLib.ClipType.ctDifference, shadedU, sfhaU) : shadedU;
  const sfhaOn = clipToSite(sfhaU, solid);
  const shadedOn = clipToSite(shadedOnly, solid);
  const undetOn = clipToSite(unionOfFeatures(undetermined, frame), solid);
  const allOn = clipToSite(unionOfFeatures(feats, frame), solid);
  const sfhaSqft = pathsArea(sfhaOn), shadedSqft = pathsArea(shadedOn), undetSqft = pathsArea(undetOn), mappedSqft = pathsArea(allOn);
  const zonesOf = (list) => [...new Set(list.map((f) => String(f.zone || "").trim()).filter(Boolean))];
  const clean = (sq) => (sq >= thresholds.overlapDustSqft ? sq : 0);
  return {
    siteSqft,
    sfhaSqft: clean(sfhaSqft), sfhaFrac: siteSqft > 0 ? clean(sfhaSqft) / siteSqft : 0,
    shadedSqft: clean(shadedSqft), shadedFrac: siteSqft > 0 ? clean(shadedSqft) / siteSqft : 0,
    undeterminedSqft: clean(undetSqft),
    mappedFrac: siteSqft > 0 ? Math.min(1, mappedSqft / siteSqft) : 0,
    sfhaZones: zonesOf(sfha), floodway: sfha.some((f) => /floodway/i.test(String(f.subtype || ""))),
    sfhaSide: clean(sfhaSqft) ? sideWord(sfhaOn, solid) : null,
    shadedSide: clean(shadedSqft) ? sideWord(shadedOn, solid) : null,
    featureCount: feats.length,
  };
}

/* WETLANDS. `features` = [{ rings, type }]. Acres is the area of the union ON the site; count is the
 * number of mapped wetlands that put real ground on it (a polygon merely touching the ring is not one). */
export function measureWetlands(rings, holes, features, thresholds = CHECK_THRESHOLDS) {
  const ringsFt = ringsToFt(rings);
  const frame = makeFrame(ringsFt);
  const solid = siteSolid(rings, holes, frame);
  const siteSqft = pathsArea(solid);
  if (!(siteSqft > 0)) throw new Error("The site has no measurable area.");
  let count = 0;
  const types = new Set();
  const kept = [];
  for (const f of features || []) {
    const on = clipToSite(featurePaths(f.rings, frame), solid);
    if (pathsArea(on) >= thresholds.overlapDustSqft) { count++; kept.push(f); if (f.type) types.add(String(f.type)); }
  }
  const onAll = clipToSite(unionOfFeatures(kept, frame), solid);
  const sqft = pathsArea(onAll);
  return { siteSqft, sqft, acres: sqft / 43560, count, types: [...types], side: sqft >= thresholds.overlapDustSqft ? sideWord(onAll, solid) : null };
}

/* LINES / POINTS (pipelines, wells): distance of each feature from the real rings (0 when a line
 * crosses or touches, or a point is inside), through the same engine the rest of the screen uses.
 * PLAIN DATA out (it is stored in the cache): the nearest-first sample, trimmed to what the copy reads,
 * plus the compass word for the nearest one. */
export function measureProximity(rings, features, { keep = 60 } = {}) {
  const scr = screenProximity(rings, features || []);
  const ringsFt = ringsToFt(rings);
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const r of ringsFt) for (const p of r) { if (p.x < a) a = p.x; if (p.y < b) b = p.y; if (p.x > c) c = p.x; if (p.y > d) d = p.y; }
  const cx = (a + c) / 2, cy = (b + d) / 2, spanX = (c - a) || 1, spanY = (d - b) || 1;
  const dirOf = (f) => {
    // The feature vertex nearest the site centre → a compass word for "which side of the site is it on".
    // A line is walked at ~40 points per segment: its nearest VERTEX is arbitrary (a pipeline running the whole
    // east side has vertices at its two ends, which would read "northeast"), its nearest POINT is the answer.
    const pts = [];
    if (Array.isArray(f.paths)) {
      for (const path of f.paths) {
        for (let i = 0; i < path.length; i++) {
          pts.push(path[i]);
          const nx = path[i + 1];
          if (nx) for (let k = 1; k < 40; k++) pts.push([path[i][0] + ((nx[0] - path[i][0]) * k) / 40, path[i][1] + ((nx[1] - path[i][1]) * k) / 40]);
        }
      }
    } else if (f.lngLat) pts.push(f.lngLat);
    let best = null, bd = Infinity;
    for (const q of pts) {
      const g = toGrid(q);
      const dd = Math.hypot(g.x - cx, g.y - cy);
      if (Number.isFinite(dd) && dd < bd) { bd = dd; best = g; }
    }
    return best ? compassFrom((best.x - cx) / spanX, (best.y - cy) / spanY, false) : null;
  };
  const ranked = scr.ranked.slice(0, keep).map((f) => ({ attrs: f.attrs || {}, distFt: f.distFt }));
  return { ranked, distances: scr.ranked.map((f) => f.distFt), count: scr.count, nearestFt: scr.nearestFt, nearestDir: scr.nearest ? dirOf(scr.nearest) : null };
}

/* ── severity (pure) ─────────────────────────────────────────────────────────────────────────── */
export const SEVERITY = Object.freeze({ red: "red", amber: "amber", green: "green", failed: "failed" });

export function severityFlood100(m, t = CHECK_THRESHOLDS) {
  if (m.sfhaSqft >= t.overlapDustSqft) return SEVERITY.red;
  if (m.undeterminedSqft > 0 || m.mappedFrac < t.floodMappedMin) return SEVERITY.amber;
  return SEVERITY.green;
}
export function severityFlood500(m, t = CHECK_THRESHOLDS) {
  if (m.shadedSqft >= t.overlapDustSqft) return SEVERITY.amber;
  if (m.undeterminedSqft > 0 || m.mappedFrac < t.floodMappedMin) return SEVERITY.amber;
  if (m.sfhaFrac >= 0.98) return SEVERITY.amber; // the 0.2% area contains the 1% area — "None" would be false reassurance
  return SEVERITY.green;
}
export const severityWetlands = (m, t = CHECK_THRESHOLDS) => (m.sqft >= t.overlapDustSqft ? SEVERITY.red : SEVERITY.green);
/* Pipelines: crosses (or touches) the ring → red; within the radius but not crossing → amber; else green. */
export function severityPipelines(m, t = CHECK_THRESHOLDS) {
  if (m.nearestFt != null && m.nearestFt <= t.onSiteFt) return SEVERITY.red;
  if (m.nearestFt != null && m.nearestFt <= t.nearRadiusMi * FT_PER_MI + EDGE) return SEVERITY.amber;
  return SEVERITY.green;
}
/* Wells: any well on the site → red; any within the radius (inclusive) → amber; else green. */
export function severityWells(m, t = CHECK_THRESHOLDS) {
  if (m.onSite > 0) return SEVERITY.red;
  if (m.near > 0) return SEVERITY.amber;
  return SEVERITY.green;
}

/* ── copy ────────────────────────────────────────────────────────────────────────────────────── */
const pct = (f) => (f >= 0.995 ? "100%" : f < 0.01 ? "<1%" : `${Math.round(f * 100)}%`);
const acres = (a) => (a < 0.1 ? "<0.1 AC" : `${a < 10 ? a.toFixed(1) : Math.round(a)} AC`);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export const NONE_NEAR = "None within a quarter mile";

/* "CHEVRON PIPE LINE COMPANY" → "Chevron Pipe Line Company". Keeps short all-caps acronyms (LLC, LP, ET). */
export function titleCaseName(s) {
  const keep = new Set(["LLC", "LP", "LLP", "INC", "CO", "TX", "USA", "NGL", "II", "III", "IV", "HP"]);
  return String(s || "").trim().split(/\s+/).map((w) => {
    const bare = w.replace(/[^A-Za-z]/g, "");
    if (keep.has(bare.toUpperCase())) return w.toUpperCase().replace(/^INC$/, "Inc").replace(/^CO$/, "Co");
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join(" ");
}
/* "~300 ft" / "~0.2 mi". Rounded; never "on the site" (that is the red state, worded separately). */
export function fmtApproxFt(ft) {
  if (ft == null || !Number.isFinite(ft)) return "";
  if (ft < FT_PER_MI) return `~${Math.max(10, ft < 100 ? Math.round(ft / 10) * 10 : Math.round(ft / 50) * 50)} ft`;
  return `~${(ft / FT_PER_MI).toFixed(1)} mi`;
}

const SRC_FLOOD = "FEMA National Flood Hazard Layer";
const FLOOD_CAVEAT = "Screening only — confirm against FEMA's current effective flood map (and any map amendment) before setting finished floors.";

/* The row for each check, from its measurement. `row.figure` is the right-aligned number; `row.line` the
 * one plain sentence; `row.expand` the click-open copy. Severity is attached by the caller's classifier so
 * the two can never disagree about which row is which colour. */
export function buildFlood100Row(m, t = CHECK_THRESHOLDS) {
  const sev = severityFlood100(m, t);
  const zones = m.sfhaZones.length ? `Zone ${m.sfhaZones.join(", ")}` : "Special flood hazard area";
  const base = { id: "flood100", severity: sev, source: SRC_FLOOD, caveat: FLOOD_CAVEAT, link: { id: "drainage", label: "Open in Drainage →" } };
  if (sev === SEVERITY.red) {
    return { ...base, figure: pct(m.sfhaFrac), line: `${zones}${m.sfhaSide ? `, ${m.sfhaSide}` : ""}`,
      sentences: [`About ${pct(m.sfhaFrac)} of the site is inside the mapped 1%-annual-chance floodplain${m.floodway ? ", including regulatory floodway" : ""}. Building here triggers floodplain permitting and usually compensating storage.`] };
  }
  if (sev === SEVERITY.amber) {
    return { ...base, figure: "Not fully mapped", line: m.undeterminedSqft > 0 ? "FEMA hasn't studied part of this site (Zone D)" : "FEMA's map doesn't cover all of this site",
      sentences: ["Part of the site has no FEMA flood zone, so \"none\" would be a guess. Confirm with the county floodplain administrator."] };
  }
  return { ...base, figure: "None", line: "No 100-year floodplain on the site", sentences: ["FEMA's map shows no 1%-annual-chance floodplain on the site."] };
}
export function buildFlood500Row(m, t = CHECK_THRESHOLDS) {
  const sev = severityFlood500(m, t);
  const base = { id: "flood500", severity: sev, source: SRC_FLOOD, caveat: FLOOD_CAVEAT, link: { id: "drainage", label: "Open in Drainage →" } };
  if (m.shadedSqft >= t.overlapDustSqft) {
    return { ...base, figure: pct(m.shadedFrac), line: `Shaded Zone X (0.2%)${m.shadedSide ? `, ${m.shadedSide}` : ""}`,
      sentences: [`About ${pct(m.shadedFrac)} of the site (outside the 100-year area) is in the 0.2%-annual-chance floodplain. Harris County counts it for 1:1 fill mitigation; other jurisdictions vary.`] };
  }
  if (sev === SEVERITY.amber && m.sfhaFrac >= 0.98) {
    return { ...base, figure: "In 100-yr area", line: "Inside the 100-year floodplain",
      sentences: ["The whole site is already inside the 100-year floodplain, which the 500-year area contains."] };
  }
  if (sev === SEVERITY.amber) {
    return { ...base, figure: "Not fully mapped", line: "FEMA's map doesn't cover all of this site",
      sentences: ["Part of the site has no FEMA flood zone, so \"none\" would be a guess."] };
  }
  return { ...base, figure: "None", line: "No 500-year floodplain on the site", sentences: ["FEMA's map shows no 0.2%-annual-chance floodplain on the site."] };
}
export function buildWetlandsRow(m, t = CHECK_THRESHOLDS) {
  const sev = severityWetlands(m, t);
  const base = { id: "wetlands", severity: sev, source: "USFWS National Wetlands Inventory", caveat: "A desktop screen, not a survey of the wetland edge — a consultant's delineation and Army Corps verification decide what is jurisdictional." };
  if (sev === SEVERITY.red) {
    const kind = m.types.length ? m.types.slice(0, 2).join(", ") : "Mapped wetland";
    return { ...base, figure: `${acres(m.acres)} · ${m.count}`, line: `${kind}${m.side ? `, ${m.side}` : ""}`,
      sentences: [`${plural(m.count, "mapped wetland puts", "mapped wetlands put")} about ${acres(m.acres)} on the site. Disturbing jurisdictional wetlands needs a Corps permit.`] };
  }
  return { ...base, figure: "None", line: "No mapped wetlands on the site", sentences: ["No National Wetlands Inventory polygon touches the site."] };
}

/* Group lines by operator for the one-line summary: "Chevron, 2 lines". */
function operatorSummary(ranked, attrKey = "OPERATOR") {
  const by = new Map();
  for (const f of ranked) {
    const op = titleCaseName((f.attrs && f.attrs[attrKey]) || "") || "Unnamed operator";
    by.set(op, (by.get(op) || 0) + 1);
  }
  return [...by.entries()].sort((a, b) => b[1] - a[1]);
}
export function buildPipelinesRow(m, t = CHECK_THRESHOLDS) {
  const sev = severityPipelines(m, t);
  const base = { id: "pipelines", severity: sev, source: "Railroad Commission of Texas (permit routes)", caveat: "Routes are approximate. Confirm with 811 and the operator." };
  const radiusFt = t.nearRadiusMi * FT_PER_MI;
  const within = m.ranked.filter((f) => f.distFt <= radiusFt + EDGE);
  const ops = operatorSummary(sev === SEVERITY.red ? m.ranked.filter((f) => f.distFt <= t.onSiteFt) : within);
  const opLine = ops.slice(0, 2).map(([op, n]) => `${op}, ${plural(n, "line", "lines")}`).join(" · ") + (ops.length > 2 ? ` · +${ops.length - 2} more` : "");
  if (sev === SEVERITY.red) {
    return { ...base, figure: "Crosses", line: `${opLine}, crossing the site`,
      sentences: ["A mapped pipeline crosses the site. Expect an easement you can't build over; the operator sets its width and any crossing rules."] };
  }
  if (sev === SEVERITY.amber) {
    const dir = m.nearestDir || null;
    return { ...base, figure: fmtApproxFt(m.nearestFt), line: `${opLine}, outside the site${dir ? ` to the ${dir}` : ""}`,
      sentences: [`The nearest mapped pipeline is ${fmtApproxFt(m.nearestFt)} from the site line. Because the routes are schematic, it could be closer or on the site.`] };
  }
  return { ...base, figure: "None", line: NONE_NEAR, sentences: ["No mapped Railroad Commission pipeline crosses the site or sits within a quarter mile of it."] };
}
export function buildWellsRow(m, t = CHECK_THRESHOLDS) {
  const sev = severityWells(m, t);
  const base = { id: "wells", severity: sev, source: "Railroad Commission of Texas (well surface locations)", caveat: "Well points are schematic and old wells can be mis-located or unmapped. A Railroad Commission records search is the real check." };
  if (sev === SEVERITY.green) return { ...base, figure: "None", line: NONE_NEAR, sentences: ["No mapped well sits on the site or within a quarter mile of it."] };
  const cats = {};
  for (const f of m.inRadius) { const c = classifyWell(f.attrs); cats[c] = (cats[c] || 0) + 1; }
  const words = { plugged: "plugged", abandoned: "abandoned", dry: "dry hole", shutin: "shut-in", injection: "injection", producing: "producing", other: "other" };
  const mix = Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${n} ${words[k] || k}`).join(", ");
  const figure = m.onSite > 0 ? `${m.onSite} on site` : `${m.nearLabel} within ¼ mi`;
  const line = m.onSite > 0 ? `${plural(m.onSite, "well", "wells")} on the site${m.near > m.onSite ? `, ${m.near - m.onSite} more within ¼ mile` : ""}${mix ? ` · ${mix}` : ""}` : `${mix || plural(m.near, "well", "wells")}`;
  return { ...base, figure, line,
    sentences: [m.onSite > 0
      ? "A mapped well sits on the site. An old plug may not meet modern standards, and a producing well forces setbacks."
      : `The nearest mapped well is ${fmtApproxFt(m.nearestFt)} away. Setbacks and access can still reach the site.`] };
}

export const ROW_BUILDERS = Object.freeze({
  flood100: buildFlood100Row, flood500: buildFlood500Row, wetlands: buildWetlandsRow,
  pipelines: buildPipelinesRow, wells: buildWellsRow,
});

/* Wells measurement from a proximity answer: split on-site vs within-radius with OUR distance on the real
 * rings (inclusive at the radius). `capped` says the sample hit the query cap, so the count prints "N+". */
export function measureWells(rings, features, { capped = false, thresholds = CHECK_THRESHOLDS } = {}) {
  const base = measureProximity(rings, features);
  const radiusFt = thresholds.nearRadiusMi * FT_PER_MI;
  const inRadius = base.ranked.filter((f) => f.distFt <= radiusFt + EDGE); // the trimmed sample (copy: status mix)
  const near = base.distances.filter((d) => d <= radiusFt + EDGE).length;  // the FULL count, never the trimmed sample's
  const onSite = base.distances.filter((d) => d <= thresholds.onSiteFt).length;
  return { ...base, inRadius, onSite, near, nearLabel: `${near}${capped ? "+" : ""}`, capped };
}
export function measurePipelines(rings, features) {
  return measureProximity(rings, features);
}

/* Fresh severity for a stored measurement — the cache holds MEASUREMENTS, never verdicts, so a changed
 * threshold or a corrected rule can never be defeated by an old stored answer. */
export function rowFromMeasurement(id, measurement, thresholds = CHECK_THRESHOLDS) {
  const build = ROW_BUILDERS[id];
  if (!build || !measurement) return null;
  return build(measurement, thresholds);
}

/* ── freshness ───────────────────────────────────────────────────────────────────────────────── */
const HOUR = 3600 * 1000, DAYMS = 24 * HOUR;
/* "just now" / "3 hours ago" / "2 days ago" — plain words, deliberately coarse. */
export function ageWords(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
  if (ms < 45 * 1000) return "just now";
  if (ms < HOUR) { const m = Math.max(1, Math.round(ms / 60000)); return `${m} minute${m === 1 ? "" : "s"} ago`; }
  if (ms < DAYMS) { const h = Math.round(ms / HOUR); return `${h} hour${h === 1 ? "" : "s"} ago`; }
  const d = Math.round(ms / DAYMS);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}
/* ONE freshness line for the panel (the median row age) and the rows that are MATERIALLY staler than the
 * rest (at least a day older than the median AND over twice it) — only those get an age of their own. */
export function freshnessOf(rows) {
  const ages = (rows || []).filter((r) => r.severity !== "failed" && Number.isFinite(r.ageMs)).map((r) => r.ageMs).sort((a, b) => a - b);
  if (!ages.length) return { line: null, stale: {} };
  const median = ages[Math.floor((ages.length - 1) / 2)];
  const stale = {};
  for (const r of rows) {
    if (r.severity === "failed" || !Number.isFinite(r.ageMs)) continue;
    if (r.ageMs - median >= DAYMS && r.ageMs > 2 * median) stale[r.id] = ageWords(r.ageMs);
  }
  return { line: `Checked ${ageWords(median)}`, stale };
}
