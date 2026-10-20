/* The GRADING LIMIT (owner-only grading layer, round 4 — B2349120) — ONE outline around everything that gets graded.
 *
 * The civil's concept grading plan (Falcon Design, "Overall Site Plan for Tomochichi Building 1") grades the building,
 * its courts, trailer rows, car lots and drive aisles as ONE developed area with ONE outline, and throws ONE continuous
 * slope from that outline to daylight. The per-element engine threw a slope off every rectangle edge instead ("the calcs
 * seemed awfully rectangular"). This module decides WHERE that one outline is; proposedSurface.js grades inside it.
 *
 * Two MODES, stored on the plan beside the limit (owner amendment 2026-10-19 6:22 PM CT):
 *   • "layout"   (default, "Around the layout") — the union of every graded element, pushed out by the shoulder, with
 *                outside corners ROUNDED (radius ≈ the drive-aisle width, min 30 ft — a morphological close: offset out
 *                by R + shoulder with round joins, then back in by R), holes narrower than a drive aisle filled in, and
 *                CLIPPED to the setback polygon(s) — where the union would cross, the limit hugs the setback. The daylight
 *                slope is thrown OUTWARD from it.
 *   • "boundary" ("Grade to the boundary") — the setback polygon less any stream/wetland buffer and the pond. The slope
 *                is thrown INWARD from that limit at the plan's ratio down/up to the finish elevation, so the flat
 *                plateau inside the daylight line IS the pad: the same geometry as the Level-ground sweep, run at the
 *                building's FFE (proposedSurface.js reuses buildableGround.js's maskAt for it — never a second engine).
 *
 * An EDITED limit (mode "layout" only): the owner's polygon is stored on the plan; an element that later sits outside it
 * is re-admitted by re-applying the auto union to THAT element only (`grewIds` names it so the panel can say "Limit grew
 * to include Building 2").
 *
 * Pure, Node-testable, no DOM. Feet everywhere. clipper-lib is already this repo's polygon engine (pondOffset.js,
 * roadNetwork.js); the same centi-foot grid and round-join chord tolerance. Results are cached by VALUE signature,
 * because the FFE search rebuilds the surface dozens of times over an unchanged layout. */
import ClipperLib from "clipper-lib";
import { pointInRing } from "./pondGeom.js";

export const LIMIT_DEFAULTS = Object.freeze({ shoulderFt: 5, cornerRadiusFt: 30, aisleFt: 24, minCornerRadiusFt: 30 });
export const LIMIT_MODES = Object.freeze(["layout", "boundary"]);
export const LIMIT_MODE_LABEL = Object.freeze({ layout: "Around the layout", boundary: "To the boundary" });
const SQFT_PER_ACRE = 43560;

const SCALE = 100;                 // feet → centi-feet
const CLEAN_DELTA = SCALE * 0.01;
const ARC_TOL = 0.25 * SCALE;      // round-join chord tolerance (~0.25 ft)
const MIN_REGION_SF = 10;

const toPath = (ring) => ring.map((p) => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) }));
const fromPath = (path) => path.map((c) => ({ x: c.X / SCALE, y: c.Y / SCALE }));
const isRing = (r) => Array.isArray(r) && r.length >= 3 && r.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));

/* |area| of a feet ring (shoelace). */
export function ringAreaSf(ring) {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) { const p = ring[i], q = ring[(i + 1) % n]; a += p.x * q.y - q.x * p.y; }
  return Math.abs(a) / 2;
}
export const ringHash = (ring) => {
  let h = 0;
  for (let i = 0; i < ring.length; i++) h += (ring[i].x * 7.13 + ring[i].y * 3.71) * (i + 1);
  return `${ring.length}:${Math.round(h)}`;
};

