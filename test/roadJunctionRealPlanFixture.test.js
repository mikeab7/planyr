/* B1703666 NEW-3 — a fixture that carries the conditions measured on the owner's real Goose Creek
 * plan, run through the REAL renderer pipeline (`driveJunctionsOf` from lib/roadJunctions.js +
 * `dissolveRings` from lib/roadNetwork.js — not a re-derivation), because a blank-plan axis-aligned
 * rect pad never exercised the conditions that broke the deployed build:
 *   1. The pad is a ROTATED rect (~1.46° off vertical), so the road meets its edge off-square.
 *   2. The road tees into the pad's SHORT end edge, near enough to a real corner that the return's
 *      own natural reach (~half the drive's own width) can exceed the room left before the corner —
 *      the exact condition NEW-2's fix (roadGeometry.js's `wedge()`) targets.
 *   3. The dissolved surface is a MERGE of several road pieces, not one road on a blank plan.
 *   4. Road end-conditions differ between stubs — one terminates flush on the pad edge, one carries a
 *      short tab INSIDE the pad (a welded endpoint past the pad's own midline — B1612608's case).
 *   5. A building sits near one junction (exercises `buildingRunLimit`'s clamp).
 *   6. One stub connects with NO stored `driveTee` at all — B1703665's geometric-detection
 *      fix is what gives it a junction at all; under the old flag-only contract it was a bare butt
 *      joint, one of the seven the dispatch measured with no return anywhere.
 *
 * Acceptance is BOTH measures from ui-audit/lib/paveFloodFill.mjs — the enclosed-hole scan (still
 * must be clean: no true courtyard) AND the convex-deficiency scan (NEW-1: the one that can actually
 * see an open bevel/notch), each with its own self-test control. Window sized to the return radius
 * (a 32 ft window, following the dispatch's own methodology and the ratio confirmed in
 * test/paveFloodFill.test.js — a window many times wider than the return just measures how far the
 * pad happens to extend past the window edge, not the corner's own treatment).
 */
import { describe, it, expect } from "vitest";
import { driveJunctionsOf } from "../src/workspaces/site-planner/lib/roadJunctions.js";
import { dissolveRings } from "../src/workspaces/site-planner/lib/roadNetwork.js";
import { roadStripRing } from "../src/workspaces/site-planner/lib/siteGeometry.js";
import { rectEdges } from "../src/workspaces/site-planner/lib/roadGeometry.js";
import {
  pavedPredicate, deficiencyAreaSqFt,
  assertMeasurableConvexDeficiency, assertMeasurableFloodFill,
} from "../ui-audit/lib/paveFloodFill.mjs";

// The real pad: a rotated rect whose SHORT (135 ft) edge is what a road ties into, long (1747 ft)
// axis running the other way — measured on the owner's real "Goose Creek" plan (e1454752hwafkt).
const ROT_DEG = 358.543241069641 - 360; // ~-1.4568° — "about 1.45 degrees off vertical"
const PAD = { id: "pad", type: "paving", cx: 0, cy: 0, w: 135, h: 1747, rot: ROT_DEG };
const PAD_EDGES = rectEdges(PAD.cx, PAD.cy, PAD.w, PAD.h, PAD.rot); // edges[0] = the short "bottom" edge, length 135

// The dispatch's own measured near-corner distances (23.8/23.0/23.8 ft) were flagged in the dispatch
// itself as an unverified CORRELATION, not a proven mechanism. Direct measurement against this exact
// pipeline (a sweep run once while building this fixture, over the real driveJunctionsOf + teeGeometry
// pair) found the real degenerate zone is under about 20 ft from a corner — close to the drive's own
// half-width + curb (37/2 + 0.5 ≈ 19 ft), which is what the fillet's natural anchor point sits out at
// (see roadGeometry.js's NEW-2 header on `wedge()`). 10 ft sits comfortably inside that measured zone,
// so this fixture exercises the actual fallback path rather than assuming a number from the dispatch's
// own flagged inference.
const NEAR_CORNER_DIST = 10;

function padPointAt(distFromCornerA) {
  const e = PAD_EDGES[0];
  return { x: e.a.x + e.dir.x * distFromCornerA, y: e.a.y + e.dir.y * distFromCornerA };
}
// A point INSIDE the pad body, `inFt` behind the edge point at `distFromCornerA` — used as the
// mandatory self-test disc centre: it must sit within a tight corner window AND on solidly-paved
// ground, which the pad's own far centre (873 ft up its long axis) is not.
function padInwardPoint(distFromCornerA, inFt = 5) {
  const e = PAD_EDGES[0], p = padPointAt(distFromCornerA);
  return { x: p.x - e.outN.x * inFt, y: p.y - e.outN.y * inFt };
}

