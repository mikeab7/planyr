/* B<NEW-1> / B<NEW-2> — A CURB RETURN MUST STILL BE THERE AFTER THE DISSOLVE.
 *
 * ⛔ WHY THIS FILE EXISTS AND WHY IT DOES NOT MEASURE WHAT ITS SIX PREDECESSORS MEASURED.
 * The acute-side curb-return defect was reported six times and "fixed" in eight PRs. EVERY one of
 * those PRs shipped a green suite and left the defect live on planyr.io. The reason is a single
 * measurement mistake repeated in every round: the suites asserted on `teeGeometry`'s OUTPUT — the
 * raw fillet arc in `geom.returns` — which is, and always was, a complete, correctly tessellated
 * arc at every angle and radius. Nothing was ever wrong with it. What was wrong happened AFTER it,
 * in the dissolve, and no test looked there.
 *
 * MEASURED ROOT CAUSE (2026-09-18). A curb return's arc runs TANGENT into the target's edge, so the
 * road network's dissolved ring — which holds the strips and wedges ALONE, because the pad is a
 * separate element painted over it (Z_LAYER 1 against the road network's 0, planStyle.js) — carries
 * a genuine ~177 deg CUSP at that tangent point. Its incoming leg is the arc's own last tessellation
 * chord, about 1.5 ft. `collapseRingSpikes` (roadNetwork.js) convicted that vertex as a spurious
 * spike; removing it exposed the next arc vertex in the same cusp, so the pass CASCADED and ate the
 * return one chord at a time. A complete 21-point arc (fitted R 15.155 ft, RMS 0.0002 ft) went into
 * the union and came out as 5 points and a straight 18 ft chord across the corner. The identical
 * mechanism, at the identical cleanup pass, ate the reach-capped return at a road-to-road tee near
 * the through road's own END (B<NEW-2>) — there the trigger is the leftover 1.1 ft sliver of that
 * road's flat end cap beside the return's clamped overshoot lip. ONE DEFECT, TWO CALL SITES.
 *
 * SO THIS SUITE MEASURES THE OUTPUT, NOT THE INPUT, ON THREE CRITERIA THE DISPATCH NAMED:
 *   • CORNER DISTANCE — how far the finished boundary sits off the fillet's own corner. A complete
 *     return of radius R across a wedge angle phi sits exactly `R/sin(phi/2) - R` off it; a return
 *     that has been eaten leaves the boundary passing through the corner itself. This is the primary
 *     criterion because it is insensitive to where a run is judged to start and stop.
 *   • MAX SINGLE TURN along the boundary near the corner — the "fold" signature (87-108 deg measured).
 *   • ONE CONNECTED REGION — no stranded island of pavement.
 * ⛔ NEVER on whether an SVG "A" arc command exists: there is no arc command anywhere in this
 * pipeline. A correct return is a tessellated polyline, so an arc-existence check reads TRUE on a
 * destroyed return and is banned.
 *
 * ⛔ AND THE INSTRUMENT ITSELF IS ON TRIAL (FOREGROUND-OR-VOID / DRIVER-SCROLL-IS-NOT-APP-SCROLL §6).
 * The first version of this measurement re-unioned strip + wedges + pad in ONE pass and scored the
 * SHIPPED build and the fixed build IDENTICALLY — because a single union lets the pad fill the
 * return's cusp, so no spike arises, so the cleanup never cascades and every build looks clean. The
 * app paints in TWO stages and the instrument must too: dissolve the road network on its own, then
 * union the pad onto its result. `visiblePavement` below does exactly that, and the KNOWN-GOOD
 * control arm in each block exists so a run that cannot see a working return declares itself VOID
 * rather than printing a score.
 */
import { describe, it, expect } from "vitest";
import {
  polygonEdges, nearestRectEdge, teeGeometry, roadEdgeCrossing, nodeJunction,
} from "../src/workspaces/site-planner/lib/roadGeometry.js";
import { dissolveRings } from "../src/workspaces/site-planner/lib/roadNetwork.js";
import { roadStripRing, roadCurbWidth } from "../src/workspaces/site-planner/lib/siteGeometry.js";

