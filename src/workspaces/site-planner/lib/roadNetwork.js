/* Dissolved road-network surface — the road connection rendered as TOPOLOGY, not as a patch.
 *
 * Why this module exists (NEW-1 / NEW-2, superseding B945/B946/B949/B953/B964/B971/B989/B1005/B1006).
 * Every prior fix drew each road as its own strip and then painted a "cover" over the junction to hide
 * the place where two strips butt. That approach can never be right, because the artifacts are not
 * decoration — they are the geometry:
 *   • the side road's strip really does continue past the through road's curb line all the way to the
 *     through CENTERLINE, so its flat end cap and its two back-of-curb strokes really are sitting on the
 *     through road's pavement. That is the owner's "a rectangle intersecting a rectangle";
 *   • the through road's own back-of-curb stroke really does run straight across the mouth;
 *   • two semi-transparent strips really do double where they overlap, so the junction reads darker.
 * A patch can only ever hide those where the patch happens to land, which is why the defect came back
 * on every topology the patch wasn't tuned for (curved through-road, oblique road-to-road tee).
 *
 * The fix: DISSOLVE. A junction is a boolean UNION of the pavement pieces that meet there —
 *   [each road's back-of-curb strip ring] ∪ [each junction's additive curb-return wedges] ∪ [weld patches]
 * — computed with clipper-lib (already this repo's engine for robust polygon ops: pondOffset.js,
 * polyClip.js). The result is ONE region per connected cluster, so the renderer paints one fill at one
 * opacity and strokes one continuous curb line. There is no seam to hide, nothing to knock out of a
 * mask, and no fill stacking — at any angle, on straight or curved roads, road-to-road or road-to-drive.
 *
 * Pure: world feet in, world feet out. No React, no DOM. Unit-tested in test/roadNetwork.test.js.
 */
import ClipperLib from "clipper-lib";
import { pointInRing } from "./ringMath.js";

const SCALE = 100;            // feet → centi-feet (~1/8"), matching pondOffset.js / polyClip.js
const CLEAN_DELTA = SCALE * 0.01;

const toPath = (ring) => ring.map((p) => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) }));
const fromPath = (path) => path.map((c) => ({ x: c.X / SCALE, y: c.Y / SCALE }));
const isRing = (r) => Array.isArray(r) && r.length >= 3 && r.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
const isLine = (l) => Array.isArray(l) && l.length >= 2 && l.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));

/* Morphological CLOSE (dilate by `d`, erode by `d`) of a set of paths, with MITER joins so a real
 * square corner comes back square and only sub-`d` junk is removed.
 *
 * Why the dissolve needs it: the pieces being unioned come from two different generators. A road strip
 * is a TESSELLATED buffer of the centerline; a curb-return wedge is solved analytically. Where they are
 * supposed to share an edge they can miss by a fraction of an inch (tessellation sagitta on a curve, the
 * flat end cap sitting a few hundredths past the corner, plain rounding onto clipper's centi-foot grid).
 * Union alone then leaves hair-thin SLIVERS inside the junction — 6–20 sf holes a few inches wide, which
 * stroke as exactly the kind of faint seam this whole change exists to kill — and occasionally leaves a
 * return floating as its own island because it only TOUCHED the strip instead of overlapping it. A close
 * at a fraction of a foot is far below anything real on a road (the narrowest true feature is a 6" curb)
 * and removes that entire class of numerical junk. */
