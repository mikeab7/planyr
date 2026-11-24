/* The road RIGHT-OF-WAY band (owner, 2026-11-24: "I should be able to edit the right-of-way boundary … maybe it should be
 * opaque up to the right-of-way boundary … right now the edge of a street, if there's right-of-way, it's just gray and it's
 * kind of hard to see").
 *
 * What this module decides, once per model change (VIEW-INDEPENDENT-ONCE — feet in, feet out, nothing here reads the view):
 *   • each road's two ROW LINES, one per side, at that side's own distance from the centerline (an uneven ROW is a real
 *     dedication: `designatedRowSides`), following the SAME trimmed, tapered centerline the pavement is built from;
 *   • each road's ROW BAND — the ground between those two lines — which the planner paints as ONE solid underlay beneath
 *     every drawn element (so the band never covers anything you drew, and every road's pavement, curb and markings sit on
 *     it); the pavement hides the middle, so what shows is exactly "pavement edge out to the ROW line";
 *   • where ROWs MEET: a road's ROW line stops where it enters another road's ROW band or pavement, the way a plat draws an
 *     intersection (the through road's line is interrupted by the cross street, the cross street's line ends at the through
 *     road's line). Clipped with the same by-value-cached clipper routine the curb stripes use (`clipPolylineOutside`).
 *
 * A road whose ROW is not valid (bands reaching past the ROW line on a side — `rowMarginFt` null, the dialog's loud state)
 * draws neither, exactly as before. Pure and DOM-free: unit-tested in test/roadRowBand.test.js. */
import { offsetPolyline } from "./metesAndBounds.js";
import { taperedOffset } from "./roadTaper.js";
import { clipPolylineOutside } from "./roadNetwork.js";
import { designatedRowSides, rowMarginFt, bandExtents, xsectionFromRoad } from "./roadCrossSection.js";
import { roadCurbWidth } from "./siteGeometry.js";

/* One side's ROW line: the centerline offset by `sign · ft`, narrowing with the road at a tapered end (the ROW lines taper
 * only against a narrow road that designates a ROW of its own — `rowHalf`; with none there is nothing to meet). */
export function rowSideLine(dense, taper, ft, sign) {
  if (!Array.isArray(dense) || dense.length < 2 || !(ft > 0)) return null;
  return (taper && taperedOffset(dense, taper, ft, sign, "rowHalf")) || offsetPolyline(dense, sign * ft);
}

/* The band polygon between the two ROW lines (left line forward, right line back). null when either line is missing. */
export function rowBandRing(lineL, lineR) {
  if (!lineL || !lineR || lineL.length < 2 || lineR.length < 2) return null;
  return [...lineL.map((p) => ({ x: p.x, y: p.y })), ...lineR.slice().reverse().map((p) => ({ x: p.x, y: p.y }))];
}