const DEG = 180 / Math.PI;
const roadOuterHalf = (el) => Math.max(0, (+el.travelW || 0) / 2) + roadCurbWidth(el);

function segDist(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y, L = vx * vx + vy * vy;
  if (!(L > 1e-12)) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / L;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + vx * t), p.y - (a.y + vy * t));
}

/* The FINISHED pavement edge the owner sees: the road network dissolved on its own (exactly as
 * `roadNet` does in SitePlanner.jsx), then the target element unioned onto that result — never one
 * combined union, for the reason in this file's header. Pass `target: null` for a road-to-road tee. */
function visiblePavement(netRings, target) {
  const net = dissolveRings(netRings);
  if (!target) return net;
  return dissolveRings([target, ...net.map((r) => r.outer)]);
}

/* Everything a fillet promises about one corner, read off `teeGeometry`/`nodeJunction`'s own output —
 * the corner point, the wedge angle, the radius the fillet actually settled on after its reach clamp,
 * and therefore the exact distance a COMPLETE return puts between the boundary and that corner. */
function filletFacts(corner, tanThrough, tanSide, arc) {
  if (!arc || arc.length < 5) return null;
  const v1 = { x: tanThrough.x - corner.x, y: tanThrough.y - corner.y };
  const v2 = { x: tanSide.x - corner.x, y: tanSide.y - corner.y };
  const n1 = Math.hypot(v1.x, v1.y), n2 = Math.hypot(v2.x, v2.y);
  if (!(n1 > 1e-9) || !(n2 > 1e-9)) return null;
  const phi = Math.acos(Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / (n1 * n2)))) * DEG;
  const A = arc[0], B = arc[Math.floor(arc.length / 2)], C = arc[arc.length - 1];
  const den = 2 * (A.x * (B.y - C.y) + B.x * (C.y - A.y) + C.x * (A.y - B.y));
  if (Math.abs(den) < 1e-9) return null;
  const ux = ((A.x * A.x + A.y * A.y) * (B.y - C.y) + (B.x * B.x + B.y * B.y) * (C.y - A.y) + (C.x * C.x + C.y * C.y) * (A.y - B.y)) / den;
  const uy = ((A.x * A.x + A.y * A.y) * (C.x - B.x) + (B.x * B.x + B.y * B.y) * (A.x - C.x) + (C.x * C.x + C.y * C.y) * (B.x - A.x)) / den;
  const R = Math.hypot(A.x - ux, A.y - uy);
  return { corner, phi, R, arc, requiredTurn: 180 - phi, expectCorner: R / Math.sin((phi * Math.PI) / 360) - R };
}

/* What the finished boundary actually does at that corner. */
function boundaryAtCorner(outer, f) {
  let reach = 0;
  for (const p of f.arc) reach = Math.max(reach, Math.hypot(p.x - f.corner.x, p.y - f.corner.y));
  let cornerDist = Infinity;
  for (let i = 0; i < outer.length; i++) cornerDist = Math.min(cornerDist, segDist(f.corner, outer[i], outer[(i + 1) % outer.length]));
  const inW = new Set();
  for (let i = 0; i < outer.length; i++) if (Math.hypot(outer[i].x - f.corner.x, outer[i].y - f.corner.y) <= reach * 1.05) inW.add(i);
  let start = -1;
  for (const i of inW) { if (!inW.has((i - 1 + outer.length) % outer.length)) { start = i; break; } }
  if (start < 0 && inW.size) start = [...inW][0];
  const run = [];
  if (start >= 0) { let i = start; while (inW.has(i) && run.length <= inW.size) { run.push(outer[i]); i = (i + 1) % outer.length; } }
  let maxSingle = 0;
  for (let i = 1; i < run.length - 1; i++) {
    const a = run[i - 1], b = run[i], c = run[i + 1];
    const v1 = { x: b.x - a.x, y: b.y - a.y }, v2 = { x: c.x - b.x, y: c.y - b.y };
    const l1 = Math.hypot(v1.x, v1.y), l2 = Math.hypot(v2.x, v2.y);
    if (!(l1 > 1e-9) || !(l2 > 1e-9)) continue;
    const t = Math.abs(Math.atan2(v1.x * v2.y - v1.y * v2.x, v1.x * v2.x + v1.y * v2.y)) * DEG;
    if (t > maxSingle) maxSingle = t;
  }
  return { cornerDist: cornerDist === Infinity ? 0 : cornerDist, maxSingle, pts: run.length };
}