const CLOSE_FT = 0.4;
function closePaths(paths, d) {
  if (!(d > 0)) return paths;
  const grow = new ClipperLib.ClipperOffset(10, CLEAN_DELTA);
  grow.AddPaths(paths, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
  const bigger = new ClipperLib.Paths();
  grow.Execute(bigger, d * SCALE);
  const shrink = new ClipperLib.ClipperOffset(10, CLEAN_DELTA);
  shrink.AddPaths(bigger, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
  const back = new ClipperLib.Paths();
  shrink.Execute(back, -d * SCALE);
  return back && back.length ? back : paths;
}

/* Union `rings` (world-feet closed polygons) into dissolved regions.
 * Returns [{ outer, holes: [ring…] }, …] — one entry per resulting region, holes separated so a caller
 * can emit an even-odd path. Returns [] for no valid input; on any clipper failure it degrades to the
 * input rings as separate regions (a visible but honest fallback — never a blank canvas). */
export function dissolveRings(rings, opts = {}) {
  const valid = (rings || []).filter(isRing);
  if (!valid.length) return [];
  if (valid.length === 1) return [{ outer: valid[0].map((p) => ({ x: p.x, y: p.y })), holes: [] }];
  const close = Number.isFinite(opts.close) ? opts.close : CLOSE_FT;
  try {
    const clip = new ClipperLib.Clipper();
    for (const r of valid) {
      const path = ClipperLib.Clipper.CleanPolygon(toPath(r), CLEAN_DELTA);
      if (path.length < 3) continue;
      // NORMALISE ORIENTATION before unioning. The pieces come from different generators — a strip ring
      // from bufferPolyline, a curb-return wedge from teeGeometry — and nothing guarantees they wind the
      // same way. Under the non-zero fill rule two overlapping rings of OPPOSITE winding cancel to
      // nothing, so an oppositely-wound return wedge punches a HOLE in the pavement exactly where it was
      // meant to add some. (That is a silent, geometry-shaped bug: the union still "works", it just
      // subtracts. Cheap to prevent, expensive to chase.) Same guard pondOffset.js uses.
      if (ClipperLib.Clipper.Area(path) < 0) path.reverse();
      clip.AddPath(path, ClipperLib.PolyType.ptSubject, true);
    }
    const merged = new ClipperLib.Paths();
    clip.Execute(ClipperLib.ClipType.ctUnion, merged, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
    // Re-union the closed result so holes/outers come back as a proper PolyTree.
    const clip2 = new ClipperLib.Clipper();
    clip2.AddPaths(closePaths(merged, close), ClipperLib.PolyType.ptSubject, true);
    const tree = new ClipperLib.PolyTree();
    clip2.Execute(ClipperLib.ClipType.ctUnion, tree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
    const out = [];
    // Walk the PolyTree so holes stay attached to the region that owns them (a road loop encircling
    // an island is a real case: the pond loop road). Depth 0/2/4… are outers, 1/3/5… are holes.
    const walk = (node) => {
      for (const child of node.Childs()) {
        if (child.IsHole()) continue;
        const outer = fromPath(child.Contour());
        const holes = [];
        for (const h of child.Childs()) {
          if (!h.IsHole()) continue;
          const hr = fromPath(h.Contour());
          if (hr.length >= 3) holes.push(hr);
          walk(h); // an island inside the hole is its own region
        }
        if (outer.length >= 3) out.push({ outer, holes });
      }
    };
    walk(tree);
    return out.length ? out : valid.map((r) => ({ outer: r, holes: [] }));
  } catch {
    return valid.map((r) => ({ outer: r.map((p) => ({ x: p.x, y: p.y })), holes: [] }));
  }
}

/* Trim an OPEN polyline to the part that lies OUTSIDE every ring in `rings`.
 * This is how a road's inner curb stripe stops at a junction instead of running through it: each road's
 * stripes are clipped against the OTHER pieces of the junction, so the stripe ends at the pavement it
 * runs into. Returns an array of surviving polyline segments (possibly empty). Falls back to the whole
 * line if clipper can't process it — a stripe that runs slightly long beats a stripe that vanishes. */
export function clipPolylineOutside(line, rings) {
  if (!isLine(line)) return [];
  const whole = () => [line.map((p) => ({ x: p.x, y: p.y }))];
  const cutters = (rings || []).filter(isRing);
  if (!cutters.length) return whole();
  // Cheap bbox reject first — most stripes on a plan come nowhere near a junction, and clipper's
  // open-path difference returns NOTHING (rather than the untouched subject) when a clip is disjoint,
  // which would silently delete the stripe.
  const bb = (pts) => pts.reduce((a, p) => ({ x0: Math.min(a.x0, p.x), y0: Math.min(a.y0, p.y), x1: Math.max(a.x1, p.x), y1: Math.max(a.y1, p.y) }),
    { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
  const lb = bb(line);
  const near = cutters.filter((r) => { const c = bb(r); return !(c.x1 < lb.x0 || c.x0 > lb.x1 || c.y1 < lb.y0 || c.y0 > lb.y1); });
  if (!near.length) return whole();
  try {
    const clip = new ClipperLib.Clipper();
    clip.AddPath(toPath(line), ClipperLib.PolyType.ptSubject, false); // false = OPEN path
    for (const r of near) {
      const path = ClipperLib.Clipper.CleanPolygon(toPath(r), CLEAN_DELTA);
      if (path.length < 3) continue;
      if (ClipperLib.Clipper.Area(path) < 0) path.reverse();
      clip.AddPath(path, ClipperLib.PolyType.ptClip, true);
    }
    const tree = new ClipperLib.PolyTree();
    clip.Execute(ClipperLib.ClipType.ctDifference, tree, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
    const open = ClipperLib.Clipper.OpenPathsFromPolyTree(tree);
    const out = [];
    for (const p of open || []) { const seg = fromPath(p); if (seg.length >= 2) out.push(seg); }
    // Nothing came back AND no vertex of the line lies inside a cutter → clipper dropped a subject it
    // never actually clipped. Keep the stripe rather than silently erasing it.
    if (!out.length && !line.some((p) => near.some((r) => pointInRing(p, r)))) return whole();
    return out;
  } catch {
    return whole();
  }
}

/* NEW-1 (junction outline-cut rotation) — the INTERRUPTED outline of a RECT element a drive tees into.
 *
 * A road that tees into a parking field / truck court / paving pad is not pavement the field can
 * dissolve with (the field has its own fill), so instead of merging we INTERRUPT the field's own
 * outline where the drive's pavement crosses it — the entrance then reads as one continuous curb
 * instead of a line ruled across the mouth.
 *
 * ⚠ FRAME: the returned polylines are in WORLD feet with `el.rot` ALREADY BAKED IN (the corners are
 * built by rotating the local half-extents about the element centre). The canvas draws a rect element
 * inside a `rotate(el.rot, c)` group, so a consumer MUST counter-rotate these polylines by `-el.rot`
 * — exactly like the pond baseline ghost and the stage contours already do. Skipping that applies the
 * rotation twice: at rot 90/270 the doubled 540° ≡ 180° draws a w×h footprint as h×w about the same
 * centre, throwing element-coloured lines far outside the true footprint. That was the bug.
 *
 * `cutters` are the dissolved pavement rings of the drive; with none, the full (uninterrupted) outline
 * comes back. Pure: world feet in, world feet out. */
export function rectOutlineCutSegments(el, cutters) {
  if (!el || el.points || !(el.w > 0) || !(el.h > 0) || typeof el.cx !== "number" || typeof el.cy !== "number") return [];
  const rad = ((el.rot || 0) * Math.PI) / 180, c = Math.cos(rad), s = Math.sin(rad);
  const corner = (lx, ly) => ({ x: el.cx + (lx * c - ly * s), y: el.cy + (lx * s + ly * c) });
  const cs = [corner(-el.w / 2, -el.h / 2), corner(el.w / 2, -el.h / 2), corner(el.w / 2, el.h / 2), corner(-el.w / 2, el.h / 2)];
  const out = [];
  for (let e = 0; e < 4; e++) for (const seg of clipPolylineOutside([cs[e], cs[(e + 1) % 4]], cutters)) if (seg.length >= 2) out.push(seg);
  return out;
}

/* Connected-cluster labelling over a set of ids and the pairs that connect them (a tee, a weld, a
 * shared drive junction). Returns Map<id, clusterIndex>. Ids with no pair still get their own cluster,
 * so a lone road is simply a one-member cluster and takes the identical render path. */
export function clusterIds(ids, pairs) {
  const parent = new Map((ids || []).map((id) => [id, id]));
  const find = (a) => { let r = a; while (parent.get(r) !== r) r = parent.get(r); while (parent.get(a) !== r) { const n = parent.get(a); parent.set(a, r); a = n; } return r; };
  for (const [a, b] of pairs || []) {
    if (!parent.has(a) || !parent.has(b)) continue;
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  const index = new Map();
  const order = new Map();
  for (const id of ids || []) {
    const root = find(id);
    if (!order.has(root)) order.set(root, order.size);
    index.set(id, order.get(root));
  }
  return index;
}

/* SVG path data (world feet → screen via `f2p`) for a dissolved region, holes punched with even-odd. */
export function regionPathD(region, f2p) {
  if (!region || !isRing(region.outer)) return null;
  const ringD = (r) => r.map((p, i) => { const q = f2p(p); return `${i ? "L" : "M"}${q.x},${q.y}`; }).join(" ") + "Z";
  return [ringD(region.outer), ...(region.holes || []).filter(isRing).map(ringD)].join(" ");
}
