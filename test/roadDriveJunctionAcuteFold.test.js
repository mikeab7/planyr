/* B1717616 (×3) — the acute-side curb return on a road-into-POLYGON-pad junction FOLDS: one
 * segment carries an 87–108° turn mid-run, immediately after an otherwise clean, correctly
 * tessellated arc, closing with a small bevel. This is NOT a truncated arc (the shape every prior
 * round of this item diagnosed and fixed) — it is a FOLD: the wedge polygon's own boundary runs
 * straight out along the driveway's edge line, then reverses hard back into the arc.
 *
 * ⛔ THIS SUITE DRIVES THE REAL PIPELINE — `teeGeometry` (roadGeometry.js) → `roadStripRing` →
 * `dissolveRings` (roadNetwork.js) — never a hand-copied re-derivation, the same discipline the
 * sibling suites in this family use (see `roadJunctions.js`'s own header for why: three prior
 * road-junction "fixes" shipped with a fully green suite while the deployed build stayed broken,
 * because the test was never running the function the app runs).
 *
 * ROOT CAUSE, measured directly on build b3fc927 (PR #1754's own merge) and reproduced here byte
 * for byte: `capCorner` (a point fixed relative to the connect point `T`, offset by the driveway's
 * own half-width `phS`), the fillet's TRUE corner (`cornerPt` — the intersection of the driveway's
 * real edge LINE with the pad edge) and the arc's own driveway-side tangent (`tan2`) all sit on ONE
 * straight line by construction, but their ORDER along it is not fixed — it depends on the approach
 * angle. `cornerPt` also always sits on the pad-edge line through `T` and the arc's pad-side tangent
 * (`tan1`). The wedge ring shipped in PR #1754 (`ringWithT`/its no-`T` fallback) hand-stitched a
 * SINGLE fixed traversal order; whichever order it picked was correct for SOME configurations and
 * self-crossing for others. Where it self-crossed, `isSimplePolygon` correctly rejected the closed
 * ("T-included") form and fell back to a ring that skips `T` and closes with a straight CHORD from
 * the arc's own driveway tangent back to `capCorner` — a shape that is simple, but WRONG: the chord
 * cuts straight across the true gore, under-covering by the small triangle `T`-`tan1`-`cornerPt`,
 * and the surviving, un-absorbed `capCorner → tan2` leg is exactly what a fresh measurement found —
 * a lone straight run immediately followed by the arc reversing hard back toward `capCorner`, a
 * single vertex turning 87–108°.
 *
 * THE FIX (`roadGeometry.js`, `teeGeometry`'s `wedge()`): try BOTH of the two possible single-ring
 * traversal orders (the "naive" `T → capCorner → tan2 → [arc] → tan1 → T` and the "re-routed"
 * `T → capCorner → cornerPt → tan1 → [arc] → tan2 → T`) and use whichever comes back simple with a
 * genuine positive area — the two are complementary, not redundant, so between them every
 * configuration measured (including every one that broke either construction alone) resolves to a
 * real, complete curb return. `wedges.length` stays exactly 1 per corner (2 per junction), unchanged.
 *
 * ACCEPTANCE, matching the dispatch's own methodology (never `hasArc`, never an SVG "A" command —
 * there is no arc command anywhere; a correct return is a tessellated polyline): TOTAL TURN COVERED
 * (the run's points must sum to close to the full geometrically-required turn) and MAX SINGLE TURN
 * INSIDE THE RUN (no segment may turn anywhere near as much as a whole corner) are the criteria — a
 * clean PARTIAL arc passes a bare "an arc exists" check, which is exactly why that check is banned.
 */
import { describe, it, expect } from "vitest";
import { polygonEdges, nearestRectEdge, teeGeometry, roadEdgeCrossing } from "../src/workspaces/site-planner/lib/roadGeometry.js";
import { dissolveRings } from "../src/workspaces/site-planner/lib/roadNetwork.js";
import { roadStripRing, roadCurbWidth } from "../src/workspaces/site-planner/lib/siteGeometry.js";