/* THE BAR, chosen from the two measured populations BEFORE any run was scored (PERCEPTUAL-PARITY §4).
 * On the SHIPPED build (9962818, carrying PR #1755) the median corner-distance ratio over a
 * 7,200-case sweep is 0.001 — the return is simply not there — and on the fixed build it is 1.001.
 * The two populations are three orders of magnitude apart, so where the line is drawn between them
 * barely matters; 0.85 leaves generous room for Clipper's centi-foot grid and the morphological
 * close, and still cannot be cleared by anything resembling a destroyed return. */
const DEPTH_RATIO_BAR = 0.85;
/* A tessellated arc never turns more than DEFAULT_TESS_DEG (6 deg) at a vertex. The FOLD this item
 * was reported for measured 87-108 deg. 40 deg sits far above the former and far below the latter. */
const FOLD_BOUND_DEG = 40;

// ---------------------------------------------------------------------------------------------
// Road into a POLYGON paving pad (B<NEW-1>)
// ---------------------------------------------------------------------------------------------

/* The dispatch's own repro: an 839x120 ft polygon paving pad, a road teeing into its long south edge
 * `angleDeg` off perpendicular, `alongEdge` ft from that edge's midpoint (a large magnitude leans the
 * junction toward the pad's own corner). Drives the REAL pipeline throughout. */
function padScenario(angleDeg, alongEdge, opts = {}) {
  const { padW = 839, padH = 120, width = 24, driveLen = 300, R = 24, flare = 0 } = opts;
  const hw = padW / 2, hh = padH / 2;
  const points = [{ x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh }];
  const edges = polygonEdges(points);
  const e = edges[0];
  const P = { x: e.mid.x + e.dir.x * alongEdge, y: e.mid.y + e.dir.y * alongEdge };
  const rad = (angleDeg * Math.PI) / 180, c = Math.cos(rad), s = Math.sin(rad);
  const dir = { x: e.outN.x * c + e.dir.x * s, y: e.outN.y * c + e.dir.y * s };
  const far = { x: P.x + dir.x * driveLen, y: P.y + dir.y * driveLen };
  const road = { type: "road", pts: [far, P], vtx: [{}, {}], travelW: width, curb: 0.5, roadClass: "aisle" };
  const hit = nearestRectEdge(P, edges, { facingOnly: false });
  const crossing = roadEdgeCrossing(far, P, edges);
  const junctionEdge = crossing ? crossing.edge : hit.edge;
  const junctionPt = crossing ? crossing.pt : P;
  const runPos = (junctionEdge.b.x - junctionPt.x) * junctionEdge.dir.x + (junctionEdge.b.y - junctionPt.y) * junctionEdge.dir.y;
  const runNeg = (junctionPt.x - junctionEdge.a.x) * junctionEdge.dir.x + (junctionPt.y - junctionEdge.a.y) * junctionEdge.dir.y;
  const geom = teeGeometry({
    T: junctionPt, throughDir: junctionEdge.dir, sideDir: { x: far.x - P.x, y: far.y - P.y },
    phT: 0, phS: roadOuterHalf(road), R: Math.min(R, Math.max(1, padH)), flare,
    curbT: 0.5, curbS: roadCurbWidth(road),
    throughAvailPos: Math.max(0, runPos), throughAvailNeg: Math.max(0, runNeg), sideAvail: driveLen - 1,
  });
  const strip = roadStripRing(road, {}, undefined, undefined);
  const visible = visiblePavement([strip, ...(geom ? geom.wedges : [])], points);
  return { geom, visible, junctionPt, padPoints: points };
}

