/* B1713104 — a road tee-ing into ANOTHER ROAD gets NO curb return at all when the through
 * road carries no vertex at the tee point (a plain two-point straight run, or one whose spliced
 * vertex was never created because the tee was produced by dragging/redrawing rather than the
 * connect gesture). `teeTargetOf` (siteGeometry.js) only ever recognises a tee at an EXISTING
 * interior vertex of the through road, so with none there the two roads are never clustered by
 * `dissolveRings` and each renders as its own bare strip — "a plain rectangle simply overlapping
 * the other road, no arcs anywhere," exactly the symptom reported live on build b3be9cf.
 *
 * ⛔ THIS IS NOT A REGRESSION FROM PRs 1743 or 1744. `teeTargetOf`, `nodeJunction` and `roadRunFrom`
 * are byte-identical between build 9164d24 (which measured a working oblique road-to-road tee) and
 * build b3be9cf (which measured the broken 36-into-24 tee) — verified directly against the git
 * history (`git diff 9164d24 b3be9cf -- src/workspaces/site-planner/lib/roadGeometry.js` touches
 * only `teeGeometry`'s `wedge()`, which road-to-road tees never call — see roadGeometry.js's own
 * "teeGeometry HAS EXACTLY ONE LIVE CALLER" header). This defect is pre-existing on both builds; the
 * two live measurements cited in the dispatch differ because they were taken on two DIFFERENT
 * junction configurations (an oblique tee with a spliced vertex vs. one without), not because
 * anything changed in between. See BACKLOG.md for the full settle-the-regression writeup.
 *
 * The fix (`teeTargetPointOf`, siteGeometry.js) mirrors B1703665 NEW-2's fix for `driveJunctionsOf`
 * (road-to-PAD tees) exactly: try the real vertex first, and only when nothing is found there,
 * project the side road's endpoint onto the through road's own segments. This file is the RED PROOF
 * (the old `teeTargetOf`-only contract, still reachable and asserted below) and the fix's own
 * coverage, replicating the real `teeJunctionsOf` pipeline (SitePlanner.jsx) with pure, exported
 * functions — nodeJunction / roadRunFrom / roadTangentNoise / dissolveRings / roadStripRing — the
 * same discipline `test/roadJunctionRingCleanup.test.js`'s own `nodeJunctionScenario` already uses.
 */
import { describe, it, expect } from "vitest";
import { teeTargetOf, teeTargetPointOf } from "../src/workspaces/site-planner/lib/siteGeometry.js";
import { nodeJunction } from "../src/workspaces/site-planner/lib/roadGeometry.js";
import { roadRunFrom, roadTangentNoise } from "../src/workspaces/site-planner/lib/roadJunctions.js";
import { dissolveRings } from "../src/workspaces/site-planner/lib/roadNetwork.js";
import { roadStripRing, roadCurbWidth } from "../src/workspaces/site-planner/lib/siteGeometry.js";

const roadOuterHalf = (el) => Math.max(0, (+el.travelW || 0) / 2) + roadCurbWidth(el);

function mkRoad(id, pts, travelW) {
  return { id, type: "road", pts, vtx: pts.map(() => ({})), travelW, curb: 0.5, roadClass: "aisle" };
}

// Replicates teeJunctionsOf's per-endpoint body (SitePlanner.jsx) exactly, using the real pure
// exports, so this is the SAME computation the renderer performs — not a hand re-derivation that
// could quietly diverge from it (the exact gap B1703665's own header names as the reason 3 rounds
// of road-to-pad fixes shipped broken).
function resolveTee(roads, S, ei, R = 24, detector = teeTargetPointOf) {
  const P = S.pts[ei];
  const hit = detector(roads, S, P);
  if (!hit) return null;
  const { G, gvi, pts: gPts = G.pts } = hit;
  const sideRun = roadRunFrom(S.pts, ei, ei === 0 ? 1 : -1, roadTangentNoise(S));
  const sideDir = { x: sideRun.far.x - P.x, y: sideRun.far.y - P.y };
  const backRun = roadRunFrom(gPts, gvi, -1, roadTangentNoise(G)), fwdRun = roadRunFrom(gPts, gvi, 1, roadTangentNoise(G));
  const a = backRun.far, b = fwdRun.far;
  const halfG = roadOuterHalf(G), halfS = roadOuterHalf(S);
  const nj = nodeJunction({
    node: { x: P.x, y: P.y }, R, flatDeg: 178, roundOwnCorner: true,
    arms: [
      { dir: { x: a.x - P.x, y: a.y - P.y }, half: halfG, avail: backRun.dist, road: G.id, deep: Math.min(halfG * 0.5, 12) },
      { dir: { x: b.x - P.x, y: b.y - P.y }, half: halfG, avail: fwdRun.dist, road: G.id, deep: Math.min(halfG * 0.5, 12) },
      { dir: sideDir, half: halfS, avail: sideRun.dist, road: S.id, deep: Math.max(1, Math.min(halfS * 0.5, 12)) },
    ],
  });
  return { hit, nj };
}