// A road stub tee-ing into the pad's short edge at `distFromCornerA` ft from one corner, at
// `angleOffPerpDeg` off the true perpendicular (the pad's own rotation already bakes in ~1.46° of
// this relative to true north — this parameter is ADDITIONAL skew from the road's own bearing).
// `insideFt` places the connect point that far INSIDE the pad past the edge (condition 4's "tab").
function makeStub(id, distFromCornerA, angleOffPerpDeg, opts = {}) {
  const { travelW = 37, roadClass = "truck", driveTee = { targetId: "pad", kind: "truckcourt" }, insideFt = 0, driveLenFt = 182 } = opts;
  const e = PAD_EDGES[0];
  const edgePt = padPointAt(distFromCornerA);
  const rad = (angleOffPerpDeg * Math.PI) / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  const inward = { x: e.outN.x * -c + e.dir.x * s, y: e.outN.y * -c + e.dir.y * s }; // into the pad
  const outward = { x: -inward.x, y: -inward.y };
  const P = insideFt > 0 ? { x: edgePt.x + inward.x * insideFt, y: edgePt.y + inward.y * insideFt } : edgePt;
  const far = { x: P.x + outward.x * driveLenFt, y: P.y + outward.y * driveLenFt }; // free-ended, short stub
  return { id, type: "road", pts: [far, P], vtx: [{}, {}], travelW, curb: 0.5, roadClass, driveTee };
}

const BUILDING = { id: "bldg", type: "building", cx: padPointAt(NEAR_CORNER_DIST).x - 40, cy: padPointAt(NEAR_CORNER_DIST).y + 60, w: 120, h: 80, rot: 0 };