/* ---- clipper primitives (local; orientation normalised so a union never cancels) ---- */
function cleanPaths(rings) {
  const out = [];
  for (const r of rings || []) {
    if (!isRing(r)) continue;
    const p = ClipperLib.Clipper.CleanPolygon(toPath(r), CLEAN_DELTA);
    if (p.length < 3) continue;
    if (ClipperLib.Clipper.Area(p) < 0) p.reverse();
    out.push(p);
  }
  return out;
}
function execute(subject, clip, type) {
  const c = new ClipperLib.Clipper();
  if (subject.length) c.AddPaths(subject, ClipperLib.PolyType.ptSubject, true);
  if (clip && clip.length) c.AddPaths(clip, ClipperLib.PolyType.ptClip, true);
  const tree = new ClipperLib.PolyTree();
  c.Execute(type, tree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return tree;
}
/* A PolyTree → [{ outer, holes }] in feet, islands inside holes as their own regions. */
function treeToRegions(tree) {
  const out = [];
  const walk = (node) => {
    for (const child of node.Childs()) {
      if (child.IsHole()) continue;
      const outer = fromPath(child.Contour());
      const holes = [];
      for (const h of child.Childs()) {
        if (!h.IsHole()) continue;
        const hr = fromPath(h.Contour());
        if (hr.length >= 3 && ringAreaSf(hr) >= MIN_REGION_SF) holes.push(hr);
        walk(h);
      }
      if (outer.length >= 3 && ringAreaSf(outer) >= MIN_REGION_SF) out.push({ outer, holes });
    }
  };
  walk(tree);
  return out;
}
function regionsToPaths(regions) {
  const paths = [];
  for (const r of regions) {
    const o = ClipperLib.Clipper.CleanPolygon(toPath(r.outer), CLEAN_DELTA);
    if (o.length >= 3) { if (ClipperLib.Clipper.Area(o) < 0) o.reverse(); paths.push(o); }
    for (const h of r.holes) {
      const p = ClipperLib.Clipper.CleanPolygon(toPath(h), CLEAN_DELTA);
      if (p.length >= 3) { if (ClipperLib.Clipper.Area(p) > 0) p.reverse(); paths.push(p); }
    }
  }
  return paths;
}
function offsetPaths(paths, deltaFt, join = "round") {
  if (!paths.length || !deltaFt) return paths;
  const co = new ClipperLib.ClipperOffset(2, ARC_TOL);
  co.AddPaths(paths, join === "round" ? ClipperLib.JoinType.jtRound : ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
  const sol = new ClipperLib.Paths();
  co.Execute(sol, deltaFt * SCALE);
  return sol;
}
const regionsOf = (paths) => treeToRegions(execute(paths, [], ClipperLib.ClipType.ctUnion));

/* Union of feet rings → regions. */
export function unionRings(rings) {
  const paths = cleanPaths(rings);
  if (!paths.length) return [];
  return regionsOf(paths);
}
/* Feet rings pushed OUT by `deltaFt` (round joins) → regions. ROUND 5 (NEW-6): the paper background's margin past the
 * daylight line. */
export function bufferRings(rings, deltaFt) {
  const paths = cleanPaths(rings);
  if (!paths.length) return [];
  return regionsOf(offsetPaths(regionsToPaths(regionsOf(paths)), deltaFt, "round"));
}
/* regions ∩ (clipRings − clipHoles). No clip rings → the regions unchanged. */
export function clipRegions(regions, clipRings, clipHoles = []) {
  const clip = cleanPaths(clipRings);
  if (!clip.length) return regions;
  let clipTree = regionsOf(clip);
  const holes = cleanPaths(clipHoles);
  if (holes.length) clipTree = treeToRegions(execute(regionsToPaths(clipTree), holes, ClipperLib.ClipType.ctDifference));
  return treeToRegions(execute(regionsToPaths(regions), regionsToPaths(clipTree), ClipperLib.ClipType.ctIntersection));
}
/* regions − cutRings. */
export function subtractRings(regions, cutRings) {
  const cut = cleanPaths(cutRings);
  if (!cut.length || !regions.length) return regions;
  return treeToRegions(execute(regionsToPaths(regions), cut, ClipperLib.ClipType.ctDifference));
}
/* A hole narrower than `aisleFt` anywhere is filled in: inset the hole by half the aisle and see if anything survives. */
export function fillNarrowHoles(regions, aisleFt) {
  if (!(aisleFt > 0)) return regions;
  return regions.map((r) => ({
    outer: r.outer,
    holes: r.holes.filter((h) => {
      const p = cleanPaths([h]);
      if (!p.length) return false;
      const inset = offsetPaths(p, -aisleFt / 2, "miter");
      return inset.some((q) => q.length >= 3 && Math.abs(ClipperLib.Clipper.Area(q)) / (SCALE * SCALE) >= MIN_REGION_SF);
    }),
  }));
}
export const regionsAreaSf = (regions) => regions.reduce((a, r) => a + ringAreaSf(r.outer) - r.holes.reduce((b, h) => b + ringAreaSf(h), 0), 0);
export function pointInRegions(pt, regions) {
  for (const r of regions) {
    if (!pointInRing(pt, r.outer)) continue;
    let inHole = false;
    for (const h of r.holes) if (pointInRing(pt, h)) { inHole = true; break; }
    if (!inHole) return true;
  }
  return false;
}

/* ---- the auto limit ("Around the layout") ---- */

/* How much of `ring` survives inside `paths` (0..1) — the thin-piece test below. */
function retainedShare(ring, paths) {
  const p = cleanPaths([ring]);
  if (!p.length) return 1;
  const a0 = Math.abs(ClipperLib.Clipper.Area(p[0]));
  if (!(a0 > 0)) return 1;
  const tree = execute(p, paths, ClipperLib.ClipType.ctIntersection);
  const kept = regionsToPaths(treeToRegions(tree)).reduce((a, q) => a + ClipperLib.Clipper.Area(q), 0);
  return Math.max(0, kept) / a0;
}

/* union(rings) → CLOSE by R (out, then in, round joins: notches and holes narrower than 2R fill in) → OPEN by R (in,
 * then out: every OUTSIDE corner becomes an arc of radius R — the aisle wrapping the building ends) → any element the
 * opening erased (a strip thinner than 2R: a road, a walk) is put back whole → the shoulder is added all round (round
 * joins) → holes narrower than an aisle filled → clipped to the setback. Returns regions. */
export function autoGradingLimit({ rings, shoulderFt = LIMIT_DEFAULTS.shoulderFt, cornerRadiusFt = LIMIT_DEFAULTS.cornerRadiusFt, aisleFt = LIMIT_DEFAULTS.aisleFt, clipRings = null, clipHoles = [] } = {}) {
  const paths = cleanPaths(rings);
  if (!paths.length) return [];
  const R = Math.max(0, Number.isFinite(cornerRadiusFt) ? cornerRadiusFt : LIMIT_DEFAULTS.cornerRadiusFt);
  const sh = Math.max(0, Number.isFinite(shoulderFt) ? shoulderFt : LIMIT_DEFAULTS.shoulderFt);
  let u = regionsToPaths(regionsOf(paths));
  if (R > 0) {
    const closed = offsetPaths(offsetPaths(u, R, "round"), -R, "round");
    const opened = offsetPaths(offsetPaths(closed, -R, "round"), R, "round");
    const back = [];
    for (const r of rings) if (isRing(r) && retainedShare(r, opened) < 0.5) back.push(...cleanPaths([r]));
    u = regionsToPaths(regionsOf(opened.concat(back)));
  }
  const grown = sh > 0 ? offsetPaths(u, sh, "round") : u;
  let regions = regionsOf(grown);
  regions = fillNarrowHoles(regions, aisleFt);
  if (clipRings && clipRings.length) regions = clipRegions(regions, clipRings, clipHoles);
  return regions;
}

/* ---- the boundary limit ("Grade to the boundary") ---- */
export function boundaryGradingLimit({ setbackRings, setbackHoles = [], pondRings = [], bufferRings = [] } = {}) {
  let regions = unionRings(setbackRings);
  if (!regions.length) return [];
  const cuts = [...(setbackHoles || []), ...(pondRings || []), ...(bufferRings || [])].filter(isRing);
  if (cuts.length) regions = subtractRings(regions, cuts);
  return regions;
}

/* ---- the one resolver ---- */
const cache = new Map();
const CACHE_MAX = 24;

const inRingAll = (ring, outer) => ring.every((p) => pointInRing(p, outer));

/* Resolve the plan's grading limit.
 *   els       prepared graded elements [{ id, ring, type }] (the surface engine's own list)
 *   extraRings rings of elements that join the limit but are not graded planes (roads, hosted walks/strips)
 *   spec      { mode, shoulderFt, cornerRadiusFt, aisleFt, edited: ring|null, setbackRings, setbackHoles, pondRings, bufferRings }
 * Returns { mode, source: "auto"|"edited", regions, areaSf, areaAc, grewIds, sig }. Cached by value. */
export function resolveGradingLimit({ els = [], extraRings = [], spec = {} } = {}) {
  const mode = LIMIT_MODES.includes(spec.mode) ? spec.mode : "layout";
  const sh = Number.isFinite(spec.shoulderFt) ? spec.shoulderFt : LIMIT_DEFAULTS.shoulderFt;
  const R = Number.isFinite(spec.cornerRadiusFt) ? spec.cornerRadiusFt : LIMIT_DEFAULTS.cornerRadiusFt;
  const aisle = Number.isFinite(spec.aisleFt) ? spec.aisleFt : LIMIT_DEFAULTS.aisleFt;
  const edited = mode === "layout" && isRing(spec.edited) ? spec.edited : null;
  const setbackRings = (spec.setbackRings || []).filter(isRing), setbackHoles = (spec.setbackHoles || []).filter(isRing);
  const pondRings = (spec.pondRings || []).filter(isRing), bufferRings = (spec.bufferRings || []).filter(isRing);
  const graded = els.filter((e) => e && isRing(e.ring));
  const sig = [mode, sh, R, aisle, edited ? ringHash(edited) : "-",
    graded.map((e) => `${e.id}:${ringHash(e.ring)}`).join("|"), extraRings.filter(isRing).map(ringHash).join(","),
    setbackRings.map(ringHash).join(","), setbackHoles.map(ringHash).join(","), pondRings.map(ringHash).join(","), bufferRings.map(ringHash).join(",")].join("~");
  const hit = cache.get(sig);
  if (hit) return hit;
  let regions = [], grewIds = [], source = "auto";
  if (mode === "boundary") {
    regions = boundaryGradingLimit({ setbackRings, setbackHoles, pondRings, bufferRings });
  } else {
    const allRings = graded.map((e) => e.ring).concat(extraRings.filter(isRing));
    if (edited) {
      source = "edited";
      const outside = graded.filter((e) => !inRingAll(e.ring, edited));
      grewIds = outside.map((e) => e.id);
      const parts = [edited];
      if (outside.length) {
        for (const r of autoGradingLimit({ rings: outside.map((e) => e.ring), shoulderFt: sh, cornerRadiusFt: R, aisleFt: aisle })) {
          parts.push(r.outer);   // an auto outline's holes are re-opened by nothing — a hole smaller than an aisle is filled anyway
        }
      }
      regions = unionRings(parts);
      regions = fillNarrowHoles(regions, aisle);
      if (setbackRings.length) regions = clipRegions(regions, setbackRings, setbackHoles);
    } else {
      regions = autoGradingLimit({ rings: allRings, shoulderFt: sh, cornerRadiusFt: R, aisleFt: aisle, clipRings: setbackRings, clipHoles: setbackHoles });
    }
  }
  const areaSf = regionsAreaSf(regions);
  const out = { mode, source, regions, areaSf, areaAc: areaSf / SQFT_PER_ACRE, grewIds, sig, shoulderFt: sh, cornerRadiusFt: R };
  cache.set(sig, out);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return out;
}
export function clearGradingLimitCache() { cache.clear(); }

/* ---- a raster mask → feet rings (the boundary-mode plateau comes off the sweep lattice) ----
 * Walks the unit edges between in-mask and out-of-mask cells into closed loops. Outer loops wind one way, holes the
 * other; returned as [{ outer, holes }] through the same PolyTree union so the shape is one honest set of regions. */
export function maskRegions({ mask, nx, ny, x0, y0, cell }) {
  const has = (i, j) => i >= 0 && j >= 0 && i < nx && j < ny && !!mask[j * nx + i];
  // directed edges keyed by start corner → end corner (counter-clockwise around in-mask cells in a y-down frame
  // is irrelevant: the PolyTree normalises orientation)
  const next = new Map();
  const key = (i, j) => i * (ny + 1) + j;
  const add = (a, b) => { const k = key(a[0], a[1]); const list = next.get(k); if (list) list.push(b); else next.set(k, [b]); };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!has(i, j)) continue;
    if (!has(i, j - 1)) add([i, j], [i + 1, j]);           // top edge, left → right
    if (!has(i + 1, j)) add([i + 1, j], [i + 1, j + 1]);   // right edge, top → bottom
    if (!has(i, j + 1)) add([i + 1, j + 1], [i, j + 1]);   // bottom edge, right → left
    if (!has(i - 1, j)) add([i, j + 1], [i, j]);           // left edge, bottom → top
  }
  const rings = [];
  for (const [k, list] of next) {
    while (list.length) {
      const start = [Math.floor(k / (ny + 1)), k % (ny + 1)];
      const ring = [start];
      let cur = list.pop();
      let guard = 0;
      while (!(cur[0] === start[0] && cur[1] === start[1]) && guard++ < nx * ny * 4) {
        ring.push(cur);
        const l = next.get(key(cur[0], cur[1]));
        if (!l || !l.length) break;
        cur = l.pop();
      }
      if (ring.length >= 4) rings.push(ring.map(([i, j]) => ({ x: x0 + i * cell, y: y0 + j * cell })));
    }
  }
  // drop collinear corner points so the rings stay small, then normalise through clipper
  const slim = rings.map((r) => r.filter((p, i) => { const a = r[(i - 1 + r.length) % r.length], b = r[(i + 1) % r.length]; return !((a.x === p.x && p.x === b.x) || (a.y === p.y && p.y === b.y)); })).filter((r) => r.length >= 3);
  const paths = [];
  for (const r of slim) { const p = toPath(r); if (p.length >= 3) paths.push(p); }
  if (!paths.length) return [];
  const c = new ClipperLib.Clipper();
  c.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);
  const tree = new ClipperLib.PolyTree();
  c.Execute(ClipperLib.ClipType.ctUnion, tree, ClipperLib.PolyFillType.pftEvenOdd, ClipperLib.PolyFillType.pftEvenOdd);
  return treeToRegions(tree);
}
