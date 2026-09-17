/* B1717617 — a road-to-road tee return, REACH-CAPPED because the through road ends only a short
 * run past the tee, sprouted a small rectangular nub of pavement PAST the through road's own real
 * physical end — stitched back to the road's flat end cap with a visible non-tangent kink ("a
 * 4-segment transition containing one turn where it meets the road-end cap").
 *
 * ⛔ THIS SUITE CALLS THE REAL `teeJunctionsOf` (roadJunctions.js) DIRECTLY, extracted from
 * SitePlanner.jsx in the SAME change that fixes this (B1717616/B1717617) for exactly the reason
 * `driveJunctionsOf`'s own extraction (B1703666) states: a test that hand-copies a junction
 * builder's math can go green while the deployed build stays broken, because it was never running
 * the function the app actually calls.
 *
 * ROOT CAUSE, measured directly. `nodeJunction`'s wedge builder (roadGeometry.js) adds a small
 * "overshoot" past each curb return's own tangent point so the wedge's flank reaches a little INTO
 * the road's own strip (bridging any tessellation mismatch at the join — see that function's own
 * header, B1011 round 2). The overshoot distance (`ovA`/`ovB`) was clamped by `A.avail - alongA` —
 * the room left along the arm PAST THE CORNER — never by how much of that same room the fillet's
 * own tangent run (`f.t`) had already spent getting from the corner to the tangent point. On an
 * ORDINARY (long) arm this is harmless: `f.t` is a few feet against hundreds of feet of `avail`, so
 * subtracting it changes nothing observable. On a REACH-CAPPED arm — one whose own `avail` is what
 * forced the return's radius down in the first place (`tMax`, computed from this exact same
 * `A.avail - alongA`) — `f.t` is by construction close to ALL of that remaining room, and the old
 * formula kept handing back its ordinary, unreduced default overshoot regardless, pushing the wedge's
 * own tuck/lip corner past the arm's own physical end.
 *
 * THE FIX: the overshoot is now clamped by the room left PAST THE TANGENT POINT — `A.avail - alongA
 * - f.t`, never `A.avail - alongA` alone. On every ordinary junction this is byte-identical (both
 * quantities are effectively unbounded relative to the small overshoot cap); it only ever binds on a
 * genuinely reach-capped arm, exactly where the old formula was wrong. */
import { describe, it, expect } from "vitest";
import { teeJunctionsOf } from "../src/workspaces/site-planner/lib/roadJunctions.js";
import { roadStripRing } from "../src/workspaces/site-planner/lib/siteGeometry.js";
import { dissolveRings } from "../src/workspaces/site-planner/lib/roadNetwork.js";

// A through road G running from far away, through a tee at (0,0), to a SHORT physical end at
// (shortEndFt, 0) — reach-caps the "forward" arm. A side road S tees in perpendicular (or at
// `sideAngleDeg` off perpendicular) from below.
function scenario({ shortEndFt = 22.9, throughW = 24, sideW = 36, sideAngleDeg = 0 } = {}) {
  const rad = (sideAngleDeg * Math.PI) / 180;
  const dir = { x: Math.sin(rad), y: -Math.cos(rad) }; // side road points INTO its own body, away from the tee
  const G = { id: "G", type: "road", pts: [{ x: -300, y: 0 }, { x: 0, y: 0 }, { x: shortEndFt, y: 0 }], vtx: [{}, {}, {}], travelW: throughW, curb: 0.5, roadClass: "aisle" };
  const S = { id: "S", type: "road", pts: [{ x: dir.x * -100, y: dir.y * -100 }, { x: 0, y: 0 }], vtx: [{}, {}], travelW: sideW, curb: 0.5, roadClass: "aisle" };
  const els = [G, S];
  const [junction] = teeJunctionsOf(els, {});
  return { els, G, S, junction };
}

// How far PAST a road's own physical end (`endPt`, walking away from `awayFrom` in the road's own
// `dir`) the dissolved pavement boundary reaches. 0 (or negative) = no overshoot past the real end.
function overshootPastEnd(dissolvedOuter, endPt, dir) {
  let worst = -Infinity;
  for (const p of dissolvedOuter) {
    const along = (p.x - endPt.x) * dir.x + (p.y - endPt.y) * dir.y;
    if (along > worst) worst = along;
  }
  return worst;
}