/* Every REAL return this scenario produces (one per corner that got a genuine fillet), with what the
 * finished boundary does at it. A corner the reach clamp legitimately collapsed to a sharp corner has
 * no return to check and is skipped — and `realReturns` reports how many it found, so a block whose
 * scenario produced none says so instead of passing vacuously. */
function padReturns(sc) {
  const out = [];
  if (!sc.geom || sc.visible.length !== 1) return out;
  const outer = sc.visible[0].outer;
  for (let k = 0; k < 2; k++) {
    const f = filletFacts(sc.geom.corners[k], sc.geom.throughTangents[k], sc.geom.sideTangents[k], sc.geom.returns[k]);
    if (!f || !(f.R >= 5) || !(f.expectCorner > 0.5)) continue;
    out.push({ k, ...f, ...boundaryAtCorner(outer, f) });
  }
  return out;
}

describe("B<NEW-1> — an oblique road into a polygon paving pad keeps its acute-side curb return", () => {
  it("KNOWN-GOOD CONTROL ARM: a plain perpendicular connect shows a full-depth return on BOTH sides — if this fails the run is VOID, not a finding", () => {
    const rs = padReturns(padScenario(0, 0, { width: 24, R: 24 }));
    expect(rs.length, "the control must produce two real returns; a run that cannot see a working return cannot judge a broken one").toBe(2);
    for (const r of rs) {
      expect(r.cornerDist / r.expectCorner, `control corner ${r.k}: depth ${r.cornerDist.toFixed(3)} of ${r.expectCorner.toFixed(3)} ft`).toBeGreaterThan(DEPTH_RATIO_BAR);
      expect(r.maxSingle, `control corner ${r.k}: no fold`).toBeLessThan(FOLD_BOUND_DEG);
    }
  });

  it("RED PROOF — the dispatch's own four measured cases (25.46 deg and 34.49 deg, leaning either way) each show a FULL-DEPTH, unfolded return on both sides", () => {
    for (const angleDeg of [25.46, 34.49]) {
      for (const alongEdge of [-380, 380]) {
        const sc = padScenario(angleDeg, alongEdge, { width: 24, R: 24 });
        expect(sc.visible.length, `angle ${angleDeg} along ${alongEdge}: one connected pavement region`).toBe(1);
        const rs = padReturns(sc);
        expect(rs.length, `angle ${angleDeg} along ${alongEdge}: two real returns expected`).toBe(2);
        for (const r of rs) {
          // On the shipped build this ratio measured 0.001-0.075 here: the boundary ran straight
          // through the corner because the arc had been eaten out of the dissolved ring.
          expect(r.cornerDist / r.expectCorner,
            `angle ${angleDeg} along ${alongEdge} corner ${r.k} (phi ${r.phi.toFixed(2)} deg, R ${r.R.toFixed(3)} ft): the boundary must stand ${r.expectCorner.toFixed(3)} ft off the corner for a complete return; measured ${r.cornerDist.toFixed(3)} ft`)
            .toBeGreaterThan(DEPTH_RATIO_BAR);
          expect(r.maxSingle,
            `angle ${angleDeg} along ${alongEdge} corner ${r.k}: no vertex may carry a fold (87-108 deg measured pre-fix); found ${r.maxSingle.toFixed(2)} deg`)
            .toBeLessThan(FOLD_BOUND_DEG);
        }
      }
    }
  });

  it("the whole oblique sweep, both leans, four widths, four radii — every real return keeps its full depth and no region strands", () => {
    let checked = 0;
    for (const width of [16, 24, 36, 48]) {
      for (const R of [10, 15, 24, 40]) {
        for (const alongEdge of [-380, 0, 380]) {
          for (let a = 0; a <= 89; a += 3) {
            const sc = padScenario(a, alongEdge, { width, R });
            expect(sc.visible.length, `w${width} R${R} along ${alongEdge} angle ${a}: one connected region`).toBe(1);
            for (const r of padReturns(sc)) {
              // A requested radius far larger than the drive is wide puts the fillet's own tangent
              // points past the drive's far edge, where the opposite return legitimately clips it —
              // real geometry, not a lost return. Those cases are checked for FOLDS only.
              if (r.expectCorner <= roadOuterHalf({ travelW: width, curb: 0.5 })) {
                expect(r.cornerDist / r.expectCorner,
                  `w${width} R${R} along ${alongEdge} angle ${a} corner ${r.k}: depth ${r.cornerDist.toFixed(3)} of ${r.expectCorner.toFixed(3)} ft`)
                  .toBeGreaterThan(DEPTH_RATIO_BAR);
                checked++;
              }
              expect(r.maxSingle, `w${width} R${R} along ${alongEdge} angle ${a} corner ${r.k}: fold ${r.maxSingle.toFixed(1)} deg`).toBeLessThan(FOLD_BOUND_DEG);
            }
          }
        }
      }
    }
    expect(checked, "VACUITY GUARD: a sweep that checked no depths proves nothing").toBeGreaterThan(500);
  });

  /* ⛔ A FLARED junction carries its OWN, SEPARATE, PRE-EXISTING defect, and this block deliberately
   * does not assert it away — folding it in here is exactly the scope creep that kept this family
   * open for six rounds. A flare widens the fillet's anchor line to `phS + flare`, off the drive's
   * REAL edge, and no build has ever tapered back to it. MEASURED at 36 ft wide, R 24, this cleanup
   * fix applied in all three columns so only the wedge builder differs (corner-0 depth in ft against
   * what a complete return needs, and the worst single turn on the finished boundary):
   *
   *            flare 0            flare 4                    flare 10
   *   pre-#1755  9.96/9.94  7deg   3.76/11.84  169deg         7.86/11.84  158deg
   *   PR #1755   9.96/9.94  7deg  13.24/13.23  145deg        13.23/13.23  140deg
   *
   * Unflared, every build is exact and clean; flared, every build is wrong, in different ways. That
   * is a different defect with a different cause (no taper from the flared mouth back to the drive's
   * own edge) and it is filed on its own — see BACKLOG.md. What this block asserts is the part this
   * item owns and did change: a flared junction still dissolves to ONE region. It used to be able to
   * strand its wedge as a separate island, and the cleanup fix must not reintroduce that. */
  it("a FLARED junction still dissolves to one connected region (its own un-tapered throat is a separate, pre-existing item)", () => {
    let checked = 0;
    for (const flare of [4, 10]) {
      for (const a of [0, 15, 25.46, 34.49, 45, 60]) {
        const sc = padScenario(a, 0, { width: 36, R: 24, flare });
        expect(sc.visible.length, `flare ${flare} angle ${a}: one connected region`).toBe(1);
        checked++;
      }
    }
    expect(checked, "VACUITY GUARD").toBe(12);
  });
});