const bbox = (pts) => pts.reduce((a, p) => ({ x0: Math.min(a.x0, p.x), y0: Math.min(a.y0, p.y), x1: Math.max(a.x1, p.x), y1: Math.max(a.y1, p.y) }),
  { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
const overlaps = (a, b) => !(a.x1 < b.x0 || a.x0 > b.x1 || a.y1 < b.y0 || a.y0 > b.y1);

/* Every visible road's ROW, as Map<roadId, { sides:{left,right}, total, lineL, lineR, band, linesL:[[pt]], linesR:[[pt]] }>.
 *   roads    — the visible centerline roads (the network's own member list)
 *   denseOf  — (road) → its trimmed centerline (feet), the one the pavement is built from
 *   taperOf  — (road) → its taper plan or undefined
 *   pavingOf — (road) → its pavement (back-of-curb) ring, a cutter for OTHER roads' ROW lines
 * `lineL`/`lineR` are the whole unclipped lines (the drag grips and the band read them); `linesL`/`linesR` are what draws. */
export function roadRowGeometry({ roads, denseOf, taperOf, pavingOf }) {
  const out = new Map();
  const list = Array.isArray(roads) ? roads : [];
  for (const r of list) {
    const x = r && r.xsection;
    if (!x) continue;
    const sides = designatedRowSides(x);
    if (!sides || rowMarginFt(x) == null) continue;
    const dense = denseOf(r);
    if (!dense || dense.length < 2) continue;
    const taper = taperOf ? taperOf(r) : undefined;
    const lineL = rowSideLine(dense, taper, sides.left, 1);
    const lineR = rowSideLine(dense, taper, sides.right, -1);
    const band = rowBandRing(lineL, lineR);
    out.set(r.id, { sides, total: sides.left + sides.right, lineL, lineR, band, bb: band ? bbox(band) : null });
  }
  // Clip each road's lines against every OTHER road's ROW band and pavement that comes near it.
  const pav = new Map();
  for (const r of list) { const ring = pavingOf ? pavingOf(r) : null; if (ring && ring.length >= 3) pav.set(r.id, { ring, bb: bbox(ring) }); }
  for (const [id, g] of out) {
    const cutters = [];
    if (g.bb) {
      for (const [oid, o] of out) if (oid !== id && o.band && o.bb && overlaps(g.bb, o.bb)) cutters.push(o.band);
      for (const [oid, p] of pav) if (oid !== id && overlaps(g.bb, p.bb)) cutters.push(p.ring);
    }
    const clip = (line) => (!line ? [] : cutters.length ? clipPolylineOutside(line, cutters) : [line]);
    g.linesL = clip(g.lineL);
    g.linesR = clip(g.lineR);
  }
  return out;
}

/* How close to the centerline a side's ROW line may be dragged or typed: never inside the modeled section on that side (the
 * bands' own reach — `bandExtents`), and never inside the back of curb of a plain road. Whole feet up, so a typed or dragged
 * value at the floor is always valid. */
export function rowSideMinFt(el, sign) {
  const x = el && el.xsection ? el.xsection : xsectionFromRoad(el || {});
  const ext = bandExtents(x);
  const half = Math.max(0, (+el?.travelW || 0) / 2) + roadCurbWidth(el || {});
  return Math.ceil(Math.max(sign > 0 ? ext.left : ext.right, half) * 100) / 100;
}

/* Where along the centerline a point is, and how far it sits to the LEFT (+) of it: the nearest segment's foot and the
 * signed perpendicular distance — the number a ROW-line drag turns into that side's width. */
export function signedOffsetFrom(dense, p) {
  if (!Array.isArray(dense) || dense.length < 2 || !p) return null;
  let best = null;
  for (let i = 1; i < dense.length; i++) {
    const a = dense[i - 1], b = dense[i];
    const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
    if (!(L2 > 0)) continue;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2));
    const fx = a.x + dx * t, fy = a.y + dy * t;
    const d = Math.hypot(p.x - fx, p.y - fy);
    if (!best || d < best.d) {
      const L = Math.sqrt(L2);
      const nx = -dy / L, ny = dx / L;                // left normal, the sign every offset here uses
      best = { d, signed: (p.x - fx) * nx + (p.y - fy) * ny };
    }
  }
  return best ? best.signed : null;
}

/* A side's plain-English name for the panel: the compass side it lies on, judged from the road's overall direction (first
 * point to last). The plan's feet frame has y growing DOWN the screen (north up), so the left normal of an east-running road
 * points south. Diagonal roads name the nearer of the four. */
export function rowSideCompass(dense, sign) {
  if (!Array.isArray(dense) || dense.length < 2) return sign > 0 ? "Left" : "Right";
  const a = dense[0], b = dense[dense.length - 1];
  let dx = b.x - a.x, dy = b.y - a.y;
  if (!(Math.hypot(dx, dy) > 1e-6)) return sign > 0 ? "Left" : "Right";
  const nx = -dy * sign, ny = dx * sign;
  if (Math.abs(nx) >= Math.abs(ny)) return nx > 0 ? "East" : "West";
  return ny > 0 ? "South" : "North";
}