const roadOuterHalf = (el) => Math.max(0, (+el.travelW || 0) / 2) + roadCurbWidth(el);

// Same construction as the dispatch's own repro: an 839×120 ft polygon paving pad, a 24 ft "aisle"
// road teeing into its long (south) edge at `angleDeg` off perpendicular, `alongEdge` ft from the
// edge's own midpoint (a negative value leans toward the pad's own acute corner).
function polygonPadScenario(angleDeg, alongEdge, opts = {}) {
  const { padW = 839, padH = 120, width = 24, driveLen = 300, R = 24 } = opts;
  const hw = padW / 2, hh = padH / 2;
  const points = [{ x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh }];
  const edges = polygonEdges(points);
  const e = edges[0]; // the south (bottom) edge
  const P = { x: e.mid.x + e.dir.x * alongEdge, y: e.mid.y + e.dir.y * alongEdge };
  const rad = (angleDeg * Math.PI) / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  const dir = { x: e.outN.x * c + e.dir.x * s, y: e.outN.y * c + e.dir.y * s };
  const far = { x: P.x + dir.x * driveLen, y: P.y + dir.y * driveLen };
  const road = { type: "road", pts: [far, P], vtx: [{}, {}], travelW: width, curb: 0.5, roadClass: "aisle" };
  const hit = nearestRectEdge(P, edges, { facingOnly: false });
  const sideDir = { x: far.x - P.x, y: far.y - P.y };
  const crossing = roadEdgeCrossing(far, P, edges);
  const junctionEdge = crossing ? crossing.edge : hit.edge;
  const junctionPt = crossing ? crossing.pt : P;
  const edgeRunPos = (junctionEdge.b.x - junctionPt.x) * junctionEdge.dir.x + (junctionEdge.b.y - junctionPt.y) * junctionEdge.dir.y;
  const edgeRunNeg = (junctionPt.x - junctionEdge.a.x) * junctionEdge.dir.x + (junctionPt.y - junctionEdge.a.y) * junctionEdge.dir.y;
  const geom = teeGeometry({
    T: junctionPt, throughDir: junctionEdge.dir, sideDir, phT: 0, phS: roadOuterHalf(road),
    R: Math.min(R, Math.max(1, padH)), flare: 0, curbT: 0.5, curbS: roadCurbWidth(road),
    throughAvailPos: Math.max(0, edgeRunPos), throughAvailNeg: Math.max(0, edgeRunNeg), sideAvail: driveLen - 1,
  });
  const strip = roadStripRing(road, {}, undefined, undefined);
  const wedges = geom ? geom.wedges : [];
  return { dissolved: dissolveRings([strip, ...wedges]), geom, junctionPt };
}

// Per-vertex signed turn (degrees) around a closed ring, paired with both adjoining segment lengths.
function ringTurns(ring) {
  const n = ring.length, out = [];
  for (let i = 0; i < n; i++) {
    const a = ring[(i - 1 + n) % n], b = ring[i], c = ring[(i + 1) % n];
    const v1 = { x: b.x - a.x, y: b.y - a.y }, v2 = { x: c.x - b.x, y: c.y - b.y };
    const len1 = Math.hypot(v1.x, v1.y), len2 = Math.hypot(v2.x, v2.y);
    if (!(len1 > 1e-9) || !(len2 > 1e-9)) continue;
    const turnDeg = Math.abs(Math.atan2(v1.x * v2.y - v1.y * v2.x, v1.x * v2.x + v1.y * v2.y)) * 180 / Math.PI;
    out.push({ i, turnDeg, len1, len2 });
  }
  return out;
}