describe("NEW-3 real-plan fixture — rotated pad, oblique near-corner tee, merged cluster, mixed conditions", () => {
  const NEAR_CORNER_STUB = makeStub("nearCorner", NEAR_CORNER_DIST, 1.5);  // condition 2 — a near-corner, oblique tee
  const TAB_STUB = makeStub("tab", 55, -0.8, { insideFt: 14 });            // condition 4 — a stub with an inside tab
  const NO_TEE_STUB = makeStub("noTee", 90, 0.5, { driveTee: null });      // condition 6 — no stored driveTee at all
  const MID_STUB = makeStub("mid", 67.5, 0);                               // an ordinary mid-edge stub, for the merged cluster
  const ELS = [PAD, BUILDING, NEAR_CORNER_STUB, TAB_STUB, NO_TEE_STUB, MID_STUB];

  it("every stub — including the one with NO stored driveTee — resolves to a real junction", () => {
    const junctions = driveJunctionsOf(ELS, {});
    const bySide = new Map(junctions.map((j) => [j.sideId, j]));
    for (const id of ["nearCorner", "tab", "noTee", "mid"]) {
      expect(bySide.has(id), `${id}: must resolve to a junction against the real pipeline`).toBe(true);
    }
  });

  it("EVERY junction's wedges are non-empty on at least one side", () => {
    const junctions = driveJunctionsOf(ELS, {});
    for (const j of junctions) {
      expect(j.geom.wedges.length, `${j.sideId}: expected pavement on the junction, got ${j.geom.wedges.length}`).toBeGreaterThan(0);
    }
  });

  // RED PROOF (verified during development by `git stash`-ing just the roadGeometry.js `wedge()`
  // change and re-running this file: this exact assertion drops from 2 to 1 wedges on the pre-fix
  // source, because the near-corner side's room (10 ft) sits inside the ~19 ft the drive's own
  // half-width+curb naturally needs, which is exactly the condition the old `wedge()` contract
  // degenerated to a dropped, un-rounded corner on — see roadGeometry.js's NEW-2 header).
  it("the NEAR-CORNER junction specifically gets pavement on BOTH sides — 'a bevel is never " +
     "acceptable output' (NEW-2) — even though its room is tight enough to have degenerated one " +
     "side entirely before this fix", () => {
    const junctions = driveJunctionsOf(ELS, {});
    const j = junctions.find((x) => x.sideId === "nearCorner");
    expect(j, "the near-corner junction must exist").toBeTruthy();
    expect(j.geom.wedges.length, "both sides of the near-corner junction must carry real pavement").toBe(2);
  });

  it("the whole cluster (pad + all four stub strips + every junction's wedges) dissolves to ONE " +
     "connected, simple surface", () => {
    const junctions = driveJunctionsOf(ELS, {});
    const padRing = PAD_EDGES.map((e) => e.a);
    const parts = [padRing];
    for (const el of [NEAR_CORNER_STUB, TAB_STUB, NO_TEE_STUB, MID_STUB]) {
      const strip = roadStripRing(el, {}, undefined, undefined);
      if (strip && strip.length >= 3) parts.push(strip);
    }
    for (const j of junctions) parts.push(...j.geom.wedges);
    const dissolved = dissolveRings(parts);
    expect(dissolved.length, "the pad + every stub + every return should merge into one region").toBe(1);
  });

  it("RED PROOF — the acceptance measure the dispatch demanded: convex deficiency at the near-corner " +
     "junction, in a 32 ft window, is SMALL after the fix (never the wide-open gore a raw bevel " +
     "leaves) — floodFillEnclosed alone is proven insufficient in the same call, exactly as the " +
     "dispatch's own diagnosis describes", () => {
    const junctions = driveJunctionsOf(ELS, {});
    const j = junctions.find((x) => x.sideId === "nearCorner");
    expect(j, "the near-corner junction must exist").toBeTruthy();
    const padRing = PAD_EDGES.map((e) => e.a);
    const stripRing = roadStripRing(NEAR_CORNER_STUB, {}, undefined, undefined);
    const regions = dissolveRings([padRing, stripRing, ...j.geom.wedges]);
    const isPaved = pavedPredicate([], regions);
    const corner = padPointAt(NEAR_CORNER_DIST);
    const HALF = 16; // a 32 ft window, same scale test/paveFloodFill.test.js validated the measure at
    const win = { x0: corner.x - HALF, y0: corner.y - HALF, x1: corner.x + HALF, y1: corner.y + HALF };
    const discCenter = padInwardPoint(NEAR_CORNER_DIST); // inside the pad, inside the window
    const enclosed = assertMeasurableFloodFill(isPaved, win, 0.5, discCenter, 3, "near-corner-enclosed");
    // floodFillEnclosed is not wrong to read 0 here — the bevel this class of defect leaves is OPEN
    // to the grass, not enclosed, which is exactly why it is not a sufficient acceptance test alone.
    expect(enclosed.real.enclosedCount).toBe(0);
    const deficiency = assertMeasurableConvexDeficiency(isPaved, win, 0.5, discCenter, 3, "near-corner-deficiency");
    const area = deficiencyAreaSqFt(deficiency.real);
    // A real, tangent return at this scale (37 ft drive, ~50 ft class radius clamped by available
    // room) leaves a bounded circular-segment-scale residual — not the ~100+ sq ft open gore a raw
    // bevel or a dropped wedge leaves (test/paveFloodFill.test.js's own raw-butt-joint case).
    expect(area, `near-corner convex deficiency: ${area} sq ft`).toBeLessThan(100);
  });


  it("the building near the near-corner junction clamps that side's reach and still leaves no gap " +
     "under it — pavement never exists under a building", () => {
    const junctions = driveJunctionsOf(ELS, {});
    const j = junctions.find((x) => x.sideId === "nearCorner");
    expect(j).toBeTruthy();
    // The wedge must not reach into the building's own footprint.
    const bRad = (BUILDING.rot * Math.PI) / 180;
    const bCorners = [[-BUILDING.w / 2, -BUILDING.h / 2], [BUILDING.w / 2, -BUILDING.h / 2], [BUILDING.w / 2, BUILDING.h / 2], [-BUILDING.w / 2, BUILDING.h / 2]]
      .map(([lx, ly]) => ({ x: BUILDING.cx + lx * Math.cos(bRad) - ly * Math.sin(bRad), y: BUILDING.cy + lx * Math.sin(bRad) + ly * Math.cos(bRad) }));
    const bx0 = Math.min(...bCorners.map((p) => p.x)), bx1 = Math.max(...bCorners.map((p) => p.x));
    const by0 = Math.min(...bCorners.map((p) => p.y)), by1 = Math.max(...bCorners.map((p) => p.y));
    for (const wedge of j.geom.wedges) {
      for (const p of wedge) {
        const insideBuilding = p.x > bx0 + 0.1 && p.x < bx1 - 0.1 && p.y > by0 + 0.1 && p.y < by1 - 0.1;
        expect(insideBuilding, `wedge point (${p.x.toFixed(1)},${p.y.toFixed(1)}) must not sit inside the building`).toBe(false);
      }
    }
  });
});
