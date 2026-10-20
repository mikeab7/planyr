/* buildingOutline — ONE footprint ring for a building TOGETHER WITH its corner bump-outs (NEW-1, 2026-10-19).
 *
 * A corner bump-out ("dog-ear", lib/dogEar.js) is stored as its own element — type "building", a `dogEar` tag,
 * `attachedTo` its host — and `dogEarGeom` keeps it flush against the host's corner, so the host rectangle and
 * its bump-out rectangles always touch along a shared edge. For every surface that treats the building as ONE
 * thing (the editable-PDF Polygon annotation is the first consumer) this module unions those rectangles into a
 * single outer ring, with the collinear corner the flush edge creates removed, so a 55′×60′ bump at each end of
 * a dock wall yields the eight-vertex outline a draughtsman would draw.
 *
 * Membership follows the grading layer's rule (lib/gradingMembership.js `isPadMember`): a bump-out is a pad
 * member of its host, never a building of its own — `bumpOutsOf` is the same test, read from the element list
 * at the point of use. Pure, no DOM, clipper-lib (this repo's polygon engine) under the same centi-foot grid
 * roadNetwork.js / pondOffset.js use.
 */
import ClipperLib from "clipper-lib";
import { isDogEarSide } from "./dogEar.js";

const SCALE = 100;             // feet → centi-feet, matching roadNetwork.js / pondOffset.js / polyClip.js
const CLEAN_DELTA = SCALE * 0.01;
const finite = (v) => Number.isFinite(v);
const finiteBox = (e) => !!e && finite(e.cx) && finite(e.cy) && finite(e.w) && finite(e.h) && e.w > 0 && e.h > 0;
const rot2 = (x, y, deg) => { const r = ((deg || 0) * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r); return { x: x * c - y * s, y: x * s + y * c }; };

/** The four corners of a rect element, rotated about its centre — the same derivation siteGeometry.elCorners uses. */
export function rectCorners(el) {
  const hw = el.w / 2, hh = el.h / 2;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([lx, ly]) => { const p = rot2(lx, ly, el.rot); return { x: el.cx + p.x, y: el.cy + p.y }; });
}

/** Every corner bump-out bonded to `host` in `els` (a real dock-wall side and a finite box; anything else is left alone). */
export function bumpOutsOf(els, host) {
  if (!host || host.type !== "building" || host.dogEar || host.points) return [];
  return (els || []).filter((x) => x && x.type === "building" && x.dogEar && x.attachedTo === host.id && isDogEarSide(x.dogEar.side) && finiteBox(x));
}

const toPath = (ring) => ring.map((p) => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) }));
const fromPath = (path) => path.map((c) => ({ x: c.X / SCALE, y: c.Y / SCALE }));
const pointInRing = (p, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};

/**
 * The building's outline including its bump-outs, as one ring in feet.
 *
 * Returns { ring, members, detached }:
 *   ring     — the host's own ring when it has no bump-outs (its stored `points`, else its four corners), otherwise
 *              the union's outer ring (collinear points dropped);
 *   members  — the ids of the bump-outs that are part of `ring`;
 *   detached — the ids of any bump-out the union could not join to the host (it does not touch it — a tampered
 *              record; dogEarGeom never produces one). Such a bump-out is NOT in `ring`; the caller decides what to
 *              say about it. LOUD by construction: never a silent drop.
 */
export function buildingOutlineRing(host, bumps) {
  const own = Array.isArray(host.points) && host.points.length >= 3 ? host.points.map((p) => ({ x: p.x, y: p.y })) : finiteBox(host) ? rectCorners(host) : [];
  const list = (bumps || []).filter(finiteBox);
  if (!own.length || !list.length) return { ring: own, members: [], detached: list.map((b) => b.id) };
  try {
    /* The union is taken in the HOST'S OWN FRAME (un-rotated about its centre). A bump-out shares the host's
       rotation, so there every piece is an axis-aligned rectangle and the shared edge snaps to the same
       centi-foot line on both sides; rounding the rotated world corners instead leaves hair gaps and the
       union comes back as separate pieces (measured at 33°). */
    const rot = host.rot || 0;
    const toLocal = (p) => { const q = rot2(p.x - host.cx, p.y - host.cy, -rot); return { x: q.x, y: q.y }; };
    const toWorld = (p) => { const q = rot2(p.x, p.y, rot); return { x: host.cx + q.x, y: host.cy + q.y }; };
    const clip = new ClipperLib.Clipper();
    const add = (ring) => {
      const path = ClipperLib.Clipper.CleanPolygon(toPath(ring.map(toLocal)), CLEAN_DELTA);
      if (path.length < 3) return;
      if (ClipperLib.Clipper.Area(path) < 0) path.reverse(); // one winding, or a counter-wound bump would SUBTRACT
      clip.AddPath(path, ClipperLib.PolyType.ptSubject, true);
    };
    add(own);
    list.forEach((b) => add(rectCorners(b)));
    const merged = new ClipperLib.Paths();
    clip.Execute(ClipperLib.ClipType.ctUnion, merged, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
    const outers = merged.filter((p) => ClipperLib.Clipper.Area(p) > 0);
    if (!outers.length) return { ring: own, members: [], detached: list.map((b) => b.id) };
    // The host's outline is the outer ring that holds the host's centre (a detached bump-out is its own outer).
    const origin = { X: 0, Y: 0 };
    let main = outers.find((p) => ClipperLib.Clipper.PointInPolygon(origin, p) !== 0) || outers.reduce((a, p) => (ClipperLib.Clipper.Area(p) > ClipperLib.Clipper.Area(a) ? p : a), outers[0]);
    main = ClipperLib.Clipper.CleanPolygon(main, CLEAN_DELTA); // drops the collinear corner the flush edge leaves
    const local = fromPath(main);
    const members = [], detached = [];
    for (const b of list) (pointInRing(toLocal({ x: b.cx, y: b.cy }), local) ? members : detached).push(b.id);
    return { ring: local.map(toWorld), members, detached };
  } catch (_) {
    return { ring: own, members: [], detached: list.map((b) => b.id) };
  }
}