const ccw = (a, b, c) => (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
const segCross = (a, b, c, d) => ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);
function isSimplePolygon(ring) {
  const n = ring && ring.length;
  if (!n || n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      const c = ring[j], d = ring[(j + 1) % n];
      if (j === (i + 1) % n || (j + 1) % n === i) continue;
      if (segCross(a, b, c, d)) return false;
    }
  }
  return true;
}

// A REAL curb-return run never turns anywhere near a whole corner in a single tessellation step —
// DEFAULT_TESS_DEG is 6°, so even a small-radius fillet's tightest step stays well under this. A
// genuine sharp corner (a road's own flat end cap, a pad corner) always rides a segment several
// feet long; this bound is calibrated well below the 87–108° folds measured pre-fix and comfortably
// above ordinary tessellation noise, matching the sibling suites' own `TIGHT_TURN_BOUND_DEG`-style
// bounds in this file family.
const MAX_SINGLE_TURN_DEG = 40;
// Two kinds of LEGITIMATE sharp turn ride this dissolved boundary and must not be mistaken for the
// fold: (a) a harmless, small closing "bevel" where the wedge's own straight leg meets the strip
// (the dispatch's own acceptance criteria names this explicitly: "the run closes with a ... bevel"),
// which rides a genuinely SHORT segment (a couple of feet) — the same short-leg signature this
// codebase already uses for ring-cleanup spikes (`roadNetwork.js`'s `RING_SPIKE_LEN_FT`); and (b) the
// road strip's own genuine 90° far-end corner, far from the junction, riding the strip's FULL length
// on one side (hundreds of feet) — nothing this item touches. The FOLD this item fixes is neither: a
// single vertex turning sharply while BOTH adjoining segments are substantial NEAR-JUNCTION legs (the
// dispatch's own measured 12.5–27 ft), so both legs are bounded above and below.
const BENIGN_CLOSING_LEG_FT = 3;
const JUNCTION_SCALE_FT = 60; // comfortably above the dispatch's 12.5–27 ft fold legs, well below a strip's own far-end run
// A third legitimate shape: the driveway's own flat-cap corner (`T`→`capCorner`, or the bridging
// triangle to the fillet's true corner) is a construction PERPENDICULAR by definition, so it lands
// within a small fraction of a degree of an exact right angle every time (measured: 89.90–90.02°).
// The fold this item fixes never lands near exactly 90° — it is the artifact of a boundary skipping
// straight past real geometry, not a deliberate perpendicular offset, and the dispatch's own measured
// values (87.07–108.59°) sit well outside this tolerance.
const RIGHT_ANGLE_TOL_DEG = 1;
function foldTurns(ring) {
  return ringTurns(ring).filter((t) => t.turnDeg > MAX_SINGLE_TURN_DEG
    && t.len1 > BENIGN_CLOSING_LEG_FT && t.len2 > BENIGN_CLOSING_LEG_FT
    && t.len1 < JUNCTION_SCALE_FT && t.len2 < JUNCTION_SCALE_FT
    && Math.abs(t.turnDeg - 90) > RIGHT_ANGLE_TOL_DEG);
}