// ---------------------------------------------------------------------------------------------
// Road-to-road tee near the through road's own END (B<NEW-2>) — the same defect, the other call site
// ---------------------------------------------------------------------------------------------

const bearing = (d) => ({ x: Math.cos((d * Math.PI) / 180), y: Math.sin((d * Math.PI) / 180) });

/* A tee on a through road that CONTINUES only `shortEndFt` past the node — the configuration the
 * dispatch measured (a 23.6 ft stub gave a return covering -44.97 deg of a required 90 deg in 8
 * segments, closing with a single 29.19 deg kink; note how close that kink sits under
 * `RING_SPIKE_TURN_DEG` = 30 deg, which is the cascade's own fingerprint: it ate the arc until the
 * reversal it was chasing finally dropped below its threshold). */
function endTeeScenario(shortEndFt, sideDeg = 90, opts = {}) {
  const { throughW = 36, sideW = 24, R = 24 } = opts;
  const N = { x: 0, y: 0 };
  const through = { type: "road", pts: [{ x: -300, y: 0 }, { x: shortEndFt, y: 0 }], vtx: [{}, {}], travelW: throughW, curb: 0.5, roadClass: "aisle" };
  const sideFar = { x: bearing(sideDeg).x * 300, y: bearing(sideDeg).y * 300 };
  const side = { type: "road", pts: [N, sideFar], vtx: [{}, {}], travelW: sideW, curb: 0.5, roadClass: "aisle" };
  const arms = [
    { dir: bearing(180), half: throughW / 2 + 0.5, avail: 300, road: "G" },
    { dir: bearing(0), half: throughW / 2 + 0.5, avail: shortEndFt, road: "G" },
    { dir: bearing(sideDeg), half: sideW / 2 + 0.5, avail: 300, road: "S" },
  ];
  const nj = nodeJunction({ node: N, arms, R });
  const strips = [roadStripRing(through, {}, new Set(), undefined), roadStripRing(side, {}, new Set(), undefined)];
  return { nj, visible: visiblePavement([...strips, ...((nj && nj.wedges) || [])], null) };
}