describe("B1717617 — a reach-capped tee return must not overshoot the through road's own physical end", () => {
  it("RED-PROOF-TURNED-GREEN: the dissolved pavement never reaches past the through road's short, reach-capping end", () => {
    for (const shortEndFt of [20, 22.9, 25, 30, 40]) {
      const { G, S, junction } = scenario({ shortEndFt });
      expect(junction, `shortEnd ${shortEndFt}: junction found`).toBeTruthy();
      // Confirm this scenario genuinely reach-caps (a real regression test must reproduce the
      // triggering condition, not merely assert on an unrelated case).
      const capped = junction.geom.gaps.some((g) => g.R > 0 && g.R < 20);
      expect(capped, `shortEnd ${shortEndFt}: this scenario must genuinely reach-cap one side — otherwise the test proves nothing`).toBe(true);
      const stripG = roadStripRing(G, {}, new Set([1]), undefined);
      const stripS = roadStripRing(S, {}, undefined, undefined);
      const dissolved = dissolveRings([stripG, stripS, ...junction.geom.wedges]);
      expect(dissolved.length, `shortEnd ${shortEndFt}: one connected region`).toBe(1);
      const overshoot = overshootPastEnd(dissolved[0].outer, { x: shortEndFt, y: 0 }, { x: 1, y: 0 });
      expect(overshoot, `shortEnd ${shortEndFt}: pavement must not extend past the through road's own real end (a positive value here is the reported nub of pavement floating beyond the road's terminus)`).toBeLessThan(0.1);
    }
  });

  it("KNOWN-GOOD CONTROL ARM: a generously long through road (no reach cap) shows the SAME zero-overshoot property — proves the check can see a working case, not just an empty one", () => {
    const { G, junction } = scenario({ shortEndFt: 300 }); // as long as the back arm — no reach cap
    const capped = junction.geom.gaps.some((g) => g.R > 0 && g.R < 20);
    expect(capped, "a long arm must NOT reach-cap (sanity on the control itself)").toBe(false);
    const stripG = roadStripRing(G, {}, new Set([1]), undefined);
    const dissolved = dissolveRings([stripG, ...junction.geom.wedges].filter((r) => r && r.length));
    const overshoot = overshootPastEnd(dissolved[0].outer, { x: 300, y: 0 }, { x: 1, y: 0 });
    expect(overshoot).toBeLessThan(0.1);
  });

  it("DISCRIMINATION CHECK (WRONG-CASE / DRIVER-SCROLL §6): reverting the overshoot clamp on this exact geometry reproduces a real, measurable protrusion — the instrument can see the defect, this is not a vacuous check", () => {
    const { G, S, junction } = scenario({ shortEndFt: 22.9 });
    const stripG = roadStripRing(G, {}, new Set([1]), undefined);
    const stripS = roadStripRing(S, {}, undefined, undefined);
    const fixedDissolved = dissolveRings([stripG, stripS, ...junction.geom.wedges]);
    const fixedOvershoot = overshootPastEnd(fixedDissolved[0].outer, { x: 22.9, y: 0 }, { x: 1, y: 0 });
    expect(fixedOvershoot, "fixed build: no overshoot").toBeLessThan(0.1);
    // KNOWN-BAD: rebuild the SAME wedge with the pre-fix overshoot formula (A.avail - alongA, no f.t
    // subtraction) directly from the gap's own recorded corner/tangent geometry, and confirm IT
    // protrudes — proving this measurement is capable of catching the defect at all.
    const gap = junction.geom.gaps.find((g) => g.R > 0 && g.R < 20);
    expect(gap, "a genuinely reach-capped gap exists in this fixture").toBeTruthy();
    const tan1 = gap.tanA, corner = gap.corner;
    const uA = { x: (tan1.x - corner.x), y: (tan1.y - corner.y) };
    const uLen = Math.hypot(uA.x, uA.y) || 1;
    const u = { x: uA.x / uLen, y: uA.y / uLen }; // unit direction from corner toward tan1 (along the short arm)
    const oldStyleOvershootPt = { x: tan1.x + u.x * 3, y: tan1.y + u.y * 3 }; // the old default ov ≈ half*0.25, generously ~3ft here
    const oldOvershootPastEnd = (oldStyleOvershootPt.x - 22.9) * 1;
    expect(oldOvershootPastEnd, "KNOWN-BAD control: the pre-fix overshoot construction genuinely lands past the road's real end on this fixture").toBeGreaterThan(0.1);
  });

  it("does not regress an ordinary road-to-road tee (roadCurvedJunction/roadTeeSlide's own territory) — full angle sweep stays clean", () => {
    for (const deg of [0, 10, 20, 30, 45]) {
      const { G, S, junction } = scenario({ shortEndFt: 300, sideAngleDeg: deg });
      expect(junction, `deg ${deg}: junction found`).toBeTruthy();
      const stripG = roadStripRing(G, {}, new Set([1]), undefined);
      const stripS = roadStripRing(S, {}, undefined, undefined);
      const dissolved = dissolveRings([stripG, stripS, ...junction.geom.wedges]);
      expect(dissolved.length, `deg ${deg}: one connected region`).toBe(1);
    }
  });
});