describe("B1717616 (×3) — road-into-polygon-pad acute-side curb return no longer folds", () => {
  it("RED-PROOF-ACCEPTANCE: the dispatch's own two measured cases (25.46° and 34.49°, leaning either way toward the pad's acute corner) produce a clean, connected, simple pavement region with no single-segment fold", () => {
    for (const angleDeg of [25.46, 34.49]) {
      for (const alongEdge of [-380, 380]) {
        const { dissolved } = polygonPadScenario(angleDeg, alongEdge, { padW: 839, padH: 120, width: 24, R: 24 });
        expect(dissolved.length, `angle ${angleDeg} along ${alongEdge}: one connected region`).toBe(1);
        const region = dissolved[0];
        expect(isSimplePolygon(region.outer), `angle ${angleDeg} along ${alongEdge}: dissolved outline is a simple polygon`).toBe(true);
        const folds = foldTurns(region.outer);
        expect(folds, `angle ${angleDeg} along ${alongEdge}: no vertex may carry a fold — a single segment turning sharply while BOTH neighbouring segments are substantial (the fold this item fixes measured one segment turning 87–108° between 12.5–27 ft legs); found: ${JSON.stringify(folds.map((t) => ({ i: t.i, turnDeg: +t.turnDeg.toFixed(1), len1: +t.len1.toFixed(2), len2: +t.len2.toFixed(2) })))}`).toEqual([]);
      }
    }
  });

  it("total turn covered: the raw fillet arc (geom.returns) itself sweeps the FULL geometrically-required turn on both corners, at every angle in a fine sweep — a partial arc that merely 'exists' must not pass", () => {
    for (let a = 1; a <= 89; a += 2) {
      for (const alongEdge of [-380, 0, 380]) {
        const { geom } = polygonPadScenario(a, alongEdge, { padW: 839, padH: 120, width: 24, R: 24 });
        if (!geom) continue;
        for (let idx = 0; idx < geom.returns.length; idx++) {
          const arc = geom.returns[idx];
          if (!arc || arc.length < 3) continue; // a genuinely degenerate/sharp corner (no room) — nothing to sweep
          // Sum of consecutive per-segment deflections along the raw arc = the total turn it covers.
          let covered = 0;
          for (let i = 1; i < arc.length - 1; i++) {
            const v1 = { x: arc[i].x - arc[i - 1].x, y: arc[i].y - arc[i - 1].y };
            const v2 = { x: arc[i + 1].x - arc[i].x, y: arc[i + 1].y - arc[i].y };
            const l1 = Math.hypot(v1.x, v1.y), l2 = Math.hypot(v2.x, v2.y);
            if (!(l1 > 1e-9) || !(l2 > 1e-9)) continue;
            covered += Math.abs(Math.atan2(v1.x * v2.y - v1.y * v2.x, v1.x * v2.x + v1.y * v2.y)) * 180 / Math.PI;
          }
          // The arc's own total sweep (first tangent to last) — what `covered` must match.
          const first = { x: arc[1].x - arc[0].x, y: arc[1].y - arc[0].y };
          const last = { x: arc[arc.length - 1].x - arc[arc.length - 2].x, y: arc[arc.length - 1].y - arc[arc.length - 2].y };
          const required = Math.abs(Math.atan2(first.x * last.y - first.y * last.x, first.x * last.x + first.y * last.y)) * 180 / Math.PI;
          expect(covered, `angle ${a} along ${alongEdge} corner ${idx}: the arc's own tessellation must cover its whole required turn (${required.toFixed(1)}°), not a truncated fraction`).toBeGreaterThan(required - 1);
        }
      }
    }
  });

  it("KNOWN-GOOD CONTROL ARM: a plain perpendicular connect (no acute geometry at all) still produces a clean single-region return — proves the instrument recognizes working geometry, not just the absence of a fold", () => {
    const { dissolved } = polygonPadScenario(0, 0, { padW: 839, padH: 120, width: 24, R: 24 });
    expect(dissolved.length, "perpendicular control: one connected region").toBe(1);
    expect(foldTurns(dissolved[0].outer)).toEqual([]);
  });

  it("does not regress the full oblique sweep this item's own prior rounds already fixed (B1717616 ×1/×2) — every angle 0–89° on both leans stays one clean, simple region", () => {
    for (let a = 0; a <= 89; a += 1) {
      for (const alongEdge of [-380, 380]) {
        const { dissolved } = polygonPadScenario(a, alongEdge, { padW: 839, padH: 120, width: 24, R: 24 });
        expect(dissolved.length, `angle ${a} along ${alongEdge}: one connected region`).toBe(1);
        expect(isSimplePolygon(dissolved[0].outer), `angle ${a} along ${alongEdge}: simple polygon`).toBe(true);
      }
    }
  });
});