function teeReturns(sc) {
  const out = [];
  if (!sc.nj || sc.visible.length !== 1) return out;
  const outer = sc.visible[0].outer;
  for (const g of sc.nj.gaps) {
    const f = filletFacts(g.corner, g.tanA, g.tanB, g.arc);
    if (!f || !(f.R >= 3) || !(f.expectCorner > 0.3)) continue;
    out.push({ ...f, ...boundaryAtCorner(outer, f) });
  }
  return out;
}

describe("B<NEW-2> — a reach-capped return at a road's own end is no longer truncated", () => {
  it("KNOWN-GOOD CONTROL ARM: a tee far from either end shows full-depth returns — VOID otherwise", () => {
    const rs = teeReturns(endTeeScenario(300));
    expect(rs.length, "the control must produce real returns").toBeGreaterThan(1);
    for (const r of rs) {
      expect(r.cornerDist / r.expectCorner, `control gap (phi ${r.phi.toFixed(1)}): depth ${r.cornerDist.toFixed(3)} of ${r.expectCorner.toFixed(3)}`).toBeGreaterThan(DEPTH_RATIO_BAR);
    }
  });

  it("RED PROOF — the dispatch's own 23.6 ft stub, and the whole short-end range, keep a full-depth return with no closing kink", () => {
    for (const shortEnd of [23.6, 15, 20, 30, 42.4, 60]) {
      const sc = endTeeScenario(shortEnd);
      expect(sc.visible.length, `stub ${shortEnd} ft: one connected region`).toBe(1);
      const rs = teeReturns(sc);
      // A very short stub legitimately starves the end-side fillet below a measurable radius, so it
      // resolves to an honest sharp corner and there is no return to check on that side.
      expect(rs.length, `stub ${shortEnd} ft: at least one real return expected`).toBeGreaterThan(0);
      for (const r of rs) {
        expect(r.cornerDist / r.expectCorner,
          `stub ${shortEnd} ft, gap phi ${r.phi.toFixed(1)} deg R ${r.R.toFixed(3)} ft: the boundary must stand ${r.expectCorner.toFixed(3)} ft off the corner; measured ${r.cornerDist.toFixed(3)} ft`)
          .toBeGreaterThan(DEPTH_RATIO_BAR);
        expect(r.maxSingle, `stub ${shortEnd} ft: closing kink ${r.maxSingle.toFixed(2)} deg`).toBeLessThan(FOLD_BOUND_DEG);
      }
    }
  });

  it("MUST-NOT-REGRESS — the oblique road-to-road tee that already solved this geometry correctly (30.31 deg) is unchanged, and the whole oblique range holds", () => {
    let checked = 0;
    for (const sideDeg of [30.31, 15, 45, 60, 90, 120, 150]) {
      for (const shortEnd of [300, 42.4, 23.6]) {
        const sc = endTeeScenario(shortEnd, sideDeg);
        expect(sc.visible.length, `side ${sideDeg} stub ${shortEnd}: one region`).toBe(1);
        for (const r of teeReturns(sc)) {
          expect(r.cornerDist / r.expectCorner, `side ${sideDeg} stub ${shortEnd} phi ${r.phi.toFixed(1)}: depth ratio`).toBeGreaterThan(DEPTH_RATIO_BAR);
          expect(r.maxSingle, `side ${sideDeg} stub ${shortEnd}: fold`).toBeLessThan(FOLD_BOUND_DEG);
          checked++;
        }
      }
    }
    expect(checked, "VACUITY GUARD").toBeGreaterThan(20);
  });
});