describe("B1713104 — road-to-road tee, geometric detection when the through road has no spliced vertex", () => {
  // Straight 24 ft through road with NO interior vertex — the exact shape a plain two-point road has.
  const through24 = mkRoad("through24", [{ x: -300, y: 0 }, { x: 300, y: 0 }], 24);
  // 36 ft side road ending exactly on the through road's line, at (0,0) — no splice was ever performed.
  const side36 = mkRoad("side36", [{ x: 0, y: -300 }, { x: 0, y: 0 }], 36);
  const roads = [through24, side36];

  it("RED PROOF — teeTargetOf (the old, vertex-only rule) finds NOTHING here, however exactly the " +
     "endpoint coincides with the through road's line — this is the bug itself, still reachable", () => {
    const hit = teeTargetOf(roads, side36, side36.pts[1]);
    expect(hit, "a through road with no interior vertex can never be found by the vertex-only rule").toBeNull();
  });

  it("teeTargetPointOf (the fix) finds the tee geometrically, splicing a virtual vertex", () => {
    const hit = teeTargetPointOf(roads, side36, side36.pts[1]);
    expect(hit).toBeTruthy();
    expect(hit.G.id).toBe("through24");
    expect(hit.pts.length).toBe(through24.pts.length + 1); // the virtual splice adds one point
    expect(hit.pts[hit.gvi]).toEqual({ x: 0, y: 0 });
  });

  it("the FULL pipeline (nodeJunction -> dissolveRings), driven off the new detector, produces a " +
     "real curb return on BOTH sides — the old detector produces NOTHING (both roads stay separate, " +
     "un-clustered, un-filleted strips)", () => {
    const oldResolved = resolveTee(roads, side36, 1, 24, teeTargetOf);
    expect(oldResolved, "the old vertex-only detector must still fail to find this junction").toBeNull();

    const { nj } = resolveTee(roads, side36, 1, 24, teeTargetPointOf);
    expect(nj, "the new geometric detector must resolve a real junction").toBeTruthy();
    expect(nj.wedges.length, "both sides of the tee must carry real curb-return pavement").toBe(2);
    for (const g of nj.gaps) expect(g.R, "each side must be a genuine, non-degenerate radius").toBeGreaterThan(0);
  });

  it("dissolved: the through strip + side strip + the new wedges merge into ONE connected region " +
     "(the old detector leaves them as TWO separate, unmerged rectangles)", () => {
    const stripThrough = roadStripRing(through24, {}, new Set(), undefined);
    const stripSide = roadStripRing(side36, {}, new Set(), undefined);

    const { nj } = resolveTee(roads, side36, 1, 24, teeTargetPointOf);
    const dissolvedNew = dissolveRings([stripThrough, stripSide, ...nj.wedges]);
    expect(dissolvedNew.length, "through + side + returns must merge into one region").toBe(1);

    // What the OLD (undetected) behaviour actually renders: no wedges at all, so the two strips are
    // never clustered together by teeJunctionsOf's own pairing logic and are each their own region.
    const dissolvedOld = dissolveRings([stripThrough]).concat(dissolveRings([stripSide]));
    expect(dissolvedOld.length, "the old behaviour renders the two roads as separate, unmerged pieces").toBe(2);
  });

  it("swept across widths (through narrower AND wider than side) and angles, every tee with no " +
     "spliced vertex now gets real pavement on both sides", () => {
    for (const [throughW, sideW] of [[24, 36], [36, 24], [24, 24], [48, 20]]) {
      for (const sideDeg of [90, 60, 45, 30, 120]) {
        const N = { x: 0, y: 0 };
        const through = mkRoad("g", [{ x: -300, y: 0 }, { x: 300, y: 0 }], throughW);
        const sideFar = { x: Math.cos((sideDeg * Math.PI) / 180) * 300, y: Math.sin((sideDeg * Math.PI) / 180) * 300 };
        const side = mkRoad("s", [sideFar, N], sideW);
        const rs = [through, side];
        const { nj } = resolveTee(rs, side, 1, 24, teeTargetPointOf);
        expect(nj, `through=${throughW} side=${sideW} deg=${sideDeg}: must resolve`).toBeTruthy();
        expect(nj.wedges.length, `through=${throughW} side=${sideW} deg=${sideDeg}: both sides must get pavement`).toBe(2);
      }
    }
  });

  it("a genuine WELD (side road endpoint at the through road's own END, not its middle) is left to " +
     "weldJunctionsOf — the geometric fallback must not also claim it as a tee", () => {
    const throughShort = mkRoad("throughShort", [{ x: -300, y: 0 }, { x: 0, y: 0 }], 24); // ends AT (0,0)
    const side = mkRoad("side", [{ x: 0, y: -300 }, { x: 0, y: 0 }], 36);
    const hit = teeTargetPointOf([throughShort, side], side, side.pts[1]);
    expect(hit, "an endpoint-to-endpoint coincidence is a weld, not a tee").toBeNull();
  });

  it("a road merely passing a few widths away (not actually touching) is still correctly rejected", () => {
    const through = mkRoad("through", [{ x: -300, y: 0 }, { x: 300, y: 0 }], 24);
    const side = mkRoad("side", [{ x: 40, y: -300 }, { x: 40, y: -20 }], 36); // stops 20 ft short
    const hit = teeTargetPointOf([through, side], side, side.pts[1]);
    expect(hit, "a road that doesn't actually reach the other must not be treated as a tee").toBeNull();
  });
});
